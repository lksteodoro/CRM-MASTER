import { useEffect, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { useFilters } from '../../state/FiltersContext';
import { listAdInsights, listMetaEntities } from '../../services/metaAds.service';
import { listLeadEvents, listSales } from '../../services/crmLeads.service';
import { buildDailySeries, buildAdTimeline, computePeriodData } from '../../lib/metricsTrend';
import type { MetaAdInsightDailyRow, LeadEventRow, SaleRow, MetaEntityRow } from '../../integrations/supabase/database.types';
import { LoadingView } from '../ui/StateView';
import { MetricsSummaryTab } from './MetricsSummaryTab';
import { MetricsTrendTab } from './MetricsTrendTab';
import { MetricsTimelineTab } from './MetricsTimelineTab';

/** Mesma duração do período atual, terminando no dia imediatamente anterior. */
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
  sales: SaleRow[];
}

async function loadRaw(projectId: string, since: string, until: string): Promise<PeriodRaw> {
  const range = { since, until };
  const [adInsights, leadEvents, sales] = await Promise.all([
    listAdInsights(projectId, range).catch(() => []),
    listLeadEvents(projectId, range).catch(() => []),
    listSales(projectId, range).catch(() => []),
  ]);
  return { adInsights, leadEvents, sales };
}

type TabKey = 'resumo' | 'tendencia' | 'timeline';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'resumo', label: 'Resumo' },
  { key: 'tendencia', label: 'Tendência' },
  { key: 'timeline', label: 'Timeline' },
];

/**
 * Redesenho da seção "Métricas Completas" do Dashboard em 3 visões: Resumo
 * (cards), Tendência (linhas) e Timeline (gantt). Busca os dados brutos uma
 * vez aqui (período atual + anterior) e distribui pras 3 abas — evita cada
 * uma refazer a mesma consulta.
 */
export function MetricsTabs() {
  const { project } = useProject();
  const { dateRange } = useFilters();
  const [tab, setTab] = useState<TabKey>('resumo');
  const [current, setCurrent] = useState<PeriodRaw | null>(null);
  const [previous, setPrevious] = useState<PeriodRaw | null>(null);
  const [entities, setEntities] = useState<MetaEntityRow[]>([]);

  useEffect(() => {
    let active = true;
    setCurrent(null);
    setPrevious(null);
    (async () => {
      const prev = previousPeriod(dateRange.start, dateRange.end);
      const [curData, prevData, entityRows] = await Promise.all([
        loadRaw(project.id, dateRange.start, dateRange.end),
        loadRaw(project.id, prev.since, prev.until),
        listMetaEntities(project.id, 'ad').catch(() => []),
      ]);
      if (!active) return;
      setCurrent(curData);
      setPrevious(prevData);
      setEntities(entityRows);
    })();
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end]);

  if (!current || !previous) return <LoadingView label="Carregando métricas..." />;

  const currentData = computePeriodData(current.adInsights, current.leadEvents, current.sales);
  const previousData = computePeriodData(previous.adInsights, previous.leadEvents, previous.sales);
  const currentSeries = buildDailySeries(current.adInsights, current.leadEvents, current.sales);
  const previousSeries = buildDailySeries(previous.adInsights, previous.leadEvents, previous.sales);
  const adTimeline = buildAdTimeline(current.adInsights, entities);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
              (tab === t.key
                ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumo' && (
        <MetricsSummaryTab current={currentData} previous={previousData} currentSeries={currentSeries} />
      )}
      {tab === 'tendencia' && <MetricsTrendTab currentSeries={currentSeries} previousSeries={previousSeries} />}
      {tab === 'timeline' && <MetricsTimelineTab ads={adTimeline} />}
    </div>
  );
}
