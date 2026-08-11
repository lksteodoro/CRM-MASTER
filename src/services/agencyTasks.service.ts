import { supabase } from '../integrations/supabase/client';
import type { AgencyTaskRow } from '../integrations/supabase/database.types';

export type AgencyTaskStatus = AgencyTaskRow['status'];
export type AgencyTaskCategory = AgencyTaskRow['category'];

export const agencyTaskColumns: { key: AgencyTaskStatus; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'a_fazer', label: 'A fazer' },
  { key: 'fazendo', label: 'Fazendo' },
  { key: 'finalizado', label: 'Finalizado' },
];

export const agencyTaskCategoryLabels: Record<AgencyTaskCategory, string> = {
  marketing: 'Marketing',
  disparo_massa: 'Disparo em massa',
  outro: 'Outro',
};

/** Board ativo do admin logado — tudo que ainda não foi arquivado. */
export async function listAgencyTasks(): Promise<AgencyTaskRow[]> {
  const { data, error } = await supabase
    .from('agency_tasks')
    .select('*')
    .is('archived_at', null)
    .order('position', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Histórico de tarefas finalizadas e arquivadas pelo job diário. */
export async function listArchivedAgencyTasks(): Promise<AgencyTaskRow[]> {
  const { data, error } = await supabase
    .from('agency_tasks')
    .select('*')
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export interface AgencyTaskInput {
  title: string;
  description: string | null;
  category: AgencyTaskCategory;
  estimated_minutes: number | null;
  due_date: string | null;
}

export async function createAgencyTask(
  input: AgencyTaskInput,
  status: AgencyTaskStatus,
  position: number
): Promise<AgencyTaskRow> {
  const { data, error } = await supabase
    .from('agency_tasks')
    .insert({ ...input, status, position })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateAgencyTask(
  id: string,
  input: Partial<AgencyTaskInput>
): Promise<AgencyTaskRow> {
  const { data, error } = await supabase
    .from('agency_tasks')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAgencyTask(id: string) {
  const { error } = await supabase.from('agency_tasks').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Reescreve status e posição (0..n) dos cards de uma coluna após um
 * drag-and-drop. Quando o card muda de coluna, passe também a coluna de
 * origem já sem o card movido, pra reordenar quem ficou pra trás.
 */
export async function moveAgencyTask(params: {
  targetStatus: AgencyTaskStatus;
  orderedIdsInTargetColumn: string[];
  sourceStatus?: AgencyTaskStatus;
  orderedIdsInSourceColumn?: string[];
}): Promise<void> {
  const { targetStatus, orderedIdsInTargetColumn, sourceStatus, orderedIdsInSourceColumn } = params;
  const updates: { id: string; status: AgencyTaskStatus; position: number }[] = [];

  orderedIdsInTargetColumn.forEach((id, index) => {
    updates.push({ id, status: targetStatus, position: index });
  });

  if (sourceStatus && orderedIdsInSourceColumn) {
    orderedIdsInSourceColumn.forEach((id, index) => {
      updates.push({ id, status: sourceStatus, position: index });
    });
  }

  await Promise.all(
    updates.map(({ id, status, position }) =>
      supabase
        .from('agency_tasks')
        .update({ status, position })
        .eq('id', id)
        .then(({ error }) => {
          if (error) throw error;
        })
    )
  );
}
