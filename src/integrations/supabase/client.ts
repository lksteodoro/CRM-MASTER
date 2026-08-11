import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * `false` quando as variáveis de ambiente não foram configuradas. A aplicação
 * usa isso para mostrar uma tela de instruções em vez de quebrar com erro de
 * rede — útil enquanto o projeto Supabase ainda não existe.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[Leads Hub] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não definidas. ' +
      'Copie .env.example para .env e preencha com as chaves do seu projeto Supabase.'
  );
}

// Somente a anon key entra no front-end. A service_role key jamais deve ser
// exposta aqui — ela ignora RLS e daria acesso irrestrito ao banco.
export const supabase = createClient<Database>(
  supabaseUrl ?? 'http://localhost:54321',
  supabaseAnonKey ?? 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
