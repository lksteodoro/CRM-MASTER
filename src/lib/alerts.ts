import { campaigns, ads, dailyMetrics } from '../data/mockData';
import { leads } from '../data/leadSalesData';
import { campaignsForProject } from './rollups';
import { computeMonthPacing } from './pacing';
import type { DateRange } from '../types';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  link?: string;
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgoRange(daysBack: number, offset = 0): DateRange {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - offset);
  const start = new Date(end);
  start.setDate(start.getDate() - (daysBack - 1));
  return { preset: 'custom', start: fmt(start), end: fmt(end) };
}

function spendLeadsInRange(campaignId: string, range: DateRange) {
  const rows = dailyMetrics.filter(
    (d) => d.campaignId === campaignId && d.date >= range.start && d.date <= range.end
  );
  return {
    spend: rows.reduce((a, r) => a + r.spend, 0),
    leads: rows.reduce((a, r) => a + r.leads, 0),
    impressions: rows.reduce((a, r) => a + r.impressions, 0),
    reach: rows.reduce((a, r) => a + r.reach, 0),
  };
}

// Scans the project's recent activity for issues that would normally require
// opening Ads Manager to notice: CPL spikes, ads that went silent, creative
// fatigue (high frequency), and monthly goal pacing risk.
export function generateAlerts(projectId: string): Alert[] {
  const alerts: Alert[] = [];
  const projectCampaigns = campaignsForProject(projectId);

  const last3 = daysAgoRange(3);
  const prev3 = daysAgoRange(3, 3);
  const last7 = daysAgoRange(7);
  const last14 = daysAgoRange(11, 3); // days 4–14 ago

  for (const campaign of projectCampaigns) {
    if (campaign.status !== 'active') continue;

    // 1) CPL spike
    const cur = spendLeadsInRange(campaign.id, last3);
    const prev = spendLeadsInRange(campaign.id, prev3);
    const curCpl = cur.leads > 0 ? cur.spend / cur.leads : 0;
    const prevCpl = prev.leads > 0 ? prev.spend / prev.leads : 0;
    if (prevCpl > 0 && curCpl > 0) {
      const change = (curCpl - prevCpl) / prevCpl;
      if (change > 0.7) {
        alerts.push({
          id: `cpl-${campaign.id}`,
          severity: 'critical',
          title: `CPL disparou em "${campaign.name}"`,
          description: `Custo por lead subiu ${Math.round(change * 100)}% nos últimos 3 dias (de R$ ${prevCpl.toFixed(2)} para R$ ${curCpl.toFixed(2)}).`,
          link: `/campanhas/${campaign.id}`,
        });
      } else if (change > 0.35) {
        alerts.push({
          id: `cpl-${campaign.id}`,
          severity: 'warning',
          title: `CPL subindo em "${campaign.name}"`,
          description: `Custo por lead subiu ${Math.round(change * 100)}% nos últimos 3 dias (de R$ ${prevCpl.toFixed(2)} para R$ ${curCpl.toFixed(2)}).`,
          link: `/campanhas/${campaign.id}`,
        });
      }
    }

    // 2) Creative fatigue (high frequency)
    const week = spendLeadsInRange(campaign.id, last7);
    const frequency = week.reach > 0 ? week.impressions / week.reach : 0;
    if (frequency >= 4.5) {
      alerts.push({
        id: `freq-${campaign.id}`,
        severity: 'critical',
        title: `Possível fadiga de criativo em "${campaign.name}"`,
        description: `Frequência de ${frequency.toFixed(2)} nos últimos 7 dias — cada pessoa já viu o anúncio muitas vezes. Considere trocar o criativo.`,
        link: `/campanhas/${campaign.id}`,
      });
    } else if (frequency >= 3.2) {
      alerts.push({
        id: `freq-${campaign.id}`,
        severity: 'warning',
        title: `Frequência alta em "${campaign.name}"`,
        description: `Frequência de ${frequency.toFixed(2)} nos últimos 7 dias — fique de olho no CTR, pode indicar início de fadiga de criativo.`,
        link: `/campanhas/${campaign.id}`,
      });
    }
  }

  // 3) Ad went silent: had leads in days 4–14 ago, zero in the last 3 days
  const campaignIds = new Set(projectCampaigns.map((c) => c.id));
  const projectAds = ads.filter((a) => campaignIds.has(a.campaignId));
  for (const ad of projectAds) {
    const recentLeads = leads.filter(
      (l) => l.adId === ad.id && l.createdAt.slice(0, 10) >= last3.start && l.createdAt.slice(0, 10) <= last3.end
    ).length;
    const priorLeads = leads.filter(
      (l) => l.adId === ad.id && l.createdAt.slice(0, 10) >= last14.start && l.createdAt.slice(0, 10) <= last14.end
    ).length;
    if (recentLeads === 0 && priorLeads >= 4) {
      const campaign = campaigns.find((c) => c.id === ad.campaignId);
      alerts.push({
        id: `silent-${ad.id}`,
        severity: 'warning',
        title: `"${ad.name}" parou de gerar leads`,
        description: `Gerava leads normalmente (${priorLeads} nos 11 dias anteriores) e está zerado nos últimos 3 dias em ${campaign?.name ?? ''}.`,
        link: `/anuncios/${ad.id}`,
      });
    }
  }

  // 4) Monthly goal pacing risk
  const pacing = computeMonthPacing(projectId);
  if (pacing && pacing.daysElapsed >= 4) {
    if (pacing.status === 'behind') {
      alerts.push({
        id: 'pacing',
        severity: 'critical',
        title: 'Meta do mês em risco',
        description: `No ritmo atual, a projeção é de ${pacing.projected} leads no mês (${Math.round(pacing.pct)}% da meta de ${pacing.leadGoal}). Considere aumentar investimento ou revisar campanhas.`,
        link: '/dashboard',
      });
    } else if (pacing.status === 'at-risk') {
      alerts.push({
        id: 'pacing',
        severity: 'warning',
        title: 'Ritmo abaixo do esperado para a meta do mês',
        description: `Projeção de ${pacing.projected} leads no mês (${Math.round(pacing.pct)}% da meta de ${pacing.leadGoal}).`,
        link: '/dashboard',
      });
    }
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
