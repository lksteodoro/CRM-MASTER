import { supabase } from '../integrations/supabase/client';

/**
 * Ponte entre o criador de anúncios e a Graph API.
 *
 * Nenhuma função aqui conhece o access token da Meta: tudo passa pela Edge
 * Function `meta-proxy`, que lê a credencial da conexão OAuth da agência no
 * servidor. É o que mantém a ferramenta dentro das Platform Terms — token de
 * anúncios não pode existir no navegador.
 */


/** Códigos de limite de requisição da Meta. Merecem espera, não falha. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 80004]);

export class MetaApiError extends Error {
  code?: number;
  subcode?: number;
  userMessage?: string;

  constructor(message: string, details?: { code?: number; subcode?: number; userMessage?: string }) {
    super(message);
    this.name = 'MetaApiError';
    this.code = details?.code;
    this.subcode = details?.subcode;
    this.userMessage = details?.userMessage;
  }
}

export class MetaNotConnectedError extends Error {
  constructor(message = 'A agência não está conectada à Meta. Peça a um administrador para conectar em Configurações › APIs.') {
    super(message);
    this.name = 'MetaNotConnectedError';
  }
}

/** A Edge Function publicada ainda não conhece a operação pedida (deploy pendente). */
export class MetaProxyOutdatedError extends Error {
  constructor(op: string) {
    super(`A função meta-proxy publicada ainda não tem a operação "${op}".`);
    this.name = 'MetaProxyOutdatedError';
  }
}

type GraphError = { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };

function throwGraphError(error: GraphError, prefix?: string): never {
  const label = `[${error.code ?? '?'}${error.error_subcode ? `/${error.error_subcode}` : ''}]`;
  const text = error.error_user_msg || error.message || 'Falha na Meta.';
  throw new MetaApiError(`${prefix ? `${prefix} ` : ''}${label} ${text}`, {
    code: error.code,
    subcode: error.error_subcode,
    userMessage: error.error_user_msg,
  });
}

type InvokeOptions = { retries?: number; onRateLimit?: (seconds: number, code: number) => void };

/** Criar campanha, conjunto ou anúncio duas vezes duplicaria; só estas operações não se repetem sozinhas. */
const NON_REPEATABLE_OPS = new Set(['post', 'batch']);

/** Queda de rede ou servidor sobrecarregado (502/503/504/546): passa sozinho em segundos. */
function isTransientFailure(error: unknown) {
  const name = (error as { name?: string })?.name;
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return true;
  const status = Number((error as { context?: { status?: number } })?.context?.status);
  return status >= 500;
}

async function invoke<T = any>(payload: Record<string, unknown> | FormData, options: InvokeOptions = {}): Promise<T> {
  const retries = options.retries ?? 4;
  const op = String(payload instanceof FormData ? payload.get('op') : payload.op);
  let networkRetries = NON_REPEATABLE_OPS.has(op) ? 0 : 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await supabase.functions.invoke<any>('meta-proxy', { body: payload });

    if (error && isTransientFailure(error) && networkRetries > 0) {
      networkRetries -= 1;
      attempt -= 1;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (3 - networkRetries)));
      continue;
    }

    if (error) {
      // O corpo do erro carrega a razão real (409 de conexão ausente, 403 de
      // caminho não liberado). Sem ele o operador só veria "Edge Function
      // returned a non-2xx status code".
      let detail: any = null;
      try {
        detail = await (error as any).context?.json?.();
      } catch {
        detail = null;
      }
      if (detail?.error === 'meta_not_connected' || detail?.error === 'meta_token_expired') {
        throw new MetaNotConnectedError(detail.message);
      }
      if (detail?.error === 'path_not_allowed') {
        throw new MetaApiError(`Operação não liberada na integração: ${detail.path}`);
      }
      if (detail?.error === 'forbidden') {
        throw new MetaApiError('Seu usuário não tem a ferramenta Meta Ads liberada.');
      }
      if (detail?.error === 'invalid_op') {
        throw new MetaProxyOutdatedError(String(detail.op ?? ''));
      }
      throw new MetaApiError(detail?.message || error.message || 'Falha ao falar com a Meta.');
    }

    if (data?.error === 'meta_not_connected' || data?.error === 'meta_token_expired') {
      throw new MetaNotConnectedError(data.message);
    }

    const graphError: GraphError | undefined = data?.error && typeof data.error === 'object' ? data.error : undefined;
    if (graphError?.code && RATE_LIMIT_CODES.has(graphError.code)) {
      if (attempt === retries) {
        throw new MetaApiError(`Limite de requisições da Meta (${graphError.code}). Aguarde alguns minutos e tente de novo.`);
      }
      const wait = Math.min(15 * 2 ** attempt, 120);
      options.onRateLimit?.(wait, graphError.code);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }

    return data as T;
  }

  throw new MetaApiError('Não foi possível concluir a chamada à Meta.');
}

/** Leitura simples de um nó ou coleção. Devolve o payload cru da Meta. */
export async function metaGet<T = any>(path: string, params: Record<string, unknown> = {}, options?: InvokeOptions): Promise<T> {
  return invoke<T>({ op: 'get', path, params }, options);
}

/**
 * Percorre uma coleção paginada. O cursor volta pelo proxy sem o token
 * embutido, ao contrário do `paging.next` que a Meta devolve.
 */
export async function metaGetAll<T = any>(
  path: string,
  params: Record<string, unknown> = {},
  { maxPages = 20, ...options }: InvokeOptions & { maxPages?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const payload: { data?: T[]; error?: GraphError | null; after?: string | null } = await invoke(
      { op: 'get_page', path, params, after },
      options,
    );
    if (payload.error) throwGraphError(payload.error);
    rows.push(...(payload.data ?? []));
    after = payload.after ?? null;
    if (!after) break;
  }

  return rows;
}

/** Criação de campanha, conjunto, criativo ou anúncio. */
export async function metaPost<T = any>(path: string, params: Record<string, unknown>, options?: InvokeOptions): Promise<T> {
  const payload = await invoke<any>({ op: 'post', path, params }, options);
  if (payload?.error) throwGraphError(payload.error);
  return payload as T;
}

/** Edição de um objeto existente: status, nome ou orçamento (o servidor recusa o resto). */
export async function metaUpdate<T = any>(id: string, params: Record<string, string>, options?: InvokeOptions): Promise<T> {
  const payload = await invoke<any>({ op: 'update', path: id, params }, options);
  if (payload?.error) {
    if (typeof payload.error === 'string') throw new MetaApiError(payload.message || payload.error);
    throwGraphError(payload.error);
  }
  return payload as T;
}

export type BatchItem = { method: 'POST' | 'GET'; relative_url: string; body?: string };
export type BatchResponse = { code: number; body?: string };

/** Envio em lote. Devolve as respostas na mesma ordem dos itens. */
export async function metaBatch(items: BatchItem[], options?: InvokeOptions): Promise<BatchResponse[]> {
  const payload = await invoke<{ batch?: BatchResponse[] | { error?: GraphError } }>({ op: 'batch', items }, options);
  const batch = payload?.batch;
  if (!Array.isArray(batch)) {
    const graphError = (batch as { error?: GraphError } | undefined)?.error;
    if (graphError) throwGraphError(graphError, 'Lote recusado:');
    throw new MetaApiError('A Meta não devolveu o resultado do lote.');
  }
  return batch;
}

/** Monta um item de lote com o corpo já codificado como a Meta espera. */
export function buildBatchItem(relativeUrl: string, params: Record<string, unknown>): BatchItem {
  return {
    method: 'POST',
    relative_url: relativeUrl,
    body: Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(typeof value === 'object' ? JSON.stringify(value) : String(value))}`)
      .join('&'),
  };
}

async function fileToBase64(file: File | Blob): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let index = 0; index < buffer.length; index += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/** Sobe uma imagem de anúncio e devolve o hash usado no criativo. */
export async function metaUploadImage(adAccountId: string, file: File | Blob, fileName?: string): Promise<string> {
  // Sem o nome, a biblioteca de mídia da Meta lista toda imagem como "bytes".
  const name = fileName || (file instanceof File ? file.name : undefined);
  const payload = await invoke<any>({ op: 'upload_image', adAccountId, bytes: await fileToBase64(file), ...(name ? { fileName: name } : {}) });
  if (payload?.error) throwGraphError(payload.error, 'Imagem:');
  const image = Object.values(payload?.images ?? {})[0] as { hash?: string } | undefined;
  if (!image?.hash) throw new MetaApiError('O upload da imagem não retornou hash.');
  return image.hash;
}

/** Maior pedaço mandado de uma vez à Edge Function. */
const MAX_VIDEO_CHUNK_BYTES = 16 * 1024 * 1024;

const MEDIA_BUCKET = 'meta-ad-media';
const STORAGE_FREE_PLAN_LIMIT = 50 * 1024 * 1024;

/** Caminho antigo: Storage + URL assinada. Só para quando o servidor não foi atualizado. */
async function legacyUploadViaStorage(adAccountId: string, file: File, onProgress?: (fraction: number) => void): Promise<string> {
  if (file.size > STORAGE_FREE_PLAN_LIMIT) {
    throw new MetaApiError(
      `Vídeo de ${(file.size / 1024 / 1024).toFixed(0)} MB: o envio em partes ainda não foi ativado no servidor (função meta-proxy), e sem ele o limite é 50 MB.`,
    );
  }
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new MetaApiError('Sessão expirada. Entre novamente para publicar.');

  const extension = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, file, { contentType: file.type || 'video/mp4', upsert: false });
  if (uploadError) throw new MetaApiError(`Não foi possível preparar o vídeo: ${uploadError.message}`);
  onProgress?.(0.5);
  try {
    const payload = await invoke<any>({ op: 'upload_video', adAccountId, storagePath, name: file.name });
    if (payload?.error) throwGraphError(payload.error, 'Vídeo:');
    if (!payload?.id) throw new MetaApiError('O upload do vídeo não retornou id.');
    onProgress?.(1);
    return payload.id as string;
  } finally {
    void invoke({ op: 'discard_upload', storagePath }).catch(() => undefined);
  }
}

/**
 * Sobe um vídeo de anúncio em partes (upload resumable da Meta).
 *
 * Cada pedaço vai do navegador para a Edge Function `meta-proxy`, que o
 * repassa à Meta com a credencial do servidor. Antes o vídeo passava pelo
 * Storage do Supabase, que no plano gratuito recusa todo arquivo acima de
 * 50 MB ("The object exceeded the maximum allowed size").
 *
 * `onProgress` recebe a fração enviada (0–1).
 */
export async function metaUploadVideo(
  adAccountId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  let start: any;
  try {
    start = await invoke<any>({ op: 'video_start', adAccountId, fileSize: file.size });
  } catch (caught) {
    // Servidor ainda na versão antiga: usa o caminho anterior (Storage), que
    // funciona até o limite de 50 MB do plano gratuito do Supabase.
    if (caught instanceof MetaProxyOutdatedError) return legacyUploadViaStorage(adAccountId, file, onProgress);
    throw caught;
  }
  if (start?.error) throwGraphError(start.error, 'Vídeo (início):');
  const uploadSessionId = String(start?.upload_session_id ?? '');
  if (!uploadSessionId) throw new MetaApiError('A Meta não abriu a sessão de upload do vídeo.');

  let startOffset = Number(start.start_offset);
  let endOffset = Number(start.end_offset);
  let part = 0;

  // A Meta decide onde começa e termina cada parte; o loop segue os offsets
  // que ela devolve até start == end.
  while (startOffset < file.size && startOffset !== endOffset) {
    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset || endOffset > file.size) {
      throw new MetaApiError(`A Meta devolveu offsets inválidos no upload do vídeo (${startOffset}–${endOffset}).`);
    }
    part += 1;
    if (part > 5000) throw new MetaApiError('Upload do vídeo excedeu o limite de partes.');

    const cappedEnd = Math.min(endOffset, startOffset + MAX_VIDEO_CHUNK_BYTES);
    let useFullRange = false;
    let result: any = null;
    let lastError: unknown = null;
    // Pedaço que falhou é reenviado; a Meta aceita o mesmo offset de novo. Se a
    // parte limitada a 16 MB for recusada, tenta o intervalo inteiro pedido.
    for (let attempt = 0; attempt < 3; attempt++) {
      const sliceEnd = useFullRange ? endOffset : cappedEnd;
      try {
        const form = new FormData();
        form.set('op', 'video_chunk');
        form.set('adAccountId', adAccountId);
        form.set('uploadSessionId', uploadSessionId);
        form.set('startOffset', String(startOffset));
        form.set('fileName', file.name);
        form.set('chunk', file.slice(startOffset, sliceEnd), file.name);
        result = await invoke<any>(form);
        if (result?.error) throwGraphError(result.error, `Vídeo (parte ${part}):`);
        lastError = null;
        break;
      } catch (caught) {
        lastError = caught;
        if (cappedEnd < endOffset) useFullRange = true;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;

    startOffset = Number(result.start_offset);
    endOffset = Number(result.end_offset);
    onProgress?.(Math.min(1, startOffset / file.size));
  }

  if (startOffset < file.size) {
    throw new MetaApiError(`Upload do vídeo interrompido em ${startOffset} de ${file.size} bytes.`);
  }

  const finish = await invoke<any>({ op: 'video_finish', adAccountId, uploadSessionId, title: file.name });
  if (finish?.error) throwGraphError(finish.error, 'Vídeo (finalização):');
  const videoId = String(finish?.video_id ?? start.video_id ?? '');
  if (!videoId) throw new MetaApiError('O upload do vídeo não retornou id.');
  onProgress?.(1);
  return videoId;
}

// ── Espera do processamento dos vídeos ────────────────────────────────────────
// Uma única consulta a cada 5 s cobre todos os vídeos em processamento. Com 20+
// vídeos, consultar um a um batia no limite de requisições da conta.

type PendingVideo = { resolve: () => void; reject: (error: unknown) => void; deadline: number; onTick?: () => void };
const pendingVideos = new Map<string, PendingVideo>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let batchStatusSupported = true;

/** `true` quando pronto, um erro quando a Meta recusou, `false` enquanto processa. */
function readVideoStatus(status: any): true | false | MetaApiError {
  const videoStatus = String(status?.video_status ?? '').toLowerCase();
  const processingStatus = String(status?.processing_phase?.status ?? '').toLowerCase();
  if (['error', 'failed'].includes(videoStatus) || ['error', 'failed'].includes(processingStatus)) {
    const details = status?.processing_phase?.errors ?? status?.error_description ?? status;
    return new MetaApiError(`A Meta rejeitou o vídeo: ${JSON.stringify(details)}`);
  }
  // processing_phase=complete sozinho não basta: o SDK oficial só libera o
  // vídeo para o criativo quando video_status vira "ready".
  return videoStatus === 'ready';
}

async function fetchVideoStatuses(ids: string[]): Promise<Record<string, any>> {
  const statuses: Record<string, any> = {};
  if (batchStatusSupported) {
    try {
      for (let index = 0; index < ids.length; index += 50) {
        const payload = await invoke<any>({ op: 'video_status', ids: ids.slice(index, index + 50) });
        if (payload?.error) throwGraphError(payload.error, 'Status do vídeo:');
        for (const [id, node] of Object.entries(payload ?? {})) statuses[id] = (node as any)?.status;
      }
      return statuses;
    } catch (caught) {
      if (caught instanceof MetaProxyOutdatedError) batchStatusSupported = false;
      else if (!(caught instanceof MetaApiError) || RATE_LIMIT_CODES.has(caught.code ?? -1)) throw caught;
      // Erro da Meta no lote inteiro: consulta um a um para isolar o vídeo com problema.
    }
  }
  for (const id of ids) {
    const payload = await metaGet<any>(id, { fields: 'status' });
    if (payload?.error) {
      statuses[id] = { video_status: 'error', error_description: payload.error.message };
      continue;
    }
    statuses[id] = payload?.status;
  }
  return statuses;
}

// `pollTimer` fica preenchido também durante a consulta, para que um vídeo que
// entra na espera nesse meio-tempo não abra um segundo ciclo em paralelo.
async function pollPendingVideos() {
  const ids = [...pendingVideos.keys()];
  if (ids.length === 0) {
    pollTimer = null;
    return;
  }
  try {
    const statuses = await fetchVideoStatuses(ids);
    for (const id of ids) {
      const waiter = pendingVideos.get(id);
      if (!waiter) continue;
      const result = readVideoStatus(statuses[id]);
      if (result === true) {
        pendingVideos.delete(id);
        waiter.resolve();
      } else if (result instanceof MetaApiError) {
        pendingVideos.delete(id);
        waiter.reject(result);
      } else {
        waiter.onTick?.();
      }
    }
  } catch (caught) {
    // Credencial perdida não melhora esperando; queda de rede, sim.
    if (caught instanceof MetaNotConnectedError) {
      for (const [id, waiter] of pendingVideos) {
        pendingVideos.delete(id);
        waiter.reject(caught);
      }
    }
  }
  const now = Date.now();
  for (const [id, waiter] of pendingVideos) {
    if (now > waiter.deadline) {
      pendingVideos.delete(id);
      waiter.reject(new MetaApiError('A Meta não terminou de processar o vídeo em 20 minutos. Tente novamente.'));
    }
  }
  pollTimer = pendingVideos.size > 0 ? setTimeout(() => void pollPendingVideos(), 5000) : null;
}

/** Espera a Meta terminar de processar o vídeo antes de criar o criativo. */
export function waitForVideoReady(
  videoId: string,
  { timeoutMs = 20 * 60 * 1000, onTick }: { timeoutMs?: number; onTick?: () => void } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    pendingVideos.set(videoId, { resolve, reject, deadline: Date.now() + timeoutMs, onTick });
    pollTimer ??= setTimeout(() => void pollPendingVideos(), 3000);
  });
}

/**
 * Capa gerada pela própria Meta, para quando o navegador não consegue tirar um
 * quadro do vídeo (HEVC em placa sem suporte, por exemplo).
 */
export async function metaVideoThumbnailUrl(videoId: string): Promise<string | null> {
  try {
    const rows = await metaGetAll<{ uri?: string; is_preferred?: boolean }>(`${videoId}/thumbnails`, { fields: 'uri,is_preferred' }, { maxPages: 1 });
    const chosen = rows.find((row) => row.is_preferred && row.uri) ?? rows.find((row) => row.uri);
    if (chosen?.uri) return chosen.uri;
  } catch {
    // Proxy antigo sem o caminho de capas: tenta o campo `picture` do vídeo.
  }
  const payload = await metaGet<any>(videoId, { fields: 'picture' }).catch(() => null);
  return typeof payload?.picture === 'string' ? payload.picture : null;
}

export type MetaConnectionState = {
  connected: boolean;
  name: string | null;
  status: 'CONNECTED' | 'ERROR' | 'REVOKED' | null;
  message: string | null;
};

/** Diz se a agência tem conexão ativa — usado para habilitar a publicação. */
export async function getMetaConnectionState(): Promise<MetaConnectionState> {
  const db = supabase as any;
  const { data, error } = await db
    .from('meta_oauth_connections')
    .select('meta_user_name, status, last_error')
    .maybeSingle();

  if (error) {
    // Tabela ausente significa que a migration da integração ainda não foi
    // aplicada no banco. Sem distinguir isso, o operador vê "não conectado" e
    // fica tentando conectar numa tela que ainda não existe do outro lado.
    const missingTable = error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '');
    return {
      connected: false,
      name: null,
      status: null,
      message: missingTable
        ? 'A integração da Meta ainda não foi instalada neste ambiente: falta aplicar as migrations e publicar as Edge Functions.'
        : error.message ?? null,
    };
  }
  if (!data) {
    return { connected: false, name: null, status: null, message: null };
  }
  return {
    connected: data.status === 'CONNECTED',
    name: data.meta_user_name ?? null,
    status: data.status,
    message: data.last_error ?? null,
  };
}
