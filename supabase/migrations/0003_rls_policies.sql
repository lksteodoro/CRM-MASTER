-- =============================================================================
-- 0003 — Row Level Security
--
-- Regra geral:
--   ADMIN  → tudo dentro da sua organização
--   CLIENT → apenas clientes aos quais pertence e, dentro deles, apenas
--            projetos liberados em project_users (can_view = true)
--
-- A autorização NUNCA depende de valores enviados pelo front-end. Tudo é
-- derivado de auth.uid() e das tabelas de vínculo.
-- =============================================================================

alter table public.organizations   enable row level security;
alter table public.profiles        enable row level security;
alter table public.clients         enable row level security;
alter table public.client_users    enable row level security;
alter table public.projects        enable row level security;
alter table public.project_users   enable row level security;
alter table public.project_goals   enable row level security;
alter table public.project_settings enable row level security;
alter table public.audit_logs      enable row level security;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_organization_id());

drop policy if exists organizations_admin_write on public.organizations;
create policy organizations_admin_write on public.organizations
  for update to authenticated
  using (public.is_admin() and id = public.current_organization_id())
  with check (public.is_admin() and id = public.current_organization_id());

-- -----------------------------------------------------------------------------
-- profiles
-- Todo usuário lê o próprio perfil. ADMIN lê e gerencia os da organização.
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin() and organization_id = public.current_organization_id());

-- CLIENT enxerga os colegas que compartilham algum cliente com ele — necessário
-- para telas de equipe; não expõe usuários de outros clientes.
drop policy if exists profiles_select_same_client on public.profiles;
create policy profiles_select_same_client on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
        from public.client_users cu_self
        join public.client_users cu_other
          on cu_other.client_id = cu_self.client_id
       where cu_self.user_id = auth.uid()
         and cu_self.status = 'ACTIVE'
         and cu_other.user_id = profiles.id
    )
  );

-- As comparações usam helpers SECURITY DEFINER de propósito: uma subconsulta a
-- `profiles` dentro de uma policy de `profiles` causaria recursão infinita.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Um usuário não pode se promover nem se reativar sozinho.
    and role = public.current_profile_role_raw()
    and status = public.current_profile_status_raw()
  );

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin() and organization_id = public.current_organization_id())
  with check (public.is_admin() and organization_id = public.current_organization_id());

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (
    (public.is_admin() and organization_id = public.current_organization_id())
    or public.has_client_access(id)
  );

drop policy if exists clients_admin_write on public.clients;
create policy clients_admin_write on public.clients
  for all to authenticated
  using (public.is_admin() and organization_id = public.current_organization_id())
  with check (public.is_admin() and organization_id = public.current_organization_id());

-- -----------------------------------------------------------------------------
-- client_users
-- -----------------------------------------------------------------------------
drop policy if exists client_users_select on public.client_users;
create policy client_users_select on public.client_users
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.has_client_access(client_id)
  );

drop policy if exists client_users_admin_write on public.client_users;
create policy client_users_admin_write on public.client_users
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- projects
-- Um CLIENT só enxerga projeto liberado — mesmo digitando o id na URL, a
-- consulta volta vazia.
-- -----------------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (
    (public.is_admin() and organization_id = public.current_organization_id())
    or public.has_project_permission(id, 'view')
  );

drop policy if exists projects_admin_write on public.projects;
create policy projects_admin_write on public.projects
  for all to authenticated
  using (public.is_admin() and organization_id = public.current_organization_id())
  with check (public.is_admin() and organization_id = public.current_organization_id());

-- -----------------------------------------------------------------------------
-- project_users
-- Somente o ADMIN concede/revoga acesso. O usuário enxerga as próprias linhas.
-- -----------------------------------------------------------------------------
drop policy if exists project_users_select on public.project_users;
create policy project_users_select on public.project_users
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists project_users_admin_write on public.project_users;
create policy project_users_admin_write on public.project_users
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- project_goals
-- Leitura: quem enxerga o projeto. Escrita: ADMIN, ou CLIENT com
-- can_edit_goals = true.
-- -----------------------------------------------------------------------------
drop policy if exists project_goals_select on public.project_goals;
create policy project_goals_select on public.project_goals
  for select to authenticated
  using (public.is_admin() or public.has_project_permission(project_id, 'view'));

drop policy if exists project_goals_insert on public.project_goals;
create policy project_goals_insert on public.project_goals
  for insert to authenticated
  with check (public.is_admin() or public.has_project_permission(project_id, 'edit_goals'));

drop policy if exists project_goals_update on public.project_goals;
create policy project_goals_update on public.project_goals
  for update to authenticated
  using (public.is_admin() or public.has_project_permission(project_id, 'edit_goals'))
  with check (public.is_admin() or public.has_project_permission(project_id, 'edit_goals'));

drop policy if exists project_goals_delete on public.project_goals;
create policy project_goals_delete on public.project_goals
  for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- project_settings
-- -----------------------------------------------------------------------------
drop policy if exists project_settings_select on public.project_settings;
create policy project_settings_select on public.project_settings
  for select to authenticated
  using (public.is_admin() or public.has_project_permission(project_id, 'view'));

drop policy if exists project_settings_update on public.project_settings;
create policy project_settings_update on public.project_settings
  for update to authenticated
  using (public.is_admin() or public.has_project_permission(project_id, 'edit_settings'))
  with check (public.is_admin() or public.has_project_permission(project_id, 'edit_settings'));

drop policy if exists project_settings_admin_write on public.project_settings;
create policy project_settings_admin_write on public.project_settings
  for insert to authenticated
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- audit_logs
-- Append-only: sem políticas de UPDATE/DELETE, ninguém altera o histórico.
-- Os triggers são SECURITY DEFINER, então gravam mesmo com RLS ligada.
-- -----------------------------------------------------------------------------
drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_admin() and organization_id = public.current_organization_id());
