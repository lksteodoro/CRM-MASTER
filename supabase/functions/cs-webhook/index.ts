// Edge Function: cs-webhook
//
// Recebe os eventos da Evolution API e grava no Consumer Success.
//
// POST /functions/v1/cs-webhook?secret=<webhook_secret da cs_integration>
//
// Eventos tratados:
//   messages.upsert  → grava a mensagem no grupo (entrada e saída)
//   groups.upsert / groups.update → atualiza nome/descrição do grupo
//
// Só grupos (`@g.us`) entram: o Consumer Success é sobre a conversa em grupo
// com o cliente, e espelhar conversa privada aqui só geraria ruído.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function extractBody(message: Record<string, unknown> | null | undefined): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  const extended = message.extendedTextMessage as Record<string, unknown> | undefined;
  if (extended && typeof extended.text === 'string') return extended.text;
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const media = message[key] as Record<string, unknown> | undefined;
    if (media && typeof media.caption === 'string' && media.caption.length > 0) return media.caption;
  }
  return null;
}

function extractMediaType(message: Record<string, unknown> | null | undefined): string | null {
  if (!message) return null;
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  return null;
}

function previewFor(body: string | null, mediaType: string | null): string | null {
  if (body && body.length > 0) return body.slice(0, 160);
  if (!mediaType) return null;
  const labels: Record<string, string> = {
    image: '📷 Imagem',
    video: '🎥 Vídeo',
    audio: '🎤 Áudio',
    document: '📎 Documento',
    sticker: '🙂 Figurinha',
  };
  return labels[mediaType] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret) return json({ error: 'missing_secret' }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: integration, error: integrationError } = await admin
    .from('cs_integration')
    .select('id, organization_id, instance_name')
    .eq('webhook_secret', secret)
    .maybeSingle();

  if (integrationError) return json({ error: integrationError.message }, 400);
  if (!integration) return json({ error: 'unauthorized' }, 401);

  const organizationId = integration.organization_id as string;
  const event = String(payload.event ?? '').toLowerCase().replace(/_/g, '.');

  // Resolve (ou cria) o grupo pelo JID. Um grupo pode chegar por mensagem antes
  // de aparecer numa sincronização — nesse caso entra só com o JID e ganha nome
  // no próximo sync.
  async function resolveGroup(jid: string, name?: string | null) {
    const { data: existing } = await admin
      .from('cs_groups')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('evolution_jid', jid)
      .maybeSingle();

    if (existing) {
      if (name && !existing.name) {
        await admin.from('cs_groups').update({ name }).eq('id', existing.id);
      }
      return existing.id as string;
    }

    const { data: created, error } = await admin
      .from('cs_groups')
      .insert({ organization_id: organizationId, evolution_jid: jid, name: name ?? null })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return created.id as string;
  }

  try {
    if (event === 'messages.upsert') {
      const data = payload.data as Record<string, unknown> | undefined;
      const records: Record<string, unknown>[] = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : Array.isArray(data?.messages)
          ? (data.messages as Record<string, unknown>[])
          : data
            ? [data]
            : [];

      let stored = 0;

      for (const record of records) {
        const key = record.key as Record<string, unknown> | undefined;
        const remoteJid = typeof key?.remoteJid === 'string' ? key.remoteJid : null;
        const messageId = typeof key?.id === 'string' ? key.id : null;
        if (!remoteJid || !messageId) continue;
        if (!remoteJid.endsWith('@g.us')) continue;

        const fromMe = key?.fromMe === true;
        const message = record.message as Record<string, unknown> | undefined;
        const text = extractBody(message);
        const mediaType = extractMediaType(message);
        const timestampRaw = record.messageTimestamp;
        const timestamp =
          typeof timestampRaw === 'number' ? timestampRaw : Number(timestampRaw ?? 0);
        const occurredAt =
          timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();

        const groupId = await resolveGroup(remoteJid);

        // `ignoreDuplicates` faz a reentrega do mesmo evento (webhook repete)
        // virar no-op: sem linha devolvida, nada de contar de novo nem somar
        // não-lida.
        const { data: insertedRows, error: upsertError } = await admin
          .from('cs_messages')
          .upsert(
            {
              organization_id: organizationId,
              group_id: groupId,
              evolution_message_id: messageId,
              direction: fromMe ? 'outbound' : 'inbound',
              sender_name: typeof record.pushName === 'string' ? record.pushName : null,
              sender_jid: typeof key?.participant === 'string' ? key.participant : null,
              body: text,
              media_type: mediaType,
              status: fromMe ? 'sent' : 'received',
              from_me: fromMe,
              occurred_at: occurredAt,
            },
            { onConflict: 'organization_id,evolution_message_id', ignoreDuplicates: true }
          )
          .select('id');
        if (upsertError) continue;
        if (!insertedRows || insertedRows.length === 0) continue;

        stored += 1;

        const preview = previewFor(text, mediaType);
        const groupUpdate: Record<string, unknown> = { last_message_at: occurredAt };
        if (preview) groupUpdate.last_message_preview = preview;
        await admin.from('cs_groups').update(groupUpdate).eq('id', groupId);

        if (!fromMe) {
          // Contador de não-lidas: quem abre a conversa no CRM zera.
          await admin.rpc('cs_increment_unread', { p_group_id: groupId }).then(
            () => undefined,
            () => undefined
          );
        }
      }

      return json({ received: true, stored });
    }

    if (event === 'groups.upsert' || event === 'groups.update') {
      const data = payload.data;
      const records: Record<string, unknown>[] = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : data
          ? [data as Record<string, unknown>]
          : [];

      let updated = 0;
      for (const record of records) {
        const jid = typeof record.id === 'string' ? record.id : null;
        if (!jid || !jid.endsWith('@g.us')) continue;

        const groupId = await resolveGroup(
          jid,
          typeof record.subject === 'string' ? record.subject : null
        );
        const patch: Record<string, unknown> = {};
        if (typeof record.subject === 'string') patch.name = record.subject;
        if (typeof record.desc === 'string') patch.description = record.desc;
        if (typeof record.pictureUrl === 'string') patch.avatar_url = record.pictureUrl;
        if (typeof record.size === 'number') patch.participant_count = record.size;

        if (Object.keys(patch).length > 0) {
          await admin.from('cs_groups').update(patch).eq('id', groupId);
          updated += 1;
        }
      }
      return json({ received: true, updated });
    }

    // Evento que não tratamos ainda: responde 200 pra Evolution não ficar
    // reenviando, mas deixa claro que foi ignorado.
    return json({ received: true, ignored: event || 'unknown' });
  } catch (e) {
    return json({ received: true, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
