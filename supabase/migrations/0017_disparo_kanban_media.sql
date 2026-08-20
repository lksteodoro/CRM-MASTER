-- =============================================================================
-- 0017 — Kanban operacional de disparos e mídia pública para a Infobip
-- =============================================================================

do $$
begin
  if to_regtype('public.disparo_task_status') is null then
    create type public.disparo_task_status as enum (
      'pedido', 'pagamento', 'numero_perfil', 'template_midia',
      'lista', 'teste', 'disparo', 'finalizado'
    );
  end if;
end
$$;

create table if not exists public.disparo_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  color text not null default '#6366f1' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists disparo_tags_organization_name_key
  on public.disparo_tags (organization_id, lower(name));

create table if not exists public.disparo_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  client_id uuid references public.clients(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  scheduled_date date,
  scheduled_time time,
  status public.disparo_task_status not null default 'pedido',
  position integer not null default 0 check (position >= 0),
  contact_list_ref text,
  list_tag text,
  full_link text,
  short_link text,
  instagram text,
  copy_text text,
  copy_approved boolean not null default false,
  final_report text,
  profile_photo_url text,
  image_url text,
  video_url text,
  list_file_url text,
  list_file_name text,
  checklist jsonb not null default '{}'::jsonb,
  finished_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- O quadro já pode existir em ambientes anteriores; estes são os campos novos
-- necessários para anexar e identificar a lista de contatos.
alter table public.disparo_tasks add column if not exists list_file_url text;
alter table public.disparo_tasks add column if not exists list_file_name text;

create index if not exists disparo_tasks_board_idx
  on public.disparo_tasks (organization_id, archived_at, status, position);
create index if not exists disparo_tasks_client_idx on public.disparo_tasks (client_id);

create table if not exists public.disparo_task_numbers (
  id uuid primary key default gen_random_uuid(),
  disparo_task_id uuid not null references public.disparo_tasks(id) on delete cascade,
  waba_label text,
  number text not null check (char_length(trim(number)) > 0),
  name text,
  is_test boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create index if not exists disparo_task_numbers_task_idx
  on public.disparo_task_numbers (disparo_task_id, position);

create table if not exists public.disparo_task_tags (
  disparo_task_id uuid not null references public.disparo_tasks(id) on delete cascade,
  tag_id uuid not null references public.disparo_tags(id) on delete cascade,
  primary key (disparo_task_id, tag_id)
);

drop trigger if exists trg_disparo_tasks_updated_at on public.disparo_tasks;
create trigger trg_disparo_tasks_updated_at
  before update on public.disparo_tasks
  for each row execute function public.fn_set_updated_at();

create or replace function public.fn_disparo_finished_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'finalizado' and old.status <> 'finalizado' then
    new.finished_at := now();
  elsif new.status <> 'finalizado' then
    new.finished_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_disparo_tasks_finished_at on public.disparo_tasks;
create trigger trg_disparo_tasks_finished_at
  before update of status on public.disparo_tasks
  for each row execute function public.fn_disparo_finished_at();

alter table public.disparo_tags enable row level security;
alter table public.disparo_tasks enable row level security;
alter table public.disparo_task_numbers enable row level security;
alter table public.disparo_task_tags enable row level security;

drop policy if exists disparo_tags_admin_all on public.disparo_tags;
create policy disparo_tags_admin_all on public.disparo_tags
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists disparo_tasks_admin_all on public.disparo_tasks;
create policy disparo_tasks_admin_all on public.disparo_tasks
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (
    private.is_admin()
    and organization_id = private.current_organization_id()
    and (client_id is null or exists (
      select 1 from public.clients c
      where c.id = client_id and c.organization_id = private.current_organization_id()
    ))
  );

drop policy if exists disparo_task_numbers_admin_all on public.disparo_task_numbers;
create policy disparo_task_numbers_admin_all on public.disparo_task_numbers
  for all to authenticated
  using (exists (
    select 1 from public.disparo_tasks t
    where t.id = disparo_task_id
      and t.organization_id = private.current_organization_id()
      and private.is_admin()
  ))
  with check (exists (
    select 1 from public.disparo_tasks t
    where t.id = disparo_task_id
      and t.organization_id = private.current_organization_id()
      and private.is_admin()
  ));

drop policy if exists disparo_task_tags_admin_all on public.disparo_task_tags;
create policy disparo_task_tags_admin_all on public.disparo_task_tags
  for all to authenticated
  using (exists (
    select 1 from public.disparo_tasks t
    where t.id = disparo_task_id
      and t.organization_id = private.current_organization_id()
      and private.is_admin()
  ))
  with check (exists (
    select 1
    from public.disparo_tasks t
    join public.disparo_tags dt on dt.id = tag_id
    where t.id = disparo_task_id
      and t.organization_id = private.current_organization_id()
      and dt.organization_id = t.organization_id
      and private.is_admin()
  ));

-- Bucket público: a URL precisa ser acessível pela Infobip sem autenticação.
insert into storage.buckets (id, name, public, file_size_limit)
values ('disparo-media', 'disparo-media', true, 16777216)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists disparo_media_insert_own on storage.objects;
create policy disparo_media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'disparo-media' and owner_id = auth.uid()::text);

drop policy if exists disparo_media_select_own on storage.objects;
create policy disparo_media_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'disparo-media' and owner_id = auth.uid()::text);

drop policy if exists disparo_media_update_own on storage.objects;
create policy disparo_media_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'disparo-media' and owner_id = auth.uid()::text)
  with check (bucket_id = 'disparo-media' and owner_id = auth.uid()::text);

drop policy if exists disparo_media_delete_own on storage.objects;
create policy disparo_media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'disparo-media' and owner_id = auth.uid()::text);
