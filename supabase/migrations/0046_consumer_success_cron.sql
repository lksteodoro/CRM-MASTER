-- Agendador das mensagens periódicas do Consumer Success.
--
-- O pg_cron chama a Edge Function `cs-run-scheduled` a cada 10 minutos; ela é
-- quem decide o que está vencido e conversa com a Evolution API. O segredo do
-- header vem de `cs_cron_config` — nem o cron nem a função guardam credencial
-- em código.

-- Contador de não-lidas: só o service role (Edge Function do webhook) chama.
create or replace function public.cs_increment_unread(p_group_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.cs_groups
     set unread_count = unread_count + 1
   where id = p_group_id;
$$;

revoke execute on function public.cs_increment_unread(uuid) from public, anon, authenticated;

select cron.unschedule('cs-run-scheduled')
 where exists (select 1 from cron.job where jobname = 'cs-run-scheduled');

select cron.schedule(
  'cs-run-scheduled',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/cs-run-scheduled',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select cron_secret from public.cs_cron_config limit 1)
      ),
      body := '{}'::jsonb
    );
  $$
);
