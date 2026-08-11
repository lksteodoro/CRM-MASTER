import { leads, sales } from '../data/leadSalesData';

function parseDateLocal(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function mondayOf(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday;
}

export interface CohortRow {
  weekStart: string;
  totalLeads: number;
  // % converted to sale by N weeks after the cohort's week started; null = window hasn't matured yet
  cells: (number | null)[];
}

const OFFSET_WEEKS = [1, 2, 3, 4];

// Classic acquisition cohort: leads grouped by the week they entered, then
// the % of that cohort that had converted to a sale by 1/2/3/4 weeks later.
// Cells for windows that haven't had time to mature yet are left null rather
// than shown as a misleading 0%.
export function computeCohort(campaignIds: Set<string>): CohortRow[] {
  const projectLeads = leads.filter((l) => campaignIds.has(l.campaignId));
  const cohorts = new Map<string, typeof projectLeads>();

  for (const lead of projectLeads) {
    const key = fmt(mondayOf(parseDateLocal(lead.createdAt.slice(0, 10))));
    const arr = cohorts.get(key) ?? [];
    arr.push(lead);
    cohorts.set(key, arr);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sortedKeys = Array.from(cohorts.keys()).sort();
  const recentKeys = sortedKeys.slice(-8);

  return recentKeys.map((key) => {
    const cohortLeads = cohorts.get(key)!;
    const weekStart = parseDateLocal(key);
    const totalLeads = cohortLeads.length;

    const cells = OFFSET_WEEKS.map((weeks) => {
      const dueDate = new Date(weekStart);
      dueDate.setDate(dueDate.getDate() + weeks * 7);
      if (dueDate > today) return null;

      const converted = cohortLeads.filter((lead) => {
        const sale = sales.find((s) => s.leadId === lead.id);
        if (!sale) return false;
        return parseDateLocal(sale.closedAt.slice(0, 10)) < dueDate;
      }).length;

      return totalLeads > 0 ? (converted / totalLeads) * 100 : 0;
    });

    return { weekStart: key, totalLeads, cells };
  });
}
