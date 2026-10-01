import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  ClipboardList,
  FileBarChart,
  FileCode2,
  FlaskConical,
  LayoutDashboard,
  Link2,
  Megaphone,
  MessagesSquare,
  Printer,
  Radio,
  Send,
  Sparkles,
  WandSparkles,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { agencyToolGroups, type AgencyToolKey } from '../../services/agencyTools.service';

type Tone = 'brand' | 'info' | 'good' | 'warn' | 'bad';

const tones: Record<Tone, { color: string; soft: string }> = {
  brand: { color: 'var(--color-brand)', soft: 'var(--color-brand-soft)' },
  info: { color: 'var(--color-info)', soft: 'var(--color-info-soft)' },
  good: { color: 'var(--color-good)', soft: 'var(--color-good-soft)' },
  warn: { color: 'var(--color-warn)', soft: 'var(--color-warn-soft)' },
  bad: { color: 'var(--color-bad)', soft: 'var(--color-bad-soft)' },
};

const toolMeta: Record<AgencyToolKey, { icon: ComponentType<{ size?: number }>; description: string; tone: Tone }> = {
  meta_ads: { icon: Megaphone, tone: 'brand', description: 'Perfis de publicação, campanhas, URLs e copys dos anúncios ativos.' },
  zpl_pdf: { icon: Printer, tone: 'info', description: 'Converte etiquetas ZPL em PDF pronto para imprimir.' },
  consumer_success: { icon: MessagesSquare, tone: 'good', description: 'Inbox dos grupos de WhatsApp e mensagens programadas.' },
  utm_tester: { icon: FlaskConical, tone: 'warn', description: 'Gera o link de teste e o link com UTMs para o anúncio.' },
  'disparo.dashboard': { icon: LayoutDashboard, tone: 'brand', description: 'Visão geral dos disparos e dos resultados.' },
  'disparo.redirects': { icon: Link2, tone: 'info', description: 'Links por cliente, randomizador e analytics de cliques.' },
  'disparo.templates': { icon: FileCode2, tone: 'good', description: 'Modelos de mensagem aprovados na Infobip.' },
  'disparo.broadcasts': { icon: Radio, tone: 'warn', description: 'Monte e acompanhe as transmissões.' },
  'disparo.request': { icon: Send, tone: 'brand', description: 'Peça um novo disparo para a operação.' },
  'disparo.demands': { icon: ClipboardList, tone: 'info', description: 'Kanban das demandas de disparo.' },
  'disparo.sanitizer': { icon: WandSparkles, tone: 'good', description: 'Limpa, padroniza e divide listas em lotes.' },
  'disparo.report': { icon: FileBarChart, tone: 'warn', description: 'Relatório do fornecedor de disparos.' },
};

const sections = {
  ferramentas: {
    group: 'Ferramentas da agência',
    title: 'Ferramentas',
    description: 'Escolha a ferramenta que você quer abrir.',
    icon: Wrench,
    eyebrow: 'Ferramenta',
  },
  disparos: {
    group: 'Disparos',
    title: 'Disparos',
    description: 'Tudo da operação de disparo em um lugar: links, templates, transmissões e listas.',
    icon: Send,
    eyebrow: 'Disparos',
  },
} as const;

export type AgencyHubSection = keyof typeof sections;

/**
 * Hub de uma seção da agência: o sidebar continua com a lista para atalho
 * rápido, e clicar em "Ferramentas" ou "Disparos" abre a grade só daquela seção.
 */
export function AgencyToolsHubPage({ section }: { section: AgencyHubSection }) {
  const { canUseAgencyTool } = useAuth();
  const config = sections[section];
  const HeaderIcon = config.icon;

  const groups = agencyToolGroups
    .filter((group) => group.label === config.group)
    .map((group) => ({ ...group, tools: group.tools.filter((tool) => canUseAgencyTool(tool.key)) }))
    .filter((group) => group.tools.length > 0);

  return (
    <main className="flex flex-col gap-8 p-4 sm:p-6">
      <header>
        <div className="flex items-center gap-2">
          <HeaderIcon size={20} className="text-[var(--color-brand)]" />
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{config.title}</h1>
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{config.description}</p>
      </header>

      {groups.map((group) => (
        <section key={group.label}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {group.tools.map((tool) => {
              const meta = toolMeta[tool.key];
              const palette = tones[meta.tone];
              const Icon = meta.icon;
              return (
                <article
                  key={tool.key}
                  className="group relative flex min-h-44 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(180deg,var(--color-panel),#0d0e13)] p-4 shadow-[0_16px_45px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-[var(--color-text-faint)] focus-within:ring-2 focus-within:ring-[var(--color-brand)]/60"
                >
                  <Link to={tool.path} aria-label={`Abrir ${tool.label}`} className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none" />
                  <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-25 blur-2xl transition group-hover:opacity-40" style={{ background: palette.color }} />
                  <div className="relative flex items-center justify-between gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ color: palette.color, background: palette.soft }}>
                      <Icon size={16} />
                    </span>
                    <ArrowUpRight size={15} className="text-[var(--color-text-faint)] transition group-hover:text-[var(--color-text)]" />
                  </div>
                  <p className="relative mt-4 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-faint)]">{config.eyebrow}</p>
                  <p className="relative mt-1 text-sm font-semibold text-[var(--color-text)]">{tool.label}</p>
                  <p className="relative mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{meta.description}</p>
                  {tool.key === 'meta_ads' && (
                    <Link
                      to="/agency/ferramentas/meta-ads?criar=1"
                      className="relative z-20 mt-auto inline-flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-brand)]/35 bg-[var(--color-brand-soft)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-brand)] hover:brightness-125"
                    >
                      <Sparkles size={12} /> Abrir criador de anúncios
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {groups.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-5 py-14 text-center text-sm text-[var(--color-text-muted)]">
          Nenhum item desta seção está liberado para o seu usuário. Fale com um administrador.
        </p>
      )}
    </main>
  );
}
