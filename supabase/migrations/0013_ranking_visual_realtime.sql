-- =============================================================================
-- 0013 — Ranking visual (fotos, metas, prêmios) + ajuste manual auditado
--
-- sellers.photo_url / sales_goal: personalização visual e meta de vendas
-- (quantidade) por vendedor, usada na barra de progresso do ranking.
--
-- client_ranking_settings: configuração por cliente do "espetáculo" do
-- ranking — prêmios por posição, faixa de bônus, e as opções de
-- som/animação do telão (que o telão, sendo público, só consegue ler por
-- aqui, já que não tem sessão logada).
--
-- seller_point_adjustments: ledger imutável de correções/bônus manuais de
-- pontos — nunca sobrescreve, cada lançamento fica registrado (quem,
-- quando, quanto, motivo). Sem UPDATE/DELETE liberado pra ninguém, mesmo
-- espírito de audit_logs.
--
-- Bucket seller-photos: primeiro uso de Storage neste projeto. Público pra
-- leitura (foto não é dado sensível); escrita só por quem já gerencia
-- vendedores do cliente dono do arquivo.
-- =============================================================================

alter table public.sellers
  add column photo_url text,
  add column sales_goal integer not null default 0;

create table public.client_ranking_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  prize_first text,
  prize_second text,
  prize_third text,
  bonus_label text,
  sound_enabled boolean not null default true,
  sound_choice text not null default 'sino' check (sound_choice in ('sino', 'aplausos', 'caixa')),
  animation_enabled boolean not null default true,
  sale_banner_message text not null default 'VENDA FECHADA!',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seller_point_adjustments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  amount integer not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_seller_point_adjustments_seller on public.seller_point_adjustments (seller_id, created_at);

alter table public.client_ranking_settings enable row level security;
alter table public.seller_point_adjustments enable row level security;

create policy client_ranking_settings_select on public.client_ranking_settings
  for select to authenticated
  using (private.is_admin() or private.has_client_access(client_id));

create policy client_ranking_settings_write on public.client_ranking_settings
  for all to authenticated
  using (private.is_admin() or private.has_client_edit_settings(client_id))
  with check (private.is_admin() or private.has_client_edit_settings(client_id));

create policy seller_point_adjustments_select on public.seller_point_adjustments
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.sellers s
       where s.id = seller_point_adjustments.seller_id
         and private.has_client_access(s.client_id)
    )
  );

create policy seller_point_adjustments_insert on public.seller_point_adjustments
  for insert to authenticated
  with check (
    private.is_admin()
    or exists (
      select 1 from public.sellers s
       where s.id = seller_point_adjustments.seller_id
         and private.has_client_edit_settings(s.client_id)
    )
  );

insert into storage.buckets (id, name, public)
values ('seller-photos', 'seller-photos', true)
on conflict (id) do nothing;

create policy seller_photos_public_read on storage.objects
  for select to public
  using (bucket_id = 'seller-photos');

create policy seller_photos_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'seller-photos'
    and (private.is_admin() or private.has_client_edit_settings(((storage.foldername(name))[1])::uuid))
  )
  with check (
    bucket_id = 'seller-photos'
    and (private.is_admin() or private.has_client_edit_settings(((storage.foldername(name))[1])::uuid))
  );
