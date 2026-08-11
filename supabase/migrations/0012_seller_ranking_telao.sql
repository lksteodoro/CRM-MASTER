-- =============================================================================
-- 0012 — Ranking de vendedores (cadastro simples) + telão público
--
-- sellers: cadastro simples por cliente (sem login), substitui o antigo
-- conceito de "Vendedor" que só existia no mock. sales.seller_id liga uma
-- venda a um vendedor — atribuído manualmente na tela ou casado por nome
-- vindo do webhook (ver webhook-sales). Vendedor desativado continua
-- contando pontos já ganhos; só some do cadastro pra novas atribuições.
--
-- clients.telao_token/telao_active: um link público por cliente (sem login)
-- pra exibir o ranking numa TV/monitor da sala comercial — protegido por um
-- token opaco em vez de ID previsível. A Edge Function telao-ranking é quem
-- valida o token e devolve só dados agregados.
-- =============================================================================

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sellers_client on public.sellers (client_id);

alter table public.sales
  add column seller_id uuid references public.sellers(id) on delete set null;

alter table public.clients
  add column telao_token text unique,
  add column telao_active boolean not null default false;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.sellers enable row level security;

create or replace function private.has_client_edit_settings(p_client_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.project_users pu
      join public.projects p on p.id = pu.project_id
     where p.client_id = p_client_id
       and pu.user_id = auth.uid()
       and pu.can_edit_settings = true
  );
$$;

create policy sellers_select on public.sellers
  for select to authenticated
  using (private.is_admin() or private.has_client_access(client_id));

create policy sellers_write on public.sellers
  for all to authenticated
  using (private.is_admin() or private.has_client_edit_settings(client_id))
  with check (private.is_admin() or private.has_client_edit_settings(client_id));

-- sales só tinha policy de SELECT até aqui — atribuir vendedor exige UPDATE.
-- Libera a linha inteira (RLS não restringe coluna sem trigger); na prática
-- só a UI de atribuição de vendedor grava por esse caminho.
create policy sales_update_seller on public.sales
  for update to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'))
  with check (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'));

create policy clients_telao_write on public.clients
  for update to authenticated
  using (private.is_admin() or private.has_client_edit_settings(id))
  with check (private.is_admin() or private.has_client_edit_settings(id));
