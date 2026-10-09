/**
 * Motor determinístico da Otimização IA.
 *
 * Funções puras, sem dependências: rodam na Edge Function `optimization-ia`
 * (Deno), no navegador (rótulos, validação, simulação exibida) e nos testes
 * (Node). Quem decide se uma ação pode acontecer é este motor, nunca a IA.
 *
 * Dinheiro sempre em centavos inteiros da moeda da conta.
 */

export type ResourceLevel = 'CAMPAIGN' | 'ADSET';
export type ActionType = 'ALERT' | 'PAUSE' | 'BUDGET_INCREASE' | 'BUDGET_DECREASE';
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type Mode = 'OBSERVE' | 'APPROVAL' | 'AUTO_LIMITED' | 'PAUSED';
export type Strategy = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type ActionStatus =
  | 'PROPOSED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'REJECTED'
  | 'DISMISSED'
  | 'SKIPPED'
  | 'FAILED'
  | 'REVERTED'
  | 'EXPIRED';

// ── Catálogos fechados ───────────────────────────────────────────────────────

export const METRICS = {
  spend: { label: 'Gasto', unit: 'money' },
  impressions: { label: 'Impressões', unit: 'count' },
  reach: { label: 'Alcance', unit: 'count' },
  link_clicks: { label: 'Cliques no link', unit: 'count' },
  results: { label: 'Resultados', unit: 'count' },
  value: { label: 'Valor de conversão', unit: 'money' },
  frequency: { label: 'Frequência', unit: 'decimal' },
  ctr: { label: 'CTR do link', unit: 'percent' },
  cpc: { label: 'CPC do link', unit: 'money' },
  cpm: { label: 'CPM', unit: 'money' },
  cpa: { label: 'Custo por resultado', unit: 'money' },
  roas: { label: 'ROAS', unit: 'decimal' },
  cpa_ratio: { label: 'Custo por resultado ÷ meta', unit: 'ratio' },
  spend_ratio: { label: 'Gasto ÷ meta de custo', unit: 'ratio' },
  age_hours: { label: 'Idade em horas', unit: 'count' },
} as const;
export type Metric = keyof typeof METRICS;

export const OPERATORS = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'entre',
  pct_change_gt: 'variação maior que (%)',
  pct_change_lt: 'variação menor que (%)',
} as const;
export type Operator = keyof typeof OPERATORS;

/** Eventos de resultado aceitos. O perfil escolhe um; nada é inferido. */
export const TARGET_EVENTS = [
  { value: 'lead', label: 'Leads (formulário + site)', objective: 'LEADS' },
  { value: 'onsite_conversion.lead_grouped', label: 'Leads de formulário instantâneo', objective: 'LEADS' },
  { value: 'offsite_conversion.fb_pixel_lead', label: 'Leads do pixel (site)', objective: 'LEADS' },
  { value: 'onsite_conversion.messaging_conversation_started_7d', label: 'Conversas iniciadas por mensagem', objective: 'LEADS' },
  { value: 'offsite_conversion.fb_pixel_complete_registration', label: 'Cadastros completos (pixel)', objective: 'LEADS' },
  { value: 'purchase', label: 'Compras (todas as origens)', objective: 'SALES' },
  { value: 'offsite_conversion.fb_pixel_purchase', label: 'Compras do pixel (site)', objective: 'SALES' },
] as const;
export const TARGET_EVENT_VALUES: readonly string[] = TARGET_EVENTS.map((event) => event.value);

/** Moedas com duas casas decimais na Meta. Ações de orçamento só nelas. */
export const BUDGET_CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP', 'MXN', 'ARS', 'CAD', 'AUD', 'CHF', 'PEN', 'UYU'];

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  ALERT: 'Alerta',
  PAUSE: 'Pausar',
  BUDGET_INCREASE: 'Aumentar orçamento',
  BUDGET_DECREASE: 'Reduzir orçamento',
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  PROPOSED: 'Recomendação',
  PENDING_APPROVAL: 'Pendente de aprovação',
  APPROVED: 'Aprovada',
  EXECUTING: 'Executando',
  EXECUTED: 'Executada',
  REJECTED: 'Rejeitada',
  DISMISSED: 'Dispensada',
  SKIPPED: 'Não executada',
  FAILED: 'Falhou',
  REVERTED: 'Revertida',
  EXPIRED: 'Expirada',
};

export const MODE_LABEL: Record<Mode, string> = {
  OBSERVE: 'Somente observar',
  APPROVAL: 'Com aprovação',
  AUTO_LIMITED: 'Automático limitado',
  PAUSED: 'Pausado',
};

export const LEVEL_LABEL: Record<ResourceLevel | 'ACCOUNT', string> = {
  ACCOUNT: 'Conta',
  CAMPAIGN: 'Campanha',
  ADSET: 'Conjunto',
};

export const STRATEGY_LABEL: Record<Strategy, string> = {
  CONSERVATIVE: 'Conservadora',
  BALANCED: 'Equilibrada',
  AGGRESSIVE: 'Agressiva',
};

/** Estados em que já existe algo em andamento para o recurso. */
export const OPEN_STATUSES: readonly ActionStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'];

// ── Métricas ─────────────────────────────────────────────────────────────────

export type Totals = {
  spendCents: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  results: number;
  valueCents: number;
  frequency: number | null;
};

export const EMPTY_TOTALS: Totals = {
  spendCents: 0,
  impressions: 0,
  reach: 0,
  linkClicks: 0,
  results: 0,
  valueCents: 0,
  frequency: null,
};

type InsightAction = { action_type?: string; value?: string | number };
export type InsightRow = {
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  frequency?: string | number;
  inline_link_clicks?: string | number;
  actions?: InsightAction[] | null;
  action_values?: InsightAction[] | null;
};

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Linha de Insights da Meta → totais. Conta só o evento escolhido no perfil. */
export function totalsFromInsight(row: InsightRow | null | undefined, targetEvent: string): Totals {
  if (!row) return { ...EMPTY_TOTALS };
  const result = row.actions?.find((action) => action.action_type === targetEvent);
  const value = row.action_values?.find((action) => action.action_type === targetEvent);
  const frequency = Number(row.frequency);
  return {
    spendCents: Math.round(num(row.spend) * 100),
    impressions: Math.round(num(row.impressions)),
    reach: Math.round(num(row.reach)),
    linkClicks: Math.round(num(row.inline_link_clicks)),
    results: Math.round(num(result?.value)),
    valueCents: Math.round(num(value?.value) * 100),
    frequency: Number.isFinite(frequency) && frequency > 0 ? frequency : null,
  };
}

export type MetricValues = Record<Metric, number | null>;

/** Divisão por zero vira `null` ("—"), nunca 0 nem infinito. */
export function metricsOf(totals: Totals, targetCpaCents: number, ageHours: number | null): MetricValues {
  const cpa = totals.results > 0 ? totals.spendCents / totals.results : null;
  return {
    spend: totals.spendCents,
    impressions: totals.impressions,
    reach: totals.reach,
    link_clicks: totals.linkClicks,
    results: totals.results,
    value: totals.valueCents,
    frequency: totals.frequency ?? (totals.reach > 0 ? totals.impressions / totals.reach : null),
    ctr: totals.impressions > 0 ? (totals.linkClicks / totals.impressions) * 100 : null,
    cpc: totals.linkClicks > 0 ? totals.spendCents / totals.linkClicks : null,
    cpm: totals.impressions > 0 ? (totals.spendCents / totals.impressions) * 1000 : null,
    cpa,
    roas: totals.spendCents > 0 ? totals.valueCents / totals.spendCents : null,
    cpa_ratio: cpa !== null && targetCpaCents > 0 ? cpa / targetCpaCents : null,
    spend_ratio: targetCpaCents > 0 ? totals.spendCents / targetCpaCents : null,
    age_hours: ageHours,
  };
}

export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ── Formatação ───────────────────────────────────────────────────────────────

export function formatMoney(cents: number | null, currency = 'BRL'): string {
  if (cents === null || !Number.isFinite(cents)) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}

export function formatMetric(metric: Metric, value: number | null, currency = 'BRL'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const unit = METRICS[metric].unit;
  if (unit === 'money') return formatMoney(value, currency);
  if (unit === 'percent') return `${value.toFixed(2).replace('.', ',')}%`;
  if (unit === 'ratio') return `${value.toFixed(2).replace('.', ',')}×`;
  if (unit === 'decimal') return value.toFixed(2).replace('.', ',');
  return Math.round(value).toLocaleString('pt-BR');
}

const formatPct = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}%`;

// ── Janelas de tempo ─────────────────────────────────────────────────────────

export type DateRange = { since: string; until: string };

/** Data (AAAA-MM-DD) de `now` no fuso da conta. */
export function dateInZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Janela atual (dias completos, terminando ontem no fuso da conta) e a
 * anterior de mesmo tamanho. Hoje fica de fora: a atribuição ainda está aberta.
 */
export function evaluationWindow(timeZone: string, lookbackDays: number, now: Date): { current: DateRange; previous: DateRange } {
  const until = addDays(dateInZone(now, timeZone), -1);
  const since = addDays(until, -(lookbackDays - 1));
  const previousUntil = addDays(since, -1);
  return { current: { since, until }, previous: { since: addDays(previousUntil, -(lookbackDays - 1)), until: previousUntil } };
}

/** Datas da Meta vêm como `2026-09-01T10:00:00-0300`. */
export function parseMetaTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function hoursSince(value: string | null | undefined, now: Date): number | null {
  const time = parseMetaTime(value);
  return time === null ? null : Math.max(0, (now.getTime() - time) / 3_600_000);
}

// ── Regras ───────────────────────────────────────────────────────────────────

export type RuleCondition = {
  metric: Metric;
  operator: Operator;
  value?: number | [number, number];
  /** Só `target_cpa` é aceito; compara com a meta do perfil × `multiplier`. */
  value_ref?: 'target_cpa';
  multiplier?: number;
};

export type RuleMinimums = {
  results?: number;
  previous_results?: number;
  spend_multiplier_of_target?: number;
  impressions?: number;
  link_clicks?: number;
  age_hours?: number;
};

export type RuleAction = { type: ActionType; pct?: number; severity: Severity };

export type RuleDiagnosis = { causes: string[]; recommendation: string; risk: string };

export type RuleDefinition = {
  key: string;
  name: string;
  description: string;
  scope: ResourceLevel;
  priority: number;
  minimums: RuleMinimums;
  all: RuleCondition[];
  any: RuleCondition[];
  action: RuleAction;
  cooldown_hours: number;
  enabled: boolean;
  diagnosis: RuleDiagnosis;
};

const GENERIC_DIAGNOSIS: RuleDiagnosis = {
  causes: ['Mudança de desempenho detectada pelas condições da regra.'],
  recommendation: 'Revise o recurso antes de agir.',
  risk: 'Decidir com poucos dados pode piorar o resultado.',
};

/** Regras padrão (estratégia equilibrada). Todas editáveis e desligáveis. */
export const DEFAULT_RULES: RuleDefinition[] = [
  {
    key: 'R01_STOP_LOSS',
    name: 'Stop loss',
    description: 'Gastou 2× a meta de custo e não trouxe nenhum resultado.',
    scope: 'ADSET',
    priority: 90,
    minimums: { spend_multiplier_of_target: 2 },
    all: [
      { metric: 'results', operator: 'eq', value: 0 },
      { metric: 'spend_ratio', operator: 'gte', value: 2 },
    ],
    any: [],
    action: { type: 'PAUSE', severity: 'CRITICAL' },
    cooldown_hours: 48,
    enabled: true,
    diagnosis: {
      causes: ['Público ou criativo sem aderência à oferta.', 'Evento de conversão não está disparando.', 'Problema na página ou no formulário.'],
      recommendation: 'Pausar o conjunto e revisar público, criativo e rastreamento antes de reativar.',
      risk: 'Conversões atrasadas pela atribuição podem aparecer depois. Confira o evento antes de pausar.',
    },
  },
  {
    key: 'R02_CPA_ABOVE_TARGET',
    name: 'Custo acima da meta',
    description: 'Custo por resultado 25% acima da meta e piorando em relação ao período anterior.',
    scope: 'ADSET',
    priority: 80,
    minimums: { results: 5, spend_multiplier_of_target: 3 },
    all: [
      { metric: 'cpa_ratio', operator: 'gte', value: 1.25 },
      { metric: 'cpa', operator: 'pct_change_gt', value: 0 },
    ],
    any: [],
    action: { type: 'BUDGET_DECREASE', pct: 20, severity: 'WARNING' },
    cooldown_hours: 48,
    enabled: true,
    diagnosis: {
      causes: ['Leilão mais caro (CPM em alta).', 'Queda da taxa de conversão da página.', 'Fadiga do criativo.'],
      recommendation: 'Reduzir o orçamento e investigar CPM, CTR e conversão da página.',
      risk: 'Reduzir demais pode devolver o conjunto à fase de aprendizado.',
    },
  },
  {
    key: 'R03_SCALE_VERTICAL',
    name: 'Escala vertical',
    description: 'Custo por resultado 20% abaixo da meta com volume mínimo.',
    scope: 'ADSET',
    priority: 60,
    minimums: { results: 10, spend_multiplier_of_target: 3 },
    all: [{ metric: 'cpa_ratio', operator: 'lte', value: 0.8 }],
    any: [],
    action: { type: 'BUDGET_INCREASE', pct: 15, severity: 'INFO' },
    cooldown_hours: 48,
    enabled: true,
    diagnosis: {
      causes: ['Conjunto convertendo abaixo da meta com volume consistente.'],
      recommendation: 'Aumentar o orçamento aos poucos e acompanhar o custo nos dias seguintes.',
      risk: 'A escala pode aumentar o custo por resultado. Não há garantia de manter o desempenho.',
    },
  },
  {
    key: 'R04_CTR_DROP',
    name: 'Queda do CTR do link',
    description: 'CTR do link caiu mais de 25% em relação ao período anterior.',
    scope: 'ADSET',
    priority: 40,
    minimums: { impressions: 3000 },
    all: [{ metric: 'ctr', operator: 'pct_change_lt', value: -25 }],
    any: [],
    action: { type: 'ALERT', severity: 'WARNING' },
    cooldown_hours: 24,
    enabled: true,
    diagnosis: {
      causes: ['Criativo saturado.', 'Público mais frio.', 'Mudança de posicionamento.'],
      recommendation: 'Testar novos criativos ou ganchos no início do vídeo.',
      risk: 'Variações curtas de CTR podem ser ruído.',
    },
  },
  {
    key: 'R05_CPM_UP',
    name: 'CPM em alta',
    description: 'CPM da campanha subiu mais de 30% em relação ao período anterior.',
    scope: 'CAMPAIGN',
    priority: 35,
    minimums: { impressions: 3000 },
    all: [{ metric: 'cpm', operator: 'pct_change_gt', value: 30 }],
    any: [],
    action: { type: 'ALERT', severity: 'INFO' },
    cooldown_hours: 24,
    enabled: true,
    diagnosis: {
      causes: ['Concorrência maior no leilão (sazonalidade).', 'Público muito restrito.', 'Qualidade do anúncio em queda.'],
      recommendation: 'Comparar com a sazonalidade e avaliar ampliar o público.',
      risk: 'CPM alto nem sempre piora o custo por resultado.',
    },
  },
  {
    key: 'R06_CREATIVE_FATIGUE',
    name: 'Fadiga criativa',
    description: 'Frequência alta, CTR caindo e custo por resultado subindo.',
    scope: 'ADSET',
    priority: 50,
    minimums: { impressions: 5000, results: 3 },
    all: [
      { metric: 'frequency', operator: 'gte', value: 3 },
      { metric: 'ctr', operator: 'pct_change_lt', value: -15 },
      { metric: 'cpa', operator: 'pct_change_gt', value: 15 },
    ],
    any: [],
    action: { type: 'ALERT', severity: 'WARNING' },
    cooldown_hours: 72,
    enabled: true,
    diagnosis: {
      causes: ['O mesmo público está vendo o anúncio muitas vezes.'],
      recommendation: 'Subir novos criativos no conjunto ou ampliar o público.',
      risk: 'Trocar todos os criativos de uma vez reinicia o aprendizado.',
    },
  },
  {
    key: 'R13_FREQUENCY',
    name: 'Saturação de frequência',
    description: 'Frequência acima de 4 e subindo.',
    scope: 'ADSET',
    priority: 30,
    minimums: { impressions: 3000 },
    all: [
      { metric: 'frequency', operator: 'gte', value: 4 },
      { metric: 'frequency', operator: 'pct_change_gt', value: 10 },
    ],
    any: [],
    action: { type: 'ALERT', severity: 'INFO' },
    cooldown_hours: 72,
    enabled: true,
    diagnosis: {
      causes: ['Público pequeno para o orçamento atual.'],
      recommendation: 'Ampliar o público ou renovar os criativos.',
      risk: 'Frequência alta pode ser aceitável em remarketing.',
    },
  },
  {
    key: 'R14_CPC_UP',
    name: 'CPC fora do padrão',
    description: 'CPC do link subiu mais de 30% em relação ao período anterior.',
    scope: 'ADSET',
    priority: 30,
    minimums: { link_clicks: 50 },
    all: [{ metric: 'cpc', operator: 'pct_change_gt', value: 30 }],
    any: [],
    action: { type: 'ALERT', severity: 'INFO' },
    cooldown_hours: 48,
    enabled: true,
    diagnosis: {
      causes: ['CPM subiu ou CTR caiu.'],
      recommendation: 'Ver se o aumento vem do leilão (CPM) ou do criativo (CTR).',
      risk: 'CPC isolado não indica custo por resultado.',
    },
  },
  {
    key: 'R15_TREND_DOWN',
    name: 'Resultados em queda',
    description: 'Resultados caíram mais de 30% em relação ao período anterior.',
    scope: 'CAMPAIGN',
    priority: 45,
    minimums: { previous_results: 10 },
    all: [{ metric: 'results', operator: 'pct_change_lt', value: -30 }],
    any: [],
    action: { type: 'ALERT', severity: 'WARNING' },
    cooldown_hours: 48,
    enabled: true,
    diagnosis: {
      causes: ['Orçamento menor no período.', 'Queda de conversão.', 'Fadiga criativa.'],
      recommendation: 'Comparar gasto, CTR e conversão da página entre os dois períodos.',
      risk: 'Pode ser efeito do atraso da atribuição nos dias mais recentes.',
    },
  },
];

const STRATEGY_PRESETS: Record<Strategy, { scalePct: number; cpaTolerance: number; interval: number; maxChange: number }> = {
  CONSERVATIVE: { scalePct: 10, cpaTolerance: 1.3, interval: 180, maxChange: 10 },
  BALANCED: { scalePct: 15, cpaTolerance: 1.25, interval: 180, maxChange: 15 },
  AGGRESSIVE: { scalePct: 20, cpaTolerance: 1.2, interval: 60, maxChange: 20 },
};

/** Regras e limites iniciais de cada estratégia. São pontos de partida, não garantias. */
export function strategyDefaults(strategy: Strategy) {
  const preset = STRATEGY_PRESETS[strategy];
  const rules = DEFAULT_RULES.map((rule): RuleDefinition => {
    const copy: RuleDefinition = JSON.parse(JSON.stringify(rule));
    if (copy.key === 'R03_SCALE_VERTICAL') copy.action.pct = preset.scalePct;
    if (copy.key === 'R02_CPA_ABOVE_TARGET') {
      copy.all[0].value = preset.cpaTolerance;
      copy.description = `Custo por resultado ${Math.round((preset.cpaTolerance - 1) * 100)}% acima da meta e piorando em relação ao período anterior.`;
    }
    return copy;
  });
  return { rules, evaluationIntervalMinutes: preset.interval, maxBudgetChangePct: preset.maxChange };
}

export function diagnosisFor(rule: Pick<RuleDefinition, 'diagnosis'> | null | undefined): RuleDiagnosis {
  return rule?.diagnosis ?? GENERIC_DIAGNOSIS;
}

// ── Validação (nada de expressão executável vinda do usuário) ────────────────

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isMetric = (value: unknown): value is Metric => typeof value === 'string' && value in METRICS;
const isOperator = (value: unknown): value is Operator => typeof value === 'string' && value in OPERATORS;
const ACTION_TYPES: readonly ActionType[] = ['ALERT', 'PAUSE', 'BUDGET_INCREASE', 'BUDGET_DECREASE'];
const SEVERITIES: readonly Severity[] = ['INFO', 'WARNING', 'CRITICAL'];
const MINIMUM_KEYS: readonly (keyof RuleMinimums)[] = ['results', 'previous_results', 'spend_multiplier_of_target', 'impressions', 'link_clicks', 'age_hours'];

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function validateCondition(raw: unknown, path: string, errors: string[]): RuleCondition | null {
  if (!raw || typeof raw !== 'object') {
    errors.push(`${path}: condição inválida.`);
    return null;
  }
  const input = raw as Record<string, unknown>;
  if (!isMetric(input.metric)) {
    errors.push(`${path}: métrica desconhecida.`);
    return null;
  }
  if (!isOperator(input.operator)) {
    errors.push(`${path}: operador desconhecido.`);
    return null;
  }
  const condition: RuleCondition = { metric: input.metric, operator: input.operator };
  if (input.value_ref !== undefined) {
    if (input.value_ref !== 'target_cpa' || METRICS[input.metric].unit !== 'money' || input.operator === 'between' || input.operator.startsWith('pct_change')) {
      errors.push(`${path}: referência permitida só para métricas em dinheiro comparadas com a meta.`);
      return null;
    }
    const multiplier = input.multiplier ?? 1;
    if (!isNumber(multiplier) || multiplier <= 0 || multiplier > 100) {
      errors.push(`${path}: multiplicador inválido.`);
      return null;
    }
    condition.value_ref = 'target_cpa';
    condition.multiplier = multiplier;
    return condition;
  }
  if (input.operator === 'between') {
    const value = input.value;
    if (!Array.isArray(value) || value.length !== 2 || !isNumber(value[0]) || !isNumber(value[1]) || value[0] > value[1]) {
      errors.push(`${path}: "entre" precisa de dois números em ordem.`);
      return null;
    }
    condition.value = [value[0], value[1]];
    return condition;
  }
  if (!isNumber(input.value) || Math.abs(input.value) > 1e12) {
    errors.push(`${path}: valor numérico inválido.`);
    return null;
  }
  condition.value = input.value;
  return condition;
}

export function validateRule(raw: unknown): { ok: true; rule: RuleDefinition } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Regra inválida.'] };
  const input = raw as Record<string, unknown>;
  const key = typeof input.key === 'string' && /^[A-Z0-9_]{2,40}$/.test(input.key) ? input.key : null;
  if (!key) errors.push('Código da regra inválido (use letras maiúsculas, números e _).');
  const name = cleanText(input.name, 120);
  if (!name) errors.push(`${key ?? 'Regra'}: nome obrigatório (até 120 caracteres).`);
  const label = key ?? 'Regra';
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 400) : '';
  const scope = input.scope === 'CAMPAIGN' || input.scope === 'ADSET' ? input.scope : null;
  if (!scope) errors.push(`${label}: nível deve ser campanha ou conjunto.`);
  const priority = isNumber(input.priority) && Number.isInteger(input.priority) && input.priority >= 0 && input.priority <= 100 ? input.priority : null;
  if (priority === null) errors.push(`${label}: prioridade entre 0 e 100.`);

  const minimums: RuleMinimums = {};
  const rawMinimums = (input.minimums ?? {}) as Record<string, unknown>;
  if (typeof rawMinimums !== 'object' || Array.isArray(rawMinimums)) errors.push(`${label}: mínimos inválidos.`);
  else {
    for (const [field, value] of Object.entries(rawMinimums)) {
      if (!MINIMUM_KEYS.includes(field as keyof RuleMinimums)) errors.push(`${label}: mínimo desconhecido "${field}".`);
      else if (value !== undefined && value !== null) {
        if (!isNumber(value) || value < 0 || value > 1e9) errors.push(`${label}: mínimo "${field}" inválido.`);
        else minimums[field as keyof RuleMinimums] = value;
      }
    }
  }

  const all = Array.isArray(input.all) ? input.all : [];
  const any = Array.isArray(input.any) ? input.any : [];
  if (all.length + any.length === 0) errors.push(`${label}: pelo menos uma condição.`);
  if (all.length + any.length > 10) errors.push(`${label}: no máximo 10 condições.`);
  const allConditions = all.map((condition, index) => validateCondition(condition, `${label} condição ${index + 1}`, errors));
  const anyConditions = any.map((condition, index) => validateCondition(condition, `${label} condição alternativa ${index + 1}`, errors));

  const rawAction = (input.action ?? {}) as Record<string, unknown>;
  const actionType = ACTION_TYPES.includes(rawAction.type as ActionType) ? (rawAction.type as ActionType) : null;
  if (!actionType) errors.push(`${label}: ação desconhecida.`);
  const severity = SEVERITIES.includes(rawAction.severity as Severity) ? (rawAction.severity as Severity) : 'INFO';
  const action: RuleAction = { type: actionType ?? 'ALERT', severity };
  if (actionType === 'BUDGET_INCREASE' || actionType === 'BUDGET_DECREASE') {
    if (!isNumber(rawAction.pct) || rawAction.pct < 1 || rawAction.pct > 50) errors.push(`${label}: percentual de orçamento entre 1 e 50.`);
    else action.pct = Math.round(rawAction.pct);
  }

  const cooldown = input.cooldown_hours ?? 48;
  if (!isNumber(cooldown) || cooldown < 1 || cooldown > 720) errors.push(`${label}: cooldown entre 1 e 720 horas.`);

  const rawDiagnosis = (input.diagnosis ?? null) as Record<string, unknown> | null;
  const diagnosis: RuleDiagnosis = rawDiagnosis && typeof rawDiagnosis === 'object'
    ? {
        causes: Array.isArray(rawDiagnosis.causes) ? rawDiagnosis.causes.filter((cause): cause is string => typeof cause === 'string').map((cause) => cause.slice(0, 200)).slice(0, 6) : [],
        recommendation: typeof rawDiagnosis.recommendation === 'string' ? rawDiagnosis.recommendation.slice(0, 400) : GENERIC_DIAGNOSIS.recommendation,
        risk: typeof rawDiagnosis.risk === 'string' ? rawDiagnosis.risk.slice(0, 400) : GENERIC_DIAGNOSIS.risk,
      }
    : GENERIC_DIAGNOSIS;

  if (errors.length > 0 || !key || !name || !scope || priority === null || !actionType) return { ok: false, errors };
  return {
    ok: true,
    rule: {
      key,
      name,
      description,
      scope,
      priority,
      minimums,
      all: allConditions.filter((condition): condition is RuleCondition => condition !== null),
      any: anyConditions.filter((condition): condition is RuleCondition => condition !== null),
      action,
      cooldown_hours: Math.round(cooldown as number),
      enabled: input.enabled !== false,
      diagnosis,
    },
  };
}

// ── Avaliação ────────────────────────────────────────────────────────────────

export type BudgetInfo = {
  /** Quem controla o gasto: a campanha (CBO) ou o conjunto (ABO). */
  owner: ResourceLevel | null;
  field: 'daily_budget' | 'lifetime_budget' | null;
  cents: number | null;
};

export type ResourceSnapshot = {
  level: ResourceLevel;
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  effectiveStatus: string;
  createdTime: string | null;
  budget: BudgetInfo;
  current: Totals;
  previous: Totals;
};

export type ProfileSettings = {
  id: string;
  mode: Mode;
  enabled: boolean;
  emergencyStop: boolean;
  targetCpaCents: number;
  currency: string;
  maxDailyBudgetCents: number | null;
  minDailyBudgetCents: number;
  maxBudgetChangePct: number;
  cooldownHours: number;
  maturityHours: number;
  maxActionsPerDay: number;
};

export type HistoryEntry = {
  resourceId: string;
  actionType: ActionType;
  status: ActionStatus;
  createdAt: string;
  executedAt: string | null;
};

export type ConditionResult = {
  metric: Metric;
  operator: Operator;
  expected: number | [number, number];
  /** Valor comparado: a métrica, ou a variação % nos operadores de variação. */
  compared: number | null;
  current: number | null;
  previous: number | null;
  pass: boolean | null;
};

export type ProposalPayload =
  | { kind: 'none' }
  | { kind: 'status'; from: string; to: 'PAUSED' }
  | { kind: 'budget'; field: 'daily_budget'; fromCents: number; toCents: number; pct: number };

export type Proposal = {
  ruleKey: string;
  ruleName: string;
  rulePriority: number;
  level: ResourceLevel | 'ACCOUNT';
  resourceId: string;
  resourceName: string;
  campaignId: string | null;
  actionType: ActionType;
  severity: Severity;
  title: string;
  reason: string;
  risk: string;
  diagnosis: RuleDiagnosis;
  payload: ProposalPayload;
  idempotencyKey: string;
  evidence: {
    conditions: ConditionResult[];
    current: Partial<MetricValues>;
    previous: Partial<MetricValues>;
    notes: string[];
  };
};

export type Decision = 'PROPOSED' | 'ALERT' | 'BLOCKED' | 'INSUFFICIENT_DATA' | 'NO_MATCH';

export type Evaluation = {
  ruleKey: string;
  ruleName: string;
  level: ResourceLevel;
  resourceId: string;
  resourceName: string;
  decision: Decision;
  reasons: string[];
  conditions: ConditionResult[];
  proposal?: Proposal;
};

export type EvaluationInput = {
  profile: ProfileSettings;
  rules: RuleDefinition[];
  resources: ResourceSnapshot[];
  history: HistoryEntry[];
  now: Date;
  /** Identifica o ciclo (ex.: último dia da janela) para não repetir a mesma proposta. */
  windowKey: string;
  /** Soma dos orçamentos diários ativos no escopo; `null` se não foi possível calcular. */
  activeDailyBudgetCents: number | null;
};

export type EvaluationOutput = { evaluations: Evaluation[]; proposals: Proposal[] };

const EVIDENCE_METRICS: Metric[] = ['spend', 'results', 'cpa', 'ctr', 'cpm', 'cpc', 'frequency', 'impressions', 'link_clicks', 'roas'];
const HOUR = 3_600_000;

function pick(values: MetricValues): Partial<MetricValues> {
  const out: Partial<MetricValues> = {};
  for (const metric of EVIDENCE_METRICS) out[metric] = values[metric];
  return out;
}

function expectedOf(condition: RuleCondition, targetCpaCents: number): number | [number, number] {
  if (condition.value_ref === 'target_cpa') return targetCpaCents * (condition.multiplier ?? 1);
  return condition.value ?? 0;
}

export function checkCondition(condition: RuleCondition, current: MetricValues, previous: MetricValues, targetCpaCents: number): ConditionResult {
  const expected = expectedOf(condition, targetCpaCents);
  const now = current[condition.metric];
  const before = previous[condition.metric];
  const base = { metric: condition.metric, operator: condition.operator, expected, current: now, previous: before };
  if (condition.operator === 'pct_change_gt' || condition.operator === 'pct_change_lt') {
    const change = pctChange(now, before);
    const limit = expected as number;
    const pass = change === null ? null : condition.operator === 'pct_change_gt' ? change > limit : change < limit;
    return { ...base, compared: change, pass };
  }
  if (now === null) return { ...base, compared: null, pass: null };
  let pass: boolean;
  switch (condition.operator) {
    case 'eq': pass = Math.abs(now - (expected as number)) < 1e-9; break;
    case 'neq': pass = Math.abs(now - (expected as number)) >= 1e-9; break;
    case 'gt': pass = now > (expected as number); break;
    case 'gte': pass = now >= (expected as number); break;
    case 'lt': pass = now < (expected as number); break;
    case 'lte': pass = now <= (expected as number); break;
    case 'between': pass = now >= (expected as [number, number])[0] && now <= (expected as [number, number])[1]; break;
    default: pass = false;
  }
  return { ...base, compared: now, pass };
}

function missingMinimums(minimums: RuleMinimums, resource: ResourceSnapshot, targetCpaCents: number, ageHours: number | null, currency: string): string[] {
  const missing: string[] = [];
  const { current, previous } = resource;
  if (minimums.results !== undefined && current.results < minimums.results) missing.push(`Resultados ${current.results} abaixo do mínimo de ${minimums.results}`);
  if (minimums.previous_results !== undefined && previous.results < minimums.previous_results) missing.push(`Resultados do período anterior ${previous.results} abaixo do mínimo de ${minimums.previous_results}`);
  if (minimums.spend_multiplier_of_target !== undefined) {
    const needed = targetCpaCents * minimums.spend_multiplier_of_target;
    if (current.spendCents < needed) missing.push(`Gasto ${formatMoney(current.spendCents, currency)} abaixo do mínimo de ${formatMoney(needed, currency)}`);
  }
  if (minimums.impressions !== undefined && current.impressions < minimums.impressions) missing.push(`Impressões ${current.impressions.toLocaleString('pt-BR')} abaixo do mínimo de ${minimums.impressions.toLocaleString('pt-BR')}`);
  if (minimums.link_clicks !== undefined && current.linkClicks < minimums.link_clicks) missing.push(`Cliques ${current.linkClicks} abaixo do mínimo de ${minimums.link_clicks}`);
  if (minimums.age_hours !== undefined && (ageHours === null || ageHours < minimums.age_hours)) missing.push(`Idade abaixo de ${minimums.age_hours}h`);
  return missing;
}

export function describeCondition(result: ConditionResult, currency: string): string {
  const label = METRICS[result.metric].label;
  if (result.operator === 'pct_change_gt' || result.operator === 'pct_change_lt') {
    if (result.compared === null) return `${label}: sem base de comparação`;
    return `${label} variou ${formatPct(result.compared)} (de ${formatMetric(result.metric, result.previous, currency)} para ${formatMetric(result.metric, result.current, currency)})`;
  }
  const expected = Array.isArray(result.expected)
    ? `${formatMetric(result.metric, result.expected[0], currency)} e ${formatMetric(result.metric, result.expected[1], currency)}`
    : formatMetric(result.metric, result.expected, currency);
  return `${label} ${formatMetric(result.metric, result.current, currency)} (${OPERATORS[result.operator]} ${expected})`;
}

function actionTitle(type: ActionType, level: ResourceLevel | 'ACCOUNT', pct: number | null, ruleName: string) {
  const target = level === 'CAMPAIGN' ? 'a campanha' : 'o conjunto';
  if (type === 'PAUSE') return `Pausar ${target}`;
  if (type === 'BUDGET_INCREASE') return `Aumentar orçamento em ${pct ?? 0}%`;
  if (type === 'BUDGET_DECREASE') return `Reduzir orçamento em ${pct ?? 0}%`;
  return ruleName;
}

function lastChangeAt(history: HistoryEntry[], resourceId: string): number | null {
  let latest: number | null = null;
  for (const entry of history) {
    if (entry.resourceId !== resourceId || entry.status !== 'EXECUTED' || !entry.executedAt) continue;
    const time = Date.parse(entry.executedAt);
    if (Number.isFinite(time) && (latest === null || time > latest)) latest = time;
  }
  return latest;
}

export function executedInLast24h(history: HistoryEntry[], now: Date): number {
  return history.filter((entry) => entry.status === 'EXECUTED' && entry.executedAt && now.getTime() - Date.parse(entry.executedAt) < 24 * HOUR).length;
}

type WritePlan = { payload: ProposalPayload; blocks: string[] };

/** Calcula a escrita pedida pela regra e os bloqueios específicos dela (orçamento, status). */
function planWrite(rule: RuleDefinition, resource: ResourceSnapshot, input: EvaluationInput, overBudget: boolean): WritePlan {
  const { profile, activeDailyBudgetCents } = input;
  if (rule.action.type === 'PAUSE') {
    return { payload: { kind: 'status', from: resource.effectiveStatus, to: 'PAUSED' }, blocks: [] };
  }
  const blocks: string[] = [];
  const { budget } = resource;
  if (!BUDGET_CURRENCIES.includes(profile.currency)) blocks.push(`Moeda ${profile.currency} ainda não suportada para ações de orçamento`);
  if (budget.owner !== resource.level) {
    blocks.push(resource.level === 'ADSET'
      ? 'O orçamento é controlado pela campanha (CBO); não se altera orçamento no conjunto'
      : 'O orçamento está nos conjuntos (ABO); não se altera orçamento na campanha');
  } else if (budget.field !== 'daily_budget' || !budget.cents) {
    blocks.push('Só orçamentos diários podem ser alterados; este usa orçamento vitalício');
  }
  const fromCents = budget.cents ?? 0;
  const requested = Math.min(rule.action.pct ?? 10, profile.maxBudgetChangePct);
  let toCents = fromCents;
  if (rule.action.type === 'BUDGET_INCREASE') {
    toCents = Math.round(fromCents * (1 + requested / 100));
    if (overBudget) blocks.push('O orçamento diário ativo já está acima do teto do perfil');
    else if (profile.maxDailyBudgetCents !== null) {
      if (activeDailyBudgetCents === null) blocks.push('Não foi possível calcular o orçamento diário ativo');
      else if (activeDailyBudgetCents + (toCents - fromCents) > profile.maxDailyBudgetCents) {
        blocks.push(`O aumento passaria o teto diário de ${formatMoney(profile.maxDailyBudgetCents, profile.currency)}`);
      }
    }
  } else {
    if (fromCents <= profile.minDailyBudgetCents) blocks.push(`O orçamento já está no mínimo configurado (${formatMoney(profile.minDailyBudgetCents, profile.currency)})`);
    toCents = Math.max(profile.minDailyBudgetCents, Math.round(fromCents * (1 - requested / 100)));
  }
  const pct = fromCents > 0 ? Math.round((Math.abs(toCents - fromCents) / fromCents) * 100) : requested;
  return { payload: { kind: 'budget', field: 'daily_budget', fromCents, toCents, pct }, blocks };
}

function accountAlert(input: EvaluationInput, key: string, name: string, reason: string, severity: Severity, diagnosis: RuleDiagnosis): Proposal {
  return {
    ruleKey: key,
    ruleName: name,
    rulePriority: 100,
    level: 'ACCOUNT',
    resourceId: input.profile.id,
    resourceName: 'Escopo do perfil',
    campaignId: null,
    actionType: 'ALERT',
    severity,
    title: name,
    reason,
    risk: diagnosis.risk,
    diagnosis,
    payload: { kind: 'none' },
    idempotencyKey: `${input.profile.id}:${key}:account:ALERT:${input.windowKey}`,
    evidence: { conditions: [], current: {}, previous: {}, notes: [] },
  };
}

/**
 * Avalia todas as regras ligadas sobre os recursos do escopo e devolve as
 * propostas finais (já com conflitos resolvidos) e a prova de cada avaliação.
 */
export function evaluateProfile(input: EvaluationInput): EvaluationOutput {
  const { profile, now } = input;
  const evaluations: Evaluation[] = [];
  const alerts: Proposal[] = [];
  const writes: Proposal[] = [];
  if (profile.mode === 'PAUSED') return { evaluations, proposals: [] };

  // R12 — rastreamento: cliques continuam e o evento parou. Bloqueia escritas da campanha.
  const brokenTracking = new Set<string>();
  for (const campaign of input.resources) {
    if (campaign.level !== 'CAMPAIGN') continue;
    if (campaign.current.linkClicks >= 50 && campaign.current.results === 0 && campaign.previous.results >= 5) {
      brokenTracking.add(campaign.id);
      alerts.push({
        ruleKey: 'R12_TRACKING',
        ruleName: 'Possível falha de rastreamento',
        rulePriority: 100,
        level: 'CAMPAIGN',
        resourceId: campaign.id,
        resourceName: campaign.name,
        campaignId: campaign.id,
        actionType: 'ALERT',
        severity: 'CRITICAL',
        title: 'Possível falha de rastreamento',
        reason: `${campaign.current.linkClicks} cliques no link e nenhum resultado no período; no período anterior foram ${campaign.previous.results}.`,
        risk: 'Decisões baseadas em custo por resultado ficam suspensas nesta campanha até a revisão.',
        diagnosis: {
          causes: ['Pixel ou API de conversões parou de enviar o evento.', 'Formulário ou página fora do ar.', 'Evento renomeado.'],
          recommendation: 'Testar o evento no Gerenciador de Eventos e a página de destino.',
          risk: 'Pausar ou reduzir agora puniria uma campanha que pode estar convertendo.',
        },
        payload: { kind: 'none' },
        idempotencyKey: `${profile.id}:R12_TRACKING:${campaign.id}:ALERT:${input.windowKey}`,
        evidence: { conditions: [], current: {}, previous: {}, notes: [] },
      });
    }
  }

  // R08 — teto de orçamento do perfil.
  const overBudget = profile.maxDailyBudgetCents !== null && input.activeDailyBudgetCents !== null && input.activeDailyBudgetCents > profile.maxDailyBudgetCents;
  if (overBudget) {
    alerts.push(accountAlert(
      input,
      'R08_BUDGET_CAP',
      'Orçamento acima do teto',
      `Orçamento diário ativo de ${formatMoney(input.activeDailyBudgetCents, profile.currency)} passa o teto de ${formatMoney(profile.maxDailyBudgetCents, profile.currency)}. Aumentos ficam bloqueados.`,
      'CRITICAL',
      { causes: ['Orçamentos aumentados fora do perfil.', 'Novas campanhas no escopo.'], recommendation: 'Revisar os orçamentos ou o teto do perfil.', risk: 'O gasto mensal pode passar do combinado com o cliente.' },
    ));
  }

  const executed24h = executedInLast24h(input.history, now);
  const openResources = new Set(input.history.filter((entry) => entry.actionType !== 'ALERT' && OPEN_STATUSES.includes(entry.status)).map((entry) => entry.resourceId));
  const rules = input.rules.filter((rule) => rule.enabled).sort((a, b) => b.priority - a.priority);

  for (const rule of rules) {
    for (const resource of input.resources) {
      if (resource.level !== rule.scope) continue;
      const ageHours = hoursSince(resource.createdTime, now);
      const current = metricsOf(resource.current, profile.targetCpaCents, ageHours);
      const previous = metricsOf(resource.previous, profile.targetCpaCents, null);
      const evaluation: Evaluation = {
        ruleKey: rule.key,
        ruleName: rule.name,
        level: resource.level,
        resourceId: resource.id,
        resourceName: resource.name,
        decision: 'NO_MATCH',
        reasons: [],
        conditions: [],
      };
      evaluations.push(evaluation);

      const missing = missingMinimums(rule.minimums, resource, profile.targetCpaCents, ageHours, profile.currency);
      if (missing.length > 0) {
        evaluation.decision = 'INSUFFICIENT_DATA';
        evaluation.reasons = missing;
        continue;
      }

      const allResults = rule.all.map((condition) => checkCondition(condition, current, previous, profile.targetCpaCents));
      const anyResults = rule.any.map((condition) => checkCondition(condition, current, previous, profile.targetCpaCents));
      evaluation.conditions = [...allResults, ...anyResults];
      const allPass = allResults.every((result) => result.pass === true);
      const anyPass = anyResults.length === 0 || anyResults.some((result) => result.pass === true);
      if (!allPass || !anyPass) {
        const unknown = allResults.some((result) => result.pass === null) || (!anyPass && anyResults.some((result) => result.pass === null));
        const failed = allResults.some((result) => result.pass === false) || (!anyPass && anyResults.every((result) => result.pass === false));
        if (unknown && !failed) {
          evaluation.decision = 'INSUFFICIENT_DATA';
          evaluation.reasons = ['Sem base de comparação no período anterior'];
        }
        continue;
      }

      const isWrite = rule.action.type !== 'ALERT';
      const plan = isWrite ? planWrite(rule, resource, input, overBudget) : { payload: { kind: 'none' } as ProposalPayload, blocks: [] };
      const pct = plan.payload.kind === 'budget' ? plan.payload.pct : null;
      const proposal: Proposal = {
        ruleKey: rule.key,
        ruleName: rule.name,
        rulePriority: rule.priority,
        level: resource.level,
        resourceId: resource.id,
        resourceName: resource.name,
        campaignId: resource.campaignId,
        actionType: rule.action.type,
        severity: rule.action.severity,
        title: actionTitle(rule.action.type, resource.level, pct, rule.name),
        reason: evaluation.conditions.map((result) => describeCondition(result, profile.currency)).join('; '),
        risk: rule.diagnosis.risk,
        diagnosis: rule.diagnosis,
        payload: plan.payload,
        idempotencyKey: `${profile.id}:${rule.key}:${resource.id}:${rule.action.type}:${input.windowKey}`,
        evidence: { conditions: evaluation.conditions, current: pick(current), previous: pick(previous), notes: [] },
      };
      evaluation.proposal = proposal;

      if (!isWrite) {
        evaluation.decision = 'ALERT';
        alerts.push(proposal);
        continue;
      }

      const blocks = [...plan.blocks];
      if (profile.emergencyStop) blocks.unshift('Parada de emergência ativa');
      if (brokenTracking.has(resource.campaignId)) blocks.push('Rastreamento suspeito na campanha: ações baseadas em resultado suspensas');
      if (resource.effectiveStatus !== 'ACTIVE') blocks.push(`O recurso não está ativo (${resource.effectiveStatus})`);
      if (ageHours === null) blocks.push('Data de criação desconhecida');
      else if (ageHours < profile.maturityHours) blocks.push(`Em maturação: ${Math.floor(ageHours)}h de ${profile.maturityHours}h mínimas`);
      const lastChange = lastChangeAt(input.history, resource.id);
      const cooldown = Math.max(profile.cooldownHours, rule.cooldown_hours);
      if (lastChange !== null && now.getTime() - lastChange < cooldown * HOUR) {
        blocks.push(`Em cooldown: última alteração há ${Math.floor((now.getTime() - lastChange) / HOUR)}h (mínimo ${cooldown}h)`);
      }
      if (openResources.has(resource.id)) blocks.push('Já existe uma proposta aberta para este recurso');
      if (executed24h >= profile.maxActionsPerDay) blocks.push(`Limite de ${profile.maxActionsPerDay} alterações em 24h atingido`);

      if (blocks.length > 0) {
        evaluation.decision = 'BLOCKED';
        evaluation.reasons = blocks;
        // Stop loss bloqueado ainda merece a atenção de alguém.
        if (rule.action.severity === 'CRITICAL') {
          alerts.push({
            ...proposal,
            actionType: 'ALERT',
            title: `${rule.name} (não executável)`,
            payload: { kind: 'none' },
            idempotencyKey: `${profile.id}:${rule.key}:${resource.id}:ALERT:${input.windowKey}`,
            evidence: { ...proposal.evidence, notes: blocks },
          });
        }
        continue;
      }
      evaluation.decision = 'PROPOSED';
      writes.push(proposal);
    }
  }

  const kept = resolveConflicts(writes, evaluations, alerts, input);
  const seen = new Set<string>();
  const proposals = [...alerts, ...kept].filter((proposal) => {
    if (seen.has(proposal.idempotencyKey)) return false;
    seen.add(proposal.idempotencyKey);
    return true;
  });
  return { evaluations, proposals };
}

const DOWN: readonly ActionType[] = ['PAUSE', 'BUDGET_DECREASE'];

function blockEvaluation(evaluations: Evaluation[], proposal: Proposal, reason: string) {
  const evaluation = evaluations.find((item) => item.proposal?.idempotencyKey === proposal.idempotencyKey);
  if (evaluation) {
    evaluation.decision = 'BLOCKED';
    evaluation.reasons = [...evaluation.reasons, reason];
  }
}

/**
 * Prioridade: pausa > redução > escala. Escala e pausa/redução no mesmo
 * recurso se bloqueiam e viram um alerta de conflito para revisão humana.
 */
function resolveConflicts(writes: Proposal[], evaluations: Evaluation[], alerts: Proposal[], input: EvaluationInput): Proposal[] {
  const byResource = new Map<string, Proposal[]>();
  for (const proposal of writes) byResource.set(proposal.resourceId, [...(byResource.get(proposal.resourceId) ?? []), proposal]);

  const kept: Proposal[] = [];
  for (const [resourceId, group] of byResource) {
    const down = group.filter((proposal) => DOWN.includes(proposal.actionType));
    const up = group.filter((proposal) => proposal.actionType === 'BUDGET_INCREASE');
    if (down.length > 0 && up.length > 0) {
      for (const proposal of group) blockEvaluation(evaluations, proposal, 'Conflito de regras: escala e redução no mesmo recurso');
      const first = group[0];
      alerts.push({
        ...first,
        ruleKey: 'R11_CONFLICT',
        ruleName: 'Conflito de regras',
        actionType: 'ALERT',
        severity: 'WARNING',
        title: 'Conflito de regras',
        reason: `As regras ${group.map((proposal) => proposal.ruleName).join(', ')} pediram ações opostas. Nenhuma será proposta.`,
        risk: 'Revise as condições das regras para não se contradizerem.',
        payload: { kind: 'none' },
        idempotencyKey: `${input.profile.id}:R11_CONFLICT:${resourceId}:ALERT:${input.windowKey}`,
      });
      continue;
    }
    const candidates = down.length > 0 ? down : up;
    const sorted = [...candidates].sort((a, b) => {
      if (a.actionType !== b.actionType) return a.actionType === 'PAUSE' ? -1 : b.actionType === 'PAUSE' ? 1 : 0;
      return b.rulePriority - a.rulePriority;
    });
    kept.push(sorted[0]);
    for (const proposal of sorted.slice(1)) blockEvaluation(evaluations, proposal, `Substituída pela regra ${sorted[0].ruleName}`);
  }

  // Campanha com pausa ou redução: nenhum conjunto dela escala no mesmo ciclo.
  const campaignsGoingDown = new Set(kept.filter((proposal) => proposal.level === 'CAMPAIGN' && DOWN.includes(proposal.actionType)).map((proposal) => proposal.resourceId));
  return kept.filter((proposal) => {
    if (proposal.level === 'ADSET' && proposal.actionType === 'BUDGET_INCREASE' && proposal.campaignId && campaignsGoingDown.has(proposal.campaignId)) {
      blockEvaluation(evaluations, proposal, 'A campanha deste conjunto tem proposta de pausa ou redução');
      return false;
    }
    return true;
  });
}

// ── Conferência antes de escrever na Meta ────────────────────────────────────

export type CurrentResourceState = {
  accountId: string;
  status: string;
  effectiveStatus: string;
  dailyBudgetCents: number | null;
};

export type ExecutionCheckInput = {
  actionType: ActionType;
  payload: ProposalPayload;
  resourceId: string;
  expiresAt: string | null;
  profile: ProfileSettings;
  profileAccountId: string;
  current: CurrentResourceState;
  /** Histórico do perfil sem a própria ação. */
  history: HistoryEntry[];
  activeDailyBudgetCents: number | null;
  ruleCooldownHours: number;
  now: Date;
};

/** Revalida tudo no momento do envio. Lista vazia = pode escrever. */
export function checkExecution(input: ExecutionCheckInput): string[] {
  const { profile, current, payload, now } = input;
  const reasons: string[] = [];
  if (input.actionType === 'ALERT' || payload.kind === 'none') return ['Alertas não executam nada na Meta'];
  if (!profile.enabled) reasons.push('O perfil está desativado');
  if (profile.emergencyStop) reasons.push('Parada de emergência ativa');
  if (profile.mode !== 'APPROVAL' && profile.mode !== 'AUTO_LIMITED') reasons.push(`O perfil está em "${MODE_LABEL[profile.mode]}": execução não permitida`);
  if (input.expiresAt && Date.parse(input.expiresAt) <= now.getTime()) reasons.push('A proposta expirou');
  if (current.accountId.replace(/^act_/, '') !== input.profileAccountId.replace(/^act_/, '')) reasons.push('O recurso não pertence à conta do perfil');
  if (current.effectiveStatus !== 'ACTIVE') reasons.push(`O recurso não está mais ativo (${current.effectiveStatus})`);

  if (payload.kind === 'status' && current.status !== 'ACTIVE') reasons.push('O status mudou fora do sistema desde a proposta');
  if (payload.kind === 'budget') {
    if (current.dailyBudgetCents !== payload.fromCents) {
      reasons.push(`O orçamento mudou fora do sistema desde a proposta (era ${formatMoney(payload.fromCents, profile.currency)}, agora ${formatMoney(current.dailyBudgetCents, profile.currency)})`);
    }
    if (input.actionType === 'BUDGET_INCREASE' && profile.maxDailyBudgetCents !== null) {
      if (input.activeDailyBudgetCents === null) reasons.push('Não foi possível conferir o teto diário');
      else if (input.activeDailyBudgetCents + (payload.toCents - payload.fromCents) > profile.maxDailyBudgetCents) {
        reasons.push(`O aumento passaria o teto diário de ${formatMoney(profile.maxDailyBudgetCents, profile.currency)}`);
      }
    }
    if (input.actionType === 'BUDGET_DECREASE' && payload.toCents < profile.minDailyBudgetCents) reasons.push('O novo orçamento fica abaixo do mínimo do perfil');
  }

  const lastChange = lastChangeAt(input.history, input.resourceId);
  const cooldown = Math.max(profile.cooldownHours, input.ruleCooldownHours);
  if (lastChange !== null && now.getTime() - lastChange < cooldown * HOUR) reasons.push(`Em cooldown: houve alteração há ${Math.floor((now.getTime() - lastChange) / HOUR)}h`);
  if (executedInLast24h(input.history, now) >= profile.maxActionsPerDay) reasons.push(`Limite de ${profile.maxActionsPerDay} alterações em 24h atingido`);
  return reasons;
}
