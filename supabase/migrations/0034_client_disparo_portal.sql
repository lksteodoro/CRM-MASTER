-- =============================================================================
-- 0034 — Portal de demandas de disparo do cliente
--
-- O cliente só cria pedidos. A operação (sender, etiqueta, template, teste e
-- disparo) continua exclusiva da agência no quadro interno.
-- =============================================================================

create table if not exists public.client_disparo_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  profile_name text,
  default_ddd text,
  profile_photo_path text,
  profile_cover_path text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_disparo_profiles_ddd_check check (
    default_ddd is null or default_ddd ~ '^\\d{2,3}$'
  )
);

create index if not exists client_disparo_profiles_organization_idx
  on public.client_disparo_profiles (organization_id);

drop trigger if exists trg_client_disparo_profiles_updated_at on public.client_disparo_profiles;
create trigger trg_client_disparo_profiles_updated_at
  before update on public.client_disparo_profiles
  for each row execute function public.fn_set_updated_at();

alter table public.disparo_tasks
  add column if not exists request_source text not null default 'agency'
    check (request_source in ('agency', 'client_portal')),
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
  add column if not exists list_duplicate_count bigint not null default 0 check (list_duplicate_count >= 0);

create index if not exists disparo_tasks_client_portal_idx
  on public.disparo_tasks (client_id, request_source, client_submitted_at desc)
  where archived_at is null;

-- Dados da lista e imagens de perfil do cliente são privados. A agência pode
-- acessar qualquer arquivo da organização; o cliente acessa somente a pasta
-- cujo primeiro segmento é seu client_id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-demand-files',
  'client-demand-files',
  false,
  16777216,
  array['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.client_disparo_profiles enable row level security;

drop policy if exists client_disparo_profiles_admin_all on public.client_disparo_profiles;
create policy client_disparo_profiles_admin_all on public.client_disparo_profiles
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists client_disparo_profiles_client_select on public.client_disparo_profiles;
create policy client_disparo_profiles_client_select on public.client_disparo_profiles
  for select to authenticated
  using (private.has_client_access(client_id));

drop policy if exists client_disparo_profiles_client_insert on public.client_disparo_profiles;
create policy client_disparo_profiles_client_insert on public.client_disparo_profiles
  for insert to authenticated
  with check (
    private.has_client_access(client_id)
    and organization_id = private.current_organization_id()
    and updated_by = auth.uid()
  );

drop policy if exists client_disparo_profiles_client_update on public.client_disparo_profiles;
create policy client_disparo_profiles_client_update on public.client_disparo_profiles
  for update to authenticated
  using (private.has_client_access(client_id))
  with check (
    private.has_client_access(client_id)
    and organization_id = private.current_organization_id()
    and updated_by = auth.uid()
  );

-- Clientes podem consultar e criar somente seus pedidos do portal. Não existe
-- policy de DELETE nem de relações de números/etiquetas, portanto não têm como
-- criar sender, etiqueta ou executar um disparo.
drop policy if exists disparo_tasks_client_portal_select on public.disparo_tasks;
create policy disparo_tasks_client_portal_select on public.disparo_tasks
  for select to authenticated
  using (
    request_source = 'client_portal'
    and private.has_client_access(client_id)
  );

drop policy if exists disparo_tasks_client_portal_insert on public.disparo_tasks;
create policy disparo_tasks_client_portal_insert on public.disparo_tasks
  for insert to authenticated
  with check (
    request_source = 'client_portal'
    and status = 'pedido'
    and created_by = auth.uid()
    and client_submitted_at is not null
    and client_id is not null
    and private.has_client_access(client_id)
    and organization_id = private.current_organization_id()
  );

-- Não há policy de UPDATE para CLIENT em disparo_tasks. Depois do envio, só a
-- agência pode alterar campos operacionais ou movimentar o card.

create or replace function private.can_access_client_demand_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  path_client_id uuid;
begin
  -- Nunca converte texto arbitrário em UUID. Caminhos válidos começam com o
  -- client_id canônico e pertencem à organização da sessão atual.
  if p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then
    return false;
  end if;
  path_client_id := split_part(p_name, '/', 1)::uuid;
  return exists (
    select 1
      from public.clients c
     where c.id = path_client_id
       and c.organization_id = private.current_organization_id()
       and (private.is_admin() or private.has_client_access(c.id))
  );
end;
$$;

grant execute on function private.can_access_client_demand_file(text) to authenticated;

drop policy if exists client_demand_files_select on storage.objects;
create policy client_demand_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-demand-files'
    and private.can_access_client_demand_file(name)
  );

drop policy if exists client_demand_files_insert on storage.objects;
create policy client_demand_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-demand-files'
    and private.can_access_client_demand_file(name)
  );

drop policy if exists client_demand_files_update on storage.objects;
create policy client_demand_files_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'client-demand-files'
    and private.can_access_client_demand_file(name)
  )
  with check (
    bucket_id = 'client-demand-files'
    and private.can_access_client_demand_file(name)
  );

drop policy if exists client_demand_files_delete on storage.objects;
create policy client_demand_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-demand-files'
    and private.can_access_client_demand_file(name)
  );
