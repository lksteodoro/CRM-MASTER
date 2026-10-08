-- =============================================================================
-- 0054 — Meta Ads: resumo diário de campanhas de leads
--
-- Todo dia às 8h30 (America/Sao_Paulo) a Edge Function `meta-daily-report` lê o
-- gasto, os leads e o custo por lead de ONTEM das campanhas que o operador
-- marcou, e guarda o resultado aqui. A leitura usa a conexão OAuth da agência
-- (token só no servidor); o navegador apenas lê estas tabelas.
-- =============================================================================

-- Campanhas que entram no resumo (a seleção do operador).
create table public.meta_report_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  bm_id text,
  bm_name text,
  ad_account_id text not null,
  ad_account_name text,
  campaign_id text not null,
  campaign_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, campaign_id)
);

create index idx_meta_report_campaigns_org on public.meta_report_campaigns (organization_id, active);

-- Resultado diário por campanha (um registro por campanha por dia).
create table public.meta_report_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_date date not null,
  campaign_id text not null,
  campaign_name text,
  ad_account_id text not null,
  ad_account_name text,
  bm_name text,
  currency text,
  spend numeric(14,2) not null default 0,
  leads integer not null default 0,
  cost_per_lead numeric(14,2),
  fetched_at timestamptz not null default now(),
  unique (organization_id, report_date, campaign_id)
);

create index idx_meta_report_daily_org_date on public.meta_report_daily (organization_id, report_date desc);

-- Estado da última execução (para o painel mostrar "atualizado às ...").
create table public.meta_report_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_run_at timestamptz,
  last_report_date date,
  last_status text,
  last_error text,
  updated_at timestamptz not null default now()
);

-- Segredo do cron (só o service role lê; nenhuma policy).
create table public.meta_report_cron_config (
  id boolean primary key default true check (id),
  cron_secret text not null
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
);
insert into public.meta_report_cron_config default values;
alter table public.meta_report_cron_config enable row level security;

alter table public.meta_report_campaigns enable row level security;
alter table public.meta_report_daily enable row level security;
alter table public.meta_report_state enable row level security;

create policy meta_report_campaigns_tool_all on public.meta_report_campaigns
  for all to authenticated
  using (private.has_agency_tool_access('meta_ads') and organization_id = private.current_organization_id())
  with check (private.has_agency_tool_access('meta_ads') and organization_id = private.current_organization_id());

create policy meta_report_daily_tool_select on public.meta_report_daily
  for select to authenticated
  using (private.has_agency_tool_access('meta_ads') and organization_id = private.current_organization_id());

create policy meta_report_state_tool_select on public.meta_report_state
  for select to authenticated
  using (private.has_agency_tool_access('meta_ads') and organization_id = private.current_organization_id());

grant select, insert, update, delete on public.meta_report_campaigns to authenticated;
grant select on public.meta_report_daily to authenticated;
grant select on public.meta_report_state to authenticated;

drop trigger if exists trg_meta_report_campaigns_updated_at on public.meta_report_campaigns;
create trigger trg_meta_report_campaigns_updated_at before update on public.meta_report_campaigns
  for each row execute function public.fn_set_updated_at();

-- 08:30 em São Paulo = 11:30 UTC (o Brasil não usa horário de verão desde 2019).
select cron.unschedule('meta-daily-report')
 where exists (select 1 from cron.job where jobname = 'meta-daily-report');

select cron.schedule(
  'meta-daily-report',
  '30 11 * * *',
  $$
    select net.http_post(
      url := 'https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/meta-daily-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select cron_secret from public.meta_report_cron_config limit 1)
      ),
      body := '{"source":"cron"}'::jsonb
    );
  $$
);
