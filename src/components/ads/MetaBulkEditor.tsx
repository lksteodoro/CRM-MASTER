import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Flag,
  Layers,
  Link2,
  Loader2,
  Pause,
  Pencil,
  Play,
  Radar,
  RefreshCw,
  Search,
  TextCursorInput,
  Type,
  Undo2,
  Wallet,
  X,
} from 'lucide-react';
import { buildBatchItem, metaBatch, metaGetAll, type BatchItem } from '../../lib/metaGraph';
import {
  adsManagerLink,
  changesFor,
  describeCreative,
  formatBRL,
  isAggressiveBudgetChange,
  leadsFromActions,
  LEVEL_EDGE,
  nextBudgetCents,
  ownBudget,
  parseReais,
  pixelOf,
  pixelTrackingSpecs,
  planCreativeEdit,
  renameWith,
  reviewIssues,
  statusFiltering,
  statusInfo,
  undoChanges,
  type BudgetChange,
  type BulkChange,
  type BulkLevel,
  type CreativeEdit,
  type CreativeEditPlan,
  type RenameRule,
  type StatusFilter,
  type StatusTone,
  type TextEdit,
  type UrlTagsEdit,
} from '../../lib/metaBulkEdit';
import { validateDestinationUrl } from '../../lib/metaCompliance';
import { META_UTM_TEMPLATE } from '../../lib/utmBuilder';

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
  creative?: Creative;
  ad_review_feedback?: unknown;
  preview_shareable_link?: string;
  tracking_specs?: unknown;
};

type Creative = {
  id: string;
  name?: string;
  thumbnail_url?: string;
  object_story_spec?: Record<string, any>;
  asset_feed_spec?: Record<string, any>;
  url_tags?: string;
  degrees_of_freedom_spec?: Record<string, any>;
};

type Pixel = { id: string; name?: string };

type TargetAdSet = {
  id: string;
  name?: string;
  effective_status?: string;
  campaign?: { id: string; name?: string };
  promoted_object?: { pixel_id?: string };
};

type Metrics = { spend: number; leads: number };
type RowResult = { ok: boolean; message?: string };
type Panel = null | 'activate' | 'pause' | 'budget' | 'rename' | 'copy' | AdPanel;
type AdPanel = 'text' | 'url' | 'tracking' | 'identity';
type PageOption = { id: string; name?: string; instagram_business_account?: { id: string; username?: string } | null };
type SortKey = 'name' | 'budget' | 'spend' | 'leads' | 'cpl';
type Toast = { text: string; tone: 'ok' | 'warn' | 'error'; undo: BulkChange[] | null };
type ProgressLog = { key: string; name: string; ok: boolean; text: string };
type Progress = {
  title: string;
  step: string;
  done: number;
  total: number;
  logs: ProgressLog[];
  finished: boolean;
  summary?: string;
  tone?: Toast['tone'];
};
/** Itens por chamada em lote. Menor que o máximo da Meta (50) para o progresso andar em passos curtos. */
const BATCH_SIZE = 25;

const FIELDS: Record<BulkLevel, string> = {
  campaign: 'id,name,status,effective_status,daily_budget,lifetime_budget',
  adset: 'id,name,status,effective_status,daily_budget,lifetime_budget,campaign{id,name,daily_budget,lifetime_budget}',
  ad: 'id,name,status,effective_status,adset{id,name},campaign{id,name},ad_review_feedback,preview_shareable_link,tracking_specs,creative{id,name,thumbnail_url,object_story_spec,asset_feed_spec,url_tags,degrees_of_freedom_spec}',
};

const LEVELS: Array<[BulkLevel, string]> = [['campaign', 'Campanhas'], ['adset', 'Conjuntos'], ['ad', 'Anúncios']];
const STATUS_FILTERS: Array<[StatusFilter, string]> = [['all', 'Todos'], ['active', 'Ativos'], ['paused', 'Pausados'], ['issues', 'Em análise ou com problema']];
const PERIODS: Array<[string, string]> = [['today', 'Hoje'], ['yesterday', 'Ontem'], ['last_7d', 'Últimos 7 dias'], ['last_30d', 'Últimos 30 dias']];
const PAGE_SIZE = 200;
const LEVEL_RANK: Record<BulkLevel, number> = { campaign: 0, adset: 1, ad: 2 };
type ParentScope = { level: 'campaign' | 'adset'; ids: string[]; names: string[] };

/** O escopo só vale para níveis abaixo dele (campanha → conjuntos e anúncios; conjunto → anúncios). */
function scopeFor(scope: ParentScope | null, level: BulkLevel) {
  return scope && LEVEL_RANK[scope.level] < LEVEL_RANK[level] ? scope : null;
}

function scopeParentId(scope: ParentScope, row: Row) {
  return (scope.level === 'campaign' ? row.campaign?.id : row.adset?.id) ?? '';
}
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
function applyLocal(row: Row, params: Record<string, string>, creatives: Map<string, Creative>): Row {
  const next = { ...row };
  if (params.creative) {
    // Criativo trocado: o anúncio volta para a análise da Meta.
    const creativeId = String(JSON.parse(params.creative).creative_id);
    next.creative = creatives.get(creativeId) ?? { ...row.creative, id: creativeId };
    next.effective_status = row.status === 'ACTIVE' ? 'PENDING_REVIEW' : row.effective_status;
  }
  if (params.tracking_specs) next.tracking_specs = JSON.parse(params.tracking_specs);
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
  // Texto, URL e rastreamento vivem no anúncio. Pedidos a partir de campanhas
  // ou conjuntos abrem os anúncios deles, já marcados.
  const [parentScope, setParentScope] = useState<ParentScope | null>(null);
  const activeScope = scopeFor(parentScope, level);
  // Chave estável para recarregar só quando o escopo efetivo muda.
  const scopeKey = activeScope ? `${activeScope.level}:${activeScope.ids.join(',')}` : '';
  const [pendingPanel, setPendingPanel] = useState<AdPanel | null>(null);
  const [rowsLevel, setRowsLevel] = useState<BulkLevel | null>(null);

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
  const [progress, setProgress] = useState<Progress | null>(null);
  const [editingBudget, setEditingBudget] = useState<{ id: string; value: string } | null>(null);

  const [budgetChange, setBudgetChange] = useState<BudgetChange>({ mode: 'increase', value: 20 });
  const [renameRule, setRenameRule] = useState<RenameRule>({ find: '', replace: '', prefix: '', suffix: '' });
  const [targetAdSets, setTargetAdSets] = useState<TargetAdSet[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set());
  const [targetSearch, setTargetSearch] = useState('');
  const [copyStatus, setCopyStatus] = useState<'PAUSED' | 'ACTIVE'>('PAUSED');

  const [textEdits, setTextEdits] = useState<Record<'primaryText' | 'title' | 'description', TextEdit>>({
    primaryText: { mode: 'keep' },
    title: { mode: 'keep' },
    description: { mode: 'keep' },
  });
  const [urlEdit, setUrlEdit] = useState<TextEdit>({ mode: 'set', value: '' });
  const [stripUtm, setStripUtm] = useState(true);
  const [urlTagsEdit, setUrlTagsEdit] = useState<UrlTagsEdit>({ mode: 'keep' });
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [pixelChoice, setPixelChoice] = useState('');
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [identityPageId, setIdentityPageId] = useState('');
  const [identityIgId, setIdentityIgId] = useState('');
  // Criativos conhecidos (atuais e recém-criados), para a tela e para desfazer.
  const creativeCache = useRef(new Map<string, Creative>());

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

    // Com campanha ou conjunto escolhido, a Meta já devolve só os filhos dele, em vez da conta inteira.
    const [scopeLevel, scopeIds] = scopeKey ? [scopeKey.slice(0, scopeKey.indexOf(':')), scopeKey.slice(scopeKey.indexOf(':') + 1).split(',')] : ['', []];
    const parentFilter = scopeLevel ? [{ field: `${scopeLevel}.id`, operator: 'IN', value: scopeIds }] : [];
    const filtering = JSON.stringify([...JSON.parse(statusFiltering(level, statusFilter)), ...parentFilter]);

    metaGetAll<Row>(`${accountId}/${LEVEL_EDGE[level]}`, { fields: FIELDS[level], filtering, limit: level === 'ad' ? 50 : 200 }, { maxPages: level === 'ad' ? 40 : 10, ...rateNotice })
      .then((list) => {
        if (alive) {
          setRows(list.map((row) => ({ ...row, name: row.name || row.id })));
          setRowsLevel(level);
        }
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

    metaGetAll<Record<string, any>>(`${accountId}/insights`, { level, fields: `${level}_id,spend,actions`, date_preset: period, limit: 500, ...(parentFilter.length ? { filtering: JSON.stringify(parentFilter) } : {}) }, { maxPages: 10, ...rateNotice })
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
  }, [accountId, level, statusFilter, period, reloadKey, rateNotice, scopeKey]);

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
        (!campaignFilter || row.campaign?.id === campaignFilter) &&
        (!activeScope || activeScope.ids.includes(scopeParentId(activeScope, row)))
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
  }, [rows, search, campaignFilter, activeScope, sort, metricOf]);

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
  // `failedBefore`: anúncios que já falharam numa etapa anterior (criativo novo
  // recusado) entram no mesmo resumo.
  // ── Janela de progresso ───────────────────────────────────────────────────
  const startProgress = (title: string, total: number, step: string) =>
    setProgress({ title, step, done: 0, total, logs: [], finished: false });
  const stepProgress = (step: string, total?: number) =>
    setProgress((current) => current && { ...current, step, total: total ?? current.total });
  const logProgress = (entries: ProgressLog[]) =>
    setProgress((current) => current && { ...current, done: Math.min(current.total, current.done + entries.length), logs: [...current.logs, ...entries] });
  const finishProgress = (summary: string, tone: Toast['tone']) =>
    setProgress((current) => current && { ...current, done: current.total, finished: true, step: 'Concluído', summary, tone });
  const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? id;

  /**
   * `progressMode`: 'new' abre a janela de progresso, 'continue' segue uma já
   * aberta (edição de anúncios, que antes cria os criativos) e 'none' não mostra
   * (um único item, como o interruptor da linha).
   */
  async function applyChanges(
    changes: BulkChange[],
    label: string,
    undoable = true,
    failedBefore: Record<string, RowResult> = {},
    progressMode: 'new' | 'continue' | 'none' = changes.length > 1 ? 'new' : 'none',
  ) {
    const earlyFailures = Object.keys(failedBefore).length;
    const track = progressMode !== 'none';
    if (changes.length === 0) {
      setResults(failedBefore);
      const firstEarly = Object.values(failedBefore)[0]?.message;
      const text = earlyFailures > 0
        ? `${label}: nenhum alterado. ${earlyFailures} com erro${firstEarly ? ` — ${firstEarly}` : ''}.`
        : `${label}: nada mudou.`;
      setToast({ text, tone: earlyFailures > 0 ? 'error' : 'warn', undo: null });
      if (track) finishProgress(text, earlyFailures > 0 ? 'error' : 'warn');
      setApplying(false);
      return;
    }
    setApplying(true);
    if (progressMode === 'new') startProgress(label, changes.length, 'Preparando');
    const outcome: Record<string, RowResult> = { ...failedBefore };
    for (let start = 0; start < changes.length; start += BATCH_SIZE) {
      const chunk = changes.slice(start, start + BATCH_SIZE);
      if (track) stepProgress(`Enviando à Meta: ${start + 1}–${start + chunk.length} de ${changes.length}`);
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
      if (track) {
        logProgress(chunk.map((change) => {
          const result = outcome[change.id];
          return { key: `apply-${change.id}`, name: nameOf(change.id), ok: Boolean(result?.ok), text: result?.ok ? `${label}: alterado` : result?.message || 'Erro sem detalhe da Meta' };
        }));
      }
    }
    const done = changes.filter((change) => outcome[change.id]?.ok);
    const byId = new Map(done.map((change) => [change.id, change.params]));
    setRows((current) => current.map((row) => (byId.has(row.id) ? applyLocal(row, byId.get(row.id)!, creativeCache.current) : row)));
    setResults(outcome);
    const total = changes.length + earlyFailures;
    const failed = total - done.length;
    const firstError = Object.values(outcome).find((result) => result && !result.ok)?.message;
    const text = failed === 0
      ? `${label}: ${done.length} ${done.length === 1 ? 'item alterado' : 'itens alterados'}.`
      : `${label}: ${done.length} de ${total} alterados. ${failed} com erro${firstError ? ` — ${firstError}` : ''}.`;
    const tone: Toast['tone'] = failed === 0 ? 'ok' : done.length > 0 ? 'warn' : 'error';
    setToast({ text, tone, undo: undoable && done.length > 0 ? undoChanges(done) : null });
    if (track) finishProgress(text, tone);
    setApplying(false);
    if (done.length > 0) setPanel(null);
  }

  const statusChanges = (status: 'ACTIVE' | 'PAUSED') =>
    changesFor(selectedRows, (row) => ({ params: { status }, previous: { status: row.status } }));

  // ── Texto, URL e rastreamento dos anúncios ────────────────────────────────
  const creativeEdit: CreativeEdit = useMemo(() => {
    if (panel === 'text') return { primaryText: textEdits.primaryText, title: textEdits.title, description: textEdits.description };
    if (panel === 'url') return { url: urlEdit, stripUtmFromUrl: stripUtm };
    if (panel === 'tracking') return { urlTags: urlTagsEdit, stripUtmFromUrl: urlTagsEdit.mode === 'set' && stripUtm };
    if (panel === 'identity') return identityPageId ? { identity: { pageId: identityPageId, instagramUserId: identityIgId || undefined } } : {};
    return {};
  }, [panel, textEdits, urlEdit, stripUtm, urlTagsEdit, identityPageId, identityIgId]);

  const creativePlans = useMemo(() => {
    if (panel !== 'text' && panel !== 'url' && panel !== 'tracking' && panel !== 'identity') return [];
    if (panel === 'identity' && !identityPageId) return [];
    return selectedRows.map((row) => ({ row, plan: planCreativeEdit(row.creative, creativeEdit, row.name) as CreativeEditPlan }));
  }, [panel, selectedRows, creativeEdit, identityPageId]);

  // Páginas que a conexão da agência administra, com o Instagram vinculado a cada uma.
  useEffect(() => {
    if (panel !== 'identity' || pages) return;
    let alive = true;
    setPagesError(null);
    metaGetAll<PageOption>('me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: 200 }, rateNotice)
      .then((list) => {
        if (alive) setPages([...list].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR')));
      })
      .catch((caught) => {
        if (alive) setPagesError(caught instanceof Error ? caught.message : 'Não foi possível listar as páginas.');
      });
    return () => {
      alive = false;
    };
  }, [panel, pages, rateNotice]);

  const pixelChanges = useMemo(() => {
    if (panel !== 'tracking' || !pixelChoice) return new Map<string, string>();
    return new Map(selectedRows.filter((row) => pixelOf(row.tracking_specs) !== pixelChoice).map((row) => [row.id, pixelTrackingSpecs(pixelChoice)]));
  }, [panel, pixelChoice, selectedRows]);

  /**
   * Cria um criativo novo por anúncio (texto, URL e parâmetros mudam ali) e
   * troca no anúncio junto com o pixel, numa chamada só por anúncio. Desfazer
   * volta o criativo e o pixel de antes.
   */
  async function applyAdEdits(label: string) {
    setApplying(true);
    const newCreativeByAd = new Map<string, string>();
    const failed: Record<string, RowResult> = {};
    const toCreate = creativePlans.filter((item): item is { row: Row; plan: Extract<CreativeEditPlan, { ok: true }> } => item.plan.ok);
    // Estimativa inicial: um criativo e uma troca por anúncio, mais os que só mudam o pixel.
    const pixelOnly = selectedRows.filter((row) => pixelChanges.has(row.id) && !toCreate.some((item) => item.row.id === row.id)).length;
    startProgress(label, toCreate.length * 2 + pixelOnly, toCreate.length > 0 ? 'Criando criativos novos' : 'Preparando');
    for (let start = 0; start < toCreate.length; start += BATCH_SIZE) {
      const chunk = toCreate.slice(start, start + BATCH_SIZE);
      stepProgress(`Criando criativos novos: ${start + 1}–${start + chunk.length} de ${toCreate.length}`);
      try {
        const response = await metaBatch(chunk.map((item) => buildBatchItem(`${accountId}/adcreatives`, item.plan.params)), rateNotice);
        response.forEach((item, index) => {
          const { row, plan } = chunk[index];
          let body: any = {};
          try {
            body = JSON.parse(item.body || '{}');
          } catch {
            body = {};
          }
          if (item.code === 200 && body.id) {
            newCreativeByAd.set(row.id, String(body.id));
            creativeCache.current.set(String(body.id), { ...(plan.creative as Creative), id: String(body.id), name: plan.params.name });
          } else {
            failed[row.id] = { ok: false, message: `Criativo novo recusado: ${body.error?.error_user_msg || body.error?.message || `HTTP ${item.code}`}` };
          }
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Falha ao falar com a Meta.';
        chunk.forEach(({ row }) => {
          failed[row.id] = { ok: false, message };
        });
      }
      logProgress(chunk.map(({ row }) => ({
        key: `creative-${row.id}`,
        name: row.name,
        ok: !failed[row.id],
        text: failed[row.id] ? failed[row.id].message || 'Criativo novo recusado' : 'Criativo novo criado',
      })));
    }
    for (const row of selectedRows) if (row.creative?.id) creativeCache.current.set(row.creative.id, row.creative);

    const changes = changesFor(selectedRows.filter((row) => !failed[row.id]), (row) => {
      const params: Record<string, string> = {};
      const previous: Record<string, string> = {};
      const newCreative = newCreativeByAd.get(row.id);
      if (newCreative && row.creative?.id) {
        params.creative = JSON.stringify({ creative_id: newCreative });
        previous.creative = JSON.stringify({ creative_id: row.creative.id });
      }
      const tracking = pixelChanges.get(row.id);
      if (tracking) {
        params.tracking_specs = tracking;
        previous.tracking_specs = JSON.stringify(Array.isArray(row.tracking_specs) ? row.tracking_specs : []);
      }
      return Object.keys(params).length > 0 ? { params, previous } : null;
    });
    stepProgress('Trocando nos anúncios', toCreate.length + changes.length);
    await applyChanges(changes, label, true, failed, 'continue');
  }

  const resetCreativeForms = (kind: AdPanel) => {
    setTextEdits({ primaryText: { mode: 'keep' }, title: { mode: 'keep' }, description: { mode: 'keep' } });
    setUrlEdit({ mode: 'set', value: '' });
    setUrlTagsEdit({ mode: 'keep' });
    setPixelChoice('');
    setIdentityPageId('');
    setIdentityIgId('');
    // Na troca de URL os utm_ digitados ficam; ao definir parâmetros, os de dentro da URL saem.
    setStripUtm(kind === 'tracking');
  };

  const adPanelHint = level === 'ad'
    ? undefined
    : `Abre os anúncios ${level === 'campaign' ? 'das campanhas' : 'dos conjuntos'} marcados para editar`;

  function openAdPanel(kind: AdPanel) {
    if (level === 'ad') {
      resetCreativeForms(kind);
      setPanel(kind);
      return;
    }
    const scoped = rows.filter((row) => selected.has(row.id));
    setParentScope({ level, ids: scoped.map((row) => row.id), names: scoped.map((row) => row.name) });
    setPendingPanel(kind);
    setCampaignFilter('');
    setLevel('ad');
  }

  /** Troca de nível. Descendo com itens marcados, o próximo nível mostra só os filhos deles. */
  function changeLevel(next: BulkLevel) {
    if (next === level) return;
    setCampaignFilter('');
    if (LEVEL_RANK[next] > LEVEL_RANK[level] && selected.size > 0) {
      const picked = rows.filter((row) => selected.has(row.id));
      setParentScope({ level: level as ParentScope['level'], ids: picked.map((row) => row.id), names: picked.map((row) => row.name) });
    } else if (!scopeFor(parentScope, next)) {
      setParentScope(null);
    }
    setLevel(next);
  }

  /** Atalho da linha: abre os conjuntos da campanha ou os anúncios do conjunto. */
  function drillInto(row: Row) {
    if (level === 'ad') return;
    setCampaignFilter('');
    setParentScope({ level: level as ParentScope['level'], ids: [row.id], names: [row.name] });
    setLevel(level === 'campaign' ? 'adset' : 'ad');
  }

  // Depois que os anúncios carregam, marca os das campanhas/conjuntos escolhidos e abre o painel.
  useEffect(() => {
    if (!pendingPanel || !parentScope || loading || rowsLevel !== 'ad' || level !== 'ad') return;
    const inScope = rows.filter((row) => parentScope.ids.includes((parentScope.level === 'campaign' ? row.campaign?.id : row.adset?.id) ?? ''));
    const kind = pendingPanel;
    setPendingPanel(null);
    if (inScope.length === 0) {
      setToast({ text: `Nenhum anúncio ${parentScope.level === 'campaign' ? 'nessas campanhas' : 'nesses conjuntos'} com o filtro de status atual.`, tone: 'warn', undo: null });
      return;
    }
    setSelected(new Set(inScope.map((row) => row.id)));
    resetCreativeForms(kind);
    setPanel(kind);
  }, [pendingPanel, parentScope, loading, rowsLevel, level, rows]);

  useEffect(() => {
    if (panel !== 'tracking' || !accountId) return;
    let alive = true;
    metaGetAll<Pixel>(`${accountId}/adspixels`, { fields: 'id,name', limit: 50 })
      .then((list) => {
        if (alive) setPixels(list);
      })
      .catch(() => {
        if (alive) setPixels([]);
      });
    return () => {
      alive = false;
    };
  }, [panel, accountId]);

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
    startProgress('Copiar para conjuntos', copyPairs.length, 'Preparando');
    let created = 0;
    const errors: string[] = [];
    for (let start = 0; start < copyPairs.length; start += BATCH_SIZE) {
      const chunk = copyPairs.slice(start, start + BATCH_SIZE);
      stepProgress(`Criando cópias: ${start + 1}–${start + chunk.length} de ${copyPairs.length}`);
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
        logProgress(response.map((item, index) => {
          const result = batchOutcome(item);
          if (result.ok) created += 1;
          else if (result.message) errors.push(result.message);
          const { ad, target } = chunk[index];
          return { key: `copy-${ad.id}-${target.id}`, name: `${ad.name} → ${target.name}`, ok: result.ok, text: result.ok ? 'Cópia criada' : result.message || 'Erro sem detalhe da Meta' };
        }));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Falha ao falar com a Meta.';
        errors.push(message);
        logProgress(chunk.map(({ ad, target }) => ({ key: `copy-${ad.id}-${target.id}`, name: `${ad.name} → ${target.name}`, ok: false, text: message })));
      }
    }
    setApplying(false);
    const text = errors.length === 0
      ? `${created} anúncio(s) criado(s) nos conjuntos escolhidos, ${copyStatus === 'ACTIVE' ? 'ativos' : 'pausados'}, com o mesmo criativo (curtidas e comentários continuam).`
      : `${created} de ${copyPairs.length} anúncio(s) criados. Erro: ${errors[0]}`;
    const tone: Toast['tone'] = errors.length === 0 ? 'ok' : created > 0 ? 'warn' : 'error';
    setToast({ text, tone, undo: null });
    finishProgress(text, tone);
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
          <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setCampaignFilter(''); setParentScope(null); }} className={clsx(inputClass, 'normal-case tracking-normal')}>
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
              <button key={key} type="button" role="radio" aria-checked={level === key} onClick={() => changeLevel(key)}
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
        <button type="button" disabled={selectedCount === 0 || applying} onClick={() => openAdPanel('text')} title={adPanelHint} className={ghostButton}><TextCursorInput size={13} /> Texto</button>
        <button type="button" disabled={selectedCount === 0 || applying} onClick={() => openAdPanel('url')} title={adPanelHint} className={ghostButton}><Link2 size={13} /> URL</button>
        <button type="button" disabled={selectedCount === 0 || applying} onClick={() => openAdPanel('tracking')} title={adPanelHint} className={ghostButton}><Radar size={13} /> Rastreamento</button>
        <button type="button" disabled={selectedCount === 0 || applying} onClick={() => openAdPanel('identity')} title={adPanelHint} className={ghostButton}><Flag size={13} /> Página e Instagram</button>
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

          {(panel === 'text' || panel === 'url' || panel === 'tracking' || panel === 'identity') && (() => {
            const ready = creativePlans.filter((item) => item.plan.ok);
            const skipped = creativePlans.filter((item) => !item.plan.ok);
            const affected = new Set([...ready.map((item) => item.row.id), ...pixelChanges.keys()]);
            const urlProblem = panel === 'url' && urlEdit.mode === 'set' ? (urlEdit.value.trim() ? validateDestinationUrl(urlEdit.value.trim()) : 'Informe a URL nova.') : null;
            const tagsProblem = panel === 'tracking' && urlTagsEdit.mode === 'set' && !urlTagsEdit.value.trim() ? 'Informe os parâmetros ou escolha "Remover".' : null;
            const identityProblem = panel === 'identity' && !identityPageId ? 'Escolha a página.' : null;
            const problem = urlProblem || tagsProblem || identityProblem;
            const title = panel === 'text' ? 'Texto' : panel === 'url' ? 'URL de destino' : panel === 'identity' ? 'Página e Instagram' : 'Rastreamento';
            const pageName = (id: string) => pages?.find((page) => page.id === id)?.name || id || '(nenhuma)';
            const igName = (id: string) => {
              const owner = pages?.find((page) => page.instagram_business_account?.id === id);
              return owner?.instagram_business_account?.username ? `@${owner.instagram_business_account.username}` : id || '(da página)';
            };
            const chosenPage = pages?.find((page) => page.id === identityPageId);
            const modeSelect = (value: string, onChange: (mode: string) => void, label: string, options: Array<[string, string]>) => (
              <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={clsx(inputClass, 'py-1.5')}>
                {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              </select>
            );
            const beforeAfter = (plan: Extract<CreativeEditPlan, { ok: true }>) => {
              const pairs: Array<[string, string, string]> = [];
              if (panel === 'text') {
                if (plan.before.primaryText !== plan.after.primaryText) pairs.push(['Texto', plan.before.primaryText, plan.after.primaryText]);
                if (plan.before.title !== plan.after.title) pairs.push(['Título', plan.before.title, plan.after.title]);
                if (plan.before.description !== plan.after.description) pairs.push(['Descrição', plan.before.description, plan.after.description]);
              } else if (panel === 'identity') {
                if (plan.before.pageId !== plan.after.pageId) pairs.push(['Página', pageName(plan.before.pageId), pageName(plan.after.pageId)]);
                if (plan.before.instagramUserId !== plan.after.instagramUserId) pairs.push(['Instagram', igName(plan.before.instagramUserId), igName(plan.after.instagramUserId)]);
              } else {
                if (plan.before.url !== plan.after.url) pairs.push(['URL', plan.before.url, plan.after.url]);
                if (plan.before.urlTags !== plan.after.urlTags) pairs.push(['Parâmetros', plan.before.urlTags || '(nenhum)', plan.after.urlTags || '(nenhum)']);
              }
              return pairs;
            };
            return (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{title} de {plural(selectedCount, 'anúncio')}</h3>

                {panel === 'text' && (
                  <div className="space-y-2">
                    {([['primaryText', 'Texto principal'], ['title', 'Título'], ['description', 'Descrição']] as const).map(([field, label]) => {
                      const edit = textEdits[field];
                      const setEdit = (next: TextEdit) => setTextEdits((current) => ({ ...current, [field]: next }));
                      return (
                        <div key={field} className="grid items-start gap-2 sm:grid-cols-[130px_190px_1fr]">
                          <span className="pt-2 text-xs font-semibold text-[var(--color-text)]">{label}</span>
                          {modeSelect(edit.mode, (mode) => setEdit(mode === 'set' ? { mode: 'set', value: '' } : mode === 'replace' ? { mode: 'replace', find: '', replace: '' } : { mode: 'keep' }), `Como mudar ${label}`, [['keep', 'Não alterar'], ['set', 'Trocar por'], ['replace', 'Localizar e substituir']])}
                          {edit.mode === 'set' && (field === 'primaryText'
                            ? <textarea rows={3} value={edit.value} onChange={(event) => setEdit({ mode: 'set', value: event.target.value })} aria-label={`Novo ${label}`} placeholder="Texto novo" className={clsx(inputClass, 'w-full resize-y')} />
                            : <input value={edit.value} onChange={(event) => setEdit({ mode: 'set', value: event.target.value })} aria-label={`Novo ${label}`} placeholder={`${label} novo`} className={clsx(inputClass, 'w-full')} />)}
                          {edit.mode === 'replace' && (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input value={edit.find} onChange={(event) => setEdit({ ...edit, find: event.target.value })} aria-label={`Localizar em ${label}`} placeholder="Localizar" className={inputClass} />
                              <input value={edit.replace} onChange={(event) => setEdit({ ...edit, replace: event.target.value })} aria-label={`Substituir em ${label}`} placeholder="Substituir por" className={inputClass} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <p className="text-[11px] leading-5 text-[var(--color-text-faint)]">Em anúncios com várias opções de texto, "Localizar e substituir" muda todas; "Trocar por" deixa uma só.</p>
                  </div>
                )}

                {panel === 'url' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {modeSelect(urlEdit.mode, (mode) => setUrlEdit(mode === 'replace' ? { mode: 'replace', find: '', replace: '' } : { mode: 'set', value: '' }), 'Como mudar a URL', [['set', 'Trocar por'], ['replace', 'Localizar e substituir']])}
                      {urlEdit.mode === 'set' && <input value={urlEdit.value} onChange={(event) => setUrlEdit({ mode: 'set', value: event.target.value })} aria-label="URL nova" placeholder="https://..." className={clsx(inputClass, 'min-w-[280px] flex-1')} />}
                      {urlEdit.mode === 'replace' && (
                        <>
                          <input value={urlEdit.find} onChange={(event) => setUrlEdit({ ...urlEdit, find: event.target.value })} aria-label="Localizar na URL" placeholder="Localizar (ex.: /mba-black)" className={clsx(inputClass, 'min-w-[200px] flex-1')} />
                          <input value={urlEdit.replace} onChange={(event) => setUrlEdit({ ...urlEdit, replace: event.target.value })} aria-label="Substituir na URL" placeholder="Substituir por (ex.: /mba)" className={clsx(inputClass, 'min-w-[200px] flex-1')} />
                        </>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <input type="checkbox" checked={stripUtm} onChange={(event) => setStripUtm(event.target.checked)} />
                      Tirar os parâmetros utm_ que estão dentro da URL
                    </label>
                    {urlProblem && urlEdit.mode === 'set' && urlEdit.value.trim() && <p role="alert" className="text-xs text-red-300">{urlProblem}</p>}
                    <p className="text-[11px] leading-5 text-[var(--color-text-faint)]">Anúncios de WhatsApp, Messenger e formulário não têm URL de site e ficam de fora.</p>
                  </div>
                )}

                {panel === 'identity' && (
                  <div className="space-y-2">
                    {!pages && !pagesError && <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Loader2 size={13} className="animate-spin" /> Carregando páginas...</p>}
                    {pagesError && <p role="alert" className="text-xs text-red-300">{pagesError}</p>}
                    {pages && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text)]">
                          Página do Facebook
                          <select
                            value={identityPageId}
                            onChange={(event) => {
                              const next = pages.find((page) => page.id === event.target.value);
                              setIdentityPageId(event.target.value);
                              // Sugere o Instagram vinculado à página escolhida.
                              setIdentityIgId(next?.instagram_business_account?.id ?? '');
                            }}
                            className={clsx(inputClass, 'py-1.5 font-normal')}
                          >
                            <option value="">Escolha a página</option>
                            {pages.map((page) => <option key={page.id} value={page.id}>{page.name || page.id}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--color-text)]">
                          Perfil do Instagram
                          <select value={identityIgId} onChange={(event) => setIdentityIgId(event.target.value)} disabled={!identityPageId} className={clsx(inputClass, 'py-1.5 font-normal')}>
                            <option value="">Manter o perfil atual do anúncio</option>
                            {pages.filter((page) => page.instagram_business_account).map((page) => (
                              <option key={page.instagram_business_account!.id} value={page.instagram_business_account!.id}>
                                @{page.instagram_business_account!.username || page.instagram_business_account!.id}{page.id === identityPageId ? ' (vinculado à página)' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    {chosenPage && !chosenPage.instagram_business_account && <p className="text-[11px] text-amber-200">Essa página não tem Instagram vinculado. Escolha um perfil ou mantenha o atual.</p>}
                    <p className="text-[11px] leading-5 text-[var(--color-text-faint)]">Só aparecem páginas que a conexão da agência administra. Anúncios de formulário de lead ficam de fora, porque o formulário pertence à página atual. Em anúncios de WhatsApp, o número precisa estar ligado à página nova.</p>
                  </div>
                )}

                {panel === 'tracking' && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--color-text)]">Parâmetros de URL</span>
                        {modeSelect(urlTagsEdit.mode, (mode) => setUrlTagsEdit(mode === 'set' ? { mode: 'set', value: META_UTM_TEMPLATE.replace(/^\?/, '') } : mode === 'remove' ? { mode: 'remove' } : { mode: 'keep' }), 'Parâmetros de URL', [['keep', 'Não alterar'], ['set', 'Definir'], ['remove', 'Remover']])}
                      </div>
                      {urlTagsEdit.mode === 'set' && (
                        <>
                          <textarea rows={2} value={urlTagsEdit.value} onChange={(event) => setUrlTagsEdit({ mode: 'set', value: event.target.value })} aria-label="Parâmetros de URL" className={clsx(inputClass, 'w-full resize-y font-mono text-xs')} />
                          <div className="flex flex-wrap items-center gap-3">
                            <button type="button" onClick={() => setUrlTagsEdit({ mode: 'set', value: META_UTM_TEMPLATE.replace(/^\?/, '') })} className={ghostButton}>Usar o padrão da agência</button>
                            <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                              <input type="checkbox" checked={stripUtm} onChange={(event) => setStripUtm(event.target.checked)} />
                              Tirar os utm_ de dentro da URL (evita parâmetro duplicado)
                            </label>
                          </div>
                          <p className="text-[11px] leading-5 text-[var(--color-text-faint)]">Variáveis da Meta: {'{{campaign.name}}'}, {'{{adset.name}}'}, {'{{ad.name}}'}, {'{{placement}}'}, {'{{ad.id}}'}.</p>
                        </>
                      )}
                      {tagsProblem && <p role="alert" className="text-xs text-red-300">{tagsProblem}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--color-text)]">Pixel (eventos do site)</span>
                      <select aria-label="Pixel" value={pixelChoice} onChange={(event) => setPixelChoice(event.target.value)} className={clsx(inputClass, 'py-1.5')}>
                        <option value="">Não alterar</option>
                        {pixels.map((pixel) => <option key={pixel.id} value={pixel.id}>{pixel.name || pixel.id}</option>)}
                      </select>
                      {pixelChoice && <span className="text-xs text-[var(--color-text-muted)]">{pixelChanges.size} anúncio(s) mudam de pixel (sem criativo novo).</span>}
                    </div>
                  </div>
                )}

                {ready.length > 0 && (
                  <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    A Meta não deixa editar um criativo: para cada anúncio o sistema cria um criativo novo com a mudança e troca no anúncio. O anúncio volta para análise e a publicação nova começa sem as curtidas e comentários da anterior. Desfazer volta o criativo antigo.
                  </p>
                )}

                {ready.length > 0 && (
                  <ul className="max-h-60 space-y-2 overflow-y-auto rounded-xl border border-[var(--color-border)] p-2.5 text-xs">
                    {ready.slice(0, 40).map(({ row, plan }) => plan.ok && (
                      <li key={row.id} className="space-y-0.5">
                        <span className="block truncate font-semibold text-[var(--color-text)]">{row.name}</span>
                        {beforeAfter(plan).map(([label, before, after]) => (
                          <span key={label} className="grid gap-x-2 sm:grid-cols-[80px_1fr_1fr]">
                            <span className="text-[var(--color-text-faint)]">{label}</span>
                            <span className="truncate text-[var(--color-text-muted)] line-through decoration-[var(--color-text-faint)]" title={before}>{before || '(vazio)'}</span>
                            <span className="truncate text-[var(--color-text)]" title={after}>{after || '(vazio)'}</span>
                          </span>
                        ))}
                      </li>
                    ))}
                    {ready.length > 40 && <li className="text-[var(--color-text-faint)]">e mais {ready.length - 40}...</li>}
                  </ul>
                )}

                {skipped.length > 0 && (
                  <details className="text-xs text-[var(--color-text-muted)]">
                    <summary className="cursor-pointer">{skipped.length} anúncio(s) ficam como estão</summary>
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {skipped.slice(0, 30).map(({ row, plan }) => !plan.ok && <li key={row.id}><span className="text-[var(--color-text)]">{row.name}</span>: {plan.reason}</li>)}
                    </ul>
                  </details>
                )}

                <div className="flex gap-2">
                  <button type="button" disabled={applying || affected.size === 0 || Boolean(problem)} onClick={() => void applyAdEdits(title)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                    {applying ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Aplicar em {affected.size}
                  </button>
                  <button type="button" onClick={() => setPanel(null)} className={ghostButton}>Cancelar</button>
                </div>
              </div>
            );
          })()}

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

      {activeScope && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-brand)]/35 bg-[var(--color-brand)]/[0.06] px-3 py-2 text-xs text-[var(--color-text)]">
          <span className="min-w-0 flex-1 truncate" title={activeScope.names.join(' · ')}>
            {level === 'adset' ? 'Conjuntos' : 'Anúncios'} {activeScope.level === 'campaign' ? (activeScope.ids.length > 1 ? 'das campanhas' : 'da campanha') : (activeScope.ids.length > 1 ? 'dos conjuntos' : 'do conjunto')}: <strong>{activeScope.names.slice(0, 3).join(' · ')}</strong>{activeScope.names.length > 3 ? ` e mais ${activeScope.names.length - 3}` : ''}
          </span>
          <button type="button" onClick={() => setParentScope(null)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X size={12} /> Ver todos da conta
          </button>
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
                        {level !== 'ad' && (
                          <button type="button" onClick={() => drillInto(row)} className="mt-0.5 inline-flex items-center gap-0.5 rounded text-[11px] font-medium text-[var(--color-brand)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50">
                            {level === 'campaign' ? 'Ver conjuntos' : 'Ver anúncios'} <ChevronRight size={12} aria-hidden="true" />
                          </button>
                        )}
                        {level === 'ad' && (() => {
                          const info = describeCreative(row.creative);
                          const hasUtm = Boolean(info.urlTags) || /[?&]utm_/i.test(info.url);
                          if (!info.url && !info.urlTags) return null;
                          return (
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                              <Link2 size={11} className="shrink-0" aria-hidden="true" />
                              <span className="truncate" title={`${info.url}${info.urlTags ? `\nParâmetros: ${info.urlTags}` : ''}`}>{info.url.replace(/^https?:\/\//, '') || 'sem URL de site'}</span>
                              {hasUtm && <span className="shrink-0 rounded border border-sky-400/30 px-1 text-[9px] font-semibold text-sky-200" title={info.urlTags || 'UTM dentro da URL'}>UTM</span>}
                            </span>
                          );
                        })()}
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
      {progress && <ProgressDialog progress={progress} onClose={() => setProgress(null)} />}
    </section>
  );
}

const PROGRESS_TONE: Record<Toast['tone'], string> = {
  ok: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
  warn: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  error: 'border-red-400/30 bg-red-500/10 text-red-100',
};

/** Janela com a porcentagem e o registro de cada item enquanto o lote vai para a Meta. */
function ProgressDialog({ progress, onClose }: { progress: Progress; onClose: () => void }) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : progress.finished ? 100 : 0;
  const errors = progress.logs.filter((log) => !log.ok).length;
  const oks = progress.logs.length - errors;
  const visible = onlyErrors ? progress.logs.filter((log) => !log.ok) : progress.logs;

  // Acompanha o fim da lista enquanto chegam registros novos.
  useEffect(() => {
    if (!onlyErrors && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [progress.logs.length, onlyErrors]);

  useEffect(() => {
    if (progress.finished) closeRef.current?.focus();
  }, [progress.finished]);

  useEffect(() => {
    if (!progress.finished) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [progress.finished, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="bulk-progress-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="bulk-progress-title" className="text-base font-semibold text-[var(--color-text)]">{progress.title}</h3>
            <p aria-live="polite" className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              {!progress.finished && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
              {progress.step}
            </p>
          </div>
          <span className="shrink-0 text-2xl font-semibold tabular-nums text-[var(--color-text)]">{percent}%</span>
        </div>

        <div role="progressbar" aria-label="Progresso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-bg)]">
          <div
            className={clsx('h-full rounded-full transition-[width] duration-300', progress.finished && progress.tone === 'error' ? 'bg-red-400' : progress.finished && progress.tone === 'warn' ? 'bg-amber-400' : 'bg-[var(--color-brand)]')}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-[var(--color-text-muted)]">{progress.done} de {progress.total}</span>
          <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 size={12} aria-hidden="true" /> {oks} ok</span>
          <span className={clsx('inline-flex items-center gap-1', errors > 0 ? 'text-red-300' : 'text-[var(--color-text-faint)]')}><AlertTriangle size={12} aria-hidden="true" /> {errors} com erro</span>
          <label className="ml-auto inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <input type="checkbox" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} disabled={errors === 0} /> Só erros
          </label>
        </div>

        <ol ref={listRef} aria-label="Registro da edição" className="mt-2 min-h-[160px] flex-1 overflow-y-auto rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-bg)] p-2 font-mono text-[11px] leading-5">
          {visible.length === 0 && <li className="px-1 text-[var(--color-text-faint)]">{progress.finished ? 'Nada para mostrar.' : 'Aguardando a primeira resposta da Meta...'}</li>}
          {visible.map((log, index) => (
            <li key={`${log.key}-${index}`} className="flex gap-2 px-1">
              {log.ok
                ? <CheckCircle2 size={12} className="mt-1 shrink-0 text-emerald-300" aria-label="ok" />
                : <AlertTriangle size={12} className="mt-1 shrink-0 text-red-300" aria-label="erro" />}
              <span className="min-w-0 break-words">
                <span className="text-[var(--color-text)]">{log.name}</span>
                <span className={log.ok ? 'text-[var(--color-text-muted)]' : 'text-red-300'}> — {log.text}</span>
              </span>
            </li>
          ))}
        </ol>

        {progress.finished && progress.summary && progress.tone && (
          <p role="status" className={clsx('mt-3 rounded-xl border px-3 py-2 text-xs', PROGRESS_TONE[progress.tone])}>{progress.summary}</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--color-text-faint)]">
            {progress.finished ? 'O botão Desfazer continua disponível no aviso da página.' : 'Não feche nem recarregue a página até terminar.'}
          </p>
          <button ref={closeRef} type="button" onClick={onClose} disabled={!progress.finished} className={ghostButton}>
            {progress.finished ? 'Fechar' : 'Aplicando...'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status?: string }) {
  const info = statusInfo(status);
  return <span className={clsx('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE_CLASS[info.tone])}>{info.label}</span>;
}
