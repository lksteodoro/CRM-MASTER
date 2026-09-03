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
      scopes: grantedScopes, status: 'CONNECTED', expires_at: expiresAt, last_error: null, credential_source: 'OAUTH',
      connected_by: pending.user_id, connected_at: new Date().toISOString(), verified_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' }).select('id').single();
    if (connectionError || !connection) return fail(connectionError?.message ?? 'Não foi possível salvar a conexão.');
    const { error: secretError } = await admin.rpc('meta_oauth_secret_set', { p_connection_id: connection.id, p_access_token: accessToken });
    if (secretError) return fail('A conexão foi criada, mas não foi possível guardar a credencial.');
    return Response.redirect(`${appUrl}/agency/configuracoes?aba=apis&meta_oauth=connected`, 302);
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing_authorization' }, 401);
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await caller.auth.getUser();
  const user = userData.user;
  const { data: profile } = user ? await caller.from('profiles').select('organization_id, role').eq('id', user.id).maybeSingle() : { data: null };
  if (!user || profile?.role !== 'ADMIN' || !profile.organization_id) return json({ error: 'forbidden' }, 403);

  const admin = createClient(supabaseUrl, serviceKey);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? 'start');

  // ── Token de usuário de sistema ───────────────────────────────────────────
  // Alternativa ao login do Facebook para quem prefere uma credencial fixa da
  // Business Manager. O token chega uma única vez, é validado contra a Meta e
  // vai direto para o cofre no servidor — nunca é devolvido ao navegador.
  if (action === 'save_token') {
    const submitted = String(body.token ?? '').trim();
    if (!submitted) return json({ error: 'Informe o token de acesso.' }, 400);

    // ── Validação em cascata ────────────────────────────────────────────────
    // A ferramenta funciona só com o token, sem exigir App ID e App Secret
    // cadastrados. Mas quanto menos o servidor sabe sobre o app, menos consegue
    // provar sobre a origem da credencial — então tentamos, em ordem, do
    // caminho que verifica mais para o que verifica menos, e devolvemos qual
    // nível foi alcançado.
    const debugWith = async (accessToken: string) => {
      const payload = await fetch(
        `https://graph.facebook.com/v24.0/debug_token?input_token=${encodeURIComponent(submitted)}&access_token=${encodeURIComponent(accessToken)}`,
      ).then((response) => response.json()).catch(() => null);
      if (!payload || payload.error || !payload.data) return null;
      return payload.data as { app_id?: string; is_valid?: boolean; scopes?: string[]; expires_at?: number; user_id?: string };
    };

    let info: Awaited<ReturnType<typeof debugWith>> = null;
    let verified: 'app_secret' | 'self' | 'permissions' = 'permissions';

    // 1. App token: o único jeito de conferir a origem com autoridade.
    if (appId && appSecret) {
      info = await debugWith(`${appId}|${appSecret}`);
      if (info) verified = 'app_secret';
    }
    // 2. O próprio token se inspecionando. Funciona para usuário de sistema com
    //    papel no app e ainda revela o app_id de origem.
    if (!info) {
      info = await debugWith(submitted);
      if (info) verified = 'self';
    }

    let grantedScopes: string[] = [];

    if (info) {
      if (info.is_valid === false) {
        return json({ error: 'Este token está expirado ou foi revogado na Meta.' }, 400);
      }
      grantedScopes = info.scopes ?? [];
      // A checagem que separa uma credencial legítima de uma violação: o token
      // precisa ter sido emitido para ESTE aplicativo. Um token do Graph API
      // Explorer, ou de qualquer outro app, pertence ao app que o emitiu —
      // usá-lo aqui seria uso de credencial de terceiro, proibido pelas
      // Platform Terms. Só dá para comparar se soubermos qual é o nosso app.
      if (appId && String(info.app_id) !== String(appId)) {
        return json({
          error: 'Este token foi emitido para outro aplicativo da Meta e não pode ser usado aqui. Gere um token de usuário de sistema na sua Business Manager selecionando o aplicativo desta agência (Configurações do Negócio › Usuários do sistema › Gerar novo token).',
        }, 400);
      }
    } else {
      // 3. Sem debug_token, ainda dá para saber se o token funciona e o que ele
      //    pode fazer — mas não de onde veio.
      const permissions = await fetch(
        `https://graph.facebook.com/v24.0/me/permissions?access_token=${encodeURIComponent(submitted)}`,
      ).then((response) => response.json()).catch(() => null);
      if (!permissions || permissions.error) {
        return json({ error: permissions?.error?.message ?? 'A Meta não reconheceu este token.' }, 400);
      }
      grantedScopes = (permissions.data ?? [])
        .filter((row: { status?: string }) => row.status === 'granted')
        .map((row: { permission: string }) => row.permission);
      verified = 'permissions';
    }

    if (!grantedScopes.includes('ads_management')) {
      return json({
        error: `Este token não tem a permissão ads_management, necessária para publicar anúncios. Permissões encontradas: ${grantedScopes.join(', ') || 'nenhuma'}.`,
      }, 400);
    }

    const profileData = await fetch(
      `https://graph.facebook.com/v24.0/me?fields=id,name&access_token=${encodeURIComponent(submitted)}`,
    ).then((response) => response.json()).catch(() => ({}));
    if (profileData?.error) {
      return json({ error: profileData.error.message ?? 'A Meta recusou este token.' }, 400);
    }

    // Token de usuário de sistema costuma não expirar: expires_at 0 ou ausente.
    const expiresAt = info?.expires_at ? new Date(Number(info.expires_at) * 1000).toISOString() : null;
    // Quando não foi possível conferir de qual aplicativo o token veio, isso
    // fica registrado na conexão — o administrador precisa saber que essa
    // verificação não aconteceu, e não descobrir só numa auditoria.
    const originNote = verified === 'permissions'
      ? 'Token aceito sem verificação de origem: cadastre META_APP_ID e META_APP_SECRET para que o sistema confirme que a credencial pertence ao aplicativo desta agência.'
      : null;

    const { data: connection, error: connectionError } = await admin.from('meta_oauth_connections').upsert({
      organization_id: profile.organization_id,
      meta_user_id: profileData.id ?? (info?.user_id ? String(info.user_id) : null),
      meta_user_name: profileData.name ?? 'Usuário de sistema',
      scopes: grantedScopes,
      status: 'CONNECTED',
      expires_at: expiresAt,
      last_error: originNote,
      credential_source: 'SYSTEM_USER',
      connected_by: user.id,
      connected_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' }).select('id').single();
    if (connectionError || !connection) return json({ error: connectionError?.message ?? 'Não foi possível salvar a conexão.' }, 400);

    const { error: secretError } = await admin.rpc('meta_oauth_secret_set', { p_connection_id: connection.id, p_access_token: submitted });
    if (secretError) return json({ error: 'A conexão foi criada, mas não foi possível guardar a credencial.' }, 400);

    return json({
      ok: true,
      name: profileData.name ?? 'Usuário de sistema',
      scopes: grantedScopes,
      expires_at: expiresAt,
      verified,
      app_id: info?.app_id ?? null,
    });
  }

  // ── Desconectar ───────────────────────────────────────────────────────────
  if (action === 'disconnect') {
    const { data: connection } = await admin
      .from('meta_oauth_connections')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .maybeSingle();
    if (connection) {
      await admin.rpc('meta_oauth_secret_set', { p_connection_id: connection.id, p_access_token: '' });
      await admin.from('meta_oauth_connections')
        .update({ status: 'REVOKED', last_error: 'Conexão removida por um administrador.' })
        .eq('id', connection.id);
    }
    return json({ ok: true });
  }

  // Só o login do Facebook depende do aplicativo estar cadastrado no servidor.
  // Conectar por token de usuário de sistema funciona sem isso.
  if (!appId || !appSecret) {
    return json({
      error: 'O login da Meta exige META_APP_ID e META_APP_SECRET nos segredos da função. Enquanto isso, conecte pela aba "Token geral" com um token de usuário de sistema.',
    }, 503);
  }

  const state = crypto.randomUUID();
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
