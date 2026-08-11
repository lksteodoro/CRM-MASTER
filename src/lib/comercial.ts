import { leads, sales } from '../data/leadSalesData';
import { vendedores, projects } from '../data/mockData';
import type { DateRange, PaymentMethod, PointsTransaction, RankingMetric, RankingSettings } from '../types';

export interface ComercialFilters {
  vendedorId?: string;
  projectId?: string;
}

function inRange(iso: string, range: DateRange) {
  const d = iso.slice(0, 10);
  return d >= range.start && d <= range.end;
}

function projectClientId(projectId: string) {
  return projects.find((p) => p.id === projectId)?.clientId;
}

function baseLeads(clientId: string, range: DateRange, projectId?: string) {
  return leads.filter(
    (l) =>
      projectClientId(l.projectId) === clientId &&
      (!projectId || l.projectId === projectId) &&
      inRange(l.createdAt, range)
  );
}

function baseSales(clientId: string, range: DateRange, projectId?: string) {
  return sales.filter(
    (s) =>
      projectClientId(s.projectId) === clientId &&
      (!projectId || s.projectId === projectId) &&
      inRange(s.closedAt, range)
  );
}

export function filteredLeads(clientId: string, range: DateRange, filters: ComercialFilters = {}) {
  return baseLeads(clientId, range, filters.projectId).filter(
    (l) => !filters.vendedorId || l.assignedTo === filters.vendedorId
  );
}

export function filteredSales(clientId: string, range: DateRange, filters: ComercialFilters = {}) {
  return baseSales(clientId, range, filters.projectId).filter(
    (s) => !filters.vendedorId || s.vendedorId === filters.vendedorId
  );
}

export interface FunnelRatios {
  oportunidade: number;
  qualificacao: number;
  negociacao: number;
  fechamento: number;
  qualifOverOportunidade: number;
  negOverQualif: number;
  fechOverNeg: number;
  fechOverOportunidade: number;
}

// Funnel: Oportunidade (worked leads) -> Qualificação -> Negociação -> Fechamento (matrícula).
// A lead lost along the way still counts toward Oportunidade but not further stages.
export function funnelRatios(clientId: string, range: DateRange, filters: ComercialFilters = {}): FunnelRatios {
  const rows = filteredLeads(clientId, range, filters);
  const oportunidade = rows.filter((l) => l.status !== 'Novo').length;
  const qualificacao = rows.filter((l) => ['Qualificado', 'Negociação', 'Matriculado'].includes(l.status)).length;
  const negociacao = rows.filter((l) => ['Negociação', 'Matriculado'].includes(l.status)).length;
  const fechamento = rows.filter((l) => l.status === 'Matriculado').length;

  return {
    oportunidade,
    qualificacao,
    negociacao,
    fechamento,
    qualifOverOportunidade: oportunidade > 0 ? (qualificacao / oportunidade) * 100 : 0,
    negOverQualif: qualificacao > 0 ? (negociacao / qualificacao) * 100 : 0,
    fechOverNeg: negociacao > 0 ? (fechamento / negociacao) * 100 : 0,
    fechOverOportunidade: oportunidade > 0 ? (fechamento / oportunidade) * 100 : 0,
  };
}

export function medianSaleTimeDays(clientId: string, range: DateRange, filters: ComercialFilters = {}): number {
  const rows = filteredSales(clientId, range, filters);
  const days = rows
    .map((s) => {
      const lead = leads.find((l) => l.id === s.leadId);
      if (!lead) return null;
      return (new Date(s.closedAt).getTime() - new Date(lead.createdAt).getTime()) / 86400000;
    })
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b);

  if (days.length === 0) return 0;
  const mid = Math.floor(days.length / 2);
  return days.length % 2 !== 0 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
}

export function activeCoursesCount(clientId: string, range: DateRange, filters: ComercialFilters = {}): number {
  return new Set(filteredSales(clientId, range, filters).map((s) => s.projectId)).size;
}

export function activeVendedoresCount(clientId: string, range: DateRange, filters: ComercialFilters = {}): number {
  return new Set(baseSales(clientId, range, filters.projectId).map((s) => s.vendedorId)).size;
}

export interface MonthlyPoint {
  month: string; // yyyy-mm
  count: number;
  revenue: number;
}

export function monthlyEnrollments(clientId: string, filters: ComercialFilters = {}): MonthlyPoint[] {
  const allTime: DateRange = { preset: 'custom', start: '2000-01-01', end: '2100-01-01' };
  const rows = filteredSales(clientId, allTime, filters);
  const map = new Map<string, MonthlyPoint>();
  for (const s of rows) {
    const month = s.closedAt.slice(0, 7);
    const cur = map.get(month) ?? { month, count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += s.value;
    map.set(month, cur);
  }
  return Array.from(map.values()).sort((a, b) => (a.month < b.month ? -1 : 1));
}

export interface PaymentMethodPoint {
  method: PaymentMethod;
  count: number;
}

export function paymentMethodBreakdown(
  clientId: string,
  range: DateRange,
  filters: ComercialFilters = {}
): PaymentMethodPoint[] {
  const rows = filteredSales(clientId, range, filters);
  const map = new Map<PaymentMethod, number>();
  for (const s of rows) map.set(s.paymentMethod, (map.get(s.paymentMethod) ?? 0) + 1);
  return Array.from(map.entries()).map(([method, count]) => ({ method, count }));
}

export interface CoursePoint {
  projectId: string;
  name: string;
  count: number;
  revenue: number;
}

export function enrollmentsByCourse(
  clientId: string,
  range: DateRange,
  filters: ComercialFilters = {}
): CoursePoint[] {
  const rows = filteredSales(clientId, range, filters);
  const map = new Map<string, CoursePoint>();
  for (const s of rows) {
    const project = projects.find((p) => p.id === s.projectId);
    const cur = map.get(s.projectId) ?? { projectId: s.projectId, name: project?.name ?? '—', count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += s.value;
    map.set(s.projectId, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export interface VendedorRankRow {
  vendedorId: string;
  name: string;
  salesCount: number;
  revenue: number;
  points: number;
  /** valor exibido/ordenado segundo a métrica ativa do ranking */
  score: number;
  goal: number;
  revenueGoal: number;
  goalPct: number;
  missing: number;
  positionDelta: number; // variação vs. o período imediatamente anterior
}

function scoreFor(metric: RankingMetric, salesCount: number, revenue: number, points: number) {
  if (metric === 'receita') return revenue;
  if (metric === 'pontos') return points;
  return salesCount;
}

function goalFor(metric: RankingMetric, salesGoal: number, revenueGoal: number, pointsPerSale: number) {
  if (metric === 'receita') return revenueGoal;
  if (metric === 'pontos') return salesGoal * pointsPerSale;
  return salesGoal;
}

function rawRanking(
  clientId: string,
  range: DateRange,
  projectId: string | undefined,
  settings: RankingSettings,
  adjustments: PointsTransaction[]
) {
  const clientVendedores = vendedores.filter((v) => v.clientId === clientId);
  const rows = baseSales(clientId, range, projectId);

  return clientVendedores
    .map((v) => {
      const vSales = rows.filter((s) => s.vendedorId === v.id);
      const manual = adjustments
        .filter((a) => a.vendedorId === v.id && a.metric === settings.metric)
        .reduce((sum, a) => sum + a.amount, 0);

      const salesCount = vSales.length;
      const revenue = vSales.reduce((a, s) => a + s.value, 0);
      const points = salesCount * settings.pointsPerSale;

      const base = scoreFor(settings.metric, salesCount, revenue, points);
      const score = base + manual;
      const goal = goalFor(settings.metric, v.salesGoal, v.revenueGoal, settings.pointsPerSale);

      return {
        vendedorId: v.id,
        name: v.name,
        salesCount,
        revenue,
        points,
        score,
        goal,
        revenueGoal: v.revenueGoal,
        goalPct: goal > 0 ? (score / goal) * 100 : 0,
        missing: Math.max(0, goal - score),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function previousRange(range: DateRange): DateRange {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const span = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (span - 1));
  return { preset: 'custom', start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) };
}

// Always ranks every salesperson at the client — a vendedor-scoped filter
// wouldn't make sense for a cross-team leaderboard/competition.
export function vendedorRanking(
  clientId: string,
  range: DateRange,
  filters: Pick<ComercialFilters, 'projectId'> = {},
  settings: RankingSettings = defaultRankingSettings,
  adjustments: PointsTransaction[] = []
): VendedorRankRow[] {
  const current = rawRanking(clientId, range, filters.projectId, settings, adjustments);
  const previous = rawRanking(clientId, previousRange(range), filters.projectId, settings, []);
  const prevPos = new Map(previous.map((r, i) => [r.vendedorId, i]));

  return current.map((row, i) => ({
    ...row,
    positionDelta: prevPos.has(row.vendedorId) ? (prevPos.get(row.vendedorId) as number) - i : 0,
  }));
}

export const defaultRankingSettings: RankingSettings = {
  title: 'Ranking de Vendas',
  metric: 'matriculas',
  pointsPerSale: 1,
  prizes: { first: 'Bônus de R$ 1.000', second: 'Caixa de som JBL', third: 'Vale-presente R$ 300' },
  bonusLabel: '2X Comissão Dobrada',
};

export interface TeamTotals {
  score: number;
  goal: number;
  goalPct: number;
  top3Score: number;
}

export function teamTotals(rows: VendedorRankRow[]): TeamTotals {
  const score = rows.reduce((a, r) => a + r.score, 0);
  const goal = rows.reduce((a, r) => a + r.goal, 0);
  return {
    score,
    goal,
    goalPct: goal > 0 ? (score / goal) * 100 : 0,
    top3Score: rows.slice(0, 3).reduce((a, r) => a + r.score, 0),
  };
}
