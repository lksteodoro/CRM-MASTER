-- =============================================================================
-- 0015 — Textos do telão editáveis
--
-- O visual "Arena" tinha vários textos fixos no código (título, subtítulo,
-- selo "ao vivo", selo de temporada, texto sob o nome do cliente, label da
-- celebração, rodapé). Usuário pediu para editar todos. `sale_banner_message`
-- já existia (fase anterior); os demais entram agora no mesmo padrão.
-- =============================================================================

alter table public.client_ranking_settings
  add column panel_title text not null default 'Campeões de vendas',
  add column panel_subtitle text not null default '1 ponto por venda paga (mais ajustes) • disputa atualizada em tempo real',
  add column panel_live_badge text not null default 'RANKING AO VIVO',
  add column panel_season_label text,
  add column panel_brand_subtitle text not null default 'RANKING DE VENDAS',
  add column panel_celebration_label text not null default 'VENDA CONFIRMADA',
  add column panel_footer_text text not null default 'Modo TV ativo';
