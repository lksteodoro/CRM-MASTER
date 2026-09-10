-- =============================================================================
-- 0050 — Consumer Success: espaçamento entre grupos no disparo
--
-- Disparar pra vários grupos de uma vez, no mesmo segundo e do mesmo número, é
-- o padrão que mais liga o alarme de bloqueio do WhatsApp. Agora cada grupo
-- entra na fila com um horário escalonado (intervalo fixo + variação
-- aleatória); o worker continua pegando só o que já venceu (`available_at`),
-- então as mensagens saem pingadas em vez de em rajada.
--
--  send_gap_seconds        — intervalo base entre um grupo e o próximo
--  send_gap_jitter_seconds — variação aleatória somada a cada grupo (0..N)
-- =============================================================================

alter table public.cs_integration
  add column send_gap_seconds integer not null default 45
    check (send_gap_seconds between 0 and 3600),
  add column send_gap_jitter_seconds integer not null default 30
    check (send_gap_jitter_seconds between 0 and 3600);

create or replace function public.cs_enqueue_occurrence(
  p_schedule_id uuid,
  p_at timestamptz,
  p_immediate boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  v_org uuid;
  v_gap integer;
  v_jitter integer;
begin
  select organization_id into v_org from cs_scheduled_messages where id = p_schedule_id;

  select coalesce(send_gap_seconds, 45), coalesce(send_gap_jitter_seconds, 30)
    into v_gap, v_jitter
    from cs_integration
   where organization_id = v_org;

  v_gap := coalesce(v_gap, 45);
  v_jitter := coalesce(v_jitter, 30);

  -- O primeiro grupo sai na hora; os demais ganham gap*(posição) + jitter.
  insert into cs_deliveries (
    organization_id, schedule_id, group_id, occurrence_at, immediate, available_at
  )
  select
    eg.organization_id,
    p_schedule_id,
    eg.id,
    p_at,
    p_immediate,
    now() + make_interval(secs =>
      v_gap * (row_number() over (order by eg.id) - 1)
      + case
          when row_number() over (order by eg.id) = 1 then 0
          else floor(random() * (v_jitter + 1))
        end
    )
  from public.cs_eligible_groups(p_schedule_id) eg
  on conflict do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.cs_enqueue_occurrence(uuid, timestamptz, boolean)
  from public, anon, authenticated;
