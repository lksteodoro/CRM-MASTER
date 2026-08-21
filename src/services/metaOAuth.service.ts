import { supabase } from '../integrations/supabase/client';

export type MetaOAuthConnection = {
  id: string;
  meta_user_name: string | null;
  status: 'CONNECTED' | 'ERROR' | 'REVOKED';
  connected_at: string;
  expires_at: string | null;
  last_error: string | null;
};

export async function getMetaOAuthConnection(): Promise<MetaOAuthConnection | null> {
  const db = supabase as any;
  const { data, error } = await db
    .from('meta_oauth_connections')
    .select('id, meta_user_name, status, connected_at, expires_at, last_error')
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
