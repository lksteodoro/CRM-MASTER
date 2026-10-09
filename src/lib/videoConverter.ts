/**
 * Conversor de vídeo para anúncios da Meta (MP4 · H.264 · AAC), rodando no navegador.
 *
 * Caminho principal: WebCodecs via mediabunny. Usa o codificador da placa de
 * vídeo quando existe e lê o arquivo em partes, sem carregá-lo inteiro na
 * memória. Vídeo que já está em H.264 é só regravado como MP4, sem recodificar.
 *
 * Reserva: ffmpeg em WebAssembly (só CPU, um por vez, até 750 MB) para formatos
 * que o navegador não decodifica, como AVI, ProRes ou HEVC em placa sem suporte.
 */
import ffmpegCoreURL from '@ffmpeg/core?url';
import ffmpegWasmURL from '@ffmpeg/core/wasm?url';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import type { Conversion, DiscardedTrack, StreamTargetChunk } from 'mediabunny';
import {
  FFMPEG_MAX_BYTES,
  outputBaseName,
  planConversion,
  VIDEO_PRESETS,
  type VideoPlan,
  type VideoPreset,
  type VideoProbe,
} from './videoPlan';

/**
 * Conversões ao mesmo tempo. Placas de vídeo comuns aceitam poucas sessões de
 * codificação simultâneas; acima de 2 o ganho some e a chance de erro cresce.
 */
export const PARALLEL_JOBS = 2;

export type OutputDestination =
  | { kind: 'folder'; dir: FileSystemDirectoryHandle }
  | { kind: 'memory' };

export type ConvertedVideo = {
  name: string;
  size: number;
  /** Só no modo "baixar pelo navegador"; na pasta o arquivo já está gravado. */
  blob: Blob | null;
  engine: 'copy' | 'encode' | 'ffmpeg';
};

export class ConversionCanceled extends Error {
  constructor() {
    super('Conversão cancelada.');
    this.name = 'ConversionCanceled';
  }
}

// ── Carregamento sob demanda ──────────────────────────────────────────────────

type Mediabunny = typeof import('mediabunny');
let mediabunnyPromise: Promise<Mediabunny> | null = null;

/** Só baixa a biblioteca quando a ferramenta é usada. Registra o AAC reserva se o navegador não tiver o nativo. */
function loadMediabunny() {
  mediabunnyPromise ??= (async () => {
    const mb = await import('mediabunny');
    if (!(await mb.canEncodeAudio('aac'))) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
    }
    return mb;
  })().catch((caught) => {
    mediabunnyPromise = null;
    throw caught;
  });
  return mediabunnyPromise;
}

export function webCodecsAvailable() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

// ── Leitura do arquivo ────────────────────────────────────────────────────────

/** Lê formato, codecs, resolução e fps sem decodificar. `null` quando o navegador não reconhece o arquivo. */
export async function probeVideo(file: File): Promise<VideoProbe | null> {
  const mb = await loadMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    if (!(await input.canRead())) return null;
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    const [format, audio, duration, stats] = await Promise.all([
      input.getFormat(),
      input.getPrimaryAudioTrack(),
      input.computeDuration(),
      video.computePacketStats(120),
    ]);
    const decodable = webCodecsAvailable() && (await video.canDecode().catch(() => false));
    return {
      container: format.name,
      duration,
      width: video.displayWidth,
      height: video.displayHeight,
      fps: stats.averagePacketRate > 0 ? stats.averagePacketRate : null,
      videoCodec: video.codec,
      audioCodec: audio?.codec ?? null,
      audioChannels: audio?.numberOfChannels ?? null,
      audioSampleRate: audio?.sampleRate ?? null,
      bitrate: duration > 0 ? (file.size * 8) / duration : 0,
      decodable,
    };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

// ── Pasta de destino ──────────────────────────────────────────────────────────

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

/** Chrome e Edge gravam direto numa pasta; nos outros, o arquivo vai pelo download do navegador. */
export function folderPickerAvailable() {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export function pickOutputFolder() {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Este navegador não permite escolher pasta.');
  return picker({ id: 'conversor-video', mode: 'readwrite' });
}

// Nomes já prometidos a uma conversão em andamento, por pasta (o Windows não
// diferencia maiúsculas). Evita que dois vídeos com o mesmo nome se sobrescrevam.
const reservedNames = new WeakMap<FileSystemDirectoryHandle, Set<string>>();

async function fileExists(dir: FileSystemDirectoryHandle, name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nunca sobrescreve: se a pasta já tem um arquivo com o nome (inclusive o
 * próprio original, quando a pasta de destino é a mesma), acrescenta `_meta`.
 */
async function openFolderSlot(dir: FileSystemDirectoryHandle, sourceName: string) {
  let reserved = reservedNames.get(dir);
  if (!reserved) {
    reserved = new Set();
    reservedNames.set(dir, reserved);
  }
  const base = outputBaseName(sourceName);
  let name: string | null = null;
  for (let attempt = 0; attempt < 500 && !name; attempt++) {
    const candidate = attempt === 0 ? `${base}.mp4` : attempt === 1 ? `${base}_meta.mp4` : `${base}_meta_${attempt}.mp4`;
    const key = candidate.toLowerCase();
    if (reserved.has(key)) continue;
    reserved.add(key);
    if (await fileExists(dir, candidate)) continue;
    name = candidate;
  }
  if (!name) throw new Error('Não foi possível escolher um nome livre na pasta de destino.');

  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const slotName = name;
  const slotKey = name.toLowerCase();
  return {
    name: slotName,
    handle,
    writable,
    /** Apaga o arquivo parcial depois de erro ou cancelamento. */
    async discard() {
      await writable.abort().catch(() => undefined);
      // O fechamento do arquivo pelo cancelamento pode terminar depois daqui;
      // insiste algumas vezes até a remoção pegar.
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          await dir.removeEntry(slotName);
          break;
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === 'NotFoundError') break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      reserved.delete(slotKey);
    },
  };
}

// ── Caminho principal: WebCodecs ──────────────────────────────────────────────

function describeDiscarded(tracks: DiscardedTrack[]) {
  const reasons: Record<DiscardedTrack['reason'], string> = {
    discarded_by_user: 'descartado',
    max_track_count_reached: 'excesso de trilhas',
    max_track_count_of_type_reached: 'excesso de trilhas',
    unknown_source_codec: 'codec desconhecido',
    undecodable_source_codec: 'o navegador não decodifica esse codec',
    no_encodable_target_codec: 'o navegador não tem o codificador necessário',
    cannot_copy: 'não dá para copiar sem recodificar',
  };
  return tracks
    .map((item) => `${item.track.isVideoTrack() ? 'vídeo' : 'áudio'}: ${reasons[item.reason]}`)
    .join('; ');
}

async function convertWithWebCodecs(
  file: File,
  plan: VideoPlan,
  preset: VideoPreset,
  destination: OutputDestination,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<ConvertedVideo> {
  const mb = await loadMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const slot = destination.kind === 'folder' ? await openFolderSlot(destination.dir, file.name) : null;
  const memory = slot ? null : new mb.BufferTarget();
  let conversion: Conversion | null = null;
  let output: InstanceType<Mediabunny['Output']> | null = null;
  const onAbort = () => void conversion?.cancel();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    output = new mb.Output({
      // Na pasta grava em fluxo, com o índice no fim (menos memória; a Meta
      // não precisa dele no começo). Em memória o índice vai na frente.
      format: new mb.Mp4OutputFormat({ fastStart: slot ? false : 'in-memory' }),
      target: slot
        ? new mb.StreamTarget(slot.writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true })
        : memory!,
    });

    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      video: plan.engine === 'copy'
        ? { codec: 'avc' }
        : {
            codec: 'avc',
            width: plan.width,
            height: plan.height,
            fit: 'fill',
            ...(plan.fps ? { frameRate: plan.fps } : {}),
            quality: new mb.Quality({ bitrate: plan.videoBitrate }),
            forceTranscode: true,
            // Grava a rotação do celular na imagem em vez de depender de metadado.
            allowTransformationMetadata: false,
          },
      audio: plan.audio === 'encode'
        ? {
            codec: 'aac',
            numberOfChannels: plan.audioChannels,
            sampleRate: plan.audioSampleRate,
            quality: new mb.Quality({ bitrate: preset.audioBitrate }),
            forceTranscode: true,
          }
        : { codec: 'aac' },
    });
    if (signal.aborted) throw new ConversionCanceled();

    // Perder o áudio em silêncio seria pior que falhar: aí o ffmpeg assume.
    const lost = conversion.discardedTracks.filter((item) => item.reason !== 'discarded_by_user');
    if (!conversion.isValid || lost.length > 0) {
      throw new Error(`Não deu para converter pelo navegador (${describeDiscarded(lost) || 'configuração inválida'}).`);
    }

    conversion.onProgress = (progress) => onProgress(Math.min(0.99, progress));
    await conversion.execute();

    if (slot) {
      const saved = await slot.handle.getFile();
      return { name: slot.name, size: saved.size, blob: null, engine: plan.engine === 'copy' ? 'copy' : 'encode' };
    }
    const buffer = memory!.buffer!;
    return {
      name: `${outputBaseName(file.name)}.mp4`,
      size: buffer.byteLength,
      blob: new Blob([buffer], { type: 'video/mp4' }),
      engine: plan.engine === 'copy' ? 'copy' : 'encode',
    };
  } catch (caught) {
    // Espera a saída fechar o arquivo antes de apagá-lo; senão o fechamento
    // tardio recria o arquivo parcial na pasta.
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined);
    if (slot) await slot.discard();
    if (signal.aborted || (caught instanceof Error && caught.name === 'ConversionCanceledError')) throw new ConversionCanceled();
    throw caught;
  } finally {
    signal.removeEventListener('abort', onAbort);
    input.dispose();
  }
}

// ── Reserva: ffmpeg (WebAssembly) ─────────────────────────────────────────────

let ffmpegPromise: Promise<{ ffmpeg: FFmpeg; fetchFile: (file: File) => Promise<Uint8Array> }> | null = null;
let ffmpegQueue: Promise<unknown> = Promise.resolve();
let ffmpegProgress: ((fraction: number) => void) | null = null;
let ffmpegLog: string[] = [];

function loadFfmpeg() {
  ffmpegPromise ??= (async () => {
    const [{ FFmpeg }, { fetchFile }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => ffmpegProgress?.(progress));
    ffmpeg.on('log', ({ message }) => {
      ffmpegLog.push(message);
      if (ffmpegLog.length > 30) ffmpegLog.shift();
    });
    await ffmpeg.load({ coreURL: ffmpegCoreURL, wasmURL: ffmpegWasmURL });
    return { ffmpeg, fetchFile };
  })().catch((caught) => {
    ffmpegPromise = null;
    throw caught;
  });
  return ffmpegPromise;
}

/** Mesmos limites do perfil, em sintaxe do ffmpeg: cabe na caixa, nunca aumenta, lados pares. */
export function ffmpegArgs(inputName: string, outputName: string, preset: VideoPreset) {
  const kbps = Math.round(preset.videoBitrate / 1000);
  const { maxLong, maxShort } = preset;
  const scale =
    `scale=w='min(iw,if(gte(iw,ih),${maxLong},${maxShort}))'` +
    `:h='min(ih,if(gte(iw,ih),${maxShort},${maxLong}))'` +
    ':force_original_aspect_ratio=decrease:force_divisible_by=2';
  return [
    '-i', inputName,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', scale,
    '-fpsmax', String(preset.maxFps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', `${Math.round(preset.audioBitrate / 1000)}k`, '-ac', '2', '-ar', '48000',
    '-movflags', '+faststart',
    '-y', outputName,
  ];
}

async function convertWithFfmpeg(
  file: File,
  preset: VideoPreset,
  destination: OutputDestination,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<ConvertedVideo> {
  if (file.size > FFMPEG_MAX_BYTES) {
    throw new Error('O conversor reserva aceita até 750 MB. Converta este arquivo fora do sistema.');
  }

  // Uma instância só, um arquivo por vez: o ffmpeg carrega o vídeo inteiro na memória.
  const run = async (): Promise<Uint8Array> => {
    if (signal.aborted) throw new ConversionCanceled();
    const { ffmpeg, fetchFile } = await loadFfmpeg();
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const extension = (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const inputName = `in_${stamp}.${extension}`;
    const outputName = `out_${stamp}.mp4`;
    const onAbort = () => {
      ffmpeg.terminate();
      ffmpegPromise = null;
    };
    signal.addEventListener('abort', onAbort, { once: true });
    ffmpegProgress = (fraction) => onProgress(Math.max(0, Math.min(0.99, fraction)));
    ffmpegLog = [];
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const code = await ffmpeg.exec(ffmpegArgs(inputName, outputName, preset));
      if (code !== 0) throw new Error(`O conversor reserva falhou: ${ffmpegLog.slice(-2).join(' ')}`);
      return (await ffmpeg.readFile(outputName)) as Uint8Array;
    } catch (caught) {
      if (signal.aborted) throw new ConversionCanceled();
      throw caught;
    } finally {
      signal.removeEventListener('abort', onAbort);
      ffmpegProgress = null;
      if (!signal.aborted) await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
    }
  };
  const queued = ffmpegQueue.then(run, run);
  ffmpegQueue = queued.catch(() => undefined);
  const data = await queued;

  if (destination.kind === 'folder') {
    const slot = await openFolderSlot(destination.dir, file.name);
    try {
      await slot.writable.write(data as Uint8Array<ArrayBuffer>);
      await slot.writable.close();
    } catch (caught) {
      await slot.discard();
      throw caught;
    }
    return { name: slot.name, size: data.byteLength, blob: null, engine: 'ffmpeg' };
  }
  return {
    name: `${outputBaseName(file.name)}.mp4`,
    size: data.byteLength,
    blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }),
    engine: 'ffmpeg',
  };
}

// ── Entrada única ─────────────────────────────────────────────────────────────

export async function convertVideo(
  file: File,
  plan: VideoPlan,
  preset: VideoPreset,
  options: {
    destination: OutputDestination;
    onProgress: (fraction: number) => void;
    /** Avisa quando o navegador falha e o ffmpeg assume. */
    onFallback?: (reason: string) => void;
    signal: AbortSignal;
  },
): Promise<ConvertedVideo> {
  const { destination, onProgress, onFallback, signal } = options;
  if (plan.engine === 'blocked') throw new Error(plan.reasons.at(-1) ?? 'Arquivo não suportado.');
  if (plan.engine === 'ffmpeg') return convertWithFfmpeg(file, preset, destination, onProgress, signal);

  try {
    return await convertWithWebCodecs(file, plan, preset, destination, onProgress, signal);
  } catch (caught) {
    if (caught instanceof ConversionCanceled || file.size > FFMPEG_MAX_BYTES) throw caught;
    onFallback?.(caught instanceof Error ? caught.message : String(caught));
    onProgress(0);
    return convertWithFfmpeg(file, preset, destination, onProgress, signal);
  }
}

// ── Apoio ao criador de anúncios ──────────────────────────────────────────────

/**
 * Um quadro do vídeo como JPEG, para a capa do anúncio. Decodifica pelo
 * WebCodecs, então funciona até com HEVC que o elemento <video> não abre.
 */
export async function extractVideoFrame(file: File, atSeconds = 0.5, maxSide = 1920): Promise<Blob | null> {
  if (!webCodecsAvailable()) return null;
  const mb = await loadMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const scale = Math.min(1, maxSide / Math.max(track.displayWidth, track.displayHeight));
    const sink = new mb.CanvasSink(track, {
      width: Math.max(2, Math.round(track.displayWidth * scale)),
      height: Math.max(2, Math.round(track.displayHeight * scale)),
      fit: 'fill',
    });
    const start = await track.getFirstTimestamp();
    const duration = await track.computeDuration();
    const frame = await sink.getCanvas(Math.min(start + atSeconds, start + duration / 2));
    if (!frame) return null;
    const canvas = frame.canvas;
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** Abaixo disso, otimizar não compensa: sobe mais rápido do jeito que está. */
export const OPTIMIZE_MIN_BYTES = 60 * 1024 * 1024;

export type UploadOptimization = { file: File; optimized: boolean; before: number; after: number };

/**
 * Antes de subir, encolhe só o vídeo que vale a pena (4K, 60 fps, bitrate alto),
 * pela placa de vídeo e em segundos. Qualquer falha devolve o original: o envio
 * nunca deixa de acontecer por causa da otimização.
 */
export async function optimizeForUpload(
  file: File,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadOptimization> {
  const original: UploadOptimization = { file, optimized: false, before: file.size, after: file.size };
  if (file.size < OPTIMIZE_MIN_BYTES || !webCodecsAvailable()) return original;
  try {
    const probe = await probeVideo(file);
    if (!probe || !probe.decodable || probe.duration <= 0) return original;
    const preset = VIDEO_PRESETS.meta;
    const plan = planConversion(file.size, probe, preset);
    if (plan.engine !== 'encode') return original;
    const expected = ((plan.videoBitrate + preset.audioBitrate) * probe.duration) / 8;
    if (expected > file.size * 0.6) return original;

    const result = await convertWithWebCodecs(
      file,
      plan,
      preset,
      { kind: 'memory' },
      options.onProgress ?? (() => undefined),
      options.signal ?? new AbortController().signal,
    );
    if (!result.blob || result.size > file.size * 0.8) return original;
    return {
      file: new File([result.blob], result.name, { type: 'video/mp4' }),
      optimized: true,
      before: file.size,
      after: result.size,
    };
  } catch {
    return original;
  }
}
