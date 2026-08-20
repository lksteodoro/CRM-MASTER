import { useCallback, useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useProjectAccess } from '../../hooks/useProjectAccess';
import { getGoalForDate } from '../../services/goals.service';
import { ProjectProvider } from '../../state/ProjectContext';
import { useFilters } from '../../state/FiltersContext';
import type { ProjectGoalRow } from '../../integrations/supabase/database.types';
import { LoadingView, ErrorView } from '../ui/StateView';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Shell das rotas /project/:projectId/*.
 *
 * Carrega projeto, metas e permissões reais do Supabase e disponibiliza via
 * ProjectContext. As métricas (campanhas, anúncios, leads, vendas) continuam
 * vindo dos mocks nesta fase — `bindDemoDataset` amarra o projeto real a um
 * conjunto de dados de demonstração para que os dashboards sigam renderizando.
 * Essa amarração some quando a integração com a Meta entrar.
 */
export function ProjectLayout() {
  const { projectId } = useParams();
  const { project, permissions, loading, error, allowed } = useProjectAccess(projectId);
  const { bindDemoDataset } = useFilters();

  const [goals, setGoals] = useState<ProjectGoalRow | null>(null);
  const [goalsLoading, setGoalsLoading] = useState(true);

  const reloadGoals = useCallback(async () => {
    if (!projectId) return;
    setGoalsLoading(true);
    try {
      setGoals(await getGoalForDate(projectId));
    } finally {
      setGoalsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reloadGoals();
  }, [reloadGoals]);

  useEffect(() => {
    if (project) bindDemoDataset(project.id, goals);
  }, [project?.id, goals, bindDemoDataset]);

  if (loading || goalsLoading) return <LoadingView label="Carregando projeto..." />;
  if (error) return <ErrorView message={error} />;
  if (!project || !allowed) {
    return <ErrorView message="Você não tem acesso a este projeto ou ele não existe." />;
  }

  return (
    <ProjectProvider value={{ project, goals, permissions, reloadGoals }}>
      <div className="flex h-screen bg-[var(--color-bg)]">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <Topbar />
          <Outlet />
        </div>
      </div>
    </ProjectProvider>
  );
}
