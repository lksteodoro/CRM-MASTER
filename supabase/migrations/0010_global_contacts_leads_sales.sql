-- =============================================================================
-- 0010 — Modelo global de contatos/leads/vendas (substitui crm_leads/project_webhooks)
--
-- Baseado na "Documentação de Implementação — Próximas Otimizações":
--   - contacts: pessoa única DENTRO DO CLIENTE (não por projeto). O mesmo
--     telefone/e-mail em dois projetos do mesmo cliente é a mesma pessoa.
--   - lead_events: uma linha por entrada/cadastro (um contato pode ter várias,
--     em projetos diferentes ou no mesmo projeto em datas diferentes).
--   - sales: venda ligada ao contato+projeto, opcionalmente ao lead_event que
--     originou.
--   - webhook_inbox: blindagem — o payload bruto é salvo ANTES de qualquer
--     tentativa de normalizar/atribuir. Se a atribuição falhar, o evento nunca
--     se perde, só fica marcado como PARTIAL/FAILED para revisão.
--   - project_integrations: roteamento por código externo curto
--     (ex: "MBA_DIREITO") em vez de expor o UUID do projeto pra fora.
-- =============================================================================

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text,
  normalized_phone text,
  normalized_email text,
  original_phone text,
  original_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um telefone ou e-mail só identifica uma pessoa dentro do mesmo cliente.
create unique index idx_contacts_client_phone on public.contacts (client_id, normalized_phone)
  where normalized_phone is not null;
create unique index idx_contacts_client_email on public.contacts (client_id, normalized_email)
  where normalized_email is not null;

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  external_id text,
  occurred_at timestamptz not null default now(),
  campaign_id text,
  adset_id text,
  ad_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  source text not null default 'webhook',
  status text not null default 'NOVO',
  -- COMPLETE (campaign+adset+ad) | PARTIAL (algum sinal de mídia) | NONE | CONFLICT
  attribution_status text not null default 'NONE',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, external_id)
);

create index idx_lead_events_contact on public.lead_events (contact_id);
create index idx_lead_events_project_date on public.lead_events (project_id, occurred_at);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  lead_event_id uuid references public.lead_events(id) on delete set null,
  external_sale_id text,
  amount numeric(12, 2),
  status text not null default 'PAID',
  payment_method text,
  sold_at timestamptz not null default now(),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, external_sale_id)
);

create index idx_sales_contact on public.sales (contact_id);
create index idx_sales_project_date on public.sales (project_id, sold_at);

create table public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  event_type text not null, -- 'lead' | 'sale'
  source text not null default 'webhook',
  external_event_id text,
  payload_hash text,
  payload_raw jsonb not null,
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  -- RECEIVED, PROCESSING, PROCESSED, PARTIAL, FAILED, DEAD_LETTER
  processing_status text not null default 'RECEIVED',
  retry_count integer not null default 0,
  last_error text,
  normalized_event_id uuid
);

create index idx_webhook_inbox_status on public.webhook_inbox (processing_status);
create index idx_webhook_inbox_client_date on public.webhook_inbox (client_id, received_at);

create table public.project_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  integration_type text not null default 'webhook',
  external_code text not null unique,
  secret text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (project_id, integration_type)
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.contacts enable row level security;
alter table public.lead_events enable row level security;
alter table public.sales enable row level security;
alter table public.webhook_inbox enable row level security;
alter table public.project_integrations enable row level security;

-- Um contato só é visível através de um lead_event num projeto que o usuário
-- pode ver — não existe policy de "ver todos os contatos do cliente" direto,
-- porque a permissão de verdade é por projeto (project_users), não por cliente.
create policy contacts_select on public.contacts
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.lead_events le
       where le.contact_id = contacts.id
         and private.has_project_permission(le.project_id, 'view_leads')
    )
  );

create policy lead_events_select on public.lead_events
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view_leads'));

create policy sales_select on public.sales
  for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'view_sales'));

-- A inbox guarda payload bruto (pode ter PII) — só ADMIN vê, é ferramenta de
-- diagnóstico/reprocessamento, não uma tela operacional.
create policy webhook_inbox_admin_select on public.webhook_inbox
  for select to authenticated
  using (private.is_admin());

create policy project_integrations_admin_all on public.project_integrations
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at before update on public.contacts
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_lead_events_updated_at on public.lead_events;
create trigger trg_lead_events_updated_at before update on public.lead_events
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at before update on public.sales
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_project_integrations_updated_at on public.project_integrations;
create trigger trg_project_integrations_updated_at before update on public.project_integrations
  for each row execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- Sai de cena: modelo antigo (webhook por projeto, lead direto sem contato
-- global). Nada de produção depende disso — só os 2 leads de teste que já
-- foram apagados na sessão anterior.
-- -----------------------------------------------------------------------------
drop table if exists public.crm_leads;
drop table if exists public.project_webhooks;
