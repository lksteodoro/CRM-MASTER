export function ProgressBar({
  value,
  color,
  trackColor = '#1b1c25',
}: {
  value: number;
  color: string;
  trackColor?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: trackColor }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  );
}
