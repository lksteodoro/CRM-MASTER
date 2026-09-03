// Edge Function: meta-deauthorize
//
// Os dois retornos que a Meta exige de qualquer app que acesse dados de
// usuário, e que faltavam:
//
//   POST /            → Deauthorize Callback. A Meta avisa quando alguém remove
//                       o app. A conexão é marcada como revogada e a credencial
//                       apagada na hora.
//   POST /delete      → Data Deletion Request. Mesmo efeito, mas devolve o
//                       comprovante (url + confirmation_code) que a Meta valida.
//   GET  /status?code → Página de acompanhamento apontada pela url acima.
//
// O corpo chega como `signed_request` assinado com o App Secret; sem conferir a
// assinatura, qualquer um poderia derrubar a conexão da agência.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Valida a assinatura HMAC-SHA256 do signed_request e devolve o payload. */
async function parseSignedRequest(signedRequest: string, appSecret: string) {
  const [encodedSignature, encodedPayload] = signedRequest.split('.');
  if (!encodedSignature || !encodedPayload) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlDecode(encodedSignature),
    new TextEncoder().encode(encodedPayload),
  );
  if (!valid) return null;

  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const appSecret = Deno.env.get('META_APP_SECRET');
  const url = new URL(request.url);
  const functionBase = `${supabaseUrl}/functions/v1/meta-deauthorize`;

  // Página de acompanhamento da exclusão, exigida pela Meta junto do código.
  if (request.method === 'GET' && url.pathname.endsWith('/status')) {
    const code = url.searchParams.get('code') ?? '';
    return new Response(
      `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Exclusão de dados</title><body style="font-family:Arial,sans-serif;background:#0b0d12;color:#fff;display:grid;min-height:100vh;place-items:center;margin:0"><main style="max-width:520px;padding:32px"><h1 style="font-size:22px">Solicitação concluída</h1><p style="color:#aeb6c5;line-height:1.6">A conexão com a Meta foi removida e a credencial de acesso apagada dos nossos servidores. Os dados de campanha permanecem na sua conta de anúncios, dentro da Meta.</p><p style="color:#6b7280;font-size:13px">Código da solicitação: <strong style="color:#aeb6c5">${code.replace(/[^a-zA-Z0-9-]/g, '')}</strong></p></main></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!appSecret) return json({ error: 'app_secret_missing' }, 503);

  const form = await request.formData().catch(() => null);
  const signedRequest = form?.get('signed_request');
  if (typeof signedRequest !== 'string') return json({ error: 'missing_signed_request' }, 400);

  const payload = await parseSignedRequest(signedRequest, appSecret);
  if (!payload?.user_id) return json({ error: 'invalid_signature' }, 401);

  const admin = createClient(supabaseUrl, serviceKey);

  // Apaga a credencial e marca a conexão. A linha da conexão fica para que o
  // administrador veja o que aconteceu em vez de a integração sumir sem
  // explicação.
  const { data: connections } = await admin
    .from('meta_oauth_connections')
    .select('id')
    .eq('meta_user_id', String(payload.user_id));

  for (const connection of connections ?? []) {
    await admin.rpc('meta_oauth_secret_set', { p_connection_id: connection.id, p_access_token: '' });
    await admin
      .from('meta_oauth_connections')
      .update({ status: 'REVOKED', last_error: 'Acesso removido pelo usuário na Meta. Reconecte para voltar a publicar.' })
      .eq('id', connection.id);
  }

  const confirmationCode = crypto.randomUUID();
  return json({ url: `${functionBase}/status?code=${confirmationCode}`, confirmation_code: confirmationCode });
});
