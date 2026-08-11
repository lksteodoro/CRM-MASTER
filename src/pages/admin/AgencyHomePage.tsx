import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, FolderKanban, Users, ScrollText, ArrowRight, Kanban } from 'lucide-react';
import { listClients } from '../../services/clients.service';
import { listProjects } from '../../services/projects.service';
import { listOrganizationUsers } from '../../services/users.service';
import { LoadingView, ErrorView } from '../../components/ui/StateView';

/** Versão inicial da Central Operacional do administrador. */
export function AgencyHomePage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ clients: 0, projects: 0, users: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clients, projects, users] = await Promise.all([
        listClients(),
        listProjects(),
        listOrganizationUsers(),
      ]);
      setCounts({ clients: clients.length, projects: projects.length, users: users.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar os dados.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={() => void load()} />;

  const cards = [
    { label: 'Clientes', value: counts.clients, icon: Building2, to: '/admin/clients', description: null },
    { label: 'Projetos', value: counts.projects, icon: FolderKanban, to: '/admin/projects', description: null },
    { label: 'Usuários', value: counts.users, icon: Users, to: '/admin/users', description: null },
    {
      label: 'Kanban',
      value: null,
      icon: Kanban,
      to: '/agency/kanban',
      description: 'Quadro de tarefas internas',
    },
    {
      label: 'Auditoria',
      value: null,
      icon: ScrollText,
      to: '/admin/audit',
      description: 'Histórico de alterações',
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Central da Agência</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Visão geral da operação e atalhos administrativos
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.label}
            onClick={() => navigate(card.to)}
            className="group flex flex-col items-start rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-left hover:border-[var(--color-brand)]"
          >
            <div className="flex w-full items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-brand-soft)]">
                <card.icon size={17} className="text-[var(--color-brand)]" />
              </span>
              <ArrowRight
                size={16}
                className="text-[var(--color-text-faint)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-brand)]"
              />
            </div>
            {card.value !== null ? (
              <p className="mt-4 text-2xl font-semibold text-[var(--color-text)]">{card.value}</p>
            ) : (
              <p className="mt-4 text-sm text-[var(--color-text-muted)]">{card.description}</p>
            )}
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{card.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
