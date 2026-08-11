import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

export function MetricCard({
  icon: Icon,
  label,
  value,
  deltaPct,
  positiveIsGood = true,
  accent = 'var(--color-brand)',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  deltaPct: number;
  positiveIsGood?: boolean;
  accent?: string;
}) {
  const isPositive = deltaPct >= 0;
  const isGood = positiveIsGood ? isPositive : !isPositive;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
      <div className="flex items-center justify-between">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}
        >
          <Icon size={17} style={{ color: accent }} />
        </span>
        <span
          className={clsx(
            'flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
            isGood
              ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]'
              : 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]'
          )}
        >
          {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {Math.abs(deltaPct).toFixed(1)}%
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold text-[var(--color-text)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-0.5 text-[10px] text-[var(--color-text-faint)]">vs. período anterior</p>
    </div>
  );
}
