import { useEffect, useState } from 'react';
import { getProject, getMyProjectPermissions } from '../services/projects.service';
import { useAuth } from '../providers/AuthProvider';
import type { ProjectRow, ProjectUserRow } from '../integrations/supabase/database.types';
import { defaultPermissions, type ProjectPermissionFlags } from '../services/users.service';

const adminPermissions: ProjectPermissionFlags = {
  can_view: true,
  can_edit_goals: true,
  can_edit_settings: true,
  can_view_leads: true,
  can_view_sales: true,
  can_view_commercial: true,
  can_export: true,
};

export interface ProjectAccess {
  project: ProjectRow | null;
  permissions: ProjectPermissionFlags;
  loading: boolean;
  error: string | null;
  /** false quando o projeto não existe ou o usuário não tem acesso a ele. */
  allowed: boolean;
}

/**
 * Carrega o projeto da rota junto com as permissões efetivas do usuário.
 *
 * O RLS já impede que um projeto não autorizado seja retornado — trocar o id na
 * URL simplesmente devolve `null`. As permissões aqui servem para esconder
 * controles na interface, não como mecanismo de segurança.
 */
export function useProjectAccess(projectId: string | undefined): ProjectAccess {
  const { isAdmin, profile } = useAuth();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [permissions, setPermissions] = useState<ProjectPermissionFlags>(defaultPermissions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!projectId || !profile) {
      setLoading(false);
      setProject(null);
      return;
    }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const found = await getProject(projectId);
        if (!active) return;
        setProject(found);

        if (!found) {
          setPermissions(defaultPermissions);
          return;
        }

        if (isAdmin) {
          setPermissions(adminPermissions);
          return;
        }

        const row: ProjectUserRow | null = await getMyProjectPermissions(projectId);
        if (!active) return;
        setPermissions(row ?? { ...defaultPermissions, can_view: false });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Erro ao carregar o projeto.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // profile.id (não o objeto) evita recarregar quando só a referência muda
    // (ex: AuthProvider recriando o profile após uma renovação de token).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isAdmin, profile?.id]);

  return {
    project,
    permissions,
    loading,
    error,
    allowed: Boolean(project) && permissions.can_view,
  };
}
