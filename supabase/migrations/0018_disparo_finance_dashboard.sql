-- =============================================================================
-- 0018 — Persistência financeira dos disparos e comprovantes privados Infobip
-- =============================================================================

alter table public.disparo_tasks
  add column if not exists contracted_quantity bigint not null default 0,
  add column if not exists sent_quantity bigint not null default 0,
  add column if not exists client_revenue numeric(14,2) not null default 0,
  add column if not exists supplier_unit_cost numeric(12,4) not null default 0.1600;

alter table public.disparo_tasks
  drop constraint if exists disparo_tasks_contracted_quantity_check,
  add constraint disparo_tasks_contracted_quantity_check check (contracted_quantity >= 0),
  drop constraint if exists disparo_tasks_sent_quantity_check,
  add constraint disparo_tasks_sent_quantity_check check (sent_quantity >= 0),
  drop constraint if exists disparo_tasks_client_revenue_check,
  add constraint disparo_tasks_client_revenue_check check (client_revenue >= 0),
  drop constraint if exists disparo_tasks_supplier_unit_cost_check,
  add constraint disparo_tasks_supplier_unit_cost_check check (supplier_unit_cost >= 0);

create index if not exists disparo_tasks_finance_period_idx
  on public.disparo_tasks (organization_id, scheduled_date, created_at);

create table if not exists public.disparo_financial_settings (
  organization_id uuid primary key default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  supplier_unit_cost numeric(12,4) not null default 0.1600
    check (supplier_unit_cost >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.infobip_deposits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  deposited_at date not null default current_date,
  status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'cancelled')),
  reference text check (reference is null or char_length(trim(reference)) between 1 and 160),
  notes text check (notes is null or char_length(notes) <= 2000),
  receipt_path text check (
    receipt_path is null
    or (
      char_length(receipt_path) <= 1024
      and split_part(receipt_path, '/', 1) = organization_id::text
    )
  ),
  receipt_file_name text check (
    receipt_file_name is null or char_length(trim(receipt_file_name)) between 1 and 255
  ),
  receipt_content_type text check (
    receipt_content_type is null
    or receipt_content_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (receipt_path is null and receipt_file_name is null and receipt_content_type is null)
    or (receipt_path is not null and receipt_file_name is not null and receipt_content_type is not null)
  )
);

create index if not exists infobip_deposits_period_idx
  on public.infobip_deposits (organization_id, deposited_at desc);
create index if not exists infobip_deposits_status_idx
  on public.infobip_deposits (organization_id, status);

drop trigger if exists trg_disparo_financial_settings_updated_at on public.disparo_financial_settings;
create trigger trg_disparo_financial_settings_updated_at
  before update on public.disparo_financial_settings
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_infobip_deposits_updated_at on public.infobip_deposits;
create trigger trg_infobip_deposits_updated_at
  before update on public.infobip_deposits
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_audit_disparo_tasks on public.disparo_tasks;
create trigger trg_audit_disparo_tasks
  after insert or update or delete on public.disparo_tasks
  for each row execute function public.fn_audit_changes('DISPARO_TASK');

drop trigger if exists trg_audit_disparo_financial_settings on public.disparo_financial_settings;
create trigger trg_audit_disparo_financial_settings
  after insert or update or delete on public.disparo_financial_settings
  for each row execute function public.fn_audit_changes('DISPARO_FINANCIAL_SETTINGS');

drop trigger if exists trg_audit_infobip_deposits on public.infobip_deposits;
create trigger trg_audit_infobip_deposits
  after insert or update or delete on public.infobip_deposits
  for each row execute function public.fn_audit_changes('INFOBIP_DEPOSIT');

alter table public.disparo_financial_settings enable row level security;
alter table public.infobip_deposits enable row level security;

drop policy if exists disparo_financial_settings_admin_all on public.disparo_financial_settings;
create policy disparo_financial_settings_admin_all on public.disparo_financial_settings
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

drop policy if exists infobip_deposits_admin_all on public.infobip_deposits;
create policy infobip_deposits_admin_all on public.infobip_deposits
  for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());

-- Os comprovantes não podem ser públicos. O primeiro segmento sempre identifica
-- a organização, permitindo que as policies isolem os arquivos de cada tenant.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'infobip-receipts',
  'infobip-receipts',
  false,
  16777216,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists infobip_receipts_admin_select on storage.objects;
create policy infobip_receipts_admin_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'infobip-receipts'
    and private.is_admin()
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  );

drop policy if exists infobip_receipts_admin_insert on storage.objects;
create policy infobip_receipts_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'infobip-receipts'
    and private.is_admin()
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  );

drop policy if exists infobip_receipts_admin_update on storage.objects;
create policy infobip_receipts_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'infobip-receipts'
    and private.is_admin()
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  )
  with check (
    bucket_id = 'infobip-receipts'
    and private.is_admin()
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  );

drop policy if exists infobip_receipts_admin_delete on storage.objects;
create policy infobip_receipts_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'infobip-receipts'
    and private.is_admin()
    and (storage.foldername(name))[1] = private.current_organization_id()::text
  );
