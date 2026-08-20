-- Converte explicitamente as datas recebidas pelo importador para timestamptz.
create or replace function public.import_sales_batch(p_project_id uuid, p_rows jsonb)
returns table(inserted_count integer, skipped_count integer, invalid_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_row jsonb;
  v_contact_id uuid;
  v_lead_event_id uuid;
  v_seller_id uuid;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_invalid integer := 0;
  v_email text;
  v_phone text;
  v_sold_at timestamptz;
begin
  if not (private.is_admin() or private.has_project_permission(p_project_id, 'edit_settings')) then
    raise exception 'Sem permissão para importar vendas neste projeto';
  end if;
  select client_id into v_client_id from public.projects where id = p_project_id;
  if v_client_id is null then raise exception 'Projeto não encontrado'; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_email := nullif(lower(trim(v_row->>'email')), '');
    v_phone := nullif(regexp_replace(coalesce(v_row->>'phone', ''), '[^0-9]', '', 'g'), '');
    begin
      v_sold_at := (v_row->>'sold_at')::timestamptz;
    exception when others then
      v_sold_at := null;
    end;
    if nullif(trim(v_row->>'name'), '') is null or v_sold_at is null then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    v_contact_id := null;
    if v_email is not null or v_phone is not null then
      select id into v_contact_id from public.contacts
       where client_id = v_client_id
         and ((v_email is not null and normalized_email = v_email) or (v_phone is not null and normalized_phone = v_phone))
       limit 1;
    end if;
    if v_contact_id is null then
      insert into public.contacts (client_id, name, normalized_email, normalized_phone, original_email, original_phone)
      values (v_client_id, nullif(trim(v_row->>'name'), ''), v_email, v_phone, v_email, nullif(trim(v_row->>'phone'), ''))
      returning id into v_contact_id;
    else
      update public.contacts set name = coalesce(nullif(trim(v_row->>'name'), ''), name), updated_at = now() where id = v_contact_id;
    end if;

    insert into public.lead_events (contact_id, project_id, external_id, occurred_at, source, status, attribution_status, raw_payload)
    values (v_contact_id, p_project_id, 'csv-lead-' || (v_row->>'external_sale_id'), v_sold_at, 'csv_import', 'CONVERTIDO', 'NONE', v_row->'raw_payload')
    on conflict (project_id, external_id) do update set contact_id = excluded.contact_id
    returning id into v_lead_event_id;

    select id into v_seller_id from public.sellers where client_id = v_client_id and lower(trim(name)) = lower(trim(v_row->>'seller_name')) limit 1;
    insert into public.sales (contact_id, project_id, lead_event_id, seller_id, external_sale_id, amount, status, payment_method, sold_at, raw_payload)
    values (v_contact_id, p_project_id, v_lead_event_id, v_seller_id, v_row->>'external_sale_id', nullif(v_row->>'amount', '')::numeric, coalesce(nullif(v_row->>'status', ''), 'PAID'), nullif(v_row->>'payment_method', ''), v_sold_at, v_row->'raw_payload')
    on conflict (project_id, external_sale_id) do nothing;
    if found then v_inserted := v_inserted + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return query select v_inserted, v_skipped, v_invalid;
end;
$$;

revoke all on function public.import_sales_batch(uuid, jsonb) from public;
grant execute on function public.import_sales_batch(uuid, jsonb) to authenticated;
