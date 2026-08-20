-- =============================================================================
-- 0019 — Redirecionador público organizado por cliente
-- =============================================================================

create table if not exists public.redirect_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  strategy text not null default 'single' check (strategy in ('single', 'round_robin')),
  delay_seconds integer not null default 0 check (delay_seconds between 0 and 300),
  active boolean not null default true,
  hit_count bigint not null default 0 check (hit_count >= 0),
  last_accessed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.redirect_destinations (
  id uuid primary key default gen_random_uuid(),
  redirect_link_id uuid not null references public.redirect_links(id) on delete cascade,
  label text check (label is null or char_length(trim(label)) between 1 and 100),
  target_url text not null check (
    char_length(target_url) between 8 and 2048
    and target_url ~* '^https://[^[:space:]]+$'
  ),
  position integer not null default 0 check (position >= 0),
  hit_count bigint not null default 0 check (hit_count >= 0),
  created_at timestamptz not null default now(),
  unique (redirect_link_id, position)
);

create index if not exists redirect_links_org_client_idx
  on public.redirect_links (organization_id, client_id, created_at desc);
create index if not exists redirect_links_slug_active_idx
  on public.redirect_links (slug) where active;
create index if not exists redirect_destinations_link_idx
  on public.redirect_destinations (redirect_link_id, position);

drop trigger if exists trg_redirect_links_updated_at on public.redirect_links;
create trigger trg_redirect_links_updated_at
  before update on public.redirect_links
  for each row execute function public.fn_set_updated_at();

alter table public.redirect_links enable row level security;
alter table public.redirect_destinations enable row level security;

drop policy if exists redirect_links_admin_all on public.redirect_links;
create policy redirect_links_admin_all on public.redirect_links
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (
    private.is_admin()
    and organization_id = private.current_organization_id()
    and exists (
      select 1 from public.clients c
      where c.id = client_id and c.organization_id = private.current_organization_id()
    )
  );

drop policy if exists redirect_destinations_admin_all on public.redirect_destinations;
create policy redirect_destinations_admin_all on public.redirect_destinations
  for all to authenticated
  using (
    private.is_admin()
    and exists (
      select 1 from public.redirect_links link
      where link.id = redirect_link_id
        and link.organization_id = private.current_organization_id()
    )
  )
  with check (
    private.is_admin()
    and exists (
      select 1 from public.redirect_links link
      where link.id = redirect_link_id
        and link.organization_id = private.current_organization_id()
    )
  );

-- A única superfície pública é esta função. As tabelas continuam privadas.
create or replace function public.resolve_redirect_link(p_slug text)
returns table (
  target_url text,
  delay_seconds integer,
  link_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_link public.redirect_links%rowtype;
  resolved_destination public.redirect_destinations%rowtype;
  destination_count integer;
  selected_offset integer;
begin
  if p_slug is null or lower(trim(p_slug)) !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
    return;
  end if;

  update public.redirect_links
     set hit_count = hit_count + 1,
         last_accessed_at = now()
   where slug = lower(trim(p_slug))
     and active = true
  returning * into resolved_link;

  if not found then return; end if;

  select count(*) into destination_count
    from public.redirect_destinations destination
   where destination.redirect_link_id = resolved_link.id;
  if destination_count = 0 then return; end if;

  selected_offset := case
    when resolved_link.strategy = 'round_robin'
      then ((resolved_link.hit_count - 1) % destination_count)::integer
    else 0
  end;

  select * into resolved_destination
    from public.redirect_destinations destination
   where destination.redirect_link_id = resolved_link.id
   order by destination.position, destination.id
   offset selected_offset limit 1;

  update public.redirect_destinations
     set hit_count = hit_count + 1
   where id = resolved_destination.id;

  return query select resolved_destination.target_url, resolved_link.delay_seconds, resolved_link.name;
end;
$$;

revoke all on function public.resolve_redirect_link(text) from public;
grant execute on function public.resolve_redirect_link(text) to anon, authenticated;
