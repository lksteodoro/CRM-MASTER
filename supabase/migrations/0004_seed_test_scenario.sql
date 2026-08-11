-- =============================================================================
-- 0004 — Seed do cenário obrigatório de teste (seção 51 da especificação)
--
-- PRÉ-REQUISITO: os três usuários precisam existir em auth.users antes de rodar
-- este script. Crie-os no painel do Supabase (Authentication → Add user, com
-- "Auto Confirm User" marcado) usando exatamente estes e-mails:
--
--   lucas@agencia.com   (senha à sua escolha)  → vira ADMIN
--   maria@horizonte.com (senha à sua escolha)  → CLIENT
--   joao@horizonte.com  (senha à sua escolha)  → CLIENT
--
-- O trigger handle_new_user já cria o profile de cada um. Este script apenas
-- ajusta papéis e monta clientes, projetos e permissões.
--
-- É idempotente: pode rodar novamente sem duplicar dados.
-- =============================================================================

do $$
declare
  v_org      uuid;
  v_lucas    uuid;
  v_maria    uuid;
  v_joao     uuid;
  v_client   uuid;
  v_pos_ia   uuid;
  v_pos_dados uuid;
  v_mba      uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Organização
  -- ---------------------------------------------------------------------------
  insert into public.organizations (name, slug)
  values ('Leads Hub', 'leads-hub')
  on conflict (slug) do update set name = excluded.name
  returning id into v_org;

  if v_org is null then
    select id into v_org from public.organizations where slug = 'leads-hub';
  end if;

  -- ---------------------------------------------------------------------------
  -- Usuários (precisam existir em auth.users)
  -- ---------------------------------------------------------------------------
  select id into v_lucas from auth.users where lower(email) = 'lucas@agencia.com';
  select id into v_maria from auth.users where lower(email) = 'maria@horizonte.com';
  select id into v_joao  from auth.users where lower(email) = 'joao@horizonte.com';

  if v_lucas is null then
    raise exception
      'Usuário lucas@agencia.com não encontrado em auth.users. Crie os 3 usuários no painel do Supabase antes de rodar este seed.';
  end if;

  -- Garante o profile mesmo que o trigger não tenha rodado (usuários criados
  -- antes da migration 0002, por exemplo).
  insert into public.profiles (id, organization_id, name, email, role, status)
  values (v_lucas, v_org, 'Lucas', 'lucas@agencia.com', 'ADMIN', 'ACTIVE')
  on conflict (id) do update
    set organization_id = v_org, role = 'ADMIN', status = 'ACTIVE', name = 'Lucas';

  if v_maria is not null then
    insert into public.profiles (id, organization_id, name, email, role, status)
    values (v_maria, v_org, 'Maria', 'maria@horizonte.com', 'CLIENT', 'ACTIVE')
    on conflict (id) do update
      set organization_id = v_org, role = 'CLIENT', status = 'ACTIVE', name = 'Maria';
  end if;

  if v_joao is not null then
    insert into public.profiles (id, organization_id, name, email, role, status)
    values (v_joao, v_org, 'João', 'joao@horizonte.com', 'CLIENT', 'ACTIVE')
    on conflict (id) do update
      set organization_id = v_org, role = 'CLIENT', status = 'ACTIVE', name = 'João';
  end if;

  -- ---------------------------------------------------------------------------
  -- Cliente
  -- ---------------------------------------------------------------------------
  select id into v_client
    from public.clients
   where organization_id = v_org and name = 'Faculdade Horizonte';

  if v_client is null then
    insert into public.clients (organization_id, name, status, created_by)
    values (v_org, 'Faculdade Horizonte', 'ACTIVE', v_lucas)
    returning id into v_client;
  end if;

  if v_maria is not null then
    insert into public.client_users (client_id, user_id)
    values (v_client, v_maria)
    on conflict (client_id, user_id) do nothing;
  end if;

  if v_joao is not null then
    insert into public.client_users (client_id, user_id)
    values (v_client, v_joao)
    on conflict (client_id, user_id) do nothing;
  end if;

  -- ---------------------------------------------------------------------------
  -- Projetos
  -- ---------------------------------------------------------------------------
  select id into v_pos_ia from public.projects where client_id = v_client and slug = 'pos-ia';
  if v_pos_ia is null then
    insert into public.projects (organization_id, client_id, name, slug, created_by)
    values (v_org, v_client, 'Pós IA', 'pos-ia', v_lucas)
    returning id into v_pos_ia;
  end if;

  select id into v_pos_dados from public.projects where client_id = v_client and slug = 'pos-dados';
  if v_pos_dados is null then
    insert into public.projects (organization_id, client_id, name, slug, created_by)
    values (v_org, v_client, 'Pós Engenharia de Dados', 'pos-dados', v_lucas)
    returning id into v_pos_dados;
  end if;

  select id into v_mba from public.projects where client_id = v_client and slug = 'mba-direito';
  if v_mba is null then
    insert into public.projects (organization_id, client_id, name, slug, created_by)
    values (v_org, v_client, 'MBA Direito', 'mba-direito', v_lucas)
    returning id into v_mba;
  end if;

  -- ---------------------------------------------------------------------------
  -- Permissões
  --   Maria → Pós IA ✅ | Pós Dados ✅ | MBA Direito ❌
  --   João  → Pós IA ❌ | Pós Dados ✅ | MBA Direito ✅
  -- ---------------------------------------------------------------------------
  if v_maria is not null then
    insert into public.project_users (project_id, user_id, can_view, can_edit_goals, can_edit_settings)
    values (v_pos_ia, v_maria, true, true, true)
    on conflict (project_id, user_id) do update
      set can_view = true, can_edit_goals = true, can_edit_settings = true;

    -- Sem permissão de editar metas: usado para testar can_edit_goals = false.
    insert into public.project_users (project_id, user_id, can_view, can_edit_goals, can_edit_settings)
    values (v_pos_dados, v_maria, true, false, false)
    on conflict (project_id, user_id) do update
      set can_view = true, can_edit_goals = false, can_edit_settings = false;

    delete from public.project_users where project_id = v_mba and user_id = v_maria;
  end if;

  if v_joao is not null then
    delete from public.project_users where project_id = v_pos_ia and user_id = v_joao;

    insert into public.project_users (project_id, user_id, can_view, can_edit_goals)
    values (v_pos_dados, v_joao, true, true)
    on conflict (project_id, user_id) do update
      set can_view = true, can_edit_goals = true;

    insert into public.project_users (project_id, user_id, can_view, can_edit_goals, can_export)
    values (v_mba, v_joao, true, true, true)
    on conflict (project_id, user_id) do update
      set can_view = true, can_edit_goals = true, can_export = true;
  end if;

  -- ---------------------------------------------------------------------------
  -- Metas do mês corrente
  -- ---------------------------------------------------------------------------
  insert into public.project_goals (
    project_id, period_start, period_end,
    spend_goal, lead_goal, cpl_goal, sales_goal, cac_goal, revenue_goal, roas_goal, created_by
  )
  values
    (v_pos_ia,
     date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
     30000, 2000, 15, 180, 166, 270000, 9, v_lucas),
    (v_pos_dados,
     date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
     18000, 1200, 15, 110, 163, 165000, 9.2, v_lucas),
    (v_mba,
     date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
     22000, 900, 24, 90, 244, 198000, 9, v_lucas)
  on conflict (project_id, period_start, period_end) do nothing;

  raise notice 'Seed concluído. Organização: %, Cliente: %', v_org, v_client;
end;
$$;
