-- Importação de leads: um contato único pode possuir várias entradas/histórico.
create or replace function public.import_leads_batch(p_project_id uuid, p_rows jsonb)
returns table(inserted_count integer, updated_count integer, invalid_count integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_client_id uuid; v_row jsonb; v_contact_id uuid; v_event_id uuid;
  v_inserted integer := 0; v_updated integer := 0; v_invalid integer := 0;
  v_email text; v_phone text; v_occurred_at timestamptz; v_custom record;
begin
  if not (private.is_admin() or private.has_project_permission(p_project_id, 'edit_settings')) then
    raise exception 'Sem permissão para importar leads neste projeto';
  end if;
  select client_id into v_client_id from public.projects where id = p_project_id;
  if v_client_id is null then raise exception 'Projeto não encontrado'; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_email := nullif(lower(trim(v_row->>'email')), '');
    v_phone := nullif(regexp_replace(coalesce(v_row->>'phone', ''), '[^0-9]', '', 'g'), '');
    begin v_occurred_at := (v_row->>'occurred_at')::timestamptz; exception when others then v_occurred_at := null; end;
    if nullif(trim(v_row->>'name'), '') is null or v_occurred_at is null then v_invalid := v_invalid + 1; continue; end if;

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

    for v_custom in select key, value from jsonb_each(coalesce(v_row->'custom_fields', '{}'::jsonb)) loop
      insert into public.project_custom_fields (project_id, entity_type, field_key, label)
      values (p_project_id, 'lead', v_custom.key, v_custom.key)
      on conflict (project_id, entity_type, field_key) do nothing;
    end loop;

    select id into v_event_id from public.lead_events where project_id = p_project_id and external_id = v_row->>'external_id';
    insert into public.lead_events (contact_id, project_id, external_id, occurred_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term, source, status, attribution_status, raw_payload, custom_fields)
    values (v_contact_id, p_project_id, v_row->>'external_id', v_occurred_at, nullif(v_row->>'utm_source', ''), nullif(v_row->>'utm_medium', ''), nullif(v_row->>'utm_campaign', ''), nullif(v_row->>'utm_content', ''), nullif(v_row->>'utm_term', ''), 'csv_import', coalesce(nullif(v_row->>'status', ''), 'NOVO'),
      case when nullif(v_row->>'utm_campaign', '') is not null then 'PARTIAL' else 'NONE' end, v_row->'raw_payload', coalesce(v_row->'custom_fields', '{}'::jsonb))
    on conflict (project_id, external_id) do update set contact_id = excluded.contact_id, occurred_at = excluded.occurred_at,
      utm_source = excluded.utm_source, utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign,
      utm_content = excluded.utm_content, utm_term = excluded.utm_term, status = excluded.status,
      raw_payload = excluded.raw_payload, custom_fields = excluded.custom_fields, updated_at = now();
    if v_event_id is null then v_inserted := v_inserted + 1; else v_updated := v_updated + 1; end if;
  end loop;
  return query select v_inserted, v_updated, v_invalid;
end;
$$;

revoke all on function public.import_leads_batch(uuid, jsonb) from public;
grant execute on function public.import_leads_batch(uuid, jsonb) to authenticated;
