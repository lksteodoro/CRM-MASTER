// Edge Function: cs-evolution
//
// Ponte entre o Consumer Success e a Evolution API (WhatsApp). Todas as
// chamadas à Evolution passam por aqui — a api_key mora em `cs_integration` e
// nunca chega ao navegador.
//
// POST /functions/v1/cs-evolution   Authorization: Bearer <jwt do usuário>
//   { action: 'get_config' }
//   { action: 'save_config', base_url, api_key, instance_name }   (admin)
//   { action: 'set_webhook' }                                      (admin)
//   { action: 'test' }
//   { action: 'sync_groups' }
//   { action: 'send_message', group_id, body }
//   { action: 'fetch_history', group_id, limit? }
//   { action: 'sync_participants', group_id }
//
// Autorização: o JWT identifica o usuário; `can_use_consumer_success()` diz se
// ele tem a ferramenta liberada (admin sempre tem). As ações que mexem na
// configuração exigem ADMIN.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

interface Integration {
  id: string;
  organization_id: string;
  base_url: string;
  api_key: string;
  instance_name: string;
  webhook_secret: string;
  connected: boolean;
  last_synced_at: string | null;
}

/** Remove barra final pra não gerar URL com `//`. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function evolutionFetch(
  integration: Pick<Integration, 'base_url' | 'api_key'>,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${normalizeBaseUrl(integration.base_url)}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: integration.api_key,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // resposta não-JSON: mantém o texto cru pra aparecer no erro
  }
  return { ok: response.ok, status: response.status, data };
}

function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.length > 0) return data.slice(0, 500);
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const candidate = record.message ?? record.error ?? record.response;
    if (typeof candidate === 'string') return candidate;
    return JSON.stringify(record).slice(0, 500);
  }
  return fallback;
}

/** Extrai o texto de qualquer um dos formatos de mensagem do WhatsApp. */
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : null;
  if (!action) return json({ error: 'missing_action' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: 'invalid_token' }, 401);
  const userId = userData.user.id;

  const { data: profile, error: profileError } = await caller
    .from('profiles')
    .select('role, organization_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) return json({ error: profileError.message }, 400);
  if (!profile?.organization_id) return json({ error: 'profile_without_organization' }, 403);

  const { data: allowed, error: allowedError } = await caller.rpc('can_use_consumer_success');
  if (allowedError) return json({ error: allowedError.message }, 400);
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  const organizationId = profile.organization_id as string;
  const isAdmin = profile.role === 'ADMIN';

  async function loadIntegration(): Promise<Integration | null> {
    const { data, error } = await admin
      .from('cs_integration')
      .select('id, organization_id, base_url, api_key, instance_name, webhook_secret, connected, last_synced_at')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Integration | null) ?? null;
  }

  function publicConfig(integration: Integration | null) {
    if (!integration) return { configured: false };
    return {
      configured: true,
      base_url: integration.base_url,
      instance_name: integration.instance_name,
      connected: integration.connected,
      last_synced_at: integration.last_synced_at,
      webhook_url: `${supabaseUrl}/functions/v1/cs-webhook?secret=${integration.webhook_secret}`,
    };
  }

  try {
    // -----------------------------------------------------------------------
    if (action === 'get_config') {
      const integration = await loadIntegration();
      return json(publicConfig(integration));
    }

    // -----------------------------------------------------------------------
    if (action === 'save_config') {
      if (!isAdmin) return json({ error: 'admin_required' }, 403);

      const baseUrl = typeof body.base_url === 'string' ? normalizeBaseUrl(body.base_url) : '';
      const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
      const instanceName = typeof body.instance_name === 'string' ? body.instance_name.trim() : '';
      if (!baseUrl || !apiKey || !instanceName) return json({ error: 'missing_fields' }, 400);

      const check = await evolutionFetch(
        { base_url: baseUrl, api_key: apiKey },
        `/instance/connectionState/${encodeURIComponent(instanceName)}`
      );
      const connected =
        check.ok &&
        JSON.stringify(check.data).includes('open'); // Evolution devolve state: 'open' quando conectado

      const existing = await loadIntegration();
      const payload = {
        organization_id: organizationId,
        base_url: baseUrl,
        api_key: apiKey,
        instance_name: instanceName,
        connected,
      };

      const { error: saveError } = existing
        ? await admin.from('cs_integration').update(payload).eq('id', existing.id)
        : await admin.from('cs_integration').insert(payload);
      if (saveError) return json({ error: saveError.message }, 400);

      const integration = await loadIntegration();
      return json({
        ...publicConfig(integration),
        evolution_ok: check.ok,
        evolution_status: check.status,
        evolution_response: check.data,
      });
    }

    // -----------------------------------------------------------------------
    const integration = await loadIntegration();
    if (!integration) return json({ error: 'not_configured' }, 400);

    // -----------------------------------------------------------------------
    if (action === 'test') {
      const check = await evolutionFetch(
        integration,
        `/instance/connectionState/${encodeURIComponent(integration.instance_name)}`
      );
      const connected = check.ok && JSON.stringify(check.data).includes('open');
      await admin.from('cs_integration').update({ connected }).eq('id', integration.id);
      return json({ ok: check.ok, connected, status: check.status, response: check.data });
    }

    // -----------------------------------------------------------------------
    if (action === 'set_webhook') {
      if (!isAdmin) return json({ error: 'admin_required' }, 403);

      const webhookUrl = `${supabaseUrl}/functions/v1/cs-webhook?secret=${integration.webhook_secret}`;
      const events = ['MESSAGES_UPSERT', 'GROUPS_UPSERT', 'GROUP_UPDATE'];
      const path = `/webhook/set/${encodeURIComponent(integration.instance_name)}`;

      // v2 aninha em `webhook`; v1 usa o corpo achatado. Tenta o v2 e cai pro v1.
      let result = await evolutionFetch(integration, path, {
        method: 'POST',
        body: JSON.stringify({ webhook: { enabled: true, url: webhookUrl, events, webhookByEvents: false, webhookBase64: false } }),
      });
      if (!result.ok) {
        result = await evolutionFetch(integration, path, {
          method: 'POST',
          body: JSON.stringify({ enabled: true, url: webhookUrl, events, webhook_by_events: false }),
        });
      }

      if (!result.ok) {
        return json(
          { error: errorMessage(result.data, 'Não foi possível configurar o webhook na Evolution.'), status: result.status },
          400
        );
      }
      return json({ ok: true, webhook_url: webhookUrl, response: result.data });
    }

    // -----------------------------------------------------------------------
    if (action === 'sync_groups') {
      const result = await evolutionFetch(
        integration,
        `/group/fetchAllGroups/${encodeURIComponent(integration.instance_name)}?getParticipants=false`
      );
      if (!result.ok) {
        return json(
          { error: errorMessage(result.data, 'Não foi possível buscar os grupos na Evolution.'), status: result.status },
          400
        );
      }

      const raw = Array.isArray(result.data)
        ? result.data
        : ((result.data as Record<string, unknown>)?.groups as unknown[]) ?? [];

      const rows = raw
        .map((item) => item as Record<string, unknown>)
        .filter((item) => typeof item.id === 'string' && (item.id as string).endsWith('@g.us'))
        .map((item) => ({
          organization_id: organizationId,
          evolution_jid: item.id as string,
          name: typeof item.subject === 'string' ? item.subject : null,
          description: typeof item.desc === 'string' ? item.desc : null,
          avatar_url: typeof item.pictureUrl === 'string' ? item.pictureUrl : null,
          participant_count:
            typeof item.size === 'number'
              ? item.size
              : Array.isArray(item.participants)
                ? (item.participants as unknown[]).length
                : null,
        }));

      if (rows.length > 0) {
        // Só campos vindos da Evolution: is_managed/client_id são escolha do
        // usuário no CRM e não podem ser sobrescritos pela sincronização.
        const { error: upsertError } = await admin
          .from('cs_groups')
          .upsert(rows, { onConflict: 'organization_id,evolution_jid' });
        if (upsertError) return json({ error: upsertError.message }, 400);
      }

      await admin
        .from('cs_integration')
        .update({ last_synced_at: new Date().toISOString(), connected: true })
        .eq('id', integration.id);

      return json({ ok: true, synced: rows.length });
    }

    // -----------------------------------------------------------------------
    if (action === 'send_message') {
      const groupId = typeof body.group_id === 'string' ? body.group_id : null;
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      if (!groupId || !text) return json({ error: 'missing_fields' }, 400);

      const { data: group, error: groupError } = await admin
        .from('cs_groups')
        .select('id, evolution_jid, organization_id')
        .eq('id', groupId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (groupError) return json({ error: groupError.message }, 400);
      if (!group) return json({ error: 'group_not_found' }, 404);

      const result = await evolutionFetch(
        integration,
        `/message/sendText/${encodeURIComponent(integration.instance_name)}`,
        { method: 'POST', body: JSON.stringify({ number: group.evolution_jid, text }) }
      );

      if (!result.ok) {
        return json(
          { error: errorMessage(result.data, 'A Evolution recusou o envio.'), status: result.status },
          400
        );
      }

      const responseData = result.data as Record<string, unknown>;
      const key = responseData?.key as Record<string, unknown> | undefined;
      const messageId = typeof key?.id === 'string' ? key.id : null;

      const { data: inserted, error: insertError } = await admin
        .from('cs_messages')
        .upsert(
          {
            organization_id: organizationId,
            group_id: group.id,
            evolution_message_id: messageId,
            direction: 'outbound',
            body: text,
            status: 'sent',
            sent_by: userId,
            from_me: true,
            occurred_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,evolution_message_id' }
        )
        .select('*')
        .maybeSingle();
      if (insertError) return json({ error: insertError.message }, 400);

      await admin
        .from('cs_groups')
        .update({ last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 160) })
        .eq('id', group.id);

      return json({ ok: true, message: inserted });
    }

    // -----------------------------------------------------------------------
    if (action === 'fetch_history') {
      const groupId = typeof body.group_id === 'string' ? body.group_id : null;
      const limit = typeof body.limit === 'number' ? Math.min(body.limit, 200) : 50;
      if (!groupId) return json({ error: 'missing_fields' }, 400);

      const { data: group, error: groupError } = await admin
        .from('cs_groups')
        .select('id, evolution_jid')
        .eq('id', groupId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (groupError) return json({ error: groupError.message }, 400);
      if (!group) return json({ error: 'group_not_found' }, 404);

      const result = await evolutionFetch(
        integration,
        `/chat/findMessages/${encodeURIComponent(integration.instance_name)}`,
        {
          method: 'POST',
          body: JSON.stringify({ where: { key: { remoteJid: group.evolution_jid } }, limit }),
        }
      );

      if (!result.ok) {
        return json(
          { error: errorMessage(result.data, 'Não foi possível buscar o histórico na Evolution.'), status: result.status },
          400
        );
      }

      const payload = result.data as Record<string, unknown>;
      const records = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.messages)
          ? (payload.messages as unknown[])
          : Array.isArray((payload?.messages as Record<string, unknown>)?.records)
            ? ((payload.messages as Record<string, unknown>).records as unknown[])
            : [];

      const rows = records
        .map((item) => item as Record<string, unknown>)
        .map((item) => {
          const key = item.key as Record<string, unknown> | undefined;
          const messageId = typeof key?.id === 'string' ? key.id : null;
          if (!messageId) return null;
          const fromMe = key?.fromMe === true;
          const message = item.message as Record<string, unknown> | undefined;
          const timestamp =
            typeof item.messageTimestamp === 'number'
              ? item.messageTimestamp
              : Number(item.messageTimestamp ?? 0);

          return {
            organization_id: organizationId,
            group_id: group.id,
            evolution_message_id: messageId,
            direction: fromMe ? 'outbound' : 'inbound',
            sender_name: typeof item.pushName === 'string' ? item.pushName : null,
            sender_jid: typeof key?.participant === 'string' ? key.participant : null,
            body: extractBody(message),
            media_type: extractMediaType(message),
            status: fromMe ? 'sent' : 'received',
            from_me: fromMe,
            occurred_at: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length > 0) {
        const { error: upsertError } = await admin
          .from('cs_messages')
          .upsert(rows, { onConflict: 'organization_id,evolution_message_id' });
        if (upsertError) return json({ error: upsertError.message }, 400);
      }

      return json({ ok: true, imported: rows.length });
    }

    // -----------------------------------------------------------------------
    // Busca (sob demanda) a foto de perfil de quem falou no grupo. É chamada
    // quando o inbox abre uma conversa; só olha os JIDs sem foto ou com a
    // última checagem há mais de uma semana (a URL da Evolution expira).
    if (action === 'sync_participants') {
      const groupId = typeof body.group_id === 'string' ? body.group_id : null;
      if (!groupId) return json({ error: 'missing_fields' }, 400);

      const { data: group, error: groupError } = await admin
        .from('cs_groups')
        .select('id')
        .eq('id', groupId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (groupError) return json({ error: groupError.message }, 400);
      if (!group) return json({ error: 'group_not_found' }, 404);

      const { data: senderRows, error: sendersError } = await admin
        .from('cs_messages')
        .select('sender_jid')
        .eq('organization_id', organizationId)
        .eq('group_id', groupId)
        .eq('from_me', false)
        .not('sender_jid', 'is', null)
        .limit(2000);
      if (sendersError) return json({ error: sendersError.message }, 400);

      const jids = [
        ...new Set(
          (senderRows ?? [])
            .map((row) => (row as { sender_jid: string | null }).sender_jid)
            .filter((jid): jid is string => typeof jid === 'string' && jid.length > 0)
        ),
      ];
      if (jids.length === 0) return json({ ok: true, checked: 0, updated: 0 });

      const { data: known, error: knownError } = await admin
        .from('cs_participants')
        .select('jid, avatar_url, avatar_checked_at')
        .eq('organization_id', organizationId)
        .in('jid', jids);
      if (knownError) return json({ error: knownError.message }, 400);

      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const knownByJid = new Map(
        (known ?? []).map((row) => [
          (row as { jid: string }).jid,
          row as { avatar_url: string | null; avatar_checked_at: string | null },
        ])
      );

      const stale = jids.filter((jid) => {
        const row = knownByJid.get(jid);
        if (!row) return true;
        if (!row.avatar_checked_at) return true;
        return new Date(row.avatar_checked_at).getTime() < weekAgo;
      });

      // Limite por chamada pra não estourar o tempo da função em grupos grandes.
      const batch = stale.slice(0, 40);
      let updated = 0;
      const nowIso = new Date().toISOString();

      for (const jid of batch) {
        let avatarUrl: string | null = null;
        try {
          const pic = await evolutionFetch(
            integration,
            `/chat/fetchProfilePictureUrl/${encodeURIComponent(integration.instance_name)}`,
            { method: 'POST', body: JSON.stringify({ number: jid }) }
          );
          if (pic.ok && pic.data && typeof pic.data === 'object') {
            const candidate = (pic.data as Record<string, unknown>).profilePictureUrl;
            if (typeof candidate === 'string' && candidate.startsWith('http')) {
              avatarUrl = candidate;
            }
          }
        } catch {
          // rede/timeout: deixa pra próxima abertura da conversa
        }

        const { error: upsertError } = await admin.from('cs_participants').upsert(
          {
            organization_id: organizationId,
            jid,
            avatar_url: avatarUrl,
            avatar_checked_at: nowIso,
          },
          { onConflict: 'organization_id,jid' }
        );
        if (!upsertError && avatarUrl) updated += 1;
      }

      return json({ ok: true, checked: batch.length, updated });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
