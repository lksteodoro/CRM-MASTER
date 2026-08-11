-- =============================================================================
-- 0016 — Cliques no link (inline_link_clicks da Meta Graph API)
--
-- A sincronização só trazia `clicks` (todos os cliques, inclui expandir foto,
-- ver perfil etc.). "Cliques no link" é uma métrica separada da Meta
-- (inline_link_clicks) — cliques que de fato levam a algum destino (site,
-- WhatsApp, formulário). Faltava nas duas tabelas de insight.
-- =============================================================================

alter table public.meta_insights_daily
  add column link_clicks integer not null default 0;

alter table public.meta_ad_insights_daily
  add column link_clicks integer not null default 0;
