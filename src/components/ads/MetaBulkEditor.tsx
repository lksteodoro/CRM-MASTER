import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  Layers,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Type,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';
import { buildBatchItem, metaBatch, metaGetAll, type BatchItem } from '../../lib/metaGraph';
import {
  adsManagerLink,
  changesFor,
  formatBRL,
  isAggressiveBudgetChange,
  leadsFromActions,
  LEVEL_EDGE,
  nextBudgetCents,
  ownBudget,
  parseReais,
  renameWith,
  reviewIssues,
  statusFiltering,
  statusInfo,
  undoChanges,
  type BudgetChange,
  type BulkChange,
  type BulkLevel,
  type RenameRule,
  type StatusFilter,
  type StatusTone,
} from '../../lib/metaBulkEdit';

type AdAccount = { id: string; name?: string; business?: { name?: string } };

type Row = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign?: { id: string; name?: string; daily_budget?: string; lifetime_budget?: string };
  adset?: { id: string; name?: string };
  creative?: { id: string; thumbnail_url?: string };
  ad_review_feedback?: unknown;
  preview_shareable_link?: string;
};

type TargetAdSet = {
  id: string;
  name?: string;
  effective_status?: string;
  campaign?: { id: string; name?: string };
  promoted_object?: { pixel_id?: string };
};

type Metrics = { spend: number; leads: number };
type RowResult = { ok: boolean; message?: string };
type Panel = null | 'activate' | 'pause' | 'budget' | 'rename' | 'copy';
type SortKey = 'name' | 'budget' | 'spend' | 'leads' | 'cpl';
type Toast = { text: string; tone: 'ok' | 'warn' | 'error'; undo: BulkChange[] | null };

const FIELDS: Record<BulkLevel, string> = {
  campaign: 'id,name,status,effective_status,daily_budget,lifetime_budget',
  adset: 'id,name,status,effective_status,daily_budget,lifetime_budget,campaign{id,name,daily_budget,lifetime_budget}',
  ad: 'id,name,status,effective_status,adset{id,name},campaign{id,name},creative{id,thumbnail_url},ad_review_feedback,preview_shareable_link',
};

const LEVELS: Array<[BulkLevel, string]> = [['campaign', 'Campanhas'], ['adset', 'Conjuntos'], ['ad', 'Anúncios']];
const STATUS_FILTERS: Array<[StatusFilter, string]> = [['all', 'Todos'], ['active', 'Ativos'], ['paused', 'Pausados'], ['issues', 'Em análise ou com problema']];
const PERIODS: Array<[string, string]> = [['today', 'Hoje'], ['yesterday', 'Ontem'], ['last_7d', 'Últimos 7 dias'], ['last_30d', 'Últimos 30 dias']];
const PAGE_SIZE = 200;
const PREFS_KEY = 'meta_bulk_editor_prefs';

const TONE_CLASS: Record<StatusTone, string> = {
  active: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  paused: 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)]',
  review: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  problem: 'border-red-400/35 bg-red-500/10 text-red-200',
};

const inputClass =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';
const ghostButton =
  'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50 disabled:cursor-not-allowed disabled:opacity-45';

function readPrefs(): { accountId?: string; level?: BulkLevel; period?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePrefs(prefs: { accountId: string; level: BulkLevel; period: string }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* preferência é só conveniência */
  }
}

function batchOutcome(item: { code: number; body?: string }): RowResult {
  let body: any = {};
  try {
    body = JSON.parse(item.body || '{}');
  } catch {
    body = {};
  }
  if (item.code === 200 && !body.error && body.success !== false) return { ok: true };
  return { ok: false, message: body.error?.error_user_msg || body.error?.message || `HTTP ${item.code}` };
}

/** Aplica no objeto da tela o que a Meta acabou de aceitar. */
function applyLocal(row: Row, params: Record<string, string>): Row {
  const next = { ...row };
  if (params.name) next.name = params.name;
  if (params.daily_budget) next.daily_budget = params.daily_budget;
  if (params.lifetime_budget) next.lifetime_budget = params.lifetime_budget;
  if (params.status) {
    next.status = params.status;
    if (params.status === 'PAUSED') next.effective_status = 'PAUSED';
    else if (row.effective_status === 'PAUSED') next.effective_status = 'ACTIVE';
  }
  return next;
}

/**
 * Editor em massa da Meta: lista campanhas, conjuntos ou anúncios de uma conta
 * com gasto e leads do período, e aplica a vários de uma vez ligar/pausar,
 * orçamento e nome — sempre com prévia antes e "Desfazer" depois. Anúncios
 * podem ser copiados para outros conjuntos com o mesmo criativo, o que mantém
 * curtidas e comentários da publicação.
 */
export function MetaBulkEditor() {
  const prefs = useMemo(readPrefs, []);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(prefs.accountId || '');
  const [level, setLevel] = useState<BulkLevel>(prefs.level || 'campaign');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [period, setPeriod] = useState(prefs.period || 'last_7d');
  const [search, setSearch] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');

  const [rows, setRows] = useState<Row[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Metrics>>({});
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'spend', dir: 'desc' });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [panel, setPanel] = useState<Panel>(null);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const [editingBudget, setEditingBudget] = useState<{ id: string; value: string } | null>(null);

  const [budgetChange, setBudgetChange] = useState<BudgetChange>({ mode: 'increase', value: 20 });
  const [renameRule, setRenameRule] = useState<RenameRule>({ find: '', replace: '', prefix: '', suffix: '' });
  const [targetAdSets, setTargetAdSets] = useState<TargetAdSet[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set());
  const [targetSearch, setTargetSearch] = useState('');
  const [copyStatus, setCopyStatus] = useState<'PAUSED' | 'ACTIVE'>('PAUSED');

  const rateNotice = useMemo(
    () => ({ onRateLimit: (seconds: number) => setToast({ text: `Limite de requisições da Meta: aguardando ${seconds}s...`, tone: 'warn', undo: null }) }),
    []
  );

  // ── Contas ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    metaGetAll<AdAccount>('me/adaccounts', { fields: 'id,name,business{name}', limit: 200 })
      .then((list) => {
        if (!alive) return;
        const sorted = [...list].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR'));
        setAccounts(sorted);
        setAccountId((current) => (current && sorted.some((account) => account.id === current) ? current : sorted[0]?.id || ''));
      })
      .catch((caught) => {
        if (alive) setAccountsError(caught instanceof Error ? caught.message : 'Não foi possível listar as contas de anúncio.');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (accountId) savePrefs({ accountId, level, period });
  }, [accountId, level, period]);

  // ── Objetos e resultados do período ──────────────────────────────────────
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setMetricsError(null);
    setSelected(new Set());
    setResults({});
    setPanel(null);
    setVisibleCount(PAGE_SIZE);

    metaGetAll<Row>(`${accountId}/${LEVEL_EDGE[level]}`, { fields: FIELDS[level], filtering: statusFiltering(level, statusFilter), limit: 200 }, { maxPages: 10, ...rateNotice })
      .then((list) => {
        if (alive) setRows(list.map((row) => ({ ...row, name: row.name || row.id })));
      })
      .catch((caught) => {
        if (alive) {
          setRows([]);
          setLoadError(caught instanceof Error ? caught.message : 'Não foi possível carregar.');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    metaGetAll<Record<string, any>>(`${accountId}/insights`, { level, fields: `${level}_id,spend,actions`, date_preset: period, limit: 500 }, { maxPages: 10, ...rateNotice })
      .then((list) => {
        if (!alive) return;
        const map: Record<string, Metrics> = {};
        for (const item of list) {
          const id = String(item[`${level}_id`] ?? '');
          if (id) map[id] = { spend: Math.round(Number(item.spend || 0) * 100), leads: leadsFromActions(item.actions) };
        }
        setMetrics(map);
      })
      .catch((caught) => {
        if (alive) {
          setMetrics({});
          setMetricsError(caught instanceof Error ? caught.message : 'Sem resultados do período.');
        }
      });

    return () => {
      alive = false;
    };
  }, [accountId, level, statusFilter, period, reloadKey, rateNotice]);

  // ── Filtro, ordem e seleção ───────────────────────────────────────────────
  const campaigns = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) if (row.campaign?.id) map.set(row.campaign.id, row.campaign.name || row.campaign.id);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [rows]);

  const metricOf = useCallback((id: string) => metrics[id] ?? { spend: 0, leads: 0 }, [metrics]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = rows.filter(
      (row) =>
        (!term || row.name.toLowerCase().includes(term) || row.id.includes(term)) &&
        (!campaignFilter || row.campaign?.id === campaignFilter)
    );
    const value = (row: Row): number | string => {
      const metric = metricOf(row.id);
      if (sort.key === 'name') return row.name.toLowerCase();
      if (sort.key === 'budget') return ownBudget(row)?.cents ?? -1;
      if (sort.key === 'spend') return metric.spend;
      if (sort.key === 'leads') return metric.leads;
      return metric.leads > 0 ? metric.spend / metric.leads : Number.POSITIVE_INFINITY;
    };
    return [...list].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const order = typeof va === 'string' ? va.localeCompare(String(vb), 'pt-BR') : va - (vb as number);
      return sort.dir === 'asc' ? order : -order;
    });
  }, [rows, search, campaignFilter, sort, metricOf]);

  const shown = filtered.slice(0, visibleCount);
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const allShownSelected = shown.length > 0 && shown.every((row) => selected.has(row.id));
  const someSelected = shown.some((row) => selected.has(row.id));
  const headerCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected && !allShownSelected;
  }, [someSelected, allShownSelected]);

  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllShown = () =>
    setSelected((current) => {
      const next = new Set(current);
      if (allShownSelected) shown.forEach((row) => next.delete(row.id));
      else filtered.forEach((row) => next.add(row.id));
      return next;
    });

  const totals = useMemo(() => {
    let spend = 0;
    let leads = 0;
    for (const row of filtered) {
      const metric = metricOf(row.id);
      spend += metric.spend;
      leads += metric.leads;
    }
    return { spend, leads };
  }, [filtered, metricOf]);

  // ── Aplicar alterações ────────────────────────────────────────────────────
  async function applyChanges(changes: BulkChange[], label: string, undoable = true) {
    if (changes.length === 0) {
      setToast({ text: `${label}: nada mudou.`, tone: 'warn', undo: null });
      return;
    }
    setApplying(true);
    const outcome: Record<string, RowResult> = {};
    for (let start = 0; start < changes.length; start += 50) {
      const chunk = changes.slice(start, start + 50);
      try {
        const response = await metaBatch(chunk.map((change) => buildBatchItem(change.id, change.params)), rateNotice);
        response.forEach((item, index) => {
          outcome[chunk[index].id] = batchOutcome(item);
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Falha ao falar com a Meta.';
        chunk.forEach((change) => {
          outcome[change.id] = { ok: false, message };
        });
      }
    }
    const done = changes.filter((change) => outcome[change.id]?.ok);
    const byId = new Map(done.map((change) => [change.id, change.params]));
    setRows((current) => current.map((row) => (byId.has(row.id) ? applyLocal(row, byId.get(row.id)!) : row)));
    setResults(outcome);
    const failed = changes.length - done.length;
    const firstError = changes.map((change) => outcome[change.id]).find((result) => result && !result.ok)?.message;
    setToast({
      text: failed === 0
        ? `${label}: ${done.length} ${done.length === 1 ? 'item alterado' : 'itens alterados'}.`
        : `${label}: ${done.length} de ${changes.length} alterados. ${failed} com erro${firstError ? ` — ${firstError}` : ''}.`,
      tone: failed === 0 ? 'ok' : done.length > 0 ? 'warn' : 'error',
      undo: undoable && done.length > 0 ? undoChanges(done) : null,
    });
    setApplying(false);
    if (done.length > 0) setPanel(null);
  }

  const statusChanges = (status: 'ACTIVE' | 'PAUSED') =>
    changesFor(selectedRows, (row) => ({ params: { status }, previous: { status: row.status } }));

  const budgetPlan = useMemo(() => {
    const items: Array<{ row: Row; field: string; before: number; after: number }> = [];
    const skipped: Row[] = [];
    for (const row of selectedRows) {
      const budget = ownBudget(row);
      const after = budget ? nextBudgetCents(budget.cents, budgetChange) : null;
      if (!budget || after == null) skipped.push(row);
      else items.push({ row, field: budget.field, before: budget.cents, after });
    }
    return { items, skipped };
  }, [selectedRows, budgetChange]);

  const renamePlan = useMemo(
    () => selectedRows.map((row) => ({ row, after: renameWith(row.name, renameRule) })).filter((item) => item.after && item.after !== item.row.name),
    [selectedRows, renameRule]
  );

  function saveInlineBudget(row: Row) {
    if (!editingBudget) return;
    const budget = ownBudget(row);
    const reais = parseReais(editingBudget.value);
    setEditingBudget(null);
    if (!budget || !Number.isFinite(reais) || reais <= 0) return;
    const cents = Math.round(reais * 100);
    void applyChanges(
      changesFor([row], () => ({ params: { [budget.field]: String(cents) }, previous: { [budget.field]: String(budget.cents) } })),
      'Orçamento'
    );
  }

  // ── Copiar anúncios para outros conjuntos ─────────────────────────────────
  useEffect(() => {
    if (panel !== 'copy' || !accountId) return;
    let alive = true;
    setTargetsLoading(true);
    metaGetAll<TargetAdSet>(`${accountId}/adsets`, { fields: 'id,name,effective_status,campaign{id,name},promoted_object', filtering: statusFiltering('adset', 'all'), limit: 200 }, { maxPages: 10 })
      .then((list) => {
        if (alive) setTargetAdSets(list);
      })
      .catch(() => {
        if (alive) setTargetAdSets([]);
      })
      .finally(() => {
        if (alive) setTargetsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [panel, accountId]);

  const copyPairs = useMemo(() => {
    const pairs: Array<{ ad: Row; target: TargetAdSet }> = [];
    for (const ad of selectedRows) {
      if (!ad.creative?.id) continue;
      for (const target of targetAdSets) if (targetIds.has(target.id) && target.id !== ad.adset?.id) pairs.push({ ad, target });
    }
    return pairs;
  }, [selectedRows, targetAdSets, targetIds]);

  async function copyAds() {
    if (copyPairs.length === 0) return;
    setApplying(true);
    let created = 0;
    const errors: string[] = [];
    for (let start = 0; start < copyPairs.length; start += 50) {
      const chunk = copyPairs.slice(start, start + 50);
      const items: BatchItem[] = chunk.map(({ ad, target }) => {
        const pixelId = target.promoted_object?.pixel_id;
        return buildBatchItem(`${accountId}/ads`, {
          name: ad.name,
          adset_id: target.id,
          creative: JSON.stringify({ creative_id: ad.creative!.id }),
          status: copyStatus,
          ...(pixelId ? { tracking_specs: JSON.stringify([{ 'action.type': ['offsite_conversion'], fb_pixel: [pixelId] }]) } : {}),
        });
      });
      try {
        const response = await metaBatch(items, rateNotice);
        response.forEach((item) => {
          const result = batchOutcome(item);
          if (result.ok) created += 1;
          else if (result.message) errors.push(result.message);
        });
      } catch (caught) {
        errors.push(caught instanceof Error ? caught.message : 'Falha ao falar com a Meta.');
      }
    }
    setApplying(false);
    setToast({
      text: errors.length === 0
        ? `${created} anúncio(s) criado(s) nos conjuntos escolhidos, ${copyStatus === 'ACTIVE' ? 'ativos' : 'pausados'}, com o mesmo criativo (curtidas e comentários continuam).`
        : `${created} de ${copyPairs.length} anúncio(s) criados. Erro: ${errors[0]}`,
      tone: errors.length === 0 ? 'ok' : created > 0 ? 'warn' : 'error',
      undo: null,
    });
    if (created > 0) {
      setPanel(null);
      setTargetIds(new Set());
    }
  }

  // ── Interface ─────────────────────────────────────────────────────────────
  const levelNoun = level === 'campaign' ? 'campanha' : level === 'adset' ? 'conjunto' : 'anúncio';
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const sortHeader = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={clsx('px-3 py-2.5 font-semibold', align === 'right' ? 'text-right' : 'text-left')}>
        <button
          type="button"
          onClick={() => setSort((current) => ({ key, dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc' }))}
          className={clsx('inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50', active ? 'text-[var(--color-text)]' : 'hover:text-[var(--color-text)]')}
        >
          {label}
          {active && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      </th>
    );
  };

  const selectedCount = selected.size;
  const filteredTargets = targetAdSets.filter((target) => {
    const term = targetSearch.trim().toLowerCase();
    return !term || `${target.name} ${target.campaign?.name}`.toLowerCase().includes(term);
  });

  return (
    <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-500/10 text-violet-200">
            <Layers size={20} />
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--color-text)]">Editor em massa</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            Ligue, pause, mude orçamento e renomeie vários de uma vez, com prévia antes de aplicar e opção de desfazer. Anúncios podem ser copiados para outros conjuntos mantendo curtidas e comentários.
          </p>
        </div>
        <button type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading || !accountId} className={ghostButton}>
          <RefreshCw size={13} className={clsx(loading && 'animate-spin')} /> Atualizar
        </button>
      </div>

      {accountsError && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{accountsError}</p>}

      {/* Filtros */}
      <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(240px,1.2fr)_auto_auto]">
        <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
          Conta de anúncio
          <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setCampaignFilter(''); }} className={clsx(inputClass, 'normal-case tracking-normal')}>
            {accounts.length === 0 && <option value="">Carregando contas...</option>}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name || account.id}{account.business?.name ? ` · ${account.business.name}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Nível</span>
          <div role="radiogroup" aria-label="Nível" className="inline-flex rounded-xl border border-[var(--color-border)] p-0.5">
            {LEVELS.map(([key, label]) => (
              <button key={key} type="button" role="radio" aria-checked={level === key} onClick={() => { setLevel(key); setCampaignFilter(''); }}
                className={clsx('min-h-9 rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50', level === key ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
          Resultados de
          <select value={period} onChange={(event) => setPeriod(event.target.value)} className={clsx(inputClass, 'normal-case tracking-normal')}>
            {PERIODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Status" className="inline-flex flex-wrap rounded-xl border border-[var(--color-border)] p-0.5">
          {STATUS_FILTERS.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={statusFilter === key} onClick={() => setStatusFilter(key)}
              className={clsx('min-h-8 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50', statusFilter === key ? 'bg-[var(--color-panel-2)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${levelNoun} pelo nome ou ID`} aria-label="Buscar pelo nome ou ID" className={clsx(inputClass, 'w-full pl-9')} />
        </div>
        {level !== 'campaign' && campaigns.length > 1 && (
          <select value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)} aria-label="Filtrar por campanha" className={clsx(inputClass, 'max-w-[280px]')}>
            <option value="">Todas as campanhas</option>
            {campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {/* Barra de ações em lote */}
      <div className={clsx('sticky top-0 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2.5 transition', selectedCount > 0 ? 'border-[var(--color-brand)]/45 bg-[var(--color-panel-2)] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)]' : 'border-[var(--color-border)] bg-[var(--color-bg)]')}>
        <span className="mr-1 text-xs font-semibold text-[var(--color-text)]" aria-live="polite">
          {selectedCount > 0 ? `${selectedCount} selecionado${selectedCount === 1 ? '' : 's'}` : 'Marque as linhas para editar em massa'}
        </span>
        <button type="button" disabled={selectedCount === 0 || applying} onClick={() => setPanel('activate')} className={ghostButton}><Play size={13} /> Ativar</button>
        <button type="button" disabled={selectedCount === 0 || applying} onClick={() => setPanel('pause')} className={ghostButton}><Pause size={13} /> Pausar</button>
        {level !== 'ad' && <button type="button" disabled={selectedCount === 0 || applying} onClick={() => setPanel('budget')} className={ghostButton}><Wallet size={13} /> Orçamento</button>}
        <button type="button" disabled={selectedCount === 0 || applying} onClick={() => setPanel('rename')} className={ghostButton}><Type size={13} /> Renomear</button>
        {level === 'ad' && <button type="button" disabled={selectedCount === 0 || applying} onClick={() => setPanel('copy')} className={ghostButton}><Copy size={13} /> Copiar para conjuntos</button>}
        {selectedCount > 0 && (
          <button type="button" onClick={() => { setSelected(new Set()); setPanel(null); }} className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X size={13} /> Limpar seleção
          </button>
        )}
      </div>

      {/* Prévia da ação */}
      {panel && selectedCount > 0 && (
        <div className="mt-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
          {(panel === 'activate' || panel === 'pause') && (() => {
            const status = panel === 'activate' ? 'ACTIVE' : 'PAUSED';
            const changes = statusChanges(status);
            return (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{panel === 'activate' ? 'Ativar' : 'Pausar'} {plural(changes.length, levelNoun)}</h3>
                {changes.length < selectedCount && <p className="text-xs text-[var(--color-text-muted)]">{selectedCount - changes.length} já {panel === 'activate' ? 'estavam ativos' : 'estavam pausados'} e ficam como estão.</p>}
                {panel === 'activate' && (
                  <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    Começam a gastar assim que a Meta aprovar. O que estiver dentro de campanha ou conjunto pausado continua parado até você ativar o nível de cima.
                  </p>
                )}
                <p className="text-xs text-[var(--color-text-muted)]">{changes.slice(0, 6).map((change) => rows.find((row) => row.id === change.id)?.name).join(' · ')}{changes.length > 6 ? ` · e mais ${changes.length - 6}` : ''}</p>
                <div className="flex gap-2">
                  <button type="button" disabled={applying || changes.length === 0} onClick={() => void applyChanges(changes, panel === 'activate' ? 'Ativar' : 'Pausar')}
                    className={clsx('inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50', panel === 'activate' ? 'bg-emerald-600' : 'bg-amber-600')}>
                    {applying ? <Loader2 size={15} className="animate-spin" /> : panel === 'activate' ? <Play size={15} /> : <Pause size={15} />}
                    {panel === 'activate' ? 'Ativar' : 'Pausar'} {changes.length}
                  </button>
                  <button type="button" onClick={() => setPanel(null)} className={ghostButton}>Cancelar</button>
                </div>
              </div>
            );
          })()}

          {panel === 'budget' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Orçamento de {plural(budgetPlan.items.length, levelNoun)}</h3>
              <div className="flex flex-wrap items-end gap-2">
                <div role="radiogroup" aria-label="Como mudar" className="inline-flex rounded-xl border border-[var(--color-border)] p-0.5">
                  {([['increase', 'Aumentar %'], ['decrease', 'Diminuir %'], ['set', 'Definir valor (R$)']] as const).map(([mode, label]) => (
                    <button key={mode} type="button" role="radio" aria-checked={budgetChange.mode === mode} onClick={() => setBudgetChange((current) => ({ ...current, mode }))}
                      className={clsx('min-h-9 rounded-lg px-3 text-xs font-semibold', budgetChange.mode === mode ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="flex flex-col gap-1 text-[11px] font-semibold text-[var(--color-text-faint)]">
                  {budgetChange.mode === 'set' ? 'Novo valor (R$)' : 'Percentual (%)'}
                  <input type="number" min={0} step={budgetChange.mode === 'set' ? 1 : 5} value={Number.isFinite(budgetChange.value) ? budgetChange.value : ''}
                    onChange={(event) => setBudgetChange((current) => ({ ...current, value: Number(event.target.value) }))} className={clsx(inputClass, 'w-32')} />
                </label>
              </div>
              {budgetPlan.items.some((item) => isAggressiveBudgetChange(item.before, item.after)) && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  Mudanças acima de 20% de uma vez costumam reiniciar a fase de aprendizado. Se puder, suba aos poucos.
                </p>
              )}
              {budgetPlan.items.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--color-border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--color-panel)] text-[var(--color-text-faint)]"><tr><th className="px-3 py-2 text-left font-semibold">Nome</th><th className="px-3 py-2 text-right font-semibold">Atual</th><th className="px-3 py-2 text-right font-semibold">Novo</th></tr></thead>
                    <tbody>
                      {budgetPlan.items.map((item) => (
                        <tr key={item.row.id} className="border-t border-[var(--color-border-soft)]">
                          <td className="max-w-[360px] truncate px-3 py-1.5 text-[var(--color-text)]" title={item.row.name}>{item.row.name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">{formatBRL(item.before)}{item.field === 'lifetime_budget' ? ' total' : '/dia'}</td>
                          <td className={clsx('px-3 py-1.5 text-right font-semibold tabular-nums', isAggressiveBudgetChange(item.before, item.after) ? 'text-amber-200' : 'text-[var(--color-text)]')}>{formatBRL(item.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {budgetPlan.skipped.length > 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  {budgetPlan.skipped.length} sem orçamento próprio {level === 'adset' ? '(o orçamento está na campanha)' : '(o orçamento está nos conjuntos)'} ficam de fora.
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={applying || budgetPlan.items.length === 0}
                  onClick={() => void applyChanges(changesFor(budgetPlan.items.map((item) => item.row), (row) => {
                    const item = budgetPlan.items.find((entry) => entry.row.id === row.id)!;
                    return { params: { [item.field]: String(item.after) }, previous: { [item.field]: String(item.before) } };
                  }), 'Orçamento')}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                  {applying ? <Loader2 size={15} className="animate-spin" /> : <Wallet size={15} />} Aplicar em {budgetPlan.items.length}
                </button>
                <button type="button" onClick={() => setPanel(null)} className={ghostButton}>Cancelar</button>
              </div>
            </div>
          )}

          {panel === 'rename' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Renomear {plural(selectedCount, levelNoun)}</h3>
              <div className="grid gap-2 sm:grid-cols-4">
                {([['find', 'Localizar'], ['replace', 'Substituir por'], ['prefix', 'Começar com'], ['suffix', 'Terminar com']] as const).map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1 text-[11px] font-semibold text-[var(--color-text-faint)]">
                    {label}
                    <input value={renameRule[key]} onChange={(event) => setRenameRule((current) => ({ ...current, [key]: event.target.value }))} className={inputClass} />
                  </label>
                ))}
              </div>
              {renamePlan.length > 0 ? (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--color-border)] p-2 text-xs">
                  {renamePlan.slice(0, 50).map((item) => (
                    <li key={item.row.id} className="grid gap-1 sm:grid-cols-2">
                      <span className="truncate text-[var(--color-text-muted)] line-through decoration-[var(--color-text-faint)]" title={item.row.name}>{item.row.name}</span>
                      <span className="truncate font-medium text-[var(--color-text)]" title={item.after}>{item.after}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">Preencha um dos campos para ver a prévia.</p>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={applying || renamePlan.length === 0}
                  onClick={() => void applyChanges(changesFor(renamePlan.map((item) => item.row), (row) => ({ params: { name: renameWith(row.name, renameRule) }, previous: { name: row.name } })), 'Renomear')}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                  {applying ? <Loader2 size={15} className="animate-spin" /> : <Type size={15} />} Renomear {renamePlan.length}
                </button>
                <button type="button" onClick={() => setPanel(null)} className={ghostButton}>Cancelar</button>
              </div>
            </div>
          )}

          {panel === 'copy' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Copiar {plural(selectedCount, 'anúncio')} para outros conjuntos</h3>
              <p className="text-xs leading-5 text-[var(--color-text-muted)]">O anúncio novo usa o mesmo criativo, então a publicação é a mesma: curtidas, comentários e compartilhamentos continuam somando. Conjunto de origem é pulado.</p>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
                <input value={targetSearch} onChange={(event) => setTargetSearch(event.target.value)} placeholder="Buscar conjunto ou campanha" aria-label="Buscar conjunto de destino" className={clsx(inputClass, 'w-full pl-9')} />
              </div>
              <div className="max-h-60 overflow-y-auto rounded-xl border border-[var(--color-border)]">
                {targetsLoading && <p className="flex items-center gap-2 p-3 text-xs text-[var(--color-text-muted)]"><Loader2 size={13} className="animate-spin" /> Carregando conjuntos...</p>}
                {!targetsLoading && filteredTargets.length === 0 && <p className="p-3 text-xs text-[var(--color-text-faint)]">Nenhum conjunto encontrado.</p>}
                {filteredTargets.map((target) => (
                  <label key={target.id} className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--color-border-soft)] px-3 py-2 text-xs last:border-b-0 hover:bg-[var(--color-panel)]">
                    <input type="checkbox" checked={targetIds.has(target.id)} onChange={() => setTargetIds((current) => { const next = new Set(current); if (next.has(target.id)) next.delete(target.id); else next.add(target.id); return next; })} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--color-text)]">{target.name || target.id}</span>
                      <span className="block truncate text-[10px] text-[var(--color-text-faint)]">{target.campaign?.name}</span>
                    </span>
                    <StatusChip status={target.effective_status} />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div role="radiogroup" aria-label="Status dos anúncios novos" className="inline-flex rounded-xl border border-[var(--color-border)] p-0.5">
                  {([['PAUSED', 'Criar pausados'], ['ACTIVE', 'Criar ativos']] as const).map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={copyStatus === value} onClick={() => setCopyStatus(value)}
                      className={clsx('min-h-9 rounded-lg px-3 text-xs font-semibold', copyStatus === value ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-[var(--color-text-muted)]">{copyPairs.length} anúncio(s) novos{selectedRows.some((row) => !row.creative?.id) ? ' · anúncios sem criativo legível ficam de fora' : ''}</span>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={applying || copyPairs.length === 0} onClick={() => void copyAds()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                  {applying ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />} Criar {copyPairs.length}
                </button>
                <button type="button" onClick={() => setPanel(null)} className={ghostButton}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Aviso do que acabou de acontecer, com desfazer */}
      {toast && (
        <div role="status" aria-live="polite" className={clsx('mt-3 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm', toast.tone === 'ok' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : toast.tone === 'warn' ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-red-400/30 bg-red-500/10 text-red-100')}>
          {toast.tone === 'ok' ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
          <span className="min-w-0 flex-1">{toast.text}</span>
          {toast.undo && (
            <button type="button" disabled={applying} onClick={() => void applyChanges(toast.undo!, 'Desfeito', false)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-current/30 px-3 text-xs font-semibold hover:bg-white/5">
              <Undo2 size={13} /> Desfazer
            </button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso" className="rounded p-1 opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {metricsError && !loading && <p className="mt-3 text-xs text-amber-200">Gasto e leads indisponíveis agora ({metricsError}). A edição funciona normalmente.</p>}

      {/* Tabela */}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--color-border)]">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="sr-only">{LEVELS.find(([key]) => key === level)?.[1]} da conta, com gasto e leads do período</caption>
          <thead className="bg-[var(--color-bg)] text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
            <tr>
              <th scope="col" className="w-10 px-3 py-2.5">
                <input ref={headerCheckbox} type="checkbox" checked={allShownSelected} onChange={toggleAllShown} aria-label="Selecionar todos os que aparecem na lista" disabled={filtered.length === 0} />
              </th>
              {sortHeader('name', level === 'campaign' ? 'Campanha' : level === 'adset' ? 'Conjunto' : 'Anúncio', 'left')}
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">Status</th>
              {level !== 'ad' && sortHeader('budget', 'Orçamento')}
              {sortHeader('spend', 'Gasto')}
              {sortHeader('leads', 'Leads')}
              {sortHeader('cpl', 'Custo por lead')}
              <th scope="col" className="px-3 py-2.5 text-right font-semibold"><span className="sr-only">Links</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, index) => (
              <tr key={`skeleton-${index}`} className="border-t border-[var(--color-border-soft)]">
                <td colSpan={8} className="px-3 py-3"><div className="h-4 w-full animate-pulse rounded bg-[var(--color-panel-2)]" /></td>
              </tr>
            ))}
            {!loading && loadError && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-red-200">{loadError} <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="ml-2 underline">Tentar de novo</button></td></tr>
            )}
            {!loading && !loadError && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">Nada encontrado com esses filtros.</td></tr>
            )}
            {!loading && shown.map((row) => {
              const metric = metricOf(row.id);
              const budget = ownBudget(row);
              const parentBudget = level === 'adset' && !budget && row.campaign ? ownBudget(row.campaign) : null;
              const isOn = row.status === 'ACTIVE';
              const result = results[row.id];
              const issues = level === 'ad' ? reviewIssues(row.ad_review_feedback) : [];
              const checked = selected.has(row.id);
              return (
                <tr key={row.id} className={clsx('border-t border-[var(--color-border-soft)] transition-colors', checked ? 'bg-[var(--color-brand)]/[0.07]' : 'hover:bg-[var(--color-bg)]')}>
                  <td className="px-3 py-2.5 align-middle">
                    <input type="checkbox" checked={checked} onChange={() => toggleRow(row.id)} aria-label={`Selecionar ${row.name}`} />
                  </td>
                  <td className="max-w-[420px] px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2.5">
                      {level === 'ad' && (
                        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/40">
                          {row.creative?.thumbnail_url && <img src={row.creative.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[var(--color-text)]" title={row.name}>{row.name}</span>
                        <span className="block truncate text-[11px] text-[var(--color-text-faint)]">
                          {level === 'campaign' ? row.id : level === 'adset' ? row.campaign?.name : `${row.adset?.name ?? ''} · ${row.campaign?.name ?? ''}`}
                        </span>
                        {issues.length > 0 && <span className="mt-0.5 block truncate text-[11px] text-red-300" title={issues.join(' · ')}>{issues.join(' · ')}</span>}
                      </span>
                      {result && (result.ok
                        ? <CheckCircle2 size={14} className="shrink-0 text-emerald-300" aria-label="Alterado" />
                        : <span title={result.message} className="shrink-0"><AlertTriangle size={14} className="text-red-300" aria-label={`Erro: ${result.message}`} /></span>)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isOn}
                        aria-label={`${isOn ? 'Pausar' : 'Ativar'} ${row.name}`}
                        disabled={applying}
                        onClick={() => void applyChanges(changesFor([row], () => ({ params: { status: isOn ? 'PAUSED' : 'ACTIVE' }, previous: { status: row.status } })), isOn ? 'Pausar' : 'Ativar')}
                        className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60 disabled:opacity-50', isOn ? 'bg-emerald-500' : 'bg-[var(--color-border)]')}
                      >
                        <span className={clsx('absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', isOn ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                      </button>
                      <StatusChip status={row.effective_status} />
                    </div>
                  </td>
                  {level !== 'ad' && (
                    <td className="px-3 py-2.5 text-right align-middle tabular-nums">
                      {budget ? (
                        editingBudget?.id === row.id ? (
                          <input
                            autoFocus
                            inputMode="decimal"
                            aria-label={`Novo orçamento de ${row.name} em reais`}
                            value={editingBudget.value}
                            onChange={(event) => setEditingBudget({ id: row.id, value: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') saveInlineBudget(row);
                              if (event.key === 'Escape') setEditingBudget(null);
                            }}
                            onBlur={() => setEditingBudget(null)}
                            className={clsx(inputClass, 'w-28 py-1 text-right')}
                          />
                        ) : (
                          <button type="button" onClick={() => setEditingBudget({ id: row.id, value: (budget.cents / 100).toFixed(2).replace('.', ',') })}
                            className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[var(--color-text)] hover:bg-[var(--color-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                            title="Clique para mudar (Enter salva, Esc cancela)">
                            {formatBRL(budget.cents)}<span className="text-[10px] text-[var(--color-text-faint)]">{budget.field === 'lifetime_budget' ? 'total' : '/dia'}</span>
                            <Pencil size={11} className="opacity-0 transition group-hover:opacity-70 group-focus-visible:opacity-70" />
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] text-[var(--color-text-faint)]">{parentBudget ? `Campanha: ${formatBRL(parentBudget.cents)}` : level === 'campaign' ? 'Nos conjuntos' : '—'}</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right align-middle tabular-nums text-[var(--color-text)]">{metric.spend > 0 ? formatBRL(metric.spend) : '—'}</td>
                  <td className="px-3 py-2.5 text-right align-middle tabular-nums text-[var(--color-text)]">{metric.leads > 0 ? metric.leads.toLocaleString('pt-BR') : '—'}</td>
                  <td className="px-3 py-2.5 text-right align-middle tabular-nums text-[var(--color-text)]">{metric.leads > 0 ? formatBRL(Math.round(metric.spend / metric.leads)) : '—'}</td>
                  <td className="px-3 py-2.5 text-right align-middle">
                    <div className="flex justify-end gap-1">
                      {row.preview_shareable_link && (
                        <a href={row.preview_shareable_link} target="_blank" rel="noreferrer" aria-label={`Prévia de ${row.name}`} title="Prévia do anúncio" className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]">
                          <Eye size={14} />
                        </a>
                      )}
                      <a href={adsManagerLink(level, accountId, row.id)} target="_blank" rel="noreferrer" aria-label={`Abrir ${row.name} no Gerenciador`} title="Abrir no Gerenciador" className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]">
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-bg)] text-xs text-[var(--color-text-muted)]">
              <tr>
                <td />
                <td className="px-3 py-2.5 font-semibold text-[var(--color-text)]">{plural(filtered.length, levelNoun)}</td>
                <td />
                {level !== 'ad' && <td />}
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--color-text)]">{formatBRL(totals.spend)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--color-text)]">{totals.leads.toLocaleString('pt-BR')}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--color-text)]">{totals.leads > 0 ? formatBRL(Math.round(totals.spend / totals.leads)) : '—'}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!loading && filtered.length > shown.length && (
        <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className={clsx(ghostButton, 'mt-3')}>
          Mostrar mais {Math.min(PAGE_SIZE, filtered.length - shown.length)} de {filtered.length - shown.length}
        </button>
      )}
    </section>
  );
}

function StatusChip({ status }: { status?: string }) {
  const info = statusInfo(status);
  return <span className={clsx('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE_CLASS[info.tone])}>{info.label}</span>;
}
