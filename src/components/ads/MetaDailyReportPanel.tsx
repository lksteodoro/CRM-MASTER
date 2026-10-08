import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Loader2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { metaGetAll } from '../../lib/metaGraph';
import { buildAccountDays, totalsOf, type DayRow } from '../../lib/metaReportMath';
import {
  addTrackedCampaign,
  getReportState,
  listAccountGoals,
  listCrmLeads,
  listDailyRows,
  listTrackedCampaigns,
  removeTrackedCampaign,
  runDailyReportNow,
  setAccountGoal,
  setCrmLeads,
  setTrackedCampaignActive,
  type CrmLeadsRow,
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
const HISTORY_DAYS = 90;
const PERIODS = [7, 14, 30, 90] as const;
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function money(value: number | null, currency = 'BRL') {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function dayLabel(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

function dateTimeLabel(iso: string | null) {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
}

/** Campo numérico que grava ao sair do campo (ou no Enter). Vazio limpa o valor. */
function NumberCell({
  value,
  onCommit,
  label,
  className,
}: {
  value: number | null;
  onCommit: (next: number | null) => void;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setDraft(value == null ? '' : String(value));
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Math.max(0, Math.floor(Number(trimmed)));
    if (next !== null && Number.isNaN(next)) {
      setDraft(value == null ? '' : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className={clsx(
        'w-20 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-2 py-1 text-right text-sm tabular-nums text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60',
        className,
      )}
    />
  );
}

type AccountView = {
  accountId: string;
  name: string;
  bm: string;
  currency: string;
  goal: number | null;
  days: DayRow[]; // ordem crescente, histórico completo carregado
  campaigns: { id: string; name: string; spend: number; leads: number }[]; // no período
};

export function MetaDailyReportPanel() {
  const [tracked, setTracked] = useState<TrackedCampaign[]>([]);
  const [daily, setDaily] = useState<DailyCampaignRow[]>([]);
  const [crm, setCrm] = useState<CrmLeadsRow[]>([]);
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [state, setState] = useState<ReportState | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());

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
      const since = isoDaysAgo(HISTORY_DAYS);
      const [trackedRows, dailyRows, crmRows, goalMap, reportState] = await Promise.all([
        listTrackedCampaigns(),
        listDailyRows(since),
        listCrmLeads(since),
        listAccountGoals(),
        getReportState(),
      ]);
      setTracked(trackedRows);
      setDaily(dailyRows);
      setCrm(crmRows);
      setGoals(goalMap);
      setState(reportState);
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

  async function runNow(days: number) {
    setRunning(days);
    setError(null);
    setNotice(null);
    try {
      const result = await runDailyReportNow(days);
      setNotice(
        result.errors.length > 0
          ? `Resumo gerado com avisos: ${result.errors.join(' | ')}`
          : `Resumo atualizado: ${result.campaigns} campanha${result.campaigns === 1 ? '' : 's'}, últimos ${days} dia${days === 1 ? '' : 's'}.`,
      );
      await loadBase();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível gerar o resumo.');
    } finally {
      setRunning(null);
    }
  }

  async function saveCrm(accountId: string, date: string, value: number | null) {
    setError(null);
    const previous = crm;
    // Atualiza na hora; se o servidor recusar, volta ao valor anterior.
    setCrm((current) => {
      const rest = current.filter((row) => !(row.ad_account_id === accountId && row.report_date === date));
      return value == null ? rest : [...rest, { ad_account_id: accountId, report_date: date, crm_leads: value }];
    });
    try {
      await setCrmLeads(accountId, date, value);
    } catch (caught) {
      setCrm(previous);
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar os leads do CRM.');
    }
  }

  async function saveGoal(accountId: string, value: number | null) {
    setError(null);
    const previous = goals;
    setGoals((current) => {
      const next = { ...current };
      if (value == null) delete next[accountId];
      else next[accountId] = value;
      return next;
    });
    try {
      await setAccountGoal(accountId, value);
    } catch (caught) {
      setGoals(previous);
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a meta diária.');
    }
  }

  // Uma visão por conta de anúncio (projeto): soma as campanhas escolhidas de cada dia.
  const views = useMemo<{ bm: string; accounts: AccountView[] }[]>(() => {
    const crmByKey = new Map(crm.map((row) => [`${row.ad_account_id}|${row.report_date}`, row.crm_leads]));
    const ids = new Set<string>([...tracked.map((item) => item.ad_account_id), ...daily.map((row) => row.ad_account_id)]);
    const cutoff = isoDaysAgo(period);

    const built: AccountView[] = [...ids].map((accountId) => {
      const accountRows = daily.filter((row) => row.ad_account_id === accountId);
      const meta = tracked.find((item) => item.ad_account_id === accountId);
      const byDate = new Map<string, { spend: number; metaLeads: number }>();
      for (const row of accountRows) {
        const day = byDate.get(row.report_date) ?? { spend: 0, metaLeads: 0 };
        day.spend += row.spend;
        day.metaLeads += row.leads;
        byDate.set(row.report_date, day);
      }
      const goal = goals[accountId] ?? null;
      const days = buildAccountDays(
        [...byDate.entries()].map(([date, day]) => ({
          date,
          spend: day.spend,
          metaLeads: day.metaLeads,
          crmLeads: crmByKey.get(`${accountId}|${date}`) ?? null,
        })),
        goal,
      );

      const perCampaign = new Map<string, { id: string; name: string; spend: number; leads: number }>();
      for (const row of accountRows.filter((item) => item.report_date >= cutoff)) {
        const current = perCampaign.get(row.campaign_id) ?? { id: row.campaign_id, name: row.campaign_name ?? row.campaign_id, spend: 0, leads: 0 };
        current.spend += row.spend;
        current.leads += row.leads;
        perCampaign.set(row.campaign_id, current);
      }

      return {
        accountId,
        name: meta?.ad_account_name ?? accountRows[0]?.ad_account_name ?? accountId,
        bm: meta?.bm_name ?? accountRows[0]?.bm_name ?? 'Sem BM',
        currency: accountRows.find((row) => row.currency)?.currency ?? 'BRL',
        goal,
        days,
        campaigns: [...perCampaign.values()].sort((a, b) => b.spend - a.spend),
      };
    });

    const byBm = new Map<string, AccountView[]>();
    for (const view of built) byBm.set(view.bm, [...(byBm.get(view.bm) ?? []), view]);
    return [...byBm.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bm, list]) => ({ bm, accounts: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [tracked, daily, crm, goals, period]);

  const visibleAccounts = useMemo(() => {
    const term = accountFilter.trim().toLowerCase();
    return accounts.filter((account) =>
      term ? `${account.name ?? ''} ${account.business?.name ?? ''} ${account.id}`.toLowerCase().includes(term) : true,
    );
  }, [accounts, accountFilter]);

  const activeCount = tracked.filter((item) => item.active).length;
  const hasData = daily.length > 0;

  if (loading) return <LoadingView label="Carregando o resumo diário..." />;
  if (error && tracked.length === 0 && !hasData && !managing) return <ErrorView message={error} onRetry={() => void loadBase()} />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-[var(--color-brand)]" />
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Resumo diário de leads</h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-text-muted)]">
            Cada conta de anúncio é um projeto, separado por BM. Todo dia às 8h30 o sistema traz o custo e os leads do gerenciador; você lança os leads do CRM nos campos amarelos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setManaging((open) => !open)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
          >
            <Plus size={14} /> {managing ? 'Fechar seleção' : 'Escolher campanhas'}
          </button>
          <button
            type="button"
            onClick={() => void runNow(30)}
            disabled={running !== null || activeCount === 0}
            title="Busca os últimos 30 dias na Meta, útil na primeira vez para montar o histórico"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {running === 30 ? <Loader2 size={14} className="animate-spin" /> : null} Buscar 30 dias
          </button>
          <button
            type="button"
            onClick={() => void runNow(3)}
            disabled={running !== null || activeCount === 0}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {running === 3 ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Atualizar agora
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
          <h3 className="font-semibold text-[var(--color-text)]">Campanhas do resumo</h3>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Marque as contas de anúncio, depois as campanhas ativas que devem entrar no resumo. Desmarcar tira a campanha do resumo. As campanhas de uma mesma conta são somadas na linha do dia.
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
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                No resumo ({activeCount} ativa{activeCount === 1 ? '' : 's'} de {tracked.length})
              </h4>
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

      <section aria-label="Resumo por conta de anúncio" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="report-period" className="text-xs text-[var(--color-text-muted)]">
              Período
            </label>
            <select id="report-period" value={period} onChange={(event) => setPeriod(Number(event.target.value) as (typeof PERIODS)[number])} className={inputClass}>
              {PERIODS.map((days) => (
                <option key={days} value={days}>
                  Últimos {days} dias
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

        {!hasData && (
          <EmptyView
            title="O primeiro resumo ainda não foi gerado"
            description={
              activeCount === 0
                ? 'Escolha as campanhas acima. O resumo sai todo dia às 8h30; ou clique em Buscar 30 dias para montar o histórico agora.'
                : 'Clique em Buscar 30 dias para montar o histórico agora, ou aguarde as 8h30 de amanhã.'
            }
          />
        )}

        {views.map(({ bm, accounts: bmAccounts }) => (
          <div key={bm} className="flex flex-col gap-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">BM · {bm}</h3>
            {bmAccounts.map((view) => {
              const cutoff = isoDaysAgo(period);
              const shown = view.days.filter((day) => day.date >= cutoff);
              const rowsDesc = [...shown].reverse();
              const totals = totalsOf(shown);
              const open = expandedCampaigns.has(view.accountId);
              return (
                <article key={view.accountId} className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-soft)] px-4 py-3">
                    <div className="min-w-0">
                      <h4 className="truncate font-semibold text-[var(--color-text)]">{view.name}</h4>
                      <p className="text-[10px] text-[var(--color-text-faint)]">Conta {view.accountId}</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      Meta diária (leads)
                      <NumberCell value={view.goal} onCommit={(next) => void saveGoal(view.accountId, next)} label={`Meta diária de leads de ${view.name}`} />
                    </label>
                  </div>

                  {shown.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-[var(--color-text-muted)]">Sem dados neste período.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-[var(--color-border-soft)] text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                            <th scope="col" className="px-4 py-2.5 font-bold">Dia</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold">Custo</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold">Leads CRM</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold">Leads gerenc.</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold" title="Leads do gerenciador menos leads do CRM">Dif.</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold" title="Soma, dia a dia, de (leads do CRM − meta diária)">GAP acum.</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold">CPL gerenc.</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold">CPL CRM</th>
                            <th scope="col" className="px-3 py-2.5 text-right font-bold" title="Custo ÷ leads do gerenciador nos últimos 3 dias">CPL 3 dias</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowsDesc.map((row) => (
                            <tr key={row.date} className="border-b border-[var(--color-border-soft)] last:border-0">
                              <th scope="row" className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-[var(--color-text)]">{dayLabel(row.date)}</th>
                              <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text)]">{money(row.spend, view.currency)}</td>
                              <td className="px-3 py-2 text-right">
                                <NumberCell
                                  value={row.crmLeads}
                                  onCommit={(next) => void saveCrm(view.accountId, row.date, next)}
                                  label={`Leads do CRM de ${view.name} em ${dayLabel(row.date)}`}
                                />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text)]">{row.metaLeads}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text)]">
                                {row.diff == null ? <span className="text-[var(--color-text-faint)]">—</span> : row.diff > 0 ? `+${row.diff}` : row.diff}
                              </td>
                              <td
                                className={clsx(
                                  'px-3 py-2 text-right tabular-nums',
                                  row.gap == null ? 'text-[var(--color-text-faint)]' : row.gap >= 0 ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]',
                                )}
                              >
                                {row.gap == null ? '—' : row.gap > 0 ? `+${row.gap}` : row.gap}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text)]">{row.cplMeta == null ? '—' : money(row.cplMeta, view.currency)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text)]">{row.cplCrm == null ? '—' : money(row.cplCrm, view.currency)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text)]">{row.cpl3d == null ? '—' : money(row.cpl3d, view.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[var(--color-border)] bg-[var(--color-bg)] text-xs font-semibold text-[var(--color-text)]">
                            <th scope="row" className="px-4 py-2.5 text-left">Total do período</th>
                            <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.spend, view.currency)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {totals.crmLeads}
                              {totals.daysWithCrm > 0 && totals.daysWithCrm < shown.length && (
                                <span className="ml-1 text-[10px] font-normal text-[var(--color-text-faint)]">({totals.daysWithCrm} dia{totals.daysWithCrm === 1 ? '' : 's'})</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{totals.metaLeads}</td>
                            <td className="px-3 py-2.5" />
                            <td className="px-3 py-2.5" />
                            <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.cplMeta, view.currency)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.cplCrm, view.currency)}</td>
                            <td className="px-3 py-2.5" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {view.campaigns.length > 0 && (
                    <div className="border-t border-[var(--color-border-soft)] px-4 py-2">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() =>
                          setExpandedCampaigns((current) => {
                            const next = new Set(current);
                            if (next.has(view.accountId)) next.delete(view.accountId);
                            else next.add(view.accountId);
                            return next;
                          })
                        }
                        className="text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      >
                        {open ? 'Ocultar' : 'Ver'} campanhas ({view.campaigns.length})
                      </button>
                      {open && (
                        <ul className="mt-2 space-y-1 pb-1">
                          {view.campaigns.map((campaign) => (
                            <li key={campaign.id} className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                              <span className="min-w-0 flex-1 truncate" title={campaign.name}>{campaign.name}</span>
                              <span className="tabular-nums">{money(campaign.spend, view.currency)}</span>
                              <span className="w-16 text-right tabular-nums">{campaign.leads} leads</span>
                              <span className="w-24 text-right tabular-nums">{campaign.leads > 0 ? money(campaign.spend / campaign.leads, view.currency) : 'sem leads'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}
