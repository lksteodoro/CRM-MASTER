import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { MonthPacing } from '../../lib/pacing';
import { formatNumber, formatPercent } from '../../lib/format';
import { Card } from '../ui/Card';

const statusMeta = {
  ahead: { label: 'Adiantado', color: 'var(--color-good)', icon: TrendingUp },
  'on-track': { label: 'No ritmo', color: 'var(--color-good)', icon: Minus },
  'at-risk': { label: 'Abaixo do esperado', color: 'var(--color-warn)', icon: TrendingDown },
  behind: { label: 'Meta em risco', color: 'var(--color-bad)', icon: TrendingDown },
} as const;

const monthNames = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function PacingWidget({ pacing }: { pacing: MonthPacing }) {
  const meta = statusMeta[pacing.status];
  const Icon = meta.icon;
  const monthLabel = monthNames[new Date().getMonth()];

  const goalPct = pacing.leadGoal > 0 ? Math.min(100, (pacing.leadsSoFar / pacing.leadGoal) * 100) : 0;
  const expectedPct = (pacing.daysElapsed / pacing.daysInMonth) * 100;
  const projectedPct = pacing.leadGoal > 0 ? (pacing.projected / pacing.leadGoal) * 100 : 0;

  return (
    <Card
      title={`Ritmo do Mês — ${monthLabel}`}
      action={
        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ background: `color-mix(in srgb, ${meta.color} 16%, transparent)`, color: meta.color }}
        >
          <Icon size={12} /> {meta.label}
        </span>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-semibold text-[var(--color-text)]">
            {formatNumber(pacing.leadsSoFar)}
            <span className="ml-1 text-sm font-normal text-[var(--color-text-faint)]">
              leads até hoje (dia {pacing.daysElapsed} de {pacing.daysInMonth})
            </span>
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Projeção para o fim do mês:{' '}
            <span className="font-medium" style={{ color: meta.color }}>
              {formatNumber(pacing.projected)} leads
            </span>{' '}
            ({formatPercent(pacing.pct, 0)} da meta de {formatNumber(pacing.leadGoal)})
          </p>
        </div>
      </div>

      <div className="relative mt-4 h-3 w-full overflow-hidden rounded-full bg-[#1b1c25]">
        <div
          className="h-full rounded-full"
          style={{ width: `${goalPct}%`, background: 'var(--color-brand)' }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-[var(--color-text-faint)]"
          style={{ left: `${Math.min(100, expectedPct)}%` }}
          title="Esperado até hoje"
        />
        <div
          className="absolute top-0 h-full w-0.5"
          style={{ left: `${Math.min(100, projectedPct)}%`, background: meta.color }}
          title="Projeção fim do mês"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-[var(--color-text-faint)]">
        <span>0</span>
        <span>Meta: {formatNumber(pacing.leadGoal)}</span>
      </div>
    </Card>
  );
}
