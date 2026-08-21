import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Info, Repeat, WandSparkles, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import {
  listLeadEventsWithContacts,
  listSalesWithContacts,
  computeCrmLeadStats,
  assignSeller,
  listProjectCustomFields,
  type CrmLeadStats,
} from '../services/crmLeads.service';
import { listSellers } from '../services/sellers.service';
import { formatBRL, formatNumber, formatPercent } from '../lib/format';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';
import { RealLeadHistoryModal } from '../components/leads/RealLeadHistoryModal';
import { SalesImportModal } from '../components/leads/SalesImportModal';
import { LeadImportModal } from '../components/leads/LeadImportModal';
import type { ContactRow, LeadEventRow, ProjectCustomFieldRow, SaleRow, SellerRow } from '../integrations/supabase/database.types';

interface ContactGroup {
  contact: ContactRow;
  events: LeadEventRow[];
  sales: SaleRow[];
}

const leadRowsCache = new Map<string, { events: LeadEventRow[]; contacts: ContactRow[] }>();
const saleRowsCache = new Map<string, { sales: SaleRow[]; contacts: ContactRow[] }>();

function rangeCacheKey(projectId: string, scope: 'all' | 'period', start: string, end: string) {
  return `${projectId}:${scope}:${scope === 'period' ? `${start}:${end}` : 'all'}`;
}

export function LeadsPage() {
  const { isAdmin } = useAuth();
  const { project, permissions } = useProject();
  const { dateRange, setCustomRange } = useFilters();
  const canManage = isAdmin || permissions.can_edit_settings;
  const [tab, setTab] = useState<'leads' | 'vendas'>('leads');
  const [search, setSearch] = useState('');
  const [showInfo, setShowInfo] = useState(true);

  const [events, setEvents] = useState<LeadEventRow[] | null>(null);
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [openContact, setOpenContact] = useState<ContactGroup | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [showSalesImport, setShowSalesImport] = useState(false);
  const [showLeadImport, setShowLeadImport] = useState(false);
  const [customSaleFields, setCustomSaleFields] = useState<ProjectCustomFieldRow[]>([]);
  const [salesPage, setSalesPage] = useState(1);
  const [salesPageSize, setSalesPageSize] = useState(50);
  const [salesScope, setSalesScope] = useState<'all' | 'period'>('period');
  const [leadScope, setLeadScope] = useState<'all' | 'period'>('period');
  const [leadPage, setLeadPage] = useState(1);
  const [leadPageSize, setLeadPageSize] = useState(50);

  useEffect(() => {
    if (tab !== 'leads') return;
    let active = true;
    setEvents(null);
    (async () => {
      const range = { since: dateRange.start, until: dateRange.end };
      const key = rangeCacheKey(project.id, leadScope, range.since, range.until);
      const cached = leadRowsCache.get(key);
      if (cached) {
        if (!active) return;
        setEvents(cached.events);
        setContacts((current) => mergeContacts(current, cached.contacts));
        return;
      }
      const result = await listLeadEventsWithContacts(project.id, leadScope === 'period' ? range : undefined);
      if (!active) return;
      setEvents(result.events);
      leadRowsCache.set(key, result);
      setContacts((current) => mergeContacts(current, result.contacts));
    })();
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end, reloadToken, leadScope, tab]);

  useEffect(() => {
    if (tab !== 'vendas') return;
    let active = true;
    setSales(null);
    (async () => {
      const range = { since: dateRange.start, until: dateRange.end };
      const key = rangeCacheKey(project.id, salesScope, range.since, range.until);
      const cached = saleRowsCache.get(key);
      if (cached) {
        if (!active) return;
        setSales(cached.sales);
        setContacts((current) => mergeContacts(current, cached.contacts));
        return;
      }
      const result = await listSalesWithContacts(project.id, salesScope === 'period' ? range : undefined);
      if (!active) return;
      saleRowsCache.set(key, result);
      setSales(result.sales);
      setContacts((current) => mergeContacts(current, result.contacts));
    })();
    return () => { active = false; };
  }, [project.id, dateRange.start, dateRange.end, reloadToken, salesScope, tab]);

  useEffect(() => {
    let active = true;
    void listSellers(project.client_id, { activeOnly: true }).then((rows) => {
      if (active) setSellers(rows);
    });
    return () => {
      active = false;
    };
  }, [project.client_id]);

  useEffect(() => {
    void listProjectCustomFields(project.id, 'sale').then(setCustomSaleFields).catch(() => setCustomSaleFields([]));
  }, [project.id, reloadToken]);

  useEffect(() => { setSalesPage(1); }, [project.id, dateRange.start, dateRange.end, salesPageSize, salesScope]);
  useEffect(() => { setLeadPage(1); }, [project.id, dateRange.start, dateRange.end, leadPageSize, search]);

  async function handleAssignSeller(saleId: string, sellerId: string) {
    await assignSeller(saleId, sellerId || null);
    setSales((prev) => (prev ? prev.map((s) => (s.id === saleId ? { ...s, seller_id: sellerId || null } : s)) : prev));
  }

  const groups = useMemo<ContactGroup[]>(() => {
    if (!events) return [];
    const byContact = new Map<string, ContactGroup>();
    for (const contact of contacts) {
      byContact.set(contact.id, { contact, events: [], sales: [] });
    }
    for (const e of events) {
      byContact.get(e.contact_id)?.events.push(e);
    }
    for (const s of sales ?? []) {
      byContact.get(s.contact_id)?.sales.push(s);
    }
    return Array.from(byContact.values()).sort((a, b) => {
      const aLast = a.events[0]?.occurred_at ?? '';
      const bLast = b.events[0]?.occurred_at ?? '';
      return aLast < bLast ? 1 : -1;
    });
  }, [events, sales, contacts]);

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const leadGroups = groups.filter((group) => group.events.length > 0);
    if (!term) return leadGroups;
    return leadGroups.filter(
      (g) =>
        (g.contact.name ?? '').toLowerCase().includes(term) ||
        (g.contact.original_email ?? '').toLowerCase().includes(term) ||
        (g.contact.original_phone ?? '').includes(term)
    );
  }, [groups, search]);

  const stats: CrmLeadStats | null = events && sales ? computeCrmLeadStats(events, sales) : null;
  const ticketMedio = sales && sales.length > 0 ? sales.reduce((a, s) => a + (s.amount ?? 0), 0) / sales.length : 0;
  const repeatCount = groups.filter((g) => g.events.length > 1).length;
  const leadPageCount = Math.max(1, Math.ceil(visibleGroups.length / leadPageSize));
  const pagedLeadGroups = visibleGroups.slice((leadPage - 1) * leadPageSize, leadPage * leadPageSize);
  const salesPageCount = Math.max(1, Math.ceil((sales?.length ?? 0) / salesPageSize));
  const pagedSales = (sales ?? []).slice((salesPage - 1) * salesPageSize, salesPage * salesPageSize);
  const eventById = useMemo(() => new Map((events ?? []).map((event) => [event.id, event])), [events]);
  const eventsByContact = useMemo(() => {
    const grouped = new Map<string, LeadEventRow[]>();
    for (const event of events ?? []) {
      const rows = grouped.get(event.contact_id) ?? [];
      rows.push(event);
      grouped.set(event.contact_id, rows);
    }
    for (const rows of grouped.values()) rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    return grouped;
  }, [events]);
  const dynamicSaleColumns = useMemo(() => {
    const columns = new Map<string, { key: string; label: string; source: 'custom' | 'raw' }>();
    customSaleFields.forEach((field) => columns.set(`custom:${field.field_key}`, { key: field.field_key, label: field.label, source: 'custom' }));
    for (const sale of sales ?? []) {
      if (!sale.external_sale_id?.startsWith('csv-') || !sale.raw_payload || typeof sale.raw_payload !== 'object' || Array.isArray(sale.raw_payload)) continue;
      for (const [key, value] of Object.entries(sale.raw_payload)) {
        if (key === 'tipo' || value == null || value === '' || typeof value === 'object') continue;
        if (!columns.has(`custom:${key}`)) columns.set(`raw:${key}`, { key, label: key.charAt(0).toUpperCase() + key.slice(1), source: 'raw' });
      }
    }
    return Array.from(columns.values());
  }, [customSaleFields, sales]);

  if (tab === 'leads' && events === null) return <LoadingView label={leadScope === 'all' ? 'Carregando todo o histórico de leads...' : 'Carregando leads do período...'} />;
  if (tab === 'vendas' && sales === null) return <LoadingView label={salesScope === 'all' ? 'Carregando todo o histórico de vendas...' : 'Carregando vendas do período...'} />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Leads & Vendas — {project.name}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Dados reais recebidos pelo webhook — de quem entrou como lead até quem converteu em venda
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <button type="button" onClick={() => setShowLeadImport(true)} className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/8 px-3 py-2 text-sm font-medium text-emerald-300 hover:border-emerald-400"><Upload size={15} /> Importar leads CSV</button>}
          {canManage && <button type="button" onClick={() => setShowSalesImport(true)} className="flex items-center gap-2 rounded-lg border border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)] px-3 py-2 text-sm font-medium text-[var(--color-brand)] hover:border-[var(--color-brand)]"><Upload size={15} /> Importar vendas CSV</button>}
          {isAdmin && <Link to="/agency/disparo/higienizador" className="flex items-center gap-2 rounded-lg border border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)] px-3 py-2 text-sm font-medium text-[var(--color-brand)] hover:border-[var(--color-brand)]"><WandSparkles size={15} /> Higienizar lista de contatos</Link>}
        </div>
      </div>

      {showInfo && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--color-info-soft)] bg-[var(--color-info-soft)] p-4 text-sm">
          <Info size={16} className="mt-0.5 shrink-0 text-[var(--color-info)]" />
          <div className="flex-1 text-[var(--color-text)]">
            <p className="font-medium">Contato único, várias entradas</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              A mesma pessoa (mesmo telefone ou e-mail) não duplica: cada cadastro novo vira uma
              entrada no histórico dela, mantendo a atribuição original de campanha/anúncio.
              Configure o webhook em Configurações para começar a receber leads e vendas reais.
            </p>
          </div>
          <button
            onClick={() => setShowInfo(false)}
            className="text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
          >
            fechar
          </button>
        </div>
      )}

      <div className="flex gap-1 border-b border-[var(--color-border)]">
        <TabButton active={tab === 'leads'} onClick={() => setTab('leads')} label={`Leads (${visibleGroups.length})`} />
        <TabButton active={tab === 'vendas'} onClick={() => setTab('vendas')} label={`Vendas (${sales?.length ?? 0})`} />
      </div>

      {tab === 'leads' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3"><div><p className="text-xs font-medium text-[var(--color-text)]">Visualização dos leads</p><p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{leadScope === 'all' ? 'Mostrando todos os contatos e todas as entradas deste projeto.' : `Período: ${dateRange.start} até ${dateRange.end}.`}</p></div><div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] p-1"><button type="button" onClick={() => setLeadScope('all')} className={`rounded-md px-3 py-1.5 text-xs ${leadScope === 'all' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}>Todos os leads</button><button type="button" onClick={() => setLeadScope('period')} className={`rounded-md px-3 py-1.5 text-xs ${leadScope === 'period' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}>Período selecionado</button></div></div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2">
              <Search size={14} className="text-[var(--color-text-faint)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, email ou telefone"
                className="w-56 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
              />
            </div>
            {repeatCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-info-soft)] px-3 py-1.5 text-xs text-[var(--color-info)]">
                <Repeat size={12} /> {repeatCount} lead{repeatCount > 1 ? 's' : ''} com mais de uma entrada
              </span>
            )}
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-xs text-[var(--color-text-muted)]">{formatNumber(events?.length ?? 0)} entradas totais</span>
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-xs text-[var(--color-text-muted)]">{formatNumber(visibleGroups.length)} contatos únicos</span>
            <label className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-muted)]">Linhas por página<select value={leadPageSize} onChange={(event) => setLeadPageSize(Number(event.target.value))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[var(--color-text)]"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={250}>250</option></select></label>
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                  <th className="pb-3">Lead</th>
                  <th className="pb-3">Contato</th>
                  <th className="pb-3">Origem</th>
                  <th className="pb-3">Última entrada</th>
                  <th className="pb-3 text-right">Entradas</th>
                </tr>
              </thead>
              <tbody>
                {pagedLeadGroups.map((g) => {
                  const last = g.events[0];
                  return (
                    <tr
                      key={g.contact.id}
                      onClick={() => setOpenContact(g)}
                      className="cursor-pointer border-b border-[var(--color-border-soft)] hover:bg-[var(--color-panel-2)]"
                    >
                      <td className="py-3 text-[var(--color-text)]">{g.contact.name || '—'}</td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        <p>{g.contact.original_email ?? '—'}</p>
                        <p className="text-[11px] text-[var(--color-text-faint)]">
                          {g.contact.original_phone ?? '—'}
                        </p>
                      </td>
                      <td className="py-3">
                        {last?.utm_campaign || last?.utm_source ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-[var(--color-text)]">
                              {last.utm_campaign ? `utm_campaign=${last.utm_campaign}` : ''}
                            </span>
                            <span className="text-[10px] text-[var(--color-text-faint)]">
                              {last.utm_source} {last.utm_medium ? `· ${last.utm_medium}` : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="rounded-full bg-[var(--color-panel-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                            sem UTM
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        {last ? new Date(last.occurred_at).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                            (g.events.length > 1
                              ? 'bg-[var(--color-info-soft)] text-[var(--color-info)]'
                              : 'bg-[var(--color-panel-2)] text-[var(--color-text-muted)]')
                          }
                        >
                          {g.events.length > 1 && <Repeat size={10} />}
                          {g.events.length}x
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {visibleGroups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                      Nenhum lead recebido no período. Configure o webhook em Configurações.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-[var(--color-text-muted)]">Mostrando {visibleGroups.length === 0 ? 0 : (leadPage - 1) * leadPageSize + 1}–{Math.min(leadPage * leadPageSize, visibleGroups.length)} de {visibleGroups.length} contatos únicos</span><div className="flex items-center gap-2"><button type="button" disabled={leadPage <= 1} onClick={() => setLeadPage((page) => page - 1)} className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] disabled:opacity-30"><ChevronLeft size={14} /></button><span className="text-xs text-[var(--color-text-muted)]">Página {leadPage} de {leadPageCount}</span><button type="button" disabled={leadPage >= leadPageCount} onClick={() => setLeadPage((page) => page + 1)} className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] disabled:opacity-30"><ChevronRight size={14} /></button></div></div>
        </>
      )}

      {tab === 'vendas' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3"><div><p className="text-xs font-medium text-[var(--color-text)]">Visualização das vendas</p><p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{salesScope === 'all' ? 'Mostrando todo o histórico deste projeto.' : `Período: ${dateRange.start} até ${dateRange.end}.`}</p></div><div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] p-1"><button type="button" onClick={() => setSalesScope('all')} className={`rounded-md px-3 py-1.5 text-xs ${salesScope === 'all' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}>Todas as vendas</button><button type="button" onClick={() => setSalesScope('period')} className={`rounded-md px-3 py-1.5 text-xs ${salesScope === 'period' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}>Período selecionado</button></div></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile label="Total Vendido" value={formatBRL(stats?.revenue ?? 0)} accent="var(--color-good)" />
            <SummaryTile label="Ticket Médio" value={formatBRL(ticketMedio)} />
            <SummaryTile label="Vendas no Período" value={formatNumber(sales?.length ?? 0)} />
            <SummaryTile
              label="Taxa Lead → Venda"
              value={formatPercent(stats?.percentConverted ?? 0)}
              accent="var(--color-info)"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-text-muted)]"><span>Mostrando {(sales?.length ?? 0) === 0 ? 0 : (salesPage - 1) * salesPageSize + 1}–{Math.min(salesPage * salesPageSize, sales?.length ?? 0)} de {sales?.length ?? 0} vendas</span><label className="flex items-center gap-2">Linhas por página<select value={salesPageSize} onChange={(event) => setSalesPageSize(Number(event.target.value))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[var(--color-text)]"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={250}>250</option></select></label></div>
          <Card className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: 1080 + dynamicSaleColumns.length * 170 }}>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                  <th className="pb-3">Contato</th>
                  <th className="px-3 pb-3">E-mail</th>
                  <th className="px-3 pb-3">WhatsApp</th>
                  <th className="pb-3">Fechamento</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Vendedor</th>
                  <th className="px-3 pb-3">Campanha atribuída</th>
                  <th className="px-3 pb-3">Forma de pagamento</th>
                  <th className="pb-3 text-right">Valor</th>
                  {dynamicSaleColumns.map((field) => <th key={`${field.source}:${field.key}`} className="px-3 pb-3">{field.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {pagedSales.map((sale) => {
                  const contact = contacts.find((c) => c.id === sale.contact_id);
                  const attributedEvent = (sale.lead_event_id ? eventById.get(sale.lead_event_id) : undefined)
                    ?? eventsByContact.get(sale.contact_id)?.find((event) => event.occurred_at <= sale.sold_at);
                  return (
                    <tr key={sale.id} className="border-b border-[var(--color-border-soft)]">
                      <td className="py-3 text-[var(--color-text)]">{contact?.name || '—'}</td>
                      <td className="max-w-56 truncate px-3 py-3 text-xs text-[var(--color-text-muted)]" title={contact?.original_email ?? ''}>{contact?.original_email || '—'}</td>
                      <td className="px-3 py-3 text-xs text-[var(--color-text-muted)]">{contact?.original_phone || '—'}</td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        {new Date(sale.sold_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="py-3 text-[var(--color-text-muted)]">{sale.status}</td>
                      <td className="py-3">
                        {canManage ? (
                          <select
                            value={sale.seller_id ?? ''}
                            onChange={(e) => handleAssignSeller(sale.id, e.target.value)}
                            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-text)]"
                          >
                            <option value="">— sem vendedor —</option>
                            {sellers.map((seller) => (
                              <option key={seller.id} value={seller.id}>
                                {seller.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {sellers.find((s) => s.id === sale.seller_id)?.name ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="max-w-56 px-3 py-3 text-xs">
                        {attributedEvent?.utm_campaign || attributedEvent?.campaign_id ? (
                          <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-1 text-[var(--color-good)]" title={attributedEvent.utm_source ?? ''}>
                            {attributedEvent.utm_campaign || attributedEvent.campaign_id}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-faint)]">Sem atribuição</span>
                        )}
                      </td>
                      <td className="max-w-56 truncate px-3 py-3 text-xs text-[var(--color-text-muted)]" title={sale.payment_method ?? ''}>{sale.payment_method || '—'}</td>
                      <td className="py-3 text-right font-medium text-[var(--color-good)]">
                        {sale.amount != null ? formatBRL(sale.amount) : '—'}
                      </td>
                      {dynamicSaleColumns.map((field) => { const source = field.source === 'custom' ? sale.custom_fields : sale.raw_payload; const values = source && typeof source === 'object' && !Array.isArray(source) ? source as Record<string, unknown> : {}; return <td key={`${field.source}:${field.key}`} className="max-w-48 truncate px-3 py-3 text-xs text-[var(--color-text-muted)]" title={String(values[field.key] ?? '')}>{String(values[field.key] ?? '—')}</td>; })}
                    </tr>
                  );
                })}
                {(sales?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={9 + dynamicSaleColumns.length} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                      Nenhuma venda registrada no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-end gap-2"><button type="button" disabled={salesPage <= 1} onClick={() => setSalesPage((page) => page - 1)} className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] disabled:opacity-30"><ChevronLeft size={14} /></button><span className="text-xs text-[var(--color-text-muted)]">Página {salesPage} de {salesPageCount}</span><button type="button" disabled={salesPage >= salesPageCount} onClick={() => setSalesPage((page) => page + 1)} className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] disabled:opacity-30"><ChevronRight size={14} /></button></div>
        </>
      )}

      {openContact && (
        <RealLeadHistoryModal
          contact={openContact.contact}
          events={openContact.events}
          sales={openContact.sales}
          onClose={() => setOpenContact(null)}
        />
      )}
      {showSalesImport && <SalesImportModal onClose={() => setShowSalesImport(false)} onImported={(range) => { setTab('vendas'); setCustomRange(range.start, range.end); setReloadToken((value) => value + 1); }} />}
      {showLeadImport && <LeadImportModal onClose={() => setShowLeadImport(false)} onImported={(range) => { setTab('leads'); setLeadScope('period'); setCustomRange(range.start, range.end); setReloadToken((value) => value + 1); }} />}
    </div>
  );
}

function mergeContacts(current: ContactRow[], incoming: ContactRow[]) {
  const byId = new Map(current.map((contact) => [contact.id, contact]));
  incoming.forEach((contact) => byId.set(contact.id, contact));
  return Array.from(byId.values());
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
        (active
          ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]')
      }
    >
      {label}
    </button>
  );
}

function SummaryTile({ label, value, accent = 'var(--color-text)' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
