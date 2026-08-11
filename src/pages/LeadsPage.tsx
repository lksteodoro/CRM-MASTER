import { useEffect, useMemo, useState } from 'react';
import { Search, Info, Repeat } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import {
  listLeadEvents,
  listSales,
  listContactsByIds,
  computeCrmLeadStats,
  assignSeller,
  type CrmLeadStats,
} from '../services/crmLeads.service';
import { listSellers } from '../services/sellers.service';
import { formatBRL, formatNumber, formatPercent } from '../lib/format';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';
import { RealLeadHistoryModal } from '../components/leads/RealLeadHistoryModal';
import type { ContactRow, LeadEventRow, SaleRow, SellerRow } from '../integrations/supabase/database.types';

interface ContactGroup {
  contact: ContactRow;
  events: LeadEventRow[];
  sales: SaleRow[];
}

export function LeadsPage() {
  const { isAdmin } = useAuth();
  const { project, permissions } = useProject();
  const { dateRange } = useFilters();
  const canManage = isAdmin || permissions.can_edit_settings;
  const [tab, setTab] = useState<'leads' | 'vendas'>('leads');
  const [search, setSearch] = useState('');
  const [showInfo, setShowInfo] = useState(true);

  const [events, setEvents] = useState<LeadEventRow[] | null>(null);
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [openContact, setOpenContact] = useState<ContactGroup | null>(null);

  useEffect(() => {
    let active = true;
    setEvents(null);
    setSales(null);
    (async () => {
      const range = { since: dateRange.start, until: dateRange.end };
      const [leadEvents, saleRows] = await Promise.all([
        listLeadEvents(project.id, range),
        listSales(project.id, range),
      ]);
      if (!active) return;
      setEvents(leadEvents);
      setSales(saleRows);
      const ids = Array.from(new Set(leadEvents.map((e) => e.contact_id)));
      setContacts(await listContactsByIds(ids));
    })();
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end]);

  useEffect(() => {
    let active = true;
    void listSellers(project.client_id, { activeOnly: true }).then((rows) => {
      if (active) setSellers(rows);
    });
    return () => {
      active = false;
    };
  }, [project.client_id]);

  async function handleAssignSeller(saleId: string, sellerId: string) {
    await assignSeller(saleId, sellerId || null);
    setSales((prev) => (prev ? prev.map((s) => (s.id === saleId ? { ...s, seller_id: sellerId || null } : s)) : prev));
  }

  const groups = useMemo<ContactGroup[]>(() => {
    if (!events || !sales) return [];
    const byContact = new Map<string, ContactGroup>();
    for (const contact of contacts) {
      byContact.set(contact.id, { contact, events: [], sales: [] });
    }
    for (const e of events) {
      byContact.get(e.contact_id)?.events.push(e);
    }
    for (const s of sales) {
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
    if (!term) return groups;
    return groups.filter(
      (g) =>
        (g.contact.name ?? '').toLowerCase().includes(term) ||
        (g.contact.original_email ?? '').toLowerCase().includes(term) ||
        (g.contact.original_phone ?? '').includes(term)
    );
  }, [groups, search]);

  const stats: CrmLeadStats | null = events && sales ? computeCrmLeadStats(events, sales) : null;
  const ticketMedio = sales && sales.length > 0 ? sales.reduce((a, s) => a + (s.amount ?? 0), 0) / sales.length : 0;
  const repeatCount = groups.filter((g) => g.events.length > 1).length;

  if (events === null || sales === null) return <LoadingView label="Carregando leads..." />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Leads & Vendas — {project.name}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Dados reais recebidos pelo webhook — de quem entrou como lead até quem converteu em venda
        </p>
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
        <TabButton active={tab === 'vendas'} onClick={() => setTab('vendas')} label={`Vendas (${sales.length})`} />
      </div>

      {tab === 'leads' && (
        <>
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
                {visibleGroups.slice(0, 100).map((g) => {
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
        </>
      )}

      {tab === 'vendas' && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile label="Total Vendido" value={formatBRL(stats?.revenue ?? 0)} accent="var(--color-good)" />
            <SummaryTile label="Ticket Médio" value={formatBRL(ticketMedio)} />
            <SummaryTile label="Vendas no Período" value={formatNumber(sales.length)} />
            <SummaryTile
              label="Taxa Lead → Venda"
              value={formatPercent(stats?.percentConverted ?? 0)}
              accent="var(--color-info)"
            />
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                  <th className="pb-3">Contato</th>
                  <th className="pb-3">Fechamento</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Vendedor</th>
                  <th className="pb-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 100).map((sale) => {
                  const contact = contacts.find((c) => c.id === sale.contact_id);
                  return (
                    <tr key={sale.id} className="border-b border-[var(--color-border-soft)]">
                      <td className="py-3 text-[var(--color-text)]">{contact?.name || '—'}</td>
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
                      <td className="py-3 text-right font-medium text-[var(--color-good)]">
                        {sale.amount != null ? formatBRL(sale.amount) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {sales.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                      Nenhuma venda registrada no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
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
    </div>
  );
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
