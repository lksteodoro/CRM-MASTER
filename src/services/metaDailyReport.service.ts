import { supabase } from '../integrations/supabase/client';

// As tabelas do resumo diário (migrations 0054 e 0055) ainda não estão nos tipos gerados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TrackedCampaign {
  id: string;
  bm_id: string | null;
  bm_name: string | null;
  ad_account_id: string;
  ad_account_name: string | null;
  campaign_id: string;
  campaign_name: string | null;
  active: boolean;
}

export interface DailyCampaignRow {
  report_date: string;
  campaign_id: string;
  campaign_name: string | null;
  ad_account_id: string;
  ad_account_name: string | null;
  bm_name: string | null;
  currency: string | null;
  spend: number;
  leads: number;
  cost_per_lead: number | null;
  fetched_at: string;
}

export interface ReportState {
  last_run_at: string | null;
  last_report_date: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface CrmLeadsRow {
  ad_account_id: string;
  report_date: string;
  crm_leads: number;
}

export type TrackedCampaignInput = Omit<TrackedCampaign, 'id' | 'active'>;

export async function listTrackedCampaigns(): Promise<TrackedCampaign[]> {
  const { data, error } = await db
    .from('meta_report_campaigns')
    .select('id, bm_id, bm_name, ad_account_id, ad_account_name, campaign_id, campaign_name, active')
    .order('ad_account_name', { ascending: true })
    .order('campaign_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TrackedCampaign[];
}

export async function addTrackedCampaign(input: TrackedCampaignInput): Promise<void> {
  const { error } = await db.from('meta_report_campaigns').insert({ ...input, active: true });
  // 23505 = já estava na lista; tudo certo.
  if (error && error.code !== '23505') throw new Error(error.message);
}

export async function setTrackedCampaignActive(id: string, active: boolean): Promise<void> {
  const { error } = await db.from('meta_report_campaigns').update({ active }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function removeTrackedCampaign(id: string): Promise<void> {
  const { error } = await db.from('meta_report_campaigns').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Resultado diário por campanha desde `sinceDate` (AAAA-MM-DD). */
export async function listDailyRows(sinceDate: string): Promise<DailyCampaignRow[]> {
  const { data, error } = await db
    .from('meta_report_daily')
    .select('report_date, campaign_id, campaign_name, ad_account_id, ad_account_name, bm_name, currency, spend, leads, cost_per_lead, fetched_at')
    .gte('report_date', sinceDate)
    .order('report_date', { ascending: false })
    .limit(10000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DailyCampaignRow[]).map((row) => ({
    ...row,
    spend: Number(row.spend) || 0,
    leads: Number(row.leads) || 0,
    cost_per_lead: row.cost_per_lead == null ? null : Number(row.cost_per_lead),
  }));
}

export async function listCrmLeads(sinceDate: string): Promise<CrmLeadsRow[]> {
  const { data, error } = await db
    .from('meta_report_crm_leads')
    .select('ad_account_id, report_date, crm_leads')
    .gte('report_date', sinceDate)
    .limit(10000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CrmLeadsRow[]).map((row) => ({ ...row, crm_leads: Number(row.crm_leads) || 0 }));
}

/** Meta diária de leads por conta de anúncio. */
export async function listAccountGoals(): Promise<Record<string, number>> {
  const { data, error } = await db.from('meta_report_account_goals').select('ad_account_id, daily_goal_leads');
  if (error) throw new Error(error.message);
  const goals: Record<string, number> = {};
  for (const row of (data ?? []) as { ad_account_id: string; daily_goal_leads: number }[]) {
    goals[row.ad_account_id] = Number(row.daily_goal_leads) || 0;
  }
  return goals;
}

/** Lança os leads que o CRM registrou naquele dia. `null` limpa o valor. */
export async function setCrmLeads(adAccountId: string, reportDate: string, crmLeads: number | null): Promise<void> {
  const { error } = await db.rpc('meta_report_set_crm_leads', {
    p_ad_account_id: adAccountId,
    p_report_date: reportDate,
    p_crm_leads: crmLeads,
  });
  if (error) throw new Error(error.message);
}

export async function setAccountGoal(adAccountId: string, dailyGoalLeads: number | null): Promise<void> {
  const { error } = await db.rpc('meta_report_set_goal', {
    p_ad_account_id: adAccountId,
    p_daily_goal_leads: dailyGoalLeads,
  });
  if (error) throw new Error(error.message);
}

export async function getReportState(): Promise<ReportState | null> {
  const { data, error } = await db
    .from('meta_report_state')
    .select('last_run_at, last_report_date, last_status, last_error')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ReportState | null;
}

/**
 * Busca os últimos `days` dias (terminando ontem), com um dia por linha. É a
 * mesma rotina do agendamento das 8h30, que usa 3 dias.
 */
export async function runDailyReportNow(days = 3): Promise<{ status: string; campaigns: number; errors: string[] }> {
  const { data, error } = await supabase.functions.invoke<{
    results?: { ok: boolean; status?: string; campaigns?: number; error?: string; errors?: string[] }[];
    error?: string;
  }>('meta-daily-report', { body: { days } });
  if (error) throw new Error(error.message || 'Não foi possível gerar o resumo.');
  const result = data?.results?.[0];
  if (!result) throw new Error(data?.error || 'A função não devolveu resultado.');
  if (result.error) throw new Error(result.error);
  return { status: result.status ?? 'ok', campaigns: result.campaigns ?? 0, errors: result.errors ?? [] };
}
