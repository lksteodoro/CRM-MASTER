export function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
}

export function formatNumber(value: number) {
  return value.toLocaleString('pt-BR');
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatDateShort(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// Formats a ranking value according to the active metric: currency for
// receita, plain counts for matrículas/pontos.
export function formatScore(value: number, metric: 'pontos' | 'matriculas' | 'receita') {
  if (metric === 'receita') return formatBRL(value);
  if (metric === 'pontos') return `${formatNumber(value)} pts`;
  return formatNumber(value);
}
