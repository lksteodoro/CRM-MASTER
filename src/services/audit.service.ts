import { supabase } from '../integrations/supabase/client';
import type { AuditLogRow, ProfileRow } from '../integrations/supabase/database.types';

export interface AuditLogWithUser extends AuditLogRow {
  user: Pick<ProfileRow, 'id' | 'name' | 'email'> | null;
}

/**
 * Histórico de alterações.
 *
 * A maior parte dos registros é gravada por triggers no Postgres, não pelo
 * front-end — assim uma alteração feita direto pela API também fica auditada.
 */
export async function listAuditLogs(options?: {
  entityType?: string;
  entityId?: string;
  limit?: number;
}): Promise<AuditLogWithUser[]> {
  let query = supabase
    .from('audit_logs')
    .select('*, user:user_id (id, name, email)')
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.entityType) query = query.eq('entity_type', options.entityType);
  if (options?.entityId) query = query.eq('entity_id', options.entityId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AuditLogWithUser[];
}

const entityLabels: Record<string, string> = {
  CLIENT: 'Cliente',
  CLIENT_USER: 'Usuário do cliente',
  PROJECT: 'Projeto',
  PROJECT_GOAL: 'Meta',
  PROJECT_SETTINGS: 'Configuração',
  PROJECT_USER: 'Permissão de projeto',
  PROFILE: 'Usuário',
};

const actionLabels: Record<string, string> = {
  INSERT: 'criou',
  UPDATE: 'alterou',
  DELETE: 'removeu',
  LOGIN: 'entrou',
  INVITE: 'convidou',
};

const fieldLabels: Record<string, string> = {
  name: 'nome',
  status: 'status',
  lead_goal: 'meta de leads',
  cpl_goal: 'meta de CPL',
  spend_goal: 'meta de investimento',
  sales_goal: 'meta de vendas',
  cac_goal: 'meta de CAC',
  revenue_goal: 'meta de receita',
  roas_goal: 'meta de ROAS',
  can_view: 'permissão de visualizar',
  can_edit_goals: 'permissão de editar metas',
  can_edit_settings: 'permissão de editar configurações',
  can_view_leads: 'permissão de ver leads',
  can_view_sales: 'permissão de ver vendas',
  can_view_commercial: 'permissão de ver comercial',
  can_export: 'permissão de exportar',
};

export function describeAuditLog(log: AuditLogRow) {
  const entity = entityLabels[log.entity_type] ?? log.entity_type;
  const action = actionLabels[log.action] ?? log.action;
  const field = log.field_name ? (fieldLabels[log.field_name] ?? log.field_name) : null;
  return { entity, action, field };
}
