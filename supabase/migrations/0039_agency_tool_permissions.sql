-- Permissões granulares para as ferramentas operacionais da agência.
-- Administradores sempre têm acesso total; os demais usuários recebem somente
-- as chaves que a agência liberar explicitamente.

create table if not exists public.agency_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool_key text not null check (tool_key in (
    'disparo.dashboard',
    'disparo.redirects',
    'disparo.templates',
    'disparo.broadcasts',
    'disparo.request',
    'disparo.demands',
    'disparo.sanitizer',
    'disparo.report',
    'meta_ads'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, tool_key)
);

create index if not exists agency_tool_permissions_user_idx
  on public.agency_tool_permissions (user_id, tool_key);

drop trigger if exists trg_agency_tool_permissions_updated_at on public.agency_tool_permissions;
create trigger trg_agency_tool_permissions_updated_at
  before update on public.agency_tool_permissions
  for each row execute function public.fn_set_updated_at();

alter table public.agency_tool_permissions enable row level security;

drop policy if exists agency_tool_permissions_select on public.agency_tool_permissions;
create policy agency_tool_permissions_select on public.agency_tool_permissions
  for select to authenticated
  using (
    (user_id = auth.uid() and organization_id = private.current_organization_id())
    or (private.is_admin() and organization_id = private.current_organization_id())
  );

drop policy if exists agency_tool_permissions_admin_write on public.agency_tool_permissions;
create policy agency_tool_permissions_admin_write on public.agency_tool_permissions
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

create or replace function private.has_agency_tool_access(p_tool_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_admin() or exists (
    select 1
      from public.agency_tool_permissions permission
     where permission.user_id = auth.uid()
       and permission.organization_id = private.current_organization_id()
       and permission.tool_key = p_tool_key
  );
$$;

grant execute on function private.has_agency_tool_access(text) to authenticated;

-- A operação é atômica: evita uma tela parcialmente salva caso uma das chaves
-- seja inválida ou a conexão seja interrompida durante a atualização.
create or replace function public.set_user_agency_tool_permissions(
  p_user_id uuid,
  p_tool_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := private.current_organization_id();
  v_allowed_keys constant text[] := array[
    'disparo.dashboard', 'disparo.redirects', 'disparo.templates',
    'disparo.broadcasts', 'disparo.request', 'disparo.demands',
    'disparo.sanitizer', 'disparo.report', 'meta_ads'
  ];
begin
  if not private.is_admin() then
    raise exception 'forbidden';
  end if;

  if v_org_id is null or not exists (
    select 1 from public.profiles p
     where p.id = p_user_id and p.organization_id = v_org_id
  ) then
    raise exception 'user_not_in_organization';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_tool_keys, '{}'::text[])) key
     where key is null or not (key = any(v_allowed_keys))
  ) then
    raise exception 'invalid_tool_key';
  end if;

  delete from public.agency_tool_permissions
   where organization_id = v_org_id and user_id = p_user_id;

  insert into public.agency_tool_permissions (organization_id, user_id, tool_key)
  select v_org_id, p_user_id, key
    from (
      select distinct unnest(coalesce(p_tool_keys, '{}'::text[])) as key
    ) requested;
end;
$$;

grant execute on function public.set_user_agency_tool_permissions(uuid, text[]) to authenticated;
