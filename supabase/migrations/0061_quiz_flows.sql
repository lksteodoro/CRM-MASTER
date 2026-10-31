-- =============================================================================
-- 0061 — Quizzes em fluxo visual: produtos, versões, sessões e webhooks
-- =============================================================================
-- O quiz deixa de ser uma lista de perguntas e vira um fluxo (blocos + ligações)
-- editado em rascunho. Publicar congela uma versão; a página pública sempre roda
-- a versão publicada, então editar o rascunho não afeta quem está respondendo.
--
-- A execução pública passa pela Edge Function `quiz-runtime` (service role):
-- ela grava as sessões, recalcula a qualificação a partir das respostas e
-- dispara os webhooks. Por isso sessões e entregas não têm política de escrita.

create table if not exists public.quiz_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.quizzes
  add column if not exists product_id uuid references public.quiz_products(id) on delete set null,
  add column if not exists draft_flow jsonb,
  add column if not exists theme jsonb not null default '{}'::jsonb,
  add column if not exists published_version_id uuid,
  add column if not exists started_count bigint not null default 0;

create table if not exists public.quiz_versions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  flow jsonb not null,
  theme jsonb not null default '{}'::jsonb,
  title text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quiz_id, version)
);

alter table public.quizzes
  drop constraint if exists quizzes_published_version_fk;
alter table public.quizzes
  add constraint quizzes_published_version_fk
  foreign key (published_version_id) references public.quiz_versions(id) on delete set null;

create table if not exists public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  version_id uuid references public.quiz_versions(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'started' check (status in ('started', 'completed')),
  -- Respostas cruas por bloco (o que o navegador mandou) e o resultado legível.
  raw_answers jsonb not null default '{}'::jsonb,
  answers jsonb not null default '[]'::jsonb,
  variables jsonb not null default '{}'::jsonb,
  path text[] not null default '{}',
  current_node_id text,
  outcome_node_id text,
  qualified boolean,
  score numeric not null default 0,
  tags text[] not null default '{}',
  webhooks_fired text[] not null default '{}',
  contact_name text,
  contact_phone text,
  contact_email text,
  utm jsonb not null default '{}'::jsonb,
  device text check (device is null or device in ('mobile', 'desktop')),
  referrer text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists quiz_sessions_quiz_idx on public.quiz_sessions (quiz_id, started_at desc);

create table if not exists public.quiz_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  session_id uuid references public.quiz_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  node_id text not null,
  url text not null,
  ok boolean not null,
  status_code integer,
  attempts integer not null default 1,
  error text,
  response_snippet text,
  created_at timestamptz not null default now()
);

create index if not exists quiz_webhook_deliveries_quiz_idx on public.quiz_webhook_deliveries (quiz_id, created_at desc);

alter table public.quiz_products enable row level security;
alter table public.quiz_versions enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.quiz_webhook_deliveries enable row level security;

drop policy if exists quiz_products_tool_all on public.quiz_products;
create policy quiz_products_tool_all on public.quiz_products
  for all to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id())
  with check (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id());

drop policy if exists quiz_versions_tool_read on public.quiz_versions;
create policy quiz_versions_tool_read on public.quiz_versions
  for select to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id());

drop policy if exists quiz_sessions_tool_read on public.quiz_sessions;
create policy quiz_sessions_tool_read on public.quiz_sessions
  for select to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id());

drop policy if exists quiz_sessions_tool_delete on public.quiz_sessions;
create policy quiz_sessions_tool_delete on public.quiz_sessions
  for delete to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id());

drop policy if exists quiz_webhook_deliveries_tool_read on public.quiz_webhook_deliveries;
create policy quiz_webhook_deliveries_tool_read on public.quiz_webhook_deliveries
  for select to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id());

-- O produto do quiz tem de ser da mesma organização.
drop policy if exists quizzes_tool_all on public.quizzes;
create policy quizzes_tool_all on public.quizzes
  for all to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id())
  with check (
    private.has_agency_tool_access('disparo.quizzes')
    and organization_id = private.current_organization_id()
    and (product_id is null or exists (
      select 1 from public.quiz_products product
       where product.id = product_id and product.organization_id = private.current_organization_id()
    ))
    and (published_version_id is null or exists (
      select 1 from public.quiz_versions version
       where version.id = published_version_id and version.quiz_id = quizzes.id
    ))
  );

-- -----------------------------------------------------------------------------
-- Publicar: congela o rascunho como nova versão e passa a servi-la.
-- A validação completa do fluxo roda no editor; aqui ficam as garantias mínimas
-- para nunca publicar algo que a página pública não consiga abrir.
-- -----------------------------------------------------------------------------
create or replace function public.publish_quiz(p_quiz_id uuid)
returns public.quiz_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quiz public.quizzes%rowtype;
  v_version public.quiz_versions%rowtype;
  v_next integer;
begin
  select * into v_quiz from public.quizzes where id = p_quiz_id for update;
  if not found or v_quiz.organization_id is distinct from private.current_organization_id()
     or not private.has_agency_tool_access('disparo.quizzes') then
    raise exception 'forbidden';
  end if;
  if v_quiz.draft_flow is null
     or jsonb_typeof(v_quiz.draft_flow -> 'nodes') <> 'array'
     or jsonb_typeof(v_quiz.draft_flow -> 'edges') <> 'array' then
    raise exception 'invalid_flow';
  end if;
  if (select count(*) from jsonb_array_elements(v_quiz.draft_flow -> 'nodes') n where n ->> 'type' = 'start') <> 1
     or not exists (select 1 from jsonb_array_elements(v_quiz.draft_flow -> 'nodes') n where n ->> 'type' in ('redirect', 'end')) then
    raise exception 'invalid_flow';
  end if;

  select coalesce(max(version), 0) + 1 into v_next from public.quiz_versions where quiz_id = p_quiz_id;
  insert into public.quiz_versions (quiz_id, organization_id, version, flow, theme, title)
  values (p_quiz_id, v_quiz.organization_id, v_next, v_quiz.draft_flow, v_quiz.theme, v_quiz.title)
  returning * into v_version;

  update public.quizzes set published_version_id = v_version.id where id = p_quiz_id;
  return v_version;
end;
$$;

revoke all on function public.publish_quiz(uuid) from public;
grant execute on function public.publish_quiz(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Respostas antigas viram sessões concluídas; nada é apagado de quiz_responses.
-- -----------------------------------------------------------------------------
insert into public.quiz_sessions
  (id, quiz_id, organization_id, status, answers, qualified, contact_name, contact_phone, contact_email,
   started_at, updated_at, completed_at)
select response.id, response.quiz_id, response.organization_id, 'completed',
       coalesce((
         select jsonb_agg(jsonb_build_object(
                  'node_id', 'q_' || (answer ->> 'question_id'),
                  'variable', answer ->> 'question_id',
                  'label', answer ->> 'label',
                  'value', answer ->> 'value',
                  'display', answer ->> 'value'))
           from jsonb_array_elements(response.answers) answer
       ), '[]'::jsonb),
       response.qualified, response.contact_name, response.contact_phone, response.contact_email,
       response.created_at, response.created_at, response.created_at
  from public.quiz_responses response
on conflict (id) do nothing;

update public.quizzes quiz
   set started_count = greatest(quiz.started_count, quiz.response_count);

-- -----------------------------------------------------------------------------
-- Números por quiz direto das sessões (respeita o RLS de quem consulta).
-- -----------------------------------------------------------------------------
create or replace function public.quiz_stats()
returns table (quiz_id uuid, started bigint, completed bigint, qualified bigint, last_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select session.quiz_id,
         count(*) as started,
         count(*) filter (where session.status = 'completed') as completed,
         count(*) filter (where session.status = 'completed' and session.qualified) as qualified,
         max(session.updated_at) as last_at
    from public.quiz_sessions session
   group by session.quiz_id;
$$;

grant execute on function public.quiz_stats() to authenticated;
