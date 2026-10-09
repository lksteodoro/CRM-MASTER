import { useEffect, useMemo, useState } from 'react';
import { Archive, FlaskConical, Pencil, Play, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  optimizationApi,
  ruleFromRow,
  type AdAccountOption,
  type CampaignSummary,
  type OptimizationProfile,
  type OptimizationState,
  type ProfileDraft,
  type SimulationResult,
} from '../../services/optimization.service';
import {
  ACTION_TYPE_LABEL,
  DEFAULT_RULES,
  LEVEL_LABEL,
  METRICS,
  MODE_LABEL,
  OPERATORS,
  STRATEGY_LABEL,
  TARGET_EVENTS,
  formatMoney,
  strategyDefaults,
  type Mode,
  type RuleCondition,
  type RuleDefinition,
  type RuleMinimums,
  type Strategy,
} from '../../../supabase/functions/optimization-ia/engine.ts';
import { ErrorView, LoadingView } from '../ui/StateView';
import type { Notify } from './ActionsTab';
import { centsToInput, formatDate, inputToCents, plural, timeAgo } from './format';
import { Chip, EmptyState, Field, ModeChip, Panel, RunStatusChip, ghostButton, inputClass, primaryButton } from './shared';

const INTERVALS = [
  { value: 60, label: 'A cada 1 hora' },
  { value: 180, label: 'A cada 3 horas' },
  { value: 360, label: 'A cada 6 horas' },
  { value: 1440, label: 'Uma vez por dia' },
];
const LOOKBACKS = [3, 7, 14, 30];
const MINIMUM_LABEL: Record<keyof RuleMinimums, string> = {
  results: 'Resultados mínimos',
  previous_results: 'Resultados mínimos no período anterior',
  spend_multiplier_of_target: 'Gasto mínimo (× meta de custo)',
  impressions: 'Impressões mínimas',
  link_clicks: 'Cliques mínimos',
  age_hours: 'Idade mínima (horas)',
};
const MODES: Array<{ value: Mode; description: string }> = [
  { value: 'OBSERVE', description: 'Só lê, avalia e recomenda. Nada é enviado à Meta.' },
  { value: 'APPROVAL', description: 'Propõe pausas e orçamentos; cada uma só executa depois de aprovada.' },
  { value: 'AUTO_LIMITED', description: 'Ainda não liberado. Exige piloto validado em modo com aprovação.' },
  { value: 'PAUSED', description: 'Não avalia nem propõe nada.' },
];

function actionSummary(rule: RuleDefinition) {
  if (rule.action.type === 'BUDGET_INCREASE') return `Orçamento +${rule.action.pct ?? 0}%`;
  if (rule.action.type === 'BUDGET_DECREASE') return `Orçamento −${rule.action.pct ?? 0}%`;
  return ACTION_TYPE_LABEL[rule.action.type];
}

function newDraft(accounts: AdAccountOption[]): ProfileDraft {
  const defaults = strategyDefaults('BALANCED');
  return {
    ad_account_id: accounts[0]?.id ?? '',
    name: '',
    objective: 'LEADS',
    target_event: 'lead',
    target_cpa_cents: 0,
    strategy: 'BALANCED',
    mode: 'OBSERVE',
    evaluation_interval_minutes: defaults.evaluationIntervalMinutes,
    lookback_days: 7,
    campaign_ids: [],
    max_daily_budget_cents: null,
    min_daily_budget_cents: 1000,
    max_budget_change_pct: defaults.maxBudgetChangePct,
    cooldown_hours: 48,
    maturity_hours: 72,
    max_actions_per_day: 10,
    approval_ttl_hours: 24,
    enabled: true,
  };
}

function draftOf(profile: OptimizationProfile): ProfileDraft {
  return {
    id: profile.id,
    ad_account_id: profile.ad_account_id,
    name: profile.name,
    objective: profile.objective,
    target_event: profile.target_event,
    target_cpa_cents: Number(profile.target_cpa_cents),
    strategy: profile.strategy,
    mode: profile.mode,
    evaluation_interval_minutes: profile.evaluation_interval_minutes,
    lookback_days: profile.lookback_days,
    campaign_ids: profile.campaign_ids ?? [],
    max_daily_budget_cents: profile.max_daily_budget_cents === null ? null : Number(profile.max_daily_budget_cents),
    min_daily_budget_cents: Number(profile.min_daily_budget_cents),
    max_budget_change_pct: profile.max_budget_change_pct,
    cooldown_hours: profile.cooldown_hours,
    maturity_hours: profile.maturity_hours,
    max_actions_per_day: profile.max_actions_per_day,
    approval_ttl_hours: profile.approval_ttl_hours,
    enabled: profile.enabled,
  };
}

/** Campo numérico que só confirma valores válidos (permite apagar e redigitar). */
function NumberInput({ value, onCommit, min, max, step = 'any', ariaLabel, suffix }: { value: number | undefined; onCommit: (value: number) => void; min?: number; max?: number; step?: string; ariaLabel: string; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        aria-label={ariaLabel}
        defaultValue={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max)) onCommit(parsed);
        }}
        className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-right text-xs tabular-nums text-[var(--color-text)] focus:border-[var(--color-brand)] focus:outline-none"
      />
      {suffix && <span className="text-xs text-[var(--color-text-faint)]">{suffix}</span>}
    </span>
  );
}

function ConditionRow({ condition, onChange, currency }: { condition: RuleCondition; onChange: (next: RuleCondition) => void; currency: string }) {
  const meta = METRICS[condition.metric];
  const isPct = condition.operator === 'pct_change_gt' || condition.operator === 'pct_change_lt';
  const label = `${meta.label} ${OPERATORS[condition.operator]}`;
  let editor;
  if (condition.value_ref === 'target_cpa') {
    editor = <><NumberInput ariaLabel={`${label} multiplicador`} value={condition.multiplier ?? 1} min={0.01} max={100} onCommit={(value) => onChange({ ...condition, multiplier: value })} suffix="× meta" /></>;
  } else if (condition.operator === 'between' && Array.isArray(condition.value)) {
    const [low, high] = condition.value;
    editor = (
      <>
        <NumberInput ariaLabel={`${label} mínimo`} value={low} onCommit={(value) => onChange({ ...condition, value: [value, high] })} />
        <span className="text-xs text-[var(--color-text-faint)]">e</span>
        <NumberInput ariaLabel={`${label} máximo`} value={high} onCommit={(value) => onChange({ ...condition, value: [low, value] })} />
      </>
    );
  } else if (meta.unit === 'money' && !isPct) {
    editor = <NumberInput ariaLabel={label} value={typeof condition.value === 'number' ? condition.value / 100 : 0} min={0} onCommit={(value) => onChange({ ...condition, value: Math.round(value * 100) })} suffix={currency} />;
  } else {
    editor = <NumberInput ariaLabel={label} value={typeof condition.value === 'number' ? condition.value : 0} onCommit={(value) => onChange({ ...condition, value })} suffix={isPct ? '%' : meta.unit === 'ratio' ? '×' : meta.unit === 'percent' ? '%' : undefined} />;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
      <span className="text-[var(--color-text)]">{meta.label}</span>
      <span>{OPERATORS[condition.operator]}</span>
      {editor}
    </div>
  );
}

function RuleEditor({ rule, onChange, currency }: { rule: RuleDefinition; onChange: (next: RuleDefinition) => void; currency: string }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const defaults = DEFAULT_RULES.find((item) => item.key === rule.key);
  const updateCondition = (group: 'all' | 'any', index: number, next: RuleCondition) =>
    onChange({ ...rule, [group]: rule[group].map((condition, position) => (position === index ? next : condition)) });

  return (
    <div className={`rounded-xl border ${rule.enabled ? 'border-[var(--color-border)]' : 'border-[var(--color-border-soft)] opacity-70'} bg-[var(--color-panel-2)]`}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={rule.enabled} onChange={(event) => onChange({ ...rule, enabled: event.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" />
          <span className="text-sm font-medium text-[var(--color-text)]">{rule.name}</span>
        </label>
        <Chip>{LEVEL_LABEL[rule.scope]}</Chip>
        <Chip tone={rule.action.type === 'ALERT' ? 'info' : rule.action.type === 'BUDGET_INCREASE' ? 'good' : 'warn'}>{actionSummary(rule)}</Chip>
        <button type="button" onClick={() => setOpen((value) => !value)} className="ml-auto text-xs text-[var(--color-brand)] hover:underline" aria-expanded={open}>
          {open ? 'Fechar' : 'Ajustar'}
        </button>
      </div>
      {!open && <p className="px-3 pb-2.5 text-xs text-[var(--color-text-faint)]">{rule.description}</p>}
      {open && (
        <div key={version} className="space-y-3 border-t border-[var(--color-border-soft)] px-3 py-3">
          <p className="text-xs text-[var(--color-text-muted)]">{rule.description}</p>
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Dispara quando todas valem</p>
            {rule.all.map((condition, index) => <ConditionRow key={`all-${index}`} condition={condition} currency={currency} onChange={(next) => updateCondition('all', index, next)} />)}
            {rule.any.length > 0 && (
              <>
                <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">E pelo menos uma destas</p>
                {rule.any.map((condition, index) => <ConditionRow key={`any-${index}`} condition={condition} currency={currency} onChange={(next) => updateCondition('any', index, next)} />)}
              </>
            )}
          </div>
          {Object.keys(rule.minimums).length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Volume mínimo para avaliar</p>
              {(Object.keys(rule.minimums) as Array<keyof RuleMinimums>).map((key) => (
                <div key={key} className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span>{MINIMUM_LABEL[key]}</span>
                  <NumberInput ariaLabel={MINIMUM_LABEL[key]} value={rule.minimums[key]} min={0} onCommit={(value) => onChange({ ...rule, minimums: { ...rule.minimums, [key]: value } })} />
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
            {(rule.action.type === 'BUDGET_INCREASE' || rule.action.type === 'BUDGET_DECREASE') && (
              <span className="inline-flex items-center gap-2">
                Variação do orçamento
                <NumberInput ariaLabel="Variação do orçamento" value={rule.action.pct} min={1} max={50} step="1" onCommit={(value) => onChange({ ...rule, action: { ...rule.action, pct: Math.round(value) } })} suffix="%" />
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              Cooldown
              <NumberInput ariaLabel="Cooldown da regra" value={rule.cooldown_hours} min={1} max={720} step="1" onCommit={(value) => onChange({ ...rule, cooldown_hours: Math.round(value) })} suffix="h" />
            </span>
            <span className="inline-flex items-center gap-2">
              Prioridade
              <NumberInput ariaLabel="Prioridade da regra" value={rule.priority} min={0} max={100} step="1" onCommit={(value) => onChange({ ...rule, priority: Math.round(value) })} />
            </span>
            {defaults && (
              <button
                type="button"
                onClick={() => {
                  onChange({ ...JSON.parse(JSON.stringify(defaults)), enabled: rule.enabled });
                  setVersion((value) => value + 1);
                }}
                className="ml-auto inline-flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <RotateCcw size={12} /> Restaurar padrão
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SimulationView({ result }: { result: SimulationResult }) {
  const proposals = result.proposals.filter((proposal) => proposal.actionType !== 'ALERT');
  const alerts = result.proposals.filter((proposal) => proposal.actionType === 'ALERT');
  const blocked = result.evaluations.filter((evaluation) => evaluation.decision === 'BLOCKED');
  const insufficient = result.evaluations.filter((evaluation) => evaluation.decision === 'INSUFFICIENT_DATA');
  const currency = result.currency;
  return (
    <div className="space-y-4 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/[0.04] p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <FlaskConical size={14} className="text-[var(--color-brand)]" />
        <span className="font-semibold text-[var(--color-text)]">Simulação — nada foi gravado nem enviado à Meta</span>
        <span>
          · {formatDate(result.window.current.since)} a {formatDate(result.window.current.until)}, comparado com {formatDate(result.window.previous.since)} a {formatDate(result.window.previous.until)}
        </span>
        <span>· {plural(result.resources, 'recurso avaliado', 'recursos avaliados')}</span>
        <span>· orçamento diário ativo {formatMoney(result.activeDailyBudgetCents, currency)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip tone="warn">{plural(proposals.length, 'proposta de alteração', 'propostas de alteração')}</Chip>
        <Chip tone="info">{plural(alerts.length, 'alerta', 'alertas')}</Chip>
        <Chip tone="muted">{plural(blocked.length, 'bloqueada', 'bloqueadas')}</Chip>
        <Chip tone="muted">{plural(insufficient.length, 'sem dados suficientes', 'sem dados suficientes')}</Chip>
      </div>

      {result.proposals.length > 0 && (
        <div className="space-y-2">
          {result.proposals.map((proposal) => (
            <div key={proposal.idempotencyKey} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--color-text)]">{proposal.title}</span>
                <Chip>{LEVEL_LABEL[proposal.level]}: {proposal.resourceName}</Chip>
                {proposal.payload.kind === 'budget' && <Chip tone="warn">{formatMoney(proposal.payload.fromCents, currency)} → {formatMoney(proposal.payload.toCents, currency)}</Chip>}
                {proposal.payload.kind === 'status' && <Chip tone="warn">Ativo → pausado</Chip>}
              </div>
              <p className="mt-1 leading-5 text-[var(--color-text-muted)]">{proposal.reason}</p>
            </div>
          ))}
        </div>
      )}

      {blocked.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-[var(--color-text)]">Disparou, mas foi bloqueada ({blocked.length})</summary>
          <ul className="mt-2 space-y-1.5 text-[var(--color-text-muted)]">
            {blocked.slice(0, 40).map((evaluation) => (
              <li key={`${evaluation.ruleKey}-${evaluation.resourceId}`}>
                <span className="text-[var(--color-text)]">{evaluation.ruleName}</span> · {evaluation.resourceName}: {evaluation.reasons.join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {insufficient.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-[var(--color-text)]">Sem volume para decidir ({insufficient.length})</summary>
          <ul className="mt-2 space-y-1.5 text-[var(--color-text-muted)]">
            {insufficient.slice(0, 40).map((evaluation) => (
              <li key={`${evaluation.ruleKey}-${evaluation.resourceId}`}>
                <span className="text-[var(--color-text)]">{evaluation.ruleName}</span> · {evaluation.resourceName}: {evaluation.reasons.join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ProfileEditor({
  initial,
  initialRules,
  accounts,
  isAdmin,
  onCancel,
  onSaved,
  notify,
}: {
  initial: ProfileDraft;
  initialRules: RuleDefinition[];
  accounts: AdAccountOption[];
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(initial);
  const [rules, setRules] = useState<RuleDefinition[]>(initialRules);
  const [targetCpa, setTargetCpa] = useState(initial.target_cpa_cents ? centsToInput(initial.target_cpa_cents) : '');
  const [maxDaily, setMaxDaily] = useState(centsToInput(initial.max_daily_budget_cents));
  const [minDaily, setMinDaily] = useState(centsToInput(initial.min_daily_budget_cents));
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const account = accounts.find((item) => item.id === draft.ad_account_id);
  const currency = account?.currency ?? 'BRL';
  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let alive = true;
    setCampaigns(null);
    setCampaignError(null);
    if (!draft.ad_account_id) return;
    optimizationApi.campaigns(draft.ad_account_id)
      .then((list) => { if (alive) setCampaigns(list.filter((campaign) => ['ACTIVE', 'PAUSED'].includes(campaign.effective_status))); })
      .catch((caught) => { if (alive) setCampaignError(caught instanceof Error ? caught.message : 'Falha ao carregar campanhas.'); });
    return () => { alive = false; };
  }, [draft.ad_account_id]);

  const build = (): ProfileDraft | null => {
    const problems: string[] = [];
    const target = inputToCents(targetCpa);
    if (!draft.name.trim()) problems.push('Dê um nome ao perfil.');
    if (!draft.ad_account_id) problems.push('Escolha a conta de anúncios.');
    if (target === null || target <= 0) problems.push('Informe a meta de custo por resultado.');
    const max = maxDaily.trim() ? inputToCents(maxDaily) : null;
    if (maxDaily.trim() && (max === null || max <= 0)) problems.push('Teto diário inválido.');
    const min = inputToCents(minDaily);
    if (min === null || min <= 0) problems.push('Orçamento mínimo inválido.');
    setErrors(problems);
    if (problems.length > 0) return null;
    return { ...draft, name: draft.name.trim(), target_cpa_cents: target!, max_daily_budget_cents: max, min_daily_budget_cents: min! };
  };

  const applyStrategy = (strategy: Strategy) => {
    if (strategy === draft.strategy) return;
    if (draft.id && !window.confirm(`Aplicar a estratégia ${STRATEGY_LABEL[strategy]}? As regras voltam aos valores dessa estratégia e os ajustes feitos nelas se perdem.`)) return;
    const defaults = strategyDefaults(strategy);
    setDraft((current) => ({ ...current, strategy, evaluation_interval_minutes: defaults.evaluationIntervalMinutes, max_budget_change_pct: defaults.maxBudgetChangePct }));
    setRules(defaults.rules.map((rule) => ({ ...rule, enabled: rules.find((item) => item.key === rule.key)?.enabled ?? rule.enabled })));
  };

  const simulate = async () => {
    const built = build();
    if (!built) return;
    setSimulating(true);
    setSimulation(null);
    try {
      setSimulation(await optimizationApi.simulateDraft(built, rules));
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Falha na simulação.', 'bad');
    } finally {
      setSimulating(false);
    }
  };

  const save = async () => {
    const built = build();
    if (!built) return;
    setSaving(true);
    try {
      await optimizationApi.saveProfile(built, rules);
      notify(draft.id ? 'Perfil salvo.' : 'Perfil criado. A primeira avaliação acontece no próximo ciclo; use "Avaliar agora" para não esperar.', 'good');
      onSaved();
    } catch (caught) {
      setErrors([caught instanceof Error ? caught.message : 'Falha ao salvar.']);
    } finally {
      setSaving(false);
    }
  };

  const events = TARGET_EVENTS.filter((event) => event.objective === draft.objective);
  const toggleCampaign = (id: string) =>
    set('campaign_ids', draft.campaign_ids.includes(id) ? draft.campaign_ids.filter((item) => item !== id) : [...draft.campaign_ids, id]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[var(--color-text)]">{draft.id ? `Editar perfil: ${initial.name}` : 'Novo perfil de otimização'}</h3>
        <button type="button" onClick={onCancel} className={ghostButton}>Voltar</button>
      </div>

      <Panel title="1. Conta e meta" description="O evento escolhido é o único contado como resultado. Nada é inferido.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome do perfil" htmlFor="opt-name">
            <input id="opt-name" value={draft.name} maxLength={120} onChange={(event) => set('name', event.target.value)} placeholder="Ex.: Leads — Conservador" className={inputClass} />
          </Field>
          <Field label="Conta de anúncios" htmlFor="opt-account">
            <select id="opt-account" value={draft.ad_account_id} onChange={(event) => { set('ad_account_id', event.target.value); set('campaign_ids', []); }} className={inputClass}>
              {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
            </select>
          </Field>
          <Field label="Objetivo" htmlFor="opt-objective">
            <select
              id="opt-objective"
              value={draft.objective}
              onChange={(event) => {
                const objective = event.target.value as 'LEADS' | 'SALES';
                setDraft((current) => ({ ...current, objective, target_event: TARGET_EVENTS.find((item) => item.objective === objective)?.value ?? current.target_event }));
              }}
              className={inputClass}
            >
              <option value="LEADS">Leads</option>
              <option value="SALES">Vendas</option>
            </select>
          </Field>
          <Field label="Evento de resultado" htmlFor="opt-event">
            <select id="opt-event" value={draft.target_event} onChange={(event) => set('target_event', event.target.value)} className={inputClass}>
              {events.map((event) => <option key={event.value} value={event.value}>{event.label}</option>)}
            </select>
          </Field>
          <Field label={`Meta de custo por resultado (${currency})`} htmlFor="opt-target" hint="Base das regras de stop loss, custo alto e escala.">
            <input id="opt-target" inputMode="decimal" value={targetCpa} onChange={(event) => setTargetCpa(event.target.value)} placeholder="20,00" className={inputClass} />
          </Field>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">Campanhas no escopo</p>
          {campaignError ? (
            <p className="text-xs text-[var(--color-bad)]">{campaignError}</p>
          ) : !campaigns ? (
            <p className="text-xs text-[var(--color-text-faint)]">Carregando campanhas...</p>
          ) : (
            <>
              <p className="mb-2 text-[11px] text-[var(--color-text-faint)]">
                {draft.campaign_ids.length === 0 ? 'Nenhuma marcada: o perfil cobre todas as campanhas ativas ou pausadas da conta, inclusive as novas.' : `${plural(draft.campaign_ids.length, 'campanha marcada', 'campanhas marcadas')}.`}
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-[var(--color-border-soft)] p-2">
                {campaigns.length === 0 && <p className="p-2 text-xs text-[var(--color-text-faint)]">Nenhuma campanha ativa ou pausada.</p>}
                {campaigns.map((campaign) => (
                  <label key={campaign.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/5">
                    <input type="checkbox" checked={draft.campaign_ids.includes(campaign.id)} onChange={() => toggleCampaign(campaign.id)} className="h-3.5 w-3.5 accent-[var(--color-brand)]" />
                    <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{campaign.name}</span>
                    <span className="text-[var(--color-text-faint)]">{campaign.effective_status === 'ACTIVE' ? 'Ativa' : 'Pausada'}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel title="2. Estratégia e ritmo" description="Os valores de cada estratégia são pontos de partida, não garantias. Simule antes de ativar.">
        <div role="radiogroup" aria-label="Estratégia" className="grid gap-2 sm:grid-cols-3">
          {(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as Strategy[]).map((strategy) => {
            const preset = strategyDefaults(strategy);
            const scale = preset.rules.find((rule) => rule.key === 'R03_SCALE_VERTICAL')?.action.pct;
            const tolerance = preset.rules.find((rule) => rule.key === 'R02_CPA_ABOVE_TARGET')?.all[0].value;
            const active = draft.strategy === strategy;
            return (
              <button
                key={strategy}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => applyStrategy(strategy)}
                className={`rounded-xl border p-3 text-left transition ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-brand)]/50'}`}
              >
                <p className="text-sm font-semibold text-[var(--color-text)]">{STRATEGY_LABEL[strategy]}</p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-muted)]">
                  Escala até +{scale}% · reduz com custo {Math.round(((typeof tolerance === 'number' ? tolerance : 1) - 1) * 100)}% acima da meta · {INTERVALS.find((item) => item.value === preset.evaluationIntervalMinutes)?.label.toLowerCase()}
                </p>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Frequência de avaliação" htmlFor="opt-interval">
            <select id="opt-interval" value={draft.evaluation_interval_minutes} onChange={(event) => set('evaluation_interval_minutes', Number(event.target.value))} className={inputClass}>
              {INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Janela de análise" htmlFor="opt-lookback" hint="Dias completos até ontem, comparados com o período anterior de mesmo tamanho.">
            <select id="opt-lookback" value={draft.lookback_days} onChange={(event) => set('lookback_days', Number(event.target.value))} className={inputClass}>
              {LOOKBACKS.map((days) => <option key={days} value={days}>Últimos {days} dias</option>)}
            </select>
          </Field>
        </div>
      </Panel>

      <Panel title="3. Limites de segurança" description="Valem para qualquer proposta, mesmo aprovada. A conferência acontece de novo no momento do envio.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={`Teto de orçamento diário ativo (${currency})`} htmlFor="opt-max-daily" hint="Opcional. Bloqueia aumentos que passariam desse total.">
            <input id="opt-max-daily" inputMode="decimal" value={maxDaily} onChange={(event) => setMaxDaily(event.target.value)} placeholder="Sem teto" className={inputClass} />
          </Field>
          <Field label={`Orçamento diário mínimo (${currency})`} htmlFor="opt-min-daily" hint="Reduções nunca descem abaixo disso.">
            <input id="opt-min-daily" inputMode="decimal" value={minDaily} onChange={(event) => setMinDaily(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Variação máxima por alteração (%)" htmlFor="opt-max-change">
            <input id="opt-max-change" type="number" min={1} max={50} value={draft.max_budget_change_pct} onChange={(event) => set('max_budget_change_pct', Number(event.target.value))} className={inputClass} />
          </Field>
          <Field label="Cooldown após alteração (horas)" htmlFor="opt-cooldown">
            <input id="opt-cooldown" type="number" min={1} max={720} value={draft.cooldown_hours} onChange={(event) => set('cooldown_hours', Number(event.target.value))} className={inputClass} />
          </Field>
          <Field label="Maturação mínima (horas)" htmlFor="opt-maturity" hint="Campanhas e conjuntos mais novos que isso não recebem alterações.">
            <input id="opt-maturity" type="number" min={0} max={720} value={draft.maturity_hours} onChange={(event) => set('maturity_hours', Number(event.target.value))} className={inputClass} />
          </Field>
          <Field label="Máximo de alterações em 24h" htmlFor="opt-max-actions">
            <input id="opt-max-actions" type="number" min={1} max={100} value={draft.max_actions_per_day} onChange={(event) => set('max_actions_per_day', Number(event.target.value))} className={inputClass} />
          </Field>
          <Field label="Validade da proposta (horas)" htmlFor="opt-ttl" hint="Depois disso, a proposta expira e precisa de nova avaliação.">
            <input id="opt-ttl" type="number" min={1} max={168} value={draft.approval_ttl_hours} onChange={(event) => set('approval_ttl_hours', Number(event.target.value))} className={inputClass} />
          </Field>
        </div>
      </Panel>

      <Panel title="4. Modo de execução">
        <div role="radiogroup" aria-label="Modo de execução" className="grid gap-2 md:grid-cols-2">
          {MODES.map((option) => {
            const locked = option.value === 'AUTO_LIMITED' || (option.value === 'APPROVAL' && !isAdmin && initial.mode !== 'APPROVAL');
            const active = draft.mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                onClick={() => set('mode', option.value)}
                className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-brand)]/50'}`}
              >
                <p className="text-sm font-semibold text-[var(--color-text)]">{MODE_LABEL[option.value]}</p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-muted)]">
                  {option.value === 'APPROVAL' && !isAdmin && initial.mode !== 'APPROVAL' ? 'Só administradores ativam este modo.' : option.description}
                </p>
              </button>
            );
          })}
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
          Avaliar automaticamente na frequência escolhida
        </label>
      </Panel>

      <Panel title="5. Regras" description="Ligue, desligue e ajuste os limites. As condições usam uma lista fechada de métricas; nenhuma fórmula livre é aceita.">
        <div className="space-y-2">
          {rules.map((rule, index) => (
            <RuleEditor key={rule.key} rule={rule} currency={currency} onChange={(next) => setRules((current) => current.map((item, position) => (position === index ? next : item)))} />
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-4 text-[var(--color-text-faint)]">
          Sempre ativos, sem configuração: bloqueio por rastreamento suspeito, teto de orçamento, conflito entre regras, maturação, cooldown e limite de alterações por dia.
        </p>
      </Panel>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] px-4 py-3 text-sm text-[var(--color-bad)]">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      {simulation && <SimulationView result={simulation} />}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 py-3 backdrop-blur">
        <button type="button" onClick={onCancel} className={ghostButton}>Cancelar</button>
        <button type="button" onClick={() => void simulate()} disabled={simulating || saving} className={ghostButton}>
          <FlaskConical size={15} /> {simulating ? 'Simulando...' : 'Simular com dados reais'}
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || simulating} className={primaryButton}>{saving ? 'Salvando...' : draft.id ? 'Salvar perfil' : 'Criar perfil'}</button>
      </div>
    </div>
  );
}

export function AutomationsTab({
  state,
  accounts,
  accountsError,
  onChanged,
  notify,
}: {
  state: OptimizationState;
  accounts: AdAccountOption[] | null;
  accountsError: string | null;
  onChanged: () => void;
  notify: Notify;
}) {
  const [editing, setEditing] = useState<{ draft: ProfileDraft; rules: RuleDefinition[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [simulations, setSimulations] = useState<Record<string, SimulationResult>>({});
  const rulesByProfile = useMemo(() => {
    const map = new Map<string, RuleDefinition[]>();
    for (const row of state.rules) map.set(row.profile_id, [...(map.get(row.profile_id) ?? []), ruleFromRow(row)]);
    return map;
  }, [state.rules]);

  if (accountsError) return <ErrorView message={accountsError} />;
  if (!accounts) return <LoadingView label="Carregando contas de anúncios..." />;

  if (editing) {
    return (
      <ProfileEditor
        initial={editing.draft}
        initialRules={editing.rules}
        accounts={accounts}
        isAdmin={state.isAdmin}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); onChanged(); }}
        notify={notify}
      />
    );
  }

  const run = async (id: string, task: () => Promise<void>) => {
    setBusy(id);
    try {
      await task();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Falha na operação.', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const startNew = () => setEditing({ draft: newDraft(accounts), rules: strategyDefaults('BALANCED').rules });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-5 text-[var(--color-text-muted)]">
          Cada perfil aplica um conjunto de regras a uma conta (ou a campanhas escolhidas). Todo perfil novo começa em "Somente observar".
        </p>
        <button type="button" onClick={startNew} disabled={accounts.length === 0} className={primaryButton}><Plus size={15} /> Novo perfil</button>
      </div>

      {state.profiles.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal size={20} />}
          title="Nenhum perfil de otimização"
          description="Crie um perfil com a meta de custo da conta. Ele começa só observando: você vê as recomendações antes de qualquer alteração."
          action={<button type="button" onClick={startNew} className={primaryButton}><Plus size={15} /> Criar primeiro perfil</button>}
        />
      ) : (
        <div className="space-y-3">
          {state.profiles.map((profile) => {
            const rules = rulesByProfile.get(profile.id) ?? [];
            const enabledRules = rules.filter((rule) => rule.enabled).length;
            const event = TARGET_EVENTS.find((item) => item.value === profile.target_event)?.label ?? profile.target_event;
            const simulation = simulations[profile.id];
            return (
              <article key={profile.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-[var(--color-text)]">{profile.name}</h4>
                      <ModeChip mode={profile.mode} />
                      {profile.emergency_stop && <Chip tone="bad">Parada de emergência</Chip>}
                      {!profile.enabled && <Chip>Avaliação automática desligada</Chip>}
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {profile.ad_account_name ?? profile.ad_account_id} · {event} · meta {formatMoney(Number(profile.target_cpa_cents), profile.currency)} · {STRATEGY_LABEL[profile.strategy]} ·{' '}
                      {profile.campaign_ids.length === 0 ? 'todas as campanhas' : plural(profile.campaign_ids.length, 'campanha', 'campanhas')} · {plural(enabledRules, 'regra ligada', 'regras ligadas')}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
                      Última avaliação {timeAgo(profile.last_evaluated_at)} <RunStatusChip status={profile.last_run_status} />
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void run(profile.id, async () => {
                        const result = await optimizationApi.simulateProfile(profile.id);
                        setSimulations((current) => ({ ...current, [profile.id]: result }));
                      })}
                      className={ghostButton}
                    >
                      <FlaskConical size={14} /> {busy === profile.id ? 'Aguarde...' : 'Simular'}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null || profile.mode === 'PAUSED'}
                      title={profile.mode === 'PAUSED' ? 'O perfil está pausado' : undefined}
                      onClick={() => void run(profile.id, async () => {
                        const result = await optimizationApi.evaluate(profile.id);
                        notify(`Avaliação concluída: ${plural(result.created ?? 0, 'item novo', 'itens novos')}.`, 'good');
                        onChanged();
                      })}
                      className={ghostButton}
                    >
                      <Play size={14} /> Avaliar agora
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => setEditing({ draft: draftOf(profile), rules })} className={ghostButton}>
                      <Pencil size={14} /> Editar
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`Arquivar o perfil "${profile.name}"? As propostas abertas dele deixam de valer. O histórico continua disponível.`)) return;
                        void run(profile.id, async () => {
                          await optimizationApi.archiveProfile(profile.id);
                          notify('Perfil arquivado.', 'good');
                          onChanged();
                        });
                      }}
                      className={ghostButton}
                      aria-label={`Arquivar ${profile.name}`}
                    >
                      <Archive size={14} />
                    </button>
                  </div>
                </div>
                {simulation && (
                  <div className="mt-4">
                    <SimulationView result={simulation} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
