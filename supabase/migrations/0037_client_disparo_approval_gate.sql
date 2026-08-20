-- Exige aprovação interna além do mínimo de contatos em instalações que já
-- executaram a migration 0036.
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
     and new.status in ('disparo', 'finalizado') then
    if new.client_portal_status <> 'approved' then
      raise exception 'A demanda do portal precisa ser aprovada pela agência antes de iniciar o disparo.'
        using errcode = 'check_violation';
    end if;
    if coalesce(new.list_valid_count, 0) < 1000 then
      raise exception 'Esta demanda possui % contatos válidos. São necessários pelo menos 1.000 para iniciar o disparo.', coalesce(new.list_valid_count, 0)
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

alter table public.disparo_tasks
  drop constraint if exists disparo_tasks_list_counts_consistent,
  add constraint disparo_tasks_list_counts_consistent check (
    list_original_count = list_valid_count + list_invalid_count + list_duplicate_count
  );
