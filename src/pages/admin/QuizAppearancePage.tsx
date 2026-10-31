import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  ImagePlus,
  Loader2,
  Monitor,
  Play,
  Redo2,
  RotateCcw,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { NODE_LABELS, nodeTitle, type QuizNode } from '../../../supabase/functions/_shared/quizFlow.ts';
import { QuizRunner, type PreviewScreen } from '../../components/quiz/QuizRunner';
import { inputClass, labelClass } from '../../components/quiz/quizStyles';
import { ErrorView, LoadingView } from '../../components/ui/StateView';
import {
  checkTheme,
  DEFAULT_THEME,
  FONT_OPTIONS,
  applyPreset,
  isHex,
  resolveQuizTheme,
  THEME_PRESETS,
  type QuizTheme,
} from '../../lib/quizTheme';
import { listRedirectLinks } from '../../services/redirectLinks.service';
import { getQuiz, listQuizImages, saveQuizTheme, uploadQuizImage, type Quiz } from '../../services/quizzes.service';

const DEVICES = {
  mobile: { label: 'Celular', width: 390, height: 780, icon: Smartphone },
  tablet: { label: 'Tablet', width: 768, height: 960, icon: Tablet },
  desktop: { label: 'Computador', width: 1280, height: 800, icon: Monitor },
} as const;
type Device = keyof typeof DEVICES;

// ─── controles ───────────────────────────────────────────────────────────────

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--color-border)]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-panel-2)]">
        {title}
        <ChevronDown size={15} className={`text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-4 px-4 pb-5 pt-1">{children}</div>}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-faint)]">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
      {options.map(([option, label]) => (
        <button key={String(option)} type="button" onClick={() => onChange(option)} aria-pressed={value === option} className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs ${value === option ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{label}</button>
      ))}
    </div>
  );
}

function ColorField({ label, value, fallback, onChange, onReset }: { label: string; value: string | undefined; fallback: string; onChange: (value: string) => void; onReset?: () => void }) {
  const shown = isHex(value) ? value : fallback;
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={shown} onChange={(event) => onChange(event.target.value)} className="h-9 w-10 shrink-0 cursor-pointer rounded border border-[var(--color-border)] bg-transparent" aria-label={label} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--color-text)]">{label}</p>
        <input value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={fallback} className="w-full bg-transparent font-mono text-[11px] text-[var(--color-text-muted)] outline-none" aria-label={`${label} em HEX`} />
      </div>
      {onReset && isHex(value) && <button type="button" onClick={onReset} title="Voltar ao padrão do tema" className="rounded p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><RotateCcw size={13} /></button>}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-[var(--color-text-muted)]">{label}</span><span className="tabular-nums text-[var(--color-text)]">{value}{suffix}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.valueAsNumber)} className="w-full accent-[var(--color-brand)]" aria-label={label} />
    </div>
  );
}

function ImageField({ label, value, organizationId, onChange, hint }: { label: string; value: string | undefined; organizationId: string; onChange: (url: string | undefined) => void; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ url: string; name: string }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try { onChange(await uploadQuizImage(organizationId, file)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível enviar a imagem.'); }
    finally { setBusy(false); }
  }

  async function openLibrary() {
    if (library) { setLibrary(null); return; }
    try { setLibrary(await listQuizImages(organizationId)); }
    catch { setError('Não foi possível abrir a biblioteca.'); }
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      {value ? (
        <div className="relative overflow-hidden rounded-lg border border-[var(--color-border)]">
          <img src={value} alt="" className="h-28 w-full object-cover" />
          <div className="absolute right-1.5 top-1.5 flex gap-1">
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-md bg-black/60 px-2 py-1 text-[11px] text-white hover:bg-black/80">Trocar</button>
            <button type="button" onClick={() => onChange(undefined)} className="rounded-md bg-black/60 p-1 text-white hover:bg-black/80" aria-label="Remover imagem"><Trash2 size={13} /></button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border)] px-2 py-3 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">{busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} Enviar</button>
          <button type="button" onClick={() => void openLibrary()} className="rounded-lg border border-dashed border-[var(--color-border)] px-2 py-3 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Biblioteca</button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
      {library && (
        <div className="mt-2 grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto rounded-lg border border-[var(--color-border)] p-1.5">
          {library.length === 0 && <p className="col-span-3 p-2 text-center text-[11px] text-[var(--color-text-faint)]">Nenhuma imagem enviada ainda.</p>}
          {library.map((item) => <button key={item.name} type="button" onClick={() => { onChange(item.url); setLibrary(null); }} className="overflow-hidden rounded-md border border-[var(--color-border)] hover:border-[var(--color-brand)]"><img src={item.url} alt="" loading="lazy" className="aspect-square w-full object-cover" /></button>)}
        </div>
      )}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-faint)]">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-[11px] text-[var(--color-bad)]">{error}</p>}
    </div>
  );
}

const POSITIONS: [string, string][] = [['center', 'Centro'], ['top', 'Topo'], ['bottom', 'Base'], ['left', 'Esquerda'], ['right', 'Direita']];

// ─── página ──────────────────────────────────────────────────────────────────

export function QuizAppearancePage() {
  const { quizId = '' } = useParams();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [linkNames, setLinkNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ stack: QuizTheme[]; index: number }>({ stack: [], index: 0 });
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [open, setOpen] = useState<string>('temas');
  const [device, setDevice] = useState<Device>('mobile');
  const [screenKey, setScreenKey] = useState('welcome');
  const [interactive, setInteractive] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const lastSavedRef = useRef('');
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 700 });

  useEffect(() => {
    void Promise.all([getQuiz(quizId), listRedirectLinks()])
      .then(([row, links]) => {
        const theme = { ...DEFAULT_THEME, ...row.theme, appearanceVersion: 2 as const };
        setQuiz(row);
        setHistory({ stack: [theme], index: 0 });
        lastSavedRef.current = JSON.stringify(theme);
        setLinkNames(Object.fromEntries(links.map((link) => [link.id, link.name])));
        if (!theme.welcome?.enabled) {
          const first = row.draft_flow?.nodes.find((node) => ['message', 'input', 'choice'].includes(node.type));
          if (first) setScreenKey(first.id);
        }
      })
      .catch((caught) => setLoadError(caught instanceof Error ? caught.message : 'Não foi possível abrir o quiz.'));
  }, [quizId]);

  // A prévia escala para caber na área central sem mudar a largura simulada.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [quiz]);

  const theme = history.stack[history.index] ?? DEFAULT_THEME;
  const update = useCallback((patch: Partial<QuizTheme> | ((current: QuizTheme) => QuizTheme)) => {
    setHistory((current) => {
      const base = current.stack[current.index] ?? DEFAULT_THEME;
      const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch };
      const stack = [...current.stack.slice(0, current.index + 1), next].slice(-80);
      return { stack, index: stack.length - 1 };
    });
  }, []);
  const group = <K extends 'colors' | 'typography' | 'background' | 'layout' | 'buttons' | 'answers' | 'motion' | 'welcome'>(key: K, patch: NonNullable<QuizTheme[K]>) =>
    update((current) => ({ ...current, [key]: { ...(current[key] as object | undefined), ...(patch as object) } }));

  // Salvamento automático do rascunho de aparência (não mexe na versão publicada).
  useEffect(() => {
    if (!quiz) return;
    const serialized = JSON.stringify(theme);
    if (serialized === lastSavedRef.current) return;
    setSaveState('pending');
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        await saveQuizTheme(quiz.id, theme);
        lastSavedRef.current = serialized;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [theme, quiz]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1) })); }
      if ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y') { event.preventDefault(); setHistory((current) => ({ ...current, index: Math.min(current.stack.length - 1, current.index + 1) })); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const flow = quiz?.draft_flow ?? { nodes: [], edges: [] };
  const screens = useMemo(() => {
    const visible = flow.nodes.filter((node) => ['message', 'input', 'choice', 'end', 'redirect'].includes(node.type));
    return [
      { key: 'welcome', label: theme.welcome?.enabled ? 'Tela inicial' : 'Tela inicial (desativada)' },
      ...visible.map((node: QuizNode) => ({ key: node.id, label: `${NODE_LABELS[node.type]} · ${nodeTitle(node).slice(0, 40)}` })),
    ];
  }, [flow.nodes, theme.welcome?.enabled]);
  const screen: PreviewScreen = screenKey === 'welcome' ? { kind: 'welcome' } : { kind: 'node', nodeId: screenKey };
  const issues = useMemo(() => checkTheme(theme), [theme]);
  const resolved = resolveQuizTheme(theme);
  const size = DEVICES[device];
  const scale = Math.min(1, (stageSize.width - 32) / size.width, (stageSize.height - 32) / size.height);
  const toggle = (id: string) => setOpen((current) => (current === id ? '' : id));
  const bg = theme.background ?? {};

  if (loadError) return <ErrorView message={loadError} />;
  if (!quiz) return <LoadingView label="Abrindo a aparência..." />;

  const describeTarget = (node: QuizNode) => node.data.target === 'link' ? `Redirecionador: ${linkNames[node.data.linkId ?? ''] ?? 'link'}` : node.data.target === 'url' ? node.data.url ?? '' : `WhatsApp ${node.data.phone ?? ''}`;

  return (
    <main className="flex min-h-[640px] flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5">
        <Link to={`/agency/ferramentas/quiz/${quiz.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"><ArrowLeft size={15} /> Fluxo</Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-[var(--color-text)]">Aparência · {quiz.name}</h1>
          <p className="flex items-center gap-1 text-[11px] text-[var(--color-text-faint)]">{saveState === 'saving' || saveState === 'pending' ? <><Loader2 size={11} className="animate-spin" /> Salvando rascunho</> : saveState === 'error' ? <span className="text-[var(--color-bad)]">Falha ao salvar</span> : <><Cloud size={11} /> Rascunho salvo · vale para o lead depois de publicar</>}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1) }))} disabled={history.index === 0} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] disabled:opacity-30" aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)"><Undo2 size={15} /></button>
          <button type="button" onClick={() => setHistory((current) => ({ ...current, index: Math.min(current.stack.length - 1, current.index + 1) }))} disabled={history.index >= history.stack.length - 1} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] disabled:opacity-30" aria-label="Refazer (Ctrl+Shift+Z)" title="Refazer"><Redo2 size={15} /></button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={screenKey} onChange={(event) => { setScreenKey(event.target.value); setInteractive(false); }} className="max-w-[260px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)]" aria-label="Tela mostrada na prévia">
            {screens.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
            {(Object.keys(DEVICES) as Device[]).map((key) => {
              const Icon = DEVICES[key].icon;
              return <button key={key} type="button" onClick={() => setDevice(key)} aria-pressed={device === key} className={`rounded-md p-1.5 ${device === key ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`} aria-label={DEVICES[key].label} title={DEVICES[key].label}><Icon size={15} /></button>;
            })}
          </div>
          <button type="button" onClick={() => { setInteractive((current) => !current); setPreviewKey((key) => key + 1); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${interactive ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-[var(--color-border)] text-[var(--color-text)]'}`}><Play size={13} /> {interactive ? 'Testando o fluxo' : 'Testar o fluxo'}</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Controles */}
        <aside className="w-[320px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-panel)]">
          <Section title="Temas" open={open === 'temas'} onToggle={() => toggle('temas')}>
            <div className="grid grid-cols-2 gap-2">
              {THEME_PRESETS.map((preset) => {
                const p = resolveQuizTheme(preset.theme);
                const active = theme.preset === preset.id;
                return (
                  <button key={preset.id} type="button" onClick={() => update((current) => applyPreset(current, preset.id))} className={`overflow-hidden rounded-xl border text-left ${active ? 'border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-faint)]'}`}>
                    <div className="flex h-14 flex-col justify-end gap-1 p-2" style={{ background: p.backgroundCss }}>
                      <span className="h-1.5 w-3/4 rounded-full" style={{ background: p.text, opacity: 0.85 }} />
                      <span className="h-3 w-1/2 rounded" style={{ background: p.primary, borderRadius: p.radius }} />
                    </div>
                    <p className="px-2 pt-1.5 text-xs font-medium text-[var(--color-text)]">{preset.name}</p>
                    <p className="px-2 pb-2 text-[10px] leading-snug text-[var(--color-text-faint)]">{preset.description}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--color-text-faint)]">Aplicar um tema troca cores, fontes, fundo e estilos. O logotipo, a tela inicial e as perguntas são mantidos.</p>
          </Section>

          <Section title="Cores" open={open === 'cores'} onToggle={() => toggle('cores')}>
            <Field label="Base"><Segmented value={theme.mode ?? 'dark'} options={[['dark', 'Escura'], ['light', 'Clara']]} onChange={(mode) => update({ mode, colors: {} })} /></Field>
            <ColorField label="Principal (botões e destaques)" value={theme.primaryColor} fallback="#6284ff" onChange={(primaryColor) => update({ primaryColor })} />
            <ColorField label="Fundo" value={theme.colors?.background} fallback={resolved.background} onChange={(value) => group('colors', { background: value })} onReset={() => group('colors', { background: undefined })} />
            <ColorField label="Cartões e opções" value={theme.colors?.surface} fallback={resolved.surface} onChange={(value) => group('colors', { surface: value })} onReset={() => group('colors', { surface: undefined })} />
            <ColorField label="Texto" value={theme.colors?.text} fallback={resolved.text} onChange={(value) => group('colors', { text: value })} onReset={() => group('colors', { text: undefined })} />
            <ColorField label="Texto secundário" value={theme.colors?.muted} fallback={resolved.muted} onChange={(value) => group('colors', { muted: value })} onReset={() => group('colors', { muted: undefined })} />
            <ColorField label="Bordas" value={theme.colors?.border} fallback={resolved.border} onChange={(value) => group('colors', { border: value })} onReset={() => group('colors', { border: undefined })} />
            <ColorField label="Erro" value={theme.colors?.error} fallback={resolved.error} onChange={(value) => group('colors', { error: value })} onReset={() => group('colors', { error: undefined })} />
          </Section>

          <Section title="Plano de fundo" open={open === 'fundo'} onToggle={() => toggle('fundo')}>
            <Segmented value={bg.type ?? 'solid'} options={[['solid', 'Cor sólida'], ['gradient', 'Gradiente'], ['image', 'Imagem']]} onChange={(type) => group('background', { type })} />
            {(bg.type ?? 'solid') === 'solid' && <p className="text-[11px] text-[var(--color-text-faint)]">Usa a cor de fundo definida em Cores.</p>}
            {bg.type === 'gradient' && (
              <>
                <ColorField label="Cor inicial" value={bg.gradientFrom} fallback={resolved.background} onChange={(value) => group('background', { gradientFrom: value })} />
                <ColorField label="Cor do meio (opcional)" value={bg.gradientVia} fallback={resolved.surface} onChange={(value) => group('background', { gradientVia: value })} onReset={() => group('background', { gradientVia: undefined })} />
                <ColorField label="Cor final" value={bg.gradientTo} fallback={resolved.primary} onChange={(value) => group('background', { gradientTo: value })} />
                <Slider label="Ângulo" value={bg.gradientAngle ?? 135} min={0} max={360} suffix="°" onChange={(value) => group('background', { gradientAngle: value })} />
              </>
            )}
            {bg.type === 'image' && (
              <>
                <ImageField label="Imagem no computador" value={bg.imageDesktop} organizationId={quiz.organization_id} onChange={(url) => group('background', { imageDesktop: url })} hint="Ideal: 1920×1080 ou maior. A imagem é reduzida e convertida para WebP no envio." />
                <Field label="Posição no computador"><Segmented value={bg.positionDesktop ?? 'center'} options={POSITIONS} onChange={(value) => group('background', { positionDesktop: value })} /></Field>
                <ImageField label="Imagem no celular (opcional)" value={bg.imageMobile} organizationId={quiz.organization_id} onChange={(url) => group('background', { imageMobile: url })} hint="Sem imagem própria, o celular usa a do computador com a posição abaixo. Ideal: vertical, 1080×1920." />
                <Field label="Posição no celular"><Segmented value={bg.positionMobile ?? bg.positionDesktop ?? 'center'} options={POSITIONS} onChange={(value) => group('background', { positionMobile: value })} /></Field>
                <ColorField label="Cor do escurecimento" value={bg.overlayColor} fallback="#000000" onChange={(value) => group('background', { overlayColor: value })} />
                <Slider label="Escurecimento (garante a leitura)" value={Math.round((bg.overlayOpacity ?? 0.55) * 100)} min={0} max={95} suffix="%" onChange={(value) => group('background', { overlayOpacity: value / 100 })} />
                <Slider label="Desfoque" value={bg.blur ?? 0} min={0} max={12} suffix=" px" onChange={(value) => group('background', { blur: value })} />
                <p className="text-[11px] text-[var(--color-text-faint)]">Se a imagem não carregar, o lead vê a cor de fundo definida em Cores.</p>
              </>
            )}
          </Section>

          <Section title="Layout e espaçamento" open={open === 'layout'} onToggle={() => toggle('layout')}>
            <Field label="Estrutura"><Segmented value={theme.layout?.mode ?? 'centered'} options={[['centered', 'Centralizado'], ['card', 'Cartão'], ['split', 'Dividido']]} onChange={(mode) => group('layout', { mode })} /></Field>
            {theme.layout?.mode === 'split' && <ImageField label="Imagem lateral (computador)" value={theme.layout?.sideImage} organizationId={quiz.organization_id} onChange={(url) => group('layout', { sideImage: url })} hint="Aparece ao lado das perguntas em telas largas. No celular, fica oculta." />}
            <Field label="Largura máxima do conteúdo"><Segmented value={theme.layout?.maxWidth ?? 720} options={[[480, '480'], [600, '600'], [720, '720'], [960, '960']]} onChange={(maxWidth) => group('layout', { maxWidth })} /></Field>
            <Field label="Espaçamento"><Segmented value={theme.layout?.density ?? 'comfortable'} options={[['compact', 'Compacto'], ['comfortable', 'Confortável'], ['spacious', 'Amplo']]} onChange={(density) => group('layout', { density })} /></Field>
            <Field label="Alinhamento do texto"><Segmented value={theme.typography?.align ?? 'left'} options={[['left', 'Esquerda'], ['center', 'Centro']]} onChange={(align) => group('typography', { align })} /></Field>
          </Section>

          <Section title="Tipografia" open={open === 'tipo'} onToggle={() => toggle('tipo')}>
            <Field label="Fonte dos títulos"><select value={theme.typography?.headingFont ?? theme.font ?? 'jakarta'} onChange={(event) => group('typography', { headingFont: event.target.value as QuizTheme['font'] })} className={inputClass}>{FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></Field>
            <Field label="Fonte dos textos e opções"><select value={theme.font ?? 'jakarta'} onChange={(event) => update({ font: event.target.value as QuizTheme['font'] })} className={inputClass}>{FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></Field>
            <Field label="Peso dos títulos"><Segmented value={theme.typography?.headingWeight ?? 700} options={[[500, 'Médio'], [600, 'Semi'], [700, 'Negrito'], [800, 'Extra']]} onChange={(headingWeight) => group('typography', { headingWeight })} /></Field>
            <Slider label="Título no celular" value={resolved.headingMobile} min={20} max={40} suffix=" px" onChange={(value) => group('typography', { headingSizeMobile: value })} />
            <Slider label="Título no computador" value={resolved.headingDesktop} min={24} max={56} suffix=" px" onChange={(value) => group('typography', { headingSizeDesktop: value })} />
            <Slider label="Texto no celular" value={resolved.bodyMobile} min={14} max={20} suffix=" px" onChange={(value) => group('typography', { bodySizeMobile: value })} />
            <Slider label="Texto no computador" value={resolved.bodyDesktop} min={14} max={22} suffix=" px" onChange={(value) => group('typography', { bodySizeDesktop: value })} />
          </Section>

          <Section title="Respostas" open={open === 'respostas'} onToggle={() => toggle('respostas')}>
            <Field label="Estilo das opções" hint="Vale para todas as perguntas de escolha. Ícones de cada opção são definidos no bloco, no editor de fluxo."><Segmented value={theme.answers?.style ?? 'cards'} options={[['cards', 'Cards'], ['list', 'Lista'], ['compact', 'Compacto']]} onChange={(style) => group('answers', { style })} /></Field>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><input type="checkbox" checked={theme.answers?.showLetters ?? true} onChange={(event) => group('answers', { showLetters: event.target.checked })} /> Mostrar letras A, B, C nas opções</label>
            <label className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]"><input type="checkbox" className="mt-1" checked={theme.answers?.autoAdvance ?? true} onChange={(event) => group('answers', { autoAdvance: event.target.checked })} /> <span>Avançar ao tocar na opção<span className="block text-[11px] text-[var(--color-text-faint)]">Desligado, o lead escolhe e toca em Continuar. Escolha múltipla sempre pede Continuar.</span></span></label>
          </Section>

          <Section title="Botões" open={open === 'botoes'} onToggle={() => toggle('botoes')}>
            <Field label="Estilo"><Segmented value={theme.buttons?.style ?? 'solid'} options={[['solid', 'Sólido'], ['gradient', 'Gradiente'], ['soft', 'Suave'], ['outline', 'Contorno']]} onChange={(style) => group('buttons', { style })} /></Field>
            <Field label="Formato"><Segmented value={theme.buttonShape ?? 'rounded'} options={[['square', 'Reto'], ['rounded', 'Arredondado'], ['pill', 'Pílula']]} onChange={(buttonShape) => update({ buttonShape })} /></Field>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><input type="checkbox" checked={theme.buttons?.fullWidth ?? false} onChange={(event) => group('buttons', { fullWidth: event.target.checked })} /> Largura total também no computador</label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><input type="checkbox" checked={theme.buttons?.shadow ?? false} onChange={(event) => group('buttons', { shadow: event.target.checked })} /> Sombra colorida</label>
            <Field label="Texto do botão de avançar" hint="Prefira a ação real, ex.: “Próxima pergunta” ou “Ver meu resultado”."><input value={theme.buttons?.continueLabel ?? ''} onChange={(event) => group('buttons', { continueLabel: event.target.value })} className={inputClass} placeholder="Continuar" /></Field>
          </Section>

          <Section title="Progresso e animações" open={open === 'progresso'} onToggle={() => toggle('progresso')}>
            <Field label="Progresso" hint="Calculado pelo caminho real do lead. Em fluxos com ramificações, “Etapas” mostra “de até N”, sem inventar porcentagem."><Segmented value={theme.progress ?? 'bar'} options={[['bar', 'Barra'], ['percent', 'Barra + %'], ['steps', 'Etapas'], ['none', 'Oculto']]} onChange={(progress) => update({ progress })} /></Field>
            <Field label="Transição entre telas"><Segmented value={theme.transition ?? 'slide'} options={[['none', 'Nenhuma'], ['fade', 'Suave'], ['slide', 'Subir'], ['slide-x', 'Lateral'], ['scale', 'Zoom']]} onChange={(transition) => update({ transition })} /></Field>
            <Slider label="Duração" value={resolved.durationMs} min={150} max={500} step={10} suffix=" ms" onChange={(value) => group('motion', { durationMs: value })} />
            <p className="text-[11px] text-[var(--color-text-faint)]">Quem ativou “reduzir movimento” no aparelho vê as telas sem animação.</p>
          </Section>

          <Section title="Logotipo e tela inicial" open={open === 'inicio'} onToggle={() => toggle('inicio')}>
            <ImageField label="Logotipo" value={theme.logoUrl} organizationId={quiz.organization_id} onChange={(url) => update({ logoUrl: url })} hint="PNG ou SVG convertido, de preferência com fundo transparente." />
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]"><input type="checkbox" checked={Boolean(theme.welcome?.enabled)} onChange={(event) => { group('welcome', { enabled: event.target.checked }); if (event.target.checked) setScreenKey('welcome'); }} /> Mostrar tela inicial</label>
            {theme.welcome?.enabled && (
              <>
                <Field label="Selo (opcional)"><input value={theme.welcome.badge ?? ''} onChange={(event) => group('welcome', { badge: event.target.value })} className={inputClass} placeholder="Diagnóstico gratuito" /></Field>
                <Field label="Título com o benefício"><input value={theme.welcome.title ?? ''} onChange={(event) => group('welcome', { title: event.target.value })} className={inputClass} placeholder="Descubra qual solução combina com a sua base" /></Field>
                <Field label="Subtítulo"><textarea value={theme.welcome.subtitle ?? ''} onChange={(event) => group('welcome', { subtitle: event.target.value })} rows={2} className={inputClass} placeholder="Responda algumas perguntas e veja o próximo passo indicado para o seu negócio." /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Botão"><input value={theme.welcome.buttonLabel ?? ''} onChange={(event) => group('welcome', { buttonLabel: event.target.value })} className={inputClass} placeholder="Começar" /></Field>
                  <Field label="Nota ao lado"><input value={theme.welcome.note ?? ''} onChange={(event) => group('welcome', { note: event.target.value })} className={inputClass} placeholder="4 perguntas" /></Field>
                </div>
                <ImageField label="Imagem/banner (opcional)" value={theme.welcome.imageUrl} organizationId={quiz.organization_id} onChange={(url) => group('welcome', { imageUrl: url })} />
                <Field label="Aviso de privacidade (opcional)" hint="Ex.: “Usamos seus dados só para entrar em contato sobre este serviço.”"><textarea value={theme.welcome.privacy ?? ''} onChange={(event) => group('welcome', { privacy: event.target.value })} rows={2} className={inputClass} /></Field>
              </>
            )}
            <p className="text-[11px] text-[var(--color-text-faint)]">Telas finais e mensagens são editadas nos blocos Finalizar e Mensagem, no editor de fluxo.</p>
          </Section>

          <Section title={`Verificação${issues.length ? ` (${issues.length})` : ''}`} open={open === 'verificacao'} onToggle={() => toggle('verificacao')}>
            {issues.length === 0 ? <p className="flex items-center gap-2 text-sm text-[var(--color-good)]"><Check size={15} /> Contraste e imagens ok.</p> : issues.map((issue, index) => (
              <p key={index} className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${issue.level === 'error' ? 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]' : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'}`}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {issue.message}</p>
            ))}
            <p className="text-[11px] text-[var(--color-text-faint)]">Erros aqui bloqueiam a publicação; avisos não.</p>
          </Section>
        </aside>

        {/* Prévia */}
        <div ref={stageRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[repeating-conic-gradient(var(--color-panel)_0_25%,var(--color-bg)_0_50%)] bg-[length:24px_24px]">
          {issues.some((issue) => issue.level === 'error') && (
            <button type="button" onClick={() => setOpen('verificacao')} className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-bad-soft)] px-2.5 py-1.5 text-xs text-[var(--color-bad)]"><AlertTriangle size={13} /> {issues.filter((issue) => issue.level === 'error').length} problema(s) de leitura</button>
          )}
          <span className="absolute right-3 top-3 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Prévia · {size.label} {size.width}px</span>
          <div style={{ width: size.width * scale, height: size.height * scale }}>
            <div style={{ width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="overflow-y-auto rounded-2xl border border-black/30 shadow-2xl [&>div]:min-h-full">
              {interactive
                ? <QuizRunner key={`i-${previewKey}`} mode="preview" flow={flow} theme={theme} title={quiz.title} describeTarget={describeTarget} />
                : <QuizRunner key={`s-${screenKey}`} mode="preview" flow={flow} theme={theme} title={quiz.title} describeTarget={describeTarget} screen={screen} />}
            </div>
          </div>
          {interactive && <button type="button" onClick={() => setInteractive(false)} className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white"><X size={12} /> Sair do teste (nada é gravado)</button>}
        </div>
      </div>
    </main>
  );
}
