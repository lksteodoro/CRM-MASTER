import { dailyMetrics, hourlyMetrics, campaigns } from '../data/mockData';
import type { DailyMetric, DateRange, DateRangePreset, Project } from '../types';

export function presetToRange(preset: DateRangePreset): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === 'today') {
    return { start: fmt(today), end: fmt(today) };
  }
  if (preset === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { start: fmt(y), end: fmt(y) };
  }

  const days = preset === '7d' ? 7 : preset === '14d' ? 14 : preset === '30d' ? 30 : preset === '180d' ? 180 : 7;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { start: fmt(start), end: fmt(today) };
}

export function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function campaignIdsForProject(project: Project | undefined): Set<string> {
  return new Set(project ? project.campaignIds : campaigns.map((c) => c.id));
}

export function filterDaily(range: DateRange, campaignIds: Set<string>): DailyMetric[] {
  return dailyMetrics.filter(
    (d) => d.date >= range.start && d.date <= range.end && campaignIds.has(d.campaignId)
  );
}

export interface Totals {
  spend: number;
  leads: number;
  formedLeads: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  pageViews: number;
  connectedLeads: number;
  sales: number;
}

export function sumTotals(rows: DailyMetric[]): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      leads: acc.leads + r.leads,
      formedLeads: acc.formedLeads + r.formedLeads,
      impressions: acc.impressions + r.impressions,
      reach: acc.reach + r.reach,
      linkClicks: acc.linkClicks + r.linkClicks,
      pageViews: acc.pageViews + r.pageViews,
      connectedLeads: acc.connectedLeads + r.connectedLeads,
      sales: acc.sales + r.sales,
    }),
    {
      spend: 0,
      leads: 0,
      formedLeads: 0,
      impressions: 0,
      reach: 0,
      linkClicks: 0,
      pageViews: 0,
      connectedLeads: 0,
      sales: 0,
    }
  );
}

export function cpl(t: Totals) {
  return t.leads > 0 ? t.spend / t.leads : 0;
}

export function pageConversionRate(t: Totals) {
  return t.pageViews > 0 ? (t.leads / t.pageViews) * 100 : 0;
}

export function connectRate(t: Totals) {
  return t.leads > 0 ? (t.connectedLeads / t.leads) * 100 : 0;
}

export function impressionRate(t: Totals) {
  // impressões entregues em relação ao alcance (frequência normalizada em %)
  return t.reach > 0 ? (t.impressions / t.reach) * 100 : 0;
}

export function ctr(t: Totals) {
  return t.impressions > 0 ? (t.linkClicks / t.impressions) * 100 : 0;
}

export function cpm(t: Totals) {
  return t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0;
}

export function frequency(t: Totals) {
  return t.reach > 0 ? t.impressions / t.reach : 0;
}

export function dailySeries(range: DateRange, campaignIds: Set<string>) {
  const rows = filterDaily(range, campaignIds);
  const acc = new Map<string, DailyMetric[]>();
  for (const r of rows) {
    const list = acc.get(r.date) ?? [];
    list.push(r);
    acc.set(r.date, list);
  }
  return Array.from(acc.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, ...sumTotals(list) }));
}

export function hourlySeries(campaignIds: Set<string>) {
  const acc = new Map<number, { hour: number; leads: number; spend: number }>();
  for (let h = 0; h < 24; h++) acc.set(h, { hour: h, leads: 0, spend: 0 });
  for (const row of hourlyMetrics) {
    if (!campaignIds.has(row.campaignId)) continue;
    const cur = acc.get(row.hour)!;
    cur.leads += row.leads;
    cur.spend += row.spend;
  }
  return Array.from(acc.values());
}

export function previousRange(range: DateRange): DateRange {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (spanDays - 1));
  return { preset: 'custom', start: fmt(prevStart), end: fmt(prevEnd) };
}

export function deltaPct(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

export function hourlyByCampaign(campaignIds: Set<string>) {
  const relevant = campaigns.filter((c) => campaignIds.has(c.id));
  return relevant.map((c) => ({
    campaign: c,
    hours: hourlyMetrics.filter((h) => h.campaignId === c.id).sort((a, b) => a.hour - b.hour),
  }));
}
