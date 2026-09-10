// Edge Function: cs-run-scheduled
//
// Dispara as mensagens periódicas do Consumer Success. Chamada pelo pg_cron a
// cada 10 minutos (ver migration 0046), autenticada pelo header
// `x-cron-secret`, que bate com `cs_cron_config.cron_secret`.
//
// Uma mensagem é enviada quando:
//   - o agendamento está ativo e dentro da janela (starts_on / ends_on)
//   - a recorrência casa com o dia de hoje (diário / dia da semana / dia do mês)
//   - o horário de hoje já passou
//   - ainda não foi enviada nessa ocorrência (last_sent_at < ocorrência)
//
// Tudo é calculado no fuso de São Paulo — o Brasil não tem horário de verão
// desde 2019, então o offset fixo -03:00 é suficiente e evita depender de
// biblioteca de fuso no runtime.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TZ_OFFSET = '-03:00';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Data de hoje em São Paulo, no formato YYYY-MM-DD. */
function saoPauloDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

interface Schedule {
  id: string;
  organization_id: string;
  group_id: string;
  title: string;
  body: string;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly';
  send_time: string;
  weekday: number | null;
  day_of_month: number | null;
  starts_on: string;
  ends_on: string | null;
  last_sent_at: string | null;
}

/** Instante da ocorrência de hoje, ou null se hoje não é dia dessa recorrência. */
function occurrenceToday(schedule: Schedule, todayLocal: string): Date | null {
  if (schedule.starts_on > todayLocal) return null;
  if (schedule.ends_on && schedule.ends_on < todayLocal) return null;

  const anchor = new Date(`${todayLocal}T12:00:00${TZ_OFFSET}`);
  const weekday = anchor.getUTCDay();
  const dayOfMonth = Number(todayLocal.slice(8, 10));

  switch (schedule.recurrence) {
    case 'daily':
      break;
    case 'weekly':
      if (schedule.weekday === null || schedule.weekday !== weekday) return null;
      break;
    case 'monthly':
      if (schedule.day_of_month === null || schedule.day_of_month !== dayOfMonth) return null;
      break;
    case 'once':
      if (schedule.starts_on !== todayLocal) return null;
      if (schedule.last_sent_at) return null;
      break;
    default:
      return null;
  }

  return new Date(`${todayLocal}T${schedule.send_time}${TZ_OFFSET}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: cronConfig, error: cronError } = await admin
    .from('cs_cron_config')
    .select('cron_secret')
    .maybeSingle();
  if (cronError) return json({ error: cronError.message }, 500);

  const provided = req.headers.get('x-cron-secret');
  if (!cronConfig || !provided || provided !== cronConfig.cron_secret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const now = new Date();
  const todayLocal = saoPauloDate(now);

  const { data: schedules, error: schedulesError } = await admin
    .from('cs_scheduled_messages')
    .select(
      'id, organization_id, group_id, title, body, recurrence, send_time, weekday, day_of_month, starts_on, ends_on, last_sent_at'
    )
    .eq('active', true);
  if (schedulesError) return json({ error: schedulesError.message }, 500);

  const due = ((schedules ?? []) as Schedule[]).filter((schedule) => {
    const occurrence = occurrenceToday(schedule, todayLocal);
    if (!occurrence) return false;
    if (occurrence.getTime() > now.getTime()) return false;
    if (schedule.last_sent_at && new Date(schedule.last_sent_at).getTime() >= occurrence.getTime()) {
      return false;
    }
    return true;
  });

  if (due.length === 0) return json({ ok: true, checked: schedules?.length ?? 0, sent: 0 });

  // Uma integração por organização — carrega só as que têm mensagem pra enviar.
  const orgIds = [...new Set(due.map((schedule) => schedule.organization_id))];
  const { data: integrations, error: integrationsError } = await admin
    .from('cs_integration')
    .select('organization_id, base_url, api_key, instance_name')
    .in('organization_id', orgIds);
  if (integrationsError) return json({ error: integrationsError.message }, 500);

  const integrationByOrg = new Map(
    (integrations ?? []).map((row) => [row.organization_id as string, row])
  );

  const results: { schedule_id: string; ok: boolean; error?: string }[] = [];

  for (const schedule of due) {
    const integration = integrationByOrg.get(schedule.organization_id);
    if (!integration) {
      results.push({ schedule_id: schedule.id, ok: false, error: 'integration_not_configured' });
      continue;
    }

    const { data: group } = await admin
      .from('cs_groups')
      .select('id, evolution_jid')
      .eq('id', schedule.group_id)
      .maybeSingle();

    if (!group) {
      results.push({ schedule_id: schedule.id, ok: false, error: 'group_not_found' });
      continue;
    }

    try {
      const baseUrl = String(integration.base_url).replace(/\/+$/, '');
      const response = await fetch(
        `${baseUrl}/message/sendText/${encodeURIComponent(String(integration.instance_name))}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: String(integration.api_key) },
          body: JSON.stringify({ number: group.evolution_jid, text: schedule.body }),
        }
      );

      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // mantém o texto cru
      }

      if (!response.ok) {
        // Registra a falha como mensagem pra ficar visível no inbox em vez de
        // sumir num log que ninguém abre.
        await admin.from('cs_messages').insert({
          organization_id: schedule.organization_id,
          group_id: group.id,
          direction: 'outbound',
          body: schedule.body,
          status: 'failed',
          scheduled_message_id: schedule.id,
          from_me: true,
          occurred_at: new Date().toISOString(),
        });
        results.push({
          schedule_id: schedule.id,
          ok: false,
          error: typeof parsed === 'string' ? parsed.slice(0, 300) : JSON.stringify(parsed).slice(0, 300),
        });
        continue;
      }

      const payload = parsed as Record<string, unknown>;
      const key = payload?.key as Record<string, unknown> | undefined;
      const messageId = typeof key?.id === 'string' ? key.id : null;

      await admin.from('cs_messages').upsert(
        {
          organization_id: schedule.organization_id,
          group_id: group.id,
          evolution_message_id: messageId,
          direction: 'outbound',
          body: schedule.body,
          status: 'sent',
          scheduled_message_id: schedule.id,
          from_me: true,
          occurred_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,evolution_message_id' }
      );

      await admin
        .from('cs_groups')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: schedule.body.slice(0, 160),
        })
        .eq('id', group.id);

      await admin
        .from('cs_scheduled_messages')
        .update({ last_sent_at: new Date().toISOString() })
        .eq('id', schedule.id);

      results.push({ schedule_id: schedule.id, ok: true });
    } catch (e) {
      results.push({
        schedule_id: schedule.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return json({
    ok: true,
    checked: schedules?.length ?? 0,
    due: due.length,
    sent: results.filter((result) => result.ok).length,
    results,
  });
});
