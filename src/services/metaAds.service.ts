import { supabase } from '../integrations/supabase/client';
import type {
  MetaAdInsightDailyRow,
  MetaEntityRow,
  MetaInsightDailyRow,
  MetaIntegrationRow,
} from '../integrations/supabase/database.types';

export async function getIntegration(projectId: string): Promise<MetaIntegrationRow | null> {
  const { data, error } = await supabase
    .from('meta_integrations')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Data da última sincronização, sem carregar as credenciais da integração. */
export async function getMetaLastSyncedAt(projectId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('meta_integrations')
    .select('last_synced_at')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data?.last_synced_at ?? null;
}

/** Cria ou atualiza as credenciais da conta de anúncios do projeto. */
export async function saveIntegration(
  projectId: string,
  input: { adAccountId: string; accessToken: string }
): Promise<MetaIntegrationRow> {
  const { data: userData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('meta_integrations')
    .upsert(
      {
        project_id: projectId,
        ad_account_id: input.adAccountId.trim(),
        access_token: input.accessToken.trim(),
        status: 'DISCONNECTED',
        last_error: null,
        created_by: userData.user?.id ?? null,
      },
      { onConflict: 'project_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeIntegration(projectId: string): Promise<void> {
  const { error } = await supabase.from('meta_integrations').delete().eq('project_id', projectId);
  if (error) throw error;
}

interface TestConnectionResult {
  ok: boolean;
  error?: string;
  accountName?: string;
  accountStatus?: number;
  currency?: string;
}

export async function testConnection(projectId: string): Promise<TestConnectionResult> {
  const { data, error } = await supabase.functions.invoke<TestConnectionResult>('meta-ads', {
    body: { action: 'test', projectId },
  });
  if (error) throw error;
  return data ?? { ok: false, error: 'Sem resposta da função.' };
}

interface SyncResult {
  ok: boolean;
  error?: string;
  daysSynced?: number;
}

export async function syncInsights(
  projectId: string,
  range?: { since: string; until: string }
): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke<SyncResult>('meta-ads', {
    body: { action: 'sync', projectId, since: range?.since, until: range?.until },
  });
  if (error) throw error;
  return data ?? { ok: false, error: 'Sem resposta da função.' };
}

interface SyncEntitiesResult {
  ok: boolean;
  error?: string;
  entitiesSynced?: number;
}

/**
 * Status real (ACTIVE/PAUSED) e criativos — chamada separada de `syncInsights`
 * de propósito: juntar as duas numa function só estourava o tempo de execução
 * em contas com muitas campanhas/anúncios.
 */
export async function syncEntities(projectId: string): Promise<SyncEntitiesResult> {
  const { data, error } = await supabase.functions.invoke<SyncEntitiesResult>('meta-ads', {
    body: { action: 'sync_entities', projectId },
  });
  if (error) throw error;
  return data ?? { ok: false, error: 'Sem resposta da função.' };
}

export async function listDailyInsights(
  projectId: string,
  range: { since: string; until: string }
): Promise<MetaInsightDailyRow[]> {
  const { data, error } = await supabase
    .from('meta_insights_daily')
    .select('*')
    .eq('project_id', projectId)
    .gte('date', range.since)
    .lte('date', range.until)
    .order('date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface MetaCampaignSummary {
  id: string;
  name: string;
  status: string;
  objective: string | null;
}

export interface MetaAdsManagerMetrics {
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
  actions: unknown[];
  action_values: unknown[];
  cost_per_action_type: unknown[];
}

interface MetaSummaryResult {
  ok: boolean;
  error?: string;
  since?: string;
  until?: string;
  metrics?: MetaAdsManagerMetrics;
}

/** Resumo exato do período, sem somar alcance/frequência diários. */
export async function getMetaAdsManagerSummary(
  projectId: string,
  range: { since: string; until: string }
): Promise<MetaAdsManagerMetrics> {
  const { data, error } = await supabase.functions.invoke<MetaSummaryResult>('meta-ads', {
    body: { action: 'summary', projectId, since: range.since, until: range.until },
  });
  if (error) throw error;
  if (!data?.ok || !data.metrics) throw new Error(data?.error ?? 'A Meta não retornou o resumo do período.');
  return data.metrics;
}

interface ListCampaignsResult {
  ok: boolean;
  error?: string;
  campaigns?: MetaCampaignSummary[];
}

/** Todas as campanhas da conta de anúncios (não só as sincronizadas), para a seleção manual. */
export async function listMetaCampaigns(projectId: string): Promise<ListCampaignsResult> {
  const { data, error } = await supabase.functions.invoke<ListCampaignsResult>('meta-ads', {
    body: { action: 'list_campaigns', projectId },
  });
  if (error) throw error;
  return data ?? { ok: false, error: 'Sem resposta da função.' };
}

/** Define quais campanhas da conta pertencem a este projeto (conta compartilhada). */
export async function saveCampaignSelection(
  projectId: string,
  campaignIds: string[]
): Promise<void> {
  const { error } = await supabase
    .from('meta_integrations')
    .update({ selected_campaign_ids: campaignIds })
    .eq('project_id', projectId);
  if (error) throw error;
}

/** Status real (ACTIVE/PAUSED/...) e thumbnail de criativo, sincronizados por meta-ads. */
export async function listMetaEntities(
  projectId: string,
  entityType?: 'campaign' | 'ad'
): Promise<MetaEntityRow[]> {
  let query = supabase.from('meta_entities').select('*').eq('project_id', projectId);
  if (entityType) query = query.eq('entity_type', entityType);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Métricas reais quebradas por anúncio/campanha — alimenta Campanhas, Anúncios,
 * o card do Dashboard e a Visão Geral.
 *
 * Filtra por `selected_campaign_ids` quando o projeto tiver uma seleção
 * salva (conta de anúncios compartilhada entre projetos). Isso é reforço em
 * cima do filtro já aplicado na sincronização — cobre o caso de dados
 * sincronizados antes da seleção existir, que de outro modo ficariam
 * "presos" na tabela até a próxima sincronização.
 */
export async function listAdInsights(
  projectId: string,
  range: { since: string; until: string },
  selectedCampaignIds?: string[] | null
): Promise<MetaAdInsightDailyRow[]> {
  const integration = selectedCampaignIds === undefined ? await getIntegration(projectId) : null;

  let query = supabase
    .from('meta_ad_insights_daily')
    .select('*')
    .eq('project_id', projectId)
    .gte('date', range.since)
    .lte('date', range.until)
    .order('date', { ascending: true });

  const campaignIds = selectedCampaignIds ?? integration?.selected_campaign_ids;
  if (campaignIds && campaignIds.length > 0) {
    query = query.in('campaign_id', campaignIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
