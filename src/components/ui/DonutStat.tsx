interface Segment {
  label: string;
  value: number;
  color: string;
}

export function DonutStat({
  segments,
  size = 116,
  centerLabel,
  centerValue,
}: {
  segments: Segment[];
  size?: number;
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const radius = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const fraction = seg.value / total;
    const dash = fraction * circumference;
    const arc = { ...seg, dash, gap: circumference - dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1b1c25" strokeWidth={14} />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={a.color}
            strokeWidth={14}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={-a.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy - 2} textAnchor="middle" fill="var(--color-text)" fontSize="18" fontWeight={600}>
          {centerValue}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--color-text-muted)" fontSize="10">
          {centerLabel}
        </text>
      </svg>
      <div className="flex flex-col gap-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-[var(--color-text-muted)]">{s.label}</span>
            <span className="font-medium text-[var(--color-text)]">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
