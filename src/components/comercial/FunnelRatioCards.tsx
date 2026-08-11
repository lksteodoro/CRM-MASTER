import type { FunnelRatios } from '../../lib/comercial';
import { formatNumber, formatPercent } from '../../lib/format';
import { ProgressBar } from '../ui/ProgressBar';

export function FunnelRatioCards({ ratios }: { ratios: FunnelRatios }) {
  const items = [
    {
      label: 'Qualificação / Oportunidade',
      pct: ratios.qualifOverOportunidade,
      sub: `${formatNumber(ratios.qualificacao)} de ${formatNumber(ratios.oportunidade)}`,
      color: 'var(--color-info)',
    },
    {
      label: 'Negociação / Qualificação',
      pct: ratios.negOverQualif,
      sub: `${formatNumber(ratios.negociacao)} de ${formatNumber(ratios.qualificacao)}`,
      color: 'var(--color-violet)',
    },
    {
      label: 'Fechamento / Negociação',
      pct: ratios.fechOverNeg,
      sub: `${formatNumber(ratios.fechamento)} de ${formatNumber(ratios.negociacao)}`,
      color: 'var(--color-brand)',
    },
    {
      label: 'Fechamento / Oportunidade',
      pct: ratios.fechOverOportunidade,
      sub: `taxa geral do funil`,
      color: 'var(--color-good)',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">{item.label}</p>
          <p className="mt-1 text-2xl font-semibold" style={{ color: item.color }}>
            {formatPercent(item.pct, 1)}
          </p>
          <div className="mt-2">
            <ProgressBar value={item.pct} color={item.color} />
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--color-text-faint)]">{item.sub}</p>
        </div>
      ))}
    </div>
  );
}
