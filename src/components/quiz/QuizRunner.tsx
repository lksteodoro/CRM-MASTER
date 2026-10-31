import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import {
  currentStep,
  interpolate,
  parseAnswer,
  QuizRunError,
  remainingSteps,
  scopeOf,
  startNode,
  type QuizFlow,
  type QuizNode,
  type QuizValue,
  type RawAnswers,
} from '../../../supabase/functions/_shared/quizFlow.ts';
import { completeQuizSession, sendQuizProgress, startQuizSession, type QuizCompletion } from '../../services/quizzes.service';
import { mix, resolveQuizTheme, type QuizTheme, type ResolvedTheme } from '../../lib/quizTheme';

// ─── tema → variáveis CSS ────────────────────────────────────────────────────

function useFonts(hrefs: string[]) {
  const key = hrefs.join('|');
  useEffect(() => {
    for (const href of key ? key.split('|') : []) {
      if (document.querySelector(`link[data-quiz-font="${href}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.quizFont = href;
      document.head.appendChild(link);
    }
  }, [key]);
}

function cssVars(t: ResolvedTheme): CSSProperties {
  return {
    '--q-primary': t.primary,
    '--q-on-primary': t.onPrimary,
    '--q-primary-hover': mix(t.primary, t.onPrimary === '#ffffff' ? '#ffffff' : '#000000', 0.12),
    '--q-primary-soft': `color-mix(in srgb, ${t.primary} 16%, transparent)`,
    '--q-primary-ring': `color-mix(in srgb, ${t.primary} 45%, transparent)`,
    '--q-gradient': `linear-gradient(135deg, ${t.primary}, ${mix(t.primary, '#ff4fd8', 0.45)})`,
    '--q-bg': t.background,
    '--q-surface': t.surface,
    '--q-surface-hover': mix(t.surface, t.text, 0.06),
    '--q-text': t.text,
    '--q-muted': t.muted,
    '--q-border': t.border,
    '--q-bad': t.error,
    '--q-radius': t.radius,
    // Botão em pílula não pode transformar cartões e imagens em elipses.
    '--q-radius-box': t.radius === '999px' ? '20px' : t.radius,
    '--q-font-body': t.bodyFont,
    '--q-font-heading': t.headingFont,
    '--q-heading-weight': String(t.headingWeight),
    '--q-h-m': `${t.headingMobile}px`,
    '--q-h-d': `${t.headingDesktop}px`,
    '--q-b-m': `${t.bodyMobile}px`,
    '--q-b-d': `${t.bodyDesktop}px`,
    '--q-max': `${t.maxWidth}px`,
    '--q-gap': `${t.gap}px`,
    '--q-duration': `${t.durationMs}ms`,
    '--q-bg-css': t.backgroundCss,
    '--q-bg-pos-d': t.positionDesktop,
    '--q-bg-pos-m': t.positionMobile,
    fontFamily: t.bodyFont,
    textAlign: t.align,
  } as CSSProperties;
}

// Consultas por largura do contêiner (não da janela): a prévia em "celular"
// dentro do editor se comporta igual a um celular de verdade.
const STYLES = `
.quiz-root { container-type: inline-size; position: relative; isolation: isolate; color: var(--q-text); font-size: var(--q-b-m); }
.quiz-bg { position: absolute; inset: 0; z-index: -2; background: var(--q-bg-css); }
.quiz-bg-img { position: absolute; inset: 0; z-index: -2; background-size: cover; background-repeat: no-repeat; }
.quiz-bg-img.d { display: none; background-position: var(--q-bg-pos-d); }
.quiz-bg-img.m { background-position: var(--q-bg-pos-m); }
.quiz-bg-overlay { position: absolute; inset: 0; z-index: -1; }
.quiz-h { font-family: var(--q-font-heading); font-weight: var(--q-heading-weight); font-size: var(--q-h-m); line-height: 1.15; letter-spacing: -0.015em; }
.quiz-h-xl { font-size: calc(var(--q-h-m) * 1.12); }
.quiz-body { font-size: var(--q-b-m); line-height: 1.55; }
.quiz-content { width: 100%; max-width: var(--q-max); margin-inline: auto; }
.quiz-stack > * + * { margin-top: var(--q-gap); }
.quiz-card { background: var(--q-surface); border: 1px solid var(--q-border); border-radius: calc(var(--q-radius-box) + 8px); padding: 24px 20px; box-shadow: 0 30px 80px -40px rgba(0,0,0,.55); }
.quiz-split-media { display: none; }
.quiz-btn { display: inline-flex; min-height: 52px; width: 100%; align-items: center; justify-content: center; gap: .5rem; border-radius: var(--q-radius); padding: 0 2rem; font-weight: 600; font-size: 1rem; transition: filter .15s, transform .15s, background-color .15s; border: 2px solid transparent; }
.quiz-btn:hover:not(:disabled) { transform: translateY(-1px); }
.quiz-btn:disabled { opacity: .6; cursor: progress; }
.quiz-btn.solid { background: var(--q-primary); color: var(--q-on-primary); }
.quiz-btn.solid:hover:not(:disabled) { background: var(--q-primary-hover); }
.quiz-btn.gradient { background: var(--q-gradient); color: #fff; }
.quiz-btn.gradient:hover:not(:disabled) { filter: brightness(1.08); }
.quiz-btn.outline { border-color: var(--q-primary); color: var(--q-primary); background: transparent; }
.quiz-btn.outline:hover:not(:disabled) { background: var(--q-primary-soft); }
.quiz-btn.soft { background: var(--q-primary-soft); color: var(--q-primary); }
.quiz-btn.shadow { box-shadow: 0 14px 30px -14px var(--q-primary); }
.quiz-option { transition: border-color .15s, background-color .15s, transform .15s, box-shadow .15s; }
.quiz-option:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--q-primary); box-shadow: 0 8px 24px -14px var(--q-primary); }
.quiz-option:focus-visible, .quiz-btn:focus-visible, .quiz-link:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--q-primary-ring); }
.quiz-field { font-size: calc(var(--q-h-m) * .85); }
.quiz-field::placeholder { color: var(--q-muted); opacity: .7; }
.quiz-field:focus { border-color: var(--q-primary); }
@keyframes quiz-in-slide { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes quiz-in-slide-x { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes quiz-in-scale { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
@keyframes quiz-in-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes quiz-pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
@keyframes quiz-press { 0% { transform: scale(1); } 40% { transform: scale(.97); } 100% { transform: scale(1); } }
.quiz-enter-slide { animation: quiz-in-slide var(--q-duration) cubic-bezier(.2,.8,.2,1) both; }
.quiz-enter-slide-x { animation: quiz-in-slide-x var(--q-duration) cubic-bezier(.2,.8,.2,1) both; }
.quiz-enter-scale { animation: quiz-in-scale var(--q-duration) cubic-bezier(.2,.8,.2,1) both; }
.quiz-enter-fade { animation: quiz-in-fade var(--q-duration) ease-out both; }
.quiz-pop { animation: quiz-pop .35s cubic-bezier(.2,.8,.2,1) both; }
.quiz-press { animation: quiz-press .28s ease-out; }
@container (min-width: 640px) {
  .quiz-root { font-size: var(--q-b-d); }
  .quiz-h { font-size: var(--q-h-d); }
  .quiz-h-xl { font-size: calc(var(--q-h-d) * 1.12); }
  .quiz-body { font-size: var(--q-b-d); }
  .quiz-field { font-size: calc(var(--q-h-d) * .8); }
  .quiz-bg-img.d { display: block; }
  .quiz-bg-img.m { display: none; }
  .quiz-card { padding: 40px; }
  .quiz-btn:not(.full) { width: auto; }
  .quiz-desk { display: inline; }
}
@container (min-width: 960px) {
  .quiz-split { display: grid; grid-template-columns: 1fr 1fr; min-height: 100%; }
  .quiz-split-media { display: block; background-size: cover; background-position: center; }
}
.quiz-desk { display: none; }
@media (prefers-reduced-motion: reduce) {
  .quiz-root *, .quiz-root *::before, .quiz-root *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;

// ─── máscaras ────────────────────────────────────────────────────────────────

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
  return `+${digits}`;
}

function formatNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return digits ? Number(digits).toLocaleString('pt-BR') : '';
}

// ─── progresso salvo (continuar de onde parou) ──────────────────────────────

interface SavedProgress {
  versionId: string;
  sessionId: string | null;
  answers: RawAnswers;
  order: string[];
  at: number;
}

const SAVE_TTL = 7 * 24 * 60 * 60 * 1000;

function readSaved(key: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedProgress;
    return Date.now() - parsed.at < SAVE_TTL ? parsed : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, value: SavedProgress | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // Navegação anônima ou armazenamento bloqueado: o quiz segue sem retomar.
  }
}

function utmContext(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const context: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = params.get(key);
    if (value) context[key] = value;
  }
  return context;
}

// ─── prévia estática de uma tela (editor de aparência) ──────────────────────

export type PreviewScreen = { kind: 'welcome' } | { kind: 'node'; nodeId: string };

/** Respostas de exemplo para a prévia: nunca dados reais de leads. */
function sampleScope(flow: QuizFlow): Record<string, QuizValue> {
  const scope: Record<string, QuizValue> = { qualificado: true, pontuacao: 40, tags: [] };
  const samples: Record<string, string> = { name: 'Maria', phone: '(11) 98888-7777', email: 'maria@empresa.com', number: '5000', text: 'Empresa Exemplo' };
  for (const node of flow.nodes) {
    if (!node.data.variable) continue;
    if (node.type === 'input') scope[node.data.variable] = samples[node.data.inputKind ?? 'text'];
    if (node.type === 'choice') scope[node.data.variable] = node.data.options?.[1]?.label ?? node.data.options?.[0]?.label ?? '';
  }
  return scope;
}

/** Posição aproximada de um bloco no caminho mais curto a partir do Início (para a barra na prévia). */
function previewPosition(flow: QuizFlow, nodeId: string) {
  const start = startNode(flow);
  if (!start) return 0;
  const interactive = new Set(['message', 'input', 'choice']);
  const queue: [string, number][] = [[start.id, 0]];
  const seen = new Set([start.id]);
  while (queue.length) {
    const [id, depth] = queue.shift()!;
    if (id === nodeId) return depth;
    const node = flow.nodes.find((item) => item.id === id);
    const next = depth + (node && interactive.has(node.type) ? 1 : 0);
    for (const edge of flow.edges.filter((item) => item.source === id)) {
      if (!seen.has(edge.target)) { seen.add(edge.target); queue.push([edge.target, next]); }
    }
  }
  return 0;
}

// ─── componente ──────────────────────────────────────────────────────────────

export type QuizRunnerProps = {
  flow: QuizFlow;
  theme?: QuizTheme;
  title: string;
} & (
  | { mode: 'live'; slug: string; versionId: string }
  | { mode: 'preview'; describeTarget: (node: QuizNode) => string; screen?: PreviewScreen }
);

type Ending =
  | { kind: 'end'; title: string; text: string; cta?: { label: string; href: string | null } | null }
  | { kind: 'preview-redirect'; target: string };

export function QuizRunner(props: QuizRunnerProps) {
  const { flow, title } = props;
  const resolved = resolveQuizTheme(props.theme);
  const theme = resolved.theme;
  useFonts(resolved.fontHrefs);
  const live = props.mode === 'live';
  const staticScreen = props.mode === 'preview' ? props.screen : undefined;
  const storageKey = live ? `quiz-progress:${props.slug}` : '';
  const context = useMemo(() => (live ? utmContext() : {}), [live]);

  const [answers, setAnswers] = useState<RawAnswers>({});
  const [order, setOrder] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<RawAnswers>({});
  const [welcome, setWelcome] = useState(Boolean(theme.welcome?.enabled));
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const startingRef = useRef<Promise<string | null> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Retoma o progresso salvo da mesma versão do quiz.
  useEffect(() => {
    if (!live) return;
    const saved = readSaved(storageKey);
    if (saved && saved.versionId === props.versionId && saved.order.length > 0) {
      setAnswers(saved.answers);
      setOrder(saved.order);
      sessionRef.current = saved.sessionId;
      setResumed(true);
      setWelcome(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = useMemo(() => {
    if (staticScreen) return null;
    try {
      return currentStep(flow, answers, context);
    } catch {
      return null;
    }
  }, [flow, answers, context, staticScreen]);

  const ensureSession = useCallback(async () => {
    if (!live) return null;
    if (sessionRef.current) return sessionRef.current;
    if (!startingRef.current) {
      startingRef.current = startQuizSession(props.slug, props.versionId, context)
        .then((result) => { sessionRef.current = result.session_id; return result.session_id; })
        .catch(() => { startingRef.current = null; return null; });
    }
    return startingRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, context]);

  const finish = useCallback(async (finalAnswers: RawAnswers) => {
    if (!step || step.status !== 'done') return;
    const terminal = step.node;
    const scope = scopeOf(step.state);
    if (!live) {
      if (terminal?.type === 'redirect') setEnding({ kind: 'preview-redirect', target: props.mode === 'preview' ? props.describeTarget(terminal) : '' });
      else setEnding({
        kind: 'end',
        title: interpolate(terminal?.data.title || 'Respostas enviadas', scope),
        text: interpolate(terminal?.data.text || '', scope),
        cta: terminal?.data.ctaLabel ? { label: interpolate(terminal.data.ctaLabel, scope), href: null } : null,
      });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const sessionId = await ensureSession();
      if (!sessionId) throw new Error('session');
      const result: QuizCompletion = await completeQuizSession(sessionId, finalAnswers);
      writeSaved(storageKey, null);
      if (result.kind === 'redirect') {
        window.location.href = result.href;
        return;
      }
      setEnding({ kind: 'end', title: result.title, text: result.text, cta: result.cta ?? null });
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      if (code === 'already_completed') {
        writeSaved(storageKey, null);
        setEnding({ kind: 'end', title: 'Respostas já enviadas', text: 'Recebemos suas respostas. Obrigado!' });
      } else {
        setError('Não conseguimos enviar agora. Verifique a conexão e tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, live, ensureSession, storageKey]);

  // Chegou a um bloco final: envia (ou mostra a prévia).
  useEffect(() => {
    if (step?.status === 'done' && !ending && !submitting && !error) void finish(answers);
  }, [step, ending, submitting, error, finish, answers]);

  const currentNodeId = step?.status === 'pending' ? step.node?.id : undefined;
  useEffect(() => {
    if (!welcome && !staticScreen) window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
  }, [currentNodeId, welcome, staticScreen]);

  function commit(nodeId: string, value: string | string[]) {
    const nextAnswers = { ...answers, [nodeId]: value };
    const nextOrder = [...order.filter((id) => id !== nodeId), nodeId];
    setAnswers(nextAnswers);
    setOrder(nextOrder);
    setError(null);
    if (live) {
      writeSaved(storageKey, { versionId: props.versionId, sessionId: sessionRef.current, answers: nextAnswers, order: nextOrder, at: Date.now() });
      void ensureSession().then((sessionId) => {
        if (!sessionId) return;
        writeSaved(storageKey, { versionId: props.versionId, sessionId, answers: nextAnswers, order: nextOrder, at: Date.now() });
        void sendQuizProgress(sessionId, nextAnswers).catch(() => undefined);
      });
    }
  }

  function submitCurrent(node: QuizNode, value: string | string[]) {
    if (staticScreen) return;
    if (node.type === 'message') {
      commit(node.id, 'ok');
      return;
    }
    try {
      parseAnswer(node, value);
    } catch (caught) {
      setError(caught instanceof QuizRunError ? caught.message : 'Resposta inválida.');
      return;
    }
    commit(node.id, value);
  }

  function goBack() {
    if (!order.length || submitting || staticScreen) return;
    const last = order[order.length - 1];
    const nextOrder = order.slice(0, -1);
    const kept: RawAnswers = {};
    for (const id of nextOrder) kept[id] = answers[id];
    setDrafts((current) => ({ ...current, [last]: answers[last] }));
    setAnswers(kept);
    setOrder(nextOrder);
    setError(null);
    if (live) writeSaved(storageKey, { versionId: props.versionId, sessionId: sessionRef.current, answers: kept, order: nextOrder, at: Date.now() });
  }

  function restart() {
    writeSaved(storageKey, null);
    sessionRef.current = null;
    startingRef.current = null;
    setAnswers({});
    setOrder([]);
    setDrafts({});
    setResumed(false);
    setEnding(null);
    setError(null);
    setWelcome(Boolean(theme.welcome?.enabled));
  }

  // ── o que mostrar ──
  const sample = useMemo(() => (staticScreen ? sampleScope(flow) : null), [staticScreen, flow]);
  const staticNode = staticScreen?.kind === 'node' ? flow.nodes.find((node) => node.id === staticScreen.nodeId) ?? null : null;
  const node: QuizNode | null = staticScreen ? (staticNode && ['message', 'input', 'choice'].includes(staticNode.type) ? staticNode : null) : step?.status === 'pending' ? step.node : null;
  const scope: Record<string, QuizValue> = sample ?? (step ? scopeOf(step.state) : {});
  const staticEnding: Ending | null = staticNode && (staticNode.type === 'end' || staticNode.type === 'redirect')
    ? staticNode.type === 'redirect'
      ? { kind: 'preview-redirect', target: props.mode === 'preview' ? props.describeTarget(staticNode) : '' }
      : { kind: 'end', title: interpolate(staticNode.data.title || 'Respostas enviadas', scope), text: interpolate(staticNode.data.text || '', scope), cta: staticNode.data.ctaLabel ? { label: interpolate(staticNode.data.ctaLabel, scope), href: null } : null }
    : null;
  const shownEnding = staticScreen ? staticEnding : ending;
  const showWelcome = staticScreen ? staticScreen.kind === 'welcome' : welcome && !ending;

  // Progresso pelo caminho real: respondidas ÷ (respondidas + o maior caminho que ainda falta).
  const answered = staticNode ? previewPosition(flow, staticNode.id) : order.length;
  const remaining = node ? remainingSteps(flow, node.id) : 0;
  const total = answered + remaining;
  const percent = shownEnding || step?.status === 'done' ? 100 : total ? Math.round((answered / total) * 100) : 0;
  const animation = resolved.transition === 'none' ? '' : `quiz-enter-${resolved.transition}`;
  const buttonClass = `quiz-btn ${resolved.buttonStyle}${resolved.buttonShadow ? ' shadow' : ''}${resolved.buttonFullWidth ? ' full' : ''}`;
  const centered = resolved.align === 'center';

  const shell = (content: ReactNode, opts: { showProgress?: boolean; showBack?: boolean } = {}) => {
    const body = (
      <div className="flex min-h-full w-full flex-col">
        <header className="quiz-content flex items-center gap-4 px-5 pt-5">
          {theme.logoUrl ? <img src={theme.logoUrl} alt={title} className="h-8 max-w-[140px] object-contain" /> : <span className="text-sm font-semibold text-[var(--q-muted)]">{title}</span>}
          {opts.showProgress && theme.progress !== 'none' && (
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Progresso do quiz">
              {theme.progress === 'steps' ? (
                <span className="text-xs font-medium text-[var(--q-muted)]">Etapa {Math.min(answered + 1, Math.max(total, 1))} de até {Math.max(total, 1)}</span>
              ) : (
                <>
                  <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-[var(--q-border)]">
                    <div className="h-full rounded-full bg-[var(--q-primary)] transition-[width] duration-500 ease-out" style={{ width: `${Math.max(percent, 4)}%` }} />
                  </div>
                  {theme.progress === 'percent' && <span className="w-9 text-right text-xs font-semibold tabular-nums text-[var(--q-muted)]">{percent}%</span>}
                </>
              )}
            </div>
          )}
        </header>
        <main className="flex flex-1 flex-col justify-center px-5 py-8">
          <div className={`quiz-content ${resolved.layoutMode === 'card' ? 'quiz-card' : ''}`}>{content}</div>
        </main>
        <footer className="quiz-content flex items-center justify-between px-5 pb-6 text-xs text-[var(--q-muted)]">
          {opts.showBack && (order.length > 0 || (staticScreen && answered > 0)) ? (
            <button type="button" onClick={goBack} disabled={submitting} className="quiz-link inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 font-medium hover:text-[var(--q-text)]"><ArrowLeft size={15} /> Voltar</button>
          ) : <span />}
          {resumed && !ending && <button type="button" onClick={restart} className="quiz-link inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 hover:text-[var(--q-text)]"><RotateCcw size={13} /> Recomeçar</button>}
        </footer>
      </div>
    );
    const sideImage = theme.layout?.sideImage || resolved.imageDesktop;
    return (
      <div style={cssVars(resolved)} className="quiz-root flex min-h-full w-full flex-col">
        <style>{STYLES}</style>
        <div className="quiz-bg" aria-hidden="true" />
        {resolved.imageMobile && <div className="quiz-bg-img m" aria-hidden="true" style={{ backgroundImage: `url("${resolved.imageMobile}")`, filter: resolved.blur ? `blur(${resolved.blur}px)` : undefined }} />}
        {resolved.imageDesktop && <div className="quiz-bg-img d" aria-hidden="true" style={{ backgroundImage: `url("${resolved.imageDesktop}")`, filter: resolved.blur ? `blur(${resolved.blur}px)` : undefined }} />}
        {resolved.overlay && <div className="quiz-bg-overlay" aria-hidden="true" style={{ background: resolved.overlay }} />}
        {resolved.layoutMode === 'split' && sideImage ? (
          <div className="quiz-split flex-1">
            <div className="quiz-split-media" aria-hidden="true" style={{ backgroundImage: `url("${sideImage}")` }} />
            {body}
          </div>
        ) : body}
      </div>
    );
  };

  // Tela inicial
  if (showWelcome) {
    const intro = theme.welcome ?? {};
    return shell(
      <div className={`${animation} quiz-stack`}>
        {intro.imageUrl && <img src={intro.imageUrl} alt="" className="aspect-[16/9] w-full rounded-[var(--q-radius-box)] object-cover" />}
        <div>
          {intro.badge && <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--q-primary-soft)] px-3 py-1 text-xs font-semibold text-[var(--q-primary)]"><Sparkles size={13} /> {intro.badge}</span>}
          <h1 className="quiz-h quiz-h-xl mt-4">{intro.title || title}</h1>
          {intro.subtitle && <p className="quiz-body mt-3 text-[var(--q-muted)]">{intro.subtitle}</p>}
        </div>
        <div className={`flex flex-col gap-3 ${centered ? 'items-center' : 'items-stretch'}`}>
          <button type="button" onClick={() => { if (staticScreen) return; setWelcome(false); void ensureSession(); }} className={buttonClass}>
            {intro.buttonLabel || 'Começar'} <ArrowRight size={18} />
          </button>
          {intro.note && <span className="text-sm text-[var(--q-muted)]">{intro.note}</span>}
        </div>
        {intro.privacy && <p className="text-xs leading-relaxed text-[var(--q-muted)]">{intro.privacy}</p>}
      </div>
    );
  }

  // Tela final
  if (shownEnding) {
    if (shownEnding.kind === 'preview-redirect') {
      return shell(
        <div className={`${animation} text-center`}>
          <span className="quiz-pop mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--q-primary-soft)] text-[var(--q-primary)]"><ArrowRight size={24} /></span>
          <h2 className="quiz-h mt-5">Redirecionamento</h2>
          <p className="quiz-body mt-2 text-[var(--q-muted)]">No quiz publicado, o lead iria agora para:</p>
          <p className="mt-2 break-all font-semibold text-[var(--q-primary)]">{shownEnding.target}</p>
          {!staticScreen && <button type="button" onClick={restart} className="quiz-link mt-8 inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--q-muted)] hover:text-[var(--q-text)]"><RotateCcw size={14} /> Testar de novo</button>}
        </div>
      );
    }
    return shell(
      <div className={`${animation} text-center`}>
        <span className="quiz-pop mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--q-primary)] text-[var(--q-on-primary)]"><Check size={30} strokeWidth={2.5} /></span>
        <h2 className="quiz-h mt-6">{shownEnding.title}</h2>
        {shownEnding.text && <p className="quiz-body mx-auto mt-3 max-w-lg whitespace-pre-line text-[var(--q-muted)]">{shownEnding.text}</p>}
        {shownEnding.cta && (
          <div className="mt-8">
            {shownEnding.cta.href
              ? <a href={shownEnding.cta.href} className={buttonClass}>{shownEnding.cta.label} <ArrowRight size={18} /></a>
              : <span className={`${buttonClass} cursor-default`}>{shownEnding.cta.label} <ArrowRight size={18} /></span>}
          </div>
        )}
        {!live && !staticScreen && <div><button type="button" onClick={restart} className="quiz-link mt-8 inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--q-muted)] hover:text-[var(--q-text)]"><RotateCcw size={14} /> Testar de novo</button></div>}
      </div>
    );
  }

  if (!staticScreen && !step) {
    return shell(<p className="text-center text-sm text-[var(--q-muted)]">Este quiz tem um problema no fluxo e não pode ser exibido.</p>);
  }

  if (!node) {
    if (staticScreen) return shell(<p className="text-center text-sm text-[var(--q-muted)]">Este bloco não aparece para o lead (é lógica do fluxo). Escolha uma pergunta, mensagem ou tela final.</p>);
    return shell(
      <div className="flex flex-col items-center gap-3 text-center">
        {error ? (
          <>
            <p role="alert" className="text-sm text-[var(--q-bad)]">{error}</p>
            <button type="button" onClick={() => { setError(null); void finish(answers); }} className={buttonClass}><RotateCcw size={15} /> Tentar de novo</button>
          </>
        ) : (
          <><Loader2 className="animate-spin text-[var(--q-primary)]" size={28} /><p className="text-sm text-[var(--q-muted)]">Enviando suas respostas...</p></>
        )}
      </div>,
      { showProgress: true, showBack: Boolean(error) }
    );
  }

  const label = interpolate(node.data.label ?? '', scope);
  const encouragement = percent >= 75 ? 'Falta pouco!' : percent >= 50 ? 'Mais da metade concluída' : null;

  return shell(
    <div key={node.id} className={animation}>
      {encouragement && theme.progress !== 'none' && <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--q-primary)]">{encouragement}</p>}
      {node.type === 'message' ? (
        <MessageStep node={node} scope={scope} buttonClass={buttonClass} onContinue={() => submitCurrent(node, 'ok')} />
      ) : node.type === 'choice' ? (
        <ChoiceStep
          node={node}
          label={label}
          resolved={resolved}
          buttonClass={buttonClass}
          initial={answers[node.id] ?? drafts[node.id]}
          pressed={pressed}
          onPick={(optionId) => {
            setPressed(optionId);
            // Deixa a seleção aparecer antes de trocar de tela.
            window.setTimeout(() => { setPressed(null); submitCurrent(node, optionId); }, 260);
          }}
          onSubmit={(value) => submitCurrent(node, value)}
        />
      ) : (
        <InputStep key={node.id} node={node} label={label} inputRef={inputRef} buttonClass={buttonClass} continueLabel={resolved.continueLabel} initial={(drafts[node.id] as string | undefined) ?? ''} onSubmit={(value) => submitCurrent(node, value)} />
      )}
      {error && <p role="alert" aria-live="assertive" className="mt-4 text-sm font-medium text-[var(--q-bad)]">{error}</p>}
    </div>,
    { showProgress: true, showBack: true }
  );
}

// ─── telas por tipo de bloco ─────────────────────────────────────────────────

function MessageStep({ node, scope, buttonClass, onContinue }: { node: QuizNode; scope: Record<string, QuizValue>; buttonClass: string; onContinue: () => void }) {
  return (
    <div className="quiz-stack">
      {node.data.imageUrl && <img src={node.data.imageUrl} alt="" className="max-h-72 w-full rounded-[var(--q-radius-box)] object-cover" />}
      <p className="quiz-h whitespace-pre-line">{interpolate(node.data.text, scope)}</p>
      <div><button type="button" autoFocus onClick={onContinue} className={buttonClass}>{node.data.buttonLabel || 'Continuar'} <ArrowRight size={18} /></button></div>
    </div>
  );
}

function ChoiceStep({ node, label, resolved, buttonClass, initial, pressed, onPick, onSubmit }: { node: QuizNode; label: string; resolved: ResolvedTheme; buttonClass: string; initial: string | string[] | undefined; pressed: string | null; onPick: (id: string) => void; onSubmit: (value: string | string[]) => void }) {
  const options = useMemo(() => node.data.options ?? [], [node.data.options]);
  const multiple = Boolean(node.data.multiple);
  // Sem avanço automático, a escolha única também pede "Continuar".
  const needsButton = multiple || !resolved.autoAdvance;
  const [selected, setSelected] = useState<string[]>(() => (Array.isArray(initial) ? initial : initial ? [initial] : []));
  const style = resolved.answerStyle;

  const choose = useCallback((id: string) => {
    if (multiple) setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    else if (!resolved.autoAdvance) setSelected([id]);
    else if (!pressed) onPick(id);
  }, [multiple, resolved.autoAdvance, pressed, onPick]);

  // Teclas A, B, C... escolhem a opção.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      if (event.key.length !== 1 || index < 0 || index >= options.length) return;
      event.preventDefault();
      choose(options[index].id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, choose]);

  return (
    <fieldset>
      <legend className="quiz-h">{label}{node.data.required === false && <span className="ml-2 text-sm font-normal text-[var(--q-muted)]">(opcional)</span>}</legend>
      {multiple && <p className="mt-2 text-sm text-[var(--q-muted)]">Escolha quantas quiser.</p>}
      <div className={`mt-7 grid ${style === 'compact' ? 'grid-cols-2 gap-2' : style === 'list' ? 'gap-2' : 'gap-3'}`} role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
        {options.map((option, index) => {
          const active = pressed === option.id || selected.includes(option.id);
          const badge = option.emoji || (resolved.showLetters ? String.fromCharCode(65 + index) : null);
          return (
            <button
              key={option.id}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={active}
              disabled={Boolean(pressed)}
              onClick={() => choose(option.id)}
              className={`quiz-option ${pressed === option.id ? 'quiz-press' : ''} flex w-full items-center text-left font-medium ${
                style === 'compact' ? 'min-h-[48px] gap-2 rounded-[calc(var(--q-radius)*.8)] border px-3 py-2 text-sm' : style === 'list' ? 'min-h-[52px] gap-3 rounded-[calc(var(--q-radius)*.8)] border px-4 py-2.5' : 'min-h-[60px] gap-4 rounded-[var(--q-radius)] border-2 px-4 py-3'
              } ${active ? 'border-[var(--q-primary)] bg-[var(--q-primary-soft)]' : 'border-[var(--q-border)] bg-[var(--q-surface)]'}`}
            >
              {badge && style !== 'compact' && (
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[calc(var(--q-radius)*.6)] text-sm font-bold ${option.emoji ? 'text-xl' : ''} ${active ? 'bg-[var(--q-primary)] text-[var(--q-on-primary)]' : 'bg-[var(--q-surface-hover)] text-[var(--q-muted)]'}`}>{badge}</span>
              )}
              {style === 'compact' && option.emoji && <span className="text-lg">{option.emoji}</span>}
              <span className="flex-1">{option.label}</span>
              {active && <Check size={20} className="quiz-pop shrink-0 text-[var(--q-primary)]" strokeWidth={2.5} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {needsButton && (
        <div className="mt-7"><button type="button" onClick={() => onSubmit(multiple ? selected : selected[0] ?? '')} className={buttonClass}>{resolved.continueLabel} <ArrowRight size={18} /></button></div>
      )}
      {!needsButton && resolved.showLetters && <p className="quiz-desk mt-5 text-xs text-[var(--q-muted)]">Dica: use as teclas {options.slice(0, 4).map((_, index) => String.fromCharCode(65 + index)).join(', ')}{options.length > 4 ? '…' : ''} para escolher.</p>}
    </fieldset>
  );
}

function InputStep({ node, label, inputRef, buttonClass, continueLabel, initial, onSubmit }: { node: QuizNode; label: string; inputRef: React.RefObject<HTMLInputElement | null>; buttonClass: string; continueLabel: string; initial: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const kind = node.data.inputKind ?? 'text';
  const id = `quiz-field-${node.id}`;
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(value); }}>
      <label htmlFor={id} className="quiz-h block">{label}{node.data.required === false && <span className="ml-2 text-sm font-normal text-[var(--q-muted)]">(opcional)</span>}</label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(kind === 'phone' ? formatPhone(event.target.value) : kind === 'number' ? formatNumber(event.target.value) : event.target.value)}
        type={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text'}
        inputMode={kind === 'phone' ? 'tel' : kind === 'number' ? 'numeric' : kind === 'email' ? 'email' : 'text'}
        autoComplete={kind === 'name' ? 'name' : kind === 'phone' ? 'tel' : kind === 'email' ? 'email' : 'off'}
        enterKeyHint="next"
        aria-required={node.data.required !== false}
        placeholder={node.data.placeholder || 'Digite sua resposta'}
        className="quiz-field mt-7 w-full border-0 border-b-2 border-[var(--q-border)] bg-transparent pb-3 text-[var(--q-text)] outline-none transition-colors"
      />
      <div className="mt-8 flex items-center gap-4">
        <button type="submit" className={buttonClass}>{continueLabel} <ArrowRight size={18} /></button>
        <span className="quiz-desk text-xs text-[var(--q-muted)]">ou pressione <strong>Enter ↵</strong></span>
      </div>
    </form>
  );
}
