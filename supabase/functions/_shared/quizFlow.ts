// Motor dos quizzes em fluxo (estilo Typebot / ManyChat).
//
// Mesmo arquivo roda no navegador (editor, pré-visualização e página pública)
// e na Edge Function `quiz-runtime`. O navegador usa o motor só para navegar
// entre as telas; o resultado que vale — qualificação, pontuação, tags,
// webhooks e destino — é recalculado no servidor a partir das respostas.
//
// Sem dependências: precisa compilar igual no Vite e no Deno.

export type QuizNodeType =
  | 'start'
  | 'message'
  | 'input'
  | 'choice'
  | 'condition'
  | 'action'
  | 'webhook'
  | 'redirect'
  | 'end';

export type InputKind = 'text' | 'name' | 'phone' | 'email' | 'number';

export interface ChoiceOption {
  id: string;
  label: string;
  /** Valor gravado na variável e usado nas condições (ex.: "menos_1000"). */
  value: string;
  /** Ícone opcional mostrado no card da opção. */
  emoji?: string;
}

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'empty'
  | 'not_empty';

export interface ConditionRule {
  id: string;
  variable: string;
  operator: ConditionOperator;
  value: string;
}

export type ActionOp =
  | { id: string; kind: 'qualify'; qualified: boolean }
  | { id: string; kind: 'score'; amount: number }
  | { id: string; kind: 'tag'; tag: string }
  | { id: string; kind: 'set'; variable: string; value: string };

export interface QuizNodeData {
  // message
  text?: string;
  imageUrl?: string;
  buttonLabel?: string;
  // input / choice
  label?: string;
  inputKind?: InputKind;
  placeholder?: string;
  variable?: string;
  required?: boolean;
  multiple?: boolean;
  options?: ChoiceOption[];
  // condition
  combinator?: 'and' | 'or';
  rules?: ConditionRule[];
  // action
  ops?: ActionOp[];
  // webhook
  url?: string;
  headerName?: string;
  headerValue?: string;
  // redirect
  target?: 'link' | 'url' | 'whatsapp';
  linkId?: string;
  phone?: string;
  message?: string;
  // end (tela de resultado; o botão usa os mesmos campos de destino do redirect)
  title?: string;
  ctaLabel?: string;
  // nome interno do bloco no editor
  name?: string;
}

export interface QuizNode {
  id: string;
  type: QuizNodeType;
  position: { x: number; y: number };
  data: QuizNodeData;
}

export interface QuizEdge {
  id: string;
  source: string;
  /** 'next' (padrão), 'yes'/'no' na condição ou o id da opção na escolha. */
  sourceHandle?: string | null;
  target: string;
}

export interface QuizFlow {
  nodes: QuizNode[];
  edges: QuizEdge[];
}

export type QuizValue = string | number | boolean | string[] | null;

export interface AnswerRecord {
  node_id: string;
  variable: string;
  label: string;
  value: QuizValue;
  /** Texto legível (rótulo da opção, número formatado). */
  display: string;
}

export interface RunState {
  variables: Record<string, QuizValue>;
  answers: AnswerRecord[];
  path: string[];
  qualified: boolean | null;
  score: number;
  tags: string[];
  /** Webhooks pelos quais o caminho passou, na ordem. */
  webhooks: string[];
}

export interface RunResult {
  /** 'pending' = parou num bloco que espera o lead; 'done' = chegou ao fim. */
  status: 'pending' | 'done';
  /** Bloco atual (pendente) ou final (redirect/end). null = caminho sem saída. */
  node: QuizNode | null;
  state: RunState;
}

/** Respostas cruas que o navegador envia: id do bloco → valor. */
export type RawAnswers = Record<string, string | string[]>;

export class QuizRunError extends Error {
  readonly code: 'invalid_answer' | 'incomplete' | 'loop';
  readonly nodeId: string | null;
  constructor(code: 'invalid_answer' | 'incomplete' | 'loop', message: string, nodeId: string | null = null) {
    super(message);
    this.code = code;
    this.nodeId = nodeId;
  }
}

const MAX_STEPS = 500;
const INTERACTIVE: QuizNodeType[] = ['message', 'input', 'choice'];
const TERMINAL: QuizNodeType[] = ['redirect', 'end'];

export const SYSTEM_VARIABLES = ['qualificado', 'pontuacao', 'tags', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// ─── utilidades ──────────────────────────────────────────────────────────────

export function shortId() {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return random.replace(/-/g, '').slice(0, 10);
}

export function toVariableName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/** Aceita "5.000", "5000", "1.234,5" e "1234.5". */
export function toNumber(value: QuizValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null || Array.isArray(value)) return null;
  const text = value.trim().replace(/\s/g, '');
  if (!text) return null;
  let normalized = text;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.');
  else normalized = text.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: QuizValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ').trim().toLowerCase();
  return String(value).trim().toLowerCase();
}

function isEmpty(value: QuizValue) {
  return value === null || value === undefined || (Array.isArray(value) ? value.length === 0 : String(value).trim() === '');
}

export function formatValue(value: QuizValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (typeof value === 'number') return value.toLocaleString('pt-BR');
  return value;
}

/** Variáveis visíveis para condições e textos: respostas + sistema. */
export function scopeOf(state: RunState): Record<string, QuizValue> {
  return {
    ...state.variables,
    qualificado: state.qualified,
    pontuacao: state.score,
    tags: state.tags,
  };
}

/**
 * Troca {{variavel}} pelo valor. Aceita reserva para quando a variável estiver
 * vazia: {{nome|tudo bem}} vira "tudo bem" se o lead não informou o nome.
 * Sem reserva, a variável vazia vira texto vazio.
 */
export function interpolate(text: string | undefined, scope: Record<string, QuizValue>) {
  if (!text) return '';
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g, (_, name: string, fallback?: string) => formatValue(scope[name] ?? null) || (fallback ?? '').trim());
}

export function emptyState(context: Record<string, string> = {}): RunState {
  const variables: Record<string, QuizValue> = {};
  for (const [key, value] of Object.entries(context)) {
    if (/^[a-z0-9_]{1,60}$/.test(key) && typeof value === 'string') variables[key] = value.slice(0, 300);
  }
  return { variables, answers: [], path: [], qualified: null, score: 0, tags: [], webhooks: [] };
}

function cloneState(state: RunState): RunState {
  return {
    variables: { ...state.variables },
    answers: [...state.answers],
    path: [...state.path],
    qualified: state.qualified,
    score: state.score,
    tags: [...state.tags],
    webhooks: [...state.webhooks],
  };
}

// ─── navegação ───────────────────────────────────────────────────────────────

export function startNode(flow: QuizFlow) {
  return flow.nodes.find((node) => node.type === 'start') ?? null;
}

function edgeFrom(flow: QuizFlow, nodeId: string, handle: string) {
  return flow.edges.find((edge) => edge.source === nodeId && (edge.sourceHandle || 'next') === handle) ?? null;
}

/** Próximo bloco a partir de uma saída. Opção de escolha sem ligação cai em "Outras". */
export function nextNodeId(flow: QuizFlow, nodeId: string, handle = 'next'): string | null {
  const edge = edgeFrom(flow, nodeId, handle) ?? (handle !== 'next' && handle !== 'yes' && handle !== 'no' ? edgeFrom(flow, nodeId, 'next') : null);
  return edge?.target ?? null;
}

export function evaluateRule(rule: ConditionRule, scope: Record<string, QuizValue>): boolean {
  const current = scope[rule.variable] ?? null;
  const expected = rule.value ?? '';
  switch (rule.operator) {
    case 'empty':
      return isEmpty(current);
    case 'not_empty':
      return !isEmpty(current);
    case 'eq':
      if (typeof current === 'boolean') return current === ['sim', 'true', '1', 'yes'].includes(normalizeText(expected));
      if (Array.isArray(current)) return current.some((item) => normalizeText(item) === normalizeText(expected));
      if (toNumber(current) !== null && toNumber(expected) !== null) return toNumber(current) === toNumber(expected);
      return normalizeText(current) === normalizeText(expected);
    case 'neq':
      return !evaluateRule({ ...rule, operator: 'eq' }, scope);
    case 'contains':
      if (Array.isArray(current)) return current.some((item) => normalizeText(item) === normalizeText(expected));
      return normalizeText(current).includes(normalizeText(expected));
    case 'not_contains':
      return !evaluateRule({ ...rule, operator: 'contains' }, scope);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = toNumber(current);
      const right = toNumber(expected);
      if (left === null || right === null) return false;
      if (rule.operator === 'gt') return left > right;
      if (rule.operator === 'gte') return left >= right;
      if (rule.operator === 'lt') return left < right;
      return left <= right;
    }
    default:
      return false;
  }
}

export function evaluateCondition(node: QuizNode, scope: Record<string, QuizValue>) {
  const rules = node.data.rules ?? [];
  if (rules.length === 0) return false;
  return node.data.combinator === 'or'
    ? rules.some((rule) => evaluateRule(rule, scope))
    : rules.every((rule) => evaluateRule(rule, scope));
}

function applyAction(node: QuizNode, state: RunState) {
  for (const op of node.data.ops ?? []) {
    if (op.kind === 'qualify') state.qualified = op.qualified;
    else if (op.kind === 'score') state.score += Number(op.amount) || 0;
    else if (op.kind === 'tag') {
      const tag = op.tag.trim();
      if (tag && !state.tags.includes(tag)) state.tags.push(tag);
    } else if (op.kind === 'set' && op.variable) {
      state.variables[op.variable] = interpolate(op.value, scopeOf(state));
    }
  }
}

/** Valida e converte a resposta crua de um bloco de pergunta. */
export function parseAnswer(node: QuizNode, raw: string | string[] | undefined): { value: QuizValue; display: string; handle: string } {
  const required = node.data.required !== false;
  if (node.type === 'choice') {
    const options = node.data.options ?? [];
    if (node.data.multiple) {
      const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const chosen = options.filter((option) => ids.includes(option.id));
      if (chosen.length !== ids.length) throw new QuizRunError('invalid_answer', 'Opção inválida.', node.id);
      if (required && chosen.length === 0) throw new QuizRunError('invalid_answer', 'Escolha pelo menos uma opção.', node.id);
      return { value: chosen.map((option) => option.value), display: chosen.map((option) => option.label).join(', '), handle: 'next' };
    }
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) {
      if (required) throw new QuizRunError('invalid_answer', 'Escolha uma opção.', node.id);
      return { value: null, display: '', handle: 'next' };
    }
    const option = options.find((item) => item.id === id);
    if (!option) throw new QuizRunError('invalid_answer', 'Opção inválida.', node.id);
    return { value: option.value, display: option.label, handle: option.id };
  }

  const text = (Array.isArray(raw) ? raw.join(' ') : raw ?? '').trim().slice(0, 500);
  if (!text) {
    if (required) throw new QuizRunError('invalid_answer', 'Responda para continuar.', node.id);
    return { value: null, display: '', handle: 'next' };
  }
  switch (node.data.inputKind) {
    case 'phone':
      if (text.replace(/\D/g, '').length < 10) throw new QuizRunError('invalid_answer', 'Informe o número com DDD.', node.id);
      return { value: text, display: text, handle: 'next' };
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new QuizRunError('invalid_answer', 'Informe um e-mail válido.', node.id);
      return { value: text.toLowerCase(), display: text.toLowerCase(), handle: 'next' };
    case 'number': {
      const parsed = toNumber(text);
      if (parsed === null) throw new QuizRunError('invalid_answer', 'Informe apenas números.', node.id);
      return { value: parsed, display: parsed.toLocaleString('pt-BR'), handle: 'next' };
    }
    default:
      return { value: text, display: text, handle: 'next' };
  }
}

/**
 * Percorre o fluxo com as respostas dadas.
 * partial=true: para no primeiro bloco ainda sem resposta (navegador e progresso).
 * partial=false: exige o caminho completo até um bloco final (conclusão no servidor).
 */
export function runFlow(flow: QuizFlow, answers: RawAnswers, context: Record<string, string> = {}, partial = true): RunResult {
  const state = emptyState(context);
  const start = startNode(flow);
  if (!start) return { status: 'done', node: null, state };
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  let currentId: string | null = nextNodeId(flow, start.id);
  state.path.push(start.id);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (!currentId) return { status: 'done', node: null, state };
    const node = byId.get(currentId);
    if (!node) return { status: 'done', node: null, state };
    if (state.path.includes(node.id)) throw new QuizRunError('loop', 'O fluxo volta para um bloco já visitado.', node.id);
    state.path.push(node.id);

    if (TERMINAL.includes(node.type)) return { status: 'done', node, state };

    if (node.type === 'message') {
      // A mensagem só precisa de "continuar" no navegador; o servidor segue direto.
      if (partial && answers[node.id] === undefined) {
        state.path.pop();
        return { status: 'pending', node, state };
      }
      currentId = nextNodeId(flow, node.id);
      continue;
    }

    if (node.type === 'input' || node.type === 'choice') {
      const raw = answers[node.id];
      if (raw === undefined) {
        if (partial) {
          state.path.pop();
          return { status: 'pending', node, state };
        }
        if (node.data.required !== false) throw new QuizRunError('incomplete', 'Faltam respostas.', node.id);
      }
      const parsed = parseAnswer(node, raw);
      const variable = node.data.variable || node.id;
      state.variables[variable] = parsed.value;
      state.answers.push({ node_id: node.id, variable, label: node.data.label ?? '', value: parsed.value, display: parsed.display });
      currentId = nextNodeId(flow, node.id, parsed.handle);
      continue;
    }

    if (node.type === 'condition') {
      currentId = nextNodeId(flow, node.id, evaluateCondition(node, scopeOf(state)) ? 'yes' : 'no');
      continue;
    }
    if (node.type === 'action') {
      applyAction(node, state);
      currentId = nextNodeId(flow, node.id);
      continue;
    }
    if (node.type === 'webhook') {
      state.webhooks.push(node.id);
      currentId = nextNodeId(flow, node.id);
      continue;
    }
    currentId = nextNodeId(flow, node.id);
  }
  throw new QuizRunError('loop', 'O fluxo passou do limite de passos.');
}

/** Para a tela: a pergunta atual e o estado acumulado até ela. */
export function currentStep(flow: QuizFlow, answers: RawAnswers, context: Record<string, string> = {}) {
  const result = runFlow(flow, answers, context, true);
  return { ...result, state: cloneState(result.state) };
}

/** Quantos blocos de pergunta faltam no caminho mais longo a partir de um bloco (para a barra de progresso). */
export function remainingSteps(flow: QuizFlow, fromId: string | null) {
  const memo = new Map<string, number>();
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const visit = (id: string | null, guard: Set<string>): number => {
    if (!id) return 0;
    if (memo.has(id)) return memo.get(id)!;
    if (guard.has(id)) return 0;
    const node = byId.get(id);
    if (!node) return 0;
    guard.add(id);
    const own = INTERACTIVE.includes(node.type) ? 1 : 0;
    const targets = flow.edges.filter((edge) => edge.source === id).map((edge) => edge.target);
    const best = targets.reduce((max, target) => Math.max(max, visit(target, guard)), 0);
    guard.delete(id);
    memo.set(id, own + best);
    return own + best;
  };
  return visit(fromId, new Set());
}

// ─── fluxo público (o que a página do lead recebe) ──────────────────────────

/** Remove endereços e credenciais de webhook e os destinos dos redirecionamentos. */
export function publicFlow(flow: QuizFlow): QuizFlow {
  return {
    edges: flow.edges.map((edge) => ({ id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle ?? null, target: edge.target })),
    nodes: flow.nodes.map((node) => {
      if (node.type === 'webhook') return { ...node, data: {} };
      if (node.type === 'redirect') return { ...node, data: { target: node.data.target } };
      if (node.type === 'end') return { ...node, data: { title: node.data.title, text: node.data.text, ctaLabel: node.data.ctaLabel, name: node.data.name } };
      return node;
    }),
  };
}

// ─── validação antes de publicar ─────────────────────────────────────────────

export interface FlowIssue {
  level: 'error' | 'warning';
  nodeId: string | null;
  message: string;
}

export const NODE_LABELS: Record<QuizNodeType, string> = {
  start: 'Início',
  message: 'Mensagem',
  input: 'Pergunta',
  choice: 'Escolha',
  condition: 'Condição',
  action: 'Ação',
  webhook: 'Webhook',
  redirect: 'Redirecionar',
  end: 'Finalizar',
};

export function nodeTitle(node: QuizNode) {
  return node.data.name || node.data.label || node.data.title || NODE_LABELS[node.type];
}

export function validateFlow(flow: QuizFlow): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const error = (nodeId: string | null, message: string) => issues.push({ level: 'error', nodeId, message });
  const warn = (nodeId: string | null, message: string) => issues.push({ level: 'warning', nodeId, message });
  const starts = flow.nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1) error(null, starts.length === 0 ? 'O fluxo precisa de um bloco Início.' : 'O fluxo só pode ter um bloco Início.');
  const has = (nodeId: string, handle: string) => Boolean(edgeFrom(flow, nodeId, handle));
  const variables = new Map<string, string>();

  for (const node of flow.nodes) {
    const title = `“${nodeTitle(node)}”`;
    switch (node.type) {
      case 'start':
        if (!has(node.id, 'next')) error(node.id, 'Ligue o Início ao primeiro bloco.');
        break;
      case 'message':
        if (!node.data.text?.trim() && !node.data.imageUrl?.trim()) error(node.id, `${title}: escreva o texto da mensagem.`);
        if (!has(node.id, 'next')) error(node.id, `${title}: ligue a saída a um próximo bloco.`);
        break;
      case 'input':
      case 'choice': {
        if (!node.data.label?.trim()) error(node.id, `${NODE_LABELS[node.type]} sem texto da pergunta.`);
        const variable = node.data.variable?.trim();
        if (!variable) error(node.id, `${title}: defina o nome da variável.`);
        else if (SYSTEM_VARIABLES.includes(variable)) error(node.id, `${title}: “${variable}” é uma variável do sistema, escolha outro nome.`);
        else if (variables.has(variable)) warn(node.id, `${title}: a variável “${variable}” também é usada em outra pergunta; a última resposta vale.`);
        if (variable) variables.set(variable, node.id);
        if (node.type === 'choice') {
          const options = node.data.options ?? [];
          if (options.length < 2) error(node.id, `${title}: adicione pelo menos duas opções.`);
          if (options.some((option) => !option.label.trim() || !option.value.trim())) error(node.id, `${title}: há opção sem texto.`);
          if (node.data.multiple || !options.every((option) => has(node.id, option.id))) {
            if (!has(node.id, 'next')) error(node.id, node.data.multiple ? `${title}: ligue a saída a um próximo bloco.` : `${title}: ligue cada opção (ou a saída “Outras”) a um próximo bloco.`);
          }
        } else if (!has(node.id, 'next')) error(node.id, `${title}: ligue a saída a um próximo bloco.`);
        break;
      }
      case 'condition':
        if (!(node.data.rules ?? []).length) error(node.id, `${title}: adicione pelo menos uma regra.`);
        if ((node.data.rules ?? []).some((rule) => !rule.variable)) error(node.id, `${title}: há regra sem variável.`);
        if (!has(node.id, 'yes') || !has(node.id, 'no')) error(node.id, `${title}: ligue as saídas “Sim” e “Não”.`);
        break;
      case 'action':
        if (!(node.data.ops ?? []).length) warn(node.id, `${title}: o bloco não faz nada.`);
        if (!has(node.id, 'next')) error(node.id, `${title}: ligue a saída a um próximo bloco.`);
        break;
      case 'webhook':
        if (!/^https:\/\/\S+$/i.test(node.data.url ?? '')) error(node.id, `${title}: informe uma URL https:// válida.`);
        if (!has(node.id, 'next')) error(node.id, `${title}: ligue a saída a um próximo bloco.`);
        break;
      case 'redirect':
        if (node.data.target === 'link' && !node.data.linkId) error(node.id, `${title}: escolha o link do redirecionador.`);
        if (node.data.target === 'url' && !/^https:\/\/\S+$/i.test(node.data.url ?? '')) error(node.id, `${title}: informe uma URL https:// válida.`);
        if (node.data.target === 'whatsapp' && (node.data.phone ?? '').replace(/\D/g, '').length < 10) error(node.id, `${title}: informe o WhatsApp com DDD.`);
        if (!node.data.target) error(node.id, `${title}: escolha o tipo de destino.`);
        break;
      case 'end':
        if (!node.data.title?.trim() && !node.data.text?.trim()) warn(node.id, `${title}: a tela final está sem texto.`);
        if (node.data.ctaLabel?.trim()) {
          if (node.data.target === 'link' && !node.data.linkId) error(node.id, `${title}: escolha o link do botão.`);
          if (node.data.target === 'url' && !/^https:\/\/\S+$/i.test(node.data.url ?? '')) error(node.id, `${title}: o botão precisa de uma URL https:// válida.`);
          if (node.data.target === 'whatsapp' && (node.data.phone ?? '').replace(/\D/g, '').length < 10) error(node.id, `${title}: informe o WhatsApp do botão com DDD.`);
          if (!node.data.target) error(node.id, `${title}: escolha para onde o botão leva.`);
        } else warn(node.id, `${title}: a tela final não tem botão de ação.`);
        break;
    }
  }

  for (const edge of flow.edges) {
    if (!flow.nodes.some((node) => node.id === edge.target) || !flow.nodes.some((node) => node.id === edge.source)) {
      error(null, 'Há uma ligação apontando para um bloco que não existe mais.');
    }
  }

  // Alcance e ciclos a partir do Início.
  const start = starts[0];
  if (start) {
    const reached = new Set<string>();
    const stack = new Set<string>();
    let cycleAt: string | null = null;
    const walk = (id: string) => {
      if (stack.has(id)) { cycleAt = cycleAt ?? id; return; }
      if (reached.has(id)) return;
      reached.add(id);
      stack.add(id);
      for (const edge of flow.edges.filter((item) => item.source === id)) walk(edge.target);
      stack.delete(id);
    };
    walk(start.id);
    if (cycleAt) error(cycleAt, 'O fluxo tem um caminho que volta para um bloco anterior. Quizzes não podem ter laços.');
    for (const node of flow.nodes) {
      if (!reached.has(node.id)) warn(node.id, `“${nodeTitle(node)}” não está ligado a nenhum caminho a partir do Início.`);
    }
    if (![...reached].some((id) => TERMINAL.includes(flow.nodes.find((node) => node.id === id)?.type ?? 'start'))) {
      error(null, 'Nenhum caminho chega a um bloco Redirecionar ou Finalizar.');
    }
  }

  // Condições que usam variável que nenhuma pergunta grava.
  const known = new Set<string>([...SYSTEM_VARIABLES, ...variables.keys()]);
  for (const node of flow.nodes) for (const op of node.data.ops ?? []) if (op.kind === 'set' && op.variable) known.add(op.variable);
  for (const node of flow.nodes.filter((item) => item.type === 'condition')) {
    for (const rule of node.data.rules ?? []) {
      if (rule.variable && !known.has(rule.variable)) warn(node.id, `“${nodeTitle(node)}”: a variável “${rule.variable}” não é gravada por nenhuma pergunta.`);
    }
  }
  return issues;
}

// ─── modelos ─────────────────────────────────────────────────────────────────

function node(type: QuizNodeType, x: number, y: number, data: QuizNodeData = {}, id = shortId()): QuizNode {
  return { id, type, position: { x, y }, data };
}

function edge(source: string, target: string, sourceHandle: string | null = 'next'): QuizEdge {
  return { id: `e_${source}_${sourceHandle ?? 'next'}_${target}`, source, sourceHandle, target };
}

export function blankFlow(): QuizFlow {
  const start = node('start', 0, 0);
  const name = node('input', 0, 140, { label: 'Qual é o seu nome?', inputKind: 'name', variable: 'nome', required: true });
  const end = node('end', 0, 320, { title: 'Obrigado, {{nome}}!', text: 'Recebemos suas respostas.' });
  return { nodes: [start, name, end], edges: [edge(start.id, name.id), edge(name.id, end.id)] };
}

/** Modelo do serviço de disparo: mínimo de 1.000 contatos em um único disparo. */
export function disparoTemplateFlow(): QuizFlow {
  const start = node('start', 0, 0);
  const name = node('input', 0, 120, { label: 'Qual é o seu nome?', inputKind: 'name', variable: 'nome', required: true });
  const phone = node('input', 0, 260, { label: 'Qual é o seu WhatsApp, {{nome}}?', inputKind: 'phone', placeholder: '(11) 99999-9999', variable: 'whatsapp', required: true });
  const company = node('input', 0, 400, { label: 'Qual é a sua empresa?', inputKind: 'text', variable: 'empresa', required: false });
  const options: ChoiceOption[] = [
    { id: shortId(), label: 'Menos de 1.000', value: 'menos_1000' },
    { id: shortId(), label: 'De 1.000 a 5.000', value: '1000_5000' },
    { id: shortId(), label: 'De 5.000 a 20.000', value: '5000_20000' },
    { id: shortId(), label: 'Mais de 20.000', value: 'mais_20000' },
  ];
  const volume = node('choice', 0, 540, { label: 'Quantos contatos você quer atingir em um único disparo?', variable: 'quantidade_contatos', required: true, options });
  const condition = node('condition', 0, 720, { name: 'Tem pelo menos 1.000 contatos?', combinator: 'and', rules: [{ id: shortId(), variable: 'quantidade_contatos', operator: 'neq', value: 'menos_1000' }] });
  const yes = node('action', -220, 880, { name: 'Qualificado', ops: [{ id: shortId(), kind: 'qualify', qualified: true }, { id: shortId(), kind: 'tag', tag: 'disparo' }] });
  const no = node('action', 220, 880, { name: 'Não qualificado', ops: [{ id: shortId(), kind: 'qualify', qualified: false }] });
  const redirect = node('redirect', -220, 1040, { name: 'Atendimento', target: 'link' });
  const end = node('end', 220, 1040, { title: 'Obrigado, {{nome}}!', text: 'No momento, nosso serviço de disparo atende a partir de 1.000 contatos por disparo. Quando sua base crescer, fale com a gente.' });
  return {
    nodes: [start, name, phone, company, volume, condition, yes, no, redirect, end],
    edges: [
      edge(start.id, name.id), edge(name.id, phone.id), edge(phone.id, company.id), edge(company.id, volume.id),
      edge(volume.id, condition.id), edge(condition.id, yes.id, 'yes'), edge(condition.id, no.id, 'no'),
      edge(yes.id, redirect.id), edge(no.id, end.id),
    ],
  };
}

/** Pergunta do formato antigo (lista). Mantido só para migrar quizzes criados antes do fluxo. */
export interface LegacyQuestion {
  id: string;
  type: 'name' | 'phone' | 'email' | 'text' | 'number' | 'choice';
  label: string;
  placeholder?: string;
  required: boolean;
  min?: number | null;
  options?: { id: string; label: string; qualifies: boolean }[];
}

/**
 * Converte o quiz em lista para fluxo, com os mesmos ids de pergunta e de opção
 * e a mesma regra: começa qualificado; opção que desqualifica ou número abaixo
 * do mínimo marca como não qualificado; no fim, cada resultado vai para o seu destino.
 */
export function legacyToFlow(questions: LegacyQuestion[], qualifiedLinkId: string | null, disqualifiedLinkId: string | null): QuizFlow {
  const nodes: QuizNode[] = [];
  const edges: QuizEdge[] = [];
  const usedVariables = new Set<string>();
  const variableFor = (question: LegacyQuestion) => {
    const base = question.type === 'name' ? 'nome' : question.type === 'phone' ? 'whatsapp' : question.type === 'email' ? 'email' : toVariableName(question.label).split('_').slice(0, 4).join('_') || `pergunta_${question.id}`;
    let name = base;
    for (let suffix = 2; usedVariables.has(name); suffix += 1) name = `${base}_${suffix}`;
    usedVariables.add(name);
    return name;
  };
  let y = 0;
  const start = node('start', 0, y, {}, 'start');
  const initial = node('action', 0, (y += 120), { name: 'Começa qualificado', ops: [{ id: 'op_initial', kind: 'qualify', qualified: true }] }, 'act_initial');
  nodes.push(start, initial);
  edges.push(edge(start.id, initial.id));
  // Saídas que ainda precisam ser ligadas à próxima pergunta.
  let pending: { source: string; handle: string }[] = [{ source: initial.id, handle: 'next' }];
  const connect = (target: string) => {
    for (const item of pending) edges.push(edge(item.source, target, item.handle));
    pending = [];
  };

  for (const question of questions) {
    y += 160;
    if (question.type === 'choice') {
      const options = (question.options ?? []).map((option) => ({ id: option.id, label: option.label, value: toVariableName(option.label) || option.id }));
      const choice = node('choice', 0, y, { label: question.label, variable: variableFor(question), required: question.required, options }, `q_${question.id}`);
      nodes.push(choice);
      connect(choice.id);
      pending.push({ source: choice.id, handle: 'next' });
      const losing = (question.options ?? []).filter((option) => !option.qualifies);
      if (losing.length) {
        const mark = node('action', 260, y + 80, { name: 'Não qualificado', ops: [{ id: `op_${question.id}`, kind: 'qualify', qualified: false }] }, `act_${question.id}`);
        nodes.push(mark);
        for (const option of losing) edges.push(edge(choice.id, mark.id, option.id));
        pending.push({ source: mark.id, handle: 'next' });
        y += 80;
      }
      continue;
    }
    const kind: InputKind = question.type === 'name' || question.type === 'phone' || question.type === 'email' || question.type === 'number' ? question.type : 'text';
    const variable = variableFor(question);
    const input = node('input', 0, y, { label: question.label, inputKind: kind, placeholder: question.placeholder, variable, required: question.required }, `q_${question.id}`);
    nodes.push(input);
    connect(input.id);
    if (kind === 'number' && question.min !== null && question.min !== undefined) {
      const check = node('condition', 0, (y += 140), { name: `Abaixo de ${question.min}?`, combinator: 'and', rules: [{ id: `r_${question.id}`, variable, operator: 'lt', value: String(question.min) }] }, `cond_${question.id}`);
      const mark = node('action', 260, y + 80, { name: 'Não qualificado', ops: [{ id: `op_${question.id}`, kind: 'qualify', qualified: false }] }, `act_${question.id}`);
      nodes.push(check, mark);
      edges.push(edge(input.id, check.id), edge(check.id, mark.id, 'yes'));
      pending.push({ source: check.id, handle: 'no' }, { source: mark.id, handle: 'next' });
      y += 80;
    } else {
      pending.push({ source: input.id, handle: 'next' });
    }
  }

  y += 180;
  const decide = node('condition', 0, y, { name: 'Qualificado?', combinator: 'and', rules: [{ id: 'r_final', variable: 'qualificado', operator: 'eq', value: 'sim' }] }, 'cond_final');
  nodes.push(decide);
  connect(decide.id);
  const qualified = node('redirect', -220, y + 180, { name: 'Qualificado', target: 'link', linkId: qualifiedLinkId ?? undefined }, 'out_qualified');
  const disqualified = disqualifiedLinkId
    ? node('redirect', 220, y + 180, { name: 'Não qualificado', target: 'link', linkId: disqualifiedLinkId }, 'out_disqualified')
    : node('end', 220, y + 180, { name: 'Não qualificado', title: 'Respostas enviadas', text: 'Obrigado! Em breve entraremos em contato.' }, 'out_disqualified');
  nodes.push(qualified, disqualified);
  edges.push(edge(decide.id, qualified.id, 'yes'), edge(decide.id, disqualified.id, 'no'));
  return { nodes, edges };
}
