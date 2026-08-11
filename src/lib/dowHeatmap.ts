import { dailyMetrics, hourlyShape } from '../data/mockData';

export interface DowHourCell {
  dow: number;
  hour: number;
  avgLeads: number;
}

function parseDateLocal(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Approximates a day-of-week × hour lead pattern across the full history by
// distributing each day's real lead total across hours using the same
// intraday shape used for the "today" wave chart. In production this would
// come directly from hour-level API data instead of being derived.
export function computeDowHourPattern(campaignIds: Set<string>): DowHourCell[][] {
  const sums: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const seenDatesPerDow: Set<string>[] = Array.from({ length: 7 }, () => new Set());
  const shapeSum = hourlyShape.reduce((a, b) => a + b, 0);

  const byDate = new Map<string, number>();
  for (const row of dailyMetrics) {
    if (!campaignIds.has(row.campaignId)) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.leads);
  }

  for (const [date, totalLeads] of byDate) {
    const dow = parseDateLocal(date).getDay();
    for (let h = 0; h < 24; h++) {
      sums[dow][h] += totalLeads * (hourlyShape[h] / shapeSum);
    }
    seenDatesPerDow[dow].add(date);
  }

  return sums.map((row, dow) =>
    row.map((sum, hour) => ({
      dow,
      hour,
      avgLeads: seenDatesPerDow[dow].size > 0 ? sum / seenDatesPerDow[dow].size : 0,
    }))
  );
}
