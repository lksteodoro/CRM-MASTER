// Edge Function: webhook-sales
//
// Endpoint GLOBAL para receber vendas/matrículas de fora do Leads Hub (CRM,
// planilha automatizada, sistema acadêmico). Mesma blindagem do
// webhook-leads: salva bruto na inbox antes de tentar associar.
//
// POST /functions/v1/webhook-sales
// Header: x-webhook-secret: <secret da integração>
// Body (JSON):
//   {
//     "project": "MBA_DIREITO",
//     "external_sale_id": "sale_992",
//     "name": "João Silva",           // opcional, ajuda a criar o contato se não existir
//     "phone": "45999999999",
//     "email": "joao@email.com",
//     "amount": 2497,
//     "payment_method": "cartao",
//     "status": "PAID",
//     "sold_at": "2026-08-10T12:00:00Z",
//     "seller_name": "Maria Vendedora"  // opcional, casa por nome com um vendedor ativo já cadastrado
//   }
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
    return json({ error: 'unauthorized_or_unknown_project' }, 401);
  }

  const projectId = integration.project_id as string;
  const clientId = (integration.projects as unknown as { client_id: string }).client_id;

  const { data: inboxRow, error: inboxError } = await admin
    .from('webhook_inbox')
    .insert({
      client_id: clientId,
      project_id: projectId,
      event_type: 'sale',
      source: 'webhook',
      external_event_id: typeof body.external_sale_id === 'string' ? body.external_sale_id : null,
      payload_raw: body,
      processing_status: 'PROCESSING',
      processing_started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (inboxError) {
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
      // Venda sem lead correspondente ainda registrado — cria o contato
      // mesmo assim. Melhor ter a venda "solta" do que perder o evento.
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
    }

    const { data: relatedLead } = await admin
      .from('lead_events')
      .select('id')
      .eq('contact_id', contactId)
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sellerName =
      typeof body.seller_name === 'string'
        ? body.seller_name
        : typeof body.seller === 'string'
          ? body.seller
          : null;
    let sellerId: string | null = null;
    if (sellerName && sellerName.trim()) {
      const { data: sellerMatch } = await admin
        .from('sellers')
        .select('id')
        .eq('client_id', clientId)
        .eq('active', true)
        .ilike('name', sellerName.trim())
        .maybeSingle();
      sellerId = sellerMatch?.id ?? null;
    }

    const { data: sale, error: saleError } = await admin
      .from('sales')
      .upsert(
        {
          contact_id: contactId,
          project_id: projectId,
          lead_event_id: relatedLead?.id ?? null,
          seller_id: sellerId,
          external_sale_id: typeof body.external_sale_id === 'string' ? body.external_sale_id : null,
          amount: typeof body.amount === 'number' ? body.amount : null,
          status: (typeof body.status === 'string' ? body.status : 'PAID').toUpperCase(),
          payment_method: typeof body.payment_method === 'string' ? body.payment_method : null,
          sold_at: typeof body.sold_at === 'string' ? body.sold_at : new Date().toISOString(),
          raw_payload: body,
        },
        { onConflict: 'project_id,external_sale_id' }
      )
      .select('id')
      .single();

    if (saleError) throw saleError;

    if (sellerId) {
      const { data: clientRow } = await admin
        .from('clients')
        .select('telao_token, telao_active')
        .eq('id', clientId)
        .maybeSingle();

      if (clientRow?.telao_active && clientRow.telao_token) {
        const { data: sellerRow } = await admin.from('sellers').select('name').eq('id', sellerId).maybeSingle();
        // Best-effort: o telão em tempo real é um bônus, nunca pode derrubar o
        // registro da venda se o broadcast falhar.
        fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: serviceKey },
          body: JSON.stringify({
            messages: [
              {
                topic: `telao:${clientRow.telao_token}`,
                event: 'sale',
                payload: {
                  sellerName: sellerRow?.name ?? 'Vendedor',
                  amount: typeof body.amount === 'number' ? body.amount : 0,
                },
              },
            ],
          }),
        }).catch(() => {});
      }
    }

    await admin
      .from('webhook_inbox')
      .update({
        processing_status: 'PROCESSED',
        processed_at: new Date().toISOString(),
        normalized_event_id: sale.id,
      })
      .eq('id', inboxRow.id);

    return json({ received: true, event_id: inboxRow.id, sale_id: sale.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from('webhook_inbox')
      .update({ processing_status: 'FAILED', last_error: message })
      .eq('id', inboxRow.id);

    return json({ received: true, event_id: inboxRow.id, processed: false, error: message });
  }
});
