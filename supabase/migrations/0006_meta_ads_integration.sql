-- =============================================================================
-- 0006 — Integração real com Meta Ads (Fase 2, escopo mínimo)
--
-- Duas tabelas:
--   meta_integrations   credenciais por projeto (ad_account_id + access_token).
--                        Só ADMIN lê/escreve — o token é um segredo do cliente
--                        na Meta, não algo que CLIENT deveria ver, mesmo tendo
--                        can_edit_settings no projeto.
--   meta_insights_daily métricas reais sincronizadas dia a dia (spend,
--                        impressions, clicks, reach, leads). Legível por quem
--                        tem acesso de visualização ao projeto; a escrita só
--                        acontece via Edge Function com a service_role key
--                        (não existe policy de INSERT/UPDATE para `authenticated`
--                        de propósito).
-- =============================================================================

create table public.meta_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  ad_account_id text not null,
  access_token text not null,
  account_name text,
  status text not null default 'DISCONNECTED' check (status in ('DISCONNECTED', 'CONNECTED', 'ERROR')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.meta_insights_daily (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  date date not null,
  spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint not null default 0,
  leads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, date)
);

create index idx_meta_insights_daily_project_date on public.meta_insights_daily (project_id, date);

alter table public.meta_integrations enable row level security;
alter table public.meta_insights_daily enable row level security;

create policy meta_integrations_admin_all on public.meta_integrations
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy meta_insights_daily_select on public.meta_insights_daily
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view'));

drop trigger if exists trg_meta_integrations_updated_at on public.meta_integrations;
create trigger trg_meta_integrations_updated_at before update on public.meta_integrations
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_meta_insights_daily_updated_at on public.meta_insights_daily;
create trigger trg_meta_insights_daily_updated_at before update on public.meta_insights_daily
  for each row execute function public.fn_set_updated_at();
