import { supabase } from "../integrations/supabase/client";
import type { AgencyTaskRow } from "../integrations/supabase/database.types";

export type AgencyTaskStatus = AgencyTaskRow["status"];
export type AgencyTaskCategory = AgencyTaskRow["category"];

export const agencyTaskColumns: { key: AgencyTaskStatus; label: string }[] = [
  { key: "backlog", label: "Entrada" },
  { key: "a_fazer", label: "A fazer" },
  { key: "fazendo", label: "Fazendo" },
  { key: "finalizado", label: "Finalizado" },
];

export const agencyTaskCategoryLabels: Record<AgencyTaskCategory, string> = {
  marketing: "Marketing",
  disparo_massa: "Disparo em massa",
  outro: "Outro",
};

function startOfTodayIso() {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();
}

/**
 * Mantém concluídos visíveis no dia em que foram finalizados. No dia seguinte,
 * saem do quadro e passam a aparecer no Histórico, sem apagar nenhum dado.
 */
export async function listAgencyTasks(): Promise<AgencyTaskRow[]> {
  const { data, error } = await supabase
    .from("agency_tasks")
    .select("*")
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (error) throw error;
  const todayStart = startOfTodayIso();
  return (data ?? []).filter(
    (task) =>
      task.status !== "finalizado" ||
      new Date(task.finished_at ?? task.updated_at).getTime() >=
        new Date(todayStart).getTime(),
  );
}

/** Histórico de tarefas arquivadas e concluídas em dias anteriores. */
export async function listArchivedAgencyTasks(): Promise<AgencyTaskRow[]> {
  const [archivedResult, completedResult] = await Promise.all([
    supabase
      .from("agency_tasks")
      .select("*")
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(200),
    supabase
      .from("agency_tasks")
      .select("*")
      .eq("status", "finalizado")
      .is("archived_at", null)
      .lt("finished_at", startOfTodayIso())
      .order("finished_at", { ascending: false })
      .limit(200),
  ]);
  if (archivedResult.error) throw archivedResult.error;
  if (completedResult.error) throw completedResult.error;
  const byId = new Map<string, AgencyTaskRow>();
  for (const task of [
    ...(archivedResult.data ?? []),
    ...(completedResult.data ?? []),
  ]) {
    byId.set(task.id, task);
  }
  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.archived_at ?? b.finished_at ?? b.updated_at).getTime() -
      new Date(a.archived_at ?? a.finished_at ?? a.updated_at).getTime(),
  );
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
  position: number,
): Promise<AgencyTaskRow> {
  const { data, error } = await supabase
    .from("agency_tasks")
    .insert({ ...input, status, position })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateAgencyTask(
  id: string,
  input: Partial<AgencyTaskInput>,
): Promise<AgencyTaskRow> {
  const { data, error } = await supabase
    .from("agency_tasks")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAgencyTask(id: string) {
  const { error } = await supabase.from("agency_tasks").delete().eq("id", id);
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
  movedTaskId?: string;
  previousStatus?: AgencyTaskStatus;
}): Promise<void> {
  const {
    targetStatus,
    orderedIdsInTargetColumn,
    sourceStatus,
    orderedIdsInSourceColumn,
    movedTaskId,
    previousStatus,
  } = params;
  const updates: { id: string; status: AgencyTaskStatus; position: number }[] =
    [];

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
        .from("agency_tasks")
        .update({ status, position })
        .eq("id", id)
        .then(({ error }) => {
          if (error) throw error;
        }),
    ),
  );

  if (movedTaskId && previousStatus && previousStatus !== targetStatus) {
    const { error } = await supabase
      .from("agency_tasks")
      .update({
        finished_at:
          targetStatus === "finalizado" ? new Date().toISOString() : null,
      })
      .eq("id", movedTaskId);
    if (error) throw error;
  }
}
