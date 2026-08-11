import { projects } from '../data/mockData';
import { campaignsForProject, campaignRollup } from './rollups';
import type { DateRange } from '../types';

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

export type PacingStatus = 'ahead' | 'on-track' | 'at-risk' | 'behind';

export interface MonthPacing {
  daysElapsed: number;
  daysInMonth: number;
  leadsSoFar: number;
  leadGoal: number;
  projected: number;
  pct: number; // projected / leadGoal * 100
  status: PacingStatus;
}

// Projects this calendar month's lead volume from the run-rate so far, and
// compares it against the project's configured monthly lead goal — distinct
// from the dashboard's period gauges, which compare against the selected
// date range rather than the current month.
export function computeMonthPacing(projectId: string): MonthPacing | undefined {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return undefined;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();

  const range: DateRange = { preset: 'custom', start: fmt(monthStart), end: fmt(now) };
  const campaignIds = campaignsForProject(project.id).map((c) => c.id);
  const leadsSoFar = campaignIds.reduce((acc, id) => acc + campaignRollup(id, range).leadsCount, 0);

  const projected = daysElapsed > 0 ? Math.round((leadsSoFar / daysElapsed) * daysInMonth) : 0;
  const pct = project.monthlyLeadGoal > 0 ? (projected / project.monthlyLeadGoal) * 100 : 0;

  let status: PacingStatus = 'on-track';
  if (pct >= 105) status = 'ahead';
  else if (pct >= 90) status = 'on-track';
  else if (pct >= 60) status = 'at-risk';
  else status = 'behind';

  return { daysElapsed, daysInMonth, leadsSoFar, leadGoal: project.monthlyLeadGoal, projected, pct, status };
}
