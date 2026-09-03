-- =============================================================================
-- DEPLOY ÚNICO PENDENTE — INFobip, Transmissões e Portal de Demandas
-- =============================================================================
-- Use este arquivo UMA ÚNICA VEZ em ambientes que ainda NÃO executaram as
-- migrations 0032 até 0040. Ele substitui essas migrations no SQL Editor.
-- Não execute este arquivo junto com 0032...0040 no mesmo banco.
-- Pré-requisitos: migrations 0001...0031 já aplicadas e Edge Functions
-- `infobip-templates`, `client-demand-submit` e `meta-oauth` publicadas após o SQL.
-- =============================================================================

begin;

-- Credenciais da Infobip (somente Edge Function, nunca browser).
create table if not exists public.infobip_api_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  base_url text not null check (base_url ~* '^https://'),
  api_key_ciphertext text not null,
  api_key_hint text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_infobip_api_settings_updated_at on public.infobip_api_settings;
create trigger trg_infobip_api_settings_updated_at before update on public.infobip_api_settings
  for each row execute function public.fn_set_updated_at();
alter table public.infobip_api_settings enable row level security;
revoke all on public.infobip_api_settings from anon, authenticated;

-- Rascunhos internos: sender + template + etiqueta da audiência já existente
-- no People/Infobip. Não há CSV nem contatos armazenados nesta estrutura.
create table if not exists public.infobip_broadcast_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 140),
  sender text not null check (sender ~ '^[1-9][0-9]{9,15}$'),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'SENDING', 'FINISHED', 'FAILED')),
  total_leads integer not null default 0 check (total_leads >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.infobip_broadcast_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  draft_id uuid not null references public.infobip_broadcast_drafts(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 120),
  file_name text, file_url text, lead_count integer check (lead_count is null or lead_count between 1 and 5000),
  infobip_tag_id text, infobip_tag_name text,
  infobip_tag_people_count integer check (infobip_tag_people_count is null or infobip_tag_people_count >= 0),
  template_id text not null, template_name text not null, template_language text not null,
  position integer not null default 0,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'SENDING', 'FINISHED', 'FAILED')),
  created_at timestamptz not null default now()
);
-- Compatibilidade caso 0032/0033 já tenham sido aplicadas parcialmente.
alter table public.infobip_broadcast_items
  alter column file_name drop not null,
  alter column file_url drop not null,
  alter column lead_count drop not null,
  add column if not exists infobip_tag_id text,
  add column if not exists infobip_tag_name text,
  add column if not exists infobip_tag_people_count integer;
create index if not exists infobip_broadcast_drafts_org_idx on public.infobip_broadcast_drafts (organization_id, updated_at desc);
create index if not exists infobip_broadcast_items_draft_idx on public.infobip_broadcast_items (draft_id, position);
create index if not exists infobip_broadcast_items_tag_idx on public.infobip_broadcast_items (organization_id, infobip_tag_id);
drop trigger if exists trg_infobip_broadcast_drafts_updated_at on public.infobip_broadcast_drafts;
create trigger trg_infobip_broadcast_drafts_updated_at before update on public.infobip_broadcast_drafts
  for each row execute function public.fn_set_updated_at();
alter table public.infobip_broadcast_drafts enable row level security;
alter table public.infobip_broadcast_items enable row level security;
drop policy if exists infobip_broadcast_drafts_admin_all on public.infobip_broadcast_drafts;
create policy infobip_broadcast_drafts_admin_all on public.infobip_broadcast_drafts for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());
drop policy if exists infobip_broadcast_items_admin_all on public.infobip_broadcast_items;
create policy infobip_broadcast_items_admin_all on public.infobip_broadcast_items for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

-- Perfil padrão reutilizável para as demandas de cada cliente.
create table if not exists public.client_disparo_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  profile_name text, default_ddd text check (default_ddd is null or default_ddd ~ '^\\d{2,3}$'),
  profile_photo_path text, profile_cover_path text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists client_disparo_profiles_organization_idx on public.client_disparo_profiles (organization_id);
drop trigger if exists trg_client_disparo_profiles_updated_at on public.client_disparo_profiles;
create trigger trg_client_disparo_profiles_updated_at before update on public.client_disparo_profiles
  for each row execute function public.fn_set_updated_at();

-- Snapshot, origem e contagem validada pela Edge Function na demanda.
alter table public.disparo_tasks
  add column if not exists request_source text not null default 'agency' check (request_source in ('agency', 'client_portal')),
  add column if not exists client_submitted_at timestamptz,
  add column if not exists client_notes text,
  add column if not exists profile_name_snapshot text,
  add column if not exists profile_ddd_snapshot text,
  add column if not exists profile_photo_path text,
  add column if not exists profile_cover_path text,
  add column if not exists source_list_path text,
  add column if not exists source_list_file_name text,
  add column if not exists source_list_mime_type text,
  add column if not exists list_original_count bigint not null default 0 check (list_original_count >= 0),
  add column if not exists list_valid_count bigint not null default 0 check (list_valid_count >= 0),
  add column if not exists list_invalid_count bigint not null default 0 check (list_invalid_count >= 0),
  add column if not exists list_duplicate_count bigint not null default 0 check (list_duplicate_count >= 0),
  add column if not exists client_portal_status text not null default 'submitted' check (client_portal_status in ('submitted', 'under_review', 'action_required', 'approved')),
  add column if not exists client_feedback_comment text,
  add column if not exists client_feedback_at timestamptz,
  add column if not exists client_feedback_by uuid references auth.users(id) on delete set null;
alter table public.disparo_tasks drop constraint if exists disparo_tasks_list_counts_consistent;
alter table public.disparo_tasks add constraint disparo_tasks_list_counts_consistent
  check (list_original_count = list_valid_count + list_invalid_count + list_duplicate_count);
create index if not exists disparo_tasks_client_portal_idx on public.disparo_tasks (client_id, request_source, client_submitted_at desc) where archived_at is null;
create index if not exists disparo_tasks_client_portal_feedback_idx on public.disparo_tasks (client_id, client_portal_status, client_submitted_at desc) where request_source = 'client_portal' and archived_at is null;

-- Arquivos de lista/fotos de perfil são privados e segregados por tenant.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-demand-files', 'client-demand-files', false, 16777216,
  array['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_access_client_demand_file(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, storage as $$
declare path_client_id uuid;
begin
  if p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then return false; end if;
  path_client_id := split_part(p_name, '/', 1)::uuid;
  return exists (select 1 from public.clients c where c.id = path_client_id
    and c.organization_id = private.current_organization_id()
    and (private.is_admin() or private.has_client_access(c.id)));
end;
$$;
grant execute on function private.can_access_client_demand_file(text) to authenticated;
drop policy if exists client_demand_files_select on storage.objects;
create policy client_demand_files_select on storage.objects for select to authenticated using (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));
drop policy if exists client_demand_files_insert on storage.objects;
create policy client_demand_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));
drop policy if exists client_demand_files_update on storage.objects;
create policy client_demand_files_update on storage.objects for update to authenticated using (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name)) with check (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));
drop policy if exists client_demand_files_delete on storage.objects;
create policy client_demand_files_delete on storage.objects for delete to authenticated using (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));

-- Cliente lê/cria apenas o próprio pedido. Depois do envio, alterações são da agência.
alter table public.client_disparo_profiles enable row level security;
drop policy if exists client_disparo_profiles_admin_all on public.client_disparo_profiles;
create policy client_disparo_profiles_admin_all on public.client_disparo_profiles for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id()) with check (private.is_admin() and organization_id = private.current_organization_id());
drop policy if exists client_disparo_profiles_client_select on public.client_disparo_profiles;
create policy client_disparo_profiles_client_select on public.client_disparo_profiles for select to authenticated using (private.has_client_access(client_id));
drop policy if exists client_disparo_profiles_client_insert on public.client_disparo_profiles;
create policy client_disparo_profiles_client_insert on public.client_disparo_profiles for insert to authenticated with check (private.has_client_access(client_id) and organization_id = private.current_organization_id() and updated_by = auth.uid());
drop policy if exists client_disparo_profiles_client_update on public.client_disparo_profiles;
create policy client_disparo_profiles_client_update on public.client_disparo_profiles for update to authenticated using (private.has_client_access(client_id)) with check (private.has_client_access(client_id) and organization_id = private.current_organization_id() and updated_by = auth.uid());
drop policy if exists disparo_tasks_client_portal_select on public.disparo_tasks;
create policy disparo_tasks_client_portal_select on public.disparo_tasks for select to authenticated using (request_source = 'client_portal' and private.has_client_access(client_id));
drop policy if exists disparo_tasks_client_portal_insert on public.disparo_tasks;
create policy disparo_tasks_client_portal_insert on public.disparo_tasks for insert to authenticated with check (request_source = 'client_portal' and status = 'pedido' and created_by = auth.uid() and client_submitted_at is not null and client_id is not null and private.has_client_access(client_id) and organization_id = private.current_organization_id());
drop policy if exists disparo_tasks_client_portal_update on public.disparo_tasks;

-- O mínimo e a aprovação são regras de banco, não apenas de interface.
create or replace function public.fn_disparo_portal_minimum_contacts()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.request_source = 'client_portal' and old.status = 'pedido'
     and new.status <> 'pedido' and new.client_portal_status = 'submitted' then
    new.client_portal_status := 'under_review';
  end if;
  if new.request_source = 'client_portal' and new.status in ('disparo', 'finalizado') then
    if new.client_portal_status <> 'approved' then
      raise exception 'A demanda do portal precisa ser aprovada pela agência antes de iniciar o disparo.' using errcode = 'check_violation';
    end if;
    if coalesce(new.list_valid_count, 0) < 1000 then
      raise exception 'Esta demanda possui % contatos válidos. São necessários pelo menos 1.000 para iniciar o disparo.', coalesce(new.list_valid_count, 0) using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_disparo_portal_minimum_contacts on public.disparo_tasks;
create trigger trg_disparo_portal_minimum_contacts before insert or update of status, list_valid_count, request_source on public.disparo_tasks
  for each row execute function public.fn_disparo_portal_minimum_contacts();

-- Permissões granulares para cada ferramenta visível na área da agência.
create table if not exists public.agency_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool_key text not null check (tool_key in (
    'disparo.dashboard', 'disparo.redirects', 'disparo.templates',
    'disparo.broadcasts', 'disparo.request', 'disparo.demands',
    'disparo.sanitizer', 'disparo.report', 'meta_ads', 'zpl_pdf'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, tool_key)
);
create index if not exists agency_tool_permissions_user_idx on public.agency_tool_permissions (user_id, tool_key);
drop trigger if exists trg_agency_tool_permissions_updated_at on public.agency_tool_permissions;
create trigger trg_agency_tool_permissions_updated_at before update on public.agency_tool_permissions
  for each row execute function public.fn_set_updated_at();
alter table public.agency_tool_permissions enable row level security;
drop policy if exists agency_tool_permissions_select on public.agency_tool_permissions;
create policy agency_tool_permissions_select on public.agency_tool_permissions for select to authenticated
  using ((user_id = auth.uid() and organization_id = private.current_organization_id()) or (private.is_admin() and organization_id = private.current_organization_id()));
drop policy if exists agency_tool_permissions_admin_write on public.agency_tool_permissions;
create policy agency_tool_permissions_admin_write on public.agency_tool_permissions for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

create or replace function private.has_agency_tool_access(p_tool_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_admin() or exists (
    select 1 from public.agency_tool_permissions permission
     where permission.user_id = auth.uid()
       and permission.organization_id = private.current_organization_id()
       and permission.tool_key = p_tool_key
  );
$$;
grant execute on function private.has_agency_tool_access(text) to authenticated;

create or replace function public.set_user_agency_tool_permissions(p_user_id uuid, p_tool_keys text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := private.current_organization_id();
  v_allowed_keys constant text[] := array[
    'disparo.dashboard', 'disparo.redirects', 'disparo.templates', 'disparo.broadcasts',
    'disparo.request', 'disparo.demands', 'disparo.sanitizer', 'disparo.report', 'meta_ads', 'zpl_pdf'
  ];
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if v_org_id is null or not exists (select 1 from public.profiles p where p.id = p_user_id and p.organization_id = v_org_id) then
    raise exception 'user_not_in_organization';
  end if;
  if exists (select 1 from unnest(coalesce(p_tool_keys, '{}'::text[])) key where key is null or not (key = any(v_allowed_keys))) then
    raise exception 'invalid_tool_key';
  end if;
  delete from public.agency_tool_permissions where organization_id = v_org_id and user_id = p_user_id;
  insert into public.agency_tool_permissions (organization_id, user_id, tool_key)
  select v_org_id, p_user_id, key from (select distinct unnest(coalesce(p_tool_keys, '{}'::text[])) as key) requested;
end;
$$;
grant execute on function public.set_user_agency_tool_permissions(uuid, text[]) to authenticated;

-- 0040: conexão OAuth única da Meta e perfis compartilháveis por funcionário.
create table if not exists public.meta_oauth_connections (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id) on delete cascade,
  meta_user_id text, meta_user_name text, scopes text[] not null default '{}',
  status text not null default 'CONNECTED' check (status in ('CONNECTED','ERROR','REVOKED')),
  expires_at timestamptz, last_error text, connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists private.meta_oauth_secrets (
  connection_id uuid primary key references public.meta_oauth_connections(id) on delete cascade,
  access_token text not null, updated_at timestamptz not null default now()
);
create table if not exists private.meta_oauth_states (
  state uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table public.meta_oauth_connections enable row level security;
drop policy if exists meta_oauth_connections_admin_select on public.meta_oauth_connections;
create policy meta_oauth_connections_admin_select on public.meta_oauth_connections for select to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id());
drop policy if exists meta_oauth_connections_admin_write on public.meta_oauth_connections;
create policy meta_oauth_connections_admin_write on public.meta_oauth_connections for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());
drop trigger if exists trg_meta_oauth_connections_updated_at on public.meta_oauth_connections;
create trigger trg_meta_oauth_connections_updated_at before update on public.meta_oauth_connections for each row execute function public.fn_set_updated_at();

create table if not exists public.meta_publishing_profiles (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, name text not null check (char_length(trim(name)) between 1 and 120),
  image_data text, bm_id text, bm_name text, ad_account_id text, ad_account_name text, page_id text, page_name text,
  instagram_id text, instagram_name text, pixel_id text, pixel_name text, daily_budget numeric(12,2),
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.meta_publishing_profile_users (
  profile_id uuid not null references public.meta_publishing_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (profile_id,user_id)
);
create index if not exists meta_publishing_profiles_org_idx on public.meta_publishing_profiles (organization_id,updated_at desc);
create index if not exists meta_publishing_profile_users_user_idx on public.meta_publishing_profile_users (user_id,profile_id);
alter table public.meta_publishing_profiles enable row level security;
alter table public.meta_publishing_profile_users enable row level security;
create or replace function private.has_meta_profile_access(p_profile_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select private.is_admin() or exists (select 1 from public.meta_publishing_profile_users access where access.profile_id=p_profile_id and access.user_id=auth.uid() and access.organization_id=private.current_organization_id());
$$;
grant execute on function private.has_meta_profile_access(uuid) to authenticated;
drop policy if exists meta_publishing_profiles_select on public.meta_publishing_profiles;
create policy meta_publishing_profiles_select on public.meta_publishing_profiles for select to authenticated
  using (organization_id=private.current_organization_id() and private.has_meta_profile_access(id));
drop policy if exists meta_publishing_profiles_admin_write on public.meta_publishing_profiles;
create policy meta_publishing_profiles_admin_write on public.meta_publishing_profiles for all to authenticated
  using (private.is_admin() and organization_id=private.current_organization_id())
  with check (private.is_admin() and organization_id=private.current_organization_id());
drop policy if exists meta_publishing_profile_users_select on public.meta_publishing_profile_users;
create policy meta_publishing_profile_users_select on public.meta_publishing_profile_users for select to authenticated
  using (organization_id=private.current_organization_id() and (private.is_admin() or user_id=auth.uid()));
drop policy if exists meta_publishing_profile_users_admin_write on public.meta_publishing_profile_users;
create policy meta_publishing_profile_users_admin_write on public.meta_publishing_profile_users for all to authenticated
  using (private.is_admin() and organization_id=private.current_organization_id())
  with check (private.is_admin() and organization_id=private.current_organization_id());
drop trigger if exists trg_meta_publishing_profiles_updated_at on public.meta_publishing_profiles;
create trigger trg_meta_publishing_profiles_updated_at before update on public.meta_publishing_profiles for each row execute function public.fn_set_updated_at();

commit;
