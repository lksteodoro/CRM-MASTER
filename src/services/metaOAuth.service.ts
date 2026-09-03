import { supabase } from '../integrations/supabase/client';

export type MetaOAuthConnection = {
  id: string;
  meta_user_name: string | null;
  status: 'CONNECTED' | 'ERROR' | 'REVOKED';
  connected_at: string;
  expires_at: string | null;
  last_error: string | null;
  credential_source: 'OAUTH' | 'SYSTEM_USER';
  scopes: string[] | null;
  verified_at: string | null;
};

export async function getMetaOAuthConnection(): Promise<MetaOAuthConnection | null> {
  const db = supabase as any;
  const { data, error } = await db
    .from('meta_oauth_connections')
    .select('id, meta_user_name, status, connected_at, expires_at, last_error, credential_source, scopes, verified_at')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function startMetaOAuth(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>('meta-oauth', { body: { action: 'start' } });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error ?? 'Não foi possível iniciar a conexão com a Meta.');
  return data.url;
}

export type SavedSystemUserToken = {
  name: string;
  scopes: string[];
  expires_at: string | null;
  /**
   * Quanto o servidor conseguiu confirmar sobre a credencial:
   * `app_secret` — conferido com o app token, prova que o token é deste app;
   * `self`       — o próprio token se inspecionou e revelou o app de origem;
   * `permissions`— só deu para ver que funciona e quais permissões tem.
   */
  verified: 'app_secret' | 'self' | 'permissions';
  app_id: string | null;
};

/**
 * Grava um token de usuário de sistema como credencial da agência.
 *
 * O token trafega uma única vez até a Edge Function, que o valida contra a Meta
 * e o guarda no cofre do servidor. Ele nunca volta para o navegador nem é
 * gravado localmente — é o que mantém essa opção dentro das Platform Terms.
 *
 * A função recusa o token se ele tiver sido emitido para outro aplicativo (caso
 * clássico: token gerado no Graph API Explorer) ou se faltar `ads_management`.
 */
export async function saveMetaSystemUserToken(token: string): Promise<SavedSystemUserToken> {
  const { data, error } = await supabase.functions.invoke<any>('meta-oauth', {
    body: { action: 'save_token', token },
  });

  if (error) {
    // A mensagem útil (token de outro app, permissão faltando) vem no corpo da
    // resposta; sem isso o operador só veria "non-2xx status code".
    let detail: any = null;
    try {
      detail = await (error as any).context?.json?.();
    } catch {
      detail = null;
    }
    throw new Error(detail?.error ?? error.message ?? 'Não foi possível salvar o token.');
  }
  if (data?.error) throw new Error(data.error);

  return {
    name: data?.name ?? 'Usuário de sistema',
    scopes: data?.scopes ?? [],
    expires_at: data?.expires_at ?? null,
    verified: data?.verified ?? 'permissions',
    app_id: data?.app_id ?? null,
  };
}

/** Remove a credencial da agência e marca a conexão como revogada. */
export async function disconnectMeta(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<any>('meta-oauth', { body: { action: 'disconnect' } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
