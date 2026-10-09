import { supabase } from '../integrations/supabase/client';
import type {
  ActionStatus,
  ActionType,
  Evaluation,
  Mode,
  Proposal,
  ProposalPayload,
  ResourceLevel,
  RuleDefinition,
  Severity,
  Strategy,
} from '../../supabase/functions/optimization-ia/engine.ts';

/**
 * Cliente da Edge Function `optimization-ia`. Toda leitura da Meta e toda
 * escrita (perfis, regras, decisões) passam por ela; o token fica no servidor.
 */

export type OptimizationProfile = {
  id: string;
  ad_account_id: string;
  ad_account_name: string | null;
  name: string;
  objective: 'LEADS' | 'SALES';
  target_event: string;
  target_cpa_cents: number;
  currency: string;
  account_timezone: string;
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
  emergency_stop: boolean;
  last_evaluated_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
};

export type OptimizationRuleRow = {
  id: string;
  profile_id: string;
  rule_key: string;
  name: string;
  description: string;
  scope: ResourceLevel;
  priority: number;
  minimums: RuleDefinition['minimums'];
  conditions: { all?: RuleDefinition['all']; any?: RuleDefinition['any'] };
  action_definition: RuleDefinition['action'];
  diagnosis: RuleDefinition['diagnosis'];
  cooldown_hours: number;
  enabled: boolean;
  rule_version: number;
};

export type OptimizationAction = {
  id: string;
  profile_id: string;
  run_id: string | null;
  rule_key: string;
  rule_version: number | null;
  ad_account_id: string;
  resource_level: ResourceLevel | 'ACCOUNT';
  resource_id: string;
  resource_name: string | null;
  campaign_id: string | null;
  action_type: ActionType;
  source: 'RULE_ENGINE' | 'HUMAN' | 'AI_PROPOSAL';
  severity: Severity;
  status: ActionStatus;
  title: string;
  reason: string;
  risk: string;
  diagnosis: Partial<RuleDefinition['diagnosis']>;
  evidence: Partial<Proposal['evidence']>;
  requested_payload: ProposalPayload;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  validation_report: { reasons?: string[]; confirmed?: boolean; checked_at?: string } | null;
  meta_response_safe: { success?: boolean; confirmed?: boolean } | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  expires_at: string | null;
  error_code: string | null;
  error_summary: string | null;
  created_at: string;
};

export type OptimizationRun = {
  id: string;
  profile_id: string;
  trigger: 'CRON' | 'MANUAL';
  status: string;
  window_since: string | null;
  window_until: string | null;
  resources_evaluated: number;
  rules_matched: number;
  actions_created: number;
  summary: { counts?: Record<string, number>; blocked?: Array<{ rule: string; resource: string; reasons: string[] }> };
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type OptimizationEvent = {
  id: string;
  profile_id: string | null;
  action_id: string | null;
  actor_id: string | null;
  event_type: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type OptimizationState = {
  isAdmin: boolean;
  profiles: OptimizationProfile[];
  rules: OptimizationRuleRow[];
  actions: OptimizationAction[];
  runs: OptimizationRun[];
  events: OptimizationEvent[];
  connection: { status: string; meta_user_name: string | null; last_error: string | null } | null;
  people: Record<string, string>;
};

export type AdAccountOption = { id: string; name: string; currency: string; timezone_name?: string; account_status?: number };

export type CampaignSummary = {
  id: string;
  name: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  insights?: { data?: Array<{ spend?: string; actions?: Array<{ action_type: string; value: string }> }> };
};

/** Campos que o servidor aceita ao salvar um perfil. */
export type ProfileDraft = Omit<
  OptimizationProfile,
  'id' | 'ad_account_name' | 'currency' | 'account_timezone' | 'emergency_stop' | 'last_evaluated_at' | 'last_run_status' | 'created_at' | 'updated_at'
> & { id?: string };

export type SimulationResult = {
  window: { current: { since: string; until: string }; previous: { since: string; until: string } };
  currency: string;
  timezone: string;
  accountName: string;
  activeDailyBudgetCents: number;
  resources: number;
  counts: Record<string, number>;
  evaluations: Evaluation[];
  proposals: Proposal[];
};

export type DecisionResult = { status: ActionStatus; reasons?: string[]; message?: string; confirmed?: boolean };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('optimization-ia', { body });
  if (error) {
    type ErrorBody = { message?: string; error?: string };
    let detail: ErrorBody | null = null;
    try {
      detail = ((await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.()) ?? null) as ErrorBody | null;
    } catch {
      detail = null;
    }
    throw new Error(detail?.message || detail?.error || error.message || 'Falha ao falar com o servidor.');
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String((data as { message?: string }).message ?? data.error));
  }
  return data as T;
}

export function ruleFromRow(row: OptimizationRuleRow): RuleDefinition {
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

export const optimizationApi = {
  state: () => call<OptimizationState>({ op: 'state' }),
  accounts: () => call<{ accounts: AdAccountOption[] }>({ op: 'accounts' }).then((result) => result.accounts),
  campaigns: (adAccountId: string) => call<{ campaigns: CampaignSummary[] }>({ op: 'campaigns', ad_account_id: adAccountId }).then((result) => result.campaigns),
  saveProfile: (profile: ProfileDraft, rules?: RuleDefinition[]) => call<{ profile: OptimizationProfile }>({ op: 'save_profile', profile, rules }),
  archiveProfile: (profileId: string) => call<{ ok: true }>({ op: 'archive_profile', profile_id: profileId }),
  emergencyStop: (active: boolean, profileId?: string) =>
    call<{ updated: number; cancelled: number; executing: number }>({ op: 'emergency_stop', active, profile_id: profileId }),
  simulateProfile: (profileId: string) => call<SimulationResult>({ op: 'simulate', profile_id: profileId }),
  simulateDraft: (profile: ProfileDraft, rules: RuleDefinition[]) => call<SimulationResult>({ op: 'simulate', draft: { profile, rules } }),
  evaluate: (profileId: string) => call<{ ok: boolean; status: string; created?: number; message?: string }>({ op: 'evaluate', profile_id: profileId }),
  decide: (actionId: string, decision: 'approve' | 'reject' | 'dismiss', note?: string) =>
    call<DecisionResult>({ op: 'decide', action_id: actionId, decision, note }),
};
