import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { listAuditLogs, describeAuditLog, type AuditLogWithUser } from '../../services/audit.service';
import { LoadingView, ErrorView, EmptyView } from '../../components/ui/StateView';
import { Card } from '../../components/ui/Card';
import type { Json } from '../../integrations/supabase/database.types';

const entityOptions = [
  { value: '', label: 'Todas as entidades' },
  { value: 'CLIENT', label: 'Clientes' },
  { value: 'PROJECT', label: 'Projetos' },
  { value: 'PROJECT_GOAL', label: 'Metas' },
  { value: 'PROJECT_SETTINGS', label: 'Configurações' },
  { value: 'PROJECT_USER', label: 'Permissões' },
  { value: 'PROFILE', label: 'Usuários' },
];

function renderValue(value: Json | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogWithUser[]>([]);
  const [entityType, setEntityType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setLogs(await listAuditLogs({ entityType: entityType || undefined, limit: 200 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [entityType]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Auditoria</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Histórico de alterações registrado pelo banco — inclui mudanças feitas por API
          </p>
        </div>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)]"
        >
          {entityOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingView />}
      {!loading && error && <ErrorView message={error} onRetry={() => void load()} />}
      {!loading && !error && logs.length === 0 && (
        <EmptyView
          title="Nenhum registro de auditoria."
          description="As alterações aparecerão aqui assim que houver movimentação."
        />
      )}

      {!loading && !error && logs.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2">
            {logs.map((log) => {
              const { entity, action, field } = describeAuditLog(log);
              return (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--color-border-soft)] py-2.5 text-xs last:border-0"
                >
                  <span className="w-32 shrink-0 text-[var(--color-text-faint)]">
                    {new Date(log.created_at).toLocaleString('pt-BR')}
                  </span>
                  <span className="font-medium text-[var(--color-text)]">
                    {log.user?.name ?? 'Sistema'}
                  </span>
                  <span className="text-[var(--color-text-muted)]">{action}</span>
                  <span className="rounded-full bg-[var(--color-panel-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                    {entity}
                  </span>
                  {field && (
                    <>
                      <span className="text-[var(--color-text-muted)]">·</span>
                      <span className="text-[var(--color-text)]">{field}</span>
                      <span className="flex items-center gap-1 text-[var(--color-text-faint)]">
                        {renderValue(log.old_value)}
                        <ArrowRight size={10} />
                        <span className="text-[var(--color-good)]">{renderValue(log.new_value)}</span>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
