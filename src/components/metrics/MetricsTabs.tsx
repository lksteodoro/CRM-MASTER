import { useEffect, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { useFilters } from '../../state/FiltersContext';
import {
  getMetaAdsManagerSummary,
  listAdInsights,
  listMetaEntities,
  type MetaAdsManagerMetrics,
} from '../../services/metaAds.service';
import { listLeadEvents, listLeadEventsByIds, listSales } from '../../services/crmLeads.service';
import { buildDailySeries, computePeriodData } from '../../lib/metricsTrend';
import type {
  LeadEventRow,
  MetaAdInsightDailyRow,
  MetaEntityRow,
  SaleRow,
} from '../../integrations/supabase/database.types';
import { LoadingView } from '../ui/StateView';
import { TrafficDashboard } from './TrafficDashboard';

function previousPeriod(since: string, until: string) {
  const start = new Date(`${since}T00:00:00`);
  const end = new Date(`${until}T00:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return { since: prevStart.toISOString().slice(0, 10), until: prevEnd.toISOString().slice(0, 10) };
}

interface PeriodRaw {
  adInsights: MetaAdInsightDailyRow[];
  leadEvents: LeadEventRow[];
  attributionLeadEvents: LeadEventRow[];
  sales: SaleRow[];
  metaSummary: MetaAdsManagerMetrics | null;
}

interface DashboardCacheEntry {
  current: PeriodRaw;
  previous: PeriodRaw;
  entities: MetaEntityRow[];
  loadedAt: number;
  refreshKey: number;
}

const dashboardCache = new Map<string, DashboardCacheEntry>();
const leadHistoryCache = new Map<string, { rows: LeadEventRow[]; loadedAt: number }>();
const DASHBOARD_CACHE_MS = 2 * 60 * 1000;
const LEAD_HISTORY_CACHE_MS = 10 * 60 * 1000;

async function loadRaw(projectId: string, since: string, until: string): Promise<PeriodRaw> {
  const range = { since, until };
  const [adInsights, periodLeadEvents, sales, metaSummary] = await Promise.all([
    listAdInsights(projectId, range).catch(() => []),
    listLeadEvents(projectId, range).catch(() => []),
    listSales(projectId, range).catch(() => []),
    getMetaAdsManagerSummary(projectId, range).catch(() => null),
  ]);
  const periodIds = new Set(periodLeadEvents.map((event) => event.id));
  const linkedIds = sales.map((sale) => sale.lead_event_id).filter((id): id is string => Boolean(id) && !periodIds.has(id!));
  const linkedLeadEvents = await listLeadEventsByIds(linkedIds).catch(() => []);
  return { adInsights, leadEvents: periodLeadEvents, attributionLeadEvents: [...periodLeadEvents, ...linkedLeadEvents], sales, metaSummary };
}

export function MetricsTabs({ refreshKey = 0 }: { refreshKey?: number }) {
  const { project } = useProject();
  const { dateRange } = useFilters();
  const [current, setCurrent] = useState<PeriodRaw | null>(null);
  const [previous, setPrevious] = useState<PeriodRaw | null>(null);
  const [entities, setEntities] = useState<MetaEntityRow[]>([]);

  useEffect(() => {
    let active = true;
    const cacheKey = `${project.id}:${dateRange.start}:${dateRange.end}`;
    const cached = dashboardCache.get(cacheKey);
    if (cached) {
      setCurrent(cached.current);
      setPrevious(cached.previous);
      setEntities(cached.entities);
      if (Date.now() - cached.loadedAt < DASHBOARD_CACHE_MS && cached.refreshKey === refreshKey) {
        return () => { active = false; };
      }
    } else {
      setCurrent(null);
      setPrevious(null);
    }
    (async () => {
      const prev = previousPeriod(dateRange.start, dateRange.end);
      const [curData, prevData, entityRows] = await Promise.all([
        loadRaw(project.id, dateRange.start, dateRange.end),
        loadRaw(project.id, prev.since, prev.until),
        listMetaEntities(project.id).catch(() => []),
      ]);
      const periods = [curData, prevData];
      if (periods.some((period) => period.sales.some((sale) => !sale.lead_event_id))) {
        const cachedHistory = leadHistoryCache.get(project.id);
        const history = cachedHistory && Date.now() - cachedHistory.loadedAt < LEAD_HISTORY_CACHE_MS
          ? cachedHistory.rows
          : await listLeadEvents(project.id).catch(() => []);
        if (!cachedHistory || history !== cachedHistory.rows) leadHistoryCache.set(project.id, { rows: history, loadedAt: Date.now() });
        for (const period of periods) {
          const contactIds = new Set(period.sales.map((sale) => sale.contact_id));
          const knownIds = new Set(period.attributionLeadEvents.map((event) => event.id));
          period.attributionLeadEvents.push(...history.filter((event) => contactIds.has(event.contact_id) && !knownIds.has(event.id)));
        }
      }
      if (!active) return;
      dashboardCache.set(cacheKey, { current: curData, previous: prevData, entities: entityRows, loadedAt: Date.now(), refreshKey });
      setCurrent(curData);
      setPrevious(prevData);
      setEntities(entityRows);
    })();
    return () => { active = false; };
  }, [project.id, dateRange.start, dateRange.end, refreshKey]);

  if (!current || !previous) return <LoadingView label="Carregando dashboard real..." />;

  return (
    <TrafficDashboard
      current={computePeriodData(current.adInsights, current.leadEvents, current.sales, current.metaSummary)}
      previous={computePeriodData(previous.adInsights, previous.leadEvents, previous.sales, previous.metaSummary)}
      currentSeries={buildDailySeries(current.adInsights, current.leadEvents, current.sales)}
      previousSeries={buildDailySeries(previous.adInsights, previous.leadEvents, previous.sales)}
      previousLeadEvents={previous.leadEvents}
      adInsights={current.adInsights}
      leadEvents={current.leadEvents}
      attributionLeadEvents={current.attributionLeadEvents}
      sales={current.sales}
      metaSummary={current.metaSummary}
      entities={entities}
    />
  );
}
