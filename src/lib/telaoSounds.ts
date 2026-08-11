export type SoundChoice = 'sino' | 'aplausos' | 'caixa' | 'vitoria';

let audioContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType = 'sine',
  gainPeak = 0.3
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainPeak, ctx.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

function playSino(ctx: AudioContext) {
  tone(ctx, 1568, 0, 0.6, 'sine', 0.25);
  tone(ctx, 2093, 0.05, 0.5, 'sine', 0.15);
}

function playCaixa(ctx: AudioContext) {
  tone(ctx, 880, 0, 0.12, 'square', 0.2);
  tone(ctx, 1318, 0.12, 0.18, 'square', 0.2);
}

function playAplausos(ctx: AudioContext) {
  for (let i = 0; i < 10; i++) {
    const start = i * 0.05 + Math.random() * 0.02;
    tone(ctx, 200 + Math.random() * 400, start, 0.08, 'sawtooth', 0.08);
  }
}

// Arpejo ascendente (sol-dó-mi-sol-dó oitava acima), estilo "fanfarra de vitória".
function playVitoria(ctx: AudioContext) {
  [392, 523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    tone(ctx, freq, i * 0.09, 0.4, i > 2 ? 'triangle' : 'sine', 0.22);
  });
}

/** Deve ser chamada dentro de um gesto do usuário (clique/toque) — libera o áudio no navegador. */
export function unlockAudio() {
  const ctx = getContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

export function playTelaoSound(kind: SoundChoice) {
  const ctx = getContext();
  if (ctx.state === 'suspended') void ctx.resume();
  if (kind === 'sino') playSino(ctx);
  else if (kind === 'caixa') playCaixa(ctx);
  else if (kind === 'vitoria') playVitoria(ctx);
  else playAplausos(ctx);
}
