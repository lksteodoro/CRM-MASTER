-- Campos personalizados por projeto e importação de vendas sem criar leads.
create table if not exists public.project_custom_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_type text not null check (entity_type in ('sale', 'lead')),
  field_key text not null,
  label text not null,
  data_type text not null default 'text' check (data_type in ('text', 'number', 'date', 'boolean')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (project_id, entity_type, field_key)
);

alter table public.sales add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.lead_events add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- Contatos de vendas precisam ser visíveis mesmo sem um lead_event associado.
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.lead_events le where le.contact_id = contacts.id and private.has_project_permission(le.project_id, 'view_leads'))
    or exists (select 1 from public.sales s where s.contact_id = contacts.id and private.has_project_permission(s.project_id, 'view_sales'))
  );

alter table public.project_custom_fields enable row level security;
drop policy if exists project_custom_fields_select on public.project_custom_fields;
create policy project_custom_fields_select on public.project_custom_fields for select to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, case when entity_type = 'sale' then 'view_sales' else 'view_leads' end));
drop policy if exists project_custom_fields_write on public.project_custom_fields;
create policy project_custom_fields_write on public.project_custom_fields for all to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'))
  with check (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'));

create or replace function public.import_sales_batch(p_project_id uuid, p_rows jsonb)
returns table(inserted_count integer, skipped_count integer, invalid_count integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid; v_row jsonb; v_contact_id uuid; v_seller_id uuid;
  v_inserted integer := 0; v_skipped integer := 0; v_invalid integer := 0;
  v_email text; v_phone text; v_seller_name text; v_sold_at timestamptz;
  v_custom record;
begin
  if not (private.is_admin() or private.has_project_permission(p_project_id, 'edit_settings')) then
    raise exception 'Sem permissão para importar vendas neste projeto';
  end if;
  select client_id into v_client_id from public.projects where id = p_project_id;
  if v_client_id is null then raise exception 'Projeto não encontrado'; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_email := nullif(lower(trim(v_row->>'email')), '');
    v_phone := nullif(regexp_replace(coalesce(v_row->>'phone', ''), '[^0-9]', '', 'g'), '');
    begin v_sold_at := (v_row->>'sold_at')::timestamptz; exception when others then v_sold_at := null; end;
    if nullif(trim(v_row->>'name'), '') is null or v_sold_at is null then v_invalid := v_invalid + 1; continue; end if;

    v_contact_id := null;
    if v_email is not null or v_phone is not null then
      select id into v_contact_id from public.contacts where client_id = v_client_id
       and ((v_email is not null and normalized_email = v_email) or (v_phone is not null and normalized_phone = v_phone)) limit 1;
    end if;
    if v_contact_id is null then
      insert into public.contacts (client_id, name, normalized_email, normalized_phone, original_email, original_phone)
      values (v_client_id, trim(v_row->>'name'), v_email, v_phone, v_email, nullif(trim(v_row->>'phone'), '')) returning id into v_contact_id;
    else
      update public.contacts set name = coalesce(nullif(trim(v_row->>'name'), ''), name), updated_at = now() where id = v_contact_id;
    end if;

    v_seller_name := nullif(trim(v_row->>'seller_name'), ''); v_seller_id := null;
    if v_seller_name is not null then
      select id into v_seller_id from public.sellers where client_id = v_client_id and lower(trim(name)) = lower(v_seller_name) limit 1;
      if v_seller_id is null then insert into public.sellers (client_id, name, active) values (v_client_id, v_seller_name, true) returning id into v_seller_id; end if;
    end if;

    for v_custom in select key, value from jsonb_each(coalesce(v_row->'custom_fields', '{}'::jsonb)) loop
      insert into public.project_custom_fields (project_id, entity_type, field_key, label)
      values (p_project_id, 'sale', v_custom.key, v_custom.key)
      on conflict (project_id, entity_type, field_key) do nothing;
    end loop;

    insert into public.sales (contact_id, project_id, lead_event_id, seller_id, external_sale_id, amount, status, payment_method, sold_at, raw_payload, custom_fields)
    values (v_contact_id, p_project_id, null, v_seller_id, v_row->>'external_sale_id', nullif(v_row->>'amount', '')::numeric,
      coalesce(nullif(v_row->>'status', ''), 'PAID'), nullif(v_row->>'payment_method', ''), v_sold_at, v_row->'raw_payload', coalesce(v_row->'custom_fields', '{}'::jsonb))
    on conflict (project_id, external_sale_id) do update set
      contact_id = excluded.contact_id, seller_id = excluded.seller_id, amount = excluded.amount, status = excluded.status,
      payment_method = excluded.payment_method, sold_at = excluded.sold_at, raw_payload = excluded.raw_payload,
      custom_fields = excluded.custom_fields, updated_at = now();
    if found then v_inserted := v_inserted + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return query select v_inserted, v_skipped, v_invalid;
end;
$$;

revoke all on function public.import_sales_batch(uuid, jsonb) from public;
grant execute on function public.import_sales_batch(uuid, jsonb) to authenticated;
