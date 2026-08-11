-- =============================================================================
-- 0005 — Hardening de segurança (achados do Supabase Advisor)
--
-- 1. fn_set_updated_at() não tinha search_path fixo (function_search_path_mutable).
-- 2. Os helpers de autorização (current_profile_role, is_admin, has_client_access,
--    has_project_permission, etc.) são SECURITY DEFINER e moravam em `public`,
--    então o PostgREST os expunha como endpoints RPC públicos
--    (/rest/v1/rpc/is_admin etc.) — chamáveis por qualquer usuário autenticado
--    ou até anônimo. Eles só deveriam ser usados internamente pelas políticas
--    de RLS. Solução: mover para um schema `private`, que o PostgREST nunca
--    expõe (não está na lista de schemas expostos da API), e atualizar as
--    políticas de RLS para chamar `private.*` em vez de `public.*`.
-- 3. As funções de trigger (fn_audit_changes, handle_new_user,
--    handle_user_confirmed, fn_create_default_project_settings) também
--    apareciam como RPC-exploráveis. Elas precisam continuar em `public`
--    porque disparam sobre tabelas de `public`/`auth`, mas não precisam de
--    EXECUTE concedido a `anon`/`authenticated` — o disparo de trigger não
--    depende do privilégio EXECUTE de quem fez o INSERT/UPDATE/DELETE.
--    Revogamos o EXECUTE público delas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. search_path fixo em fn_set_updated_at
-- -----------------------------------------------------------------------------
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Schema privado para os helpers de autorização usados pelas policies
-- -----------------------------------------------------------------------------
create schema if not exists private;

-- PostgREST só expõe os schemas listados em "Exposed schemas" (normalmente
-- só `public`/`graphql_public`). `private` nunca entra nessa lista, então
-- nada aqui vira endpoint /rest/v1/rpc/*, mesmo com EXECUTE concedido.
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
    from public.profiles p
   where p.id = auth.uid()
     and p.status = 'ACTIVE';
$$;

create or replace function private.current_profile_role_raw()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function private.current_profile_status_raw()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.status from public.profiles p where p.id = auth.uid();
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(private.current_profile_role() = 'ADMIN', false);
$$;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id
    from public.profiles p
   where p.id = auth.uid()
     and p.status = 'ACTIVE';
$$;

create or replace function private.has_client_access(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.client_users cu
     where cu.client_id = p_client_id
       and cu.user_id = auth.uid()
       and cu.status = 'ACTIVE'
  );
$$;

create or replace function private.has_project_permission(
  p_project_id uuid,
  p_permission text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.project_users pu
     where pu.project_id = p_project_id
       and pu.user_id = auth.uid()
       and pu.can_view = true
       and case p_permission
             when 'view'            then pu.can_view
             when 'edit_goals'      then pu.can_edit_goals
             when 'edit_settings'   then pu.can_edit_settings
             when 'view_leads'      then pu.can_view_leads
             when 'view_sales'      then pu.can_view_sales
             when 'view_commercial' then pu.can_view_commercial
             when 'export'          then pu.can_export
             else false
           end
  );
$$;

grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.current_profile_role_raw() to authenticated;
grant execute on function private.current_profile_status_raw() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.current_organization_id() to authenticated;
grant execute on function private.has_client_access(uuid) to authenticated;
grant execute on function private.has_project_permission(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2b. Reescreve as policies para usar private.* em vez de public.*
-- -----------------------------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = private.current_organization_id());

drop policy if exists organizations_admin_write on public.organizations;
create policy organizations_admin_write on public.organizations
  for update to authenticated
  using (private.is_admin() and id = private.current_organization_id())
  with check (private.is_admin() and id = private.current_organization_id());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = private.current_profile_role_raw()
    and status = private.current_profile_status_raw()
  );

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (
    (private.is_admin() and organization_id = private.current_organization_id())
    or private.has_client_access(id)
  );

drop policy if exists clients_admin_write on public.clients;
create policy clients_admin_write on public.clients
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists client_users_select on public.client_users;
create policy client_users_select on public.client_users
  for select to authenticated
  using (
    user_id = auth.uid()
    or private.is_admin()
    or private.has_client_access(client_id)
  );

drop policy if exists client_users_admin_write on public.client_users;
create policy client_users_admin_write on public.client_users
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (
    (private.is_admin() and organization_id = private.current_organization_id())
    or private.has_project_permission(id, 'view')
  );

drop policy if exists projects_admin_write on public.projects;
create policy projects_admin_write on public.projects
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists project_users_select on public.project_users;
create policy project_users_select on public.project_users
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

drop policy if exists project_users_admin_write on public.project_users;
create policy project_users_admin_write on public.project_users
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists project_goals_select on public.project_goals;
create policy project_goals_select on public.project_goals
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view'));

drop policy if exists project_goals_insert on public.project_goals;
create policy project_goals_insert on public.project_goals
  for insert to authenticated
  with check (private.is_admin() or private.has_project_permission(project_id, 'edit_goals'));

drop policy if exists project_goals_update on public.project_goals;
create policy project_goals_update on public.project_goals
  for update to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'edit_goals'))
  with check (private.is_admin() or private.has_project_permission(project_id, 'edit_goals'));

drop policy if exists project_goals_delete on public.project_goals;
create policy project_goals_delete on public.project_goals
  for delete to authenticated
  using (private.is_admin());

drop policy if exists project_settings_select on public.project_settings;
create policy project_settings_select on public.project_settings
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view'));

drop policy if exists project_settings_update on public.project_settings;
create policy project_settings_update on public.project_settings
  for update to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'))
  with check (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'));

drop policy if exists project_settings_admin_write on public.project_settings;
create policy project_settings_admin_write on public.project_settings
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id());

-- -----------------------------------------------------------------------------
-- 2c. Remove as versões antigas em `public` (nada mais depende delas)
-- -----------------------------------------------------------------------------
drop function if exists public.current_profile_role();
drop function if exists public.current_profile_role_raw();
drop function if exists public.current_profile_status_raw();
drop function if exists public.is_admin();
drop function if exists public.current_organization_id();
drop function if exists public.has_client_access(uuid);
drop function if exists public.has_project_permission(uuid, text);

-- -----------------------------------------------------------------------------
-- 3. Revoga EXECUTE das funções de trigger (não precisam ser chamáveis via
--    RPC — só disparam via trigger, o que não exige privilégio EXECUTE de
--    quem fez o INSERT/UPDATE/DELETE).
--
--    O Supabase concede EXECUTE explicitamente a `anon`/`authenticated` na
--    criação de cada função (não é só um grant herdado do pseudo-role
--    `public`), então é preciso revogar das duas roles nomeadas, e não só de
--    `public`.
-- -----------------------------------------------------------------------------
revoke execute on function public.fn_set_updated_at() from public, anon, authenticated;
revoke execute on function public.fn_audit_changes() from public, anon, authenticated;
revoke execute on function public.fn_create_default_project_settings() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_confirmed() from public, anon, authenticated;
