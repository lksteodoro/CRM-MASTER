-- Rascunhos de transmissão: cada lista/etiqueta aponta manualmente para um
-- template aprovado do sender informado.
create table if not exists public.infobip_broadcast_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 140),
  sender text not null check (sender ~ '^[1-9][0-9]{9,15}$'),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'SENDING', 'FINISHED', 'FAILED')),
  total_leads integer not null default 0 check (total_leads >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.infobip_broadcast_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  draft_id uuid not null references public.infobip_broadcast_drafts(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 120),
  file_name text not null,
  file_url text not null check (file_url ~* '^https://'),
  lead_count integer not null check (lead_count between 1 and 5000),
  template_id text not null,
  template_name text not null,
  template_language text not null,
  position integer not null default 0,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'SENDING', 'FINISHED', 'FAILED')),
  created_at timestamptz not null default now()
);

create index if not exists infobip_broadcast_drafts_org_idx
  on public.infobip_broadcast_drafts (organization_id, updated_at desc);
create index if not exists infobip_broadcast_items_draft_idx
  on public.infobip_broadcast_items (draft_id, position);

drop trigger if exists trg_infobip_broadcast_drafts_updated_at on public.infobip_broadcast_drafts;
create trigger trg_infobip_broadcast_drafts_updated_at
  before update on public.infobip_broadcast_drafts
  for each row execute function public.fn_set_updated_at();

alter table public.infobip_broadcast_drafts enable row level security;
alter table public.infobip_broadcast_items enable row level security;

create policy infobip_broadcast_drafts_admin_all on public.infobip_broadcast_drafts
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

create policy infobip_broadcast_items_admin_all on public.infobip_broadcast_items
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

