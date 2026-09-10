-- Alinha o Consumer Success ao controle granular de ferramentas: quem tem a
-- chave `consumer_success` (ou é admin) usa o inbox e as mensagens
-- programadas. A configuração da Evolution (que guarda a api_key) continua
-- restrita a admin — o front-end nunca lê essa linha, quem fala com a
-- Evolution é a Edge Function com service role.

create or replace function public.can_use_consumer_success()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_agency_tool_access('consumer_success');
$$;

revoke execute on function public.can_use_consumer_success() from public, anon;
grant execute on function public.can_use_consumer_success() to authenticated;

drop policy if exists cs_groups_admin_all on public.cs_groups;
create policy cs_groups_tool_all on public.cs_groups
  for all to authenticated
  using (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  )
  with check (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  );

drop policy if exists cs_messages_admin_all on public.cs_messages;
create policy cs_messages_tool_all on public.cs_messages
  for all to authenticated
  using (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  )
  with check (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  );

drop policy if exists cs_scheduled_admin_all on public.cs_scheduled_messages;
create policy cs_scheduled_tool_all on public.cs_scheduled_messages
  for all to authenticated
  using (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  )
  with check (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  );
