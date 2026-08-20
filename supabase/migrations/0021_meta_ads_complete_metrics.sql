-- Métricas ampliadas do Meta Ads Manager.
-- Mantemos também os arrays brutos de ações para não perder novos tipos de
-- conversão adicionados pela Meta entre versões da Marketing API.

alter table public.meta_insights_daily
  add column if not exists outbound_clicks bigint not null default 0,
  add column if not exists frequency numeric(12, 4) not null default 0,
  add column if not exists ctr numeric(12, 4) not null default 0,
  add column if not exists cpc numeric(14, 4) not null default 0,
  add column if not exists cpm numeric(14, 4) not null default 0,
  add column if not exists landing_page_views bigint not null default 0,
  add column if not exists post_engagement bigint not null default 0,
  add column if not exists video_views bigint not null default 0,
  add column if not exists thruplays bigint not null default 0,
  add column if not exists purchases bigint not null default 0,
  add column if not exists purchase_value numeric(16, 2) not null default 0,
  add column if not exists messaging_conversations_started bigint not null default 0,
  add column if not exists purchase_roas numeric(14, 4) not null default 0,
  add column if not exists actions jsonb not null default '[]'::jsonb,
  add column if not exists action_values jsonb not null default '[]'::jsonb,
  add column if not exists cost_per_action_type jsonb not null default '[]'::jsonb;

alter table public.meta_ad_insights_daily
  add column if not exists outbound_clicks bigint not null default 0,
  add column if not exists frequency numeric(12, 4) not null default 0,
  add column if not exists ctr numeric(12, 4) not null default 0,
  add column if not exists cpc numeric(14, 4) not null default 0,
  add column if not exists cpm numeric(14, 4) not null default 0,
  add column if not exists landing_page_views bigint not null default 0,
  add column if not exists post_engagement bigint not null default 0,
  add column if not exists video_views bigint not null default 0,
  add column if not exists thruplays bigint not null default 0,
  add column if not exists purchases bigint not null default 0,
  add column if not exists purchase_value numeric(16, 2) not null default 0,
  add column if not exists messaging_conversations_started bigint not null default 0,
  add column if not exists purchase_roas numeric(14, 4) not null default 0,
  add column if not exists actions jsonb not null default '[]'::jsonb,
  add column if not exists action_values jsonb not null default '[]'::jsonb,
  add column if not exists cost_per_action_type jsonb not null default '[]'::jsonb;
