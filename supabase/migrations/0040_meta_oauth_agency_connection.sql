-- Conexão única da Meta por agência. O token fica em uma tabela sem policy de
-- leitura para o navegador; somente Edge Functions com service_role o acessam.

create table if not exists public.meta_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  meta_user_id text,
  meta_user_name text,
  scopes text[] not null default '{}',
  status text not null default 'CONNECTED' check (status in ('CONNECTED', 'ERROR', 'REVOKED')),
  expires_at timestamptz,
  last_error text,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.meta_oauth_secrets (
  connection_id uuid primary key references public.meta_oauth_connections(id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.meta_oauth_states (
  state uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.meta_oauth_connections enable row level security;

drop policy if exists meta_oauth_connections_admin_select on public.meta_oauth_connections;
create policy meta_oauth_connections_admin_select on public.meta_oauth_connections
  for select to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists meta_oauth_connections_admin_write on public.meta_oauth_connections;
create policy meta_oauth_connections_admin_write on public.meta_oauth_connections
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop trigger if exists trg_meta_oauth_connections_updated_at on public.meta_oauth_connections;
create trigger trg_meta_oauth_connections_updated_at before update on public.meta_oauth_connections
  for each row execute function public.fn_set_updated_at();

-- Perfis de publicação compartilháveis e acesso individual por usuário. A
-- configuração pode ser usada por quem recebeu a ferramenta Meta Ads, mas os
-- detalhes só aparecem se o perfil também tiver sido liberado.
create table if not exists public.meta_publishing_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  image_data text,
  bm_id text,
  bm_name text,
  ad_account_id text,
  ad_account_name text,
  page_id text,
  page_name text,
  instagram_id text,
  instagram_name text,
  pixel_id text,
  pixel_name text,
  daily_budget numeric(12,2),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_publishing_profile_users (
  profile_id uuid not null references public.meta_publishing_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, user_id)
);

create index if not exists meta_publishing_profiles_org_idx on public.meta_publishing_profiles (organization_id, updated_at desc);
create index if not exists meta_publishing_profile_users_user_idx on public.meta_publishing_profile_users (user_id, profile_id);

alter table public.meta_publishing_profiles enable row level security;
alter table public.meta_publishing_profile_users enable row level security;

create or replace function private.has_meta_profile_access(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_admin() or exists (
    select 1 from public.meta_publishing_profile_users access
    where access.profile_id = p_profile_id
      and access.user_id = auth.uid()
      and access.organization_id = private.current_organization_id()
  );
$$;
grant execute on function private.has_meta_profile_access(uuid) to authenticated;

drop policy if exists meta_publishing_profiles_select on public.meta_publishing_profiles;
create policy meta_publishing_profiles_select on public.meta_publishing_profiles
  for select to authenticated
  using (organization_id = private.current_organization_id() and private.has_meta_profile_access(id));
drop policy if exists meta_publishing_profiles_admin_write on public.meta_publishing_profiles;
create policy meta_publishing_profiles_admin_write on public.meta_publishing_profiles
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists meta_publishing_profile_users_select on public.meta_publishing_profile_users;
create policy meta_publishing_profile_users_select on public.meta_publishing_profile_users
  for select to authenticated
  using (organization_id = private.current_organization_id() and (private.is_admin() or user_id = auth.uid()));
drop policy if exists meta_publishing_profile_users_admin_write on public.meta_publishing_profile_users;
create policy meta_publishing_profile_users_admin_write on public.meta_publishing_profile_users
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop trigger if exists trg_meta_publishing_profiles_updated_at on public.meta_publishing_profiles;
create trigger trg_meta_publishing_profiles_updated_at before update on public.meta_publishing_profiles
  for each row execute function public.fn_set_updated_at();

