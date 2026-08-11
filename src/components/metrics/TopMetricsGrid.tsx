import { Wallet, Tag, Users, GraduationCap } from 'lucide-react';
import { useFilters } from '../../state/FiltersContext';
import {
  campaignIdsForProject,
  filterDaily,
  sumTotals,
  cpl,
  pageConversionRate,
  connectRate,
  impressionRate,
  ctr,
  cpm,
  frequency,
  dailySeries,
  previousRange,
  deltaPct,
} from '../../lib/metrics';
import { formatBRL, formatNumber, formatPercent } from '../../lib/format';
import { MetricCard } from '../ui/MetricCard';
import { RadialGauge } from '../ui/RadialGauge';
import { DonutStat } from '../ui/DonutStat';
import { ProgressBar } from '../ui/ProgressBar';
import { StatTile } from '../ui/StatTile';
import { Card } from '../ui/Card';

export function TopMetricsGrid() {
  const { selectedProject, dateRange } = useFilters();
  const campaignIds = campaignIdsForProject(selectedProject);

  const currentRows = filterDaily(dateRange, campaignIds);
  const totals = sumTotals(currentRows);

  const prevRange = previousRange(dateRange);
  const prevRows = filterDaily(prevRange, campaignIds);
  const prevTotals = sumTotals(prevRows);

  const series = dailySeries(dateRange, campaignIds);
  const spendTrend = series.map((s) => s.spend);
  const impressionRateTrend = series.map((s) => (s.reach > 0 ? (s.impressions / s.reach) * 100 : 0));
  const ctrTrend = series.map((s) => (s.impressions > 0 ? (s.linkClicks / s.impressions) * 100 : 0));
  const cpmTrend = series.map((s) => (s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0));
  const reachTrend = series.map((s) => s.reach);
  const freqTrend = series.map((s) => (s.reach > 0 ? s.impressions / s.reach : 0));

  const leadGoal = selectedProject?.leadGoal ?? 1;
  const cplGoal = selectedProject?.cplGoal ?? 1;
  const currentCpl = cpl(totals);

  const leadGoalPct = Math.min(100, (totals.leads / leadGoal) * 100);
  // For CPL, being under goal is good — invert so gauge fills as you approach/beat the goal.
  const cplGoalPct = currentCpl === 0 ? 0 : Math.min(100, (cplGoal / currentCpl) * 100);

  const notFormed = Math.max(0, totals.connectedLeads - totals.formedLeads);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Wallet}
          label="Valor Gasto"
          value={formatBRL(totals.spend)}
          deltaPct={deltaPct(totals.spend, prevTotals.spend)}
          positiveIsGood={false}
          accent="var(--color-brand)"
        />
        <MetricCard
          icon={Tag}
          label="Custo por Lead (CPL)"
          value={formatBRL(currentCpl)}
          deltaPct={deltaPct(currentCpl, cpl(prevTotals))}
          positiveIsGood={false}
          accent="var(--color-violet)"
        />
        <MetricCard
          icon={Users}
          label="Quantidade de Leads"
          value={formatNumber(totals.leads)}
          deltaPct={deltaPct(totals.leads, prevTotals.leads)}
          positiveIsGood
          accent="var(--color-info)"
        />
        <MetricCard
          icon={GraduationCap}
          label="Leads Matriculados"
          value={formatNumber(totals.formedLeads)}
          deltaPct={deltaPct(totals.formedLeads, prevTotals.formedLeads)}
          positiveIsGood
          accent="var(--color-good)"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card title="Meta de Leads" className="flex flex-col items-center justify-center">
          <RadialGauge
            value={leadGoalPct}
            color="var(--color-good)"
            label={`${formatNumber(totals.leads)} de ${formatNumber(leadGoal)} leads`}
            centerValue={formatPercent(leadGoalPct, 0)}
            centerSub="da meta"
          />
        </Card>

        <Card title="Meta de Custo por Lead" className="flex flex-col items-center justify-center">
          <RadialGauge
            value={cplGoalPct}
            color={currentCpl <= cplGoal ? 'var(--color-good)' : 'var(--color-bad)'}
            label={`${formatBRL(currentCpl)} (meta ${formatBRL(cplGoal)})`}
            centerValue={formatPercent(Math.min(100, cplGoalPct), 0)}
            centerSub="eficiência"
          />
        </Card>

        <Card title="Leads Formado x Não Formado">
          <DonutStat
            centerLabel="conectados"
            centerValue={formatNumber(totals.connectedLeads)}
            segments={[
              { label: 'Matriculados', value: totals.formedLeads, color: 'var(--color-good)' },
              { label: 'Não matriculados', value: notFormed, color: 'var(--color-border)' },
            ]}
          />
        </Card>

        <Card className="flex flex-col justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
              <span>Taxa de Conversão da Página</span>
              <span className="font-medium text-[var(--color-text)]">
                {formatPercent(pageConversionRate(totals))}
              </span>
            </div>
            <ProgressBar value={pageConversionRate(totals)} color="var(--color-info)" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
              <span>Connect Rate</span>
              <span className="font-medium text-[var(--color-text)]">
                {formatPercent(connectRate(totals))}
              </span>
            </div>
            <ProgressBar value={connectRate(totals)} color="var(--color-violet)" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Taxa de Impressão"
          value={formatPercent(impressionRate(totals))}
          sub="impressões / alcance"
          trend={impressionRateTrend}
          color="var(--color-brand)"
        />
        <StatTile
          label="CTR (Cliques no Link)"
          value={formatPercent(ctr(totals))}
          sub={`${formatNumber(totals.linkClicks)} cliques`}
          trend={ctrTrend}
          color="var(--color-info)"
        />
        <StatTile
          label="CPM"
          value={formatBRL(cpm(totals))}
          sub="por mil impressões"
          trend={cpmTrend}
          color="var(--color-violet)"
        />
        <StatTile
          label="Alcance"
          value={formatNumber(totals.reach)}
          sub={`${formatNumber(totals.impressions)} impressões`}
          trend={reachTrend}
          color="var(--color-good)"
        />
        <StatTile
          label="Frequência"
          value={frequency(totals).toFixed(2)}
          sub="impressões por pessoa"
          trend={freqTrend}
          color="var(--color-warn)"
        />
      </div>

      {spendTrend.length === 0 && (
        <p className="text-xs text-[var(--color-text-faint)]">
          Sem dados para o período selecionado.
        </p>
      )}
    </div>
  );
}
