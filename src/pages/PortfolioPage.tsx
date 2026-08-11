import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import { listProjects } from '../services/projects.service';
import { getIntegration, listAdInsights } from '../services/metaAds.service';
import { realProjectRollup, type RealRollup } from '../lib/realRollups';
import { formatBRL, formatNumber, formatPercent } from '../lib/format';
import { heatBg } from '../lib/heatmap';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';
import type { ProjectRow } from '../integrations/supabase/database.types';

interface Row {
  project: ProjectRow;
  connected: boolean;
  metrics: RealRollup | null;
}

export function PortfolioPage() {
  const { project: currentProject } = useProject();
  const { dateRange } = useFilters();
  const navigate = useNavigate();

  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    (async () => {
      const projects = await listProjects({ clientId: currentProject.client_id });
      const withMetrics = await Promise.all(
        projects.map(async (project): Promise<Row> => {
          const integration = await getIntegration(project.id);
          if (integration?.status !== 'CONNECTED') {
            return { project, connected: false, metrics: null };
          }
          const insights = await listAdInsights(project.id, {
            since: dateRange.start,
            until: dateRange.end,
          });
          return { project, connected: true, metrics: realProjectRollup(insights) };
        })
      );
      if (!active) return;
      setRows(withMetrics);
    })();
    return () => {
      active = false;
    };
  }, [currentProject.client_id, dateRange.start, dateRange.end]);

  if (rows === null) return <LoadingView label="Carregando projetos..." />;

  const totals = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + (r.metrics?.spend ?? 0),
      leadsCount: acc.leadsCount + (r.metrics?.leadsCount ?? 0),
    }),
    { spend: 0, leadsCount: 0 }
  );

  const cplPeers = rows.map((r) => r.metrics?.cpl ?? 0);
  const ctrPeers = rows.map((r) => r.metrics?.ctr ?? 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Visão Geral</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Comparativo entre os projetos deste cliente no período selecionado
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Projetos" value={formatNumber(rows.length)} />
        <SummaryTile
          label="Conectados à Meta"
          value={formatNumber(rows.filter((r) => r.connected).length)}
        />
        <SummaryTile label="Investimento Total" value={formatBRL(totals.spend)} />
        <SummaryTile label="Leads Totais" value={formatNumber(totals.leadsCount)} accent="var(--color-good)" />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-3 text-left text-xs font-medium text-[var(--color-text-faint)]">Projeto</th>
              <th className="pb-3 text-center text-xs font-medium text-[var(--color-text-faint)]">Meta Ads</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--color-text-faint)]">Investimento</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--color-text-faint)]">Leads</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--color-text-faint)]">CPL</th>
              <th className="pb-3 text-right text-xs font-medium text-[var(--color-text-faint)]">CTR</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.project.id}
                onClick={() => navigate(`/project/${r.project.id}/dashboard`)}
                className="cursor-pointer border-b border-[var(--color-border-soft)] hover:bg-[var(--color-panel-2)]"
              >
                <td className="py-3">
                  <p className="truncate font-medium text-[var(--color-text)]">{r.project.name}</p>
                </td>
                <td className="py-3 text-center">
                  {r.connected ? (
                    <CheckCircle2 size={15} className="mx-auto text-[var(--color-good)]" />
                  ) : (
                    <XCircle size={15} className="mx-auto text-[var(--color-text-faint)]" />
                  )}
                </td>
                <td className="py-3 text-right text-[var(--color-text)]">
                  {r.metrics ? formatBRL(r.metrics.spend) : '—'}
                </td>
                <td className="py-3 text-right text-[var(--color-text)]">
                  {r.metrics ? formatNumber(r.metrics.leadsCount) : '—'}
                </td>
                <td
                  className="px-2 py-3 text-right text-[var(--color-text)]"
                  style={r.metrics ? { background: heatBg(r.metrics.cpl, cplPeers, true) } : undefined}
                >
                  {r.metrics ? formatBRL(r.metrics.cpl) : '—'}
                </td>
                <td
                  className="px-2 py-3 text-right text-[var(--color-text)]"
                  style={r.metrics ? { background: heatBg(r.metrics.ctr, ctrPeers) } : undefined}
                >
                  {r.metrics ? formatPercent(r.metrics.ctr, 2) : '—'}
                </td>
                <td className="py-3 pr-2 text-right text-[10px] text-[var(--color-text-faint)]">
                  {!r.connected && 'não conectado'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                  Nenhum outro projeto deste cliente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value, accent = 'var(--color-text)' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
