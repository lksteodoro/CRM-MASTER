// Edge Function: crm-webhook
//
// Endpoint público (sem JWT de usuário — não faz sentido pedir login a um
// CRM/site externo) para importar leads e atualizações de status (ex:
// "matriculado") vindos de fora do Leads Hub.
//
// Chamada: POST /functions/v1/crm-webhook?project=<project_id>&token=<secret>
// Corpo (JSON), todos os campos opcionais exceto quando indicado:
//   {
//     "external_id": "id do lead no seu sistema", // recomendado — sem ele,
//                                                   // cada chamada cria um
//                                                   // lead novo em vez de
//                                                   // atualizar um existente
//     "name": "...", "email": "...", "phone": "...",
//     "utm_source": "...", "utm_medium": "...", "utm_campaign": "...",
//     "utm_content": "...", "utm_term": "...",
//     "campaign_id": "...", "ad_id": "...",     // ids reais da Meta, se souber
//     "status": "NOVO" | "EM_ATENDIMENTO" | "MATRICULADO" | "PERDIDO" | outro,
//     "sale_value": 1234.56
//   }
//
// Autenticação: o token vem da tabela `project_webhooks`, gerado em
// Configurações → Webhook. Qualquer requisição sem o token certo do projeto
// certo é rejeitada — isso substitui o JWT que um usuário logado teria.
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

interface LeadPayload {
  external_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  campaign_id?: string;
  ad_id?: string;
  status?: string;
  sale_value?: number;
}

const ENROLLED_STATUSES = new Set(['MATRICULADO', 'MATRICULADA', 'ENROLLED', 'WON']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get('project');
  const token = url.searchParams.get('token');

  if (!projectId || !token) {
    return json({ error: 'missing_project_or_token' }, 400);
  }

  let payload: LeadPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: webhook, error: webhookError } = await adminClient
    .from('project_webhooks')
    .select('project_id, secret_token')
    .eq('project_id', projectId)
    .maybeSingle();

  if (webhookError) {
    return json({ error: webhookError.message }, 400);
  }
  if (!webhook || webhook.secret_token !== token) {
    return json({ error: 'invalid_token' }, 401);
  }

  const status = (payload.status ?? 'NOVO').toUpperCase();
  const isEnrolled = ENROLLED_STATUSES.has(status);

  const row = {
    project_id: projectId,
    external_id: payload.external_id ?? null,
    name: payload.name ?? null,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    utm_source: payload.utm_source ?? null,
    utm_medium: payload.utm_medium ?? null,
    utm_campaign: payload.utm_campaign ?? null,
    utm_content: payload.utm_content ?? null,
    utm_term: payload.utm_term ?? null,
    campaign_id: payload.campaign_id ?? null,
    ad_id: payload.ad_id ?? null,
    status,
    sale_value: payload.sale_value ?? null,
    enrolled_at: isEnrolled ? new Date().toISOString() : null,
    raw_payload: payload,
  };

  const { data, error } = payload.external_id
    ? await adminClient
        .from('crm_leads')
        .upsert(row, { onConflict: 'project_id,external_id' })
        .select('id')
        .single()
    : await adminClient.from('crm_leads').insert(row).select('id').single();

  if (error) {
    return json({ error: error.message }, 400);
  }

  return json({ ok: true, id: data.id });
});
