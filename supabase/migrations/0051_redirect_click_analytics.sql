-- =============================================================================
-- 0051 — Analytics de cliques do redirecionador
--
-- 1. redirect_clicks: um registro por acesso (link, destino, URL, horário).
--    É o que permite ver cliques por dia e por URL. A URL fica copiada no
--    registro, então o histórico sobrevive mesmo se o destino for editado ou
--    removido depois.
-- 2. save_redirect_destinations: salvar o link não apaga mais os destinos.
--    Antes a edição fazia delete + insert e o contador de cada URL voltava a
--    zero. Agora destinos com a mesma URL são mantidos (com o contador) e só
--    o que mudou é criado ou removido.
-- 3. A trava de anúncio pago deixava de fora o próprio incremento do
--    contador: o clique num link travado estourava exceção. Incrementar
--    hit_count passa a ser permitido; mudar URL/posição continua bloqueado.
-- =============================================================================

create table public.redirect_clicks (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  redirect_link_id uuid not null references public.redirect_links(id) on delete cascade,
  destination_id uuid references public.redirect_destinations(id) on delete set null,
  target_url text not null,
  clicked_at timestamptz not null default now()
);

create index redirect_clicks_link_time_idx on public.redirect_clicks (redirect_link_id, clicked_at desc);
create index redirect_clicks_org_time_idx on public.redirect_clicks (organization_id, clicked_at desc);

alter table public.redirect_clicks enable row level security;

create policy redirect_clicks_admin_read on public.redirect_clicks
  for select to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id());

revoke insert, update, delete on public.redirect_clicks from anon, authenticated;
grant select on public.redirect_clicks to authenticated;

-- ---------------------------------------------------------------------------
-- Trava de anúncio pago: libera só o incremento do contador.
-- ---------------------------------------------------------------------------
create or replace function private.fn_block_locked_redirect_destination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
  v_link_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.target_url is not distinct from old.target_url
     and new.position is not distinct from old.position
     and new.label is not distinct from old.label
     and new.redirect_link_id = old.redirect_link_id then
    return new;
  end if;

  v_link_id := coalesce(new.redirect_link_id, old.redirect_link_id);
  select paid_ads_locked into v_locked from public.redirect_links where id = v_link_id;
  if coalesce(v_locked, false) then
    raise exception 'Este link esta em uso por anuncio pago: o destino nao pode ser alterado, adicionado ou removido. Crie um novo link.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolução pública: agora também grava o clique.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_redirect_link(p_slug text)
returns table (target_url text, delay_seconds integer, link_name text)
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

  insert into public.redirect_clicks (organization_id, redirect_link_id, destination_id, target_url)
  values (resolved_link.organization_id, resolved_link.id, resolved_destination.id, resolved_destination.target_url);

  return query select resolved_destination.target_url, resolved_link.delay_seconds, resolved_link.name;
end;
$$;

revoke all on function public.resolve_redirect_link(text) from public;
grant execute on function public.resolve_redirect_link(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Salvar destinos sem zerar os contadores.
-- p_destinations: [{ "label": "...", "target_url": "https://..." }, ...]
-- SECURITY INVOKER: roda com o RLS de quem chama (admin da organização).
-- ---------------------------------------------------------------------------
create or replace function public.save_redirect_destinations(p_link_id uuid, p_destinations jsonb)
returns setof public.redirect_destinations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  item record;
  existing_id uuid;
  kept uuid[] := '{}';
begin
  if not exists (select 1 from public.redirect_links where id = p_link_id) then
    raise exception 'redirect_link_not_found';
  end if;
  if jsonb_typeof(p_destinations) <> 'array' or jsonb_array_length(p_destinations) = 0 then
    raise exception 'Adicione pelo menos um destino.';
  end if;

  -- Tira as posições atuais do caminho do unique(redirect_link_id, position).
  -- Só mexe se algo realmente mudar: em link travado a trava barra qualquer
  -- alteração de posição, e salvar sem mudança não deve falhar.
  if exists (
    select 1
      from jsonb_array_elements(p_destinations) with ordinality as incoming(value, ord)
      full join public.redirect_destinations current_dest
        on current_dest.redirect_link_id = p_link_id
       and current_dest.position = incoming.ord - 1
     where (current_dest.id is null or current_dest.redirect_link_id = p_link_id)
       and (current_dest.id is null
        or incoming.value is null
        or current_dest.target_url is distinct from trim(incoming.value->>'target_url')
        or current_dest.label is distinct from nullif(trim(coalesce(incoming.value->>'label', '')), ''))
  ) then
    update public.redirect_destinations
       set position = position + 100000
     where redirect_link_id = p_link_id;
  else
    return query select * from public.redirect_destinations where redirect_link_id = p_link_id order by position;
    return;
  end if;

  for item in
    select value, (ord - 1)::integer as pos
      from jsonb_array_elements(p_destinations) with ordinality as t(value, ord)
  loop
    select id into existing_id
      from public.redirect_destinations
     where redirect_link_id = p_link_id
       and target_url = trim(item.value->>'target_url')
       and not (id = any(kept))
     order by position
     limit 1;

    if existing_id is not null then
      update public.redirect_destinations
         set position = item.pos,
             label = nullif(trim(coalesce(item.value->>'label', '')), '')
       where id = existing_id;
    else
      insert into public.redirect_destinations (redirect_link_id, label, target_url, position)
      values (
        p_link_id,
        nullif(trim(coalesce(item.value->>'label', '')), ''),
        trim(item.value->>'target_url'),
        item.pos
      )
      returning id into existing_id;
    end if;
    kept := kept || existing_id;
  end loop;

  delete from public.redirect_destinations
   where redirect_link_id = p_link_id
     and not (id = any(kept));

  return query select * from public.redirect_destinations where redirect_link_id = p_link_id order by position;
end;
$$;

revoke all on function public.save_redirect_destinations(uuid, jsonb) from public, anon;
grant execute on function public.save_redirect_destinations(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Cliques por dia (fuso de São Paulo), por link e URL. SECURITY INVOKER: o RLS
-- de redirect_clicks garante que só a organização do admin aparece.
-- ---------------------------------------------------------------------------
create or replace function public.redirect_click_stats(p_from date, p_to date)
returns table (redirect_link_id uuid, day date, target_url text, clicks bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.redirect_link_id,
         (c.clicked_at at time zone 'America/Sao_Paulo')::date as day,
         c.target_url,
         count(*) as clicks
    from public.redirect_clicks c
   where c.clicked_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
     and c.clicked_at < ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
   group by 1, 2, 3
   order by 2;
$$;

revoke all on function public.redirect_click_stats(date, date) from public, anon;
grant execute on function public.redirect_click_stats(date, date) to authenticated;
