import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import { useProjectAccess } from '../hooks/useProjectAccess';
import { LoadingView, ErrorView } from '../components/ui/StateView';
import type { AgencyToolKey } from '../services/agencyTools.service';

/** Exige sessão válida e profile ACTIVE. */
export function ProtectedRoute() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingView label="Carregando sua sessão..." />;

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Sessão existe mas o profile não está ativo (desativado ou inexistente).
  if (!profile) {
    return (
      <ErrorView message="Sua conta está inativa ou não foi encontrada. Fale com o administrador." />
    );
  }

  return <Outlet />;
}

/** Restringe a área administrativa ao papel ADMIN. */
export function AdminRoute() {
  const { isAdmin, loading } = useAuth();

  if (loading) return <LoadingView />;
  if (!isAdmin) return <Navigate to="/projects" replace />;

  return <Outlet />;
}

/**
 * Libera uma ferramenta operacional específica para ADMINs e para os usuários
 * que receberam a chave correspondente em Configurações > Usuários e acessos.
 * A verificação existe também na rota para que digitar a URL não contorne o menu.
 */
export function AgencyToolRoute({ tool }: { tool: AgencyToolKey }) {
  const { canUseAgencyTool, loading } = useAuth();

  if (loading) return <LoadingView />;
  if (!canUseAgencyTool(tool)) return <Navigate to="/projects" replace />;

  return <Outlet />;
}

/**
 * Valida o projeto da URL.
 *
 * A segurança real está no RLS: um projeto não autorizado simplesmente não é
 * retornado pelo banco. Este guard existe para transformar isso em uma tela
 * clara em vez de uma página vazia.
 */
export function ProjectRoute() {
  const { projectId } = useParams();
  const { project, loading, error, allowed } = useProjectAccess(projectId);

  if (loading) return <LoadingView label="Carregando projeto..." />;
  if (error) return <ErrorView message={error} />;

  if (!project || !allowed) {
    return (
      <ErrorView message="Você não tem acesso a este projeto ou ele não existe." />
    );
  }

  return <Outlet />;
}
