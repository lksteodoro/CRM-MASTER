import {
  Wallet,
  Target,
  TrendingUp,
  Percent,
  GraduationCap,
  Eye,
  Users2,
  Repeat,
  MousePointerClick,
  Link2,
  DollarSign,
  Layers,
  BadgeCheck,
  Inbox,
  Fingerprint,
  Receipt,
} from 'lucide-react';
import type { PeriodData, DailyPoint } from '../../lib/metricsTrend';
import { deltaPct, DeltaBadge } from './DeltaBadge';
import { formatBRL, formatNumber, formatPercent } from '../../lib/format';
import { Sparkline } from './Sparkline';
import { RealAdsRankingTable } from '../ads/RealAdsRankingTable';

export function MetricsSummaryTab({
  current,
  previous,
  currentSeries,
}: {
  current: PeriodData;
  previous: PeriodData;
  currentSeries: DailyPoint[];
}) {
  const { rollup } = current;
  const cplReal = current.totalLeads > 0 ? rollup.spend / current.totalLeads : 0;
  const cplUnico = current.uniqueLeads > 0 ? rollup.spend / current.uniqueLeads : 0;
  const cpa = current.salesCount > 0 ? rollup.spend / current.salesCount : 0;
  const roas = rollup.spend > 0 ? current.revenue / rollup.spend : 0;
  const conversionRate = current.uniqueLeads > 0 ? (current.salesCount / current.uniqueLeads) * 100 : 0;

  const prevCplReal = previous.totalLeads > 0 ? previous.rollup.spend / previous.totalLeads : 0;
  const prevRoas = previous.rollup.spend > 0 ? previous.revenue / previous.rollup.spend : 0;
  const prevConversionRate = previous.uniqueLeads > 0 ? (previous.salesCount / previous.uniqueLeads) * 100 : 0;

  const daySpend = currentSeries.map((p) => p.spend);
  const dayCplReal = currentSeries.map((p) => (p.leadsReceived > 0 ? p.spend / p.leadsReceived : 0));
  const dayRoas = currentSeries.map((p) => (p.spend > 0 ? p.revenue / p.spend : 0));
  const dayConversion = currentSeries.map((p) => (p.leadsReceived > 0 ? (p.sales / p.leadsReceived) * 100 : 0));
  const daySales = currentSeries.map((p) => p.sales);

  const hero = [
    {
      icon: Wallet,
      label: 'Investimento',
      value: formatBRL(rollup.spend),
      spark: daySpend,
      delta: deltaPct(rollup.spend, previous.rollup.spend),
      moreIsGood: false,
    },
    {
      icon: Target,
      label: 'CPL real',
      value: formatBRL(cplReal),
      spark: dayCplReal,
      delta: deltaPct(cplReal, prevCplReal),
      moreIsGood: false,
    },
    {
      icon: TrendingUp,
      label: 'ROAS',
      value: `${roas.toFixed(2)}x`,
      spark: dayRoas,
      delta: deltaPct(roas, prevRoas),
      moreIsGood: true,
    },
    {
      icon: Percent,
      label: 'Taxa Lead → Venda',
      value: formatPercent(conversionRate, 1),
      spark: dayConversion,
      delta: deltaPct(conversionRate, prevConversionRate),
      moreIsGood: true,
    },
    {
      icon: GraduationCap,
      label: 'Vendas agregadas',
      value: formatNumber(current.salesCount),
      spark: daySales,
      delta: deltaPct(current.salesCount, previous.salesCount),
      moreIsGood: true,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {hero.map((h) => (
          <div
            key={h.label}
            className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
          >
            <div className="flex items-center justify-between">
              <h.icon size={16} className="text-[var(--color-brand)]" />
              <DeltaBadge delta={h.delta} moreIsGood={h.moreIsGood} />
            </div>
            <p className="text-lg font-semibold text-[var(--color-text)]">{h.value}</p>
            <p className="text-[11px] text-[var(--color-text-faint)]">{h.label}</p>
            <Sparkline data={h.spark} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <details className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4" open>
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-text)]">
            Meta Ads
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={Eye} label="Impressões" value={formatNumber(rollup.impressions)} />
            <Stat icon={Users2} label="Alcance" value={formatNumber(rollup.reach)} />
            <Stat icon={Repeat} label="Frequência" value={rollup.frequency.toFixed(2)} />
            <Stat icon={MousePointerClick} label="Cliques" value={formatNumber(rollup.clicks)} />
            <Stat icon={Link2} label="Cliques no link" value={formatNumber(rollup.linkClicks)} />
            <Stat icon={Percent} label="CTR" value={formatPercent(rollup.ctr, 2)} />
            <Stat icon={DollarSign} label="CPC" value={formatBRL(rollup.cpc)} />
            <Stat icon={Layers} label="CPM" value={formatBRL(rollup.cpm)} />
          </div>
        </details>

        <details className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-text)]">Leads</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat icon={BadgeCheck} label="Leads Meta" value={formatNumber(rollup.leadsCount)} />
            <Stat icon={Inbox} label="Leads recebidos" value={formatNumber(current.totalLeads)} />
            <Stat icon={Fingerprint} label="Leads únicos" value={formatNumber(current.uniqueLeads)} />
            <Stat icon={Target} label="CPL Meta" value={formatBRL(rollup.cpl)} />
            <Stat icon={Target} label="CPL único" value={formatBRL(cplUnico)} />
          </div>
        </details>

        <details className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-text)]">Vendas</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={Target} label="CPA" value={formatBRL(cpa)} />
            <Stat icon={Receipt} label="Receita" value={formatBRL(current.revenue)} accent="var(--color-good)" />
          </div>
        </details>
      </div>

      <RealAdsRankingTable />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent = 'var(--color-brand)',
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-panel-2)] p-3">
      <Icon size={14} style={{ color: accent }} />
      <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">{value}</p>
      <p className="text-[10px] text-[var(--color-text-faint)]">{label}</p>
    </div>
  );
}
