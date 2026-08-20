import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, Database, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import { useMetaIntegrationStatus } from '../hooks/useMetaIntegrationStatus';
import { syncEntities, syncInsights } from '../services/metaAds.service';
import { MetricsTabs } from '../components/metrics/MetricsTabs';
import { MetaNotConnectedPrompt } from '../components/metrics/MetaNotConnectedPrompt';
import { LoadingView } from '../components/ui/StateView';
import { fmt } from '../lib/metrics';

export function Dashboard() {
  const { project, permissions } = useProject();
  const { dateRange } = useFilters();
  const { projectId } = useParams();
  const metaStatus = useMetaIntegrationStatus(projectId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    if (metaStatus !== 'CONNECTED') return;

    const today = fmt(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const defaultSince = fmt(yesterdayDate);
    const isSingleDayPreset = dateRange.preset === 'today' || dateRange.preset === 'yesterday';
    const since = isSingleDayPreset ? dateRange.start : defaultSince;
    const until = isSingleDayPreset ? dateRange.end : today;
    const syncKey = `leads-hub-meta-daily-sync:${project.id}:${today}:${since}:${until}`;

    if (window.localStorage.getItem(syncKey) === 'done') return;

    let active = true;
    setSyncing(true);
    setSyncMessage('Sincronizando métricas diárias da Meta...');

    void (async () => {
      try {
        const [insightsResult, entitiesResult] = await Promise.all([
          syncInsights(project.id, { since, until }),
          syncEntities(project.id),
        ]);
        if (!insightsResult.ok) throw new Error(insightsResult.error ?? 'A Meta não retornou as métricas.');
        if (!entitiesResult.ok) throw new Error(entitiesResult.error ?? 'A Meta não retornou campanhas e anúncios.');
        window.localStorage.setItem(syncKey, 'done');
        if (active) {
          setRefreshKey((value) => value + 1);
          setSyncMessage(`Sincronização diária concluída (${since} a ${until}).`);
        }
      } catch (caught) {
        if (active) setSyncMessage(caught instanceof Error ? `Falha na sincronização diária: ${caught.message}` : 'Falha na sincronização diária.');
      } finally {
        if (active) setSyncing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [dateRange.end, dateRange.preset, dateRange.start, metaStatus, project.id]);

  async function refreshMeta() {
    setSyncing(true);
    setSyncMessage('');
    try {
      const [insightsResult, entitiesResult] = await Promise.all([
        syncInsights(project.id, { since: dateRange.start, until: dateRange.end }),
        syncEntities(project.id),
      ]);
      if (!insightsResult.ok) throw new Error(insightsResult.error ?? 'A Meta não retornou as métricas.');
      if (!entitiesResult.ok) throw new Error(entitiesResult.error ?? 'A Meta não retornou campanhas e anúncios.');
      setRefreshKey((value) => value + 1);
      setSyncMessage('Dados da Meta atualizados agora.');
    } catch (caught) {
      setSyncMessage(caught instanceof Error ? caught.message : 'Não foi possível atualizar a Meta.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="relative flex min-h-max flex-col gap-6 overflow-x-hidden p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_15%_0%,rgba(91,124,250,0.14),transparent_42%),radial-gradient(circle_at_88%_0%,rgba(167,139,250,0.09),transparent_34%)]" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${metaStatus === 'CONNECTED' ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300' : 'border-amber-400/20 bg-amber-400/8 text-amber-300'}`}>
              <Wifi size={11} /> {metaStatus === 'CONNECTED' ? 'Dados reais conectados' : 'Integração pendente'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/80 px-2.5 py-1 text-[10px] text-[var(--color-text-muted)]">
              <Database size={11} /> Meta Ads + CRM
            </span>
          </div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-[var(--color-brand)]">
            <ShieldCheck size={14} /> Central de performance
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">
            Visão executiva — {project.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span>Mídia, aquisição, leads e vendas em uma única visão.</span>
            <span className="inline-flex items-center gap-1 text-[var(--color-text-faint)]">
              <CalendarDays size={11} /> {dateRange.start} — {dateRange.end}
            </span>
          </div>
        </div>
        {metaStatus === 'CONNECTED' && (
          <button
            type="button"
            onClick={() => void refreshMeta()}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-brand)]/35 bg-[linear-gradient(135deg,rgba(91,124,250,0.2),rgba(167,139,250,0.1))] px-4 py-2.5 text-xs font-semibold text-[var(--color-text)] shadow-[0_12px_35px_rgba(0,0,0,0.2)] transition hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)] disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Atualizando Meta...' : 'Atualizar dados da Meta'}
          </button>
        )}
      </div>

      {syncMessage && <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-muted)]">{syncMessage}</p>}

      {metaStatus === null && <LoadingView label="Carregando..." />}

      {metaStatus !== null && metaStatus !== 'CONNECTED' && (
        <MetaNotConnectedPrompt canEdit={permissions.can_edit_settings} />
      )}

      <MetricsTabs refreshKey={refreshKey} />

    </div>
  );
}
