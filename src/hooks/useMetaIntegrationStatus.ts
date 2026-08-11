import { useEffect, useState } from 'react';
import { getIntegration } from '../services/metaAds.service';
import type { MetaIntegrationStatus } from '../integrations/supabase/database.types';

/** `null` enquanto carrega, 'DISCONNECTED' se não há integração configurada. */
export function useMetaIntegrationStatus(projectId: string | undefined) {
  const [status, setStatus] = useState<MetaIntegrationStatus | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setStatus(null);
    (async () => {
      const integration = await getIntegration(projectId);
      if (active) setStatus(integration?.status ?? 'DISCONNECTED');
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  return status;
}
