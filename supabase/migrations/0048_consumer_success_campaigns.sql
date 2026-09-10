-- Consumer Success: durable per-group delivery queue, server-clock scheduling.
alter table public.cs_groups add column greeting text not null default '', add column automation_paused boolean not null default false;
alter table public.cs_scheduled_messages alter column group_id drop not null;
alter table public.cs_scheduled_messages
 add column recipient_mode text not null default 'single' check (recipient_mode in ('single','selected','all_active')),
 add column group_ids uuid[] not null default '{}',
 add column variants text[] not null default '{}',
 add column rotation_mode text not null default 'sequential' check (rotation_mode in ('sequential','random')),
 add column weekdays integer[] not null default '{}',
 add column next_run_at timestamptz;
alter table public.cs_scheduled_messages drop constraint cs_scheduled_messages_day_of_month_check;
alter table public.cs_scheduled_messages add check (day_of_month between 0 and 31);
update public.cs_scheduled_messages set group_ids=array[group_id], variants=array[body], weekdays=case when weekday is null then '{}'::integer[] else array[weekday] end;

create function public.cs_server_now() returns timestamptz language sql stable set search_path=public as $$ select now() $$;
revoke all on function public.cs_server_now() from public, anon;
grant execute on function public.cs_server_now() to authenticated;

create function public.cs_next_occurrence(s public.cs_scheduled_messages, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path=public as $$
declare d date; candidate timestamptz; final_day integer;
begin
 if not s.active then return null; end if;
 if s.recurrence='once' then
   candidate := (s.starts_on+s.send_time) at time zone 'America/Sao_Paulo';
   if candidate > p_after then return candidate; end if;
   return null;
 end if;
 d := greatest(s.starts_on, (p_after at time zone 'America/Sao_Paulo')::date);
 for i in 0..370 loop
   if s.ends_on is not null and d>s.ends_on then return null; end if;
   final_day := extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))::integer;
   candidate := (d+s.send_time) at time zone 'America/Sao_Paulo';
   if candidate>p_after and (s.recurrence='daily'
     or (s.recurrence='weekly' and extract(dow from d)::integer=any(s.weekdays))
     or (s.recurrence='monthly' and extract(day from d)::integer=case when s.day_of_month=0 then final_day else least(s.day_of_month,final_day) end)) then return candidate; end if;
   d:=d+1;
 end loop;
 return null;
end $$;

create function public.cs_validate_schedule() returns trigger language plpgsql security definer set search_path=public as $$
declare v text;
begin
 if new.organization_id is distinct from old.organization_id and TG_OP='UPDATE' then raise exception 'organization_immutable'; end if;
 if TG_OP='UPDATE' and auth.role()='authenticated' then
   new.next_run_at:=old.next_run_at; new.last_sent_at:=old.last_sent_at;
 end if;
 if new.ends_on<new.starts_on then raise exception 'invalid_date_range'; end if;
 if new.recurrence='weekly' and cardinality(new.weekdays)=0 then new.weekdays:=array[new.weekday]; end if;
 if new.recurrence='weekly' and (cardinality(new.weekdays)=0 or exists(select 1 from unnest(new.weekdays) x where x is null or x<0 or x>6)) then raise exception 'invalid_weekdays'; end if;
 if new.recurrence='monthly' and new.day_of_month is null then raise exception 'monthly_day_required'; end if;
 if cardinality(new.variants)=0 then new.variants:=array[new.body]; end if;
 if cardinality(new.variants)>100 then raise exception 'too_many_variants'; end if;
 foreach v in array new.variants loop
   if v is null or length(trim(v))=0 or length(v)>10000 then raise exception 'invalid_variant'; end if;
   if regexp_replace(v,'\{\{(saudacao|cliente|grupo)\}\}','','g') ~ '\{\{|\}\}' then raise exception 'unknown_personalization_token'; end if;
 end loop;
 select array_agg(deduplicated.v order by deduplicated.ordinal) into new.variants from (select trim(x) v,min(i) ordinal from unnest(new.variants) with ordinality as t(x,i) group by trim(x)) deduplicated;
 new.body:=new.variants[1];
 if new.recipient_mode='single' then
   if new.group_id is null then raise exception 'group_required'; end if;
   new.group_ids:=array[new.group_id];
 elsif new.recipient_mode='selected' then
   new.group_id:=null;
   if cardinality(new.group_ids)=0 then raise exception 'groups_required'; end if;
 else new.group_id:=null; new.group_ids:='{}'; end if;
 if exists(select 1 from unnest(new.group_ids) x where x is null or not exists(select 1 from cs_groups g where g.id=x and g.organization_id=new.organization_id)) then raise exception 'invalid_recipient_organization'; end if;
 if TG_OP='INSERT' then
   if new.active and new.recurrence='once' and (new.starts_on+new.send_time) at time zone 'America/Sao_Paulo' <= now() then raise exception 'schedule_must_be_in_future'; end if;
   new.next_run_at:=public.cs_next_occurrence(new,now());
 elsif (new.active,new.recurrence,new.send_time,new.starts_on,new.ends_on,new.weekdays,new.day_of_month)
   is distinct from (old.active,old.recurrence,old.send_time,old.starts_on,old.ends_on,old.weekdays,old.day_of_month) then
   new.next_run_at:=public.cs_next_occurrence(new,now());
 end if;
 return new;
end $$;
create trigger cs_validate_schedule before insert or update on public.cs_scheduled_messages for each row execute function public.cs_validate_schedule();
-- Preserve overdue one-offs, skip historical recurring bursts on upgrade.
update public.cs_scheduled_messages s set next_run_at=case when recurrence='once' and active and last_sent_at is null then (starts_on+send_time) at time zone 'America/Sao_Paulo' else public.cs_next_occurrence(s,now()) end;

create table public.cs_deliveries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 schedule_id uuid not null references public.cs_scheduled_messages(id) on delete cascade,
 group_id uuid not null references public.cs_groups(id) on delete cascade,
 occurrence_at timestamptz not null, immediate boolean not null default false,
 status text not null default 'pending' check(status in ('pending','processing','sent','failed','uncertain','skipped')),
 body text, variant_body text, variant_index integer, attempts integer not null default 0, available_at timestamptz not null default now(),
 claimed_at timestamptz, claim_token uuid, sent_at timestamptz, error text, evolution_message_id text,
 created_at timestamptz not null default now(), unique(schedule_id,group_id,occurrence_at)
);
create index cs_deliveries_pending on public.cs_deliveries(available_at) where status='pending';
create index cs_deliveries_rotation on public.cs_deliveries(schedule_id,group_id,sent_at desc) where status='sent';
alter table public.cs_deliveries enable row level security;
create policy cs_deliveries_read on public.cs_deliveries for select to authenticated using(organization_id=private.current_organization_id() and private.has_agency_tool_access('consumer_success'));
revoke insert,update,delete on public.cs_deliveries from authenticated,anon;

create function public.cs_eligible_groups(p_schedule_id uuid) returns setof public.cs_groups
language sql stable security definer set search_path=public as $$
 select g.* from cs_scheduled_messages s join cs_groups g on g.organization_id=s.organization_id
 left join clients c on c.id=g.client_id and c.organization_id=g.organization_id
 where s.id=p_schedule_id and g.is_managed and not g.automation_paused
 and (g.client_id is null or c.status='ACTIVE')
 and ((s.recipient_mode='all_active' and c.status='ACTIVE') or (s.recipient_mode<>'all_active' and g.id=any(s.group_ids)))
$$;
create function public.cs_enqueue_occurrence(p_schedule_id uuid,p_at timestamptz,p_immediate boolean default false) returns integer
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into cs_deliveries(organization_id,schedule_id,group_id,occurrence_at,immediate)
 select organization_id,p_schedule_id,id,p_at,p_immediate from public.cs_eligible_groups(p_schedule_id) on conflict do nothing;
 get diagnostics n=row_count; return n;
end $$;
create function public.cs_send_schedule_now(p_schedule_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare s cs_scheduled_messages; t timestamptz:=date_trunc('minute',now()); n integer; wake_command text;
begin
 select * into s from cs_scheduled_messages where id=p_schedule_id for update;
 if not found or s.organization_id is distinct from private.current_organization_id() or not coalesce(private.has_agency_tool_access('consumer_success'),false) then raise exception 'forbidden'; end if;
 -- Same schedule/minute is idempotent against double-clicks.
 n:=public.cs_enqueue_occurrence(s.id,t,true);
 if n>0 then
   -- Reuse only this function owner's trusted cron job. pg_net dispatches after commit.
   select command into wake_command from cron.job where jobname='cs-run-scheduled' and username=current_user limit 1;
   if wake_command is not null then
     begin execute wake_command; exception when others then
       raise warning 'cs_immediate_wakeup_failed_queue_retained';
     end;
   end if;
 end if;
 return n;
end $$;
create function public.cs_enqueue_due() returns integer language plpgsql security definer set search_path=public as $$
declare s cs_scheduled_messages; n integer:=0;
begin
 -- Crashed/ambiguous send claims never automatically re-enter the queue.
 update cs_deliveries set status='uncertain',error='worker_interrupted_check_whatsapp_before_resending' where status='processing' and claimed_at<now()-interval '5 minutes';
 for s in select * from cs_scheduled_messages where active and next_run_at<=now() order by next_run_at for update skip locked limit 100 loop
   n:=n+public.cs_enqueue_occurrence(s.id,s.next_run_at,false);
   update cs_scheduled_messages set next_run_at=public.cs_next_occurrence(s,greatest(s.next_run_at,now())) where id=s.id;
 end loop;
 return n;
end $$;

-- Serialize claim allocation briefly; network calls remain outside DB locks.
create function public.cs_claim_delivery() returns setof public.cs_deliveries
language plpgsql security definer set search_path=public as $$
declare d cs_deliveries; s cs_scheduled_messages; g cs_groups; last_idx integer; last_body text; idx integer; client_name text;
begin
 perform pg_advisory_xact_lock(7301943);
 for d in select * from cs_deliveries q where q.status='pending' and q.available_at<=now()
 and not exists(select 1 from cs_deliveries x where x.schedule_id=q.schedule_id and x.group_id=q.group_id and x.status='processing')
 order by q.occurrence_at,q.id for update skip locked limit 100 loop
   select * into s from cs_scheduled_messages where id=d.schedule_id;
   select * into g from public.cs_eligible_groups(d.schedule_id) where id=d.group_id;
   if g.id is null or (not d.immediate and not s.active) then
     update cs_deliveries set status='skipped',error='recipient_or_schedule_paused' where id=d.id; continue;
   end if;
   if d.body is null then
     select variant_body into last_body from cs_deliveries where schedule_id=s.id and group_id=g.id and status='sent' order by sent_at desc,id desc limit 1;
     last_idx:=array_position(s.variants,last_body)-1;
     if s.rotation_mode='random' and cardinality(s.variants)>1 then
       select i-1 into idx from generate_subscripts(s.variants,1) i where s.variants[i] is distinct from last_body order by random() limit 1;
     else idx:=mod(coalesce(last_idx,-1)+1,cardinality(s.variants)); end if;
     d.variant_body:=s.variants[idx+1];
     select name into client_name from clients where id=g.client_id and organization_id=g.organization_id;
     d.body:=replace(replace(replace(s.variants[idx+1],'{{saudacao}}',coalesce(nullif(trim(g.greeting),''),client_name,'pessoal')),'{{cliente}}',coalesce(client_name,'pessoal')),'{{grupo}}',coalesce(g.name,'grupo'));
     d.variant_index:=idx;
   end if;
   update cs_deliveries set status='processing',claimed_at=now(),claim_token=gen_random_uuid(),attempts=attempts+1,body=d.body,variant_body=d.variant_body,variant_index=d.variant_index where id=d.id returning * into d;
   return next d; return;
 end loop;
end $$;

create function public.cs_finish_delivery(p_id uuid,p_token uuid,p_status text,p_error text default null,p_message_id text default null)
returns void language plpgsql security definer set search_path=public as $$
declare d cs_deliveries;
begin
 select * into d from cs_deliveries where id=p_id for update;
 if d.status<>'processing' or d.claim_token is distinct from p_token then return; end if;
 if p_status not in ('sent','failed','uncertain','skipped','retry') then raise exception 'invalid_delivery_status'; end if;
 update cs_deliveries set status=case when p_status='retry' then case when attempts<3 then 'pending' else 'failed' end else p_status end,
   available_at=now()+interval '1 minute'*power(2,attempts),error=left(p_error,500),evolution_message_id=p_message_id,
   sent_at=case when p_status='sent' then now() else null end where id=p_id;
 if p_status='sent' then
   insert into cs_messages(organization_id,group_id,evolution_message_id,direction,body,status,scheduled_message_id,from_me)
   values(d.organization_id,d.group_id,p_message_id,'outbound',d.body,'sent',d.schedule_id,true)
   on conflict(organization_id,evolution_message_id) do update set scheduled_message_id=excluded.scheduled_message_id;
   update cs_groups set last_message_at=now(),last_message_preview=left(d.body,160) where id=d.group_id;
   update cs_scheduled_messages set last_sent_at=now() where id=d.schedule_id;
 end if;
end $$;

-- Every definer helper is service-only; only explicit UI RPC is authenticated.
revoke all on function public.cs_next_occurrence(public.cs_scheduled_messages,timestamptz),public.cs_validate_schedule(),public.cs_eligible_groups(uuid),public.cs_enqueue_occurrence(uuid,timestamptz,boolean),public.cs_enqueue_due(),public.cs_claim_delivery(),public.cs_finish_delivery(uuid,uuid,text,text,text),public.cs_send_schedule_now(uuid) from public,anon,authenticated;
grant execute on function public.cs_eligible_groups(uuid),public.cs_enqueue_due(),public.cs_claim_delivery(),public.cs_finish_delivery(uuid,uuid,text,text,text) to service_role;
grant execute on function public.cs_send_schedule_now(uuid) to authenticated;
-- Existing job URL/secret expression preserved; minute cadence supports older pg_cron.
do $$ declare j record; begin
 for j in select jobid,command from cron.job where jobname='cs-run-scheduled' loop
   perform cron.unschedule(j.jobid);
   perform cron.schedule('cs-run-scheduled','* * * * *',j.command);
 end loop;
end $$;


create function public.cs_list_clients() returns table(id uuid,name text,status text)
language sql stable security definer set search_path=public as $$
 select c.id,c.name,c.status from public.clients c
 where c.organization_id=private.current_organization_id() and private.has_agency_tool_access('consumer_success') order by c.name
$$;
revoke all on function public.cs_list_clients() from public,anon;
grant execute on function public.cs_list_clients() to authenticated;

create function public.cs_validate_group_client() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='UPDATE' and new.organization_id is distinct from old.organization_id then raise exception 'organization_immutable'; end if;
 if new.client_id is not null and not exists(select 1 from clients where id=new.client_id and organization_id=new.organization_id) then raise exception 'invalid_client_organization'; end if;
 return new;
end $$;
create trigger cs_validate_group_client before insert or update of client_id,organization_id on public.cs_groups for each row execute function public.cs_validate_group_client();
revoke all on function public.cs_validate_group_client() from public,anon,authenticated;



