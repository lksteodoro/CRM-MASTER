import { useEffect, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { useFilters } from '../../state/FiltersContext';
import {
  getIntegration,
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
const DASHBOARD_CACHE_MS = 5 * 60 * 1000;
const LEAD_HISTORY_CACHE_MS = 10 * 60 * 1000;
const DASHBOARD_SESSION_CACHE_PREFIX = 'crm:metrics-dashboard:';

function readSessionCache(cacheKey: string): DashboardCacheEntry | null {
  try {
    const raw = window.sessionStorage.getItem(`${DASHBOARD_SESSION_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardCacheEntry;
    if (!parsed?.current || !parsed?.previous || !parsed.loadedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(cacheKey: string, entry: DashboardCacheEntry) {
  try {
    // Evita ocupar toda a sessão com projetos muito grandes. O cache em memória
    // ainda segue ativo neste caso; a próxima navegação volta a buscar os dados.
    const serialized = JSON.stringify(entry);
    if (serialized.length <= 1_500_000) {
      window.sessionStorage.setItem(`${DASHBOARD_SESSION_CACHE_PREFIX}${cacheKey}`, serialized);
    }
  } catch {
    // Cache é só uma otimização; nunca deve impedir o dashboard de abrir.
  }
}

async function loadRaw(
  projectId: string,
  since: string,
  until: string,
  selectedCampaignIds?: string[] | null,
  includeMetaSummary = false,
): Promise<PeriodRaw> {
  const range = { since, until };
  const [adInsights, periodLeadEvents, sales, metaSummary] = await Promise.all([
    listAdInsights(projectId, range, selectedCampaignIds).catch(() => []),
    listLeadEvents(projectId, range).catch(() => []),
    listSales(projectId, range).catch(() => []),
    includeMetaSummary ? getMetaAdsManagerSummary(projectId, range).catch(() => null) : Promise.resolve(null),
  ]);
  return { adInsights, leadEvents: periodLeadEvents, attributionLeadEvents: periodLeadEvents, sales, metaSummary };
}

async function enrichAttribution(projectId: string, periods: PeriodRaw[]) {
  const linkedIds = periods
    .flatMap((period) => {
      const periodIds = new Set(period.leadEvents.map((event) => event.id));
      return period.sales
        .map((sale) => sale.lead_event_id)
        .filter((id): id is string => Boolean(id) && !periodIds.has(id!));
    });
  const linkedLeadEvents = await listLeadEventsByIds(linkedIds).catch(() => []);

  for (const period of periods) {
    const knownIds = new Set(period.attributionLeadEvents.map((event) => event.id));
    const linkedForPeriod = new Set(period.sales.map((sale) => sale.lead_event_id).filter(Boolean));
    period.attributionLeadEvents = [
      ...period.attributionLeadEvents,
      ...linkedLeadEvents.filter((event) => linkedForPeriod.has(event.id) && !knownIds.has(event.id)),
    ];
  }

  if (!periods.some((period) => period.sales.some((sale) => !sale.lead_event_id))) return;
  const cachedHistory = leadHistoryCache.get(projectId);
  const history = cachedHistory && Date.now() - cachedHistory.loadedAt < LEAD_HISTORY_CACHE_MS
    ? cachedHistory.rows
    : await listLeadEvents(projectId).catch(() => []);
  if (!cachedHistory || history !== cachedHistory.rows) {
    leadHistoryCache.set(projectId, { rows: history, loadedAt: Date.now() });
  }
  for (const period of periods) {
    const contactIds = new Set(period.sales.map((sale) => sale.contact_id));
    const knownIds = new Set(period.attributionLeadEvents.map((event) => event.id));
    period.attributionLeadEvents = [...period.attributionLeadEvents, ...history.filter((event) => contactIds.has(event.contact_id) && !knownIds.has(event.id))];
  }
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
    const cached = dashboardCache.get(cacheKey) ?? readSessionCache(cacheKey);
    if (cached) {
      dashboardCache.set(cacheKey, cached);
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
      const integration = await getIntegration(project.id).catch(() => null);
      const selectedCampaignIds = integration?.selected_campaign_ids ?? null;
      const [curData, prevData, entityRows] = await Promise.all([
        loadRaw(project.id, dateRange.start, dateRange.end, selectedCampaignIds, true),
        // O resumo externo da Meta é necessário apenas para o período atual.
        // O anterior usa os insights já sincronizados, poupando uma chamada lenta.
        loadRaw(project.id, prev.since, prev.until, selectedCampaignIds),
        listMetaEntities(project.id).catch(() => []),
      ]);
      if (!active) return;
      const initialEntry = { current: curData, previous: prevData, entities: entityRows, loadedAt: Date.now(), refreshKey };
      dashboardCache.set(cacheKey, initialEntry);
      writeSessionCache(cacheKey, initialEntry);
      setCurrent(curData);
      setPrevious(prevData);
      setEntities(entityRows);

      // O cruzamento histórico só é necessário para atribuição/ranking. Ele é
      // feito depois que os cards e gráficos principais já estão visíveis.
      await enrichAttribution(project.id, [curData, prevData]);
      if (!active) return;
      const enrichedEntry = { current: { ...curData }, previous: { ...prevData }, entities: entityRows, loadedAt: Date.now(), refreshKey };
      dashboardCache.set(cacheKey, enrichedEntry);
      writeSessionCache(cacheKey, enrichedEntry);
      setCurrent(enrichedEntry.current);
      setPrevious(enrichedEntry.previous);
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
