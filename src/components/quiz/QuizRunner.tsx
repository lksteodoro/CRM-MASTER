import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import {
  currentStep,
  interpolate,
  parseAnswer,
  QuizRunError,
  remainingSteps,
  scopeOf,
  type QuizFlow,
  type QuizNode,
  type RawAnswers,
} from '../../../supabase/functions/_shared/quizFlow.ts';
import {
  completeQuizSession,
  DEFAULT_THEME,
  sendQuizProgress,
  startQuizSession,
  type QuizCompletion,
  type QuizTheme,
} from '../../services/quizzes.service';

// ─── tema ────────────────────────────────────────────────────────────────────

const FONTS: Record<NonNullable<QuizTheme['font']>, { family: string; href: string | null }> = {
  jakarta: { family: "'Plus Jakarta Sans', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap' },
  inter: { family: "'Inter', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
  nunito: { family: "'Nunito', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap' },
  serif: { family: "'Fraunces', Georgia, serif", href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap' },
};

function useFont(font: NonNullable<QuizTheme['font']>) {
  useEffect(() => {
    const href = FONTS[font].href;
    if (!href || document.querySelector(`link[data-quiz-font="${font}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.quizFont = font;
    document.head.appendChild(link);
  }, [font]);
}

function readableOn(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return '#ffffff';
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.45 ? '#0b0d12' : '#ffffff';
}

export function resolveTheme(theme: QuizTheme | undefined) {
  const merged = { ...DEFAULT_THEME, ...theme, welcome: { ...DEFAULT_THEME.welcome, ...theme?.welcome } };
  const primary = /^#[0-9a-f]{6}$/i.test(merged.primaryColor ?? '') ? merged.primaryColor! : DEFAULT_THEME.primaryColor!;
  const light = merged.mode === 'light';
  const radius = merged.buttonShape === 'pill' ? '999px' : merged.buttonShape === 'square' ? '6px' : '14px';
  const vars = {
    '--q-primary': primary,
    '--q-on-primary': readableOn(primary),
    '--q-primary-soft': `color-mix(in srgb, ${primary} 14%, transparent)`,
    '--q-primary-ring': `color-mix(in srgb, ${primary} 45%, transparent)`,
    '--q-bg': light ? '#f5f6fa' : '#0b0d12',
    '--q-surface': light ? '#ffffff' : '#141821',
    '--q-surface-hover': light ? '#f0f2f8' : '#1a1f2b',
    '--q-text': light ? '#11131a' : '#f3f4f7',
    '--q-muted': light ? '#5a6072' : '#9aa2b4',
    '--q-border': light ? '#dfe2ec' : '#262c3a',
    '--q-bad': light ? '#c4314b' : '#ff7a8a',
    '--q-radius': radius,
    fontFamily: FONTS[merged.font ?? 'jakarta'].family,
  } as CSSProperties;
  return { theme: merged, vars };
}

const STYLES = `
@keyframes quiz-in-slide { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes quiz-in-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes quiz-pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
@keyframes quiz-press { 0% { transform: scale(1); } 40% { transform: scale(.97); } 100% { transform: scale(1); } }
.quiz-enter-slide { animation: quiz-in-slide .42s cubic-bezier(.2,.8,.2,1) both; }
.quiz-enter-fade { animation: quiz-in-fade .35s ease-out both; }
.quiz-pop { animation: quiz-pop .35s cubic-bezier(.2,.8,.2,1) both; }
.quiz-press { animation: quiz-press .28s ease-out; }
.quiz-option { transition: border-color .15s, background-color .15s, transform .15s, box-shadow .15s; }
.quiz-option:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--q-primary); box-shadow: 0 8px 24px -14px var(--q-primary); }
.quiz-option:focus-visible, .quiz-button:focus-visible, .quiz-link:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--q-primary-ring); }
.quiz-field::placeholder { color: var(--q-muted); opacity: .7; }
.quiz-field:focus { border-color: var(--q-primary); }
.quiz-button { transition: filter .15s, transform .15s; }
.quiz-button:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
@media (prefers-reduced-motion: reduce) {
  .quiz-enter-slide, .quiz-enter-fade, .quiz-pop, .quiz-press { animation: none !important; }
  .quiz-option, .quiz-button { transition: none !important; }
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

// ─── componente ──────────────────────────────────────────────────────────────

export type QuizRunnerProps = {
  flow: QuizFlow;
  theme?: QuizTheme;
  title: string;
} & (
  | { mode: 'live'; slug: string; versionId: string }
  | { mode: 'preview'; describeTarget: (node: QuizNode) => string; frame?: 'mobile' | 'desktop' }
);

type Ending =
  | { kind: 'end'; title: string; text: string; cta?: { label: string; href: string | null } | null }
  | { kind: 'preview-redirect'; target: string };

export function QuizRunner(props: QuizRunnerProps) {
  const { flow, title } = props;
  const { theme, vars } = resolveTheme(props.theme);
  useFont(theme.font ?? 'jakarta');
  const live = props.mode === 'live';
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
    try {
      return currentStep(flow, answers, context);
    } catch {
      return null;
    }
  }, [flow, answers, context]);
  const node = step?.status === 'pending' ? step.node : null;
  const scope = step ? scopeOf(step.state) : {};

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
    if (!live) {
      if (terminal?.type === 'redirect') setEnding({ kind: 'preview-redirect', target: props.describeTarget(terminal) });
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

  useEffect(() => {
    if (!welcome) window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [node?.id, welcome]);

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

  function submitCurrent(value: string | string[]) {
    if (!node) return;
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
    if (!order.length || submitting) return;
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

  // Progresso pelo caminho real: respondidas ÷ (respondidas + o maior caminho que ainda falta).
  const answered = order.length;
  const remaining = node ? remainingSteps(flow, node.id) : 0;
  const total = answered + remaining;
  const percent = ending || step?.status === 'done' ? 100 : total ? Math.round((answered / total) * 100) : 0;
  const animation = theme.transition === 'none' ? '' : theme.transition === 'fade' ? 'quiz-enter-fade' : 'quiz-enter-slide';

  const shell = (content: ReactNode, opts: { showProgress?: boolean; showBack?: boolean } = {}) => (
    <div style={vars} className="flex min-h-full w-full flex-col bg-[var(--q-bg)] text-[var(--q-text)]">
      <style>{STYLES}</style>
      <header className="mx-auto flex w-full max-w-2xl items-center gap-4 px-5 pt-5 sm:pt-8">
        {theme.logoUrl ? <img src={theme.logoUrl} alt="" className="h-8 max-w-[140px] object-contain" /> : <span className="text-sm font-semibold text-[var(--q-muted)]">{title}</span>}
        {opts.showProgress && theme.progress !== 'none' && (
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3" aria-label={`Progresso: ${percent}%`}>
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
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-8 sm:py-12">{content}</main>
      <footer className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 pb-6 text-xs text-[var(--q-muted)]">
        {opts.showBack && order.length > 0 ? (
          <button type="button" onClick={goBack} disabled={submitting} className="quiz-link inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 font-medium hover:text-[var(--q-text)]"><ArrowLeft size={15} /> Voltar</button>
        ) : <span />}
        {resumed && !ending && <button type="button" onClick={restart} className="quiz-link inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 hover:text-[var(--q-text)]"><RotateCcw size={13} /> Recomeçar</button>}
      </footer>
    </div>
  );

  // Tela inicial
  if (welcome && !ending) {
    const intro = theme.welcome ?? {};
    return shell(
      <div className={`${animation} text-center sm:text-left`}>
        {intro.imageUrl && <img src={intro.imageUrl} alt="" className="mb-7 aspect-[16/9] w-full rounded-[var(--q-radius)] object-cover" />}
        {intro.badge && <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--q-primary-soft)] px-3 py-1 text-xs font-semibold text-[var(--q-primary)]"><Sparkles size={13} /> {intro.badge}</span>}
        <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{intro.title || title}</h1>
        {intro.subtitle && <p className="mt-3 text-base leading-relaxed text-[var(--q-muted)] sm:text-lg">{intro.subtitle}</p>}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <button type="button" onClick={() => { setWelcome(false); void ensureSession(); }} className="quiz-button inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--q-radius)] bg-[var(--q-primary)] px-8 text-base font-semibold text-[var(--q-on-primary)] sm:w-auto">
            {intro.buttonLabel || 'Começar'} <ArrowRight size={18} />
          </button>
          {intro.note && <span className="text-sm text-[var(--q-muted)]">{intro.note}</span>}
        </div>
      </div>
    );
  }

  // Tela final
  if (ending) {
    if (ending.kind === 'preview-redirect') {
      return shell(
        <div className={`${animation} text-center`}>
          <span className="quiz-pop mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--q-primary-soft)] text-[var(--q-primary)]"><ArrowRight size={24} /></span>
          <h2 className="mt-5 text-2xl font-bold">Redirecionamento</h2>
          <p className="mt-2 text-sm text-[var(--q-muted)]">No quiz publicado, o lead iria agora para:</p>
          <p className="mt-2 break-all text-base font-semibold text-[var(--q-primary)]">{ending.target}</p>
          <button type="button" onClick={restart} className="quiz-link mt-8 inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--q-muted)] hover:text-[var(--q-text)]"><RotateCcw size={14} /> Testar de novo</button>
        </div>
      );
    }
    return shell(
      <div className={`${animation} text-center`}>
        <span className="quiz-pop mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--q-primary)] text-[var(--q-on-primary)]"><Check size={30} strokeWidth={2.5} /></span>
        <h2 className="mt-6 text-2xl font-bold leading-tight sm:text-3xl">{ending.title}</h2>
        {ending.text && <p className="mx-auto mt-3 max-w-lg whitespace-pre-line text-base leading-relaxed text-[var(--q-muted)]">{ending.text}</p>}
        {ending.cta && (
          ending.cta.href
            ? <a href={ending.cta.href} className="quiz-button mt-8 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--q-radius)] bg-[var(--q-primary)] px-8 text-base font-semibold text-[var(--q-on-primary)] sm:w-auto">{ending.cta.label} <ArrowRight size={18} /></a>
            : <span className="mt-8 inline-flex min-h-14 items-center justify-center gap-2 rounded-[var(--q-radius)] bg-[var(--q-primary)] px-8 text-base font-semibold text-[var(--q-on-primary)] opacity-80">{ending.cta.label} <ArrowRight size={18} /></span>
        )}
        {!live && <div><button type="button" onClick={restart} className="quiz-link mt-8 inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--q-muted)] hover:text-[var(--q-text)]"><RotateCcw size={14} /> Testar de novo</button></div>}
      </div>
    );
  }

  if (!step) {
    return shell(<p className="text-center text-sm text-[var(--q-muted)]">Este quiz tem um problema no fluxo e não pode ser exibido.</p>);
  }

  if (!node) {
    return shell(
      <div className="flex flex-col items-center gap-3 text-center">
        {error ? (
          <>
            <p role="alert" className="text-sm text-[var(--q-bad)]">{error}</p>
            <button type="button" onClick={() => { setError(null); void finish(answers); }} className="quiz-button inline-flex min-h-12 items-center gap-2 rounded-[var(--q-radius)] bg-[var(--q-primary)] px-6 text-sm font-semibold text-[var(--q-on-primary)]"><RotateCcw size={15} /> Tentar de novo</button>
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
        <MessageStep node={node} scope={scope} onContinue={() => submitCurrent('ok')} />
      ) : node.type === 'choice' ? (
        <ChoiceStep
          node={node}
          label={label}
          initial={answers[node.id] ?? drafts[node.id]}
          pressed={pressed}
          onPick={(optionId) => {
            setPressed(optionId);
            // Deixa a seleção aparecer antes de trocar de tela.
            window.setTimeout(() => { setPressed(null); submitCurrent(optionId); }, 260);
          }}
          onSubmitMany={(ids) => submitCurrent(ids)}
        />
      ) : (
        <InputStep key={node.id} node={node} label={label} inputRef={inputRef} initial={(drafts[node.id] as string | undefined) ?? ''} onSubmit={(value) => submitCurrent(value)} />
      )}
      {error && <p role="alert" aria-live="assertive" className="mt-4 text-sm font-medium text-[var(--q-bad)]">{error}</p>}
    </div>,
    { showProgress: true, showBack: true }
  );
}

// ─── telas por tipo de bloco ─────────────────────────────────────────────────

function MessageStep({ node, scope, onContinue }: { node: QuizNode; scope: Record<string, unknown>; onContinue: () => void }) {
  return (
    <div>
      {node.data.imageUrl && <img src={node.data.imageUrl} alt="" className="mb-6 max-h-72 w-full rounded-[var(--q-radius)] object-cover" />}
      <p className="whitespace-pre-line text-2xl font-semibold leading-snug sm:text-3xl">{interpolate(node.data.text, scope as never)}</p>
      <button type="button" autoFocus onClick={onContinue} className="quiz-button mt-8 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--q-radius)] bg-[var(--q-primary)] px-8 text-base font-semibold text-[var(--q-on-primary)] sm:w-auto">
        {node.data.buttonLabel || 'Continuar'} <ArrowRight size={18} />
      </button>
    </div>
  );
}

function ChoiceStep({ node, label, initial, pressed, onPick, onSubmitMany }: { node: QuizNode; label: string; initial: string | string[] | undefined; pressed: string | null; onPick: (id: string) => void; onSubmitMany: (ids: string[]) => void }) {
  const options = node.data.options ?? [];
  const multiple = Boolean(node.data.multiple);
  const [selected, setSelected] = useState<string[]>(() => (Array.isArray(initial) ? initial : initial ? [initial] : []));

  // Teclas A, B, C... escolhem a opção.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      if (event.key.length !== 1 || index < 0 || index >= options.length) return;
      event.preventDefault();
      const id = options[index].id;
      if (multiple) setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
      else if (!pressed) onPick(id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, multiple, pressed, onPick]);

  return (
    <fieldset>
      <legend className="text-2xl font-bold leading-snug sm:text-3xl">{label}{node.data.required === false && <span className="ml-2 text-sm font-normal text-[var(--q-muted)]">(opcional)</span>}</legend>
      {multiple && <p className="mt-2 text-sm text-[var(--q-muted)]">Escolha quantas quiser.</p>}
      <div className="mt-7 grid gap-3" role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
        {options.map((option, index) => {
          const active = pressed === option.id || selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={active}
              disabled={Boolean(pressed)}
              onClick={() => {
                if (multiple) setSelected((current) => current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id]);
                else onPick(option.id);
              }}
              className={`quiz-option ${pressed === option.id ? 'quiz-press' : ''} flex min-h-[60px] w-full items-center gap-4 rounded-[var(--q-radius)] border-2 px-4 py-3 text-left text-base font-medium ${active ? 'border-[var(--q-primary)] bg-[var(--q-primary-soft)]' : 'border-[var(--q-border)] bg-[var(--q-surface)]'}`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[calc(var(--q-radius)*.6)] text-sm font-bold ${option.emoji ? 'text-xl' : ''} ${active ? 'bg-[var(--q-primary)] text-[var(--q-on-primary)]' : 'bg-[var(--q-surface-hover)] text-[var(--q-muted)]'}`}>
                {option.emoji || String.fromCharCode(65 + index)}
              </span>
              <span className="flex-1">{option.label}</span>
              {active && <Check size={20} className="quiz-pop shrink-0 text-[var(--q-primary)]" strokeWidth={2.5} />}
            </button>
          );
        })}
      </div>
      {multiple && (
        <button type="button" onClick={() => onSubmitMany(selected)} className="quiz-button mt-7 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--q-radius)] bg-[var(--q-primary)] px-8 text-base font-semibold text-[var(--q-on-primary)] sm:w-auto">
          Continuar <ArrowRight size={18} />
        </button>
      )}
      {!multiple && <p className="mt-5 hidden text-xs text-[var(--q-muted)] sm:block">Dica: use as teclas {options.slice(0, 4).map((_, index) => String.fromCharCode(65 + index)).join(', ')}{options.length > 4 ? '…' : ''} para escolher.</p>}
    </fieldset>
  );
}

function InputStep({ node, label, inputRef, initial, onSubmit }: { node: QuizNode; label: string; inputRef: React.RefObject<HTMLInputElement | null>; initial: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const kind = node.data.inputKind ?? 'text';
  const id = `quiz-field-${node.id}`;
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(value); }}>
      <label htmlFor={id} className="block text-2xl font-bold leading-snug sm:text-3xl">{label}{node.data.required === false && <span className="ml-2 text-sm font-normal text-[var(--q-muted)]">(opcional)</span>}</label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(kind === 'phone' ? formatPhone(event.target.value) : kind === 'number' ? formatNumber(event.target.value) : event.target.value)}
        type={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text'}
        inputMode={kind === 'phone' ? 'tel' : kind === 'number' ? 'numeric' : kind === 'email' ? 'email' : 'text'}
        autoComplete={kind === 'name' ? 'name' : kind === 'phone' ? 'tel' : kind === 'email' ? 'email' : 'off'}
        enterKeyHint="next"
        placeholder={node.data.placeholder || 'Digite sua resposta'}
        className="quiz-field mt-7 w-full border-0 border-b-2 border-[var(--q-border)] bg-transparent pb-3 text-2xl text-[var(--q-text)] outline-none transition-colors sm:text-3xl"
      />
      <div className="mt-8 flex items-center gap-4">
        <button type="submit" className="quiz-button inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--q-radius)] bg-[var(--q-primary)] px-8 text-base font-semibold text-[var(--q-on-primary)] sm:w-auto">
          Continuar <ArrowRight size={18} />
        </button>
        <span className="hidden text-xs text-[var(--q-muted)] sm:inline">ou pressione <strong>Enter ↵</strong></span>
      </div>
    </form>
  );
}
