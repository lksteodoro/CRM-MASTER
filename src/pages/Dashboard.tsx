import { useParams } from 'react-router-dom';
import { useProject } from '../state/ProjectContext';
import { useMetaIntegrationStatus } from '../hooks/useMetaIntegrationStatus';
import { RealPacingCard } from '../components/metrics/RealPacingCard';
import { MetricsTabs } from '../components/metrics/MetricsTabs';
import { MetaNotConnectedPrompt } from '../components/metrics/MetaNotConnectedPrompt';
import { LoadingView } from '../components/ui/StateView';

export function Dashboard() {
  const { project, permissions } = useProject();
  const { projectId } = useParams();
  const metaStatus = useMetaIntegrationStatus(projectId);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">
          {project.name} — Dashboard de Aquisição de Leads
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Dados consolidados da Meta Ads e do webhook de leads deste projeto
        </p>
      </div>

      <RealPacingCard />

      {metaStatus === null && <LoadingView label="Carregando..." />}

      {metaStatus !== null && metaStatus !== 'CONNECTED' && (
        <MetaNotConnectedPrompt canEdit={permissions.can_edit_settings} />
      )}

      <MetricsTabs />

      {metaStatus === 'CONNECTED' && (
        <p className="text-[11px] text-[var(--color-text-faint)]">
          Alertas automáticos de performance ainda não migraram para dados reais — voltam ao
          dashboard conforme forem reconstruídos sobre a Meta Ads API real.
        </p>
      )}
    </div>
  );
}
