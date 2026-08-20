-- =============================================================================
-- 0035 — Correções de segurança do portal de demandas do cliente
-- =============================================================================

-- Em bancos que já receberam a 0034, remove a permissão genérica de UPDATE:
-- uma demanda enviada pelo cliente não pode ser alterada pelo navegador.
drop policy if exists disparo_tasks_client_portal_update on public.disparo_tasks;

-- O helper valida a forma do caminho antes do cast e confirma o tenant pelo
-- client_id. Assim, um usuário de outra organização nunca acessa um arquivo
-- apenas por conhecer o UUID de um cliente.
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
  using (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));

drop policy if exists client_demand_files_insert on storage.objects;
create policy client_demand_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));

drop policy if exists client_demand_files_update on storage.objects;
create policy client_demand_files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name))
  with check (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));

drop policy if exists client_demand_files_delete on storage.objects;
create policy client_demand_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-demand-files' and private.can_access_client_demand_file(name));
