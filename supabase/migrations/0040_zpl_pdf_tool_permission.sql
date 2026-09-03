-- Libera o conversor ZPL para PDF no controle granular de ferramentas.

alter table public.agency_tool_permissions
  drop constraint if exists agency_tool_permissions_tool_key_check;

alter table public.agency_tool_permissions
  add constraint agency_tool_permissions_tool_key_check check (tool_key in (
    'disparo.dashboard',
    'disparo.redirects',
    'disparo.templates',
    'disparo.broadcasts',
    'disparo.request',
    'disparo.demands',
    'disparo.sanitizer',
    'disparo.report',
    'meta_ads',
    'zpl_pdf'
  ));

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
    'disparo.sanitizer', 'disparo.report', 'meta_ads', 'zpl_pdf'
  ];
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;

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
    from (select distinct unnest(coalesce(p_tool_keys, '{}'::text[])) as key) requested;
end;
$$;

grant execute on function public.set_user_agency_tool_permissions(uuid, text[]) to authenticated;
