import type { ReactNode } from 'react';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import {
  ACTION_STATUS_LABEL,
  MODE_LABEL,
  type ActionStatus,
  type Mode,
  type Severity,
} from '../../../supabase/functions/optimization-ia/engine.ts';

export const inputClass =
  'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-brand)] focus:outline-none disabled:opacity-50';
export const primaryButton =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60 disabled:cursor-not-allowed disabled:opacity-50';
export const ghostButton =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] px-3 text-sm text-[var(--color-text)] transition hover:bg-[var(--color-brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60 disabled:cursor-not-allowed disabled:opacity-50';
export const dangerButton =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] px-3 text-sm font-medium text-[var(--color-bad)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bad)]/60 disabled:cursor-not-allowed disabled:opacity-50';

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'brand' | 'muted' | 'violet';

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-[var(--color-good-soft)] text-[var(--color-good)]',
  warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  bad: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
  violet: 'bg-[var(--color-violet-soft)] text-[var(--color-violet)]',
  muted: 'bg-white/5 text-[var(--color-text-muted)]',
};

export function Chip({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', TONE_CLASS[tone])}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<ActionStatus, Tone> = {
  PROPOSED: 'info',
  PENDING_APPROVAL: 'warn',
  APPROVED: 'brand',
  EXECUTING: 'brand',
  EXECUTED: 'good',
  REJECTED: 'muted',
  DISMISSED: 'muted',
  SKIPPED: 'muted',
  FAILED: 'bad',
  REVERTED: 'violet',
  EXPIRED: 'muted',
};

export function StatusChip({ status }: { status: ActionStatus }) {
  return <Chip tone={STATUS_TONE[status] ?? 'muted'}>{ACTION_STATUS_LABEL[status] ?? status}</Chip>;
}

const MODE_TONE: Record<Mode, Tone> = { OBSERVE: 'info', APPROVAL: 'warn', AUTO_LIMITED: 'violet', PAUSED: 'muted' };

export function ModeChip({ mode }: { mode: Mode }) {
  return <Chip tone={MODE_TONE[mode]}>{MODE_LABEL[mode]}</Chip>;
}

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  OK: { label: 'OK', tone: 'good' },
  RUNNING: { label: 'Rodando', tone: 'brand' },
  RATE_LIMITED: { label: 'Limite da Meta', tone: 'warn' },
  PERMISSION_ERROR: { label: 'Sem permissão', tone: 'bad' },
  TOKEN_EXPIRED: { label: 'Token expirado', tone: 'bad' },
  DISCONNECTED: { label: 'Desconectado', tone: 'bad' },
  FAILED: { label: 'Falhou', tone: 'bad' },
  SKIPPED: { label: 'Pulado', tone: 'muted' },
};

export function RunStatusChip({ status }: { status: string | null }) {
  if (!status) return <Chip>Nunca avaliado</Chip>;
  const info = RUN_STATUS[status] ?? { label: status, tone: 'muted' as Tone };
  return <Chip tone={info.tone}>{info.label}</Chip>;
}

export function SeverityIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  if (severity === 'CRITICAL') return <AlertOctagon size={size} className="shrink-0 text-[var(--color-bad)]" aria-label="Crítico" />;
  if (severity === 'WARNING') return <AlertTriangle size={size} className="shrink-0 text-[var(--color-warn)]" aria-label="Atenção" />;
  return <Info size={size} className="shrink-0 text-[var(--color-info)]" aria-label="Informativo" />;
}

export function Panel({ title, description, action, children, className }: { title?: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>}
            {description && <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-5 py-12 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white/5 text-[var(--color-text-faint)]">{icon}</div>
      <p className="mt-3 text-sm font-medium text-[var(--color-text)]">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className={clsx('mt-2 text-xl font-semibold', tone === 'bad' ? 'text-[var(--color-bad)]' : tone === 'warn' ? 'text-[var(--color-warn)]' : 'text-[var(--color-text)]')}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">{hint}</p>}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-4 text-[var(--color-text-faint)]">{hint}</span>}
    </label>
  );
}
