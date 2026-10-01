/**
 * Porcentagens do randomizador (modo loop personalizado).
 *
 * Regra: a soma é sempre 100. Quem o usuário ajustou fica "fixo"; os demais
 * dividem igualmente o que sobra. Se todos os outros já estiverem fixos, o
 * vizinho (próximo destino, ou o anterior no caso do último) compensa a
 * diferença — assim o controle nunca trava.
 */

export type WeightState = { weights: number[]; pinned: boolean[] };

/** Divide `total` em `count` inteiros que somam exatamente `total`. */
export function splitEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function equalState(count: number): WeightState {
  return { weights: splitEvenly(100, count), pinned: Array(count).fill(false) };
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Recalcula os não fixos para fechar 100. */
export function redistribute(state: WeightState): WeightState {
  const weights = [...state.weights];
  const pinned = [...state.pinned];
  const free = pinned.map((isPinned, index) => (isPinned ? -1 : index)).filter((index) => index >= 0);
  const pinnedTotal = sum(weights.filter((_, index) => pinned[index]));

  if (free.length > 0) {
    const shares = splitEvenly(Math.max(0, 100 - pinnedTotal), free.length);
    free.forEach((index, position) => {
      weights[index] = shares[position];
    });
  } else if (weights.length > 0 && pinnedTotal !== 100) {
    // Todos fixos e a conta não fecha (ex.: um destino foi removido): o último absorve.
    const last = weights.length - 1;
    weights[last] = Math.max(0, Math.min(100, weights[last] + (100 - pinnedTotal)));
  }
  return { weights, pinned };
}

/** O usuário arrastou o destino `index` para `value`. */
export function setWeight(state: WeightState, index: number, value: number): WeightState {
  const count = state.weights.length;
  if (count === 0 || index < 0 || index >= count) return state;
  const weights = [...state.weights];
  const pinned = [...state.pinned];
  pinned[index] = true;

  const othersFree = pinned.some((isPinned, other) => other !== index && !isPinned);
  let absorber = -1;
  if (!othersFree && count > 1) {
    absorber = index < count - 1 ? index + 1 : index - 1;
    pinned[absorber] = false;
  }

  const fixedOthers = sum(weights.filter((_, other) => other !== index && pinned[other]));
  const max = Math.max(0, 100 - fixedOthers);
  weights[index] = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

  const next = redistribute({ weights, pinned });
  if (absorber >= 0) next.pinned[absorber] = true;
  return next;
}

export function addDestination(state: WeightState): WeightState {
  return redistribute({ weights: [...state.weights, 0], pinned: [...state.pinned, false] });
}

export function removeDestination(state: WeightState, index: number): WeightState {
  return redistribute({
    weights: state.weights.filter((_, other) => other !== index),
    pinned: state.pinned.filter((_, other) => other !== index),
  });
}

export function weightsTotal(weights: number[]) {
  return sum(weights);
}
