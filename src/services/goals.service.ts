import { supabase } from '../integrations/supabase/client';
import type { ProjectGoalRow } from '../integrations/supabase/database.types';

export interface GoalValues {
  spend_goal: number | null;
  lead_goal: number | null;
  cpl_goal: number | null;
  sales_goal: number | null;
  cac_goal: number | null;
  revenue_goal: number | null;
  roas_goal: number | null;
}

export const emptyGoals: GoalValues = {
  spend_goal: null,
  lead_goal: null,
  cpl_goal: null,
  sales_goal: null,
  cac_goal: null,
  revenue_goal: null,
  roas_goal: null,
};

export function currentMonthPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { period_start: fmt(start), period_end: fmt(end) };
}

export async function listGoals(projectId: string): Promise<ProjectGoalRow[]> {
  const { data, error } = await supabase
    .from('project_goals')
    .select('*')
    .eq('project_id', projectId)
    .order('period_start', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Meta cujo período contém a data informada (padrão: hoje). */
export async function getGoalForDate(
  projectId: string,
  date = new Date()
): Promise<ProjectGoalRow | null> {
  const iso = date.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('project_goals')
    .select('*')
    .eq('project_id', projectId)
    .lte('period_start', iso)
    .gte('period_end', iso)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Cria ou atualiza a meta de um período.
 *
 * Metas de períodos diferentes convivem — o histórico nunca é sobrescrito. Se o
 * mesmo período for salvo de novo, o trigger de auditoria registra cada campo
 * alterado com valor anterior e novo.
 */
export async function upsertGoal(input: {
  projectId: string;
  period_start: string;
  period_end: string;
  values: Partial<GoalValues>;
}): Promise<ProjectGoalRow> {
  const { data: userData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('project_goals')
    .upsert(
      {
        project_id: input.projectId,
        period_start: input.period_start,
        period_end: input.period_end,
        ...emptyGoals,
        ...input.values,
        created_by: userData.user?.id ?? null,
      },
      { onConflict: 'project_id,period_start,period_end' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}
