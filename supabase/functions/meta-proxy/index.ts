// Edge Function: meta-proxy
//
// Único caminho pelo qual o CRM fala com a Graph API para publicar anúncios.
// Existe para tirar o access token do navegador: o browser manda a operação
// desejada com o JWT do usuário, e o token da Meta só é lido aqui, no servidor,
// a partir da conexão OAuth da organização.
//
// Autorização em três camadas:
//   1. JWT válido do usuário.
//   2. Perfil ADMIN (ou com a ferramenta 'meta-ads' liberada) na organização.
//   3. A conexão OAuth precisa estar CONNECTED para aquela organização.
//
// Toda chamada à Meta é assinada com appsecret_proof, como a Meta recomenda
// para apps com "Require App Secret" ativo.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GRAPH_VERSION = 'v24.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ── Whitelist ───────────────────────────────────────────────────────────────
// Um proxy sem lista fechada é um proxy aberto para a conta de anúncios do
// cliente. Só os caminhos que a ferramenta realmente usa passam daqui.
const READ_PATHS: RegExp[] = [
  /^me$/,
  /^me\/(adaccounts|accounts|businesses)$/,
  /^act_\d+$/,
  /^act_\d+\/(campaigns|adsets|ads|adspixels|advertisers|customconversions)$/,
  /^\d+$/, // nó individual (campanha, conjunto, vídeo) consultado por id
  /^\d+\/(adsets|ads|advertisers|leadgen_forms|thumbnails)$/,
  /^act_\d+\/insights$/,
  /^\d+\/insights$/,
];

const WRITE_PATHS: RegExp[] = [
  /^act_\d+\/(campaigns|adsets|adcreatives|ads)$/,
];

const allowed = (path: string, list: RegExp[]) => list.some((rule) => rule.test(path));

// ── Edição de objetos que já existem ────────────────────────────────────────
// O editor em massa liga e pausa, renomeia e muda orçamento de campanhas,
// conjuntos e anúncios. Só esses campos passam: excluir, segmentação, lance e
// cobrança continuam fora do alcance do navegador.
const NODE_PATH = /^\d+$/;
const UPDATE_STATUS = new Set(['ACTIVE', 'PAUSED']);

function updateParamsError(params: Record<string, unknown>): string | null {
  const entries = Object.entries(params).filter(([key]) => key !== 'access_token' && key !== 'appsecret_proof');
  if (entries.length === 0) return 'nada para alterar';
  for (const [key, raw] of entries) {
    const value = String(raw ?? '');
    if (key === 'status') {
      if (!UPDATE_STATUS.has(value)) return `status ${value} não liberado`;
    } else if (key === 'name') {
      if (!value.trim() || value.length > 400) return 'nome inválido';
    } else if (key === 'daily_budget' || key === 'lifetime_budget') {
      if (!/^\d{1,12}$/.test(value)) return `${key} inválido`;
    } else {
      return `campo ${key} não liberado`;
    }
  }
  return null;
}

function normalizePath(raw: unknown) {
  const path = String(raw ?? '').replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('..') || path.includes('?') || /\s/.test(path)) return null;
  return path;
}

async function appsecretProof(token: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Cache da autorização ──────────────────────────────────────────────────────
// Um vídeo sobe em dezenas de partes de 5 MB, e cada parte é uma chamada. Refazer
// login, perfil, permissão, conexão e leitura da credencial em todas custava
// ~0,7 s por parte. A instância da função fica viva entre chamadas seguidas, então
// guarda o resultado por 60 s (nunca além da validade do JWT do usuário).
type AuthContext = { userId: string; connectionId: string; token: string; proof: string | null };
const AUTH_CACHE_MS = 60_000;
const authCache = new Map<string, { expiresAt: number; context: AuthContext }>();

function jwtExpiresAt(authHeader: string) {
  try {
    const part = authHeader.replace(/^Bearer\s+/i, '').split('.')[1] ?? '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

function forgetConnection(connectionId: string) {
  for (const [key, entry] of authCache) if (entry.context.connectionId === connectionId) authCache.delete(key);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const appSecret = Deno.env.get('META_APP_SECRET');

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);

  // JSON para tudo, exceto as partes do vídeo, que chegam como multipart
  // (bytes crus, sem o inchaço de 33% do base64).
  let body: Record<string, unknown>;
  let videoChunk: Blob | null = null;
  try {
    if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await request.formData();
      body = {};
      for (const [key, value] of form.entries()) {
        if (key === 'chunk' && value instanceof Blob) videoChunk = value;
        else body[key] = value;
      }
    } else {
      body = await request.json();
    }
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const now = Date.now();
  let cached = authCache.get(authHeader);
  if (cached && cached.expiresAt <= now) {
    authCache.delete(authHeader);
    cached = undefined;
  }

  let context: AuthContext;
  if (cached) {
    context = cached.context;
  } else {
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await caller.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { data: profile } = await caller
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.organization_id) return json({ error: 'forbidden' }, 403);

    // Não-admin precisa da ferramenta liberada explicitamente (migration 0039).
    if (profile.role !== 'ADMIN') {
      const { data: permission } = await caller
        .from('agency_tool_permissions')
        .select('tool_key')
        .eq('user_id', user.id)
        .eq('tool_key', 'meta_ads')
        .maybeSingle();
      if (!permission) return json({ error: 'forbidden' }, 403);
    }

    const { data: connection } = await admin
      .from('meta_oauth_connections')
      .select('id, status, expires_at')
      .eq('organization_id', profile.organization_id)
      .maybeSingle();
    if (!connection || connection.status !== 'CONNECTED') {
      return json({ error: 'meta_not_connected', message: 'Conecte a agência à Meta em Configurações › APIs.' }, 409);
    }
    if (connection.expires_at && new Date(connection.expires_at).getTime() < now) {
      await admin.from('meta_oauth_connections')
        .update({ status: 'ERROR', last_error: 'Credencial expirada. Reconecte a agência à Meta.' })
        .eq('id', connection.id);
      return json({ error: 'meta_token_expired', message: 'A credencial da Meta expirou. Reconecte em Configurações › APIs.' }, 409);
    }

    const { data: storedToken } = await admin.rpc('meta_oauth_secret_get', { p_connection_id: connection.id });
    const storedTokenValue = (storedToken ?? undefined) as string | undefined;
    if (!storedTokenValue) return json({ error: 'meta_not_connected', message: 'Credencial da Meta ausente. Reconecte a agência.' }, 409);

    context = {
      userId: user.id,
      connectionId: connection.id,
      token: storedTokenValue,
      proof: appSecret ? await appsecretProof(storedTokenValue, appSecret) : null,
    };
    const connectionExpiry = connection.expires_at ? new Date(connection.expires_at).getTime() : Infinity;
    const expiresAt = Math.min(now + AUTH_CACHE_MS, jwtExpiresAt(authHeader) || now, connectionExpiry);
    if (expiresAt > now) {
      if (authCache.size > 500) authCache.clear();
      authCache.set(authHeader, { expiresAt, context });
    }
  }

  const user = { id: context.userId };
  const connection = { id: context.connectionId };
  const { token, proof } = context;
  const auth = () => {
    const params = new URLSearchParams({ access_token: token });
    if (proof) params.set('appsecret_proof', proof);
    return params;
  };

  // Erro de credencial invalidada pela Meta (190) marca a conexão para que o
  // administrador saiba que precisa reconectar, em vez de o operador ver falhas
  // soltas em cada publicação.
  const noteAuthFailure = async (payload: { error?: { code?: number; message?: string } }) => {
    if (payload?.error?.code === 190) {
      forgetConnection(connection.id);
      await admin.from('meta_oauth_connections')
        .update({ status: 'ERROR', last_error: payload.error.message ?? 'Credencial revogada pela Meta.' })
        .eq('id', connection.id);
    }
    return payload;
  };

  const op = String(body.op ?? '');

  try {
    // ── Leitura ─────────────────────────────────────────────────────────────
    if (op === 'get') {
      const path = normalizePath(body.path);
      if (!path || !allowed(path, READ_PATHS)) return json({ error: 'path_not_allowed', path: body.path }, 403);
      const params = auth();
      for (const [key, value] of Object.entries((body.params ?? {}) as Record<string, unknown>)) {
        if (key === 'access_token' || key === 'appsecret_proof') continue;
        params.set(key, String(value));
      }
      const response = await fetch(`${GRAPH}/${path}?${params}`);
      return json(await noteAuthFailure(await response.json()), response.ok ? 200 : 200);
    }

    // ── Status de vários vídeos de uma vez ──────────────────────────────────────
    // O criador espera dezenas de vídeos processarem; uma consulta por ciclo em
    // vez de uma por vídeo mantém a conta longe do limite de requisições.
    if (op === 'video_status') {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (ids.length === 0 || ids.length > 50 || ids.some((id) => !/^\d+$/.test(id))) {
        return json({ error: 'invalid_ids' }, 400);
      }
      const params = auth();
      params.set('ids', ids.join(','));
      params.set('fields', 'status');
      const response = await fetch(`${GRAPH}/?${params}`);
      return json(await noteAuthFailure(await response.json()));
    }

    // ── Paginação ───────────────────────────────────────────────────────────
    // O `paging.next` da Meta traz o token embutido; devolvê-lo ao browser
    // vazaria a credencial. O cursor volta sozinho e é reidratado aqui.
    if (op === 'get_page') {
      const path = normalizePath(body.path);
      if (!path || !allowed(path, READ_PATHS)) return json({ error: 'path_not_allowed', path: body.path }, 403);
      const params = auth();
      for (const [key, value] of Object.entries((body.params ?? {}) as Record<string, unknown>)) {
        if (key === 'access_token' || key === 'appsecret_proof') continue;
        params.set(key, String(value));
      }
      if (body.after) params.set('after', String(body.after));
      const response = await fetch(`${GRAPH}/${path}?${params}`);
      const payload = await noteAuthFailure(await response.json());
      return json({
        data: payload.data ?? [],
        error: payload.error ?? null,
        after: payload.paging?.cursors?.after && payload.paging?.next ? payload.paging.cursors.after : null,
      });
    }

    // ── Criação ─────────────────────────────────────────────────────────────
    if (op === 'post') {
      const path = normalizePath(body.path);
      if (!path || !allowed(path, WRITE_PATHS)) return json({ error: 'path_not_allowed', path: body.path }, 403);
      const params = auth();
      for (const [key, value] of Object.entries((body.params ?? {}) as Record<string, unknown>)) {
        if (key === 'access_token' || key === 'appsecret_proof') continue;
        params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
      const response = await fetch(`${GRAPH}/${path}`, { method: 'POST', body: params });
      return json(await noteAuthFailure(await response.json()));
    }

    // ── Edição de um objeto existente ───────────────────────────────────────
    if (op === 'update') {
      const path = normalizePath(body.path);
      if (!path || !NODE_PATH.test(path)) return json({ error: 'path_not_allowed', path: body.path }, 403);
      const fields = (body.params ?? {}) as Record<string, unknown>;
      const problem = updateParamsError(fields);
      if (problem) return json({ error: 'update_not_allowed', message: problem }, 403);
      const params = auth();
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'access_token' || key === 'appsecret_proof') continue;
        params.set(key, String(value));
      }
      const response = await fetch(`${GRAPH}/${path}`, { method: 'POST', body: params });
      return json(await noteAuthFailure(await response.json()));
    }

    // ── Batch ───────────────────────────────────────────────────────────────
    // Itens de criação vão para as coleções da conta; itens de edição vão para
    // o id do objeto e só com os campos liberados acima.
    if (op === 'batch') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0 || items.length > 50) return json({ error: 'invalid_batch' }, 400);
      for (const item of items as Array<{ method?: string; relative_url?: string; body?: string }>) {
        const path = normalizePath(String(item.relative_url ?? '').split('?')[0]);
        if (path && NODE_PATH.test(path) && item.method === 'POST') {
          const problem = updateParamsError(Object.fromEntries(new URLSearchParams(String(item.body ?? ''))));
          if (problem) return json({ error: 'update_not_allowed', message: problem, path: item.relative_url }, 403);
          continue;
        }
        if (!path || !allowed(path, WRITE_PATHS)) return json({ error: 'path_not_allowed', path: item.relative_url }, 403);
      }
      const params = auth();
      params.set('batch', JSON.stringify(items));
      const response = await fetch(`${GRAPH}/`, { method: 'POST', body: params });
      return json({ batch: await response.json() });
    }

    // ── Upload de imagem ────────────────────────────────────────────────────
    // A Meta aceita os bytes em base64 no campo `bytes`. Imagem de anúncio é
    // pequena o bastante para trafegar assim, sem passar pelo storage.
    if (op === 'upload_image') {
      const account = String(body.adAccountId ?? '');
      if (!/^act_\d+$/.test(account)) return json({ error: 'invalid_ad_account' }, 400);
      const bytes = String(body.bytes ?? '');
      if (!bytes || bytes.length > 14_000_000) return json({ error: 'invalid_image' }, 400);
      // Com nome de arquivo, a imagem aparece na biblioteca da Meta com esse
      // nome; mandando só `bytes`, todas ficam listadas como "bytes".
      const fileName = String(body.fileName ?? '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100);
      if (fileName) {
        const binary = Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0));
        const form = new FormData();
        for (const [key, value] of auth().entries()) form.set(key, value);
        form.set('filename', new Blob([binary]), fileName);
        const response = await fetch(`${GRAPH}/${account}/adimages`, { method: 'POST', body: form });
        return json(await noteAuthFailure(await response.json()));
      }
      const params = auth();
      params.set('bytes', bytes);
      const response = await fetch(`${GRAPH}/${account}/adimages`, { method: 'POST', body: params });
      return json(await noteAuthFailure(await response.json()));
    }

    // ── Upload de vídeo ─────────────────────────────────────────────────────
    // O arquivo já está no bucket privado. Emitimos uma URL assinada curta e a
    // Meta baixa de lá — o vídeo não passa por esta função, então não há limite
    // de payload nem upload em partes para manter.
    if (op === 'upload_video') {
      const account = String(body.adAccountId ?? '');
      if (!/^act_\d+$/.test(account)) return json({ error: 'invalid_ad_account' }, 400);
      const storagePath = String(body.storagePath ?? '');
      if (!storagePath.startsWith(`${user.id}/`)) return json({ error: 'invalid_storage_path' }, 403);

      const { data: signed, error: signedError } = await admin.storage
        .from('meta-ad-media')
        .createSignedUrl(storagePath, 3600);
      if (signedError || !signed?.signedUrl) return json({ error: 'signed_url_failed', message: signedError?.message }, 400);

      const params = auth();
      params.set('file_url', signed.signedUrl);
      if (body.name) params.set('name', String(body.name));
      const response = await fetch(`${GRAPH}/${account}/advideos`, { method: 'POST', body: params });
      return json(await noteAuthFailure(await response.json()));
    }

    // ── Upload de vídeo em partes (resumable) ───────────────────────────────
    // O navegador manda o arquivo pedaço a pedaço e a função repassa cada
    // pedaço à Meta. Não usa o Storage: no plano gratuito do Supabase todo
    // objeto acima de 50 MB é recusado, o que barrava vídeo grande.
    // Fases: video_start → video_chunk (repetido) → video_finish.
    if (op === 'video_start' || op === 'video_chunk' || op === 'video_finish') {
      const account = String(body.adAccountId ?? '');
      if (!/^act_\d+$/.test(account)) return json({ error: 'invalid_ad_account' }, 400);
      const form = new FormData();
      for (const [key, value] of auth().entries()) form.set(key, value);

      if (op === 'video_start') {
        const fileSize = Number(body.fileSize);
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 4 * 1024 ** 3) {
          return json({ error: 'invalid_file_size' }, 400);
        }
        form.set('upload_phase', 'start');
        form.set('file_size', String(Math.trunc(fileSize)));
      } else if (op === 'video_chunk') {
        if (!videoChunk) return json({ error: 'missing_chunk' }, 400);
        form.set('upload_phase', 'transfer');
        form.set('upload_session_id', String(body.uploadSessionId ?? ''));
        form.set('start_offset', String(body.startOffset ?? ''));
        form.set('video_file_chunk', videoChunk, String(body.fileName ?? 'video.mp4'));
      } else {
        form.set('upload_phase', 'finish');
        form.set('upload_session_id', String(body.uploadSessionId ?? ''));
        if (body.title) form.set('title', String(body.title).slice(0, 255));
      }

      const response = await fetch(`https://graph-video.facebook.com/${GRAPH_VERSION}/${account}/advideos`, {
        method: 'POST',
        body: form,
      });
      return json(await noteAuthFailure(await response.json()));
    }

    // ── Limpeza da mídia temporária ─────────────────────────────────────────
    if (op === 'discard_upload') {
      const storagePath = String(body.storagePath ?? '');
      if (!storagePath.startsWith(`${user.id}/`)) return json({ error: 'invalid_storage_path' }, 403);
      await admin.storage.from('meta-ad-media').remove([storagePath]);
      return json({ ok: true });
    }

    // ── Diagnóstico da credencial ───────────────────────────────────────────
    // debug_token devolve validade e escopos concedidos de verdade, que ficam
    // gravados na conexão para auditoria.
    if (op === 'inspect') {
      if (!appSecret) return json({ error: 'app_secret_missing' }, 503);
      const appId = Deno.env.get('META_APP_ID');
      const response = await fetch(
        `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
      );
      const payload = await response.json();
      const info = payload.data ?? {};
      const scopes: string[] = info.scopes ?? [];
      const expiresAt = info.expires_at ? new Date(info.expires_at * 1000).toISOString() : null;
      await admin.from('meta_oauth_connections').update({
        scopes,
        expires_at: expiresAt,
        status: info.is_valid ? 'CONNECTED' : 'REVOKED',
        last_error: info.is_valid ? null : 'Credencial inválida segundo a Meta. Reconecte a agência.',
      }).eq('id', connection.id);
      forgetConnection(connection.id);
      return json({ valid: !!info.is_valid, scopes, expires_at: expiresAt });
    }

    return json({ error: 'invalid_op', op }, 400);
  } catch (caught) {
    return json({ error: 'proxy_failure', message: caught instanceof Error ? caught.message : String(caught) }, 500);
  }
});
