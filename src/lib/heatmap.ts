// Maps a value's position within a set of peers to a red→green background,
// so a table cell communicates "good vs bad" at a glance without reading digits.
// invert=true means lower is better (e.g. CPL, CAC).
export function heatBg(value: number, peers: number[], invert = false): string {
  const finite = peers.filter((v) => Number.isFinite(v) && v !== 0);
  if (finite.length < 2) return 'transparent';
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min || !Number.isFinite(value) || value === 0) return 'transparent';

  let t = (value - min) / (max - min);
  if (invert) t = 1 - t;
  t = Math.max(0, Math.min(1, t));

  const hue = t * 130; // 0 = red (bad), 130 = green (good)
  return `hsla(${hue}, 65%, 45%, ${0.1 + t * 0.12})`;
}

export function heatText(value: number, peers: number[], invert = false): string {
  const finite = peers.filter((v) => Number.isFinite(v) && v !== 0);
  if (finite.length < 2) return 'var(--color-text)';
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min || !Number.isFinite(value) || value === 0) return 'var(--color-text)';

  let t = (value - min) / (max - min);
  if (invert) t = 1 - t;
  if (t >= 0.66) return 'var(--color-good)';
  if (t <= 0.33) return 'var(--color-bad)';
  return 'var(--color-text)';
}
