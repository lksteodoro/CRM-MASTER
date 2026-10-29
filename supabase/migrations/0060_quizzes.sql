-- =============================================================================
-- 0060 — Quiz de pré-qualificação (estilo Typebot)
-- =============================================================================
-- O quiz é uma página pública (/q/:slug) com uma pergunta por tela. A regra de
-- qualificação fica nas perguntas: opção marcada como "desqualifica" ou número
-- abaixo do mínimo. Quem passa vai para um link do redirecionador; quem não
-- passa vai para outro. A avaliação acontece no banco: a página pública nunca
-- recebe as regras, para o lead não conseguir "acertar" a resposta.

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 600),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  qualified_link_id uuid references public.redirect_links(id) on delete set null,
  disqualified_link_id uuid references public.redirect_links(id) on delete set null,
  active boolean not null default true,
  response_count bigint not null default 0 check (response_count >= 0),
  qualified_count bigint not null default 0 check (qualified_count >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_responses (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- [{ question_id, label, value }] na ordem em que o lead respondeu.
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  qualified boolean not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  created_at timestamptz not null default now()
);

create index if not exists quizzes_org_idx on public.quizzes (organization_id, created_at desc);
create index if not exists quiz_responses_quiz_idx on public.quiz_responses (quiz_id, created_at desc);

drop trigger if exists trg_quizzes_updated_at on public.quizzes;
create trigger trg_quizzes_updated_at
  before update on public.quizzes
  for each row execute function public.fn_set_updated_at();

alter table public.quizzes enable row level security;
alter table public.quiz_responses enable row level security;

drop policy if exists quizzes_tool_all on public.quizzes;
create policy quizzes_tool_all on public.quizzes
  for all to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id())
  with check (
    private.has_agency_tool_access('disparo.quizzes')
    and organization_id = private.current_organization_id()
    and (qualified_link_id is null or exists (
      select 1 from public.redirect_links link
       where link.id = qualified_link_id and link.organization_id = private.current_organization_id()
    ))
    and (disqualified_link_id is null or exists (
      select 1 from public.redirect_links link
       where link.id = disqualified_link_id and link.organization_id = private.current_organization_id()
    ))
  );

-- Respostas só entram pela função pública; a equipe lê e pode apagar.
drop policy if exists quiz_responses_tool_read on public.quiz_responses;
create policy quiz_responses_tool_read on public.quiz_responses
  for select to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id());

drop policy if exists quiz_responses_tool_delete on public.quiz_responses;
create policy quiz_responses_tool_delete on public.quiz_responses
  for delete to authenticated
  using (private.has_agency_tool_access('disparo.quizzes') and organization_id = private.current_organization_id());

-- -----------------------------------------------------------------------------
-- Superfície pública 1: o quiz sem as regras de qualificação.
-- -----------------------------------------------------------------------------
create or replace function public.get_public_quiz(p_slug text)
returns table (title text, description text, questions jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select quiz.title,
         quiz.description,
         coalesce((
           select jsonb_agg(
                    (question - 'min' - 'options')
                    || case when question ? 'options' then jsonb_build_object('options', (
                         select coalesce(jsonb_agg(option - 'qualifies' order by option_index), '[]'::jsonb)
                           from jsonb_array_elements(question -> 'options') with ordinality as o(option, option_index)
                       )) else '{}'::jsonb end
                    order by question_index)
             from jsonb_array_elements(quiz.questions) with ordinality as q(question, question_index)
         ), '[]'::jsonb)
    from public.quizzes quiz
   where quiz.slug = lower(trim(p_slug))
     and quiz.active = true
     and p_slug ~* '^[a-z0-9][a-z0-9-]{2,79}$';
$$;

revoke all on function public.get_public_quiz(text) from public;
grant execute on function public.get_public_quiz(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Superfície pública 2: grava a resposta, avalia e devolve o link de destino.
-- p_answers: { "<question_id>": "<valor>" } — para escolha, o id da opção.
-- -----------------------------------------------------------------------------
create or replace function public.submit_quiz_response(p_slug text, p_answers jsonb)
returns table (qualified boolean, redirect_slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quiz public.quizzes%rowtype;
  v_question jsonb;
  v_value text;
  v_option jsonb;
  v_number numeric;
  v_qualified boolean := true;
  v_answers jsonb := '[]'::jsonb;
  v_name text;
  v_phone text;
  v_email text;
  v_label text;
  v_slug text;
begin
  if p_slug is null or lower(trim(p_slug)) !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
    raise exception 'quiz_not_found';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 20000 then
    raise exception 'invalid_answers';
  end if;

  select * into v_quiz from public.quizzes
   where slug = lower(trim(p_slug)) and active = true;
  if not found then raise exception 'quiz_not_found'; end if;

  for v_question in select value from jsonb_array_elements(v_quiz.questions) loop
    v_value := nullif(trim(p_answers ->> (v_question ->> 'id')), '');
    if v_value is not null and char_length(v_value) > 500 then
      raise exception 'invalid_answers';
    end if;

    if v_value is null then
      if coalesce((v_question ->> 'required')::boolean, true) then
        raise exception 'missing_answer';
      end if;
      continue;
    end if;

    v_label := v_value;
    case v_question ->> 'type'
      when 'choice' then
        select option into v_option
          from jsonb_array_elements(v_question -> 'options') option
         where option ->> 'id' = v_value;
        if v_option is null then raise exception 'invalid_answers'; end if;
        v_label := v_option ->> 'label';
        if not coalesce((v_option ->> 'qualifies')::boolean, true) then
          v_qualified := false;
        end if;
      when 'number' then
        begin
          v_number := replace(replace(v_value, '.', ''), ',', '.')::numeric;
        exception when others then
          raise exception 'invalid_answers';
        end;
        if v_question ? 'min' and v_question ->> 'min' is not null
           and v_number < (v_question ->> 'min')::numeric then
          v_qualified := false;
        end if;
      when 'name' then v_name := v_value;
      when 'phone' then v_phone := v_value;
      when 'email' then v_email := v_value;
      else null;
    end case;

    v_answers := v_answers || jsonb_build_array(jsonb_build_object(
      'question_id', v_question ->> 'id',
      'label', v_question ->> 'label',
      'value', v_label
    ));
  end loop;

  insert into public.quiz_responses
    (quiz_id, organization_id, answers, qualified, contact_name, contact_phone, contact_email)
  values
    (v_quiz.id, v_quiz.organization_id, v_answers, v_qualified, v_name, v_phone, v_email);

  update public.quizzes
     set response_count = response_count + 1,
         qualified_count = qualified_count + case when v_qualified then 1 else 0 end
   where id = v_quiz.id;

  select link.slug into v_slug
    from public.redirect_links link
   where link.id = case when v_qualified then v_quiz.qualified_link_id else v_quiz.disqualified_link_id end
     and link.active = true;

  return query select v_qualified, v_slug;
end;
$$;

revoke all on function public.submit_quiz_response(text, jsonb) from public;
grant execute on function public.submit_quiz_response(text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Permissão da nova ferramenta: todas as chaves anteriores mais 'disparo.quizzes'.
-- -----------------------------------------------------------------------------
alter table public.agency_tool_permissions
  drop constraint if exists agency_tool_permissions_tool_key_check;

alter table public.agency_tool_permissions
  add constraint agency_tool_permissions_tool_key_check check (tool_key in (
    'disparo.dashboard',
    'disparo.redirects',
    'disparo.quizzes',
    'disparo.templates',
    'disparo.broadcasts',
    'disparo.request',
    'disparo.demands',
    'disparo.sanitizer',
    'disparo.report',
    'meta_ads',
    'zpl_pdf',
    'utm_tester',
    'consumer_success',
    'video_converter',
    'optimization_ia'
  ));

create or replace function public.set_user_agency_tool_permissions(
  p_user_id uuid,
  p_tool_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := private.current_organization_id();
  v_allowed_keys constant text[] := array[
    'disparo.dashboard', 'disparo.redirects', 'disparo.quizzes', 'disparo.templates',
    'disparo.broadcasts', 'disparo.request', 'disparo.demands',
    'disparo.sanitizer', 'disparo.report', 'meta_ads', 'zpl_pdf',
    'utm_tester', 'consumer_success', 'video_converter', 'optimization_ia'
  ];
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;

  if v_org_id is null or not exists (
    select 1 from public.profiles p
     where p.id = p_user_id and p.organization_id = v_org_id
  ) then
    raise exception 'user_not_in_organization';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_tool_keys, '{}'::text[])) key
     where key is null or not (key = any(v_allowed_keys))
  ) then
    raise exception 'invalid_tool_key';
  end if;

  delete from public.agency_tool_permissions
   where organization_id = v_org_id and user_id = p_user_id;

  insert into public.agency_tool_permissions (organization_id, user_id, tool_key)
  select v_org_id, p_user_id, key
    from (select distinct unnest(coalesce(p_tool_keys, '{}'::text[])) as key) requested;
end;
$$;

grant execute on function public.set_user_agency_tool_permissions(uuid, text[]) to authenticated;
