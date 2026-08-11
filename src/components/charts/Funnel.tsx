import { formatNumber, formatPercent } from '../../lib/format';

interface FunnelStage {
  label: string;
  value: number;
  color: string;
}

export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="flex flex-col gap-3">
      {stages.map((stage, idx) => {
        const widthPct = (stage.value / max) * 100;
        const prev = idx > 0 ? stages[idx - 1].value : undefined;
        const stepRate = prev && prev > 0 ? (stage.value / prev) * 100 : undefined;
        return (
          <div key={stage.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-[var(--color-text-muted)]">{stage.label}</span>
              <span className="flex items-center gap-2">
                <span className="font-medium text-[var(--color-text)]">
                  {formatNumber(stage.value)}
                </span>
                {stepRate !== undefined && (
                  <span className="text-[10px] text-[var(--color-text-faint)]">
                    {formatPercent(stepRate, 1)}
                  </span>
                )}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-[#1b1c25]">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(widthPct, 2)}%`, background: stage.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
