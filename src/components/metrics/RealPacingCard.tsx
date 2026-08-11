import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useProject } from '../../state/ProjectContext';
import { listAdInsights } from '../../services/metaAds.service';
import { listLeadEvents } from '../../services/crmLeads.service';
import { realProjectRollup } from '../../lib/realRollups';
import { computeCrmLeadStats } from '../../services/crmLeads.service';
import { formatBRL, formatNumber, formatPercent } from '../../lib/format';
import { Card } from '../ui/Card';

const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

interface MetricPacing {
  label: string;
  realized: number;
  goal: number;
  expected: number;
  projected: number;
  format: (n: number) => string;
  /** Para esta métrica, "acima do esperado" é bom (leads) ou neutro/ruim (investimento)? */
  moreIsGood: boolean;
}

function pacingStatus(realized: number, expected: number, moreIsGood: boolean) {
  if (expected <= 0) return { label: 'Sem meta', color: 'var(--color-text-faint)', icon: Minus };
  const ratio = realized / expected;
  const good = moreIsGood ? ratio >= 0.95 : ratio <= 1.1;
  const bad = moreIsGood ? ratio < 0.7 : ratio > 1.3;
  if (bad) return { label: 'Fora do ritmo', color: 'var(--color-bad)', icon: moreIsGood ? TrendingDown : TrendingUp };
  if (!good) return { label: 'Atenção', color: 'var(--color-warn)', icon: moreIsGood ? TrendingDown : TrendingUp };
  return { label: 'No ritmo', color: 'var(--color-good)', icon: moreIsGood ? TrendingUp : Minus };
}

function MetricBar({ metric }: { metric: MetricPacing }) {
  const status = pacingStatus(metric.realized, metric.expected, metric.moreIsGood);
  const Icon = status.icon;
  const goalPct = metric.goal > 0 ? Math.min(100, (metric.realized / metric.goal) * 100) : 0;
  const expectedPct = metric.goal > 0 ? Math.min(100, (metric.expected / metric.goal) * 100) : 0;
  const projectedPct = metric.goal > 0 ? Math.min(100, (metric.projected / metric.goal) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--color-text-muted)]">{metric.label}</p>
        <span
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ background: `color-mix(in srgb, ${status.color} 16%, transparent)`, color: status.color }}
        >
          <Icon size={10} /> {status.label}
        </span>
      </div>
      <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">
        {metric.format(metric.realized)}
        {metric.goal > 0 && (
          <span className="ml-1 text-xs font-normal text-[var(--color-text-faint)]">
            de {metric.format(metric.goal)}
          </span>
        )}
      </p>
      {metric.goal > 0 && (
        <>
          <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#1b1c25]">
            <div className="h-full rounded-full" style={{ width: `${goalPct}%`, background: 'var(--color-brand)' }} />
            <div
              className="absolute top-0 h-full w-0.5 bg-[var(--color-text-faint)]"
              style={{ left: `${expectedPct}%` }}
              title="Esperado até hoje"
            />
            <div
              className="absolute top-0 h-full w-0.5"
              style={{ left: `${projectedPct}%`, background: status.color }}
              title="Projeção fim do período"
            />
          </div>
          <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">
            Esperado até hoje: {metric.format(metric.expected)} · Projeção: {metric.format(metric.projected)}
          </p>
        </>
      )}
    </div>
  );
}

export function RealPacingCard() {
  const { project, goals } = useProject();
  const [spend, setSpend] = useState<number | null>(null);
  const [leads, setLeads] = useState<number | null>(null);

  useEffect(() => {
    if (!goals) return;
    let active = true;
    setSpend(null);
    setLeads(null);
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const until = today < goals.period_end ? today : goals.period_end;
      const [adInsights, leadEvents] = await Promise.all([
        listAdInsights(project.id, { since: goals.period_start, until }).catch(() => []),
        listLeadEvents(project.id, { since: goals.period_start, until }).catch(() => []),
      ]);
      if (!active) return;
      setSpend(realProjectRollup(adInsights).spend);
      setLeads(computeCrmLeadStats(leadEvents, []).uniqueContacts);
    })();
    return () => {
      active = false;
    };
  }, [project.id, goals]);

  if (!goals) return null;
  if (spend === null || leads === null) return null;

  const periodStart = new Date(`${goals.period_start}T00:00:00`);
  const periodEnd = new Date(`${goals.period_end}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysInPeriod = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1);
  const cappedToday = today < periodStart ? periodStart : today > periodEnd ? periodEnd : today;
  const daysElapsed = Math.max(1, Math.round((cappedToday.getTime() - periodStart.getTime()) / 86400000) + 1);
  const fraction = daysElapsed / daysInPeriod;

  const metrics: MetricPacing[] = [];
  if (goals.spend_goal) {
    metrics.push({
      label: 'Investimento',
      realized: spend,
      goal: goals.spend_goal,
      expected: goals.spend_goal * fraction,
      projected: (spend / daysElapsed) * daysInPeriod,
      format: formatBRL,
      moreIsGood: false,
    });
  }
  if (goals.lead_goal) {
    metrics.push({
      label: 'Leads',
      realized: leads,
      goal: goals.lead_goal,
      expected: goals.lead_goal * fraction,
      projected: (leads / daysElapsed) * daysInPeriod,
      format: formatNumber,
      moreIsGood: true,
    });
  }

  if (metrics.length === 0) return null;

  const monthLabel = monthNames[periodStart.getMonth()];

  return (
    <Card title={`Ritmo do Período — ${monthLabel}`}>
      <p className="mb-3 text-[11px] text-[var(--color-text-faint)]">
        Dia {daysElapsed} de {daysInPeriod} · {formatPercent(fraction * 100, 0)} do período decorrido
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {metrics.map((m) => (
          <MetricBar key={m.label} metric={m} />
        ))}
      </div>
    </Card>
  );
}
