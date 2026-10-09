// Edge Function: optimization-ia
//
// Único caminho de escrita do módulo Otimização IA.
//
//   - Cron (pg_cron, a cada hora): header `x-cron-secret`. Avalia os perfis
//     ativos que estão no horário e expira aprovações vencidas.
//   - Painel: JWT do usuário com a ferramenta `optimization_ia` (ou admin).
//     Operações: state, accounts, campaigns, save_profile, archive_profile,
//     emergency_stop, simulate, evaluate, decide.
//
// O token da Meta nunca sai do servidor: vem da conexão OAuth da agência,
// a mesma usada pelo meta-proxy e pelo resumo diário.
// Toda escrita na Meta passa por `checkExecution` imediatamente antes do envio.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  TARGET_EVENT_VALUES,
  checkExecution,
  evaluateProfile,
  evaluationWindow,
  strategyDefaults,
  totalsFromInsight,
  validateRule,
  type ActionStatus,
  type ActionType,
  type Evaluation,
  type HistoryEntry,
  type InsightRow,
  type Mode,
  type ProfileSettings,
  type Proposal,
  type ProposalPayload,
  type ResourceSnapshot,
  type RuleDefinition,
  type Strategy,
} from './engine.ts';

const GRAPH = 'https://graph.facebook.com/v24.0';
const TOOL = 'optimization_ia';
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004]);
const CRON_TIME_BUDGET_MS = 110_000;
const MANUAL_MIN_INTERVAL_MS = 2 * 60_000;
const DAY_MS = 24 * 3600_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, message: string, status = 400) => json({ error, message }, status);

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Caller = { organizationId: string; userId: string | null; isAdmin: boolean };

class GraphFailure extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

// ── Meta ─────────────────────────────────────────────────────────────────────

type MetaAuth = { token: string; proof: string | null };
type RunFailureStatus = 'RATE_LIMITED' | 'PERMISSION_ERROR' | 'TOKEN_EXPIRED' | 'DISCONNECTED' | 'FAILED';

async function appsecretProof(token: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function metaAuthFor(admin: Admin, organizationId: string): Promise<MetaAuth | { status: RunFailureStatus; message: string }> {
  const { data: connection } = await admin
    .from('meta_oauth_connections')
    .select('id, status, expires_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!connection || connection.status !== 'CONNECTED') {
    return { status: 'DISCONNECTED', message: 'A agência não está conectada à Meta. Reconecte em Configurações › APIs.' };
  }
  if (connection.expires_at && new Date(connection.expires_at).getTime() < Date.now()) {
    return { status: 'TOKEN_EXPIRED', message: 'A credencial da Meta expirou. Reconecte em Configurações › APIs.' };
  }
  const { data: token } = await admin.rpc('meta_oauth_secret_get', { p_connection_id: connection.id });
  if (!token) return { status: 'DISCONNECTED', message: 'Credencial da Meta ausente. Reconecte a agência.' };
  const secret = Deno.env.get('META_APP_SECRET');
  return { token: token as string, proof: secret ? await appsecretProof(token as string, secret) : null };
}

function graphError(payload: Row): GraphFailure {
  const error = payload?.error ?? {};
  return new GraphFailure(String(error.error_user_msg || error.message || 'Falha na Meta.'), Number(error.code) || 0);
}

async function graph(meta: MetaAuth, method: 'GET' | 'POST', path: string, params: Record<string, string> = {}): Promise<Row> {
  const query = new URLSearchParams({ ...params, access_token: meta.token });
  if (meta.proof) query.set('appsecret_proof', meta.proof);
  const response = method === 'GET'
    ? await fetch(`${GRAPH}/${path}?${query}`, { signal: AbortSignal.timeout(30_000) })
    : await fetch(`${GRAPH}/${path}`, { method: 'POST', body: query, signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({}));
  if (payload?.error) throw graphError(payload);
  if (!response.ok) throw new GraphFailure(`HTTP ${response.status}`, response.status);
  return payload;
}

async function graphAll(meta: MetaAuth, path: string, params: Record<string, string>, maxPages = 10): Promise<Row[]> {
  const rows: Row[] = [];
  let payload = await graph(meta, 'GET', path, params);
  for (let page = 1; ; page++) {
    rows.push(...(payload.data ?? []));
    // O `next` da Meta traz o token embutido; só é seguido aqui, no servidor.
    const next = payload.paging?.next;
    if (!next || page >= maxPages) break;
    const response = await fetch(next, { signal: AbortSignal.timeout(30_000) });
    payload = await response.json().catch(() => ({}));
    if (payload?.error) throw graphError(payload);
  }
  return rows;
}

function describeFailure(error: unknown): { status: RunFailureStatus; message: string; code: string | null } {
  if (error instanceof GraphFailure) {
    if (RATE_LIMIT_CODES.has(error.code)) {
      return { status: 'RATE_LIMITED', message: 'Limite de requisições da Meta. O próximo ciclo tenta de novo.', code: String(error.code) };
    }
    if (error.code === 190) {
      return { status: 'TOKEN_EXPIRED', message: 'A credencial da Meta expirou ou foi revogada. Reconecte em Configurações › APIs.', code: '190' };
    }
    if (error.code === 10 || (error.code >= 200 && error.code < 300)) {
      return { status: 'PERMISSION_ERROR', message: `Sem permissão na conta: ${error.message}`.slice(0, 500), code: String(error.code) };
    }
    return { status: 'FAILED', message: `[${error.code}] ${error.message}`.slice(0, 500), code: String(error.code) };
  }
  const message = error instanceof Error ? error.message : 'Falha desconhecida.';
  return { status: 'FAILED', message: message.slice(0, 500), code: null };
}

async function noteTokenFailure(admin: Admin, organizationId: string, status: RunFailureStatus, message: string) {
  if (status !== 'TOKEN_EXPIRED') return;
  await admin.from('meta_oauth_connections').update({ status: 'ERROR', last_error: message }).eq('organization_id', organizationId);
}

// ── Conversões de linhas ─────────────────────────────────────────────────────

const toNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? null : parsed;
};

function settingsOf(profile: Row, currency?: string): ProfileSettings {
  return {
    id: profile.id,
    mode: profile.mode as Mode,
    enabled: Boolean(profile.enabled),
    emergencyStop: Boolean(profile.emergency_stop),
    targetCpaCents: Number(profile.target_cpa_cents),
    currency: currency ?? profile.currency,
    maxDailyBudgetCents: toNumber(profile.max_daily_budget_cents),
    minDailyBudgetCents: Number(profile.min_daily_budget_cents),
    maxBudgetChangePct: Number(profile.max_budget_change_pct),
    cooldownHours: Number(profile.cooldown_hours),
    maturityHours: Number(profile.maturity_hours),
    maxActionsPerDay: Number(profile.max_actions_per_day),
  };
}

function ruleFromRow(row: Row): RuleDefinition {
  return {
    key: row.rule_key,
    name: row.name,
    description: row.description ?? '',
    scope: row.scope,
    priority: row.priority,
    minimums: row.minimums ?? {},
    all: row.conditions?.all ?? [],
    any: row.conditions?.any ?? [],
    action: row.action_definition,
    cooldown_hours: row.cooldown_hours,
    enabled: row.enabled,
    diagnosis: row.diagnosis ?? { causes: [], recommendation: '', risk: '' },
  };
}

function ruleToRow(rule: RuleDefinition, organizationId: string, profileId: string) {
  return {
    organization_id: organizationId,
    profile_id: profileId,
    rule_key: rule.key,
    name: rule.name,
    description: rule.description,
    scope: rule.scope,
    priority: rule.priority,
    minimums: rule.minimums,
    conditions: { all: rule.all, any: rule.any },
    action_definition: rule.action,
    diagnosis: rule.diagnosis,
    cooldown_hours: rule.cooldown_hours,
    enabled: rule.enabled,
  };
}

async function loadProfile(admin: Admin, organizationId: string, profileId: unknown): Promise<Row | null> {
  if (typeof profileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(profileId)) return null;
  const { data } = await admin
    .from('optimization_profiles')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', profileId)
    .is('archived_at', null)
    .maybeSingle();
  return data ?? null;
}

async function loadRules(admin: Admin, profileId: string): Promise<{ rules: RuleDefinition[]; versions: Map<string, number> }> {
  const { data } = await admin.from('optimization_rules').select('*').eq('profile_id', profileId);
  const rows = (data ?? []) as Row[];
  return { rules: rows.map(ruleFromRow), versions: new Map(rows.map((row) => [row.rule_key as string, row.rule_version as number])) };
}

async function loadHistory(admin: Admin, profileId: string): Promise<Array<HistoryEntry & { id: string }>> {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const { data } = await admin
    .from('optimization_actions')
    .select('id, resource_id, action_type, status, created_at, executed_at')
    .eq('profile_id', profileId)
    .gte('created_at', since)
    .limit(3000);
  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    resourceId: row.resource_id,
    actionType: row.action_type as ActionType,
    status: row.status as ActionStatus,
    createdAt: row.created_at,
    executedAt: row.executed_at,
  }));
}

async function logEvent(admin: Admin, event: { organizationId: string; profileId?: string | null; actionId?: string | null; actorId?: string | null; type: string; message: string; details?: Row }) {
  await admin.from('optimization_events').insert({
    organization_id: event.organizationId,
    profile_id: event.profileId ?? null,
    action_id: event.actionId ?? null,
    actor_id: event.actorId ?? null,
    event_type: event.type,
    message: event.message.slice(0, 500),
    details: event.details ?? {},
  });
}

// ── Coleta do escopo do perfil ───────────────────────────────────────────────

type Scope = {
  resources: ResourceSnapshot[];
  activeDailyBudgetCents: number;
  currency: string;
  timezone: string;
  accountName: string;
  window: ReturnType<typeof evaluationWindow>;
};

const positive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

async function loadEntities(meta: MetaAuth, profile: Row) {
  const scope = new Set<string>(profile.campaign_ids ?? []);
  const inScope = (campaignId: string) => scope.size === 0 || scope.has(campaignId);
  const statusFilter = (values: string[]) => JSON.stringify([{ field: 'effective_status', operator: 'IN', value: values }]);
  const campaigns = (await graphAll(meta, `${profile.ad_account_id}/campaigns`, {
    fields: 'id,name,effective_status,status,daily_budget,lifetime_budget,created_time',
    filtering: statusFilter(['ACTIVE', 'PAUSED']),
    limit: '200',
  })).filter((campaign) => inScope(String(campaign.id)));
  const adsets = (await graphAll(meta, `${profile.ad_account_id}/adsets`, {
    fields: 'id,name,campaign_id,effective_status,status,daily_budget,lifetime_budget,created_time',
    filtering: statusFilter(['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED']),
    limit: '200',
  })).filter((adset) => inScope(String(adset.campaign_id)));
  return { scope, campaigns, adsets };
}

/** Soma dos orçamentos diários que estão gastando agora (CBO na campanha, ABO nos conjuntos). */
function activeDailyBudget(campaigns: Row[], adsets: Row[]): number {
  let total = 0;
  const campaignHasBudget = new Map<string, boolean>();
  for (const campaign of campaigns) {
    const hasBudget = positive(campaign.daily_budget) !== null || positive(campaign.lifetime_budget) !== null;
    campaignHasBudget.set(String(campaign.id), hasBudget);
    if (campaign.effective_status === 'ACTIVE') total += positive(campaign.daily_budget) ?? 0;
  }
  for (const adset of adsets) {
    if (adset.effective_status !== 'ACTIVE' || campaignHasBudget.get(String(adset.campaign_id))) continue;
    total += positive(adset.daily_budget) ?? 0;
  }
  return total;
}

async function loadScope(meta: MetaAuth, profile: Row, now: Date): Promise<Scope> {
  const account = await graph(meta, 'GET', profile.ad_account_id, { fields: 'name,currency,timezone_name' });
  const timezone = String(account.timezone_name || profile.account_timezone || 'America/Sao_Paulo');
  const window = evaluationWindow(timezone, Number(profile.lookback_days), now);
  const { scope, campaigns, adsets } = await loadEntities(meta, profile);

  const insights = async (level: 'campaign' | 'adset', range: { since: string; until: string }) => {
    const params: Record<string, string> = {
      level,
      fields: `campaign_id${level === 'adset' ? ',adset_id' : ''},spend,impressions,reach,frequency,inline_link_clicks,actions,action_values`,
      time_range: JSON.stringify(range),
      limit: '500',
    };
    if (scope.size > 0) params.filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: [...scope] }]);
    const rows = await graphAll(meta, `${profile.ad_account_id}/insights`, params);
    return new Map<string, InsightRow>(rows.map((row) => [String(level === 'adset' ? row.adset_id : row.campaign_id), row as InsightRow]));
  };
  // Em sequência, não em paralelo: rajadas aceleram o limite de requisições da conta.
  const campaignCurrent = await insights('campaign', window.current);
  const campaignPrevious = await insights('campaign', window.previous);
  const adsetCurrent = await insights('adset', window.current);
  const adsetPrevious = await insights('adset', window.previous);

  const event = String(profile.target_event);
  const campaignById = new Map(campaigns.map((campaign) => [String(campaign.id), campaign]));
  const resources: ResourceSnapshot[] = [];
  for (const campaign of campaigns) {
    const daily = positive(campaign.daily_budget);
    const lifetime = positive(campaign.lifetime_budget);
    resources.push({
      level: 'CAMPAIGN',
      id: String(campaign.id),
      name: String(campaign.name ?? campaign.id),
      campaignId: String(campaign.id),
      campaignName: String(campaign.name ?? campaign.id),
      effectiveStatus: String(campaign.effective_status),
      createdTime: campaign.created_time ?? null,
      budget: daily !== null
        ? { owner: 'CAMPAIGN', field: 'daily_budget', cents: daily }
        : lifetime !== null
          ? { owner: 'CAMPAIGN', field: 'lifetime_budget', cents: lifetime }
          : { owner: 'ADSET', field: null, cents: null },
      current: totalsFromInsight(campaignCurrent.get(String(campaign.id)), event),
      previous: totalsFromInsight(campaignPrevious.get(String(campaign.id)), event),
    });
  }
  for (const adset of adsets) {
    const parent = campaignById.get(String(adset.campaign_id));
    const daily = positive(adset.daily_budget);
    const lifetime = positive(adset.lifetime_budget);
    const parentDaily = positive(parent?.daily_budget);
    const parentLifetime = positive(parent?.lifetime_budget);
    resources.push({
      level: 'ADSET',
      id: String(adset.id),
      name: String(adset.name ?? adset.id),
      campaignId: String(adset.campaign_id),
      campaignName: String(parent?.name ?? adset.campaign_id),
      effectiveStatus: String(adset.effective_status),
      createdTime: adset.created_time ?? null,
      budget: daily !== null
        ? { owner: 'ADSET', field: 'daily_budget', cents: daily }
        : lifetime !== null
          ? { owner: 'ADSET', field: 'lifetime_budget', cents: lifetime }
          : parentDaily !== null
            ? { owner: 'CAMPAIGN', field: 'daily_budget', cents: parentDaily }
            : parentLifetime !== null
              ? { owner: 'CAMPAIGN', field: 'lifetime_budget', cents: parentLifetime }
              : { owner: null, field: null, cents: null },
      current: totalsFromInsight(adsetCurrent.get(String(adset.id)), event),
      previous: totalsFromInsight(adsetPrevious.get(String(adset.id)), event),
    });
  }

  return {
    resources,
    activeDailyBudgetCents: activeDailyBudget(campaigns, adsets),
    currency: String(account.currency || profile.currency || 'BRL'),
    timezone,
    accountName: String(account.name ?? profile.ad_account_name ?? ''),
    window,
  };
}

// ── Ciclo de avaliação ───────────────────────────────────────────────────────

type RunOptions = { trigger: 'CRON' | 'MANUAL'; simulate?: boolean; rules?: RuleDefinition[]; actorId?: string | null };

function summarize(evaluations: Evaluation[]) {
  const counts: Record<string, number> = {};
  for (const evaluation of evaluations) counts[evaluation.decision] = (counts[evaluation.decision] ?? 0) + 1;
  const blocked = evaluations
    .filter((evaluation) => evaluation.decision === 'BLOCKED')
    .slice(0, 30)
    .map((evaluation) => ({ rule: evaluation.ruleName, resource: evaluation.resourceName, level: evaluation.level, reasons: evaluation.reasons }));
  return { counts, blocked };
}

function actionRow(proposal: Proposal, profile: Row, settings: ProfileSettings, runId: string | null, version: number | undefined, now: Date) {
  const isWrite = proposal.actionType !== 'ALERT';
  const needsApproval = isWrite && (settings.mode === 'APPROVAL' || settings.mode === 'AUTO_LIMITED');
  return {
    organization_id: profile.organization_id,
    profile_id: profile.id,
    run_id: runId,
    rule_key: proposal.ruleKey,
    rule_version: version ?? null,
    ad_account_id: profile.ad_account_id,
    resource_level: proposal.level,
    resource_id: proposal.resourceId,
    resource_name: proposal.resourceName,
    campaign_id: proposal.campaignId,
    action_type: proposal.actionType,
    source: 'RULE_ENGINE',
    severity: proposal.severity,
    status: needsApproval ? 'PENDING_APPROVAL' : 'PROPOSED',
    title: proposal.title,
    reason: proposal.reason,
    risk: proposal.risk,
    diagnosis: proposal.diagnosis,
    evidence: proposal.evidence,
    requested_payload: proposal.payload,
    idempotency_key: proposal.idempotencyKey,
    expires_at: needsApproval ? new Date(now.getTime() + Number(profile.approval_ttl_hours) * 3600_000).toISOString() : null,
  };
}

async function runProfile(admin: Admin, profile: Row, options: RunOptions) {
  const now = new Date();
  const loaded = options.rules ? { rules: options.rules, versions: new Map<string, number>() } : await loadRules(admin, profile.id);
  let runId: string | null = null;
  if (!options.simulate) {
    const { data } = await admin
      .from('optimization_runs')
      .insert({ organization_id: profile.organization_id, profile_id: profile.id, trigger: options.trigger })
      .select('id')
      .single();
    runId = data?.id ?? null;
  }
  const finish = async (patch: Row) => {
    if (options.simulate) return;
    if (runId) await admin.from('optimization_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', runId);
    await admin.from('optimization_profiles').update({ last_evaluated_at: now.toISOString(), last_run_status: patch.status }).eq('id', profile.id);
  };

  const auth = await metaAuthFor(admin, profile.organization_id);
  if ('status' in auth) {
    await finish({ status: auth.status, error: auth.message });
    return { ok: false, status: auth.status, message: auth.message };
  }

  let scope: Scope;
  try {
    scope = await loadScope(auth, profile, now);
  } catch (error) {
    const failure = describeFailure(error);
    await noteTokenFailure(admin, profile.organization_id, failure.status, failure.message);
    await finish({ status: failure.status, error: failure.message });
    return { ok: false, status: failure.status, message: failure.message };
  }

  const history = await loadHistory(admin, profile.id);
  const settings = settingsOf(profile, scope.currency);
  const output = evaluateProfile({
    profile: settings,
    rules: loaded.rules,
    resources: scope.resources,
    history,
    now,
    windowKey: scope.window.current.until,
    activeDailyBudgetCents: scope.activeDailyBudgetCents,
  });
  const summary = summarize(output.evaluations);

  if (options.simulate) {
    return {
      ok: true,
      status: 'OK',
      window: scope.window,
      currency: scope.currency,
      timezone: scope.timezone,
      accountName: scope.accountName,
      activeDailyBudgetCents: scope.activeDailyBudgetCents,
      resources: scope.resources.length,
      counts: summary.counts,
      // NO_MATCH é a maioria e não ajuda a decidir; fica só a contagem.
      evaluations: output.evaluations.filter((evaluation) => evaluation.decision !== 'NO_MATCH').slice(0, 400),
      proposals: output.proposals,
    };
  }

  const rows = output.proposals.map((proposal) => actionRow(proposal, profile, settings, runId, loaded.versions.get(proposal.ruleKey), now));
  let created = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from('optimization_actions')
      .upsert(rows, { onConflict: 'organization_id,idempotency_key', ignoreDuplicates: true })
      .select('id');
    if (error) {
      await finish({ status: 'FAILED', error: `Gravação das recomendações: ${error.message}`.slice(0, 500) });
      return { ok: false, status: 'FAILED', message: error.message };
    }
    created = data?.length ?? 0;
  }
  if (scope.currency !== profile.currency || scope.timezone !== profile.account_timezone) {
    await admin.from('optimization_profiles').update({ currency: scope.currency, account_timezone: scope.timezone }).eq('id', profile.id);
  }
  await finish({
    status: 'OK',
    window_since: scope.window.current.since,
    window_until: scope.window.current.until,
    resources_evaluated: scope.resources.length,
    rules_matched: output.evaluations.filter((evaluation) => ['PROPOSED', 'ALERT', 'BLOCKED'].includes(evaluation.decision)).length,
    actions_created: created,
    summary: { ...summary, activeDailyBudgetCents: scope.activeDailyBudgetCents, currency: scope.currency },
  });
  return { ok: true, status: 'OK', created, window: scope.window, counts: summary.counts };
}

// ── Validação do perfil ──────────────────────────────────────────────────────

const STRATEGIES: Strategy[] = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
const WRITE_MODES: Mode[] = ['APPROVAL', 'AUTO_LIMITED'];

type ProfileFields = {
  ad_account_id: string;
  name: string;
  objective: 'LEADS' | 'SALES';
  target_event: string;
  target_cpa_cents: number;
  strategy: Strategy;
  mode: Mode;
  evaluation_interval_minutes: number;
  lookback_days: number;
  campaign_ids: string[];
  max_daily_budget_cents: number | null;
  min_daily_budget_cents: number;
  max_budget_change_pct: number;
  cooldown_hours: number;
  maturity_hours: number;
  max_actions_per_day: number;
  approval_ttl_hours: number;
  enabled: boolean;
};

function intIn(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function validateProfileFields(raw: Row | null | undefined): { ok: true; fields: ProfileFields } | { ok: false; errors: string[] } {
  const input = raw ?? {};
  const errors: string[] = [];
  const adAccountId = typeof input.ad_account_id === 'string' && /^act_\d+$/.test(input.ad_account_id) ? input.ad_account_id : null;
  if (!adAccountId) errors.push('Escolha a conta de anúncios.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 120) errors.push('Nome do perfil entre 1 e 120 caracteres.');
  const objective = input.objective === 'LEADS' || input.objective === 'SALES' ? input.objective : null;
  if (!objective) errors.push('Objetivo deve ser leads ou vendas.');
  const targetEvent = TARGET_EVENT_VALUES.includes(String(input.target_event)) ? String(input.target_event) : null;
  if (!targetEvent) errors.push('Escolha o evento de resultado.');
  const targetCpa = intIn(input.target_cpa_cents, 1, 10_000_000_00);
  if (targetCpa === null) errors.push('Meta de custo por resultado inválida.');
  const strategy = STRATEGIES.includes(input.strategy) ? (input.strategy as Strategy) : 'BALANCED';
  const mode = (['OBSERVE', 'APPROVAL', 'AUTO_LIMITED', 'PAUSED'] as Mode[]).includes(input.mode) ? (input.mode as Mode) : null;
  if (!mode) errors.push('Modo de execução inválido.');
  if (mode === 'AUTO_LIMITED') errors.push('O modo automático limitado ainda não está liberado. Use "Com aprovação".');
  const interval = [60, 180, 360, 1440].includes(Number(input.evaluation_interval_minutes)) ? Number(input.evaluation_interval_minutes) : null;
  if (interval === null) errors.push('Frequência de avaliação inválida.');
  const lookback = [3, 7, 14, 30].includes(Number(input.lookback_days)) ? Number(input.lookback_days) : null;
  if (lookback === null) errors.push('Janela de análise inválida.');
  const campaignIds = Array.isArray(input.campaign_ids) ? input.campaign_ids.map(String) : [];
  if (campaignIds.length > 200 || campaignIds.some((id: string) => !/^\d+$/.test(id))) errors.push('Lista de campanhas inválida.');
  const maxDaily = input.max_daily_budget_cents === null || input.max_daily_budget_cents === undefined || input.max_daily_budget_cents === ''
    ? null
    : intIn(input.max_daily_budget_cents, 1, 10_000_000_00);
  if (maxDaily === null && input.max_daily_budget_cents !== null && input.max_daily_budget_cents !== undefined && input.max_daily_budget_cents !== '') {
    errors.push('Teto diário inválido.');
  }
  const minDaily = intIn(input.min_daily_budget_cents ?? 1000, 1, 10_000_000_00);
  if (minDaily === null) errors.push('Orçamento mínimo inválido.');
  const maxChange = intIn(input.max_budget_change_pct ?? 15, 1, 50);
  if (maxChange === null) errors.push('Variação máxima de orçamento entre 1% e 50%.');
  const cooldown = intIn(input.cooldown_hours ?? 48, 1, 720);
  if (cooldown === null) errors.push('Cooldown entre 1 e 720 horas.');
  const maturity = intIn(input.maturity_hours ?? 72, 0, 720);
  if (maturity === null) errors.push('Maturação entre 0 e 720 horas.');
  const maxActions = intIn(input.max_actions_per_day ?? 10, 1, 100);
  if (maxActions === null) errors.push('Limite de alterações por dia entre 1 e 100.');
  const ttl = intIn(input.approval_ttl_hours ?? 24, 1, 168);
  if (ttl === null) errors.push('Validade da aprovação entre 1 e 168 horas.');
  if (maxDaily !== null && minDaily !== null && minDaily > maxDaily) errors.push('O orçamento mínimo não pode passar o teto diário.');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      ad_account_id: adAccountId!,
      name,
      objective: objective!,
      target_event: targetEvent!,
      target_cpa_cents: targetCpa!,
      strategy,
      mode: mode!,
      evaluation_interval_minutes: interval!,
      lookback_days: lookback!,
      campaign_ids: [...new Set<string>(campaignIds)],
      max_daily_budget_cents: maxDaily,
      min_daily_budget_cents: minDaily!,
      max_budget_change_pct: maxChange!,
      cooldown_hours: cooldown!,
      maturity_hours: maturity!,
      max_actions_per_day: maxActions!,
      approval_ttl_hours: ttl!,
      enabled: input.enabled === true,
    },
  };
}

function validateRules(raw: unknown): { ok: true; rules: RuleDefinition[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(raw)) return { ok: false, errors: ['Lista de regras inválida.'] };
  if (raw.length > 30) return { ok: false, errors: ['No máximo 30 regras por perfil.'] };
  const errors: string[] = [];
  const rules: RuleDefinition[] = [];
  const keys = new Set<string>();
  for (const item of raw) {
    const result = validateRule(item);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    if (keys.has(result.rule.key)) errors.push(`Código de regra repetido: ${result.rule.key}.`);
    keys.add(result.rule.key);
    rules.push(result.rule);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules };
}

/** Recomendações pendentes deixam de valer quando o perfil muda de conta ou sai do modo com aprovação. */
async function skipOpenActions(admin: Admin, profileId: string, reason: string) {
  const { data } = await admin
    .from('optimization_actions')
    .update({ status: 'SKIPPED', validation_report: { reasons: [reason], checked_at: new Date().toISOString() } })
    .eq('profile_id', profileId)
    .in('status', ['PENDING_APPROVAL', 'APPROVED'])
    .select('id');
  return data?.length ?? 0;
}

// ── Operações do painel ──────────────────────────────────────────────────────

async function opState(admin: Admin, caller: Caller) {
  const org = caller.organizationId;
  const [profiles, rules, actions, runs, events, connection, people] = await Promise.all([
    admin.from('optimization_profiles').select('*').eq('organization_id', org).is('archived_at', null).order('created_at'),
    admin.from('optimization_rules').select('*').eq('organization_id', org).order('priority', { ascending: false }),
    admin.from('optimization_actions').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(300),
    admin.from('optimization_runs').select('*').eq('organization_id', org).order('started_at', { ascending: false }).limit(60),
    admin.from('optimization_events').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(150),
    admin.from('meta_oauth_connections').select('status, meta_user_name, last_error').eq('organization_id', org).maybeSingle(),
    admin.from('profiles').select('id, name').eq('organization_id', org),
  ]);
  return json({
    isAdmin: caller.isAdmin,
    profiles: profiles.data ?? [],
    rules: rules.data ?? [],
    actions: actions.data ?? [],
    runs: runs.data ?? [],
    events: events.data ?? [],
    connection: connection.data ?? null,
    people: Object.fromEntries(((people.data ?? []) as Row[]).map((person) => [person.id, person.name])),
  });
}

async function withMeta(admin: Admin, caller: Caller, run: (meta: MetaAuth) => Promise<Response>) {
  const auth = await metaAuthFor(admin, caller.organizationId);
  if ('status' in auth) return fail('meta_not_connected', auth.message, 409);
  try {
    return await run(auth);
  } catch (error) {
    const failure = describeFailure(error);
    await noteTokenFailure(admin, caller.organizationId, failure.status, failure.message);
    return fail(failure.status.toLowerCase(), failure.message, 502);
  }
}

async function opSaveProfile(admin: Admin, caller: Caller, body: Row) {
  const validated = validateProfileFields(body.profile);
  if (!validated.ok) return fail('invalid_profile', validated.errors.join(' '));
  const fields = validated.fields;
  const existing = body.profile?.id ? await loadProfile(admin, caller.organizationId, body.profile.id) : null;
  if (body.profile?.id && !existing) return fail('not_found', 'Perfil não encontrado.', 404);
  if (WRITE_MODES.includes(fields.mode) && !caller.isAdmin && existing?.mode !== fields.mode) {
    return fail('forbidden_mode', 'Só administradores colocam um perfil em modo com aprovação.', 403);
  }

  let rules: RuleDefinition[] | null = null;
  if (body.rules !== undefined) {
    const result = validateRules(body.rules);
    if (!result.ok) return fail('invalid_rules', result.errors.join(' '));
    rules = result.rules;
  } else if (!existing) {
    rules = strategyDefaults(fields.strategy).rules;
  }

  return withMeta(admin, caller, async (meta) => {
    const account = await graph(meta, 'GET', fields.ad_account_id, { fields: 'name,currency,timezone_name' });
    const record = {
      ...fields,
      organization_id: caller.organizationId,
      ad_account_name: String(account.name ?? ''),
      currency: String(account.currency ?? 'BRL'),
      account_timezone: String(account.timezone_name ?? 'America/Sao_Paulo'),
      updated_by: caller.userId,
    };

    let saved: Row;
    if (existing) {
      const { data, error } = await admin.from('optimization_profiles').update(record).eq('id', existing.id).select('*').single();
      if (error) return fail('save_failed', error.message, 500);
      saved = data;
    } else {
      const { data, error } = await admin.from('optimization_profiles').insert({ ...record, created_by: caller.userId }).select('*').single();
      if (error) return fail('save_failed', error.message, 500);
      saved = data;
    }

    if (rules) {
      const { data: currentRows } = await admin.from('optimization_rules').select('*').eq('profile_id', saved.id);
      const byKey = new Map(((currentRows ?? []) as Row[]).map((row) => [row.rule_key as string, row]));
      for (const rule of rules) {
        const row = ruleToRow(rule, caller.organizationId, saved.id);
        const previous = byKey.get(rule.key);
        if (!previous) {
          await admin.from('optimization_rules').insert(row);
          continue;
        }
        const changed = JSON.stringify(ruleFromRow(previous)) !== JSON.stringify(ruleFromRow({ ...previous, ...row }));
        if (changed) await admin.from('optimization_rules').update({ ...row, rule_version: Number(previous.rule_version) + 1 }).eq('id', previous.id);
      }
      const keep = new Set(rules.map((rule) => rule.key));
      const removed = [...byKey.keys()].filter((key) => !keep.has(key));
      if (removed.length > 0) await admin.from('optimization_rules').delete().eq('profile_id', saved.id).in('rule_key', removed);
    }

    let skipped = 0;
    if (existing && existing.ad_account_id !== fields.ad_account_id) skipped += await skipOpenActions(admin, saved.id, 'O perfil mudou de conta de anúncios');
    else if (existing && WRITE_MODES.includes(existing.mode) && !WRITE_MODES.includes(fields.mode)) {
      skipped += await skipOpenActions(admin, saved.id, `O perfil saiu do modo com aprovação`);
    }

    const changedFields = existing ? Object.keys(fields).filter((key) => JSON.stringify(existing[key]) !== JSON.stringify((fields as Row)[key])) : [];
    await logEvent(admin, {
      organizationId: caller.organizationId,
      profileId: saved.id,
      actorId: caller.userId,
      type: existing ? 'PROFILE_UPDATED' : 'PROFILE_CREATED',
      message: existing ? `Perfil "${saved.name}" alterado` : `Perfil "${saved.name}" criado`,
      details: { changed: changedFields, rules_saved: rules ? rules.length : null, open_actions_skipped: skipped, mode: saved.mode },
    });
    return json({ profile: saved });
  });
}

async function opArchiveProfile(admin: Admin, caller: Caller, body: Row) {
  const profile = await loadProfile(admin, caller.organizationId, body.profile_id);
  if (!profile) return fail('not_found', 'Perfil não encontrado.', 404);
  await admin.from('optimization_profiles').update({ archived_at: new Date().toISOString(), enabled: false, updated_by: caller.userId }).eq('id', profile.id);
  const skipped = await skipOpenActions(admin, profile.id, 'Perfil arquivado');
  await logEvent(admin, { organizationId: caller.organizationId, profileId: profile.id, actorId: caller.userId, type: 'PROFILE_ARCHIVED', message: `Perfil "${profile.name}" arquivado`, details: { open_actions_skipped: skipped } });
  return json({ ok: true });
}

async function opEmergencyStop(admin: Admin, caller: Caller, body: Row) {
  const active = body.active === true;
  if (!active && !caller.isAdmin) return fail('forbidden', 'Só administradores desligam a parada de emergência.', 403);
  let query = admin.from('optimization_profiles').select('id, name').eq('organization_id', caller.organizationId).is('archived_at', null);
  if (body.profile_id) query = query.eq('id', String(body.profile_id));
  const { data: targets } = await query;
  const profiles = (targets ?? []) as Row[];
  if (profiles.length === 0) return fail('not_found', 'Nenhum perfil encontrado.', 404);
  const ids = profiles.map((profile) => profile.id);
  await admin.from('optimization_profiles').update({ emergency_stop: active, updated_by: caller.userId }).in('id', ids);

  let cancelled = 0;
  let executing = 0;
  if (active) {
    const { data } = await admin
      .from('optimization_actions')
      .update({ status: 'SKIPPED', validation_report: { reasons: ['Parada de emergência'], checked_at: new Date().toISOString() } })
      .in('profile_id', ids)
      .in('status', ['PENDING_APPROVAL', 'APPROVED'])
      .select('id');
    cancelled = data?.length ?? 0;
    const { count } = await admin.from('optimization_actions').select('id', { count: 'exact', head: true }).in('profile_id', ids).eq('status', 'EXECUTING');
    executing = count ?? 0;
  }
  for (const profile of profiles) {
    await logEvent(admin, {
      organizationId: caller.organizationId,
      profileId: profile.id,
      actorId: caller.userId,
      type: active ? 'EMERGENCY_STOP_ON' : 'EMERGENCY_STOP_OFF',
      message: active ? `Parada de emergência ligada em "${profile.name}"` : `Parada de emergência desligada em "${profile.name}"`,
      details: { note: typeof body.note === 'string' ? body.note.slice(0, 300) : null },
    });
  }
  return json({ updated: ids.length, cancelled, executing });
}

async function opSimulate(admin: Admin, caller: Caller, body: Row) {
  let profile: Row | null = null;
  let rules: RuleDefinition[] | undefined;
  if (body.draft) {
    const validated = validateProfileFields({ ...body.draft.profile, mode: body.draft.profile?.mode === 'AUTO_LIMITED' ? 'APPROVAL' : body.draft.profile?.mode });
    if (!validated.ok) return fail('invalid_profile', validated.errors.join(' '));
    const result = validateRules(body.draft.rules ?? strategyDefaults(validated.fields.strategy).rules);
    if (!result.ok) return fail('invalid_rules', result.errors.join(' '));
    const existing = body.draft.profile?.id ? await loadProfile(admin, caller.organizationId, body.draft.profile.id) : null;
    profile = {
      ...validated.fields,
      id: existing?.id ?? '00000000-0000-0000-0000-000000000000',
      organization_id: caller.organizationId,
      currency: existing?.currency ?? 'BRL',
      account_timezone: existing?.account_timezone ?? 'America/Sao_Paulo',
      emergency_stop: existing?.emergency_stop ?? false,
    };
    rules = result.rules;
  } else {
    profile = await loadProfile(admin, caller.organizationId, body.profile_id);
  }
  if (!profile) return fail('not_found', 'Perfil não encontrado.', 404);
  const result = await runProfile(admin, profile, { trigger: 'MANUAL', simulate: true, rules });
  if (!result.ok) return fail(String(result.status).toLowerCase(), String(result.message), 502);
  return json(result);
}

async function opEvaluate(admin: Admin, caller: Caller, body: Row) {
  const profile = await loadProfile(admin, caller.organizationId, body.profile_id);
  if (!profile) return fail('not_found', 'Perfil não encontrado.', 404);
  if (profile.mode === 'PAUSED') return fail('profile_paused', 'O perfil está pausado. Mude o modo para avaliar.');
  if (profile.last_evaluated_at && Date.now() - Date.parse(profile.last_evaluated_at) < MANUAL_MIN_INTERVAL_MS) {
    return fail('too_soon', 'O perfil acabou de ser avaliado. Aguarde 2 minutos para não gastar a cota da Meta.', 429);
  }
  const result = await runProfile(admin, profile, { trigger: 'MANUAL', actorId: caller.userId });
  await logEvent(admin, {
    organizationId: caller.organizationId,
    profileId: profile.id,
    actorId: caller.userId,
    type: 'MANUAL_EVALUATION',
    message: `Avaliação manual de "${profile.name}": ${result.ok ? `${result.created ?? 0} item(ns) novo(s)` : result.message}`,
    details: { status: result.status },
  });
  return json(result, result.ok ? 200 : 502);
}

async function opDecide(admin: Admin, caller: Caller, body: Row) {
  const decision = body.decision;
  if (!['approve', 'reject', 'dismiss'].includes(decision)) return fail('invalid_decision', 'Decisão inválida.');
  if (typeof body.action_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.action_id)) return fail('invalid_action', 'Ação inválida.');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
  const { data: action } = await admin
    .from('optimization_actions')
    .select('*')
    .eq('id', body.action_id)
    .eq('organization_id', caller.organizationId)
    .maybeSingle();
  if (!action) return fail('not_found', 'Ação não encontrada.', 404);
  const nowIso = new Date().toISOString();
  const event = (type: string, message: string, details: Row = {}) =>
    logEvent(admin, { organizationId: caller.organizationId, profileId: action.profile_id, actionId: action.id, actorId: caller.userId, type, message, details });

  if (decision === 'dismiss' || decision === 'reject') {
    const from = decision === 'dismiss' ? 'PROPOSED' : 'PENDING_APPROVAL';
    const to = decision === 'dismiss' ? 'DISMISSED' : 'REJECTED';
    const { data } = await admin
      .from('optimization_actions')
      .update({ status: to, decided_by: caller.userId, decided_at: nowIso, decision_note: note })
      .eq('id', action.id)
      .eq('status', from)
      .select('id')
      .maybeSingle();
    if (!data) return fail('already_decided', 'Este item já foi decidido.', 409);
    await event(decision === 'dismiss' ? 'ACTION_DISMISSED' : 'ACTION_REJECTED', `${action.title} — ${action.resource_name ?? action.resource_id}`, { note });
    return json({ status: to });
  }

  if (action.action_type === 'ALERT') return fail('not_executable', 'Alertas não executam nada na Meta.');
  // Trava: só uma aprovação passa de PENDING_APPROVAL para EXECUTING.
  const { data: locked } = await admin
    .from('optimization_actions')
    .update({ status: 'EXECUTING', decided_by: caller.userId, decided_at: nowIso, decision_note: note })
    .eq('id', action.id)
    .eq('status', 'PENDING_APPROVAL')
    .gt('expires_at', nowIso)
    .select('*')
    .maybeSingle();
  if (!locked) {
    if (action.status === 'PENDING_APPROVAL') {
      await admin.from('optimization_actions').update({ status: 'EXPIRED' }).eq('id', action.id).eq('status', 'PENDING_APPROVAL');
      return fail('expired', 'A proposta expirou. Rode uma nova avaliação.', 409);
    }
    return fail('already_decided', 'Esta proposta já foi decidida.', 409);
  }
  await event('ACTION_APPROVED', `Aprovada: ${action.title} — ${action.resource_name ?? action.resource_id}`, { note });

  const close = async (patch: Row, type: string, message: string, details: Row = {}) => {
    await admin.from('optimization_actions').update(patch).eq('id', action.id);
    await event(type, message, details);
  };
  const label = `${action.title} — ${action.resource_name ?? action.resource_id}`;
  const payload = action.requested_payload as ProposalPayload;

  const profile = await loadProfile(admin, caller.organizationId, action.profile_id);
  if (!profile) {
    await close({ status: 'SKIPPED', validation_report: { reasons: ['Perfil arquivado ou removido'] } }, 'ACTION_SKIPPED', `Não executada: ${label}`);
    return json({ status: 'SKIPPED', reasons: ['Perfil arquivado ou removido'] });
  }
  const auth = await metaAuthFor(admin, caller.organizationId);
  if ('status' in auth) {
    await close({ status: 'SKIPPED', validation_report: { reasons: [auth.message] } }, 'ACTION_SKIPPED', `Não executada: ${label}`);
    return json({ status: 'SKIPPED', reasons: [auth.message] });
  }

  let before: Row;
  let reasons: string[];
  try {
    const current = await graph(auth, 'GET', action.resource_id, { fields: 'id,account_id,status,effective_status,daily_budget,lifetime_budget,updated_time' });
    before = {
      status: current.status,
      effective_status: current.effective_status,
      daily_budget: current.daily_budget ?? null,
      lifetime_budget: current.lifetime_budget ?? null,
      updated_time: current.updated_time ?? null,
    };
    const settings = settingsOf(profile);
    let activeDaily: number | null = null;
    if (action.action_type === 'BUDGET_INCREASE' && settings.maxDailyBudgetCents !== null) {
      const { campaigns, adsets } = await loadEntities(auth, profile);
      activeDaily = activeDailyBudget(campaigns, adsets);
    }
    const { data: ruleRow } = await admin.from('optimization_rules').select('cooldown_hours').eq('profile_id', profile.id).eq('rule_key', action.rule_key).maybeSingle();
    const history = (await loadHistory(admin, profile.id)).filter((entry) => entry.id !== action.id);
    reasons = checkExecution({
      actionType: action.action_type as ActionType,
      payload,
      resourceId: action.resource_id,
      expiresAt: action.expires_at,
      profile: settings,
      profileAccountId: profile.ad_account_id,
      current: {
        accountId: String(current.account_id ?? ''),
        status: String(current.status ?? ''),
        effectiveStatus: String(current.effective_status ?? ''),
        dailyBudgetCents: positive(current.daily_budget),
      },
      history,
      activeDailyBudgetCents: activeDaily,
      ruleCooldownHours: Number(ruleRow?.cooldown_hours ?? 0),
      now: new Date(),
    });
  } catch (error) {
    const failure = describeFailure(error);
    await noteTokenFailure(admin, caller.organizationId, failure.status, failure.message);
    await close({ status: 'SKIPPED', validation_report: { reasons: [failure.message] }, error_code: failure.code }, 'ACTION_SKIPPED', `Não executada: ${label}`, { reason: failure.message });
    return json({ status: 'SKIPPED', reasons: [failure.message] });
  }

  if (reasons.length > 0) {
    await close({ status: 'SKIPPED', before_state: before, validation_report: { reasons, checked_at: new Date().toISOString() } }, 'ACTION_SKIPPED', `Não executada: ${label}`, { reasons });
    return json({ status: 'SKIPPED', reasons });
  }

  const params: Record<string, string> = payload.kind === 'status' ? { status: 'PAUSED' } : payload.kind === 'budget' ? { daily_budget: String(payload.toCents) } : {};
  let success = false;
  try {
    const response = await graph(auth, 'POST', action.resource_id, params);
    success = response?.success === true;
  } catch (error) {
    const failure = describeFailure(error);
    await noteTokenFailure(admin, caller.organizationId, failure.status, failure.message);
    await close({ status: 'FAILED', before_state: before, error_code: failure.code, error_summary: failure.message }, 'ACTION_FAILED', `Falhou: ${label}`, { reason: failure.message });
    return json({ status: 'FAILED', message: failure.message });
  }

  // Sucesso HTTP não é confirmação: lê o recurso de novo.
  let after: Row | null = null;
  let confirmed = false;
  try {
    after = await graph(auth, 'GET', action.resource_id, { fields: 'status,effective_status,daily_budget,lifetime_budget,updated_time' });
    confirmed = payload.kind === 'status' ? after.status === 'PAUSED' : payload.kind === 'budget' ? Number(after.daily_budget) === payload.toCents : false;
  } catch {
    // A escrita já foi feita; só a conferência falhou.
  }
  await close(
    {
      status: 'EXECUTED',
      executed_at: new Date().toISOString(),
      before_state: before,
      after_state: after,
      meta_response_safe: { success, confirmed },
      validation_report: { reasons: [], confirmed, checked_at: new Date().toISOString() },
    },
    'ACTION_EXECUTED',
    `Executada: ${label}`,
    { confirmed },
  );
  return json({ status: 'EXECUTED', confirmed });
}

// ── Cron ─────────────────────────────────────────────────────────────────────

async function opCron(admin: Admin) {
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const { data: expired } = await admin
    .from('optimization_actions')
    .update({ status: 'EXPIRED' })
    .eq('status', 'PENDING_APPROVAL')
    .lt('expires_at', nowIso)
    .select('id');

  const { data } = await admin
    .from('optimization_profiles')
    .select('*')
    .eq('enabled', true)
    .is('archived_at', null)
    .in('mode', ['OBSERVE', 'APPROVAL', 'AUTO_LIMITED']);
  // Folga de 5 min para o cron de hora em hora não pular um ciclo por segundos.
  const due = ((data ?? []) as Row[])
    .filter((profile) => !profile.last_evaluated_at || Date.now() - Date.parse(profile.last_evaluated_at) >= (Number(profile.evaluation_interval_minutes) - 5) * 60_000)
    .sort((a, b) => (Date.parse(a.last_evaluated_at ?? '1970-01-01') - Date.parse(b.last_evaluated_at ?? '1970-01-01')));

  const results: Row[] = [];
  for (const profile of due) {
    if (Date.now() - started > CRON_TIME_BUDGET_MS) {
      results.push({ profile: profile.id, status: 'DEFERRED' });
      continue;
    }
    try {
      const result = await runProfile(admin, profile, { trigger: 'CRON' });
      results.push({ profile: profile.id, status: result.status, created: result.created ?? 0 });
    } catch (error) {
      results.push({ profile: profile.id, status: 'FAILED', message: error instanceof Error ? error.message : 'falha' });
    }
  }
  return json({ expired: expired?.length ?? 0, evaluated: results.length, results });
}

// ── Entrada ──────────────────────────────────────────────────────────────────

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: Row = {};
  try {
    body = await request.json();
  } catch {
    // corpo vazio
  }

  const cronSecret = request.headers.get('x-cron-secret');
  if (cronSecret) {
    const { data: config } = await admin.from('meta_report_cron_config').select('cron_secret').maybeSingle();
    if (!config || config.cron_secret !== cronSecret) return json({ error: 'unauthorized' }, 401);
    return opCron(admin);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await callerClient.auth.getUser();
  const user = userData.user;
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await callerClient.from('profiles').select('organization_id, role').eq('id', user.id).maybeSingle();
  if (!profile?.organization_id) return json({ error: 'forbidden' }, 403);
  const isAdmin = profile.role === 'ADMIN';
  if (!isAdmin) {
    const { data: permission } = await callerClient
      .from('agency_tool_permissions')
      .select('tool_key')
      .eq('user_id', user.id)
      .eq('tool_key', TOOL)
      .maybeSingle();
    if (!permission) return fail('forbidden', 'Seu usuário não tem a ferramenta Otimização IA liberada.', 403);
  }
  const caller: Caller = { organizationId: profile.organization_id, userId: user.id, isAdmin };

  try {
    switch (body.op) {
      case 'state':
        return await opState(admin, caller);
      case 'accounts':
        return await withMeta(admin, caller, async (meta) =>
          json({ accounts: await graphAll(meta, 'me/adaccounts', { fields: 'id,name,currency,timezone_name,account_status', limit: '200' }, 5) }));
      case 'campaigns': {
        const accountId = String(body.ad_account_id ?? '');
        if (!/^act_\d+$/.test(accountId)) return fail('invalid_account', 'Conta de anúncios inválida.');
        return await withMeta(admin, caller, async (meta) =>
          json({
            campaigns: await graphAll(meta, `${accountId}/campaigns`, {
              fields: 'id,name,effective_status,daily_budget,lifetime_budget,insights.date_preset(last_7d){spend,actions}',
              limit: '100',
            }, 5),
          }));
      }
      case 'save_profile':
        return await opSaveProfile(admin, caller, body);
      case 'archive_profile':
        return await opArchiveProfile(admin, caller, body);
      case 'emergency_stop':
        return await opEmergencyStop(admin, caller, body);
      case 'simulate':
        return await opSimulate(admin, caller, body);
      case 'evaluate':
        return await opEvaluate(admin, caller, body);
      case 'decide':
        return await opDecide(admin, caller, body);
      default:
        return fail('invalid_op', 'Operação desconhecida.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha inesperada.';
    return fail('internal_error', message.slice(0, 300), 500);
  }
});
