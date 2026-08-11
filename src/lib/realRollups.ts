import type { MetaAdInsightDailyRow } from '../integrations/supabase/database.types';

export interface RealRollup {
  spend: number;
  leadsCount: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  reach: number;
  cpl: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
}

function aggregate(rows: MetaAdInsightDailyRow[]): RealRollup {
  const totals = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + Number(r.spend),
      leadsCount: acc.leadsCount + r.leads,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      linkClicks: acc.linkClicks + r.link_clicks,
      reach: acc.reach + r.reach,
    }),
    { spend: 0, leadsCount: 0, impressions: 0, clicks: 0, linkClicks: 0, reach: 0 }
  );
  return {
    ...totals,
    cpl: totals.leadsCount > 0 ? totals.spend / totals.leadsCount : 0,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0,
    frequency: totals.reach > 0 ? totals.impressions / totals.reach : 0,
  };
}

export interface RealCampaignRow extends RealRollup {
  id: string;
  name: string;
  adCount: number;
}

export function realCampaignRollups(rows: MetaAdInsightDailyRow[]): RealCampaignRow[] {
  const byCampaign = new Map<string, MetaAdInsightDailyRow[]>();
  for (const r of rows) {
    const list = byCampaign.get(r.campaign_id) ?? [];
    list.push(r);
    byCampaign.set(r.campaign_id, list);
  }
  return Array.from(byCampaign.entries()).map(([campaignId, campaignRows]) => ({
    id: campaignId,
    name: campaignRows[0].campaign_name,
    adCount: new Set(campaignRows.map((r) => r.ad_id)).size,
    ...aggregate(campaignRows),
  }));
}

export interface RealAdRow extends RealRollup {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  adsetName: string | null;
}

export function realAdRollups(rows: MetaAdInsightDailyRow[]): RealAdRow[] {
  const byAd = new Map<string, MetaAdInsightDailyRow[]>();
  for (const r of rows) {
    const list = byAd.get(r.ad_id) ?? [];
    list.push(r);
    byAd.set(r.ad_id, list);
  }
  return Array.from(byAd.entries()).map(([adId, adRows]) => ({
    id: adId,
    name: adRows[0].ad_name,
    campaignId: adRows[0].campaign_id,
    campaignName: adRows[0].campaign_name,
    adsetName: adRows[0].adset_name,
    ...aggregate(adRows),
  }));
}

export function realProjectRollup(rows: MetaAdInsightDailyRow[]): RealRollup {
  return aggregate(rows);
}
