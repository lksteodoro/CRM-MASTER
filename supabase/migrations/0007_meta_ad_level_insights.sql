-- =============================================================================
-- 0007 — Métricas reais por campanha/anúncio (não só por conta)
--
-- meta_insights_daily (0006) só tinha o total da conta. Esta tabela guarda a
-- mesma sincronização quebrada por anúncio (a Graph API já devolve
-- campaign_id/campaign_name/adset_id/adset_name/ad_id/ad_name quando pedidos
-- com level=ad, então não precisamos de chamadas extras só para nomes).
-- =============================================================================

create table public.meta_ad_insights_daily (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  date date not null,
  campaign_id text not null,
  campaign_name text not null,
  campaign_status text,
  adset_id text,
  adset_name text,
  ad_id text not null,
  ad_name text not null,
  spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint not null default 0,
  leads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, date, ad_id)
);

create index idx_meta_ad_insights_daily_project_date on public.meta_ad_insights_daily (project_id, date);
create index idx_meta_ad_insights_daily_campaign on public.meta_ad_insights_daily (project_id, campaign_id);
create index idx_meta_ad_insights_daily_ad on public.meta_ad_insights_daily (project_id, ad_id);

alter table public.meta_ad_insights_daily enable row level security;

create policy meta_ad_insights_daily_select on public.meta_ad_insights_daily
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view'));

drop trigger if exists trg_meta_ad_insights_daily_updated_at on public.meta_ad_insights_daily;
create trigger trg_meta_ad_insights_daily_updated_at before update on public.meta_ad_insights_daily
  for each row execute function public.fn_set_updated_at();
