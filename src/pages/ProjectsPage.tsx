import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, ArrowRight, LogOut, Building2 } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { listProjects } from '../services/projects.service';
import { listClients } from '../services/clients.service';
import type { ClientRow, ProjectRow } from '../integrations/supabase/database.types';
import { LoadingView, ErrorView, EmptyView } from '../components/ui/StateView';

/**
 * Tela de entrada do CLIENT: apenas os projetos liberados para ele.
 * O filtro real vem do RLS — aqui não há nenhuma checagem de permissão.
 */
export function ProjectsPage() {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([listProjects(), listClients()]);
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
  }, []);

  const clientName = (clientId: string) => clients.find((c) => c.id === clientId)?.name ?? '';

  return (
    <div className="flex min-h-screen flex-col items-center bg-[var(--color-bg)] px-6 py-16">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-brand)]">
          <GraduationCap size={24} className="text-white" />
        </div>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">Seus projetos</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {profile?.name} · {profile?.email}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => navigate('/agency')}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
            >
              <Building2 size={13} /> Área da agência
            </button>
          )}
          <button
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
          >
            <LogOut size={13} /> Sair
          </button>
        </div>
      </div>

      <div className="w-full max-w-4xl">
        {loading && <LoadingView label="Carregando projetos..." />}
        {!loading && error && <ErrorView message={error} onRetry={() => void load()} />}

        {!loading && !error && projects.length === 0 && (
          <EmptyView
            title="Nenhum projeto foi liberado para sua conta."
            description="Entre em contato com o responsável pela sua conta para solicitar acesso."
          />
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/project/${p.id}/dashboard`)}
                className="group flex flex-col items-start rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-left transition-colors hover:border-[var(--color-brand)]"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <h2 className="truncate text-base font-semibold text-[var(--color-text)]">
                    {p.name}
                  </h2>
                  <ArrowRight
                    size={18}
                    className="shrink-0 text-[var(--color-text-faint)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-brand)]"
                  />
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
                  {clientName(p.client_id)}
                </p>
                {p.description && (
                  <p className="mt-3 line-clamp-2 text-xs text-[var(--color-text-faint)]">
                    {p.description}
                  </p>
                )}
                {p.status !== 'ACTIVE' && (
                  <span className="mt-3 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] text-[var(--color-warn)]">
                    {p.status === 'PAUSED' ? 'Pausado' : 'Arquivado'}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
