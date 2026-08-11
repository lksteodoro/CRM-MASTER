import { campaigns, adSets, ads, dailyMetrics, projects } from '../data/mockData';
import { leads, sales } from '../data/leadSalesData';
import type { DateRange, Lead, Sale } from '../types';

function inRange(iso: string, range: DateRange) {
  const d = iso.slice(0, 10);
  return d >= range.start && d <= range.end;
}

export interface Rollup {
  spend: number;
  leadsCount: number;
  formedCount: number;
  salesCount: number;
  revenue: number;
  cpl: number;
  cac: number;
  roas: number;
  conversionRate: number; // sales / leads, %
}

function computeRollup(spend: number, rowLeads: Lead[], rowSales: Sale[]): Rollup {
  const leadsCount = rowLeads.length;
  const formedCount = rowLeads.filter((l) => l.status === 'Matriculado').length;
  const salesCount = rowSales.length;
  const revenue = rowSales.reduce((a, s) => a + s.value, 0);
  return {
    spend,
    leadsCount,
    formedCount,
    salesCount,
    revenue,
    cpl: leadsCount > 0 ? spend / leadsCount : 0,
    cac: salesCount > 0 ? spend / salesCount : 0,
    roas: spend > 0 ? revenue / spend : 0,
    conversionRate: leadsCount > 0 ? (salesCount / leadsCount) * 100 : 0,
  };
}

export function campaignsForProject(projectId: string) {
  const project = projects.find((p) => p.id === projectId);
  const ids = new Set(project?.campaignIds ?? []);
  return campaigns.filter((c) => ids.has(c.id));
}

export function adSetsForCampaign(campaignId: string) {
  return adSets.filter((s) => s.campaignId === campaignId);
}

export function adsForCampaign(campaignId: string) {
  return ads.filter((a) => a.campaignId === campaignId);
}

export function adsForAdSet(adSetId: string) {
  return ads.filter((a) => a.adSetId === adSetId);
}

export function campaignRollup(campaignId: string, range: DateRange): Rollup {
  const spend = dailyMetrics
    .filter((d) => d.campaignId === campaignId && d.date >= range.start && d.date <= range.end)
    .reduce((a, r) => a + r.spend, 0);
  const rowLeads = leads.filter((l) => l.campaignId === campaignId && inRange(l.createdAt, range));
  const rowSales = sales.filter((s) => s.campaignId === campaignId && inRange(s.closedAt, range));
  return computeRollup(spend, rowLeads, rowSales);
}

export function adSetRollup(adSetId: string, range: DateRange): Rollup {
  const adSet = adSets.find((s) => s.id === adSetId);
  if (!adSet) return computeRollup(0, [], []);
  const campaignTotals = campaignRollup(adSet.campaignId, range);
  const campaignLeadsCount = leads.filter(
    (l) => l.campaignId === adSet.campaignId && inRange(l.createdAt, range)
  ).length;

  const rowLeads = leads.filter((l) => l.adSetId === adSetId && inRange(l.createdAt, range));
  const rowSales = sales.filter((s) => s.adSetId === adSetId && inRange(s.closedAt, range));
  const spend =
    campaignLeadsCount > 0
      ? campaignTotals.spend * (rowLeads.length / campaignLeadsCount)
      : 0;
  return computeRollup(spend, rowLeads, rowSales);
}

export function adRollup(adId: string, range: DateRange): Rollup {
  const ad = ads.find((a) => a.id === adId);
  if (!ad) return computeRollup(0, [], []);
  const campaignTotals = campaignRollup(ad.campaignId, range);
  const campaignLeadsCount = leads.filter(
    (l) => l.campaignId === ad.campaignId && inRange(l.createdAt, range)
  ).length;

  const rowLeads = leads.filter((l) => l.adId === adId && inRange(l.createdAt, range));
  const rowSales = sales.filter((s) => s.adId === adId && inRange(s.closedAt, range));
  const spend =
    campaignLeadsCount > 0
      ? campaignTotals.spend * (rowLeads.length / campaignLeadsCount)
      : 0;
  return computeRollup(spend, rowLeads, rowSales);
}

export interface FunnelStep {
  impressions: number;
  linkClicks: number;
  pageViews: number;
  leads: number;
  connected: number;
  formed: number;
  sales: number;
}

export function campaignFunnel(campaignId: string, range: DateRange): FunnelStep {
  const rows = dailyMetrics.filter(
    (d) => d.campaignId === campaignId && d.date >= range.start && d.date <= range.end
  );
  const rollup = campaignRollup(campaignId, range);
  return {
    impressions: rows.reduce((a, r) => a + r.impressions, 0),
    linkClicks: rows.reduce((a, r) => a + r.linkClicks, 0),
    pageViews: rows.reduce((a, r) => a + r.pageViews, 0),
    leads: rollup.leadsCount,
    connected: rows.reduce((a, r) => a + r.connectedLeads, 0),
    formed: rollup.formedCount,
    sales: rollup.salesCount,
  };
}

export interface DailyPoint {
  date: string;
  leads: number;
  formed: number;
  sales: number;
  revenue: number;
}

export function campaignDailySeries(campaignId: string, range: DateRange): DailyPoint[] {
  const acc = new Map<string, DailyPoint>();
  const rowLeads = leads.filter((l) => l.campaignId === campaignId && inRange(l.createdAt, range));
  const rowSales = sales.filter((s) => s.campaignId === campaignId && inRange(s.closedAt, range));

  for (const l of rowLeads) {
    const date = l.createdAt.slice(0, 10);
    const point = acc.get(date) ?? { date, leads: 0, formed: 0, sales: 0, revenue: 0 };
    point.leads += 1;
    if (l.status === 'Matriculado') point.formed += 1;
    acc.set(date, point);
  }
  for (const s of rowSales) {
    const date = s.closedAt.slice(0, 10);
    const point = acc.get(date) ?? { date, leads: 0, formed: 0, sales: 0, revenue: 0 };
    point.sales += 1;
    point.revenue += s.value;
    acc.set(date, point);
  }

  return Array.from(acc.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function adDailySeries(adId: string, range: DateRange): DailyPoint[] {
  const acc = new Map<string, DailyPoint>();
  const rowLeads = leads.filter((l) => l.adId === adId && inRange(l.createdAt, range));
  const rowSales = sales.filter((s) => s.adId === adId && inRange(s.closedAt, range));

  for (const l of rowLeads) {
    const date = l.createdAt.slice(0, 10);
    const point = acc.get(date) ?? { date, leads: 0, formed: 0, sales: 0, revenue: 0 };
    point.leads += 1;
    if (l.status === 'Matriculado') point.formed += 1;
    acc.set(date, point);
  }
  for (const s of rowSales) {
    const date = s.closedAt.slice(0, 10);
    const point = acc.get(date) ?? { date, leads: 0, formed: 0, sales: 0, revenue: 0 };
    point.sales += 1;
    point.revenue += s.value;
    acc.set(date, point);
  }

  return Array.from(acc.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function projectRollup(projectId: string, range: DateRange): Rollup {
  const campaignIds = campaignsForProject(projectId).map((c) => c.id);
  const rows = campaignIds.map((id) => campaignRollup(id, range));
  const totals = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      leadsCount: acc.leadsCount + r.leadsCount,
      formedCount: acc.formedCount + r.formedCount,
      salesCount: acc.salesCount + r.salesCount,
      revenue: acc.revenue + r.revenue,
    }),
    { spend: 0, leadsCount: 0, formedCount: 0, salesCount: 0, revenue: 0 }
  );
  return {
    ...totals,
    cpl: totals.leadsCount > 0 ? totals.spend / totals.leadsCount : 0,
    cac: totals.salesCount > 0 ? totals.spend / totals.salesCount : 0,
    roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
    conversionRate: totals.leadsCount > 0 ? (totals.salesCount / totals.leadsCount) * 100 : 0,
  };
}
