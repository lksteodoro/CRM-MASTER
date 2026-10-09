-- Otimização IA: perfis, regras, ciclos de avaliação, ações (recomendações,
-- aprovações e execuções) e trilha de auditoria.
--
-- Leitura: usuários com a ferramenta 'optimization_ia' (ou admins) da própria
-- organização. Escrita: só a Edge Function `optimization-ia` (service role),
-- que valida regras, permissões e limites antes de gravar ou falar com a Meta.

create table if not exists public.optimization_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_account_id text not null check (ad_account_id ~ '^act_[0-9]+$'),
  ad_account_name text,
  name text not null check (char_length(name) between 1 and 120),
  objective text not null check (objective in ('LEADS', 'SALES')),
  target_event text not null,
  target_cpa_cents bigint not null check (target_cpa_cents > 0),
  currency char(3) not null default 'BRL',
  account_timezone text not null default 'America/Sao_Paulo',
  strategy text not null default 'BALANCED' check (strategy in ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE')),
  mode text not null default 'OBSERVE' check (mode in ('OBSERVE', 'APPROVAL', 'AUTO_LIMITED', 'PAUSED')),
  evaluation_interval_minutes int not null default 180 check (evaluation_interval_minutes in (60, 180, 360, 1440)),
  lookback_days int not null default 7 check (lookback_days in (3, 7, 14, 30)),
  campaign_ids text[] not null default '{}',
  max_daily_budget_cents bigint check (max_daily_budget_cents is null or max_daily_budget_cents > 0),
  min_daily_budget_cents bigint not null default 1000 check (min_daily_budget_cents > 0),
  max_budget_change_pct int not null default 15 check (max_budget_change_pct between 1 and 50),
  cooldown_hours int not null default 48 check (cooldown_hours between 1 and 720),
  maturity_hours int not null default 72 check (maturity_hours between 0 and 720),
  max_actions_per_day int not null default 10 check (max_actions_per_day between 1 and 100),
  approval_ttl_hours int not null default 24 check (approval_ttl_hours between 1 and 168),
  enabled boolean not null default false,
  emergency_stop boolean not null default false,
  archived_at timestamptz,
  last_evaluated_at timestamptz,
  last_run_status text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists public.optimization_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  profile_id uuid not null,
  rule_key text not null check (rule_key ~ '^[A-Z0-9_]{2,40}$'),
  name text not null,
  description text not null default '',
  scope text not null check (scope in ('CAMPAIGN', 'ADSET')),
  priority int not null default 50 check (priority between 0 and 100),
  minimums jsonb not null default '{}'::jsonb,
  conditions jsonb not null,
  action_definition jsonb not null,
  diagnosis jsonb not null default '{}'::jsonb,
  cooldown_hours int not null default 48,
  enabled boolean not null default true,
  rule_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, profile_id) references public.optimization_profiles (organization_id, id) on delete cascade,
  unique (profile_id, rule_key)
);

create table if not exists public.optimization_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  profile_id uuid not null,
  trigger text not null check (trigger in ('CRON', 'MANUAL')),
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'OK', 'RATE_LIMITED', 'PERMISSION_ERROR', 'TOKEN_EXPIRED', 'DISCONNECTED', 'FAILED', 'SKIPPED')),
  window_since date,
  window_until date,
  resources_evaluated int not null default 0,
  rules_matched int not null default 0,
  actions_created int not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (organization_id, profile_id) references public.optimization_profiles (organization_id, id) on delete cascade
);

create table if not exists public.optimization_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  profile_id uuid not null,
  run_id uuid references public.optimization_runs(id) on delete set null,
  rule_key text not null,
  rule_version int,
  ad_account_id text not null,
  resource_level text not null check (resource_level in ('ACCOUNT', 'CAMPAIGN', 'ADSET')),
  resource_id text not null,
  resource_name text,
  campaign_id text,
  action_type text not null check (action_type in ('ALERT', 'PAUSE', 'BUDGET_INCREASE', 'BUDGET_DECREASE')),
  source text not null default 'RULE_ENGINE' check (source in ('RULE_ENGINE', 'HUMAN', 'AI_PROPOSAL')),
  severity text not null default 'INFO' check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  status text not null
    check (status in ('PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED', 'REJECTED',
                      'DISMISSED', 'SKIPPED', 'FAILED', 'REVERTED', 'EXPIRED')),
  title text not null,
  reason text not null default '',
  risk text not null default '',
  diagnosis jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  requested_payload jsonb not null default '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  validation_report jsonb,
  meta_response_safe jsonb,
  idempotency_key text not null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  expires_at timestamptz,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, profile_id) references public.optimization_profiles (organization_id, id) on delete cascade,
  unique (organization_id, idempotency_key)
);

-- Trilha de auditoria: só inserção (sem update/delete para ninguém além do service role).
create table if not exists public.optimization_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid references public.optimization_profiles(id) on delete set null,
  action_id uuid references public.optimization_actions(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_optimization_profiles_org on public.optimization_profiles (organization_id, ad_account_id);
create index if not exists idx_optimization_profiles_due on public.optimization_profiles (enabled, last_evaluated_at) where archived_at is null;
create index if not exists idx_optimization_rules_profile on public.optimization_rules (profile_id, enabled);
create index if not exists idx_optimization_runs_profile on public.optimization_runs (profile_id, started_at desc);
create index if not exists idx_optimization_actions_history on public.optimization_actions (organization_id, created_at desc);
create index if not exists idx_optimization_actions_status on public.optimization_actions (status, expires_at);
create index if not exists idx_optimization_actions_resource on public.optimization_actions (profile_id, resource_id, created_at desc);
create index if not exists idx_optimization_events_org on public.optimization_events (organization_id, created_at desc);

drop trigger if exists trg_optimization_profiles_updated_at on public.optimization_profiles;
create trigger trg_optimization_profiles_updated_at before update on public.optimization_profiles
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_optimization_rules_updated_at on public.optimization_rules;
create trigger trg_optimization_rules_updated_at before update on public.optimization_rules
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_optimization_actions_updated_at on public.optimization_actions;
create trigger trg_optimization_actions_updated_at before update on public.optimization_actions
  for each row execute function public.fn_set_updated_at();

alter table public.optimization_profiles enable row level security;
alter table public.optimization_rules enable row level security;
alter table public.optimization_runs enable row level security;
alter table public.optimization_actions enable row level security;
alter table public.optimization_events enable row level security;

drop policy if exists optimization_profiles_tool_select on public.optimization_profiles;
create policy optimization_profiles_tool_select on public.optimization_profiles
  for select to authenticated
  using (private.has_agency_tool_access('optimization_ia') and organization_id = private.current_organization_id());

drop policy if exists optimization_rules_tool_select on public.optimization_rules;
create policy optimization_rules_tool_select on public.optimization_rules
  for select to authenticated
  using (private.has_agency_tool_access('optimization_ia') and organization_id = private.current_organization_id());

drop policy if exists optimization_runs_tool_select on public.optimization_runs;
create policy optimization_runs_tool_select on public.optimization_runs
  for select to authenticated
  using (private.has_agency_tool_access('optimization_ia') and organization_id = private.current_organization_id());

drop policy if exists optimization_actions_tool_select on public.optimization_actions;
create policy optimization_actions_tool_select on public.optimization_actions
  for select to authenticated
  using (private.has_agency_tool_access('optimization_ia') and organization_id = private.current_organization_id());

drop policy if exists optimization_events_tool_select on public.optimization_events;
create policy optimization_events_tool_select on public.optimization_events
  for select to authenticated
  using (private.has_agency_tool_access('optimization_ia') and organization_id = private.current_organization_id());

grant select on public.optimization_profiles, public.optimization_rules, public.optimization_runs,
  public.optimization_actions, public.optimization_events to authenticated;

-- Ciclo de avaliação: a cada hora, minuto 7. A função decide quais perfis
-- estão no horário (intervalo de cada perfil) e expira aprovações vencidas.
-- Reaproveita o segredo de cron do resumo diário.
select cron.unschedule('optimization-ia')
 where exists (select 1 from cron.job where jobname = 'optimization-ia');

select cron.schedule(
  'optimization-ia',
  '7 * * * *',
  $$
    select net.http_post(
      url := 'https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/optimization-ia',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select cron_secret from public.meta_report_cron_config limit 1)
      ),
      body := '{"op":"cron"}'::jsonb,
      timeout_milliseconds := 150000
    );
  $$
);
