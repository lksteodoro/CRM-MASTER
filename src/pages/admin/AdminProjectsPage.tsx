import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { listProjects } from '../../services/projects.service';
import { listClients } from '../../services/clients.service';
import type { ClientRow, ProjectRow } from '../../integrations/supabase/database.types';
import { LoadingView, ErrorView, EmptyView } from '../../components/ui/StateView';
import { Card } from '../../components/ui/Card';

export function AdminProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([
        listProjects({ includeArchived: showArchived }),
        listClients(true),
      ]);
      setProjects(p);
      setClients(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar os projetos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [showArchived]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? '—';

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Projetos</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Todos os projetos da organização
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-brand)]"
          />
          Mostrar arquivados
        </label>
      </div>

      {loading && <LoadingView />}
      {!loading && error && <ErrorView message={error} onRetry={() => void load()} />}
      {!loading && !error && projects.length === 0 && (
        <EmptyView
          title="Nenhum projeto cadastrado."
          description="Crie um projeto a partir da página do cliente."
        />
      )}

      {!loading && !error && projects.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                <th className="pb-3">Projeto</th>
                <th className="pb-3">Cliente</th>
                <th className="pb-3">Fuso / Moeda</th>
                <th className="pb-3">Status</th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/project/${p.id}/dashboard`)}
                  className="cursor-pointer border-b border-[var(--color-border-soft)] hover:bg-[var(--color-panel-2)]"
                >
                  <td className="py-3 font-medium text-[var(--color-text)]">{p.name}</td>
                  <td className="py-3 text-[var(--color-text-muted)]">{clientName(p.client_id)}</td>
                  <td className="py-3 text-[11px] text-[var(--color-text-faint)]">
                    {p.timezone} · {p.currency}
                  </td>
                  <td className="py-3">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-[10px] ' +
                        (p.status === 'ACTIVE'
                          ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]'
                          : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]')
                      }
                    >
                      {p.status === 'ACTIVE' ? 'Ativo' : p.status === 'PAUSED' ? 'Pausado' : 'Arquivado'}
                    </span>
                  </td>
                  <td className="py-3 pr-2 text-right">
                    <ArrowRight size={14} className="inline text-[var(--color-text-faint)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
