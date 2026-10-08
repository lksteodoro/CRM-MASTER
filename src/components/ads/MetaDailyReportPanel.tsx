import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Loader2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { metaGetAll } from '../../lib/metaGraph';
import {
  addTrackedCampaign,
  getDailyReport,
  getReportState,
  listReportDates,
  listTrackedCampaigns,
  removeTrackedCampaign,
  runDailyReportNow,
  setTrackedCampaignActive,
  summarizeByCurrency,
  type DailyCampaignRow,
  type ReportState,
  type TrackedCampaign,
} from '../../services/metaDailyReport.service';
import { EmptyView, ErrorView, LoadingView } from '../ui/StateView';

type AdAccount = { id: string; name?: string; business?: { id?: string; name?: string } };
type LiveCampaign = { id: string; name?: string; effective_status?: string };

const inputClass =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';

const stripAct = (id: string) => id.replace(/^act_/, '');

function money(value: number | null, currency = 'BRL') {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dateLabel(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function dateTimeLabel(iso: string | null) {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
}

/** Aba "Resumo diário" da página Meta Ads. */
export function MetaDailyReportPanel() {
  const [tracked, setTracked] = useState<TrackedCampaign[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<DailyCampaignRow[]>([]);
  const [state, setState] = useState<ReportState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [managing, setManaging] = useState(false);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountFilter, setAccountFilter] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [liveCampaigns, setLiveCampaigns] = useState<Record<string, LiveCampaign[]>>({});
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [busyCampaign, setBusyCampaign] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    setError(null);
    try {
      const [trackedRows, availableDates, reportState] = await Promise.all([
        listTrackedCampaigns(),
        listReportDates(),
        getReportState(),
      ]);
      setTracked(trackedRows);
      setDates(availableDates);
      setState(reportState);
      setDate((current) => (current && availableDates.includes(current) ? current : availableDates[0] ?? ''));
      // Sem campanha escolhida ainda: abre direto a seleção.
      if (trackedRows.length === 0) setManaging(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o resumo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!date) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoadingRows(true);
    getDailyReport(date)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o dia.');
      })
      .finally(() => {
        if (!cancelled) setLoadingRows(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Contas de anúncio só são listadas quando o operador abre a seleção.
  useEffect(() => {
    if (!managing || accounts.length > 0) return;
    let cancelled = false;
    setLoadingAccounts(true);
    metaGetAll<AdAccount>('me/adaccounts', { fields: 'id,name,business{id,name}', limit: 200 })
      .then((result) => {
        if (!cancelled) setAccounts(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Não foi possível listar as contas de anúncio.');
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [managing, accounts.length]);

  async function loadCampaigns(accountIds: string[]) {
    setLoadingCampaigns(true);
    setError(null);
    try {
      const entries = await Promise.all(
        accountIds.map(async (id) => {
          const list = await metaGetAll<LiveCampaign>(`${id}/campaigns`, {
            fields: 'id,name,effective_status',
            limit: 200,
            filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
          });
          return [id, list] as const;
        }),
      );
      setLiveCampaigns((current) => ({ ...current, ...Object.fromEntries(entries) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível listar as campanhas.');
    } finally {
      setLoadingCampaigns(false);
    }
  }

  function toggleAccount(id: string) {
    const next = selectedAccounts.includes(id) ? selectedAccounts.filter((item) => item !== id) : [...selectedAccounts, id];
    setSelectedAccounts(next);
    const missing = next.filter((item) => !liveCampaigns[item]);
    if (missing.length > 0) void loadCampaigns(missing);
  }

  const trackedByCampaign = useMemo(() => new Map(tracked.map((item) => [item.campaign_id, item])), [tracked]);

  async function toggleCampaign(account: AdAccount, campaign: LiveCampaign) {
    setBusyCampaign(campaign.id);
    setError(null);
    try {
      const current = trackedByCampaign.get(campaign.id);
      if (current) await removeTrackedCampaign(current.id);
      else {
        await addTrackedCampaign({
          bm_id: account.business?.id ?? null,
          bm_name: account.business?.name ?? null,
          ad_account_id: stripAct(account.id),
          ad_account_name: account.name ?? account.id,
          campaign_id: campaign.id,
          campaign_name: campaign.name ?? campaign.id,
        });
      }
      setTracked(await listTrackedCampaigns());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a seleção.');
    } finally {
      setBusyCampaign(null);
    }
  }

  async function toggleTrackedActive(item: TrackedCampaign) {
    setBusyCampaign(item.campaign_id);
    setError(null);
    try {
      await setTrackedCampaignActive(item.id, !item.active);
      setTracked(await listTrackedCampaigns());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a seleção.');
    } finally {
      setBusyCampaign(null);
    }
  }

  async function removeTracked(item: TrackedCampaign) {
    setBusyCampaign(item.campaign_id);
    setError(null);
    try {
      await removeTrackedCampaign(item.id);
      setTracked(await listTrackedCampaigns());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível remover a campanha.');
    } finally {
      setBusyCampaign(null);
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runDailyReportNow();
      setNotice(
        result.errors.length > 0
          ? `Resumo gerado com avisos: ${result.errors.join(' | ')}`
          : `Resumo de ontem atualizado (${result.campaigns} campanha${result.campaigns === 1 ? '' : 's'}).`,
      );
      await loadBase();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível gerar o resumo.');
    } finally {
      setRunning(false);
    }
  }

  const visibleAccounts = useMemo(() => {
    const term = accountFilter.trim().toLowerCase();
    return accounts.filter((account) =>
      term ? `${account.name ?? ''} ${account.business?.name ?? ''} ${account.id}`.toLowerCase().includes(term) : true,
    );
  }, [accounts, accountFilter]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (a.ad_account_name ?? '').localeCompare(b.ad_account_name ?? '') || b.spend - a.spend),
    [rows],
  );
  const totals = useMemo(() => summarizeByCurrency(rows), [rows]);
  const activeCount = tracked.filter((item) => item.active).length;

  if (loading) return <LoadingView label="Carregando o resumo diário..." />;
  if (error && tracked.length === 0 && dates.length === 0 && !managing) return <ErrorView message={error} onRetry={() => void loadBase()} />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-[var(--color-brand)]" />
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Resumo diário de leads</h2>
          </div>
          <p className="mt-1 max-w-xl text-xs text-[var(--color-text-muted)]">
            Todo dia às 8h30 o sistema busca na Meta o gasto, os leads e o custo por lead de ontem das campanhas que você escolher abaixo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setManaging((open) => !open)}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
          >
            <Plus size={14} /> {managing ? 'Fechar seleção' : 'Escolher campanhas'}
          </button>
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={running || activeCount === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Atualizar agora
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          {notice}
        </p>
      )}

      {managing && (
        <section aria-label="Escolher campanhas" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 sm:p-5">
          <h2 className="font-semibold text-[var(--color-text)]">Campanhas do resumo</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Marque as contas de anúncio, depois as campanhas ativas que devem aparecer no resumo de amanhã. Desmarcar tira a campanha do resumo.
          </p>

          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
                <input
                  value={accountFilter}
                  onChange={(event) => setAccountFilter(event.target.value)}
                  placeholder="Buscar conta ou BM"
                  aria-label="Buscar conta de anúncio ou BM"
                  className={clsx(inputClass, 'w-full pl-9')}
                />
              </div>
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-[var(--color-border-soft)] p-1">
                {loadingAccounts && <LoadingView label="Listando contas..." />}
                {!loadingAccounts && visibleAccounts.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">Nenhuma conta encontrada.</p>
                )}
                {visibleAccounts.map((account) => {
                  const checked = selectedAccounts.includes(account.id);
                  return (
                    <label
                      key={account.id}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                        checked ? 'bg-[var(--color-brand-soft)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]',
                      )}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleAccount(account.id)} />
                      <span className="min-w-0 flex-1 truncate">{account.name || account.id}</span>
                      {account.business?.name && <span className="truncate text-[10px] text-[var(--color-text-faint)]">{account.business.name}</span>}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              {loadingCampaigns && <LoadingView label="Buscando campanhas ativas..." />}
              {!loadingCampaigns && selectedAccounts.length === 0 && (
                <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-xs text-[var(--color-text-muted)]">
                  Selecione uma ou mais contas para listar as campanhas ativas.
                </p>
              )}
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {selectedAccounts.map((accountId) => {
                  const account = accounts.find((item) => item.id === accountId);
                  const list = liveCampaigns[accountId];
                  if (!account || !list) return null;
                  return (
                    <div key={accountId}>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">{account.name || account.id}</p>
                      {list.length === 0 && <p className="px-2 py-1 text-xs text-[var(--color-text-muted)]">Nenhuma campanha ativa.</p>}
                      {list.map((campaign) => {
                        const on = trackedByCampaign.has(campaign.id);
                        return (
                          <label key={campaign.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]">
                            <input type="checkbox" checked={on} disabled={busyCampaign === campaign.id} onChange={() => void toggleCampaign(account, campaign)} />
                            <span className="min-w-0 flex-1 truncate">{campaign.name || campaign.id}</span>
                            {on && <Check size={12} className="text-[var(--color-good)]" />}
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {tracked.length > 0 && (
            <div className="mt-5 border-t border-[var(--color-border-soft)] pt-4">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                No resumo ({activeCount} ativa{activeCount === 1 ? '' : 's'} de {tracked.length})
              </h3>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {tracked.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-md bg-[var(--color-bg)] px-2 py-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={item.active}
                      disabled={busyCampaign === item.campaign_id}
                      onChange={() => void toggleTrackedActive(item)}
                      aria-label={`Incluir ${item.campaign_name ?? item.campaign_id} no resumo`}
                    />
                    <span className={clsx('min-w-0 flex-1 truncate', item.active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)] line-through')}>
                      {item.campaign_name ?? item.campaign_id}
                      <span className="ml-1 text-[10px] text-[var(--color-text-faint)]">· {item.ad_account_name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeTracked(item)}
                      disabled={busyCampaign === item.campaign_id}
                      aria-label={`Remover ${item.campaign_name ?? item.campaign_id}`}
                      className="text-[var(--color-text-faint)] hover:text-[var(--color-bad)]"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-label="Resumo do dia" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="report-date" className="text-xs text-[var(--color-text-muted)]">
              Dia
            </label>
            <select id="report-date" value={date} onChange={(event) => setDate(event.target.value)} disabled={dates.length === 0} className={inputClass}>
              {dates.length === 0 && <option value="">Sem resumo ainda</option>}
              {dates.map((item) => (
                <option key={item} value={item}>
                  {dateLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Última atualização: {dateTimeLabel(state?.last_run_at ?? null)}
            {state?.last_status === 'error' && <span className="ml-2 text-[var(--color-bad)]">com erro</span>}
          </p>
        </div>

        {state?.last_error && (
          <p role="alert" className="rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">
            {state.last_error}
          </p>
        )}

        {loadingRows && <LoadingView label="Carregando o dia..." />}

        {!loadingRows && dates.length === 0 && (
          <EmptyView
            title="O primeiro resumo ainda não foi gerado"
            description={
              activeCount === 0
                ? 'Escolha as campanhas acima. O resumo sai automaticamente amanhã às 8h30, ou clique em Atualizar agora para ver o de ontem.'
                : 'Clique em Atualizar agora para ver o de ontem, ou aguarde as 8h30 de amanhã.'
            }
          />
        )}

        {!loadingRows && rows.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {totals.map((total) => (
                <div key={total.currency} className="contents">
                  <Stat label={`Gasto${totals.length > 1 ? ` (${total.currency})` : ''}`} value={money(total.spend, total.currency)} />
                  <Stat label="Leads" value={String(total.leads)} />
                  <Stat label="Custo por lead" value={money(total.costPerLead, total.currency)} />
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-soft)] text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                    <th className="px-4 py-3 font-bold">Campanha</th>
                    <th className="px-4 py-3 font-bold">Conta</th>
                    <th className="px-4 py-3 text-right font-bold">Gasto</th>
                    <th className="px-4 py-3 text-right font-bold">Leads</th>
                    <th className="px-4 py-3 text-right font-bold">Custo/lead</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.campaign_id} className="border-b border-[var(--color-border-soft)] last:border-0">
                      <td className="max-w-[320px] px-4 py-3 text-[var(--color-text)]">
                        <span className="block truncate" title={row.campaign_name ?? ''}>{row.campaign_name ?? row.campaign_id}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {row.ad_account_name}
                        {row.bm_name && <span className="block text-[10px] text-[var(--color-text-faint)]">{row.bm_name}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{money(row.spend, row.currency ?? 'BRL')}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{row.leads}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">
                        {row.cost_per_lead == null ? <span className="text-[var(--color-text-faint)]">sem leads</span> : money(row.cost_per_lead, row.currency ?? 'BRL')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loadingRows && dates.length > 0 && rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-xs text-[var(--color-text-muted)]">
            Nenhuma campanha neste dia.
          </p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]">{value}</p>
    </div>
  );
}

