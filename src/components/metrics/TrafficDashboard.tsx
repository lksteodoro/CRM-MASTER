import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Banknote,
  BarChart3,
  CircleDollarSign,
  CircleStop,
  Download,
  Eye,
  Fingerprint,
  Gauge,
  Image as ImageIcon,
  Layers3,
  Medal,
  MousePointerClick,
  Search,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { DailyPoint, PeriodData } from '../../lib/metricsTrend';
import type {
  LeadEventRow,
  MetaAdInsightDailyRow,
  MetaEntityRow,
  SaleRow,
} from '../../integrations/supabase/database.types';
import type { MetaAdsManagerMetrics } from '../../services/metaAds.service';
import { useProject } from '../../state/ProjectContext';
import { deltaPct } from './DeltaBadge';
import { formatBRL, formatDateShort, formatNumber, formatPercent } from '../../lib/format';
import { Sparkline } from './Sparkline';

type Level = 'campaign' | 'adset' | 'ad';
type Tone = 'good' | 'bad' | 'warn' | 'info' | 'brand';
type SortKey = 'spend' | 'leads' | 'cpl' | 'sales' | 'revenue' | 'cac' | 'roas' | 'score';

interface PerformanceRow {
  id: string;
  name: string;
  status: string;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  leads: number;
  crmLeads: number;
  sales: number;
  revenue: number;
  ctr: number;
  cpm: number;
  frequency: number;
  cpl: number;
  cac: number;
  roas: number;
  score: number;
}

interface TrafficDashboardProps {
  current: PeriodData;
  previous: PeriodData;
  currentSeries: DailyPoint[];
  previousSeries: DailyPoint[];
  previousLeadEvents: LeadEventRow[];
  adInsights: MetaAdInsightDailyRow[];
  leadEvents: LeadEventRow[];
  attributionLeadEvents: LeadEventRow[];
  sales: SaleRow[];
  metaSummary: MetaAdsManagerMetrics | null;
  entities: MetaEntityRow[];
}

const tones: Record<Tone, { color: string; soft: string }> = {
  good: { color: 'var(--color-good)', soft: 'var(--color-good-soft)' },
  bad: { color: 'var(--color-bad)', soft: 'var(--color-bad-soft)' },
  warn: { color: 'var(--color-warn)', soft: 'var(--color-warn-soft)' },
  info: { color: 'var(--color-info)', soft: 'var(--color-info-soft)' },
  brand: { color: 'var(--color-brand)', soft: 'var(--color-brand-soft)' },
};

function entityKey(row: MetaAdInsightDailyRow, level: Level) {
  if (level === 'campaign') return { id: row.campaign_id, name: row.campaign_name };
  if (level === 'adset') return { id: row.adset_id ?? 'sem-conjunto', name: row.adset_name ?? 'Sem conjunto identificado' };
  return { id: row.ad_id, name: row.ad_name };
}

function normalizeTrackingName(value: string | null | undefined) {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function rawTrackingValue(event: LeadEventRow, keys: string[]) {
  if (!event.raw_payload || typeof event.raw_payload !== 'object' || Array.isArray(event.raw_payload)) return null;
  const payload = event.raw_payload as Record<string, unknown>;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function eventKey(event: LeadEventRow, level: Level, namesByLevel: Record<Level, Map<string, string | null>>) {
  const explicitId = level === 'campaign' ? event.campaign_id : level === 'adset' ? event.adset_id : event.ad_id;
  if (explicitId) return explicitId;
  const trackingName = level === 'campaign'
    ? event.utm_campaign ?? rawTrackingValue(event, ['campaign_name', 'campaign'])
    : level === 'adset'
      ? rawTrackingValue(event, ['adset_name', 'adset', 'conjunto']) ?? event.utm_medium
      : rawTrackingValue(event, ['ad_name', 'creative_name', 'creative', 'anuncio']) ?? event.utm_content;
  const normalizedName = normalizeTrackingName(trackingName);
  if (!normalizedName) return null;
  const campaignName = normalizeTrackingName(event.utm_campaign ?? rawTrackingValue(event, ['campaign_name', 'campaign']));
  const adsetName = normalizeTrackingName(rawTrackingValue(event, ['adset_name', 'adset', 'conjunto']) ?? event.utm_medium);
  const scopedKeys = level === 'ad'
    ? [`${campaignName}::${adsetName}::${normalizedName}`, `${campaignName}::${normalizedName}`]
    : level === 'adset' ? [`${campaignName}::${normalizedName}`] : [];
  for (const key of scopedKeys) {
    const resolved = namesByLevel[level].get(key);
    if (resolved) return resolved;
  }
  return namesByLevel[level].get(normalizedName) ?? null;
}

function buildRows(
  insights: MetaAdInsightDailyRow[],
  leadEvents: LeadEventRow[],
  sales: SaleRow[],
  entities: MetaEntityRow[],
  level: Level,
  attributionLeadEvents: LeadEventRow[] = leadEvents
): PerformanceRow[] {
  const entityMap = new Map(entities.map((entity) => [entity.external_id, entity]));
  const namesByLevel: Record<Level, Map<string, string | null>> = { campaign: new Map(), adset: new Map(), ad: new Map() };
  const registerName = (entityLevel: Level, name: string, id: string) => {
    if (!name || !id) return;
    const existing = namesByLevel[entityLevel].get(name);
    namesByLevel[entityLevel].set(name, existing && existing !== id ? null : id);
  };
  for (const insight of insights) {
    const values: Array<[Level, string | null, string]> = [
      ['campaign', insight.campaign_name, insight.campaign_id],
      ['adset', insight.adset_name, insight.adset_id ?? ''],
      ['ad', insight.ad_name, insight.ad_id],
    ];
    for (const [entityLevel, name, id] of values) {
      const normalized = normalizeTrackingName(name);
      registerName(entityLevel, normalized, id);
    }
    const campaignName = normalizeTrackingName(insight.campaign_name);
    const adsetName = normalizeTrackingName(insight.adset_name);
    const adName = normalizeTrackingName(insight.ad_name);
    if (campaignName && adsetName && insight.adset_id) registerName('adset', `${campaignName}::${adsetName}`, insight.adset_id);
    if (campaignName && adName) registerName('ad', `${campaignName}::${adName}`, insight.ad_id);
    if (campaignName && adsetName && adName) registerName('ad', `${campaignName}::${adsetName}::${adName}`, insight.ad_id);
  }
  for (const entity of entities) {
    const entityLevel = entity.entity_type as Level;
    if (!(entityLevel in namesByLevel)) continue;
    const normalized = normalizeTrackingName(entity.name);
    registerName(entityLevel, normalized, entity.external_id);
  }
  const rows = new Map<string, Omit<PerformanceRow, 'ctr' | 'cpm' | 'frequency' | 'cpl' | 'cac' | 'roas' | 'score'>>();

  for (const insight of insights) {
    const key = entityKey(insight, level);
    const entity = entityMap.get(key.id);
    const row = rows.get(key.id) ?? {
      id: key.id,
      name: key.name,
      status: entity?.status ?? (level === 'campaign' ? insight.campaign_status : null) ?? 'UNKNOWN',
      thumbnailUrl: entity?.thumbnail_url ?? null,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      linkClicks: 0,
      leads: 0,
      crmLeads: 0,
      sales: 0,
      revenue: 0,
    };
    row.spend += Number(insight.spend);
    row.impressions += insight.impressions;
    row.reach += insight.reach;
    row.clicks += insight.clicks;
    row.linkClicks += insight.link_clicks;
    row.leads += insight.leads;
    row.thumbnailUrl ??= entityMap.get(insight.ad_id)?.thumbnail_url ?? null;
    rows.set(key.id, row);
  }

  const contactsByKey = new Map<string, Set<string>>();
  for (const event of leadEvents) {
    const key = eventKey(event, level, namesByLevel);
    if (!key) continue;
    const contacts = contactsByKey.get(key) ?? new Set<string>();
    contacts.add(event.contact_id);
    contactsByKey.set(key, contacts);
  }
  for (const [key, contacts] of contactsByKey) {
    const row = rows.get(key);
    if (row) row.crmLeads = contacts.size;
  }

  const leadById = new Map(attributionLeadEvents.map((event) => [event.id, event]));
  const leadsByContact = new Map<string, LeadEventRow[]>();
  for (const event of attributionLeadEvents) {
    const list = leadsByContact.get(event.contact_id) ?? [];
    list.push(event);
    leadsByContact.set(event.contact_id, list);
  }
  for (const list of leadsByContact.values()) list.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  for (const sale of sales) {
    const linked = sale.lead_event_id ? leadById.get(sale.lead_event_id) : undefined;
    const fallback = leadsByContact.get(sale.contact_id)?.find((event) => event.occurred_at <= sale.sold_at);
    const key = eventKey(linked ?? fallback ?? ({} as LeadEventRow), level, namesByLevel);
    if (!key) continue;
    const row = rows.get(key);
    if (!row) continue;
    row.sales += 1;
    row.revenue += sale.amount ?? 0;
  }

  return Array.from(rows.values()).map((row) => {
    const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
    const cpm = row.impressions > 0 ? (row.spend / row.impressions) * 1000 : 0;
    const frequency = row.reach > 0 ? row.impressions / row.reach : 0;
    const cpl = row.crmLeads > 0 ? row.spend / row.crmLeads : 0;
    const cac = row.sales > 0 ? row.spend / row.sales : 0;
    const roas = row.spend > 0 ? row.revenue / row.spend : 0;
    const efficiency = Math.min(45, roas * 12);
    const volume = Math.min(25, Math.log10(row.leads + 1) * 10);
    const tracking = row.leads > 0 ? Math.min(15, (row.crmLeads / row.leads) * 15) : 0;
    const health = frequency > 0 && frequency <= 4 ? 15 : frequency <= 6 ? 8 : 2;
    return { ...row, ctr, cpm, frequency, cpl, cac, roas, score: Math.round(Math.min(100, efficiency + volume + tracking + health)) };
  });
}

function statusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === 'ACTIVE') return 'Ativo';
  if (normalized === 'PAUSED') return 'Pausado';
  if (normalized === 'ARCHIVED') return 'Arquivado';
  return 'Sem status';
}

function exportRows(rows: PerformanceRow[], level: Level) {
  const header = ['Nome', 'Status', 'Investimento', 'Impressões', 'Cliques', 'Leads Meta', 'Leads CRM', 'Vendas', 'Receita', 'CPL', 'CAC', 'ROAS', 'Score'];
  const data = rows.map((row) => [row.name, statusLabel(row.status), row.spend, row.impressions, row.clicks, row.leads, row.crmLeads, row.sales, row.revenue, row.cpl, row.cac, row.roas, row.score]);
  const csv = [header, ...data].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dashboard-${level}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TrafficDashboard(props: TrafficDashboardProps) {
  const { goals } = useProject();
  const [metricsView, setMetricsView] = useState<'overview' | 'sales-ranking'>('overview');
  const [level, setLevel] = useState<Level>('ad');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PerformanceRow | null>(null);

  const { current, previous, currentSeries, previousSeries, previousLeadEvents, adInsights, leadEvents, attributionLeadEvents, sales, entities } = props;
  const campaignRows = useMemo(() => buildRows(adInsights, leadEvents, sales, entities, 'campaign', attributionLeadEvents), [adInsights, leadEvents, attributionLeadEvents, sales, entities]);
  const adsetRows = useMemo(() => buildRows(adInsights, leadEvents, sales, entities, 'adset', attributionLeadEvents), [adInsights, leadEvents, attributionLeadEvents, sales, entities]);
  const adRows = useMemo(() => buildRows(adInsights, leadEvents, sales, entities, 'ad', attributionLeadEvents), [adInsights, leadEvents, attributionLeadEvents, sales, entities]);
  const allRows = level === 'campaign' ? campaignRows : level === 'adset' ? adsetRows : adRows;
  const filteredRows = [...allRows]
    .filter((row) => (!query || row.name.toLowerCase().includes(query.toLowerCase())) && (status === 'all' || row.status.toUpperCase() === status))
    .sort((a, b) => (sortAsc ? 1 : -1) * (a[sortKey] - b[sortKey]));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [level, query, status, pageSize]);

  const { rollup } = current;
  const cpl = current.uniqueLeads > 0 ? rollup.spend / current.uniqueLeads : 0;
  const cac = current.salesCount > 0 ? rollup.spend / current.salesCount : 0;
  const roas = rollup.spend > 0 ? current.revenue / rollup.spend : 0;
  const metaToCrm = rollup.leadsCount > 0 ? (current.uniqueLeads / rollup.leadsCount) * 100 : 0;
  const attributedSales = campaignRows.reduce((sum, row) => sum + row.sales, 0);
  const attributionRate = current.salesCount > 0 ? (attributedSales / current.salesCount) * 100 : 0;
  const bestCampaign = [...campaignRows].filter((row) => row.revenue > 0).sort((a, b) => b.roas - a.roas)[0];
  const reviewCampaign = [...campaignRows].filter((row) => row.spend > 0 && row.roas < 1).sort((a, b) => b.spend - a.spend)[0];

  const previousCpl = previous.uniqueLeads > 0 ? previous.rollup.spend / previous.uniqueLeads : 0;
  const previousCac = previous.salesCount > 0 ? previous.rollup.spend / previous.salesCount : 0;
  const previousRoas = previous.rollup.spend > 0 ? previous.revenue / previous.rollup.spend : 0;

  const kpis = [
    { label: 'Investimento', value: formatBRL(rollup.spend), delta: deltaPct(rollup.spend, previous.rollup.spend), good: false, icon: Wallet, tone: 'brand' as Tone, spark: currentSeries.map((d) => d.spend) },
    { label: 'Receita CRM', value: formatBRL(current.revenue), delta: deltaPct(current.revenue, previous.revenue), good: true, icon: CircleDollarSign, tone: 'good' as Tone, spark: currentSeries.map((d) => d.revenue) },
    { label: 'ROAS real', value: `${roas.toFixed(2)}x`, delta: deltaPct(roas, previousRoas), good: true, icon: TrendingUp, tone: 'good' as Tone, spark: currentSeries.map((d) => d.spend > 0 ? d.revenue / d.spend : 0) },
    { label: 'Impressões', value: formatNumber(rollup.impressions), delta: deltaPct(rollup.impressions, previous.rollup.impressions), good: true, icon: Eye, tone: 'info' as Tone, spark: currentSeries.map((d) => d.impressions) },
    { label: 'Alcance', value: formatNumber(rollup.reach), delta: deltaPct(rollup.reach, previous.rollup.reach), good: true, icon: Users, tone: 'info' as Tone, spark: currentSeries.map((d) => d.impressions) },
    { label: 'CTR', value: formatPercent(rollup.ctr, 2), delta: deltaPct(rollup.ctr, previous.rollup.ctr), good: true, icon: MousePointerClick, tone: 'brand' as Tone, spark: currentSeries.map((d) => d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0) },
    { label: 'Cliques no link', value: formatNumber(rollup.linkClicks), delta: deltaPct(rollup.linkClicks, previous.rollup.linkClicks), good: true, icon: MousePointerClick, tone: 'brand' as Tone, spark: currentSeries.map((d) => d.clicks) },
    { label: 'Leads Meta', value: formatNumber(rollup.leadsCount), delta: deltaPct(rollup.leadsCount, previous.rollup.leadsCount), good: true, icon: BadgeCheck, tone: 'info' as Tone, spark: currentSeries.map((d) => d.metaLeads) },
    { label: 'Leads únicos CRM', value: formatNumber(current.uniqueLeads), delta: deltaPct(current.uniqueLeads, previous.uniqueLeads), good: true, icon: Fingerprint, tone: 'good' as Tone, spark: currentSeries.map((d) => d.uniqueLeadsReceived) },
    { label: 'CPL único', value: formatBRL(cpl), delta: deltaPct(cpl, previousCpl), good: false, icon: Target, tone: 'warn' as Tone, spark: currentSeries.map((d) => d.uniqueLeadsReceived > 0 ? d.spend / d.uniqueLeadsReceived : 0) },
    { label: 'Vendas', value: formatNumber(current.salesCount), delta: deltaPct(current.salesCount, previous.salesCount), good: true, icon: ShoppingCart, tone: 'good' as Tone, spark: currentSeries.map((d) => d.sales) },
    { label: 'CAC', value: formatBRL(cac), delta: deltaPct(cac, previousCac), good: false, icon: Banknote, tone: 'warn' as Tone, spark: currentSeries.map((d) => d.sales > 0 ? d.spend / d.sales : 0) },
  ];

  const decisions = [
    { icon: Zap, label: 'Escalar', value: bestCampaign?.name ?? 'Sem candidata', detail: bestCampaign ? `${bestCampaign.roas.toFixed(2)}x ROAS · ${formatNumber(bestCampaign.sales)} vendas` : 'Aguardando receita atribuída por campanha.', badge: bestCampaign ? 'Oportunidade' : 'Sem dados', tone: bestCampaign ? 'good' as Tone : 'info' as Tone },
    { icon: CircleStop, label: 'Revisar', value: reviewCampaign?.name ?? 'Sem desperdício crítico', detail: reviewCampaign ? `${formatBRL(reviewCampaign.spend)} investidos · ${reviewCampaign.roas.toFixed(2)}x ROAS` : 'Nenhuma campanha abaixo de 1x com investimento.', badge: reviewCampaign ? 'Ação necessária' : 'Saudável', tone: reviewCampaign ? 'bad' as Tone : 'good' as Tone },
    { icon: WalletCards, label: 'Orçamento', value: goals?.spend_goal ? `${formatPercent((rollup.spend / goals.spend_goal) * 100, 0)} utilizado` : formatBRL(rollup.spend), detail: goals?.spend_goal ? `${formatBRL(rollup.spend)} de ${formatBRL(goals.spend_goal)}` : 'Defina uma meta de investimento para acompanhar pacing.', badge: goals?.spend_goal ? 'Meta ativa' : 'Sem meta', tone: 'warn' as Tone },
    { icon: Fingerprint, label: 'Tracking', value: formatPercent(attributionRate, 1), detail: `${formatNumber(attributedSales)} de ${formatNumber(current.salesCount)} vendas atribuídas`, badge: attributionRate >= 80 ? 'Confiável' : 'Melhorar', tone: attributionRate >= 80 ? 'info' as Tone : 'warn' as Tone },
  ];

  const chartData = currentSeries.map((point, index) => ({
    date: formatDateShort(point.date),
    investimento: point.spend,
    receita: point.revenue,
    leads: point.uniqueLeadsReceived,
    vendas: point.sales,
    roas: point.spend > 0 ? point.revenue / point.spend : 0,
    roasAnterior: previousSeries[index]?.spend ? previousSeries[index].revenue / previousSeries[index].spend : null,
  }));
  const funnel = [
    { label: 'Impressões', value: rollup.impressions, tone: 'brand' as Tone },
    { label: 'Cliques no link', value: rollup.linkClicks, tone: 'info' as Tone },
    { label: 'Leads Meta', value: rollup.leadsCount, tone: 'brand' as Tone },
    { label: 'Leads únicos CRM', value: current.uniqueLeads, tone: 'good' as Tone },
    { label: 'Vendas', value: current.salesCount, tone: 'warn' as Tone },
  ];
  const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, '0')}h`,
    atual: leadEvents.filter((event) => new Date(event.occurred_at).getHours() === hour).length,
    anterior: previousLeadEvents.filter((event) => new Date(event.occurred_at).getHours() === hour).length,
  }));
  const matrix = campaignRows.filter((row) => row.spend > 0).map((row) => ({ ...row, x: row.cpl, y: row.roas, z: Math.max(80, Math.min(800, row.spend / 4)) }));
  const creatives = [...adRows].sort((a, b) => b.score - a.score || b.leads - a.leads).slice(0, 6);
  const alerts = [
    ...(reviewCampaign ? [{ tone: 'bad' as Tone, title: 'Campanha consumindo verba com baixo retorno', detail: `${reviewCampaign.name}: ${formatBRL(reviewCampaign.spend)} investidos e ${reviewCampaign.roas.toFixed(2)}x de ROAS.` }] : []),
    ...(rollup.frequency > 4 ? [{ tone: 'warn' as Tone, title: 'Frequência acima da faixa saudável', detail: `${rollup.frequency.toFixed(2)} exposições médias. Avalie fadiga de criativo e expansão de público.` }] : []),
    ...(metaToCrm < 70 && rollup.leadsCount > 0 ? [{ tone: 'warn' as Tone, title: 'Diferença entre Meta e CRM', detail: `O CRM recebeu ${formatPercent(metaToCrm, 1)} dos leads reportados pela Meta.` }] : []),
    ...(attributionRate < 80 && current.salesCount > 0 ? [{ tone: 'info' as Tone, title: 'Atribuição comercial incompleta', detail: `${formatPercent(attributionRate, 1)} das vendas possuem campanha identificada.` }] : []),
  ];

  function toggleSort(next: SortKey) {
    if (next === sortKey) setSortAsc((value) => !value);
    else { setSortKey(next); setSortAsc(next === 'cpl' || next === 'cac'); }
  }

  const metricsNavigation = (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-1.5">
      <button type="button" onClick={() => setMetricsView('overview')} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${metricsView === 'overview' ? 'bg-[var(--color-brand)] text-white shadow-lg' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]'}`}><BarChart3 size={14} /> Visão geral</button>
      <button type="button" onClick={() => setMetricsView('sales-ranking')} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${metricsView === 'sales-ranking' ? 'bg-[var(--color-brand)] text-white shadow-lg' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]'}`}><Medal size={14} /> Ranking de vendas</button>
    </div>
  );

  if (metricsView === 'sales-ranking') {
    const rankingRows = [...(level === 'campaign' ? campaignRows : level === 'adset' ? adsetRows : adRows)]
      .filter((row) => row.sales > 0)
      .sort((a, b) => b.sales - a.sales || b.revenue - a.revenue || a.cac - b.cac);
    return (
      <div className="flex flex-col gap-5">
        {metricsNavigation}
        <SalesRankingView rows={rankingRows} level={level} onLevelChange={setLevel} onSelect={setSelected} />
        {selected && <DetailDrawer row={selected} onClose={() => setSelected(null)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {metricsNavigation}
      <SectionHeader eyebrow="Ação imediata" title="Centro de decisão" description="Recomendações automáticas calculadas sobre mídia, CRM, vendas e metas reais." />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {decisions.map((item) => <DecisionCard key={item.label} {...item} />)}
      </section>

      <SectionHeader eyebrow="Visão executiva" title="Indicadores principais" description="Período atual comparado com a janela anterior de mesma duração." />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((item) => <KpiCard key={item.label} {...item} />)}
      </section>

      {false && <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel icon={BarChart3} title="Resultado financeiro e comercial" description="Receita, investimento, leads e vendas por dia.">
          <div className="h-80"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData}><CartesianGrid stroke="var(--color-border-soft)" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} stroke="var(--color-text-faint)" /><YAxis yAxisId="money" tickLine={false} axisLine={false} fontSize={10} width={52} stroke="var(--color-text-faint)" tickFormatter={(value) => Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(0)}k` : String(value)} /><YAxis yAxisId="volume" orientation="right" tickLine={false} axisLine={false} fontSize={10} width={28} stroke="var(--color-text-faint)" /><Tooltip content={<ChartTooltip />} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area yAxisId="money" dataKey="receita" name="Receita" stroke="var(--color-good)" fill="var(--color-good)" fillOpacity={0.12} strokeWidth={2} /><Line yAxisId="money" dataKey="investimento" name="Investimento" stroke="var(--color-brand)" dot={false} strokeWidth={2} /><Bar yAxisId="volume" dataKey="leads" name="Leads" fill="var(--color-info)" opacity={0.65} radius={[4, 4, 0, 0]} /><Line yAxisId="volume" dataKey="vendas" name="Vendas" stroke="var(--color-warn)" strokeWidth={2} /></ComposedChart></ResponsiveContainer></div>
        </Panel>
        <Panel icon={Gauge} title="Funil real de aquisição" description="Conversão entre cada etapa medida.">
          <div className="space-y-2.5">{funnel.map((stage, index) => { const previousValue = funnel[index - 1]?.value ?? 0; const rate = previousValue > 0 ? (stage.value / previousValue) * 100 : 100; return <div key={stage.label} className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] text-[var(--color-text-muted)]">{stage.label}</p><p className="mt-0.5 text-lg font-semibold text-[var(--color-text)]">{formatNumber(stage.value)}</p></div>{index > 0 && <span className="rounded-full px-2 py-1 text-[9px] font-semibold" style={{ color: tones[stage.tone].color, background: tones[stage.tone].soft }}>{formatPercent(rate, 2)}</span>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]"><div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, index === 0 ? 100 : rate))}%`, background: tones[stage.tone].color }} /></div></div>; })}</div>
        </Panel>
      </section>}

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel icon={Target} title="Matriz de eficiência" description="CPL x ROAS por campanha; o tamanho representa investimento.">
          {matrix.length > 0 ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 10, right: 15, bottom: 5, left: 0 }}><CartesianGrid stroke="var(--color-border-soft)" /><XAxis type="number" dataKey="x" name="CPL" tickLine={false} fontSize={10} stroke="var(--color-text-faint)" tickFormatter={(value) => `R$${Number(value).toFixed(0)}`} /><YAxis type="number" dataKey="y" name="ROAS" tickLine={false} fontSize={10} stroke="var(--color-text-faint)" tickFormatter={(value) => `${Number(value).toFixed(1)}x`} /><ZAxis type="number" dataKey="z" range={[80, 800]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} content={<MatrixTooltip />} /><Scatter data={matrix} fill="var(--color-brand)">{matrix.map((row) => <Cell key={row.id} fill={row.roas >= 2 ? 'var(--color-good)' : row.roas >= 1 ? 'var(--color-warn)' : 'var(--color-bad)'} />)}</Scatter></ScatterChart></ResponsiveContainer></div> : <EmptyState text="Sem campanhas com investimento no período." />}
        </Panel>
        <Panel icon={Layers3} title="Leads por hora" description="Comparação da distribuição horária atual com o período anterior analisado.">
          <div className="mb-3 flex items-center justify-end gap-3 text-[10px] text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[var(--color-brand)]" /> Atual</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[var(--color-text-faint)]" /> Período anterior</span></div><div className="h-72"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={hourlyData}><CartesianGrid stroke="var(--color-border-soft)" vertical={false} /><XAxis dataKey="hour" interval={2} tickLine={false} axisLine={false} fontSize={9} stroke="var(--color-text-faint)" /><YAxis tickLine={false} axisLine={false} fontSize={10} stroke="var(--color-text-faint)" allowDecimals={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey="atual" name="Atual" type="monotone" stroke="var(--color-brand)" fill="var(--color-brand)" fillOpacity={0.14} strokeWidth={2} /><Line dataKey="anterior" name="Período anterior" type="monotone" stroke="var(--color-text-faint)" strokeDasharray="5 4" dot={false} strokeWidth={1.5} /></ComposedChart></ResponsiveContainer></div>
        </Panel>
      </section>

      <section>
        <SectionHeader eyebrow="Criativos" title="Ranking de anúncios" description="Peças reais ordenadas pelo score combinado de retorno, volume, tracking e frequência." />
        {creatives.length > 0 ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{creatives.map((creative, index) => <CreativeCard key={creative.id} row={creative} position={index + 1} onClick={() => setSelected(creative)} />)}</div> : <EmptyState text="Sincronize anúncios e thumbnails da Meta para visualizar os criativos." />}
      </section>

      {false && <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Panel icon={AlertTriangle} title="Alertas e oportunidades" description="Sinais gerados somente a partir dos dados disponíveis.">
          <div className="space-y-2.5">{alerts.length > 0 ? alerts.map((alert) => <AlertCard key={alert.title} {...alert} />) : <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/8 p-4"><p className="text-sm font-semibold text-emerald-300">Operação sem alertas críticos</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">Os principais indicadores estão dentro das faixas monitoradas.</p></div>}</div>
        </Panel>
        <Panel icon={TrendingUp} title="Tendência de retorno" description="ROAS diário atual comparado ao período anterior.">
          <div className="h-72"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData}><CartesianGrid stroke="var(--color-border-soft)" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} stroke="var(--color-text-faint)" /><YAxis tickLine={false} axisLine={false} fontSize={10} stroke="var(--color-text-faint)" tickFormatter={(value) => `${Number(value).toFixed(1)}x`} /><Tooltip content={<ChartTooltip />} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area dataKey="roas" name="ROAS atual" stroke="var(--color-good)" fill="var(--color-good)" fillOpacity={0.12} strokeWidth={2} /><Line dataKey="roasAnterior" name="Período anterior" stroke="var(--color-text-faint)" strokeDasharray="5 4" dot={false} /></ComposedChart></ResponsiveContainer></div>
        </Panel>
      </section>}

      <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="border-b border-[var(--color-border)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BarChart3 size={16} className="text-[var(--color-brand)]" /><h2 className="font-semibold text-[var(--color-text)]">Detalhamento de performance</h2></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">Explore campanhas, conjuntos e anúncios com busca, filtros e ordenação.</p></div><button type="button" onClick={() => exportRows(visibleRows, level)} disabled={visibleRows.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)] disabled:opacity-40"><Download size={13} /> Exportar CSV</button></div>
          <div className="mt-4 flex flex-wrap gap-2">{(['campaign', 'adset', 'ad'] as Level[]).map((item) => <button key={item} type="button" onClick={() => setLevel(item)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${level === item ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'bg-[var(--color-panel-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{item === 'campaign' ? 'Campanhas' : item === 'adset' ? 'Conjuntos' : 'Anúncios'}</button>)}</div>
          <div className="mt-3 flex flex-wrap gap-2"><label className="flex min-w-64 flex-1 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"><Search size={13} className="text-[var(--color-text-faint)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome..." className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] outline-none"><option value="all">Todos os status</option><option value="ACTIVE">Ativos</option><option value="PAUSED">Pausados</option><option value="UNKNOWN">Sem status</option></select></div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-xs"><thead className="bg-[var(--color-panel-2)] text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]"><tr><th className="px-5 py-3">Nome</th><th className="px-3">Status</th><SortHead label="Investimento" sort="spend" active={sortKey} asc={sortAsc} onSort={toggleSort} /><th className="px-3 text-right">CTR</th><th className="px-3 text-right">Frequência</th><SortHead label="Leads" sort="leads" active={sortKey} asc={sortAsc} onSort={toggleSort} /><SortHead label="CPL" sort="cpl" active={sortKey} asc={sortAsc} onSort={toggleSort} /><SortHead label="Vendas" sort="sales" active={sortKey} asc={sortAsc} onSort={toggleSort} /><SortHead label="Receita" sort="revenue" active={sortKey} asc={sortAsc} onSort={toggleSort} /><SortHead label="CAC" sort="cac" active={sortKey} asc={sortAsc} onSort={toggleSort} /><SortHead label="ROAS" sort="roas" active={sortKey} asc={sortAsc} onSort={toggleSort} /><SortHead label="Score" sort="score" active={sortKey} asc={sortAsc} onSort={toggleSort} /></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer border-t border-[var(--color-border-soft)] transition hover:bg-[var(--color-panel-2)]"><td className="max-w-72 px-5 py-3"><div className="flex items-center gap-2">{row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><ImageIcon size={13} /></span>}<div className="min-w-0"><p className="truncate font-medium text-[var(--color-text)]">{row.name}</p><p className="truncate text-[9px] text-[var(--color-text-faint)]">{row.id}</p></div></div></td><td className="px-3"><StatusBadge status={row.status} /></td><td className="px-3 text-right">{formatBRL(row.spend)}</td><td className="px-3 text-right">{formatPercent(row.ctr, 2)}</td><td className="px-3 text-right">{row.frequency.toFixed(2)}</td><td className="px-3 text-right">{formatNumber(row.leads)}</td><td className="px-3 text-right">{row.crmLeads > 0 ? formatBRL(row.cpl) : '—'}</td><td className="px-3 text-right font-medium text-[var(--color-good)]">{formatNumber(row.sales)}</td><td className="px-3 text-right">{formatBRL(row.revenue)}</td><td className="px-3 text-right">{row.sales > 0 ? formatBRL(row.cac) : '—'}</td><td className={`px-3 text-right font-semibold ${row.roas >= 2 ? 'text-emerald-400' : row.roas > 0 ? 'text-amber-300' : 'text-[var(--color-text-faint)]'}`}>{row.revenue > 0 ? `${row.roas.toFixed(2)}x` : '—'}</td><td className="px-3 text-right"><Score value={row.score} /></td></tr>)}</tbody></table>{visibleRows.length === 0 && <EmptyState text="Nenhum registro encontrado para estes filtros." />}</div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-[10px] text-[var(--color-text-muted)]"><span>{filteredRows.length} registros · página {currentPage} de {totalPages}</span><div className="flex items-center gap-2"><label className="inline-flex items-center gap-2">Mostrar <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[10px] text-[var(--color-text)]"><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Anterior</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Próxima</button></div></div>

      {selected && <DetailDrawer row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SalesRankingView({ rows, level, onLevelChange, onSelect }: { rows: PerformanceRow[]; level: Level; onLevelChange: (level: Level) => void; onSelect: (row: PerformanceRow) => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totals = rows.reduce((acc, row) => ({ sales: acc.sales + row.sales, revenue: acc.revenue + row.revenue, spend: acc.spend + row.spend }), { sales: 0, revenue: 0, spend: 0 });
  const blendedCac = totals.sales > 0 ? totals.spend / totals.sales : 0;
  useEffect(() => { setPage(1); }, [level, pageSize]);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="border-b border-[var(--color-border)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><Medal size={17} className="text-[var(--color-warn)]" /><h2 className="font-semibold text-[var(--color-text)]">Ranking de vendas por mídia</h2></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">Vendas conciliadas por e-mail ou telefone e atribuídas pelo tracking do lead.</p></div>
          <div className="flex flex-wrap gap-2">{(['campaign', 'adset', 'ad'] as Level[]).map((item) => <button key={item} type="button" onClick={() => onLevelChange(item)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${level === item ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'bg-[var(--color-panel-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{item === 'campaign' ? 'Campanhas' : item === 'adset' ? 'Conjuntos' : 'Anúncios'}</button>)}</div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RankingTotal label="Vendas atribuídas" value={formatNumber(totals.sales)} />
          <RankingTotal label="Valor vendido" value={formatBRL(totals.revenue)} tone="good" />
          <RankingTotal label="Valor gasto" value={formatBRL(totals.spend)} />
          <RankingTotal label="CAC consolidado" value={totals.sales > 0 ? formatBRL(blendedCac) : '—'} tone="warn" />
        </div>
      </div>

      {visibleRows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-xs">
            <thead className="bg-[var(--color-panel-2)] text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]"><tr><th className="w-16 px-5 py-3 text-center">#</th><th className="w-20 px-3">Preview</th><th className="px-3">Nome</th><th className="px-3 text-right">Vendas</th><th className="px-3 text-right">Valor vendido</th><th className="px-3 text-right">Valor gasto</th><th className="px-5 text-right">CAC</th></tr></thead>
            <tbody>{visibleRows.map((row, index) => { const position = (currentPage - 1) * pageSize + index + 1; return <tr key={row.id} onClick={() => onSelect(row)} className="cursor-pointer border-t border-[var(--color-border-soft)] transition hover:bg-[var(--color-panel-2)]"><td className="px-5 py-3 text-center"><span className={`inline-grid h-7 min-w-7 place-items-center rounded-full px-1.5 text-[10px] font-bold ${position === 1 ? 'bg-amber-400/15 text-amber-300' : position === 2 ? 'bg-slate-300/10 text-slate-300' : position === 3 ? 'bg-orange-500/12 text-orange-300' : 'bg-[var(--color-panel-2)] text-[var(--color-text-muted)]'}`}>{position}</span></td><td className="px-3 py-3">{row.thumbnailUrl ? <img src={row.thumbnailUrl} alt={row.name} className="h-12 w-12 rounded-xl border border-[var(--color-border)] object-cover" loading="lazy" /> : <span className="grid h-12 w-12 place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><ImageIcon size={18} /></span>}</td><td className="max-w-md px-3 py-3"><p className="truncate font-semibold text-[var(--color-text)]" title={row.name}>{row.name}</p><p className="mt-1 truncate text-[9px] text-[var(--color-text-faint)]">{row.id}</p></td><td className="px-3 py-3 text-right text-base font-bold text-[var(--color-good)]">{formatNumber(row.sales)}</td><td className="px-3 py-3 text-right font-semibold text-[var(--color-text)]">{formatBRL(row.revenue)}</td><td className="px-3 py-3 text-right text-[var(--color-text-muted)]">{formatBRL(row.spend)}</td><td className="px-5 py-3 text-right font-semibold text-[var(--color-warn)]">{formatBRL(row.cac)}</td></tr>; })}</tbody>
          </table>
        </div>
      ) : <EmptyState text="Nenhuma venda atribuída neste nível para o período selecionado." />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-3 text-[10px] text-[var(--color-text-muted)]"><span>{rows.length} itens com venda · página {currentPage} de {totalPages}</span><div className="flex items-center gap-2"><label className="inline-flex items-center gap-2">Mostrar <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-text)]"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Anterior</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-md border border-[var(--color-border)] px-2 py-1 disabled:opacity-40">Próxima</button></div></div>
    </section>
  );
}

function RankingTotal({ label, value, tone = 'brand' }: { label: string; value: string; tone?: Tone }) {
  return <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-4"><p className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</p><p className="mt-2 text-lg font-semibold" style={{ color: tones[tone].color }}>{value}</p></div>;
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--color-brand)]">{eyebrow}</p><h2 className="mt-1 text-base font-semibold text-[var(--color-text)]">{title}</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">{description}</p></div><span className="rounded-full border border-emerald-400/15 bg-emerald-400/8 px-2.5 py-1 text-[9px] font-semibold text-emerald-300">Dados reais</span></div>;
}

function Panel({ icon: Icon, title, description, children }: { icon: ComponentType<{ size?: number; className?: string }>; title: string; description: string; children: React.ReactNode }) {
  return <article className="rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-panel),#0d0e13)] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.14)]"><div className="mb-5 flex items-start gap-2.5"><span className="rounded-lg bg-[var(--color-brand-soft)] p-2 text-[var(--color-brand)]"><Icon size={15} /></span><div><h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2><p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{description}</p></div></div>{children}</article>;
}

function DecisionCard({ icon: Icon, label, value, detail, badge, tone }: { icon: ComponentType<{ size?: number }>; label: string; value: string; detail: string; badge: string; tone: Tone }) {
  const palette = tones[tone];
  return <article className="group relative min-h-44 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-panel),#0d0e13)] p-4 shadow-[0_16px_45px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-[var(--color-text-faint)]"><div className="absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-25 blur-2xl" style={{ background: palette.color }} /><div className="relative flex items-center justify-between gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl" style={{ color: palette.color, background: palette.soft }}><Icon size={16} /></span><span className="rounded-full px-2 py-1 text-[9px] font-semibold" style={{ color: palette.color, background: palette.soft }}>{badge}</span></div><p className="relative mt-4 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</p><p className="relative mt-1 truncate text-sm font-semibold text-[var(--color-text)]" title={value}>{value}</p><p className="relative mt-2 text-[10px] leading-relaxed text-[var(--color-text-muted)]">{detail}</p></article>;
}

function KpiCard({ icon: Icon, label, value, delta, good, tone, spark }: { icon: ComponentType<{ size?: number }>; label: string; value: string; delta: number | null; good: boolean; tone: Tone; spark: number[] }) {
  const palette = tones[tone];
  const rising = (delta ?? 0) >= 0;
  const favorable = delta === null || (rising ? good : !good);
  return <article className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"><div className="flex items-center justify-between"><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: palette.color, background: palette.soft }}><Icon size={14} /></span><span className="inline-flex items-center gap-1 text-[9px] font-semibold" style={{ color: delta === null ? 'var(--color-text-faint)' : favorable ? 'var(--color-good)' : 'var(--color-bad)' }}>{delta === null ? 'novo' : <>{rising ? <ArrowUp size={10} /> : <ArrowDown size={10} />}{Math.abs(delta).toFixed(0)}%</>}</span></div><p className="mt-4 text-xl font-semibold tracking-tight text-[var(--color-text)]">{value}</p><p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{label}</p><div className="mt-3"><Sparkline data={spark} color={palette.color} /></div></article>;
}

export function BudgetPacingPanel({ goal, spend, series, dateRange }: { goal: number; spend: number; series: DailyPoint[]; dateRange: { start: string; end: string } }) {
  const totalDays = Math.max(1, Math.round((new Date(`${dateRange.end}T00:00:00`).getTime() - new Date(`${dateRange.start}T00:00:00`).getTime()) / 86400000) + 1);
  const elapsedDays = Math.max(1, series.length || totalDays);
  const pct = goal > 0 ? Math.min(100, (spend / goal) * 100) : 0;
  const expected = goal > 0 ? goal * Math.min(1, elapsedDays / totalDays) : 0;
  const projected = elapsedDays > 0 ? (spend / elapsedDays) * totalDays : 0;
  const delta = spend - expected;
  const chartData = series.reduce<Array<{ date: string; realizado: number; planejado: number | null }>>((acc, point, index) => {
    const realizado = (acc[index - 1]?.realizado ?? 0) + point.spend;
    acc.push({ date: formatDateShort(point.date), realizado, planejado: goal > 0 ? goal * ((index + 1) / totalDays) : null });
    return acc;
  }, []);
  return <div className="space-y-5"><div className="grid gap-5 lg:grid-cols-[180px_1fr] lg:items-center"><div className="mx-auto grid h-36 w-36 place-items-center rounded-full" style={{ background: `conic-gradient(var(--color-brand) ${pct}%, #182235 0)` }}><div className="grid h-28 w-28 place-items-center rounded-full bg-[var(--color-panel)] text-center"><div><p className="text-2xl font-bold text-[var(--color-text)]">{goal > 0 ? `${pct.toFixed(0)}%` : '—'}</p><p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{formatBRL(spend)}</p></div></div></div><div className="space-y-2.5"><PacingLine label="Esperado até hoje" value={goal > 0 ? formatBRL(expected) : '—'} tone="brand" /><PacingLine label="Diferença de ritmo" value={goal > 0 ? `${delta >= 0 ? '+' : ''}${formatBRL(delta)}` : '—'} tone={delta > 0 ? 'warn' : 'good'} /><PacingLine label="Projeção do período" value={goal > 0 ? formatBRL(projected) : '—'} tone={projected > goal && goal > 0 ? 'warn' : 'good'} /><PacingLine label="Meta configurada" value={goal > 0 ? formatBRL(goal) : 'Defina uma meta'} tone="info" /></div></div><div><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold text-[var(--color-text-muted)]">Realizado x planejado</p><span className="text-[9px] text-[var(--color-text-faint)]">Acumulado</span></div><div className="h-36"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData}><CartesianGrid stroke="var(--color-border-soft)" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={9} stroke="var(--color-text-faint)" /><YAxis tickLine={false} axisLine={false} fontSize={9} width={42} stroke="var(--color-text-faint)" tickFormatter={(value) => Number(value) >= 1000 ? `R$${(Number(value) / 1000).toFixed(0)}k` : `R$${value}`} /><Tooltip content={<ChartTooltip />} /><Line dataKey="realizado" name="Realizado" stroke="var(--color-brand)" strokeWidth={2} dot={false} /><Line dataKey="planejado" name="Planejado" stroke="var(--color-text-faint)" strokeDasharray="5 4" dot={false} /></ComposedChart></ResponsiveContainer></div></div></div>;
}

export function PacingLine({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] pb-2 text-[10px]"><span className="text-[var(--color-text-muted)]">{label}</span><b style={{ color: tones[tone].color }}>{value}</b></div>;
}

export function TrackingHealthPanel({ metaToCrm, attributionRate, landingRate, duplicateRate, leadEvents, totalLeads }: { metaToCrm: number; attributionRate: number; landingRate: number; duplicateRate: number; leadEvents: LeadEventRow[]; totalLeads: number }) {
  const utmCovered = leadEvents.filter((event) => Boolean(event.utm_source || event.utm_medium || event.utm_campaign || event.utm_content || event.utm_term)).length;
  const utmRate = leadEvents.length > 0 ? (utmCovered / leadEvents.length) * 100 : 0;
  const connectRate = totalLeads > 0 ? ((totalLeads - Math.max(0, totalLeads - Math.round(totalLeads * (metaToCrm / 100)))) / totalLeads) * 100 : metaToCrm;
  return <div className="grid grid-cols-2 gap-3"><HealthMetric label="Connect Rate" value={connectRate} detail={`${formatNumber(totalLeads)} eventos recebidos`} /><HealthMetric label="Cobertura UTM" value={utmRate} detail={`${formatNumber(utmCovered)} leads com UTMs`} /><HealthMetric label="Webhook sucesso" value="N/D" detail="O histórico de retry não está exposto nesta consulta" /><HealthMetric label="Vendas conciliadas" value={attributionRate} detail={`${formatPercent(duplicateRate, 1)} de recorrência · landing ${formatPercent(landingRate, 1)}`} /></div>;
}

export function HealthMetric({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  const numeric = typeof value === 'number' ? value : null;
  const tone: Tone = numeric === null ? 'info' : numeric >= 90 ? 'good' : numeric >= 70 ? 'warn' : 'bad';
  return <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-4"><div className="flex items-center justify-between"><p className="text-[10px] text-[var(--color-text-muted)]">{label}</p><span className="h-2 w-2 rounded-full" style={{ background: tones[tone].color }} /></div><p className="mt-3 text-xl font-semibold text-[var(--color-text)]">{numeric === null ? value : formatPercent(numeric, 1)}</p><p className="mt-1 text-[9px] leading-relaxed text-[var(--color-text-faint)]">{detail}</p></div>;
}

function CreativeCard({ row, position, onClick }: { row: PerformanceRow; position: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="group overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] text-left transition hover:-translate-y-0.5 hover:border-[var(--color-brand)]"><div className="flex justify-center border-b border-[var(--color-border-soft)] bg-[linear-gradient(135deg,var(--color-brand-soft),var(--color-violet-soft))] py-3"><div className="relative h-28 w-28 overflow-hidden rounded-xl border border-white/10 bg-[var(--color-panel-2)] shadow-lg">{row.thumbnailUrl ? <img src={row.thumbnailUrl} alt={row.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="grid h-full place-items-center text-[var(--color-brand)]"><ImageIcon size={25} /></div>}<span className="absolute left-2 top-2 rounded-full bg-black/70 px-1.5 py-1 text-[8px] font-bold text-white">#{position}</span><span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-1.5 py-1 text-[8px] font-bold text-white">{row.score}</span></div></div><div className="p-3"><p className="truncate text-xs font-semibold text-[var(--color-text)]">{row.name}</p><div className="mt-2 grid grid-cols-4 gap-2"><TinyMetric label="Leads" value={formatNumber(row.leads)} /><TinyMetric label="CPL" value={row.crmLeads > 0 ? formatBRL(row.cpl) : '—'} /><TinyMetric label="Vendas" value={formatNumber(row.sales)} /><TinyMetric label="ROAS" value={row.revenue > 0 ? `${row.roas.toFixed(2)}x` : '—'} /></div></div></button>;
}

function TinyMetric({ label, value }: { label: string; value: string }) {
  return <div><p className="truncate text-xs font-semibold text-[var(--color-text)]">{value}</p><p className="mt-0.5 text-[8px] text-[var(--color-text-faint)]">{label}</p></div>;
}

function AlertCard({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  return <div className="flex gap-3 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-3"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ color: tones[tone].color, background: tones[tone].soft }}><AlertTriangle size={13} /></span><div><p className="text-xs font-semibold text-[var(--color-text)]">{title}</p><p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">{detail}</p></div></div>;
}

function StatusBadge({ status }: { status: string }) {
  const active = status.toUpperCase() === 'ACTIVE';
  const paused = status.toUpperCase() === 'PAUSED';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ${active ? 'bg-emerald-500/10 text-emerald-300' : paused ? 'bg-amber-500/10 text-amber-300' : 'bg-white/5 text-[var(--color-text-faint)]'}`}><i className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : paused ? 'bg-amber-400' : 'bg-[var(--color-text-faint)]'}`} />{statusLabel(status)}</span>;
}

function Score({ value }: { value: number }) {
  const tone: Tone = value >= 75 ? 'good' : value >= 50 ? 'warn' : 'bad';
  return <span className="inline-flex min-w-8 justify-center rounded-lg px-2 py-1 text-[10px] font-bold" style={{ color: tones[tone].color, background: tones[tone].soft }}>{value}</span>;
}

function SortHead({ label, sort, active, asc, onSort }: { label: string; sort: SortKey; active: SortKey; asc: boolean; onSort: (key: SortKey) => void }) {
  return <th className="px-3 text-right"><button type="button" onClick={() => onSort(sort)} className="inline-flex items-center gap-1 hover:text-[var(--color-text)]">{label}{active === sort && (asc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}</button></th>;
}

function DetailDrawer({ row, onClose }: { row: PerformanceRow; onClose: () => void }) {
  const recommendation = row.roas >= 2 ? 'Bom candidato para escala gradual. Monitore CPL, frequência e estabilidade das vendas antes de aumentar orçamento.' : row.spend > 0 && row.sales === 0 ? 'Prioridade de revisão: existe investimento sem venda atribuída. Valide criativo, página, tracking e público.' : 'Mantenha em observação e compare com outros ativos antes de alterar orçamento.';
  return <><button type="button" aria-label="Fechar detalhes" onClick={onClose} className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" /><aside className="fixed bottom-0 right-0 top-0 z-[90] w-full max-w-lg overflow-y-auto border-l border-[var(--color-border)] bg-[#0b0d12] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-brand)]">Diagnóstico detalhado</p><h2 className="mt-2 text-lg font-semibold text-[var(--color-text)]">{row.name}</h2><p className="mt-1 text-[10px] text-[var(--color-text-faint)]">{row.id}</p></div><button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><X size={15} /></button></div>{row.thumbnailUrl && <img src={row.thumbnailUrl} alt={row.name} className="mt-5 h-48 w-full rounded-2xl object-cover" />}<div className="mt-5 grid grid-cols-2 gap-3"><DrawerMetric label="Investimento" value={formatBRL(row.spend)} /><DrawerMetric label="Receita" value={formatBRL(row.revenue)} /><DrawerMetric label="Leads Meta" value={formatNumber(row.leads)} /><DrawerMetric label="Leads CRM" value={formatNumber(row.crmLeads)} /><DrawerMetric label="Vendas" value={formatNumber(row.sales)} /><DrawerMetric label="ROAS" value={row.revenue > 0 ? `${row.roas.toFixed(2)}x` : '—'} /><DrawerMetric label="CPL" value={row.crmLeads > 0 ? formatBRL(row.cpl) : '—'} /><DrawerMetric label="CAC" value={row.sales > 0 ? formatBRL(row.cac) : '—'} /></div><div className="mt-5 rounded-2xl border border-[var(--color-brand)]/20 bg-[var(--color-brand-soft)] p-4"><div className="flex items-center gap-2 text-[var(--color-brand)]"><Sparkles size={14} /><p className="text-xs font-semibold">Recomendação</p></div><p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">{recommendation}</p></div><div className="mt-5 grid grid-cols-2 gap-3"><DrawerMetric label="CTR" value={formatPercent(row.ctr, 2)} /><DrawerMetric label="CPM" value={formatBRL(row.cpm)} /><DrawerMetric label="Frequência" value={row.frequency.toFixed(2)} /><DrawerMetric label="Score" value={`${row.score}/100`} /></div></aside></>;
}

function DrawerMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel)] p-4"><p className="text-[9px] text-[var(--color-text-faint)]">{label}</p><p className="mt-1 text-base font-semibold text-[var(--color-text)]">{value}</p></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="grid min-h-40 place-items-center p-8 text-center"><div><BarChart3 size={22} className="mx-auto text-[var(--color-text-faint)]" /><p className="mt-2 text-xs text-[var(--color-text-muted)]">{text}</p></div></div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-[var(--color-border)] bg-[#11131a] p-3 shadow-xl"><p className="mb-2 text-[10px] font-semibold text-[var(--color-text)]">{label}</p>{payload.map((item) => <div key={item.name} className="flex min-w-36 items-center justify-between gap-4 text-[10px]"><span style={{ color: item.color }}>{item.name}</span><b className="text-[var(--color-text)]">{item.name?.toLowerCase().includes('receita') || item.name?.toLowerCase().includes('investimento') ? formatBRL(Number(item.value ?? 0)) : item.name?.toLowerCase().includes('roas') ? `${Number(item.value ?? 0).toFixed(2)}x` : formatNumber(Number(item.value ?? 0))}</b></div>)}</div>;
}

function MatrixTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: PerformanceRow }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="max-w-60 rounded-xl border border-[var(--color-border)] bg-[#11131a] p-3 shadow-xl"><p className="truncate text-xs font-semibold text-[var(--color-text)]">{row.name}</p><p className="mt-2 text-[10px] text-[var(--color-text-muted)]">CPL {formatBRL(row.cpl)} · ROAS {row.roas.toFixed(2)}x</p><p className="mt-1 text-[10px] text-[var(--color-text-faint)]">Investimento {formatBRL(row.spend)}</p></div>;
}
