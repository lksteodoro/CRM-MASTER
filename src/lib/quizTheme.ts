// Aparência dos quizzes: tokens, temas prontos e leitura do formato antigo.
//
// O tema mora em quizzes.theme (rascunho) e é congelado em quiz_versions.theme
// ao publicar, junto com o fluxo. Nada aqui mexe na lógica do quiz: perguntas,
// valores das opções, condições e webhooks continuam só no fluxo.
//
// Compatibilidade: os campos do primeiro formato (primaryColor, mode, font,
// buttonShape, progress, transition, logoUrl, welcome) continuam valendo; os
// grupos novos só sobrescrevem quando preenchidos.

export type QuizFont = 'jakarta' | 'inter' | 'poppins' | 'montserrat' | 'dmsans' | 'nunito' | 'serif' | 'system';

export interface QuizTheme {
  appearanceVersion?: 2;
  /** Tema pronto de origem (só informativo). */
  preset?: string;
  // ── formato v1 ──
  primaryColor?: string;
  mode?: 'dark' | 'light';
  font?: QuizFont;
  buttonShape?: 'rounded' | 'pill' | 'square';
  progress?: 'bar' | 'percent' | 'steps' | 'none';
  transition?: 'slide' | 'fade' | 'none' | 'slide-x' | 'scale';
  logoUrl?: string;
  welcome?: {
    enabled?: boolean;
    badge?: string;
    title?: string;
    subtitle?: string;
    imageUrl?: string;
    buttonLabel?: string;
    note?: string;
    privacy?: string;
  };
  // ── v2 ──
  colors?: Partial<Record<'background' | 'surface' | 'text' | 'muted' | 'border' | 'error' | 'secondary', string>>;
  typography?: {
    headingFont?: QuizFont;
    headingWeight?: 500 | 600 | 700 | 800;
    headingSizeMobile?: number;
    headingSizeDesktop?: number;
    bodySizeMobile?: number;
    bodySizeDesktop?: number;
    align?: 'left' | 'center';
  };
  background?: {
    type?: 'solid' | 'gradient' | 'image';
    gradientFrom?: string;
    gradientTo?: string;
    gradientVia?: string;
    gradientAngle?: number;
    imageDesktop?: string;
    imageMobile?: string;
    positionDesktop?: string;
    positionMobile?: string;
    overlayColor?: string;
    overlayOpacity?: number;
    blur?: number;
  };
  layout?: {
    mode?: 'centered' | 'card' | 'split';
    maxWidth?: 480 | 600 | 720 | 960;
    density?: 'compact' | 'comfortable' | 'spacious';
    sideImage?: string;
  };
  buttons?: {
    style?: 'solid' | 'outline' | 'soft' | 'gradient';
    fullWidth?: boolean;
    shadow?: boolean;
    continueLabel?: string;
  };
  answers?: {
    style?: 'cards' | 'list' | 'compact';
    showLetters?: boolean;
    autoAdvance?: boolean;
  };
  motion?: { durationMs?: number };
}

export const FONT_OPTIONS: { value: QuizFont; label: string; family: string; href: string | null }[] = [
  { value: 'jakarta', label: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap' },
  { value: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap' },
  { value: 'poppins', label: 'Poppins', family: "'Poppins', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap' },
  { value: 'montserrat', label: 'Montserrat', family: "'Montserrat', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap' },
  { value: 'dmsans', label: 'DM Sans', family: "'DM Sans', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap' },
  { value: 'nunito', label: 'Nunito', family: "'Nunito', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap' },
  { value: 'serif', label: 'Fraunces (editorial)', family: "'Fraunces', Georgia, serif", href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,800&display=swap' },
  { value: 'system', label: 'Fonte do sistema', family: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', href: null },
];

export const DEFAULT_THEME: QuizTheme = {
  appearanceVersion: 2,
  primaryColor: '#6284ff',
  mode: 'dark',
  font: 'jakarta',
  buttonShape: 'rounded',
  progress: 'bar',
  transition: 'slide',
  welcome: { enabled: false },
};

/** Temas prontos. Aplicar um tema troca só a aparência; textos da tela inicial são mantidos. */
export const THEME_PRESETS: { id: string; name: string; description: string; theme: QuizTheme }[] = [
  {
    id: 'minimal-claro', name: 'Minimal Claro', description: 'Fundo claro, cards simples e CTA forte.',
    theme: { primaryColor: '#2563eb', mode: 'light', font: 'inter', buttonShape: 'rounded', progress: 'bar', transition: 'fade', colors: {}, background: { type: 'solid' }, layout: { mode: 'centered', maxWidth: 600, density: 'comfortable' }, buttons: { style: 'solid', shadow: false }, answers: { style: 'cards', showLetters: true, autoAdvance: true } },
  },
  {
    id: 'premium-escuro', name: 'Premium Escuro', description: 'Escuro com destaque azul, o visual atual.',
    theme: { primaryColor: '#6284ff', mode: 'dark', font: 'jakarta', buttonShape: 'rounded', progress: 'bar', transition: 'slide', background: { type: 'solid' }, layout: { mode: 'centered', maxWidth: 720, density: 'comfortable' }, buttons: { style: 'solid', shadow: true }, answers: { style: 'cards', showLetters: true, autoAdvance: true } },
  },
  {
    id: 'azul-tecnologia', name: 'Azul Tecnologia', description: 'Gradiente azul e roxo, cartão sobre o fundo.',
    theme: { primaryColor: '#7c5cff', mode: 'dark', font: 'dmsans', buttonShape: 'pill', progress: 'percent', transition: 'slide', colors: { background: '#0b1026', surface: '#141b3a', border: '#2a3566' }, background: { type: 'gradient', gradientFrom: '#0b1026', gradientVia: '#1b1f5c', gradientTo: '#3b1d6e', gradientAngle: 140 }, layout: { mode: 'card', maxWidth: 600, density: 'comfortable' }, buttons: { style: 'gradient', shadow: true }, answers: { style: 'cards', showLetters: true, autoAdvance: true } },
  },
  {
    id: 'verde-negocios', name: 'Verde Negócios', description: 'Claro e confiável, verde de conversão.',
    theme: { primaryColor: '#15803d', mode: 'light', font: 'montserrat', buttonShape: 'rounded', progress: 'steps', transition: 'fade', colors: { background: '#f3f7f4', border: '#d6e4da' }, background: { type: 'solid' }, layout: { mode: 'card', maxWidth: 600, density: 'comfortable' }, buttons: { style: 'solid', shadow: false }, answers: { style: 'cards', showLetters: false, autoAdvance: true } },
  },
  {
    id: 'elegante-editorial', name: 'Elegante Editorial', description: 'Títulos serifados, tons neutros e muito respiro.',
    theme: { primaryColor: '#1f2937', mode: 'light', font: 'inter', buttonShape: 'square', progress: 'steps', transition: 'fade', colors: { background: '#faf7f2', surface: '#ffffff', border: '#e7e0d4', muted: '#6b6357' }, typography: { headingFont: 'serif', headingWeight: 600 }, background: { type: 'solid' }, layout: { mode: 'centered', maxWidth: 600, density: 'spacious' }, buttons: { style: 'solid', shadow: false }, answers: { style: 'list', showLetters: false, autoAdvance: true } },
  },
  {
    id: 'colorido', name: 'Colorido', description: 'Gradiente vibrante e botões em pílula.',
    theme: { primaryColor: '#f97316', mode: 'dark', font: 'poppins', buttonShape: 'pill', progress: 'bar', transition: 'scale', colors: { surface: '#1f1235', border: '#3d2a5c' }, background: { type: 'gradient', gradientFrom: '#3b0764', gradientVia: '#9d174d', gradientTo: '#c2410c', gradientAngle: 135 }, layout: { mode: 'card', maxWidth: 600, density: 'comfortable' }, buttons: { style: 'solid', shadow: true }, answers: { style: 'cards', showLetters: true, autoAdvance: true } },
  },
];

export function applyPreset(current: QuizTheme, presetId: string): QuizTheme {
  const preset = THEME_PRESETS.find((item) => item.id === presetId);
  if (!preset) return current;
  // Mantém textos e imagens próprios do quiz: logo, tela inicial e imagens de fundo enviadas.
  const keepImages = current.background?.type === 'image' ? { background: { ...current.background } } : {};
  return { ...DEFAULT_THEME, ...preset.theme, ...keepImages, preset: preset.id, logoUrl: current.logoUrl, welcome: current.welcome, appearanceVersion: 2 };
}

// ─── cores e contraste (WCAG) ────────────────────────────────────────────────

const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(value: string | undefined): value is string {
  return Boolean(value && HEX.test(value));
}

function luminance(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function contrastRatio(a: string, b: string) {
  if (!isHex(a) || !isHex(b)) return 21;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Texto sobre a cor do botão. Branco enquanto tiver contraste de pelo menos 3:1
 * (texto do botão é grande e em negrito); abaixo disso, o que contrastar mais.
 */
export function readableOn(hex: string) {
  if (!isHex(hex)) return '#ffffff';
  const white = contrastRatio('#ffffff', hex);
  return white >= 3 || white >= contrastRatio('#0b0d12', hex) ? '#ffffff' : '#0b0d12';
}

/** Mistura duas cores (0 = a, 1 = b). Usada para hover e superfícies derivadas. */
export function mix(a: string, b: string, amount: number) {
  if (!isHex(a) || !isHex(b)) return a;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - amount) + ((pb >> shift) & 255) * amount);
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

// ─── resolução: tema salvo → valores prontos para a tela ────────────────────

export interface ResolvedTheme {
  theme: QuizTheme;
  primary: string;
  onPrimary: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  error: string;
  bodyFont: string;
  headingFont: string;
  fontHrefs: string[];
  radius: string;
  headingWeight: number;
  headingMobile: number;
  headingDesktop: number;
  bodyMobile: number;
  bodyDesktop: number;
  align: 'left' | 'center';
  layoutMode: 'centered' | 'card' | 'split';
  maxWidth: number;
  gap: number;
  buttonStyle: 'solid' | 'outline' | 'soft' | 'gradient';
  buttonFullWidth: boolean;
  buttonShadow: boolean;
  continueLabel: string;
  answerStyle: 'cards' | 'list' | 'compact';
  showLetters: boolean;
  autoAdvance: boolean;
  transition: 'slide' | 'fade' | 'none' | 'slide-x' | 'scale';
  durationMs: number;
  backgroundCss: string;
  imageDesktop: string | null;
  imageMobile: string | null;
  positionDesktop: string;
  positionMobile: string;
  overlay: string | null;
  blur: number;
}

export function resolveQuizTheme(input: QuizTheme | undefined): ResolvedTheme {
  const theme: QuizTheme = { ...DEFAULT_THEME, ...input, welcome: { ...DEFAULT_THEME.welcome, ...input?.welcome } };
  const light = theme.mode === 'light';
  const primary = isHex(theme.primaryColor) ? theme.primaryColor : DEFAULT_THEME.primaryColor!;
  const colors = theme.colors ?? {};
  const background = isHex(colors.background) ? colors.background : light ? '#f5f6fa' : '#0b0d12';
  const surface = isHex(colors.surface) ? colors.surface : light ? '#ffffff' : '#141821';
  const text = isHex(colors.text) ? colors.text : light ? '#11131a' : '#f3f4f7';
  const muted = isHex(colors.muted) ? colors.muted : light ? '#5a6072' : '#9aa2b4';
  const border = isHex(colors.border) ? colors.border : light ? '#dfe2ec' : '#262c3a';
  const error = isHex(colors.error) ? colors.error : light ? '#c4314b' : '#ff7a8a';
  const bodyFontOption = FONT_OPTIONS.find((font) => font.value === theme.font) ?? FONT_OPTIONS[0];
  const headingFontOption = FONT_OPTIONS.find((font) => font.value === (theme.typography?.headingFont ?? theme.font)) ?? bodyFontOption;
  const radius = theme.buttonShape === 'pill' ? '999px' : theme.buttonShape === 'square' ? '6px' : '14px';
  const density = theme.layout?.density ?? 'comfortable';
  const bg = theme.background ?? {};
  const type = bg.type ?? 'solid';
  const gradient = `linear-gradient(${bg.gradientAngle ?? 135}deg, ${[bg.gradientFrom, bg.gradientVia, bg.gradientTo].filter(isHex).join(', ') || `${background}, ${background}`})`;
  const overlayOpacity = Math.min(Math.max(bg.overlayOpacity ?? 0.55, 0), 1);
  return {
    theme,
    primary,
    onPrimary: readableOn(primary),
    background,
    surface,
    text,
    muted,
    border,
    error,
    bodyFont: bodyFontOption.family,
    headingFont: headingFontOption.family,
    fontHrefs: [bodyFontOption.href, headingFontOption.href].filter((href): href is string => Boolean(href)),
    radius,
    headingWeight: theme.typography?.headingWeight ?? 700,
    headingMobile: clamp(theme.typography?.headingSizeMobile ?? 26, 18, 44),
    headingDesktop: clamp(theme.typography?.headingSizeDesktop ?? 34, 22, 60),
    bodyMobile: clamp(theme.typography?.bodySizeMobile ?? 16, 13, 22),
    bodyDesktop: clamp(theme.typography?.bodySizeDesktop ?? 17, 13, 24),
    align: theme.typography?.align ?? 'left',
    layoutMode: theme.layout?.mode ?? 'centered',
    maxWidth: theme.layout?.maxWidth ?? 720,
    gap: density === 'compact' ? 20 : density === 'spacious' ? 40 : 28,
    buttonStyle: theme.buttons?.style ?? 'solid',
    buttonFullWidth: theme.buttons?.fullWidth ?? false,
    buttonShadow: theme.buttons?.shadow ?? false,
    continueLabel: theme.buttons?.continueLabel?.trim() || 'Continuar',
    answerStyle: theme.answers?.style ?? 'cards',
    showLetters: theme.answers?.showLetters ?? true,
    autoAdvance: theme.answers?.autoAdvance ?? true,
    transition: theme.transition ?? 'slide',
    durationMs: clamp(theme.motion?.durationMs ?? 380, 120, 600),
    backgroundCss: type === 'gradient' ? gradient : background,
    imageDesktop: type === 'image' ? bg.imageDesktop || bg.imageMobile || null : null,
    imageMobile: type === 'image' ? bg.imageMobile || bg.imageDesktop || null : null,
    positionDesktop: bg.positionDesktop || 'center',
    positionMobile: bg.positionMobile || bg.positionDesktop || 'center',
    overlay: type === 'image' ? hexAlpha(isHex(bg.overlayColor) ? bg.overlayColor : '#000000', overlayOpacity) : null,
    blur: type === 'image' ? clamp(bg.blur ?? 0, 0, 12) : 0,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Number(value) || min, min), max);
}

function hexAlpha(hex: string, alpha: number) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

// ─── verificação visual antes de publicar ───────────────────────────────────

export interface ThemeIssue {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Contraste calculado sobre a superfície onde o texto realmente fica. Com imagem
 * de fundo, avalia o texto sobre a cor do overlay (a imagem varia; o overlay é o
 * que garante a leitura).
 */
export function checkTheme(input: QuizTheme | undefined): ThemeIssue[] {
  const t = resolveQuizTheme(input);
  const issues: ThemeIssue[] = [];
  const bg = t.theme.background ?? {};
  const textBase = t.layoutMode === 'card' ? t.surface : bg.type === 'image' ? (isHex(bg.overlayColor) ? bg.overlayColor : '#000000') : bg.type === 'gradient' ? [bg.gradientFrom, bg.gradientVia, bg.gradientTo].filter(isHex)[0] ?? t.background : t.background;
  const ratio = contrastRatio(t.text, textBase);
  if (ratio < 3) issues.push({ level: 'error', message: `Texto quase ilegível sobre o fundo (contraste ${ratio.toFixed(1)}:1). Ajuste as cores ou o escurecimento da imagem.` });
  else if (ratio < 4.5) issues.push({ level: 'warning', message: `Contraste do texto abaixo do recomendado (${ratio.toFixed(1)}:1; o ideal é 4,5:1).` });
  const mutedRatio = contrastRatio(t.muted, textBase);
  if (mutedRatio < 3) issues.push({ level: 'warning', message: `Textos secundários com pouco contraste (${mutedRatio.toFixed(1)}:1).` });
  const buttonRatio = contrastRatio(t.onPrimary, t.primary);
  if (t.buttonStyle !== 'outline' && buttonRatio < 3) issues.push({ level: 'warning', message: `Texto do botão com pouco contraste sobre a cor principal (${buttonRatio.toFixed(1)}:1).` });
  if (t.buttonStyle === 'outline' && contrastRatio(t.primary, textBase) < 3) issues.push({ level: 'warning', message: 'Botão contornado com cor principal pouco visível sobre o fundo.' });
  if (bg.type === 'image') {
    if (!bg.imageDesktop && !bg.imageMobile) issues.push({ level: 'error', message: 'Fundo do tipo imagem sem imagem enviada.' });
    if ((bg.overlayOpacity ?? 0.55) < 0.3) issues.push({ level: 'warning', message: 'Escurecimento da imagem muito baixo: o texto pode ficar difícil de ler em partes da foto.' });
  }
  if (t.theme.welcome?.enabled && !t.theme.welcome.title?.trim()) issues.push({ level: 'warning', message: 'Tela inicial ativa sem título.' });
  return issues;
}
