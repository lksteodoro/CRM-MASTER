import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  CircleDollarSign,
  CircleStop,
  Download,
  Eye,
  Fingerprint,
  Gauge,
  Lightbulb,
  MousePointerClick,
  Receipt,
  ShoppingCart,
  Target,
  TrendingUp,
  Users2,
  Wallet,
  WalletCards,
  Zap,
} from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyPoint, PeriodData } from '../../lib/metricsTrend';
import type { LeadEventRow, MetaAdInsightDailyRow, SaleRow } from '../../integrations/supabase/database.types';
import type { MetaAdsManagerMetrics } from '../../services/metaAds.service';
import { deltaPct, DeltaBadge } from './DeltaBadge';
import { formatBRL, formatDateShort, formatNumber, formatPercent } from '../../lib/format';
import { Sparkline } from './Sparkline';

interface CampaignPerformance {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  metaLeads: number;
  crmLeads: number;
  sales: number;
  revenue: number;
}

function campaignRoas(row: CampaignPerformance) {
  return row.spend > 0 ? row.revenue / row.spend : 0;
}

function exportCampaigns(rows: CampaignPerformance[]) {
  const header = ['Campanha', 'ID', 'Investimento', 'Leads Meta', 'Leads CRM', 'Vendas', 'Receita', 'CPL', 'CPA', 'ROAS'];
  const body = rows.map((row) => [
    row.name,
    row.id,
    row.spend,
    row.metaLeads,
    row.crmLeads,
    row.sales,
    row.revenue,
    row.crmLeads > 0 ? row.spend / row.crmLeads : 0,
    row.sales > 0 ? row.spend / row.sales : 0,
    campaignRoas(row),
  ]);
  const csv = [header, ...body]
    .map((columns) => columns.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `rentabilidade-campanhas-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildCampaignPerformance(adInsights: MetaAdInsightDailyRow[], leadEvents: LeadEventRow[], sales: SaleRow[]) {
  const campaigns = new Map<string, CampaignPerformance>();
  const normalizeName = (value: string | null | undefined) => (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const campaignByName = new Map<string, string>();
  const getCampaign = (id: string, name = 'Campanha não identificada') => {
    let row = campaigns.get(id);
    if (!row) {
      row = { id, name, spend: 0, impressions: 0, clicks: 0, metaLeads: 0, crmLeads: 0, sales: 0, revenue: 0 };
      campaigns.set(id, row);
    }
    if (name && row.name === 'Campanha não identificada') row.name = name;
    return row;
  };

  for (const insight of adInsights) {
    const normalized = normalizeName(insight.campaign_name);
    if (normalized) campaignByName.set(normalized, insight.campaign_id);
    const row = getCampaign(insight.campaign_id, insight.campaign_name);
    row.spend += Number(insight.spend);
    row.impressions += insight.impressions;
    row.clicks += insight.clicks;
    row.metaLeads += insight.leads;
  }

  const uniqueContacts = new Map<string, Set<string>>();
  for (const event of leadEvents) {
    const campaignId = event.campaign_id ?? campaignByName.get(normalizeName(event.utm_campaign));
    if (!campaignId) continue;
    const contacts = uniqueContacts.get(campaignId) ?? new Set<string>();
    contacts.add(event.contact_id);
    uniqueContacts.set(campaignId, contacts);
    getCampaign(campaignId, event.utm_campaign ?? undefined);
  }
  for (const [campaignId, contacts] of uniqueContacts) getCampaign(campaignId).crmLeads = contacts.size;

  const leadById = new Map(leadEvents.map((event) => [event.id, event]));
  const leadsByContact = new Map<string, LeadEventRow[]>();
  for (const event of leadEvents) {
    const rows = leadsByContact.get(event.contact_id) ?? [];
    rows.push(event);
    leadsByContact.set(event.contact_id, rows);
  }
  for (const rows of leadsByContact.values()) rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  let attributedSales = 0;
  for (const sale of sales) {
    const linked = sale.lead_event_id ? leadById.get(sale.lead_event_id) : undefined;
    const fallback = leadsByContact.get(sale.contact_id)?.find((event) => event.occurred_at <= sale.sold_at);
    const event = linked ?? fallback;
    const campaignId = event?.campaign_id ?? campaignByName.get(normalizeName(event?.utm_campaign));
    if (!campaignId) continue;
    const row = getCampaign(campaignId, event?.utm_campaign ?? undefined);
    row.sales += 1;
    row.revenue += sale.amount ?? 0;
    attributedSales += 1;
  }

  return {
    rows: Array.from(campaigns.values()).sort((a, b) => b.revenue - a.revenue || b.metaLeads - a.metaLeads || b.spend - a.spend),
    attributedSales,
  };
}

export function MetricsSummaryTab({
  current,
  previous,
  currentSeries,
  adInsights,
  leadEvents,
  sales,
  metaSummary,
}: {
  current: PeriodData;
  previous: PeriodData;
  currentSeries: DailyPoint[];
  adInsights: MetaAdInsightDailyRow[];
  leadEvents: LeadEventRow[];
  sales: SaleRow[];
  metaSummary: MetaAdsManagerMetrics | null;
}) {
  const { rollup } = current;
  const cpl = current.uniqueLeads > 0 ? rollup.spend / current.uniqueLeads : 0;
  const cpa = current.salesCount > 0 ? rollup.spend / current.salesCount : 0;
  const roas = rollup.spend > 0 ? current.revenue / rollup.spend : 0;
  const conversion = current.uniqueLeads > 0 ? (current.salesCount / current.uniqueLeads) * 100 : 0;
  const ticket = current.salesCount > 0 ? current.revenue / current.salesCount : 0;
  const duplicateRate = current.totalLeads > 0 ? ((current.totalLeads - current.uniqueLeads) / current.totalLeads) * 100 : 0;
  const metaToCrm = rollup.leadsCount > 0 ? (current.uniqueLeads / rollup.leadsCount) * 100 : 0;
  const { rows: campaignRows, attributedSales } = buildCampaignPerformance(adInsights, leadEvents, sales);
  const attributionRate = current.salesCount > 0 ? (attributedSales / current.salesCount) * 100 : 0;
  const managerMetrics = metaSummary ?? {
    spend: rollup.spend,
    impressions: rollup.impressions,
    clicks: rollup.clicks,
    link_clicks: rollup.linkClicks,
    outbound_clicks: adInsights.reduce((sum, row) => sum + row.outbound_clicks, 0),
    reach: rollup.reach,
    frequency: rollup.frequency,
    ctr: rollup.ctr,
    cpc: rollup.cpc,
    cpm: rollup.cpm,
    leads: rollup.leadsCount,
    landing_page_views: adInsights.reduce((sum, row) => sum + row.landing_page_views, 0),
    post_engagement: adInsights.reduce((sum, row) => sum + row.post_engagement, 0),
    video_views: adInsights.reduce((sum, row) => sum + row.video_views, 0),
    thruplays: adInsights.reduce((sum, row) => sum + row.thruplays, 0),
    purchases: adInsights.reduce((sum, row) => sum + row.purchases, 0),
    purchase_value: adInsights.reduce((sum, row) => sum + Number(row.purchase_value), 0),
    messaging_conversations_started: adInsights.reduce((sum, row) => sum + row.messaging_conversations_started, 0),
    purchase_roas: 0,
    actions: [], action_values: [], cost_per_action_type: [],
  };

  const prevCpl = previous.uniqueLeads > 0 ? previous.rollup.spend / previous.uniqueLeads : 0;
  const prevCpa = previous.salesCount > 0 ? previous.rollup.spend / previous.salesCount : 0;
  const prevRoas = previous.rollup.spend > 0 ? previous.revenue / previous.rollup.spend : 0;
  const prevConversion = previous.uniqueLeads > 0 ? (previous.salesCount / previous.uniqueLeads) * 100 : 0;

  const kpis = [
    { icon: Wallet, label: 'Investimento Meta', value: formatBRL(rollup.spend), delta: deltaPct(rollup.spend, previous.rollup.spend), good: false, spark: currentSeries.map((day) => day.spend) },
    { icon: Fingerprint, label: 'Leads únicos CRM', value: formatNumber(current.uniqueLeads), delta: deltaPct(current.uniqueLeads, previous.uniqueLeads), good: true, spark: currentSeries.map((day) => day.uniqueLeadsReceived) },
    { icon: Target, label: 'CPL único', value: formatBRL(cpl), delta: deltaPct(cpl, prevCpl), good: false, spark: currentSeries.map((day) => day.uniqueLeadsReceived > 0 ? day.spend / day.uniqueLeadsReceived : 0) },
    { icon: ShoppingCart, label: 'Vendas', value: formatNumber(current.salesCount), delta: deltaPct(current.salesCount, previous.salesCount), good: true, spark: currentSeries.map((day) => day.sales) },
    { icon: CircleDollarSign, label: 'CPA', value: formatBRL(cpa), delta: deltaPct(cpa, prevCpa), good: false, spark: currentSeries.map((day) => day.sales > 0 ? day.spend / day.sales : 0) },
    { icon: TrendingUp, label: 'ROAS', value: `${roas.toFixed(2)}x`, delta: deltaPct(roas, prevRoas), good: true, spark: currentSeries.map((day) => day.spend > 0 ? day.revenue / day.spend : 0) },
  ];

  const funnel = [
    { label: 'Impressões', value: rollup.impressions, icon: Eye, tone: 'var(--color-brand)' },
    { label: 'Cliques no link', value: rollup.linkClicks, icon: MousePointerClick, tone: 'var(--color-info)' },
    { label: 'Leads Meta', value: rollup.leadsCount, icon: BadgeCheck, tone: 'var(--color-violet)' },
    { label: 'Leads únicos CRM', value: current.uniqueLeads, icon: Users2, tone: 'var(--color-good)' },
    { label: 'Vendas', value: current.salesCount, icon: ShoppingCart, tone: 'var(--color-warn)' },
  ];

  const chartData = currentSeries.map((day) => ({
    date: formatDateShort(day.date),
    investimento: day.spend,
    receita: day.revenue,
    leads: day.uniqueLeadsReceived,
    vendas: day.sales,
  }));

  const insights = [
    roas >= 3 ? `ROAS saudável de ${roas.toFixed(2)}x: a operação devolve ${formatBRL(roas)} para cada R$ 1 investido.` : roas > 0 ? `ROAS de ${roas.toFixed(2)}x pede revisão de campanhas com gasto e pouca receita atribuída.` : 'Ainda não há receita atribuída para calcular retorno real.',
    duplicateRate > 20 ? `${formatPercent(duplicateRate, 1)} das entradas são recorrências; acompanhe leads únicos para não subestimar o CPL.` : `A duplicidade está controlada em ${formatPercent(duplicateRate, 1)} das entradas recebidas.`,
    attributionRate < 80 && current.salesCount > 0 ? `Somente ${formatPercent(attributionRate, 1)} das vendas estão ligadas a uma campanha. Melhorar a captura de campaign_id elevará a precisão do ROAS por campanha.` : `${formatPercent(attributionRate, 1)} das vendas possuem atribuição de campanha utilizável.`,
  ];

  const bestCampaign = [...campaignRows]
    .filter((campaign) => campaign.spend > 0 && campaign.revenue > 0)
    .sort((a, b) => campaignRoas(b) - campaignRoas(a))[0];
  const reviewCampaign = [...campaignRows]
    .filter((campaign) => campaign.spend > 0 && campaignRoas(campaign) < 1)
    .sort((a, b) => b.spend - a.spend)[0];
  const spendDelta = deltaPct(rollup.spend, previous.rollup.spend);
  const decisions = [
    {
      icon: Zap,
      label: 'Oportunidade de escala',
      value: bestCampaign?.name ?? 'Aguardando conversões',
      detail: bestCampaign
        ? `${campaignRoas(bestCampaign).toFixed(2)}x de ROAS · ${formatBRL(bestCampaign.revenue)} em receita atribuída.`
        : 'Nenhuma campanha com receita atribuída suficiente no período.',
      badge: bestCampaign ? 'Escalar com controle' : 'Sem recomendação',
      tone: 'good' as const,
    },
    {
      icon: CircleStop,
      label: 'Prioridade de revisão',
      value: reviewCampaign?.name ?? 'Nenhum desperdício crítico',
      detail: reviewCampaign
        ? `${formatBRL(reviewCampaign.spend)} investidos com ${campaignRoas(reviewCampaign).toFixed(2)}x de ROAS.`
        : 'As campanhas com investimento não apresentam ROAS abaixo de 1x.',
      badge: reviewCampaign ? 'Revisar agora' : 'Operação saudável',
      tone: reviewCampaign ? 'bad' as const : 'good' as const,
    },
    {
      icon: WalletCards,
      label: 'Ritmo do investimento',
      value: formatBRL(rollup.spend),
      detail: spendDelta === null
        ? 'Sem base equivalente no período anterior.'
        : `${spendDelta >= 0 ? '+' : ''}${spendDelta.toFixed(1)}% contra o período anterior.`,
      badge: Math.abs(spendDelta ?? 0) > 25 ? 'Variação relevante' : 'Ritmo estável',
      tone: Math.abs(spendDelta ?? 0) > 25 ? 'warn' as const : 'info' as const,
    },
    {
      icon: Fingerprint,
      label: 'Qualidade da atribuição',
      value: formatPercent(attributionRate, 1),
      detail: `${formatNumber(attributedSales)} de ${formatNumber(current.salesCount)} vendas ligadas a campanhas.`,
      badge: attributionRate >= 80 ? 'Cobertura confiável' : 'Melhorar tracking',
      tone: attributionRate >= 80 ? 'info' as const : 'warn' as const,
    },
  ];

  return <div className="flex flex-col gap-5">
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-[var(--color-brand)]" />
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Centro de decisão</h2>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Ações sugeridas a partir dos dados reais do período selecionado.</p>
        </div>
        <span className="rounded-full border border-emerald-400/15 bg-emerald-400/8 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">Atualizado com Meta + CRM</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {decisions.map((decision) => <DecisionCard key={decision.label} {...decision} />)}
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {kpis.map((item) => <article key={item.label} className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 shadow-sm"><div className="flex items-center justify-between"><span className="rounded-lg bg-[var(--color-brand-soft)] p-2 text-[var(--color-brand)]"><item.icon size={15} /></span><DeltaBadge delta={item.delta} moreIsGood={item.good} /></div><p className="mt-4 text-xl font-semibold tracking-tight text-[var(--color-text)]">{item.value}</p><p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{item.label}</p><div className="mt-3"><Sparkline data={item.spark} /></div></article>)}
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Activity size={16} className="text-[var(--color-brand)]" /><h2 className="font-semibold text-[var(--color-text)]">Resultado financeiro e comercial</h2></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">Receita e investimento comparados com a geração diária de leads e vendas.</p></div><div className="text-right"><p className="text-xs text-[var(--color-text-muted)]">Receita no período</p><p className="text-lg font-semibold text-[var(--color-good)]">{formatBRL(current.revenue)}</p></div></div><div className="mt-5 h-80"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}><CartesianGrid stroke="var(--color-border-soft)" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} stroke="var(--color-text-faint)" /><YAxis yAxisId="currency" tickLine={false} axisLine={false} fontSize={10} width={55} stroke="var(--color-text-faint)" tickFormatter={(value) => `R$${Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(0)}k` : value}`} /><YAxis yAxisId="volume" orientation="right" tickLine={false} axisLine={false} fontSize={10} width={30} stroke="var(--color-text-faint)" /><Tooltip contentStyle={{ background: '#16171f', border: '1px solid #2b2d38', borderRadius: 12, fontSize: 11 }} formatter={(value, name) => [name === 'investimento' || name === 'receita' ? formatBRL(Number(value ?? 0)) : formatNumber(Number(value ?? 0)), String(name)]} /><Legend wrapperStyle={{ fontSize: 10 }} /><Area yAxisId="currency" type="monotone" dataKey="receita" name="Receita" stroke="var(--color-good)" fill="var(--color-good)" fillOpacity={0.12} strokeWidth={2} /><Line yAxisId="currency" type="monotone" dataKey="investimento" name="Investimento" stroke="var(--color-brand)" strokeWidth={2} dot={false} /><Bar yAxisId="volume" dataKey="leads" name="Leads únicos" fill="var(--color-info)" opacity={0.65} radius={[4, 4, 0, 0]} /><Line yAxisId="volume" type="monotone" dataKey="vendas" name="Vendas" stroke="var(--color-warn)" strokeWidth={2} dot={{ r: 2 }} /></ComposedChart></ResponsiveContainer></div></article>
      <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"><div className="flex items-center gap-2"><Lightbulb size={16} className="text-amber-300" /><h2 className="font-semibold text-[var(--color-text)]">Leitura executiva</h2></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">Sinais automáticos para orientar decisão.</p><div className="mt-5 space-y-3">{insights.map((insight, index) => <div key={insight} className="flex gap-3 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[10px] font-semibold text-[var(--color-brand)]">{index + 1}</span><p className="text-xs leading-relaxed text-[var(--color-text-muted)]">{insight}</p></div>)}</div><div className="mt-4 grid grid-cols-2 gap-2"><MiniMetric label="Conversão Lead → Venda" value={formatPercent(conversion, 1)} /><MiniMetric label="Ticket médio" value={formatBRL(ticket)} /><MiniMetric label="Meta → CRM" value={formatPercent(metaToCrm, 1)} /><MiniMetric label="Cobertura de atribuição" value={formatPercent(attributionRate, 1)} /></div></article>
    </section>

    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"><div className="flex items-center gap-2"><Gauge size={16} className="text-[var(--color-brand)]" /><h2 className="font-semibold text-[var(--color-text)]">Funil completo de aquisição</h2></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">Da exposição do anúncio até a venda registrada no CRM.</p><div className="mt-5 grid gap-2 md:grid-cols-5">{funnel.map((stage, index) => { const previousValue = index > 0 ? funnel[index - 1].value : 0; const rate = previousValue > 0 ? (stage.value / previousValue) * 100 : 0; return <div key={stage.label} className="relative"><div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-4"><stage.icon size={15} style={{ color: stage.tone }} /><p className="mt-3 text-xl font-semibold text-[var(--color-text)]">{formatNumber(stage.value)}</p><p className="text-[10px] text-[var(--color-text-faint)]">{stage.label}</p>{index > 0 && <p className="mt-2 text-[10px] font-medium" style={{ color: stage.tone }}>{formatPercent(rate, 2)} da etapa anterior</p>}</div>{index < funnel.length - 1 && <ArrowRight size={14} className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-[var(--color-text-faint)] md:block" />}</div>; })}</div></section>

    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BarChart3 size={16} className="text-[var(--color-brand)]" /><h2 className="font-semibold text-[var(--color-text)]">Métricas completas do Gerenciador</h2></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">Indicadores retornados pelo endpoint Insights com a atribuição configurada na conta.</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${metaSummary ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{metaSummary ? 'Resumo direto da Meta API' : 'Fallback dos dados sincronizados'}</span></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"><ManagerMetric label="Cliques de saída" value={formatNumber(managerMetrics.outbound_clicks)} /><ManagerMetric label="Visualizações da página" value={formatNumber(managerMetrics.landing_page_views)} /><ManagerMetric label="Engajamentos" value={formatNumber(managerMetrics.post_engagement)} /><ManagerMetric label="Visualizações de vídeo" value={formatNumber(managerMetrics.video_views)} /><ManagerMetric label="ThruPlays" value={formatNumber(managerMetrics.thruplays)} /><ManagerMetric label="Conversas iniciadas" value={formatNumber(managerMetrics.messaging_conversations_started)} /><ManagerMetric label="Compras Meta" value={formatNumber(managerMetrics.purchases)} /><ManagerMetric label="Valor de compras" value={formatBRL(managerMetrics.purchase_value)} /><ManagerMetric label="ROAS de compras Meta" value={`${managerMetrics.purchase_roas.toFixed(2)}x`} /><ManagerMetric label="Alcance único" value={formatNumber(managerMetrics.reach)} /><ManagerMetric label="Frequência" value={managerMetrics.frequency.toFixed(2)} /><ManagerMetric label="Custo por clique" value={formatBRL(managerMetrics.cpc)} /></div></section>

    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BarChart3 size={16} className="text-[var(--color-brand)]" /><h2 className="font-semibold text-[var(--color-text)]">Rentabilidade por campanha</h2></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">Meta Ads cruzada com leads e vendas atribuídos no CRM.</p></div><div className="flex items-center gap-2"><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">Dados Meta API + CRM</span><button type="button" onClick={() => exportCampaigns(campaignRows)} disabled={campaignRows.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"><Download size={12} /> Exportar CSV</button></div></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[920px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]"><tr><th className="pb-3">Campanha</th><th className="text-right">Investimento</th><th className="text-right">Leads Meta</th><th className="text-right">Leads CRM</th><th className="text-right">Vendas</th><th className="text-right">Receita</th><th className="text-right">CPL</th><th className="text-right">CPA</th><th className="text-right">ROAS</th></tr></thead><tbody>{campaignRows.slice(0, 12).map((campaign) => { const campaignCpl = campaign.crmLeads > 0 ? campaign.spend / campaign.crmLeads : 0; const campaignCpa = campaign.sales > 0 ? campaign.spend / campaign.sales : 0; const campaignRoas = campaign.spend > 0 ? campaign.revenue / campaign.spend : 0; return <tr key={campaign.id} className="border-t border-[var(--color-border-soft)]"><td className="max-w-[260px] py-3 pr-4"><p className="truncate font-medium text-[var(--color-text)]" title={campaign.name}>{campaign.name}</p><p className="truncate text-[10px] text-[var(--color-text-faint)]">{campaign.id}</p></td><td className="text-right">{formatBRL(campaign.spend)}</td><td className="text-right">{formatNumber(campaign.metaLeads)}</td><td className="text-right">{formatNumber(campaign.crmLeads)}</td><td className="text-right font-medium text-[var(--color-good)]">{formatNumber(campaign.sales)}</td><td className="text-right font-medium">{formatBRL(campaign.revenue)}</td><td className="text-right">{campaign.crmLeads > 0 ? formatBRL(campaignCpl) : '—'}</td><td className="text-right">{campaign.sales > 0 ? formatBRL(campaignCpa) : '—'}</td><td className={`text-right font-semibold ${campaignRoas >= 2 ? 'text-emerald-400' : campaignRoas > 0 ? 'text-amber-300' : 'text-[var(--color-text-faint)]'}`}>{campaign.revenue > 0 ? `${campaignRoas.toFixed(2)}x` : '—'}</td></tr>; })}</tbody></table>{campaignRows.length === 0 && <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Sincronize a Meta para visualizar campanhas no período.</div>}</div></section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Diagnostic icon={Eye} label="Frequência" value={rollup.frequency.toFixed(2)} detail={rollup.frequency > 4 ? 'Atenção à saturação' : 'Dentro de uma faixa saudável'} /><Diagnostic icon={MousePointerClick} label="CTR" value={formatPercent(rollup.ctr, 2)} detail={`${formatNumber(rollup.clicks)} cliques totais`} /><Diagnostic icon={Banknote} label="CPM" value={formatBRL(rollup.cpm)} detail={`${formatNumber(rollup.impressions)} impressões`} /><Diagnostic icon={Receipt} label="Receita por lead" value={formatBRL(current.uniqueLeads > 0 ? current.revenue / current.uniqueLeads : 0)} detail={`${formatPercent(deltaPct(conversion, prevConversion) ?? 0, 1)} variação da conversão`} /></section>
  </div>;
}

function DecisionCard({
  icon: Icon,
  label,
  value,
  detail,
  badge,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  detail: string;
  badge: string;
  tone: 'good' | 'bad' | 'warn' | 'info';
}) {
  const tones = {
    good: { color: 'var(--color-good)', soft: 'var(--color-good-soft)' },
    bad: { color: 'var(--color-bad)', soft: 'var(--color-bad-soft)' },
    warn: { color: 'var(--color-warn)', soft: 'var(--color-warn-soft)' },
    info: { color: 'var(--color-info)', soft: 'var(--color-info-soft)' },
  };
  const palette = tones[tone];

  return (
    <article className="group relative min-h-40 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-panel),#0d0e13)] p-4 shadow-[0_16px_45px_rgba(0,0,0,0.15)] transition hover:-translate-y-0.5 hover:border-[var(--color-text-faint)]">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-25 blur-2xl" style={{ background: palette.color }} />
      <div className="relative flex items-center justify-between gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ color: palette.color, background: palette.soft }}><Icon size={16} /></span>
        <span className="rounded-full border px-2 py-1 text-[9px] font-semibold" style={{ color: palette.color, borderColor: `color-mix(in srgb, ${palette.color} 28%, transparent)`, background: palette.soft }}>{badge}</span>
      </div>
      <p className="relative mt-4 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{label}</p>
      <p className="relative mt-1 truncate text-sm font-semibold text-[var(--color-text)]" title={value}>{value}</p>
      <p className="relative mt-2 text-[10px] leading-relaxed text-[var(--color-text-muted)]">{detail}</p>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[var(--color-bg)] p-3"><p className="text-sm font-semibold text-[var(--color-text)]">{value}</p><p className="mt-0.5 text-[9px] leading-tight text-[var(--color-text-faint)]">{label}</p></div>;
}

function ManagerMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-3"><p className="text-base font-semibold text-[var(--color-text)]">{value}</p><p className="mt-1 text-[9px] leading-tight text-[var(--color-text-faint)]">{label}</p></div>;
}

function Diagnostic({ icon: Icon, label, value, detail }: { icon: typeof Wallet; label: string; value: string; detail: string }) {
  return <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"><div className="flex items-center justify-between"><Icon size={15} className="text-[var(--color-brand)]" /><ArrowDownRight size={13} className="text-[var(--color-text-faint)]" /></div><p className="mt-3 text-lg font-semibold text-[var(--color-text)]">{value}</p><p className="text-[10px] text-[var(--color-text-muted)]">{label}</p><p className="mt-2 text-[9px] text-[var(--color-text-faint)]">{detail}</p></article>;
}
