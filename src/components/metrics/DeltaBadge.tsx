import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/** null = sem base de comparação (período anterior zerado). */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function DeltaBadge({ delta, moreIsGood }: { delta: number | null; moreIsGood: boolean }) {
  if (delta === null) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-faint)]">
        <Minus size={10} /> novo
      </span>
    );
  }
  const isUp = delta > 0.5;
  const isDown = delta < -0.5;
  const good = isUp ? moreIsGood : isDown ? !moreIsGood : true;
  const color = !isUp && !isDown ? 'var(--color-text-faint)' : good ? 'var(--color-good)' : 'var(--color-bad)';
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;

  return (
    <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color }}>
      <Icon size={10} />
      {delta > 0 ? '+' : ''}
      {delta.toFixed(0)}%
    </span>
  );
}
