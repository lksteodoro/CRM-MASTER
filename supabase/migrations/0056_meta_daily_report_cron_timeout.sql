-- O pg_net desiste da chamada em 5 s por padrão; a busca de vários dias na Meta
-- pode levar mais. O cron do resumo diário passa a esperar até 2 minutos.
select cron.unschedule('meta-daily-report')
 where exists (select 1 from cron.job where jobname = 'meta-daily-report');

select cron.schedule(
  'meta-daily-report',
  '30 11 * * *',
  $$
    select net.http_post(
      url := 'https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/meta-daily-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select cron_secret from public.meta_report_cron_config limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
