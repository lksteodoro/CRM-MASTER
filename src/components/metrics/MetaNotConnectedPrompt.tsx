import { Link } from 'react-router-dom';
import { PlugZap } from 'lucide-react';
import { useProjectPath } from '../../hooks/useProjectPath';
import { Card } from '../ui/Card';

/**
 * Estado vazio para páginas que só fazem sentido com dados reais da Meta
 * (Dashboard, Campanhas, Anúncios). Substitui o antigo fallback que mostrava
 * um dataset de demonstração — evitava confundir números fictícios com
 * dados reais em projetos recém-criados que ainda não têm conta vinculada.
 */
export function MetaNotConnectedPrompt({
  title = 'Este projeto ainda não está conectado à Meta Ads',
  canEdit = true,
}: {
  title?: string;
  canEdit?: boolean;
}) {
  const projectPath = useProjectPath();

  return (
    <Card className="flex flex-col items-center gap-3 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-soft)]">
        <PlugZap size={22} className="text-[var(--color-brand)]" />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
        <p className="mt-1 max-w-sm text-xs text-[var(--color-text-muted)]">
          {canEdit
            ? 'Conecte a conta de anúncios deste projeto para puxar campanhas, anúncios e métricas reais.'
            : 'Peça a um administrador para conectar a conta de anúncios da Meta nas Configurações deste projeto.'}
        </p>
      </div>
      {canEdit && (
        <Link
          to={projectPath('configuracoes')}
          className="mt-1 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Ir para Configurações
        </Link>
      )}
    </Card>
  );
}
