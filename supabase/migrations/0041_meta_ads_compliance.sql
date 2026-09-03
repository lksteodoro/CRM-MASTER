-- =============================================================================
-- 0041 — Conformidade da ferramenta Meta Ads
--
-- Três frentes, todas exigidas pelas políticas da Meta:
--
-- 1. Mídia de anúncio sai do navegador. O arquivo vai para um bucket privado e
--    a Edge Function entrega a URL assinada para a Meta baixar. Assim o token
--    nunca precisa existir no browser para fazer upload.
-- 2. Categoria especial e anunciante pagador viram dados declarados no perfil
--    de publicação, em vez de valores fixos no código.
-- 3. Link de redirecionamento usado em tráfego pago fica travado: destino único
--    e imutável, porque destino que muda depois da aprovação é cloaking.
-- =============================================================================

-- ── 1. Bucket de mídia de anúncio ───────────────────────────────────────────
-- Privado: a Meta acessa por URL assinada de curta duração emitida pela Edge
-- Function, não por URL pública permanente.
insert into storage.buckets (id, name, public, file_size_limit)
values ('meta-ad-media', 'meta-ad-media', false, 786432000)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists meta_ad_media_insert_own on storage.objects;
create policy meta_ad_media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'meta-ad-media' and owner_id = auth.uid()::text);

drop policy if exists meta_ad_media_select_own on storage.objects;
create policy meta_ad_media_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'meta-ad-media' and owner_id = auth.uid()::text);

drop policy if exists meta_ad_media_delete_own on storage.objects;
create policy meta_ad_media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'meta-ad-media' and owner_id = auth.uid()::text);

-- ── 2. Declarações obrigatórias no perfil de publicação ─────────────────────
-- special_ad_categories: enviado em toda campanha. Declarar categoria errada
-- (ou declarar "nenhuma" para crédito, emprego, moradia, política) é motivo de
-- restrição da conta de anúncios.
alter table public.meta_publishing_profiles
  add column if not exists special_ad_categories text[] not null default '{}';

alter table public.meta_publishing_profiles
  add column if not exists special_ad_categories_declared_at timestamptz;

-- advertiser_id: quem paga pelo anúncio, exigido pela Meta no Brasil. Sem ele
-- a publicação é bloqueada — não existe mais valor de reserva.
alter table public.meta_publishing_profiles
  add column if not exists advertiser_id text;

alter table public.meta_publishing_profiles
  drop constraint if exists meta_publishing_profiles_special_categories_valid;
alter table public.meta_publishing_profiles
  add constraint meta_publishing_profiles_special_categories_valid check (
    special_ad_categories <@ array[
      'NONE',
      'CREDIT',
      'EMPLOYMENT',
      'HOUSING',
      'ISSUES_ELECTIONS_POLITICS',
      'ONLINE_GAMBLING_AND_GAMING',
      'FINANCIAL_PRODUCTS_SERVICES'
    ]::text[]
  );

-- ── 3. Trava de cloaking no redirecionador ──────────────────────────────────
-- Link marcado como "usado em tráfego pago" não pode rodar destinos em loop nem
-- ter o destino trocado depois que o anúncio foi aprovado.
alter table public.redirect_links
  add column if not exists paid_ads_locked boolean not null default false;

alter table public.redirect_links
  drop constraint if exists redirect_links_paid_ads_single_destination;
alter table public.redirect_links
  add constraint redirect_links_paid_ads_single_destination check (
    not paid_ads_locked or strategy = 'single'
  );

create or replace function private.fn_block_locked_redirect_destination()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_locked boolean;
  v_link_id uuid;
begin
  v_link_id := coalesce(new.redirect_link_id, old.redirect_link_id);
  select paid_ads_locked into v_locked from public.redirect_links where id = v_link_id;
  if coalesce(v_locked, false) then
    raise exception 'Este link está em uso por anúncio pago: o destino não pode ser alterado, adicionado ou removido. Crie um novo link.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_redirect_destinations_paid_lock on public.redirect_destinations;
create trigger trg_redirect_destinations_paid_lock
  before insert or update or delete on public.redirect_destinations
  for each row execute function private.fn_block_locked_redirect_destination();

comment on column public.redirect_links.paid_ads_locked is
  'Link usado como destino de anúncio pago. Trava destino único e imutável para não configurar cloaking perante a Meta.';

-- ── 4. Acesso ao segredo pelo servidor ──────────────────────────────────────
-- private.meta_oauth_secrets e private.meta_oauth_states não são visíveis pelo
-- PostgREST (o schema `private` não é exposto de propósito), então as Edge
-- Functions não conseguem lê-las com `from('...')`. Estas funções são a única
-- porta de entrada: SECURITY DEFINER, sem execute para anon/authenticated, e
-- liberadas apenas para service_role — que só existe do lado do servidor.

create or replace function public.meta_oauth_secret_set(p_connection_id uuid, p_access_token text)
returns void language sql security definer set search_path = public as $$
  insert into private.meta_oauth_secrets (connection_id, access_token, updated_at)
  values (p_connection_id, p_access_token, now())
  on conflict (connection_id) do update
    set access_token = excluded.access_token, updated_at = now();
$$;

create or replace function public.meta_oauth_secret_get(p_connection_id uuid)
returns text language sql security definer set search_path = public as $$
  select access_token from private.meta_oauth_secrets where connection_id = p_connection_id;
$$;

create or replace function public.meta_oauth_state_create(
  p_state uuid, p_organization_id uuid, p_user_id uuid, p_expires_at timestamptz
) returns void language sql security definer set search_path = public as $$
  insert into private.meta_oauth_states (state, organization_id, user_id, expires_at)
  values (p_state, p_organization_id, p_user_id, p_expires_at);
$$;

-- Uso único: a linha é devolvida e apagada na mesma transação, então um mesmo
-- `state` não pode ser reaproveitado num replay do callback.
create or replace function public.meta_oauth_state_consume(p_state uuid)
returns table (organization_id uuid, user_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
  delete from private.meta_oauth_states s
  where s.state = p_state
  returning s.organization_id, s.user_id, s.expires_at;
end;
$$;

revoke all on function public.meta_oauth_secret_set(uuid, text) from public, anon, authenticated;
revoke all on function public.meta_oauth_secret_get(uuid) from public, anon, authenticated;
revoke all on function public.meta_oauth_state_create(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.meta_oauth_state_consume(uuid) from public, anon, authenticated;

grant execute on function public.meta_oauth_secret_set(uuid, text) to service_role;
grant execute on function public.meta_oauth_secret_get(uuid) to service_role;
grant execute on function public.meta_oauth_state_create(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.meta_oauth_state_consume(uuid) to service_role;
