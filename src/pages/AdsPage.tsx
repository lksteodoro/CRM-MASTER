import { useParams } from 'react-router-dom';
import { useProject } from '../state/ProjectContext';
import { useMetaIntegrationStatus } from '../hooks/useMetaIntegrationStatus';
import { RealAdsTable } from '../components/ads/RealAdsTable';
import { MetaNotConnectedPrompt } from '../components/metrics/MetaNotConnectedPrompt';
import { LoadingView } from '../components/ui/StateView';

export function AdsPage() {
  const { project, permissions } = useProject();
  const { projectId } = useParams();
  const metaStatus = useMetaIntegrationStatus(projectId);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">
          Anúncios — {project.name}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Dados reais sincronizados da Meta Ads
        </p>
      </div>

      {metaStatus === null && <LoadingView label="Carregando..." />}
      {metaStatus !== null && metaStatus !== 'CONNECTED' && (
        <MetaNotConnectedPrompt canEdit={permissions.can_edit_settings} />
      )}
      {metaStatus === 'CONNECTED' && <RealAdsTable />}
    </div>
  );
}
