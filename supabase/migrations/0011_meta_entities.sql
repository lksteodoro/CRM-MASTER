-- =============================================================================
-- 0011 — Metadados reais de campanha/conjunto/anúncio (status, criativo)
--
-- meta_ad_insights_daily guarda métricas diárias; esta tabela guarda o estado
-- "atual" de cada entidade (status real ACTIVE/PAUSED/ARCHIVED, thumbnail do
-- criativo) — não muda todo dia, então fica separada em vez de repetir em
-- toda linha de métrica.
-- =============================================================================

create table public.meta_entities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_type text not null check (entity_type in ('campaign', 'adset', 'ad')),
  external_id text not null,
  name text not null,
  status text,
  parent_external_id text,
  thumbnail_url text,
  updated_at timestamptz not null default now(),
  unique (project_id, entity_type, external_id)
);

create index idx_meta_entities_project_type on public.meta_entities (project_id, entity_type);

alter table public.meta_entities enable row level security;

create policy meta_entities_select on public.meta_entities
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view'));
