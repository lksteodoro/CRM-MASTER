import { supabase } from '../integrations/supabase/client';
import type { ClientRow, ClientStatus } from '../integrations/supabase/database.types';

/**
 * Lista clientes visíveis ao usuário autenticado.
 *
 * Não há filtro por organização/cliente aqui de propósito: as políticas de RLS
 * já restringem o resultado. O ADMIN recebe todos da organização; o CLIENT,
 * apenas aqueles aos quais está vinculado.
 */
export async function listClients(includeArchived = false): Promise<ClientRow[]> {
  let query = supabase.from('clients').select('*').order('name');
  if (!includeArchived) query = query.neq('status', 'ARCHIVED');

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getClient(clientId: string): Promise<ClientRow | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CreateClientInput {
  organizationId: string;
  name: string;
  legalName?: string | null;
  document?: string | null;
}

export async function createClient(input: CreateClientInput): Promise<ClientRow> {
  const { data: userData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('clients')
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      legal_name: input.legalName ?? null,
      document: input.document ?? null,
      created_by: userData.user?.id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateClient(
  clientId: string,
  patch: Partial<Pick<ClientRow, 'name' | 'legal_name' | 'document' | 'logo_url' | 'status'>>
): Promise<ClientRow> {
  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', clientId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Arquivamento em vez de DELETE, para preservar histórico e auditoria. */
export async function archiveClient(clientId: string): Promise<ClientRow> {
  return updateClient(clientId, { status: 'ARCHIVED' as ClientStatus });
}

function generateTelaoToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Gera (ou regenera, invalidando o link antigo na hora) o token do telão do cliente. */
export async function regenerateTelaoToken(clientId: string): Promise<ClientRow> {
  const { data, error } = await supabase
    .from('clients')
    .update({ telao_token: generateTelaoToken(), telao_active: true })
    .eq('id', clientId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
