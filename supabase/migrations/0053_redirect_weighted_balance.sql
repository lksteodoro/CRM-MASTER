-- =============================================================================
-- 0053 — Balanceamento por porcentagem no randomizador (modo loop)
--
-- redirect_links.balance_mode:
--   'equal'  → rodízio simples, cada destino recebe a mesma fatia (como antes)
--   'custom' → cada destino tem um peso (redirect_destinations.weight, em %),
--              os pesos somam 100
--
-- A escolha no modo custom usa "smooth weighted round robin" (o mesmo do
-- nginx): os acessos saem intercalados respeitando a porcentagem — com 70/30
-- a sequência é A A B A A B A B..., e não 7 seguidos para A. O estado fica em
-- redirect_destinations.wrr_current e é zerado sempre que os destinos mudam.
-- A linha do link é travada pelo UPDATE do contador, então dois cliques
-- simultâneos no mesmo link são processados em sequência.
-- =============================================================================

alter table public.redirect_links
  add column balance_mode text not null default 'equal'
    check (balance_mode in ('equal', 'custom'));

alter table public.redirect_destinations
  add column weight integer not null default 0 check (weight between 0 and 100),
  add column wrr_current bigint not null default 0;

-- ---------------------------------------------------------------------------
-- Resolução pública
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
  total_weight integer;
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

  select count(*), coalesce(sum(destination.weight), 0)
    into destination_count, total_weight
    from public.redirect_destinations destination
   where destination.redirect_link_id = resolved_link.id;
  if destination_count = 0 then return; end if;

  if resolved_link.strategy = 'round_robin'
     and resolved_link.balance_mode = 'custom'
     and total_weight > 0 then
    -- Smooth weighted round robin: soma o peso de todos, escolhe o maior
    -- acumulado e desconta o total dele.
    update public.redirect_destinations
       set wrr_current = wrr_current + weight
     where redirect_link_id = resolved_link.id;

    select * into resolved_destination
      from public.redirect_destinations destination
     where destination.redirect_link_id = resolved_link.id
       and destination.weight > 0
     order by destination.wrr_current desc, destination.position, destination.id
     limit 1;

    update public.redirect_destinations
       set wrr_current = wrr_current - total_weight,
           hit_count = hit_count + 1
     where id = resolved_destination.id;
  else
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
  end if;

  insert into public.redirect_clicks (organization_id, redirect_link_id, destination_id, target_url)
  values (resolved_link.organization_id, resolved_link.id, resolved_destination.id, resolved_destination.target_url);

  return query select resolved_destination.target_url, resolved_link.delay_seconds, resolved_link.name;
end;
$$;

revoke all on function public.resolve_redirect_link(text) from public;
grant execute on function public.resolve_redirect_link(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Salvar destinos: agora com o peso. p_destinations:
--   [{ "label": "...", "target_url": "https://...", "weight": 20 }, ...]
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
  v_mode text;
  v_strategy text;
  v_sum integer;
begin
  select balance_mode, strategy into v_mode, v_strategy from public.redirect_links where id = p_link_id;
  if not found then
    raise exception 'redirect_link_not_found';
  end if;
  if jsonb_typeof(p_destinations) <> 'array' or jsonb_array_length(p_destinations) = 0 then
    raise exception 'Adicione pelo menos um destino.';
  end if;

  if v_strategy = 'round_robin' and v_mode = 'custom' then
    select coalesce(sum(coalesce((value->>'weight')::integer, 0)), 0) into v_sum
      from jsonb_array_elements(p_destinations);
    if v_sum <> 100 then
      raise exception '%', format('A soma das porcentagens precisa ser 100%% (está em %s%%).', v_sum);
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_destinations)
       where coalesce((value->>'weight')::integer, 0) not between 0 and 100
    ) then
      raise exception 'Cada porcentagem precisa ficar entre 0 e 100.';
    end if;
  end if;

  -- Sem nenhuma mudança: não mexe em nada (link travado continua salvando).
  if not exists (
    select 1
      from jsonb_array_elements(p_destinations) with ordinality as incoming(value, ord)
      full join public.redirect_destinations current_dest
        on current_dest.redirect_link_id = p_link_id
       and current_dest.position = incoming.ord - 1
     where (current_dest.id is null or current_dest.redirect_link_id = p_link_id)
       and (current_dest.id is null
        or incoming.value is null
        or current_dest.target_url is distinct from trim(incoming.value->>'target_url')
        or current_dest.label is distinct from nullif(trim(coalesce(incoming.value->>'label', '')), '')
        or current_dest.weight is distinct from coalesce((incoming.value->>'weight')::integer, 0))
  ) then
    return query select * from public.redirect_destinations where redirect_link_id = p_link_id order by position;
    return;
  end if;

  -- Tira as posições atuais do caminho do unique(redirect_link_id, position).
  update public.redirect_destinations
     set position = position + 100000
   where redirect_link_id = p_link_id;

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
             label = nullif(trim(coalesce(item.value->>'label', '')), ''),
             weight = coalesce((item.value->>'weight')::integer, 0)
       where id = existing_id;
    else
      insert into public.redirect_destinations (redirect_link_id, label, target_url, position, weight)
      values (
        p_link_id,
        nullif(trim(coalesce(item.value->>'label', '')), ''),
        trim(item.value->>'target_url'),
        item.pos,
        coalesce((item.value->>'weight')::integer, 0)
      )
      returning id into existing_id;
    end if;
    kept := kept || existing_id;
  end loop;

  delete from public.redirect_destinations
   where redirect_link_id = p_link_id
     and not (id = any(kept));

  -- Pesos ou destinos mudaram: recomeça a intercalação do zero.
  update public.redirect_destinations
     set wrr_current = 0
   where redirect_link_id = p_link_id;

  return query select * from public.redirect_destinations where redirect_link_id = p_link_id order by position;
end;
$$;

revoke all on function public.save_redirect_destinations(uuid, jsonb) from public, anon;
grant execute on function public.save_redirect_destinations(uuid, jsonb) to authenticated;
