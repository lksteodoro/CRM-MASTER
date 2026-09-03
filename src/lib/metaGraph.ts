import { supabase } from '../integrations/supabase/client';

/**
 * Ponte entre o criador de anúncios e a Graph API.
 *
 * Nenhuma função aqui conhece o access token da Meta: tudo passa pela Edge
 * Function `meta-proxy`, que lê a credencial da conexão OAuth da agência no
 * servidor. É o que mantém a ferramenta dentro das Platform Terms — token de
 * anúncios não pode existir no navegador.
 */

const MEDIA_BUCKET = 'meta-ad-media';

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

async function invoke<T = any>(payload: Record<string, unknown>, options: InvokeOptions = {}): Promise<T> {
  const retries = options.retries ?? 4;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { data, error } = await supabase.functions.invoke<any>('meta-proxy', { body: payload });

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
export async function metaUploadImage(adAccountId: string, file: File | Blob): Promise<string> {
  const payload = await invoke<any>({ op: 'upload_image', adAccountId, bytes: await fileToBase64(file) });
  if (payload?.error) throwGraphError(payload.error, 'Imagem:');
  const image = Object.values(payload?.images ?? {})[0] as { hash?: string } | undefined;
  if (!image?.hash) throw new MetaApiError('O upload da imagem não retornou hash.');
  return image.hash;
}

/**
 * Sobe um vídeo de anúncio.
 *
 * O arquivo vai primeiro para um bucket privado do projeto; a Edge Function
 * emite uma URL assinada de uma hora e manda a Meta buscar o arquivo de lá.
 * Isso substitui o envio em partes feito antes pelo navegador — que só
 * funcionava com o token exposto no cliente.
 */
export async function metaUploadVideo(
  adAccountId: string,
  file: File,
  onStage?: (stage: 'uploading' | 'sending' | 'done') => void,
): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new MetaApiError('Sessão expirada. Entre novamente para publicar.');

  const extension = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;

  onStage?.('uploading');
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, file, { contentType: file.type || 'video/mp4', upsert: false });
  if (uploadError) throw new MetaApiError(`Não foi possível preparar o vídeo: ${uploadError.message}`);

  try {
    onStage?.('sending');
    const payload = await invoke<any>({ op: 'upload_video', adAccountId, storagePath, name: file.name });
    if (payload?.error) throwGraphError(payload.error, 'Vídeo:');
    if (!payload?.id) throw new MetaApiError('O upload do vídeo não retornou id.');
    onStage?.('done');
    return payload.id as string;
  } finally {
    // O arquivo só precisa existir enquanto a Meta o baixa. Guardá-lo depois
    // seria acumular mídia de cliente sem motivo.
    void invoke({ op: 'discard_upload', storagePath }).catch(() => undefined);
  }
}

/** Espera a Meta terminar de processar o vídeo antes de criar o criativo. */
export async function waitForVideoReady(
  videoId: string,
  { timeoutMs = 10 * 60 * 1000, onTick }: { timeoutMs?: number; onTick?: () => void } = {},
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await metaGet<any>(videoId, { fields: 'status' });
    if (payload?.error) throwGraphError(payload.error, 'Status do vídeo:');

    const status = payload?.status ?? {};
    const videoStatus = String(status.video_status ?? '').toLowerCase();
    const processingStatus = String(status.processing_phase?.status ?? '').toLowerCase();

    if (['error', 'failed'].includes(videoStatus) || ['error', 'failed'].includes(processingStatus)) {
      const details = status.processing_phase?.errors ?? status.error_description ?? status;
      throw new MetaApiError(`A Meta rejeitou o vídeo: ${JSON.stringify(details)}`);
    }
    // processing_phase=complete sozinho não basta: o SDK oficial só libera o
    // vídeo para o criativo quando video_status vira "ready".
    if (videoStatus === 'ready') return;

    onTick?.();
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new MetaApiError('A Meta não terminou de processar o vídeo em 10 minutos. Tente novamente.');
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

  if (error || !data) {
    return { connected: false, name: null, status: null, message: null };
  }
  return {
    connected: data.status === 'CONNECTED',
    name: data.meta_user_name ?? null,
    status: data.status,
    message: data.last_error ?? null,
  };
}
