/**
 * Decide o que fazer com cada vídeo antes de subir para a Meta.
 *
 * Funções puras: recebem o que foi lido do arquivo e o perfil escolhido e
 * devolvem o plano. O motor que executa fica em `videoConverter.ts`.
 */

export type VideoPresetKey = 'meta' | 'quality' | 'light';

export type VideoPreset = {
  label: string;
  hint: string;
  /** Lado maior máximo, em pixels. */
  maxLong: number;
  /** Lado menor máximo, em pixels. */
  maxShort: number;
  maxFps: number;
  /** Bitrate de vídeo para 1080×1920 a 30 fps; outras resoluções escalam a partir dele. */
  videoBitrate: number;
  audioBitrate: number;
};

export const VIDEO_PRESETS: Record<VideoPresetKey, VideoPreset> = {
  meta: {
    label: 'Meta Ads (recomendado)',
    hint: 'Até 1080p, 30 fps, cerca de 6 Mbps. Já fica acima da qualidade que a Meta entrega no feed.',
    maxLong: 1920,
    maxShort: 1080,
    maxFps: 30,
    videoBitrate: 6_000_000,
    audioBitrate: 128_000,
  },
  quality: {
    label: 'Alta qualidade',
    hint: 'Até 1080p, mantém até 60 fps, cerca de 10 Mbps. Arquivo maior, upload mais lento.',
    maxLong: 1920,
    maxShort: 1080,
    maxFps: 60,
    videoBitrate: 10_000_000,
    audioBitrate: 192_000,
  },
  light: {
    label: 'Leve',
    hint: 'Até 720p, 30 fps, cerca de 3 Mbps. Sobe bem mais rápido, mas perde nitidez em telas grandes.',
    maxLong: 1280,
    maxShort: 720,
    maxFps: 30,
    videoBitrate: 3_000_000,
    audioBitrate: 128_000,
  },
};

/** O ffmpeg reserva carrega o arquivo inteiro na memória; acima disso trava a aba. */
export const FFMPEG_MAX_BYTES = 750 * 1024 * 1024;

/** Limite da Meta para vídeo de anúncio. */
export const META_MAX_BYTES = 4 * 1024 * 1024 * 1024;

/** O que foi possível ler do arquivo sem decodificar o vídeo. */
export type VideoProbe = {
  container: string;
  duration: number;
  /** Dimensões de exibição (já considerando a rotação do celular). */
  width: number;
  height: number;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  /** Bitrate médio do arquivo inteiro (vídeo + áudio). */
  bitrate: number;
  /** O navegador consegue decodificar o vídeo (necessário para recodificar). */
  decodable: boolean;
};

export type VideoPlan = {
  /**
   * - `copy`: já está em H.264; só troca o contêiner para MP4 (segundos).
   * - `encode`: recodifica pelo navegador, usando a placa de vídeo quando houver.
   * - `ffmpeg`: o navegador não lê o formato; usa o conversor reserva (só CPU, lento).
   * - `blocked`: não dá para converter aqui.
   */
  engine: 'copy' | 'encode' | 'ffmpeg' | 'blocked';
  width: number;
  height: number;
  /** Taxa de quadros de saída, quando precisa reduzir. */
  fps: number | null;
  videoBitrate: number;
  audio: 'none' | 'copy' | 'encode';
  audioChannels: number;
  audioSampleRate: number;
  /** Por que esse caminho foi escolhido, para mostrar na tela. */
  reasons: string[];
};

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Cabe o vídeo na caixa do perfil sem distorcer e sem aumentar. Lados sempre pares (exigência do H.264). */
export function fitInside(width: number, height: number, preset: Pick<VideoPreset, 'maxLong' | 'maxShort'>) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, preset.maxLong / long, preset.maxShort / short);
  return { width: even(width * scale), height: even(height * scale), resized: scale < 1 };
}

/** Bitrate proporcional à área da imagem, com piso para vídeos pequenos não ficarem borrados. */
export function videoBitrateFor(width: number, height: number, fps: number, preset: VideoPreset) {
  const area = Math.max(0.6, (width * height) / (1920 * 1080));
  const motion = fps > 35 ? 1.5 : 1;
  return Math.round(preset.videoBitrate * area * motion);
}

const AUDIO_RATES = [44_100, 48_000];

export function planConversion(
  fileSize: number,
  probe: VideoProbe | null,
  preset: VideoPreset,
): VideoPlan {
  const blank = {
    width: 0,
    height: 0,
    fps: null,
    videoBitrate: preset.videoBitrate,
    audio: 'encode' as const,
    audioChannels: 2,
    audioSampleRate: 48_000,
  };

  if (!probe || !probe.videoCodec || !probe.width || !probe.height) {
    if (fileSize > FFMPEG_MAX_BYTES) {
      return { ...blank, engine: 'blocked', reasons: ['Formato que o navegador não lê e arquivo acima de 750 MB. Converta fora do sistema.'] };
    }
    return { ...blank, engine: 'ffmpeg', reasons: ['Formato que o navegador não lê: usa o conversor reserva (mais lento).'] };
  }

  const box = fitInside(probe.width, probe.height, preset);
  const fpsOver = probe.fps != null && probe.fps > preset.maxFps + 0.5;
  const outFps = Math.min(probe.fps ?? 30, preset.maxFps);
  const videoBitrate = videoBitrateFor(box.width, box.height, outFps, preset);
  // Arquivo bem mais pesado que o alvo: recodificar sai mais barato que subir.
  const heavy = probe.bitrate > (videoBitrate + preset.audioBitrate) * 1.6;
  const isH264 = probe.videoCodec === 'avc';

  const reasons: string[] = [];
  if (!isH264) reasons.push(`Vídeo em ${codecLabel(probe.videoCodec)}: converte para H.264.`);
  if (box.resized) reasons.push(`${probe.width}×${probe.height} reduz para ${box.width}×${box.height}.`);
  if (fpsOver) reasons.push(`${Math.round(probe.fps ?? 0)} fps reduz para ${preset.maxFps}.`);
  if (heavy && isH264 && !box.resized && !fpsOver) {
    reasons.push(`${formatBitrate(probe.bitrate)} é pesado para anúncio: recomprime para ~${formatBitrate(videoBitrate)}.`);
  }

  const channels = probe.audioChannels ?? 2;
  const audio: VideoPlan['audio'] = !probe.audioCodec
    ? 'none'
    : probe.audioCodec === 'aac' && channels <= 2
      ? 'copy'
      : 'encode';
  if (audio === 'encode') reasons.push(`Áudio em ${codecLabel(probe.audioCodec)}: converte para AAC.`);
  if (audio === 'none') reasons.push('Vídeo sem áudio.');

  const needsVideoEncode = !isH264 || box.resized || fpsOver || heavy;
  const base = {
    width: box.width,
    height: box.height,
    fps: fpsOver ? preset.maxFps : null,
    videoBitrate,
    audio,
    audioChannels: Math.min(2, channels),
    audioSampleRate: probe.audioSampleRate && AUDIO_RATES.includes(probe.audioSampleRate) ? probe.audioSampleRate : 48_000,
  };

  if (!needsVideoEncode) {
    return {
      ...base,
      engine: 'copy',
      reasons: [probe.container === 'MP4' ? 'Já está em H.264: só regrava como MP4, sem perder qualidade.' : `H.264 em ${probe.container}: só troca para MP4, sem recodificar.`, ...reasons],
    };
  }

  if (!probe.decodable) {
    if (fileSize > FFMPEG_MAX_BYTES) {
      return { ...base, engine: 'blocked', reasons: [...reasons, 'Este navegador não decodifica o vídeo e o arquivo passa de 750 MB. Converta fora do sistema.'] };
    }
    return { ...base, engine: 'ffmpeg', reasons: [...reasons, 'Este navegador não decodifica o vídeo: usa o conversor reserva (mais lento).'] };
  }

  return { ...base, engine: 'encode', reasons };
}

/** Mantém o nome original (o criador de anúncios pareia Feed e Stories pelo nome) e troca a extensão. */
export function outputBaseName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || 'video';
}

export function codecLabel(codec: string | null) {
  const labels: Record<string, string> = {
    avc: 'H.264',
    hevc: 'HEVC (H.265)',
    vp8: 'VP8',
    vp9: 'VP9',
    av1: 'AV1',
    aac: 'AAC',
    opus: 'Opus',
    mp3: 'MP3',
    vorbis: 'Vorbis',
    flac: 'FLAC',
  };
  if (!codec) return 'formato desconhecido';
  if (codec.startsWith('pcm')) return 'PCM';
  return labels[codec] ?? codec.toUpperCase();
}

export function formatBitrate(bitsPerSecond: number) {
  return `${(bitsPerSecond / 1_000_000).toFixed(bitsPerSecond >= 10_000_000 ? 0 : 1).replace('.', ',')} Mbps`;
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
