import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const appId = Deno.env.get('META_APP_ID');
  const appSecret = Deno.env.get('META_APP_SECRET');
  const redirectUri = Deno.env.get('META_OAUTH_REDIRECT_URI') ?? `${supabaseUrl}/functions/v1/meta-oauth/callback`;
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173';

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  // Retorno público da Meta. O state é de uso único, expira em 10 minutos e
  // associa o código ao administrador que iniciou a conexão.
  if (request.method === 'GET' && url.pathname.endsWith('/callback')) {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const metaError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
    const fail = (message: string) => Response.redirect(`${appUrl}/agency/configuracoes?aba=apis&meta_oauth=error&message=${encodeURIComponent(message)}`, 302);
    if (!state || !code || metaError || !appId || !appSecret) return fail(metaError ?? 'Configuração OAuth inválida.');

    const admin = createClient(supabaseUrl, serviceKey);
    // Consome o state (lê e apaga na mesma transação) — um callback repetido
    // não encontra mais a linha e não vira uma segunda conexão.
    const { data: states } = await admin.rpc('meta_oauth_state_consume', { p_state: state });
    const pending = Array.isArray(states) ? states[0] : states;
    if (!pending || new Date(pending.expires_at).getTime() < Date.now()) return fail('A solicitação expirou. Tente conectar novamente.');

    const tokenUrl = new URL('https://graph.facebook.com/v24.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);
    const tokenResponse = await fetch(tokenUrl);
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return fail(tokenData.error?.message ?? 'A Meta não retornou uma credencial válida.');

    // O código devolve um token de curta duração (~1-2 h). Sem a troca abaixo a
    // conexão morreria no mesmo dia e o operador veria falhas aleatórias no
    // meio de uma publicação.
    const exchangeUrl = new URL('https://graph.facebook.com/v24.0/oauth/access_token');
    exchangeUrl.searchParams.set('grant_type', 'fb_exchange_token');
    exchangeUrl.searchParams.set('client_id', appId);
    exchangeUrl.searchParams.set('client_secret', appSecret);
    exchangeUrl.searchParams.set('fb_exchange_token', tokenData.access_token);
    const exchangeData = await fetch(exchangeUrl).then((response) => response.json()).catch(() => ({}));
    const accessToken: string = exchangeData.access_token ?? tokenData.access_token;
    const expiresIn = exchangeData.access_token ? exchangeData.expires_in : tokenData.expires_in;

    const profileResponse = await fetch(`https://graph.facebook.com/v24.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
    const profileData = await profileResponse.json().catch(() => ({}));

    // Escopos concedidos de verdade, direto da Meta. Guardar isso é o que
    // permite auditar depois o que o anunciante autorizou e detectar uma
    // permissão revogada antes de uma publicação falhar.
    const debugData = await fetch(
      `https://graph.facebook.com/v24.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    ).then((response) => response.json()).catch(() => ({}));
    const grantedScopes: string[] = debugData?.data?.scopes ?? [];
    const expiresAt = debugData?.data?.expires_at
      ? new Date(Number(debugData.data.expires_at) * 1000).toISOString()
      : expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null;

    const { data: connection, error: connectionError } = await admin.from('meta_oauth_connections').upsert({
      organization_id: pending.organization_id, meta_user_id: profileData.id ?? null, meta_user_name: profileData.name ?? null,
      scopes: grantedScopes, status: 'CONNECTED', expires_at: expiresAt, last_error: null, connected_by: pending.user_id, connected_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' }).select('id').single();
    if (connectionError || !connection) return fail(connectionError?.message ?? 'Não foi possível salvar a conexão.');
    const { error: secretError } = await admin.rpc('meta_oauth_secret_set', { p_connection_id: connection.id, p_access_token: accessToken });
    if (secretError) return fail('A conexão foi criada, mas não foi possível guardar a credencial.');
    return Response.redirect(`${appUrl}/agency/configuracoes?aba=apis&meta_oauth=connected`, 302);
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!appId || !appSecret) return json({ error: 'Meta OAuth não configurado no servidor.' }, 503);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await caller.auth.getUser();
  const user = userData.user;
  const { data: profile } = user ? await caller.from('profiles').select('organization_id, role').eq('id', user.id).maybeSingle() : { data: null };
  if (!user || profile?.role !== 'ADMIN' || !profile.organization_id) return json({ error: 'forbidden' }, 403);
  const state = crypto.randomUUID();
  const admin = createClient(supabaseUrl, serviceKey);
  const { error } = await admin.rpc('meta_oauth_state_create', {
    p_state: state,
    p_organization_id: profile.organization_id,
    p_user_id: user.id,
    p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) return json({ error: error.message }, 400);
  const authUrl = new URL('https://www.facebook.com/v24.0/dialog/oauth');
  authUrl.searchParams.set('client_id', appId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'ads_read,ads_management,business_management,pages_show_list,pages_read_engagement');
  return json({ url: authUrl.toString() });
});
