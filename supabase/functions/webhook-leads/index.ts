// Edge Function: webhook-leads
//
// Endpoint GLOBAL (uma URL só para todos os clientes/projetos) para receber
// leads de fora do Leads Hub — CRM, site, landing page, automação.
//
// POST /functions/v1/webhook-leads
// Header: x-webhook-secret: <secret da integração>
// Body (JSON):
//   {
//     "project": "MBA_DIREITO",           // código externo do projeto (obrigatório)
//     "external_id": "lead_123",           // id no seu sistema (recomendado p/ idempotência)
//     "name": "João Silva",
//     "phone": "45999999999",
//     "email": "joao@email.com",
//     "utm_source": "facebook", "utm_medium": "paid", "utm_campaign": "...",
//     "utm_content": "...", "utm_term": "...",
//     "campaign_id": "...", "adset_id": "...", "ad_id": "...",
//     "status": "NOVO"
//   }
//
// Regra de blindagem (seção 165+ da documentação de produto): o payload bruto
// é salvo em `webhook_inbox` ANTES de qualquer tentativa de normalizar ou
// atribuir. Se identificar contato/gravar o lead_event falhar por qualquer
// motivo, o evento já está persistido — nada se perde, fica com status
// FAILED para revisão manual, em vez de simplesmente sumir.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function normalizePhone(phone: unknown): string | null {
  if (typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function pick(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function normalizeUtm(body: Record<string, unknown>) {
  return {
    utm_source: pick(body, 'utm_source', 'utmSource', 'source', 'source_utm'),
    utm_medium: pick(body, 'utm_medium', 'utmMedium', 'medium'),
    utm_campaign: pick(body, 'utm_campaign', 'utmCampaign', 'campaign', 'campaign_name'),
    utm_content: pick(body, 'utm_content', 'utmContent', 'content', 'creative', 'creative_name'),
    utm_term: pick(body, 'utm_term', 'utmTerm', 'term'),
  };
}

function attributionStatus(
  ids: { campaign_id: string | null; adset_id: string | null; ad_id: string | null },
  utm: ReturnType<typeof normalizeUtm>
): string {
  if (ids.campaign_id && ids.adset_id && ids.ad_id) return 'COMPLETE';
  const hasSomeId = ids.campaign_id || ids.adset_id || ids.ad_id;
  const hasUtm = utm.utm_source || utm.utm_medium || utm.utm_campaign || utm.utm_content || utm.utm_term;
  if (hasSomeId || hasUtm) return 'PARTIAL';
  return 'NONE';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const projectCode = typeof body.project === 'string' ? body.project : null;
  if (!projectCode) {
    return json({ error: 'missing_project_code' }, 400);
  }

  const secret = req.headers.get('x-webhook-secret');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: integration, error: integrationError } = await admin
    .from('project_integrations')
    .select('project_id, secret, active, projects(client_id)')
    .eq('external_code', projectCode)
    .eq('integration_type', 'webhook')
    .maybeSingle();

  if (integrationError) return json({ error: integrationError.message }, 400);
  if (!integration || !integration.active || integration.secret !== secret) {
    // Não persiste na inbox: sem projeto/segredo válido não há a quem atribuir
    // o evento, e persistir aqui abriria a inbox para spam não autenticado.
    return json({ error: 'unauthorized_or_unknown_project' }, 401);
  }

  const projectId = integration.project_id as string;
  const clientId = (integration.projects as unknown as { client_id: string }).client_id;

  const { data: inboxRow, error: inboxError } = await admin
    .from('webhook_inbox')
    .insert({
      client_id: clientId,
      project_id: projectId,
      event_type: 'lead',
      source: 'webhook',
      external_event_id: typeof body.external_id === 'string' ? body.external_id : null,
      payload_raw: body,
      processing_status: 'PROCESSING',
      processing_started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (inboxError) {
    // Isso aqui é grave (nem a blindagem funcionou) — mas ainda respondemos
    // com o erro claro em vez de fingir sucesso.
    return json({ error: inboxError.message }, 500);
  }

  try {
    const phone = normalizePhone(body.phone);
    const email = normalizeEmail(body.email);
    const name = typeof body.name === 'string' ? body.name : null;

    let contactId: string | null = null;

    if (phone) {
      const { data } = await admin
        .from('contacts')
        .select('id')
        .eq('client_id', clientId)
        .eq('normalized_phone', phone)
        .maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId && email) {
      const { data } = await admin
        .from('contacts')
        .select('id')
        .eq('client_id', clientId)
        .eq('normalized_email', email)
        .maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId) {
      const { data: newContact, error: contactError } = await admin
        .from('contacts')
        .insert({
          client_id: clientId,
          name,
          normalized_phone: phone,
          normalized_email: email,
          original_phone: typeof body.phone === 'string' ? body.phone : null,
          original_email: typeof body.email === 'string' ? body.email : null,
        })
        .select('id')
        .single();
      if (contactError) throw contactError;
      contactId = newContact.id;
    } else if (name) {
      // Atualiza o nome se um novo evento trouxer um valor (ex: primeiro
      // evento sem nome, segundo evento com nome preenchido).
      await admin.from('contacts').update({ name }).eq('id', contactId).is('name', null);
    }

    const utm = normalizeUtm(body);
    const ids = {
      campaign_id: typeof body.campaign_id === 'string' ? body.campaign_id : null,
      adset_id: typeof body.adset_id === 'string' ? body.adset_id : null,
      ad_id: typeof body.ad_id === 'string' ? body.ad_id : null,
    };

    const { data: leadEvent, error: leadError } = await admin
      .from('lead_events')
      .upsert(
        {
          contact_id: contactId,
          project_id: projectId,
          external_id: typeof body.external_id === 'string' ? body.external_id : null,
          ...ids,
          ...utm,
          source: 'webhook',
          status: (typeof body.status === 'string' ? body.status : 'NOVO').toUpperCase(),
          attribution_status: attributionStatus(ids, utm),
          raw_payload: body,
        },
        { onConflict: 'project_id,external_id' }
      )
      .select('id')
      .single();

    if (leadError) throw leadError;

    await admin
      .from('webhook_inbox')
      .update({
        processing_status: 'PROCESSED',
        processed_at: new Date().toISOString(),
        normalized_event_id: leadEvent.id,
      })
      .eq('id', inboxRow.id);

    return json({ received: true, event_id: inboxRow.id, lead_event_id: leadEvent.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from('webhook_inbox')
      .update({ processing_status: 'FAILED', last_error: message })
      .eq('id', inboxRow.id);

    // O payload já está seguro na inbox — respondemos "recebido", mesmo com
    // falha de processamento, porque é isso que a origem precisa saber
    // (não deve reenviar achando que perdemos o evento).
    return json({ received: true, event_id: inboxRow.id, processed: false, error: message });
  }
});
