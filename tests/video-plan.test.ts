import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitInside,
  outputBaseName,
  planConversion,
  VIDEO_PRESETS,
  type VideoProbe,
} from '../src/lib/videoPlan.ts';

const meta = VIDEO_PRESETS.meta;
const MB = 1024 * 1024;

const probe = (overrides: Partial<VideoProbe> = {}): VideoProbe => ({
  container: 'MP4',
  duration: 30,
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'avc',
  audioCodec: 'aac',
  audioChannels: 2,
  audioSampleRate: 48_000,
  bitrate: 5_000_000,
  decodable: true,
  ...overrides,
});

test('cabe na caixa do perfil sem aumentar e com lados pares', () => {
  assert.deepEqual(fitInside(3840, 2160, meta), { width: 1920, height: 1080, resized: true });
  assert.deepEqual(fitInside(2160, 3840, meta), { width: 1080, height: 1920, resized: true });
  assert.deepEqual(fitInside(1080, 1920, meta), { width: 1080, height: 1920, resized: false });
  assert.deepEqual(fitInside(1440, 1440, meta), { width: 1080, height: 1080, resized: true });
  assert.deepEqual(fitInside(640, 360, meta), { width: 640, height: 360, resized: false });
  const odd = fitInside(1081, 1921, meta);
  assert.equal(odd.width % 2, 0);
  assert.equal(odd.height % 2, 0);
});

test('H.264 + AAC dentro do perfil só é regravado', () => {
  const plan = planConversion(20 * MB, probe(), meta);
  assert.equal(plan.engine, 'copy');
  assert.equal(plan.audio, 'copy');
});

test('MOV com H.264 também só troca o contêiner', () => {
  const plan = planConversion(20 * MB, probe({ container: 'QuickTime File Format' }), meta);
  assert.equal(plan.engine, 'copy');
});

test('HEVC de iPhone em 4K e 60 fps é convertido e reduzido', () => {
  const plan = planConversion(400 * MB, probe({ videoCodec: 'hevc', width: 2160, height: 3840, fps: 60, bitrate: 50_000_000 }), meta);
  assert.equal(plan.engine, 'encode');
  assert.equal(plan.width, 1080);
  assert.equal(plan.height, 1920);
  assert.equal(plan.fps, 30);
});

test('H.264 pesado demais é recomprimido mesmo no tamanho certo', () => {
  const plan = planConversion(150 * MB, probe({ bitrate: 40_000_000 }), meta);
  assert.equal(plan.engine, 'encode');
  assert.equal(plan.fps, null);
});

test('60 fps passa no perfil alta qualidade e cai para 30 no recomendado', () => {
  assert.equal(planConversion(20 * MB, probe({ fps: 59.94, bitrate: 8_000_000 }), VIDEO_PRESETS.quality).engine, 'copy');
  assert.equal(planConversion(20 * MB, probe({ fps: 59.94, bitrate: 8_000_000 }), meta).fps, 30);
});

test('codec que o navegador não decodifica vai para o conversor reserva', () => {
  assert.equal(planConversion(300 * MB, probe({ videoCodec: 'hevc', decodable: false }), meta).engine, 'ffmpeg');
  assert.equal(planConversion(900 * MB, probe({ videoCodec: 'hevc', decodable: false }), meta).engine, 'blocked');
});

test('formato ilegível (AVI) usa o reserva até 750 MB', () => {
  assert.equal(planConversion(200 * MB, null, meta).engine, 'ffmpeg');
  assert.equal(planConversion(800 * MB, null, meta).engine, 'blocked');
});

test('áudio fora de AAC ou com mais de 2 canais é convertido', () => {
  assert.equal(planConversion(20 * MB, probe({ audioCodec: 'opus' }), meta).audio, 'encode');
  const surround = planConversion(20 * MB, probe({ audioChannels: 6 }), meta);
  assert.equal(surround.audio, 'encode');
  assert.equal(surround.audioChannels, 2);
  assert.equal(planConversion(20 * MB, probe({ audioCodec: null, audioChannels: null }), meta).audio, 'none');
  assert.equal(planConversion(20 * MB, probe({ audioCodec: 'pcm-s16', audioSampleRate: 96_000 }), meta).audioSampleRate, 48_000);
});

test('mantém o nome para o criador parear feed e stories', () => {
  assert.equal(outputBaseName('Criativo 01_feed.MOV'), 'Criativo 01_feed');
  assert.equal(outputBaseName('video.final.mp4'), 'video.final');
  assert.equal(outputBaseName('.mp4'), 'video');
});
