import type { ReactNode } from 'react';
import { Loader2, AlertTriangle, Inbox } from 'lucide-react';

export function LoadingView({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-[var(--color-text-muted)]">
      <Loader2 size={22} className="animate-spin text-[var(--color-brand)]" />
      {label}
    </div>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertTriangle size={24} className="text-[var(--color-bad)]" />
      <p className="max-w-sm text-sm text-[var(--color-text)]">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyView({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--color-border)] py-16 text-center">
      <Inbox size={24} className="text-[var(--color-text-faint)]" />
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-xs text-[var(--color-text-muted)]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
