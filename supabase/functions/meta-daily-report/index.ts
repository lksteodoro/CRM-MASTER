// Edge Function: meta-daily-report
//
// Gera o resumo diário (gasto, leads e custo por lead por dia) das campanhas
// que o operador marcou em `meta_report_campaigns`.
//
// Duas formas de chamar:
//   1. Cron (pg_cron às 8h30 de São Paulo): header `x-cron-secret`; roda para
//      todas as organizações com a Meta conectada. Busca os últimos 3 dias
//      (até ontem), porque a Meta ainda atribui leads com atraso.
//   2. Botão do painel: JWT do usuário; roda só para a organização dele.
//      Aceita `days` (1 a 31, terminando ontem) ou uma `date` específica.
//
// O token da Meta nunca sai do servidor: vem da conexão OAuth da agência.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v24.0';
const CRON_DAYS = 3;
const MAX_DAYS = 31;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function appsecretProof(token: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DAY = 24 * 3600_000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// "Ontem" na data de São Paulo (UTC-3, sem horário de verão).
function yesterdaySaoPaulo() {
  return isoDate(Date.now() - 3 * 3600_000 - DAY);
}

/** Datas de `since` a `until`, inclusive. */
function datesBetween(since: string, until: string) {
  const out: string[] = [];
  for (let ms = Date.parse(since); ms <= Date.parse(until) && out.length <= MAX_DAYS; ms += DAY) out.push(isoDate(ms));
  return out;
}

// `lead` é o total agregado da Meta (pixel + formulário). Os outros só entram
// se ele não existir, para nunca somar o mesmo lead duas vezes.
const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
function leadsFrom(actions: { action_type: string; value: string }[] | undefined) {
  for (const type of LEAD_TYPES) {
    const hit = actions?.find((a) => a.action_type === type);
    if (hit) return Math.round(Number(hit.value) || 0);
  }
  return 0;
}

type Tracked = {
  bm_name: string | null;
  ad_account_id: string;
  ad_account_name: string | null;
  campaign_id: string;
  campaign_name: string | null;
};

// deno-lint-ignore no-explicit-any
type Admin = any;

async function runForOrganization(admin: Admin, organizationId: string, since: string, until: string, appSecret: string | undefined) {
  const markState = (patch: Record<string, unknown>) =>
    admin.from('meta_report_state').upsert({ organization_id: organizationId, updated_at: new Date().toISOString(), ...patch });
  const fail = async (message: string) => {
    await markState({ last_run_at: new Date().toISOString(), last_status: 'error', last_error: message });
    return { organizationId, ok: false, error: message };
  };

  const { data: connection } = await admin
    .from('meta_oauth_connections')
    .select('id, status, expires_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!connection || connection.status !== 'CONNECTED') {
    return fail('A agência não está conectada à Meta. Reconecte em Configurações › APIs.');
  }
  if (connection.expires_at && new Date(connection.expires_at).getTime() < Date.now()) {
    return fail('A credencial da Meta expirou. Reconecte em Configurações › APIs.');
  }
  const { data: token } = await admin.rpc('meta_oauth_secret_get', { p_connection_id: connection.id });
  if (!token) return fail('Credencial da Meta ausente. Reconecte a agência.');

  const { data: tracked } = await admin
    .from('meta_report_campaigns')
    .select('bm_name, ad_account_id, ad_account_name, campaign_id, campaign_name')
    .eq('organization_id', organizationId)
    .eq('active', true);
  const campaigns = (tracked ?? []) as Tracked[];
  if (campaigns.length === 0) {
    await markState({ last_run_at: new Date().toISOString(), last_report_date: until, last_status: 'ok', last_error: null });
    return { organizationId, ok: true, campaigns: 0 };
  }

  const proof = appSecret ? await appsecretProof(token as string, appSecret) : null;
  const dates = datesBetween(since, until);
  const byAccount = new Map<string, Tracked[]>();
  for (const campaign of campaigns) {
    byAccount.set(campaign.ad_account_id, [...(byAccount.get(campaign.ad_account_id) ?? []), campaign]);
  }

  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const [accountId, list] of byAccount) {
    const params = new URLSearchParams({
      access_token: token as string,
      level: 'campaign',
      fields: 'campaign_id,campaign_name,spend,actions,account_currency',
      time_range: JSON.stringify({ since, until }),
      time_increment: '1',
      filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: list.map((c) => c.campaign_id) }]),
      limit: '500',
    });
    if (proof) params.set('appsecret_proof', proof);

    // deno-lint-ignore no-explicit-any
    const insightRows: any[] = [];
    try {
      let url: string | null = `${GRAPH}/act_${accountId}/insights?${params}`;
      for (let page = 0; url && page < 20; page++) {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        const payload = await response.json();
        if (payload.error) throw new Error(`[${payload.error.code}] ${payload.error.message}`);
        insightRows.push(...(payload.data ?? []));
        // O `next` da Meta traz o token embutido; aqui ele só é seguido no servidor.
        url = payload.paging?.next ?? null;
      }
    } catch (caught) {
      errors.push(`${list[0].ad_account_name ?? accountId}: ${caught instanceof Error ? caught.message : 'falha ao consultar a Meta'}`);
      continue;
    }

    // deno-lint-ignore no-explicit-any
    const byKey = new Map<string, any>(insightRows.map((row) => [`${row.date_start}|${row.campaign_id}`, row]));
    for (const date of dates) {
      for (const campaign of list) {
        const row = byKey.get(`${date}|${campaign.campaign_id}`);
        const spend = row ? Number(row.spend) || 0 : 0;
        const leads = row ? leadsFrom(row.actions) : 0;
        rows.push({
          organization_id: organizationId,
          report_date: date,
          campaign_id: campaign.campaign_id,
          campaign_name: row?.campaign_name ?? campaign.campaign_name,
          ad_account_id: accountId,
          ad_account_name: campaign.ad_account_name,
          bm_name: campaign.bm_name,
          currency: row?.account_currency ?? null,
          spend,
          leads,
          cost_per_lead: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
          fetched_at: new Date().toISOString(),
        });
      }
    }
  }

  if (rows.length > 0) {
    const { error } = await admin.from('meta_report_daily').upsert(rows, { onConflict: 'organization_id,report_date,campaign_id' });
    if (error) errors.push(`Gravação: ${error.message}`);
  }

  const status = errors.length === 0 ? 'ok' : rows.length > 0 ? 'partial' : 'error';
  await markState({
    last_run_at: new Date().toISOString(),
    last_report_date: until,
    last_status: status,
    last_error: errors.length ? errors.join(' | ').slice(0, 1000) : null,
  });
  return { organizationId, ok: status !== 'error', status, campaigns: campaigns.length, days: dates.length, errors };
}

/** Período pedido: uma data, ou os últimos `days` dias terminando ontem. */
function resolveRange(body: { date?: string; days?: number }, defaultDays: number) {
  const until = yesterdaySaoPaulo();
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return { since: body.date, until: body.date };
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(body.days) || defaultDays)));
  return { since: isoDate(Date.parse(until) - (days - 1) * DAY), until };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const appSecret = Deno.env.get('META_APP_SECRET');
  const admin = createClient(supabaseUrl, serviceKey);

  let body: { date?: string; days?: number } = {};
  try { body = await request.json(); } catch { /* corpo vazio */ }

  const cronSecret = request.headers.get('x-cron-secret');
  if (cronSecret) {
    const { data: config } = await admin.from('meta_report_cron_config').select('cron_secret').maybeSingle();
    if (!config || config.cron_secret !== cronSecret) return json({ error: 'unauthorized' }, 401);
    const { data: orgs } = await admin.from('meta_report_campaigns').select('organization_id').eq('active', true);
    const ids = [...new Set((orgs ?? []).map((o: { organization_id: string }) => o.organization_id))];
    const range = resolveRange(body, CRON_DAYS);
    const results = [];
    for (const id of ids) results.push(await runForOrganization(admin, id as string, range.since, range.until, appSecret));
    return json({ ...range, results });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await caller.auth.getUser();
  const user = userData.user;
  if (!user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await caller.from('profiles').select('organization_id, role').eq('id', user.id).maybeSingle();
  if (!profile?.organization_id) return json({ error: 'forbidden' }, 403);
  if (profile.role !== 'ADMIN') {
    const { data: permission } = await caller
      .from('agency_tool_permissions').select('tool_key').eq('user_id', user.id).eq('tool_key', 'meta_ads').maybeSingle();
    if (!permission) return json({ error: 'forbidden' }, 403);
  }
  const range = resolveRange(body, CRON_DAYS);
  const result = await runForOrganization(admin, profile.organization_id, range.since, range.until, appSecret);
  return json({ ...range, results: [result] });
});
