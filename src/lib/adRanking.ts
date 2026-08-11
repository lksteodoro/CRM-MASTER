import { ads, campaigns } from '../data/mockData';

// Deterministic hash-based weight per ad id, so rankings stay stable across
// re-renders instead of depending on call order of a shared PRNG stream.
function weightForAdId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  const normalized = ((h >>> 0) % 1000) / 1000;
  return 0.3 + normalized;
}

export interface RankedAd {
  id: string;
  name: string;
  campaignName: string;
  creativeType: string;
  spend: number;
  leads: number;
  sales: number;
  cpl: number;
}

// Builds per-ad performance by distributing each campaign's period totals
// across its ads with weighted randomness (stand-in for Meta Ads Insights API).
export function buildAdPerformance(
  campaignIds: Set<string>,
  campaignTotals: Map<string, { spend: number; leads: number; sales: number }>
): RankedAd[] {
  const result: RankedAd[] = [];

  for (const campaign of campaigns) {
    if (!campaignIds.has(campaign.id)) continue;
    const totals = campaignTotals.get(campaign.id);
    if (!totals) continue;

    const campaignAds = ads.filter((a) => a.campaignId === campaign.id);
    if (campaignAds.length === 0) continue;

    const weights = campaignAds.map((a) => weightForAdId(a.id));
    const weightSum = weights.reduce((a, b) => a + b, 0);

    campaignAds.forEach((ad, idx) => {
      const share = weights[idx] / weightSum;
      const leads = Math.round(totals.leads * share);
      const spend = Math.round(totals.spend * share * 100) / 100;
      const sales = Math.round(totals.sales * share);
      result.push({
        id: ad.id,
        name: ad.name,
        campaignName: campaign.name,
        creativeType: ad.creativeType,
        spend,
        leads,
        sales,
        cpl: leads > 0 ? spend / leads : 0,
      });
    });
  }

  return result;
}
