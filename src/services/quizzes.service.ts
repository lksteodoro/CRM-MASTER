import { supabase } from '../integrations/supabase/client';
import type {
  Json,
  QuizProductRow,
  QuizRow,
  QuizSessionRow,
  QuizVersionRow,
  QuizWebhookDeliveryRow,
} from '../integrations/supabase/database.types';
import { normalizeRedirectSlug } from './redirectLinks.service';
import { blankFlow, disparoTemplateFlow, type QuizFlow } from '../../supabase/functions/_shared/quizFlow.ts';
import { DEFAULT_THEME, type QuizTheme } from '../lib/quizTheme';

export { DEFAULT_THEME, type QuizTheme } from '../lib/quizTheme';

export interface Quiz extends Omit<QuizRow, 'draft_flow' | 'theme'> {
  draft_flow: QuizFlow | null;
  theme: QuizTheme;
}

export interface QuizStats {
  started: number;
  completed: number;
  qualified: number;
  last_at: string | null;
}

export type QuizTemplate = 'disparo' | 'blank';

function toQuiz(row: QuizRow): Quiz {
  return { ...row, draft_flow: (row.draft_flow as unknown as QuizFlow | null) ?? null, theme: (row.theme as QuizTheme | null) ?? {} };
}

function cleanSlug(value: string) {
  const slug = normalizeRedirectSlug(value);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) throw new Error('O endereço do quiz deve ter entre 3 e 80 caracteres.');
  return slug;
}

function friendlyError(error: { message?: string; code?: string }) {
  if (error.code === '23505' || /quizzes_slug_key/.test(error.message ?? '')) return new Error('Já existe um quiz com esse endereço. Escolha outro.');
  if (/invalid_flow/.test(error.message ?? '')) return new Error('O fluxo precisa de um Início e de pelo menos um bloco final antes de publicar.');
  return new Error(error.message || 'Não foi possível salvar.');
}

// ─── quizzes ─────────────────────────────────────────────────────────────────

export async function listQuizzes(): Promise<Quiz[]> {
  const { data, error } = await supabase.from('quizzes').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toQuiz);
}

export async function getQuiz(quizId: string): Promise<Quiz> {
  const { data, error } = await supabase.from('quizzes').select('*').eq('id', quizId).single();
  if (error) throw error;
  return toQuiz(data);
}

export async function listQuizStats(): Promise<Record<string, QuizStats>> {
  const { data, error } = await supabase.rpc('quiz_stats');
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.quiz_id, {
    started: Number(row.started),
    completed: Number(row.completed),
    qualified: Number(row.qualified),
    last_at: row.last_at,
  }]));
}

export async function createQuiz(input: { name: string; slug: string; title: string; product_id: string | null; template: QuizTemplate }): Promise<Quiz> {
  const name = input.name.trim();
  if (!name) throw new Error('Informe um nome para o quiz.');
  const flow = input.template === 'disparo' ? disparoTemplateFlow() : blankFlow();
  const theme: QuizTheme = {
    ...DEFAULT_THEME,
    welcome: input.template === 'disparo'
      ? { enabled: true, badge: 'Diagnóstico gratuito', title: 'Descubra se o disparo em massa é para a sua empresa', subtitle: 'Responda 4 perguntas rápidas e veja na hora se você se encaixa.', buttonLabel: 'Começar', note: 'Leva menos de 1 minuto' }
      : { enabled: false },
  };
  const { data, error } = await supabase
    .from('quizzes')
    .insert({ name, slug: cleanSlug(input.slug || name), title: input.title.trim() || name, product_id: input.product_id, draft_flow: flow as unknown as Json, theme: theme as unknown as Json, active: true })
    .select()
    .single();
  if (error) throw friendlyError(error);
  return toQuiz(data);
}

export async function duplicateQuiz(quiz: Quiz): Promise<Quiz> {
  const baseSlug = `${quiz.slug}-copia`.slice(0, 74);
  const { data: existing } = await supabase.from('quizzes').select('slug').like('slug', `${baseSlug}%`);
  const taken = new Set((existing ?? []).map((row) => row.slug));
  let slug = baseSlug;
  for (let index = 2; taken.has(slug); index += 1) slug = `${baseSlug}-${index}`;
  const { data, error } = await supabase
    .from('quizzes')
    .insert({ name: `${quiz.name} (cópia)`.slice(0, 120), slug, title: quiz.title, description: quiz.description, product_id: quiz.product_id, draft_flow: quiz.draft_flow as unknown as Json, theme: quiz.theme as unknown as Json, active: true })
    .select()
    .single();
  if (error) throw friendlyError(error);
  return toQuiz(data);
}

export interface QuizSettingsInput {
  name: string;
  slug: string;
  title: string;
  product_id: string | null;
  active: boolean;
  theme: QuizTheme;
}

export async function updateQuizSettings(quizId: string, input: QuizSettingsInput): Promise<Quiz> {
  const name = input.name.trim();
  const title = input.title.trim();
  if (!name) throw new Error('Informe um nome para o quiz.');
  if (!title) throw new Error('Informe o título do quiz.');
  const { data, error } = await supabase
    .from('quizzes')
    .update({ name, title, slug: cleanSlug(input.slug), product_id: input.product_id, active: input.active, theme: input.theme as unknown as Json })
    .eq('id', quizId)
    .select()
    .single();
  if (error) throw friendlyError(error);
  return toQuiz(data);
}

export async function saveQuizTheme(quizId: string, theme: QuizTheme): Promise<void> {
  const { error } = await supabase.from('quizzes').update({ theme: theme as unknown as Json }).eq('id', quizId);
  if (error) throw friendlyError(error);
}

export async function saveQuizDraft(quizId: string, flow: QuizFlow): Promise<void> {
  const { error } = await supabase.from('quizzes').update({ draft_flow: flow as unknown as Json }).eq('id', quizId);
  if (error) throw friendlyError(error);
}

export async function setQuizActive(quizId: string, active: boolean): Promise<Quiz> {
  const { data, error } = await supabase.from('quizzes').update({ active }).eq('id', quizId).select().single();
  if (error) throw error;
  return toQuiz(data);
}

export async function deleteQuiz(quizId: string) {
  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  if (error) throw error;
}

// ─── versões ─────────────────────────────────────────────────────────────────

export type QuizVersion = Omit<QuizVersionRow, 'flow' | 'theme'> & { flow: QuizFlow; theme: QuizTheme };

export async function listQuizVersions(quizId: string): Promise<QuizVersion[]> {
  const { data, error } = await supabase.from('quiz_versions').select('*').eq('quiz_id', quizId).order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ ...row, flow: row.flow as unknown as QuizFlow, theme: (row.theme as QuizTheme | null) ?? {} }));
}

export async function publishQuiz(quizId: string): Promise<QuizVersionRow> {
  const { data, error } = await supabase.rpc('publish_quiz', { p_quiz_id: quizId });
  if (error) throw friendlyError(error);
  return data;
}

// ─── produtos ────────────────────────────────────────────────────────────────

export async function listQuizProducts(): Promise<QuizProductRow[]> {
  const { data, error } = await supabase.from('quiz_products').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createQuizProduct(name: string): Promise<QuizProductRow> {
  const clean = name.trim();
  if (!clean) throw new Error('Informe o nome do produto.');
  const { data, error } = await supabase.from('quiz_products').insert({ name: clean }).select().single();
  if (error) throw error.code === '23505' ? new Error('Já existe um produto com esse nome.') : error;
  return data;
}

// ─── resultados ──────────────────────────────────────────────────────────────

export async function listQuizSessions(quizId: string): Promise<QuizSessionRow[]> {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('*')
    .eq('quiz_id', quizId)
    .order('started_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function listQuizWebhookDeliveries(quizId: string): Promise<QuizWebhookDeliveryRow[]> {
  const { data, error } = await supabase
    .from('quiz_webhook_deliveries')
    .select('*')
    .eq('quiz_id', quizId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

// ─── execução pública (Edge Function quiz-runtime) ──────────────────────────

const RUNTIME_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quiz-runtime`;

async function runtime<T>(body: Record<string, unknown>, keepalive = false): Promise<T> {
  const response = await fetch(RUNTIME_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
    keepalive,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || 'request_failed'), { code: payload.error, status: response.status });
  return payload as T;
}

export interface PublishedQuiz {
  version_id: string;
  title: string;
  theme: QuizTheme;
  flow: QuizFlow;
}

export type QuizCompletion =
  | { kind: 'redirect'; href: string }
  | { kind: 'end'; title: string; text: string; cta?: { label: string; href: string } | null };

export function loadPublishedQuiz(slug: string) {
  return runtime<PublishedQuiz>({ action: 'load', slug: normalizeRedirectSlug(slug) });
}

export function startQuizSession(slug: string, versionId: string, context: Record<string, string>) {
  const device = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
  return runtime<{ session_id: string }>({ action: 'start', slug: normalizeRedirectSlug(slug), version_id: versionId, context, device, referrer: document.referrer || null });
}

export function sendQuizProgress(sessionId: string, answers: Record<string, string | string[]>) {
  return runtime<{ ok: boolean }>({ action: 'progress', session_id: sessionId, answers }, true);
}

export function completeQuizSession(sessionId: string, answers: Record<string, string | string[]>) {
  return runtime<QuizCompletion>({ action: 'complete', session_id: sessionId, answers });
}

// ─── imagens do quiz (bucket público quiz-media) ────────────────────────────

const MEDIA_BUCKET = 'quiz-media';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Reduz para no máximo maxSide px e converte para WebP antes de enviar. GIF segue como está. */
async function optimizeImage(file: File, maxSide: number): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  return blob ?? file;
}

export async function uploadQuizImage(organizationId: string, file: File, maxSide = 2000): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) throw new Error('Envie uma imagem JPG, PNG, WebP, AVIF ou GIF.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('A imagem passa de 10 MB.');
  const blob = await optimizeImage(file, maxSide);
  const extension = blob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() ?? 'img').toLowerCase();
  const path = `${organizationId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: blob.type || file.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/mime|type/i.test(error.message) ? 'Formato de imagem não aceito.' : /size|large/i.test(error.message) ? 'Imagem grande demais.' : error.message);
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function listQuizImages(organizationId: string): Promise<{ url: string; name: string; created_at: string }[]> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(organizationId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  return (data ?? []).filter((item) => item.id).map((item) => ({ url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(`${organizationId}/${item.name}`).data.publicUrl, name: item.name, created_at: item.created_at ?? '' }));
}
