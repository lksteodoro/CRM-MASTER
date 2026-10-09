import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES,
  EMPTY_TOTALS,
  checkExecution,
  evaluateProfile,
  evaluationWindow,
  metricsOf,
  strategyDefaults,
  totalsFromInsight,
  validateRule,
  type EvaluationInput,
  type ProfileSettings,
  type ResourceSnapshot,
  type RuleDefinition,
  type Totals,
} from '../supabase/functions/optimization-ia/engine.ts';

const NOW = new Date('2026-10-09T15:00:00Z');
const OLD = '2026-09-01T10:00:00-0300';

const profile = (patch: Partial<ProfileSettings> = {}): ProfileSettings => ({
  id: 'p1',
  mode: 'APPROVAL',
  enabled: true,
  emergencyStop: false,
  targetCpaCents: 2000,
  currency: 'BRL',
  maxDailyBudgetCents: null,
  minDailyBudgetCents: 1000,
  maxBudgetChangePct: 15,
  cooldownHours: 48,
  maturityHours: 72,
  maxActionsPerDay: 10,
  ...patch,
});

const totals = (patch: Partial<Totals>): Totals => ({ ...EMPTY_TOTALS, ...patch });

const adset = (patch: Partial<ResourceSnapshot> = {}): ResourceSnapshot => ({
  level: 'ADSET',
  id: '200',
  name: 'Conjunto A',
  campaignId: '100',
  campaignName: 'Campanha',
  effectiveStatus: 'ACTIVE',
  createdTime: OLD,
  budget: { owner: 'ADSET', field: 'daily_budget', cents: 10000 },
  current: totals({}),
  previous: totals({}),
  ...patch,
});

const input = (patch: Partial<EvaluationInput>): EvaluationInput => ({
  profile: profile(),
  rules: DEFAULT_RULES,
  resources: [],
  history: [],
  now: NOW,
  windowKey: '2026-10-08',
  activeDailyBudgetCents: 10000,
  ...patch,
});

const rule = (key: string) => DEFAULT_RULES.find((item) => item.key === key)!;

test('métricas com denominador zero ficam nulas', () => {
  const metrics = metricsOf(EMPTY_TOTALS, 2000, null);
  assert.equal(metrics.cpa, null);
  assert.equal(metrics.ctr, null);
  assert.equal(metrics.cpm, null);
  assert.equal(metrics.roas, null);
  assert.equal(metrics.spend_ratio, 0);
});

test('janela usa dias completos no fuso da conta', () => {
  // 02:00 UTC de 09/10 ainda é 08/10 em São Paulo.
  const window = evaluationWindow('America/Sao_Paulo', 7, new Date('2026-10-09T02:00:00Z'));
  assert.deepEqual(window.current, { since: '2026-10-01', until: '2026-10-07' });
  assert.deepEqual(window.previous, { since: '2026-09-24', until: '2026-09-30' });
});

test('insights contam só o evento escolhido no perfil', () => {
  const row = {
    spend: '65.40',
    impressions: '1000',
    inline_link_clicks: '20',
    actions: [{ action_type: 'lead', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' }],
  };
  assert.equal(totalsFromInsight(row, 'lead').results, 3);
  assert.equal(totalsFromInsight(row, 'offsite_conversion.fb_pixel_lead').results, 2);
  assert.equal(totalsFromInsight(row, 'purchase').results, 0);
  assert.equal(totalsFromInsight(row, 'lead').spendCents, 6540);
});

test('UC01: stop loss propõe pausa de conjunto maduro sem resultado', () => {
  const output = evaluateProfile(input({
    rules: [rule('R01_STOP_LOSS')],
    resources: [adset({ current: totals({ spendCents: 6500, results: 0, impressions: 4000 }) })],
  }));
  const pause = output.proposals.find((proposal) => proposal.actionType === 'PAUSE');
  assert.ok(pause);
  assert.deepEqual(pause.payload, { kind: 'status', from: 'ACTIVE', to: 'PAUSED' });
  assert.equal(pause.idempotencyKey, 'p1:R01_STOP_LOSS:200:PAUSE:2026-10-08');
});

test('stop loss em conjunto novo vira alerta, não pausa', () => {
  const output = evaluateProfile(input({
    rules: [rule('R01_STOP_LOSS')],
    resources: [adset({ createdTime: '2026-10-08T12:00:00Z', current: totals({ spendCents: 6500 }) })],
  }));
  assert.equal(output.proposals.some((proposal) => proposal.actionType === 'PAUSE'), false);
  const alert = output.proposals.find((proposal) => proposal.actionType === 'ALERT');
  assert.ok(alert);
  assert.match(alert.evidence.notes.join(' '), /maturação/);
});

test('UC02: escala no conjunto ABO e bloqueio quando o orçamento é da campanha (CBO)', () => {
  const winner = { current: totals({ spendCents: 40500, results: 30, impressions: 20000 }) };
  const abo = evaluateProfile(input({ rules: [rule('R03_SCALE_VERTICAL')], resources: [adset(winner)] }));
  const scale = abo.proposals.find((proposal) => proposal.actionType === 'BUDGET_INCREASE');
  assert.ok(scale);
  assert.deepEqual(scale.payload, { kind: 'budget', field: 'daily_budget', fromCents: 10000, toCents: 11500, pct: 15 });

  const cbo = evaluateProfile(input({
    rules: [rule('R03_SCALE_VERTICAL')],
    resources: [adset({ ...winner, budget: { owner: 'CAMPAIGN', field: 'daily_budget', cents: 50000 } })],
  }));
  assert.equal(cbo.proposals.length, 0);
  assert.match(cbo.evaluations[0].reasons.join(' '), /CBO/);
});

test('percentual de escala respeita o limite do perfil', () => {
  const output = evaluateProfile(input({
    profile: profile({ maxBudgetChangePct: 10 }),
    rules: [rule('R03_SCALE_VERTICAL')],
    resources: [adset({ current: totals({ spendCents: 40500, results: 30 }) })],
  }));
  const scale = output.proposals.find((proposal) => proposal.actionType === 'BUDGET_INCREASE');
  assert.ok(scale && scale.payload.kind === 'budget');
  assert.equal(scale.payload.toCents, 11000);
});

test('UC05: teto diário bloqueia escala e gera alerta', () => {
  const output = evaluateProfile(input({
    profile: profile({ maxDailyBudgetCents: 9000 }),
    rules: [rule('R03_SCALE_VERTICAL')],
    resources: [adset({ current: totals({ spendCents: 40500, results: 30 }) })],
  }));
  assert.equal(output.proposals.some((proposal) => proposal.actionType === 'BUDGET_INCREASE'), false);
  assert.ok(output.proposals.some((proposal) => proposal.ruleKey === 'R08_BUDGET_CAP'));
});

test('UC04: rastreamento suspeito bloqueia escritas da campanha', () => {
  const campaign: ResourceSnapshot = {
    ...adset(),
    level: 'CAMPAIGN',
    id: '100',
    name: 'Campanha',
    budget: { owner: 'ADSET', field: null, cents: null },
    current: totals({ spendCents: 9000, linkClicks: 120, results: 0 }),
    previous: totals({ spendCents: 9000, linkClicks: 110, results: 8 }),
  };
  const output = evaluateProfile(input({
    rules: [rule('R01_STOP_LOSS')],
    resources: [campaign, adset({ current: totals({ spendCents: 6500, results: 0 }) })],
  }));
  assert.ok(output.proposals.some((proposal) => proposal.ruleKey === 'R12_TRACKING'));
  assert.equal(output.proposals.some((proposal) => proposal.actionType === 'PAUSE'), false);
});

test('cooldown e proposta aberta impedem nova alteração', () => {
  const resources = [adset({ current: totals({ spendCents: 6500, results: 0 }) })];
  const recent = evaluateProfile(input({
    rules: [rule('R01_STOP_LOSS')],
    resources,
    history: [{ resourceId: '200', actionType: 'BUDGET_DECREASE', status: 'EXECUTED', createdAt: '2026-10-08T10:00:00Z', executedAt: '2026-10-08T10:00:00Z' }],
  }));
  assert.equal(recent.proposals.some((proposal) => proposal.actionType === 'PAUSE'), false);
  assert.match(recent.evaluations[0].reasons.join(' '), /cooldown/);

  const open = evaluateProfile(input({
    rules: [rule('R01_STOP_LOSS')],
    resources,
    history: [{ resourceId: '200', actionType: 'PAUSE', status: 'PENDING_APPROVAL', createdAt: '2026-10-09T10:00:00Z', executedAt: null }],
  }));
  assert.match(open.evaluations[0].reasons.join(' '), /proposta aberta/);
});

test('parada de emergência bloqueia escritas, mas mantém alertas', () => {
  const output = evaluateProfile(input({
    profile: profile({ emergencyStop: true }),
    rules: [rule('R01_STOP_LOSS'), rule('R04_CTR_DROP')],
    resources: [adset({
      current: totals({ spendCents: 6500, results: 0, impressions: 5000, linkClicks: 20 }),
      previous: totals({ spendCents: 6000, results: 0, impressions: 5000, linkClicks: 60 }),
    })],
  }));
  assert.equal(output.proposals.some((proposal) => proposal.actionType === 'PAUSE'), false);
  assert.ok(output.proposals.some((proposal) => proposal.ruleKey === 'R04_CTR_DROP'));
});

test('regras opostas no mesmo recurso se bloqueiam e geram alerta de conflito', () => {
  const always = (key: string, type: 'BUDGET_INCREASE' | 'BUDGET_DECREASE'): RuleDefinition => ({
    ...rule('R03_SCALE_VERTICAL'),
    key,
    name: key,
    minimums: {},
    all: [{ metric: 'results', operator: 'gte', value: 0 }],
    action: { type, pct: 10, severity: 'INFO' },
  });
  const output = evaluateProfile(input({
    rules: [always('SOBE', 'BUDGET_INCREASE'), always('DESCE', 'BUDGET_DECREASE')],
    resources: [adset({ current: totals({ spendCents: 1000 }) })],
  }));
  assert.equal(output.proposals.filter((proposal) => proposal.actionType !== 'ALERT').length, 0);
  assert.ok(output.proposals.some((proposal) => proposal.ruleKey === 'R11_CONFLICT'));
});

test('variação sem período anterior é dado insuficiente, não disparo', () => {
  const output = evaluateProfile(input({
    rules: [rule('R04_CTR_DROP')],
    resources: [adset({ current: totals({ impressions: 5000, linkClicks: 10 }) })],
  }));
  assert.equal(output.evaluations[0].decision, 'INSUFFICIENT_DATA');
  assert.equal(output.proposals.length, 0);
});

test('modo pausado não avalia nada', () => {
  const output = evaluateProfile(input({ profile: profile({ mode: 'PAUSED' }), resources: [adset({ current: totals({ spendCents: 6500 }) })] }));
  assert.equal(output.proposals.length, 0);
});

test('regras padrão passam na validação e entradas inválidas são recusadas', () => {
  for (const item of DEFAULT_RULES) assert.equal(validateRule(item).ok, true, item.key);
  const bad = validateRule({ ...rule('R03_SCALE_VERTICAL'), all: [{ metric: 'drop table', operator: 'gte', value: 1 }] });
  assert.equal(bad.ok, false);
  const badPct = validateRule({ ...rule('R03_SCALE_VERTICAL'), action: { type: 'BUDGET_INCREASE', pct: 90, severity: 'INFO' } });
  assert.equal(badPct.ok, false);
  const badRef = validateRule({ ...rule('R03_SCALE_VERTICAL'), all: [{ metric: 'ctr', operator: 'gte', value_ref: 'target_cpa' }] });
  assert.equal(badRef.ok, false);
});

test('estratégias mudam passo de escala e tolerância', () => {
  const conservative = strategyDefaults('CONSERVATIVE');
  assert.equal(conservative.rules.find((item) => item.key === 'R03_SCALE_VERTICAL')?.action.pct, 10);
  assert.equal(conservative.rules.find((item) => item.key === 'R02_CPA_ABOVE_TARGET')?.all[0].value, 1.3);
  assert.equal(DEFAULT_RULES.find((item) => item.key === 'R03_SCALE_VERTICAL')?.action.pct, 15);
  assert.equal(strategyDefaults('AGGRESSIVE').evaluationIntervalMinutes, 60);
});

test('conferência antes de escrever recusa mudança externa e modo observação', () => {
  const base = {
    actionType: 'BUDGET_INCREASE' as const,
    payload: { kind: 'budget' as const, field: 'daily_budget' as const, fromCents: 10000, toCents: 11500, pct: 15 },
    resourceId: '200',
    expiresAt: '2026-10-10T00:00:00Z',
    profile: profile(),
    profileAccountId: 'act_123',
    current: { accountId: '123', status: 'ACTIVE', effectiveStatus: 'ACTIVE', dailyBudgetCents: 10000 },
    history: [],
    activeDailyBudgetCents: 10000,
    ruleCooldownHours: 48,
    now: NOW,
  };
  assert.deepEqual(checkExecution(base), []);
  assert.match(checkExecution({ ...base, current: { ...base.current, dailyBudgetCents: 12000 } }).join(' '), /fora do sistema/);
  assert.match(checkExecution({ ...base, profile: profile({ mode: 'OBSERVE' }) }).join(' '), /execução não permitida/);
  assert.match(checkExecution({ ...base, current: { ...base.current, accountId: '999' } }).join(' '), /não pertence/);
  assert.match(checkExecution({ ...base, expiresAt: '2026-10-09T00:00:00Z' }).join(' '), /expirou/);
});
