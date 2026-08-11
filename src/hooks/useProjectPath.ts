import { useParams } from 'react-router-dom';

/**
 * Monta caminhos dentro do projeto atual.
 *
 * Todas as rotas operacionais vivem sob /project/:projectId/*, então links
 * internos precisam carregar o id — é isso que torna a URL compartilhável e
 * independente de estado global.
 */
export function useProjectPath() {
  const { projectId } = useParams();
  return (path: string) => `/project/${projectId}/${path.replace(/^\//, '')}`;
}
