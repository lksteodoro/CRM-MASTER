import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, AlertCircle, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import type { Alert } from '../../lib/alerts';

const severityStyle = {
  critical: {
    icon: AlertCircle,
    color: 'var(--color-bad)',
    bg: 'var(--color-bad-soft)',
    label: 'Crítico',
  },
  warning: {
    icon: AlertTriangle,
    color: 'var(--color-warn)',
    bg: 'var(--color-warn-soft)',
    label: 'Atenção',
  },
  info: {
    icon: AlertTriangle,
    color: 'var(--color-info)',
    bg: 'var(--color-info-soft)',
    label: 'Info',
  },
} as const;

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-good-soft)] bg-[var(--color-good-soft)] px-4 py-3 text-sm text-[var(--color-good)]">
        <CheckCircle2 size={16} />
        Nenhum alerta no momento — campanhas dentro do esperado.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
          <AlertCircle size={16} className="text-[var(--color-bad)]" />
          Alertas
          {criticalCount > 0 && (
            <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-[11px] text-[var(--color-bad)]">
              {criticalCount} crítico{criticalCount > 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[11px] text-[var(--color-warn)]">
              {warningCount} atenção
            </span>
          )}
        </div>
        {collapsed ? (
          <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
        ) : (
          <ChevronUp size={16} className="text-[var(--color-text-muted)]" />
        )}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] p-3">
          {alerts.map((alert) => {
            const style = severityStyle[alert.severity];
            const Icon = style.icon;
            const content = (
              <div className="flex items-start gap-3 rounded-lg p-2.5 hover:bg-[var(--color-panel-2)]">
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: style.bg }}
                >
                  <Icon size={13} style={{ color: style.color }} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)]">{alert.title}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{alert.description}</p>
                </div>
              </div>
            );
            return alert.link ? (
              <Link key={alert.id} to={alert.link} className="block">
                {content}
              </Link>
            ) : (
              <div key={alert.id}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
