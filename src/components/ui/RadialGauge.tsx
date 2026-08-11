interface RadialGaugeProps {
  value: number; // 0-100 progress
  color: string;
  label: string;
  centerValue: string;
  centerSub?: string;
  size?: number;
}

// Semi-circular speedometer-style gauge, similar to a "risk level" dial.
export function RadialGauge({
  value,
  color,
  label,
  centerValue,
  centerSub,
  size = 168,
}: RadialGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 180;
  const endAngle = 0;
  const angle = startAngle + (clamped / 100) * (endAngle - startAngle);

  const polar = (r: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  };

  const arcPath = (fromDeg: number, toDeg: number) => {
    const start = polar(radius, fromDeg);
    const end = polar(radius, toDeg);
    const largeArc = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  const needleTip = polar(radius - 10, angle);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 1.65 + 10} viewBox={`0 0 ${size} ${size / 1.65 + 10}`}>
        <path
          d={arcPath(180, 0)}
          fill="none"
          stroke="#23252f"
          strokeWidth={12}
          strokeLinecap="round"
        />
        <path
          d={arcPath(180, angle)}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
        />
        <line
          x1={cx}
          y1={cy}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke="#e7e8ec"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5} fill="#e7e8ec" />
        <text
          x={cx}
          y={cy - 26}
          textAnchor="middle"
          fill="var(--color-text)"
          fontSize="20"
          fontWeight={600}
        >
          {centerValue}
        </text>
        {centerSub && (
          <text
            x={cx}
            y={cy - 8}
            textAnchor="middle"
            fill="var(--color-text-muted)"
            fontSize="11"
          >
            {centerSub}
          </text>
        )}
      </svg>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
    </div>
  );
}
