-- =============================================================================
-- 0009 — Leads e matrícula reais via webhook
--
-- O cliente já tem um CRM/planilha próprio para leads e vendas/matrícula.
-- Em vez de reinventar isso, o Leads Hub expõe um endpoint de webhook por
-- projeto: o CRM (ou site/landing page/typebot) envia o lead pra cá quando
-- ele é criado, e manda outro evento (mesmo endpoint, mesmo external_id)
-- quando o status muda — por exemplo virar "MATRICULADO". Isso substitui os
-- 277 leads / 34 vendas fictícios do dataset de demonstração.
-- =============================================================================

create table public.project_webhooks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  secret_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- id do lead no sistema de origem (CRM/site) — usado para fazer upsert
  -- quando o mesmo lead manda um evento de atualização (ex: matriculou).
  external_id text,
  name text,
  email text,
  phone text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  -- Correlação opcional com a campanha/anúncio real da Meta, quando o CRM
  -- souber informar (via UTM ou fbclid resolvido do lado do cliente).
  campaign_id text,
  ad_id text,
  -- Convenção: qualquer texto; o dashboard trata 'MATRICULADO' (sem acento,
  -- case-insensitive) como matrícula confirmada. Sugestões: NOVO,
  -- EM_ATENDIMENTO, MATRICULADO, PERDIDO — mas o CRM manda o que quiser.
  status text not null default 'NOVO',
  sale_value numeric(12, 2),
  enrolled_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, external_id)
);

create index idx_crm_leads_project on public.crm_leads (project_id);
create index idx_crm_leads_status on public.crm_leads (project_id, status);

alter table public.project_webhooks enable row level security;
alter table public.crm_leads enable row level security;

create policy project_webhooks_admin_all on public.project_webhooks
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy crm_leads_select on public.crm_leads
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view_leads'));

drop trigger if exists trg_project_webhooks_updated_at on public.project_webhooks;
create trigger trg_project_webhooks_updated_at before update on public.project_webhooks
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_crm_leads_updated_at on public.crm_leads;
create trigger trg_crm_leads_updated_at before update on public.crm_leads
  for each row execute function public.fn_set_updated_at();
