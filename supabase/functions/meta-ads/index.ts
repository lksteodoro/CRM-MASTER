// Edge Function: meta-ads
//
// Duas ações via POST { action: 'test' | 'sync', projectId, since?, until? }:
//   test  → chama a Graph API para validar o access_token/ad_account_id salvos
//           e devolve nome/status da conta, sem gravar métricas.
//   sync  → busca insights diários (spend, impressions, clicks,
//           inline_link_clicks, reach, leads) num intervalo de datas e grava
//           em meta_insights_daily.
//
// Autorização: o cliente que chama esta função usa o JWT do usuário logado.
// A leitura de `meta_integrations` roda com esse JWT — a policy
// `meta_integrations_admin_all` só deixa ADMIN enxergar a linha, então isso
// já barra qualquer não-admin (ou usuário sem acesso ao projeto) antes de
// qualquer chamada à Meta. A gravação em `meta_insights_daily` usa a
// service_role key (só disponível aqui, nunca no browser), porque essa
// tabela não tem policy de INSERT/UPDATE para `authenticated` de propósito.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// v21 deixou de representar a versão usada atualmente pelo Gerenciador e
// começou a produzir diferenças/erros em campos de Insights. v24 mantém a
// integração numa versão suportada sem depender implicitamente da versão mais
// nova da Graph API.
const GRAPH_VERSION = 'v24.0';

interface MetaActionStat {
  action_type: string;
  value: string;
}

const INSIGHT_FIELDS = [
  'spend',
  'impressions',
  'clicks',
  'inline_link_clicks',
  'outbound_clicks',
  'reach',
  'frequency',
  'ctr',
  'cpc',
  'cpm',
  'actions',
  'action_values',
  'cost_per_action_type',
  'purchase_roas',
  'website_purchase_roas',
].join(',');

function actionValue(actions: MetaActionStat[] | undefined, priorities: string[]) {
  for (const type of priorities) {
    const match = actions?.find((action) => action.action_type === type);
    if (match) return Number(match.value ?? 0);
  }
  return 0;
}

function insightMetrics(row: {
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  reach?: string;
  frequency?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  outbound_clicks?: MetaActionStat[];
  actions?: MetaActionStat[];
  action_values?: MetaActionStat[];
  cost_per_action_type?: MetaActionStat[];
  purchase_roas?: MetaActionStat[];
  website_purchase_roas?: MetaActionStat[];
}) {
  const leads = actionValue(row.actions, [
    'onsite_conversion.lead_grouped',
    'lead',
    'offsite_conversion.fb_pixel_lead',
  ]);
  const purchases = actionValue(row.actions, [
    'omni_purchase',
    'offsite_conversion.fb_pixel_purchase',
    'purchase',
  ]);
  const purchaseValue = actionValue(row.action_values, [
    'omni_purchase',
    'offsite_conversion.fb_pixel_purchase',
    'purchase',
  ]);
  return {
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    link_clicks: Number(row.inline_link_clicks ?? 0),
    outbound_clicks: actionValue(row.outbound_clicks, ['outbound_click']),
    reach: Number(row.reach ?? 0),
    frequency: Number(row.frequency ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpc: Number(row.cpc ?? 0),
    cpm: Number(row.cpm ?? 0),
    leads,
    landing_page_views: actionValue(row.actions, ['landing_page_view']),
    post_engagement: actionValue(row.actions, ['post_engagement']),
    video_views: actionValue(row.actions, ['video_view']),
    thruplays: actionValue(row.actions, ['video_thruplay_watched_actions']),
    purchases,
    purchase_value: purchaseValue,
    messaging_conversations_started: actionValue(row.actions, [
      'onsite_conversion.messaging_conversation_started_7d',
      'messaging_conversation_started_7d',
    ]),
    purchase_roas: actionValue(row.purchase_roas, ['omni_purchase', 'purchase']) ||
      actionValue(row.website_purchase_roas, ['offsite_conversion.fb_pixel_purchase', 'purchase']),
    actions: row.actions ?? [],
    action_values: row.action_values ?? [],
    cost_per_action_type: row.cost_per_action_type ?? [],
  };
}

interface RequestBody {
  action?: 'test' | 'sync' | 'summary' | 'sync_entities' | 'list_campaigns';
  projectId?: string;
  since?: string;
  until?: string;
}

// O front-end chama esta função via `supabase.functions.invoke` a partir do
// navegador (fetch com Authorization: Bearer <jwt do usuário>), então o
// preflight OPTIONS precisa de resposta com CORS liberado, senão o browser
// bloqueia antes mesmo da requisição POST sair.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'missing_authorization' }, 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const { action, projectId } = body;
  if (
    !projectId ||
    (action !== 'test' && action !== 'sync' && action !== 'summary' && action !== 'sync_entities' && action !== 'list_campaigns')
  ) {
    return json({ error: 'invalid_request' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: integration, error: integrationError } = await callerClient
    .from('meta_integrations')
    .select('id, project_id, ad_account_id, access_token, selected_campaign_ids')
    .eq('project_id', projectId)
    .maybeSingle();

  if (integrationError) {
    return json({ error: integrationError.message }, 400);
  }
  if (!integration) {
    return json({ error: 'not_found_or_forbidden' }, 404);
  }

  const adAccountId = integration.ad_account_id.startsWith('act_')
    ? integration.ad_account_id
    : `act_${integration.ad_account_id}`;
  const token = integration.access_token as string;

  // Só a partir daqui usamos service_role — para gravar o resultado, não para
  // decidir se o chamador pode acessar (isso já foi resolvido pela RLS acima).
  const adminClient = createClient(supabaseUrl, serviceKey);

  if (action === 'test') {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}` +
      `?fields=name,account_status,currency&access_token=${encodeURIComponent(token)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.error) {
      const message = data.error?.message ?? 'Falha ao conectar com a Meta.';
      await adminClient
        .from('meta_integrations')
        .update({ status: 'ERROR', last_error: message })
        .eq('project_id', projectId);
      return json({ ok: false, error: message });
    }

    await adminClient
      .from('meta_integrations')
      .update({ status: 'CONNECTED', account_name: data.name ?? null, last_error: null })
      .eq('project_id', projectId);

    return json({
      ok: true,
      accountName: data.name,
      accountStatus: data.account_status,
      currency: data.currency,
    });
  }

  if (action === 'list_campaigns') {
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}/campaigns` +
      `?fields=id,name,status,objective&limit=500&access_token=${encodeURIComponent(token)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.error) {
      return json({ ok: false, error: data.error?.message ?? 'Falha ao listar campanhas.' });
    }

    return json({
      ok: true,
      campaigns: (data.data ?? []).map((c: { id: string; name: string; status: string; objective?: string }) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective ?? null,
      })),
    });
  }

  if (action === 'summary') {
    const selectedCampaignIds = new Set(integration.selected_campaign_ids ?? []);
    const until = body.until ?? new Date().toISOString().slice(0, 10);
    const since = body.since ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    const campaignFiltering = selectedCampaignIds.size > 0
      ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: Array.from(selectedCampaignIds) }]))}`
      : '';
    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}/insights` +
      `?fields=${INSIGHT_FIELDS}&time_range=${timeRange}&level=account` +
      '&action_report_time=conversion&use_account_attribution_setting=true' +
      campaignFiltering + `&access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok || payload.error) {
      return json({ ok: false, error: payload.error?.message ?? 'Falha ao consultar o resumo da Meta.' });
    }
    const insight = payload.data?.[0];
    return json({
      ok: true,
      since,
      until,
      metrics: insight ? insightMetrics(insight) : insightMetrics({}),
    });
  }

  if (action === 'sync_entities') {
    const selectedCampaignIds = new Set(integration.selected_campaign_ids ?? []);

    async function fetchAllPages(url: string): Promise<Record<string, unknown>[]> {
      const out: Record<string, unknown>[] = [];
      let next: string | null = url;
      for (let page = 0; page < 100 && next; page++) {
        const res = await fetch(next);
        const data = await res.json();
        if (!res.ok || data.error) break;
        out.push(...(data.data ?? []));
        next = data.paging?.next ?? null;
      }
      return out;
    }

    const entities: {
      project_id: string;
      entity_type: string;
      external_id: string;
      name: string;
      status: string | null;
      parent_external_id: string | null;
      thumbnail_url: string | null;
    }[] = [];

    const campaignsData = await fetchAllPages(
      `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}/campaigns?fields=id,name,status&limit=500&access_token=${encodeURIComponent(token)}`
    );
    for (const c of campaignsData as { id: string; name: string; status: string }[]) {
      if (selectedCampaignIds.size > 0 && !selectedCampaignIds.has(c.id)) continue;
      entities.push({
        project_id: projectId,
        entity_type: 'campaign',
        external_id: c.id,
        name: c.name,
        status: c.status ?? null,
        parent_external_id: null,
        thumbnail_url: null,
      });
    }

    const adsData = await fetchAllPages(
      `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}/ads?fields=id,name,status,campaign_id,adset_id,creative{thumbnail_url}&limit=500&access_token=${encodeURIComponent(token)}`
    );
    for (const a of adsData as {
      id: string;
      name: string;
      status: string;
      campaign_id: string;
      adset_id: string;
      creative?: { thumbnail_url?: string };
    }[]) {
      if (selectedCampaignIds.size > 0 && !selectedCampaignIds.has(a.campaign_id)) continue;
      entities.push({
        project_id: projectId,
        entity_type: 'ad',
        external_id: a.id,
        name: a.name,
        status: a.status ?? null,
        parent_external_id: a.adset_id ?? null,
        thumbnail_url: a.creative?.thumbnail_url ?? null,
      });
    }

    if (entities.length > 0) {
      const { error: entitiesError } = await adminClient
        .from('meta_entities')
        .upsert(entities, { onConflict: 'project_id,entity_type,external_id' });
      if (entitiesError) return json({ ok: false, error: entitiesError.message });
    }

    return json({ ok: true, entitiesSynced: entities.length });
  }

  // action === 'sync'
  const selectedCampaignIds = new Set(integration.selected_campaign_ids ?? []);
  const until = body.until ?? new Date().toISOString().slice(0, 10);
  const since =
    body.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const campaignFiltering = selectedCampaignIds.size > 0
    ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: Array.from(selectedCampaignIds) }]))}`
    : '';
  const attributionParams = '&action_report_time=conversion&use_account_attribution_setting=true';
  const insightsUrl =
    `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}/insights` +
    `?fields=${INSIGHT_FIELDS}` +
    `&time_range=${timeRange}&time_increment=1&level=account&limit=500` +
    attributionParams + campaignFiltering +
    `&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(insightsUrl);
  const data = await res.json();

  if (!res.ok || data.error) {
    const message = data.error?.message ?? 'Falha ao sincronizar com a Meta.';
    await adminClient
      .from('meta_integrations')
      .update({ status: 'ERROR', last_error: message })
      .eq('project_id', projectId);
    return json({ ok: false, error: message });
  }

  interface MetaInsightRow {
    date_start: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    inline_link_clicks?: string;
    reach?: string;
    frequency?: string;
    ctr?: string;
    cpc?: string;
    cpm?: string;
    outbound_clicks?: MetaActionStat[];
    actions?: MetaActionStat[];
    action_values?: MetaActionStat[];
    cost_per_action_type?: MetaActionStat[];
    purchase_roas?: MetaActionStat[];
    website_purchase_roas?: MetaActionStat[];
  }

  const rows = ((data.data ?? []) as MetaInsightRow[]).map((d) => ({
      project_id: projectId,
      date: d.date_start,
      ...insightMetrics(d),
    }));

  if (rows.length > 0) {
    const { error: upsertError } = await adminClient
      .from('meta_insights_daily')
      .upsert(rows, { onConflict: 'project_id,date' });

    if (upsertError) {
      await adminClient
        .from('meta_integrations')
        .update({ status: 'ERROR', last_error: upsertError.message })
        .eq('project_id', projectId);
      return json({ ok: false, error: upsertError.message });
    }
  }

  // Mesma janela de datas, agora quebrada por anúncio — é o que alimenta as
  // páginas de Campanhas e Anúncios com dados reais em vez do dataset mock.
  interface MetaAdInsightRow {
    date_start: string;
    campaign_id: string;
    campaign_name: string;
    adset_id?: string;
    adset_name?: string;
    ad_id: string;
    ad_name: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    inline_link_clicks?: string;
    reach?: string;
    frequency?: string;
    ctr?: string;
    cpc?: string;
    cpm?: string;
    outbound_clicks?: MetaActionStat[];
    actions?: MetaActionStat[];
    action_values?: MetaActionStat[];
    cost_per_action_type?: MetaActionStat[];
    purchase_roas?: MetaActionStat[];
    website_purchase_roas?: MetaActionStat[];
  }

  const adRows: {
    project_id: string;
    date: string;
    campaign_id: string;
    campaign_name: string;
    adset_id: string | null;
    adset_name: string | null;
    ad_id: string;
    ad_name: string;
    spend: number;
    impressions: number;
    clicks: number;
    link_clicks: number;
    outbound_clicks: number;
    reach: number;
    frequency: number;
    ctr: number;
    cpc: number;
    cpm: number;
    leads: number;
    landing_page_views: number;
    post_engagement: number;
    video_views: number;
    thruplays: number;
    purchases: number;
    purchase_value: number;
    messaging_conversations_started: number;
    purchase_roas: number;
    actions: MetaActionStat[];
    action_values: MetaActionStat[];
    cost_per_action_type: MetaActionStat[];
  }[] = [];

  let nextUrl: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}/insights` +
    `?fields=campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,${INSIGHT_FIELDS}` +
    `&time_range=${timeRange}&time_increment=1&level=ad&limit=500` +
    attributionParams + campaignFiltering +
    `&access_token=${encodeURIComponent(token)}`;

  // Proteção contra paginação circular sem truncar contas maiores em apenas
  // 5.000 linhas (o limite anterior de 10 páginas causava totais incompletos).
  for (let page = 0; page < 100 && nextUrl; page++) {
    const adRes = await fetch(nextUrl);
    const adData = await adRes.json();

    if (!adRes.ok || adData.error) {
      const message = adData.error?.message ?? 'Falha ao sincronizar anúncios.';
      await adminClient
        .from('meta_integrations')
        .update({ status: 'ERROR', last_error: message })
        .eq('project_id', projectId);
      return json({ ok: false, error: message });
    }

    for (const d of (adData.data ?? []) as MetaAdInsightRow[]) {
      adRows.push({
        project_id: projectId,
        date: d.date_start,
        campaign_id: d.campaign_id,
        campaign_name: d.campaign_name,
        adset_id: d.adset_id ?? null,
        adset_name: d.adset_name ?? null,
        ad_id: d.ad_id,
        ad_name: d.ad_name,
        ...insightMetrics(d),
      });
    }

    nextUrl = adData.paging?.next ?? null;
  }

  // Conta compartilhada entre projetos: só grava as campanhas marcadas em
  // Configurações. Sem seleção (padrão), sincroniza a conta inteira.
  const filteredAdRows =
    selectedCampaignIds.size > 0
      ? adRows.filter((r) => selectedCampaignIds.has(r.campaign_id))
      : adRows;

  // Limpa linhas de campanhas que já foram sincronizadas antes de existir (ou
  // depois de mudar) uma seleção — senão elas ficam "presas" na tabela até
  // sobrescrever por acaso, contaminando os totais deste projeto.
  if (selectedCampaignIds.size > 0) {
    const idList = Array.from(selectedCampaignIds).join(',');
    await adminClient
      .from('meta_ad_insights_daily')
      .delete()
      .eq('project_id', projectId)
      .not('campaign_id', 'in', `(${idList})`);
  }

  if (filteredAdRows.length > 0) {
    const { error: adUpsertError } = await adminClient
      .from('meta_ad_insights_daily')
      .upsert(filteredAdRows, { onConflict: 'project_id,date,ad_id' });

    if (adUpsertError) {
      await adminClient
        .from('meta_integrations')
        .update({ status: 'ERROR', last_error: adUpsertError.message })
        .eq('project_id', projectId);
      return json({ ok: false, error: adUpsertError.message });
    }
  }

  // Metadados (status real, criativo) saíram para a ação separada
  // 'sync_entities' — buscar tudo numa chamada só (métricas de 180 dias +
  // status + criativos de todas as campanhas/anúncios) estourava o tempo de
  // execução da function em contas grandes.

  await adminClient
    .from('meta_integrations')
    .update({
      status: 'CONNECTED',
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('project_id', projectId);

  return json({ ok: true, daysSynced: rows.length, adRowsSynced: filteredAdRows.length });
});
