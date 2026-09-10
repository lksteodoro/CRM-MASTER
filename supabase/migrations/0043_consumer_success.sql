-- =============================================================================
-- 0043 — Consumer Success
--
-- CRM de gestão de clientes via grupos de WhatsApp (Evolution API).
--  - Inbox de duas vias: ver mensagens que chegam nos grupos e responder pelo CRM
--  - Mensagens periódicas com auto-envio (diário / semanal / mensal / uma vez)
--
-- Toda a comunicação com a Evolution API roda em Edge Function (service role).
-- O front-end nunca fala direto com a Evolution nem lê a api_key.
-- =============================================================================

create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- Config da conexão Evolution API (uma por organização).
-- -----------------------------------------------------------------------------
create table public.cs_integration (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  base_url text not null,
  api_key text not null,
  instance_name text not null,
  webhook_secret text not null
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  connected boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

alter table public.cs_integration enable row level security;

create policy cs_integration_admin_all on public.cs_integration
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop trigger if exists trg_cs_integration_updated_at on public.cs_integration;
create trigger trg_cs_integration_updated_at before update on public.cs_integration
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Grupos de WhatsApp sincronizados do Evolution.
-- -----------------------------------------------------------------------------
create table public.cs_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  evolution_jid text not null,
  name text,
  description text,
  avatar_url text,
  participant_count integer,
  client_id uuid references public.clients(id) on delete set null,
  is_managed boolean not null default false,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, evolution_jid)
);

create index idx_cs_groups_managed
  on public.cs_groups (organization_id, is_managed, last_message_at desc);

alter table public.cs_groups enable row level security;

create policy cs_groups_admin_all on public.cs_groups
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop trigger if exists trg_cs_groups_updated_at on public.cs_groups;
create trigger trg_cs_groups_updated_at before update on public.cs_groups
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Mensagens periódicas com auto-envio.
-- -----------------------------------------------------------------------------
create table public.cs_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  group_id uuid not null references public.cs_groups(id) on delete cascade,
  title text not null,
  body text not null,
  media_url text,
  recurrence text not null check (recurrence in ('once', 'daily', 'weekly', 'monthly')),
  send_time time not null default '09:00',
  weekday integer check (weekday between 0 and 6),
  day_of_month integer check (day_of_month between 1 and 28),
  starts_on date not null default current_date,
  ends_on date,
  active boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cs_scheduled_active on public.cs_scheduled_messages (organization_id, active);

alter table public.cs_scheduled_messages enable row level security;

create policy cs_scheduled_admin_all on public.cs_scheduled_messages
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop trigger if exists trg_cs_scheduled_updated_at on public.cs_scheduled_messages;
create trigger trg_cs_scheduled_updated_at before update on public.cs_scheduled_messages
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Log de mensagens (entrada e saída).
-- -----------------------------------------------------------------------------
create table public.cs_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  group_id uuid not null references public.cs_groups(id) on delete cascade,
  evolution_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_name text,
  sender_jid text,
  body text,
  media_type text check (media_type in ('image', 'video', 'audio', 'document', 'sticker')),
  media_url text,
  status text not null default 'received'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  sent_by uuid references public.profiles(id) on delete set null,
  scheduled_message_id uuid references public.cs_scheduled_messages(id) on delete set null,
  from_me boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, evolution_message_id)
);

create index idx_cs_messages_group_time on public.cs_messages (group_id, occurred_at desc);

alter table public.cs_messages enable row level security;

create policy cs_messages_admin_all on public.cs_messages
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

-- -----------------------------------------------------------------------------
-- Segredo do cron (não exposto a ninguém autenticado; só service_role lê,
-- porque bypassa RLS). Usado pra autenticar o job agendado -> Edge Function.
-- -----------------------------------------------------------------------------
create table public.cs_cron_config (
  id boolean primary key default true check (id),
  cron_secret text not null
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
);
insert into public.cs_cron_config default values;
alter table public.cs_cron_config enable row level security;
-- nenhuma policy: authenticated/anon não acessam; service_role bypassa RLS.
