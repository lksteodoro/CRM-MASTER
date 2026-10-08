-- =============================================================================
-- 0055 — Resumo diário: leads do CRM e meta diária por conta de anúncio
--
-- Cada conta de anúncio é um projeto. O operador lança, por dia, quantos leads
-- o CRM registrou; o painel compara com os leads do gerenciador (diferença,
-- GAP acumulado, CPL). A meta diária de leads também é por conta.
-- A escrita passa por funções (checam a permissão da ferramenta e a organização);
-- o navegador só tem SELECT nas tabelas.
-- =============================================================================

create table public.meta_report_crm_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_account_id text not null,
  report_date date not null,
  crm_leads integer not null check (crm_leads >= 0),
  updated_at timestamptz not null default now(),
  unique (organization_id, ad_account_id, report_date)
);

create table public.meta_report_account_goals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_account_id text not null,
  daily_goal_leads integer not null check (daily_goal_leads >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, ad_account_id)
);

alter table public.meta_report_crm_leads enable row level security;
alter table public.meta_report_account_goals enable row level security;

create policy meta_report_crm_leads_tool_select on public.meta_report_crm_leads
  for select to authenticated
  using (private.has_agency_tool_access('meta_ads') and organization_id = private.current_organization_id());

create policy meta_report_account_goals_tool_select on public.meta_report_account_goals
  for select to authenticated
  using (private.has_agency_tool_access('meta_ads') and organization_id = private.current_organization_id());

grant select on public.meta_report_crm_leads to authenticated;
grant select on public.meta_report_account_goals to authenticated;

-- Lança (ou limpa, com NULL) os leads do CRM de uma conta em um dia.
create or replace function public.meta_report_set_crm_leads(
  p_ad_account_id text,
  p_report_date date,
  p_crm_leads integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := private.current_organization_id();
begin
  if v_org is null or not private.has_agency_tool_access('meta_ads') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ad_account_id is null or length(trim(p_ad_account_id)) = 0 or p_report_date is null then
    raise exception 'invalid_arguments';
  end if;

  if p_crm_leads is null then
    delete from public.meta_report_crm_leads
     where organization_id = v_org and ad_account_id = p_ad_account_id and report_date = p_report_date;
    return;
  end if;
  if p_crm_leads < 0 then
    raise exception 'invalid_arguments';
  end if;

  insert into public.meta_report_crm_leads (organization_id, ad_account_id, report_date, crm_leads)
  values (v_org, p_ad_account_id, p_report_date, p_crm_leads)
  on conflict (organization_id, ad_account_id, report_date)
  do update set crm_leads = excluded.crm_leads, updated_at = now();
end;
$$;

-- Define (ou limpa, com NULL) a meta diária de leads de uma conta.
create or replace function public.meta_report_set_goal(
  p_ad_account_id text,
  p_daily_goal_leads integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := private.current_organization_id();
begin
  if v_org is null or not private.has_agency_tool_access('meta_ads') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ad_account_id is null or length(trim(p_ad_account_id)) = 0 then
    raise exception 'invalid_arguments';
  end if;

  if p_daily_goal_leads is null then
    delete from public.meta_report_account_goals
     where organization_id = v_org and ad_account_id = p_ad_account_id;
    return;
  end if;
  if p_daily_goal_leads < 0 then
    raise exception 'invalid_arguments';
  end if;

  insert into public.meta_report_account_goals (organization_id, ad_account_id, daily_goal_leads)
  values (v_org, p_ad_account_id, p_daily_goal_leads)
  on conflict (organization_id, ad_account_id)
  do update set daily_goal_leads = excluded.daily_goal_leads, updated_at = now();
end;
$$;

revoke execute on function public.meta_report_set_crm_leads(text, date, integer) from public, anon;
revoke execute on function public.meta_report_set_goal(text, integer) from public, anon;
grant execute on function public.meta_report_set_crm_leads(text, date, integer) to authenticated;
grant execute on function public.meta_report_set_goal(text, integer) to authenticated;
