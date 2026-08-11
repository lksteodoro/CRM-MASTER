import { AreaChart, Area, ResponsiveContainer } from 'recharts';

export function StatTile({
  label,
  value,
  sub,
  trend,
  color = 'var(--color-brand)',
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: number[];
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-4">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-[var(--color-text)]">{value}</p>
          {sub && <p className="text-[11px] text-[var(--color-text-faint)]">{sub}</p>}
        </div>
        {trend && trend.length > 1 && (
          <div className="h-8 w-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.map((v, i) => ({ v, i }))}>
                <defs>
                  <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={color}
                  strokeWidth={1.5}
                  fill={`url(#grad-${label})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
