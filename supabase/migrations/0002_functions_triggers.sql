-- =============================================================================
-- 0002 — Funções auxiliares e triggers
--
-- IMPORTANTE: as funções de autorização são SECURITY DEFINER de propósito.
-- Se uma política de RLS sobre `profiles` consultasse `profiles` diretamente,
-- o Postgres entraria em recursão infinita. SECURITY DEFINER ignora RLS dentro
-- da função, quebrando o ciclo. Todas fixam search_path para evitar sequestro
-- de resolução de nomes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at before update on public.organizations
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at before update on public.clients
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_project_users_updated_at on public.project_users;
create trigger trg_project_users_updated_at before update on public.project_users
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_project_goals_updated_at on public.project_goals;
create trigger trg_project_goals_updated_at before update on public.project_goals
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_project_settings_updated_at on public.project_settings;
create trigger trg_project_settings_updated_at before update on public.project_settings
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Helpers de autorização
-- -----------------------------------------------------------------------------

create or replace function public.current_profile_role()
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

-- Variantes "raw" ignoram o filtro de status ACTIVE. Usadas apenas nas policies
-- de auto-edição de profile, para comparar o valor atual sem recursão de RLS.
create or replace function public.current_profile_role_raw()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_profile_status_raw()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.status from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'ADMIN', false);
$$;

create or replace function public.current_organization_id()
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

-- O usuário pertence a este cliente?
create or replace function public.has_client_access(p_client_id uuid)
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

-- O usuário tem a permissão pedida neste projeto?
-- p_permission aceita: view, edit_goals, edit_settings, view_leads,
-- view_sales, view_commercial, export.
create or replace function public.has_project_permission(
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

-- -----------------------------------------------------------------------------
-- Criação automática de profile ao registrar usuário no Auth
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- organization_id / name / role podem vir do convite (raw_user_meta_data).
  v_org := nullif(new.raw_user_meta_data ->> 'organization_id', '')::uuid;

  if v_org is null then
    select o.id into v_org from public.organizations o order by o.created_at limit 1;
  end if;

  insert into public.profiles (id, organization_id, name, email, role, status)
  values (
    new.id,
    v_org,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role', 'CLIENT'),
    case when new.email_confirmed_at is null then 'INVITED' else 'ACTIVE' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ao confirmar o e-mail, o convite vira acesso ativo.
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles
       set status = 'ACTIVE'
     where id = new.id
       and status = 'INVITED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_confirmed on auth.users;
create trigger trg_on_auth_user_confirmed
  after update on auth.users
  for each row execute function public.handle_user_confirmed();

-- -----------------------------------------------------------------------------
-- Auditoria genérica
--
-- Trabalha sobre jsonb (to_jsonb) em vez de acessar colunas nomeadas, para que
-- a mesma função sirva a qualquer tabela. Em UPDATE grava uma linha por campo
-- alterado; em INSERT/DELETE grava uma linha com o payload completo.
-- Como roda no banco, alterações feitas via API também ficam auditadas.
-- -----------------------------------------------------------------------------
create or replace function public.fn_audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity   text := tg_argv[0];
  v_old      jsonb;
  v_new      jsonb;
  v_org      uuid;
  v_entity_id uuid;
  v_key      text;
  v_ignored  text[] := array['updated_at', 'created_at'];
begin
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;

  -- organization_id direto na linha, ou resolvido via projeto/cliente.
  v_org := nullif(coalesce(v_new ->> 'organization_id', v_old ->> 'organization_id'), '')::uuid;

  if v_org is null and coalesce(v_new ->> 'project_id', v_old ->> 'project_id') is not null then
    select p.organization_id
      into v_org
      from public.projects p
     where p.id = coalesce(v_new ->> 'project_id', v_old ->> 'project_id')::uuid;
  end if;

  if v_org is null and coalesce(v_new ->> 'client_id', v_old ->> 'client_id') is not null then
    select c.organization_id
      into v_org
      from public.clients c
     where c.id = coalesce(v_new ->> 'client_id', v_old ->> 'client_id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any (v_ignored) then
        continue;
      end if;
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        insert into public.audit_logs (
          organization_id, user_id, entity_type, entity_id,
          action, field_name, old_value, new_value
        )
        values (
          v_org, auth.uid(), v_entity, v_entity_id,
          'UPDATE', v_key, v_old -> v_key, v_new -> v_key
        );
      end if;
    end loop;
    return new;
  end if;

  insert into public.audit_logs (
    organization_id, user_id, entity_type, entity_id,
    action, old_value, new_value
  )
  values (
    v_org, auth.uid(), v_entity, v_entity_id,
    tg_op, v_old, v_new
  );

  return coalesce(new, old);
end;
$$;

-- Eventos obrigatórios de auditoria (seção 12 da especificação).
drop trigger if exists trg_audit_clients on public.clients;
create trigger trg_audit_clients
  after insert or update or delete on public.clients
  for each row execute function public.fn_audit_changes('CLIENT');

drop trigger if exists trg_audit_projects on public.projects;
create trigger trg_audit_projects
  after insert or update or delete on public.projects
  for each row execute function public.fn_audit_changes('PROJECT');

drop trigger if exists trg_audit_project_goals on public.project_goals;
create trigger trg_audit_project_goals
  after insert or update or delete on public.project_goals
  for each row execute function public.fn_audit_changes('PROJECT_GOAL');

drop trigger if exists trg_audit_project_settings on public.project_settings;
create trigger trg_audit_project_settings
  after insert or update or delete on public.project_settings
  for each row execute function public.fn_audit_changes('PROJECT_SETTINGS');

drop trigger if exists trg_audit_project_users on public.project_users;
create trigger trg_audit_project_users
  after insert or update or delete on public.project_users
  for each row execute function public.fn_audit_changes('PROJECT_USER');

drop trigger if exists trg_audit_client_users on public.client_users;
create trigger trg_audit_client_users
  after insert or update or delete on public.client_users
  for each row execute function public.fn_audit_changes('CLIENT_USER');

drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.fn_audit_changes('PROFILE');

-- -----------------------------------------------------------------------------
-- Cria a linha de configurações junto com o projeto.
-- -----------------------------------------------------------------------------
create or replace function public.fn_create_default_project_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_settings (project_id)
  values (new.id)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_projects_default_settings on public.projects;
create trigger trg_projects_default_settings
  after insert on public.projects
  for each row execute function public.fn_create_default_project_settings();
