-- =============================================================================
-- 0036 — Continuidade operacional e mínimo de contatos para demandas do portal
-- =============================================================================

alter table public.disparo_tasks
  add column if not exists client_portal_status text not null default 'submitted'
    check (client_portal_status in ('submitted', 'under_review', 'action_required', 'approved')),
  add column if not exists client_feedback_comment text,
  add column if not exists client_feedback_at timestamptz,
  add column if not exists client_feedback_by uuid references auth.users(id) on delete set null;

-- Demandas anteriores ao fluxo novo ganham um checklist fiel ao que já foi
-- enviado pelo portal, sem marcar itens que ainda dependem da agência.
update public.disparo_tasks
set checklist = coalesce(checklist, '{}'::jsonb) || jsonb_build_object(
  'pedido.cliente', true,
  'pedido.volume', list_valid_count > 0,
  'pedido.data_disparo', scheduled_date is not null,
  'numero_perfil.nome_ddd', coalesce(profile_name_snapshot, '') <> '' and coalesce(profile_ddd_snapshot, '') <> '',
  'lista.lista_recebida', source_list_path is not null,
  'lista.duplicados_removidos', source_list_path is not null
)
where request_source = 'client_portal';

-- A verificação é feita no banco, portanto drag-and-drop, chamadas diretas e
-- futuras telas não conseguem iniciar o disparo abaixo do mínimo contratado.
create or replace function public.fn_disparo_portal_minimum_contacts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.request_source = 'client_portal'
     and old.status = 'pedido'
     and new.status <> 'pedido'
     and new.client_portal_status = 'submitted' then
    new.client_portal_status := 'under_review';
  end if;

  if new.request_source = 'client_portal'
     and new.status in ('disparo', 'finalizado')
     and (coalesce(new.list_valid_count, 0) < 1000 or new.client_portal_status <> 'approved') then
    if new.client_portal_status <> 'approved' then
      raise exception 'A demanda do portal precisa ser aprovada pela agência antes de iniciar o disparo.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Esta demanda possui % contatos válidos. São necessários pelo menos 1.000 para iniciar o disparo.', coalesce(new.list_valid_count, 0)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_disparo_portal_minimum_contacts on public.disparo_tasks;
create trigger trg_disparo_portal_minimum_contacts
  before insert or update of status, list_valid_count, request_source on public.disparo_tasks
  for each row execute function public.fn_disparo_portal_minimum_contacts();

create index if not exists disparo_tasks_client_portal_feedback_idx
  on public.disparo_tasks (client_id, client_portal_status, client_submitted_at desc)
  where request_source = 'client_portal' and archived_at is null;
