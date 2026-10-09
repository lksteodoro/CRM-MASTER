/**
 * Regras puras do editor em massa da Meta (sem React, sem rede): orçamento,
 * renomeação, status, resultados e o pacote de alterações que vai para a Graph.
 */

export type BulkLevel = 'campaign' | 'adset' | 'ad';

export const LEVEL_EDGE: Record<BulkLevel, string> = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' };

// ─── Status ─────────────────────────────────────────────────────────────────

export type StatusFilter = 'all' | 'active' | 'paused' | 'issues';

/** Valores de effective_status que cada nível aceita no filtro da Graph. */
const LEVEL_STATUSES: Record<BulkLevel, string[]> = {
  campaign: ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'],
  adset: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'],
  ad: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO'],
};

const FILTER_STATUSES: Record<StatusFilter, string[] | null> = {
  all: null,
  active: ['ACTIVE'],
  paused: ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'],
  issues: ['IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PENDING_BILLING_INFO'],
};

/** Filtro de status pronto para o parâmetro `filtering` (sem arquivados nem excluídos). */
export function statusFiltering(level: BulkLevel, filter: StatusFilter): string {
  const valid = LEVEL_STATUSES[level];
  const wanted = FILTER_STATUSES[filter];
  const value = wanted ? valid.filter((status) => wanted.includes(status)) : valid;
  return JSON.stringify([{ field: 'effective_status', operator: 'IN', value }]);
}

export type StatusTone = 'active' | 'paused' | 'review' | 'problem';

export const STATUS_INFO: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Ativo', tone: 'active' },
  PAUSED: { label: 'Pausado', tone: 'paused' },
  CAMPAIGN_PAUSED: { label: 'Campanha pausada', tone: 'paused' },
  ADSET_PAUSED: { label: 'Conjunto pausado', tone: 'paused' },
  IN_PROCESS: { label: 'Processando', tone: 'review' },
  PENDING_REVIEW: { label: 'Em análise', tone: 'review' },
  PREAPPROVED: { label: 'Pré-aprovado', tone: 'review' },
  WITH_ISSUES: { label: 'Com problemas', tone: 'problem' },
  DISAPPROVED: { label: 'Reprovado', tone: 'problem' },
  PENDING_BILLING_INFO: { label: 'Falta pagamento', tone: 'problem' },
  ARCHIVED: { label: 'Arquivado', tone: 'paused' },
  DELETED: { label: 'Excluído', tone: 'paused' },
};

export const statusInfo = (status?: string) => STATUS_INFO[status ?? ''] ?? { label: status || '—', tone: 'paused' as StatusTone };

/** Motivos de reprovação que a Meta devolve em ad_review_feedback. */
export function reviewIssues(feedback: unknown): string[] {
  if (!feedback || typeof feedback !== 'object') return [];
  const out: string[] = [];
  for (const group of Object.values(feedback as Record<string, unknown>)) {
    if (group && typeof group === 'object') {
      for (const [reason, text] of Object.entries(group as Record<string, unknown>)) {
        out.push(typeof text === 'string' && text.trim() ? text.trim() : reason.replace(/_/g, ' ').toLowerCase());
      }
    }
  }
  return [...new Set(out)];
}

// ─── Resultados ─────────────────────────────────────────────────────────────

/** Mesma ordem do resumo diário: a primeira ação de lead que aparecer conta. */
export const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];

export function leadsFromActions(actions?: Array<{ action_type?: string; value?: string | number }> | null): number {
  for (const type of LEAD_ACTION_TYPES) {
    const hit = actions?.find((action) => action.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

// ─── Orçamento ──────────────────────────────────────────────────────────────

export type BudgetField = 'daily_budget' | 'lifetime_budget';
export type BudgetChange = { mode: 'set' | 'increase' | 'decrease'; value: number };

/** Orçamento próprio do objeto (null quando ele usa o da campanha ou não tem). */
export function ownBudget(row: { daily_budget?: string | number | null; lifetime_budget?: string | number | null }): { field: BudgetField; cents: number } | null {
  const daily = Number(row.daily_budget);
  if (daily > 0) return { field: 'daily_budget', cents: daily };
  const lifetime = Number(row.lifetime_budget);
  if (lifetime > 0) return { field: 'lifetime_budget', cents: lifetime };
  return null;
}

/** Novo orçamento em centavos: valor em reais, ou percentual sobre o atual. */
export function nextBudgetCents(currentCents: number, change: BudgetChange): number | null {
  if (!Number.isFinite(change.value) || change.value <= 0) return null;
  if (change.mode === 'set') return Math.round(change.value * 100);
  if (change.mode === 'decrease' && change.value >= 100) return null;
  const factor = change.mode === 'increase' ? 1 + change.value / 100 : 1 - change.value / 100;
  return Math.max(1, Math.round(currentCents * factor));
}

/** Mais de 20% de uma vez costuma reiniciar o aprendizado do conjunto. */
export const isAggressiveBudgetChange = (beforeCents: number, afterCents: number) =>
  beforeCents > 0 && Math.abs(afterCents - beforeCents) / beforeCents > 0.2;

export const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "1.234,56" ou "50" → 50 (reais). */
export function parseReais(text: string): number {
  const cleaned = text.replace(/[^\d,.-]/g, '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

// ─── Nome ───────────────────────────────────────────────────────────────────

export type RenameRule = { find: string; replace: string; prefix: string; suffix: string };

export function renameWith(name: string, rule: RenameRule): string {
  const replaced = rule.find ? name.split(rule.find).join(rule.replace) : name;
  return `${rule.prefix}${replaced}${rule.suffix}`.trim();
}

// ─── Pacote de alterações ───────────────────────────────────────────────────

export type BulkChange = { id: string; params: Record<string, string>; previous: Record<string, string> };

/** Só o que muda de verdade vai para a Meta (e guarda o valor de antes para desfazer). */
export function changesFor<T extends { id: string }>(
  rows: T[],
  planner: (row: T) => { params: Record<string, string>; previous: Record<string, string> } | null
): BulkChange[] {
  const out: BulkChange[] = [];
  for (const row of rows) {
    const planned = planner(row);
    if (!planned) continue;
    const params = Object.fromEntries(Object.entries(planned.params).filter(([key, value]) => planned.previous[key] !== value));
    if (Object.keys(params).length === 0) continue;
    out.push({ id: row.id, params, previous: Object.fromEntries(Object.keys(params).map((key) => [key, planned.previous[key]])) });
  }
  return out;
}

/** Desfazer = aplicar de novo os valores de antes. */
export const undoChanges = (changes: BulkChange[]): BulkChange[] =>
  changes.map((change) => ({ id: change.id, params: change.previous, previous: change.params }));

export function adsManagerLink(level: BulkLevel, accountId: string, id: string): string {
  const account = accountId.replace(/^act_/i, '');
  const edge = LEVEL_EDGE[level];
  return `https://adsmanager.facebook.com/adsmanager/manage/${edge}?act=${encodeURIComponent(account)}&selected_${edge}_ids=${encodeURIComponent(id)}`;
}
