// Durable Consumer Success queue. All times and claims originate in Postgres.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { classifySendResponse } from './send-policy.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: config, error: configError } = await admin.from('cs_cron_config').select('cron_secret').maybeSingle();
  if (configError) return json({ error: 'cron_configuration_unavailable' }, 500);
  if (!config || !req.headers.get('x-cron-secret') || req.headers.get('x-cron-secret') !== config.cron_secret) {
    return json({ error: 'unauthorized' }, 401);
  }
  const { data: queued, error: enqueueError } = await admin.rpc('cs_enqueue_due');
  if (enqueueError) return json({ error: enqueueError.message }, 500);
  const totals = { queued, sent: 0, failed: 0, uncertain: 0, skipped: 0, retry: 0 };
  // Bound runtime. Another invocation may safely drain another group concurrently.
  const deadline = Date.now() + 45_000;
  for (let i = 0; i < 50 && Date.now() < deadline; i++) {
    const { data: rows, error: claimError } = await admin.rpc('cs_claim_delivery');
    if (claimError) return json({ ...totals, error: claimError.message }, 500);
    const delivery = rows?.[0];
    if (!delivery) break;
    const finish = async (status: 'sent' | 'failed' | 'uncertain' | 'skipped' | 'retry', error?: string, messageId?: string) => {
      const { error: finishError } = await admin.rpc('cs_finish_delivery', {
        p_id: delivery.id, p_token: delivery.claim_token, p_status: status,
        p_error: error ?? null, p_message_id: messageId ?? null,
      });
      // Never retry WhatsApp if persistence of an acknowledgement failed.
      // Claim expiry makes the attempt uncertain for an operator to reconcile.
      if (finishError) throw new Error(`delivery_persistence_failed:${delivery.id}`);
      totals[status]++;
    };
    try {
      // Recheck latest eligibility immediately before network activity.
      const { data: eligible, error: eligibleError } = await admin.rpc('cs_eligible_groups', { p_schedule_id: delivery.schedule_id });
      const { data: schedule, error: scheduleError } = await admin.from('cs_scheduled_messages').select('active').eq('id', delivery.schedule_id).maybeSingle();
      if (eligibleError || scheduleError) {
        await finish('retry', 'eligibility_check_unavailable'); continue;
      }
      const group = eligible?.find((g: { id: string }) => g.id === delivery.group_id);
      if (!group || !schedule || (!delivery.immediate && !schedule.active)) {
        await finish('skipped', 'recipient_or_schedule_paused'); continue;
      }
      const { data: integration, error: integrationError } = await admin.from('cs_integration')
        .select('base_url,api_key,instance_name').eq('organization_id', delivery.organization_id).maybeSingle();
      if (integrationError || !integration) {
        await finish('retry', 'integration_unavailable'); continue;
      }
      let response: Response;
      try {
        response = await fetch(`${String(integration.base_url).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(integration.instance_name)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: integration.api_key },
          body: JSON.stringify({ number: group.evolution_jid, text: delivery.body }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        await finish('uncertain', 'network_result_unknown_check_whatsapp_before_resending'); continue;
      }
      // Reading the response can itself fail after Evolution accepted the message.
      let payload: unknown;
      try { payload = await response.json(); } catch { payload = null; }
      const outcome = classifySendResponse(response.status, payload);
      await finish(outcome.status, outcome.error, outcome.messageId);
    } catch (error) {
      // Stop this invocation rather than disguising a failed acknowledgement as a safe retry.
      console.error('Consumer Success delivery interrupted', delivery.id, error instanceof Error ? error.message : 'unknown');
      return json({ ...totals, error: 'delivery_requires_reconciliation', delivery_id: delivery.id }, 500);
    }
  }
  return json({ ok: true, ...totals });
});
