import { useState } from 'react';

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({
  name,
  photoUrl,
  size = 40,
  accentColor,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
  /** Opcional — borda/glow na cor do rank (usado no pódio do telão). Sem isso, mantém o visual padrão. */
  accentColor?: string;
}) {
  const [broken, setBroken] = useState(false);
  const ring = accentColor ? { border: `3px solid ${accentColor}`, boxShadow: `0 0 16px ${accentColor}aa` } : {};

  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, ...ring }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: accentColor ? `linear-gradient(145deg, #e9f8ff, ${accentColor})` : 'var(--color-brand)',
        color: accentColor ? '#07101d' : undefined,
        ...ring,
      }}
    >
      {initials(name)}
    </div>
  );
}
