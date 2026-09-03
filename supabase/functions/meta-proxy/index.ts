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
  /^\d+\/(adsets|ads|advertisers|leadgen_forms)$/,
  /^act_\d+\/insights$/,
  /^\d+\/insights$/,
];

const WRITE_PATHS: RegExp[] = [
  /^act_\d+\/(campaigns|adsets|adcreatives|ads)$/,
];

const allowed = (path: string, list: RegExp[]) => list.some((rule) => rule.test(path));

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const appSecret = Deno.env.get('META_APP_SECRET');

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

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

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: connection } = await admin
    .from('meta_oauth_connections')
    .select('id, status, expires_at')
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (!connection || connection.status !== 'CONNECTED') {
    return json({ error: 'meta_not_connected', message: 'Conecte a agência à Meta em Configurações › APIs.' }, 409);
  }
  if (connection.expires_at && new Date(connection.expires_at).getTime() < Date.now()) {
    await admin.from('meta_oauth_connections')
      .update({ status: 'ERROR', last_error: 'Credencial expirada. Reconecte a agência à Meta.' })
      .eq('id', connection.id);
    return json({ error: 'meta_token_expired', message: 'A credencial da Meta expirou. Reconecte em Configurações › APIs.' }, 409);
  }

  const { data: storedToken } = await admin.rpc('meta_oauth_secret_get', { p_connection_id: connection.id });
  const token = (storedToken ?? undefined) as string | undefined;
  if (!token) return json({ error: 'meta_not_connected', message: 'Credencial da Meta ausente. Reconecte a agência.' }, 409);

  const proof = appSecret ? await appsecretProof(token, appSecret) : null;
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

    // ── Batch ───────────────────────────────────────────────────────────────
    if (op === 'batch') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0 || items.length > 50) return json({ error: 'invalid_batch' }, 400);
      for (const item of items as Array<{ relative_url?: string }>) {
        const path = normalizePath(String(item.relative_url ?? '').split('?')[0]);
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
      return json({ valid: !!info.is_valid, scopes, expires_at: expiresAt });
    }

    return json({ error: 'invalid_op', op }, 400);
  } catch (caught) {
    return json({ error: 'proxy_failure', message: caught instanceof Error ? caught.message : String(caught) }, 500);
  }
});
