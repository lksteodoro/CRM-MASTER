-- =============================================================================
-- Leads Hub — Fase 1 · Fundação
-- 0001 — Schema base: organizações, perfis, clientes, projetos, permissões,
--        metas, configurações e auditoria.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- organizations
-- Uma linha por instância da agência. Hoje existe apenas uma, mas todas as
-- tabelas relevantes carregam organization_id para permitir SaaS multiempresa
-- no futuro sem refazer a arquitetura.
-- -----------------------------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  status      text not null default 'active'
              check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- profiles
-- Complementa auth.users. O id é sempre igual ao id do usuário no Supabase Auth.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete restrict,
  name             text not null default '',
  email            text not null,
  role             text not null default 'CLIENT'
                   check (role in ('ADMIN', 'CLIENT')),
  status           text not null default 'INVITED'
                   check (status in ('ACTIVE', 'INVITED', 'DISABLED')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_profiles_organization_id on public.profiles (organization_id);
create index if not exists idx_profiles_email on public.profiles (lower(email));

-- -----------------------------------------------------------------------------
-- clients
-- Empresas atendidas pela agência. Nunca removidas fisicamente: usar ARCHIVED.
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  name             text not null,
  legal_name       text,
  document         text,
  logo_url         text,
  status           text not null default 'ACTIVE'
                   check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null
);

create index if not exists idx_clients_organization_id on public.clients (organization_id);
create index if not exists idx_clients_status on public.clients (status);

-- -----------------------------------------------------------------------------
-- client_users
-- Um cliente pode ter vários usuários; um usuário pode pertencer a mais de um
-- cliente (útil para holdings/grupos educacionais).
-- -----------------------------------------------------------------------------
create table if not exists public.client_users (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'ACTIVE'
              check (status in ('ACTIVE', 'DISABLED')),
  created_at  timestamptz not null default now(),
  unique (client_id, user_id)
);

create index if not exists idx_client_users_client_id on public.client_users (client_id);
create index if not exists idx_client_users_user_id on public.client_users (user_id);

-- -----------------------------------------------------------------------------
-- projects
-- Entidade central. Todo dado operacional pendura aqui.
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  client_id        uuid not null references public.clients (id) on delete restrict,
  name             text not null,
  slug             text not null,
  description      text,
  status           text not null default 'ACTIVE'
                   check (status in ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  timezone         text not null default 'America/Sao_Paulo',
  currency         text not null default 'BRL',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,
  unique (client_id, slug)
);

create index if not exists idx_projects_organization_id on public.projects (organization_id);
create index if not exists idx_projects_client_id on public.projects (client_id);
create index if not exists idx_projects_status on public.projects (status);

-- -----------------------------------------------------------------------------
-- project_users
-- Autorização granular. O ADMIN ignora estas linhas (ver políticas de RLS).
-- -----------------------------------------------------------------------------
create table if not exists public.project_users (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  user_id              uuid not null references public.profiles (id) on delete cascade,

  can_view             boolean not null default true,
  can_edit_goals       boolean not null default false,
  can_edit_settings    boolean not null default false,

  can_view_leads       boolean not null default true,
  can_view_sales       boolean not null default true,
  can_view_commercial  boolean not null default true,

  can_export           boolean not null default false,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists idx_project_users_project_id on public.project_users (project_id);
create index if not exists idx_project_users_user_id on public.project_users (user_id);

-- -----------------------------------------------------------------------------
-- project_goals
-- Metas por período — nunca sobrescritas em cima de um registro anterior de
-- outro período. Alterações dentro do mesmo período ficam registradas no
-- audit_logs pelo trigger.
-- -----------------------------------------------------------------------------
create table if not exists public.project_goals (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,

  period_start  date not null,
  period_end    date not null,

  spend_goal    numeric(14, 2),
  lead_goal     integer,
  cpl_goal      numeric(14, 2),

  sales_goal    integer,
  cac_goal      numeric(14, 2),

  revenue_goal  numeric(14, 2),
  roas_goal     numeric(10, 2),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,

  constraint project_goals_period_valid check (period_end >= period_start),
  unique (project_id, period_start, period_end)
);

create index if not exists idx_project_goals_project_id on public.project_goals (project_id);
create index if not exists idx_project_goals_period on public.project_goals (project_id, period_start desc);

-- -----------------------------------------------------------------------------
-- project_settings
-- Uma linha por projeto. Tabela propositalmente enxuta e extensível.
-- -----------------------------------------------------------------------------
create table if not exists public.project_settings (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null unique references public.projects (id) on delete cascade,

  lead_identity_strategy  text not null default 'EMAIL'
                          check (lead_identity_strategy in ('EMAIL', 'PHONE', 'EMAIL_OR_PHONE', 'EXTERNAL_ID')),
  attribution_strategy    text not null default 'FIRST_TOUCH'
                          check (attribution_strategy in ('FIRST_TOUCH', 'LAST_TOUCH')),

  alerts_enabled          boolean not null default true,
  commercial_enabled      boolean not null default true,
  ranking_enabled         boolean not null default true,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_project_settings_project_id on public.project_settings (project_id);

-- -----------------------------------------------------------------------------
-- audit_logs
-- Append-only. Sem update/delete pelas políticas de RLS.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete set null,
  user_id          uuid references public.profiles (id) on delete set null,

  entity_type      text not null,
  entity_id        uuid,

  action           text not null
                   check (action in ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'INVITE')),

  field_name       text,
  old_value        jsonb,
  new_value        jsonb,
  metadata         jsonb,

  created_at       timestamptz not null default now()
);

create index if not exists idx_audit_logs_organization_id on public.audit_logs (organization_id);
create index if not exists idx_audit_logs_entity_id on public.audit_logs (entity_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_entity_type on public.audit_logs (entity_type);
