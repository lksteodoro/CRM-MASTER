import { supabase } from '../integrations/supabase/client';

// As tabelas do resumo diário (migration 0054) ainda não estão nos tipos gerados.
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

/** Datas que já têm resumo gravado, da mais recente para a mais antiga. */
export async function listReportDates(): Promise<string[]> {
  const { data, error } = await db
    .from('meta_report_daily')
    .select('report_date')
    .order('report_date', { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as { report_date: string }[]).map((row) => row.report_date))].slice(0, 90);
}

export async function getDailyReport(date: string): Promise<DailyCampaignRow[]> {
  const { data, error } = await db
    .from('meta_report_daily')
    .select('report_date, campaign_id, campaign_name, ad_account_id, ad_account_name, bm_name, currency, spend, leads, cost_per_lead, fetched_at')
    .eq('report_date', date);
  if (error) throw new Error(error.message);
  return ((data ?? []) as DailyCampaignRow[]).map((row) => ({
    ...row,
    spend: Number(row.spend) || 0,
    leads: Number(row.leads) || 0,
    cost_per_lead: row.cost_per_lead == null ? null : Number(row.cost_per_lead),
  }));
}

export async function getReportState(): Promise<ReportState | null> {
  const { data, error } = await db
    .from('meta_report_state')
    .select('last_run_at, last_report_date, last_status, last_error')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ReportState | null;
}

/** Gera o resumo agora (a mesma rotina que roda às 8h30). Sem data = ontem. */
export async function runDailyReportNow(date?: string): Promise<{ status: string; campaigns: number; errors: string[] }> {
  const { data, error } = await supabase.functions.invoke<{
    results?: { ok: boolean; status?: string; campaigns?: number; error?: string; errors?: string[] }[];
    error?: string;
  }>('meta-daily-report', { body: date ? { date } : {} });
  if (error) throw new Error(error.message || 'Não foi possível gerar o resumo.');
  const result = data?.results?.[0];
  if (!result) throw new Error(data?.error || 'A função não devolveu resultado.');
  if (result.error) throw new Error(result.error);
  return { status: result.status ?? 'ok', campaigns: result.campaigns ?? 0, errors: result.errors ?? [] };
}

export interface CurrencyTotals {
  currency: string;
  spend: number;
  leads: number;
  costPerLead: number | null;
}

/**
 * Totais do dia por moeda (contas em reais e em dólar não se somam). O custo por
 * lead é o gasto total dividido pelos leads totais, e não a média dos custos.
 */
export function summarizeByCurrency(rows: DailyCampaignRow[]): CurrencyTotals[] {
  const byCurrency = new Map<string, { spend: number; leads: number }>();
  for (const row of rows) {
    const key = row.currency || 'BRL';
    const current = byCurrency.get(key) ?? { spend: 0, leads: 0 };
    current.spend += row.spend;
    current.leads += row.leads;
    byCurrency.set(key, current);
  }
  return [...byCurrency.entries()].map(([currency, total]) => ({
    currency,
    spend: total.spend,
    leads: total.leads,
    costPerLead: total.leads > 0 ? total.spend / total.leads : null,
  }));
}
