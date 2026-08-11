import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectGoalRow, ProjectRow } from '../integrations/supabase/database.types';
import type { ProjectPermissionFlags } from '../services/users.service';

interface ProjectContextValue {
  project: ProjectRow;
  /** Meta do período que contém a data de hoje. `null` se ainda não definida. */
  goals: ProjectGoalRow | null;
  permissions: ProjectPermissionFlags;
  reloadGoals: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  value,
  children,
}: {
  value: ProjectContextValue;
  children: ReactNode;
}) {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/** Dados reais (Supabase) do projeto da rota. */
export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}

/** Versão tolerante, para componentes que também rodam fora de um projeto. */
export function useProjectOptional() {
  return useContext(ProjectContext);
}
