import { useEffect, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { useFilters } from '../../state/FiltersContext';
import { listAdInsights, listMetaEntities } from '../../services/metaAds.service';
import { realCampaignRollups, realProjectRollup, type RealCampaignRow } from '../../lib/realRollups';
import { useSort } from '../../lib/useSort';
import { formatBRL, formatNumber, formatPercent } from '../../lib/format';
import { heatBg } from '../../lib/heatmap';
import { SortHeader } from '../ui/SortHeader';
import { Card } from '../ui/Card';
import { LoadingView } from '../ui/StateView';
import type { MetaEntityRow } from '../../integrations/supabase/database.types';

const statusStyle: Record<string, string> = {
  ACTIVE: 'bg-[var(--color-good-soft)] text-[var(--color-good)]',
  PAUSED: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  ARCHIVED: 'bg-[var(--color-panel-2)] text-[var(--color-text-faint)]',
  DELETED: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]',
};

export function RealCampaignsTable() {
  const { project } = useProject();
  const { dateRange } = useFilters();

  const [rows, setRows] = useState<RealCampaignRow[] | null>(null);
  const [entities, setEntities] = useState<Map<string, MetaEntityRow>>(new Map());

  useEffect(() => {
    let active = true;
    setRows(null);
    (async () => {
      const [insights, campaignEntities] = await Promise.all([
        listAdInsights(project.id, { since: dateRange.start, until: dateRange.end }),
        listMetaEntities(project.id, 'campaign').catch(() => []),
      ]);
      if (!active) return;
      setRows(realCampaignRollups(insights));
      setTotals(realProjectRollup(insights));
      setEntities(new Map(campaignEntities.map((e) => [e.external_id, e])));
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, dateRange.start, dateRange.end]);

  const [totals, setTotals] = useState<ReturnType<typeof realProjectRollup> | null>(null);

  const { sorted, sortKey, sortDir, toggle } = useSort<RealCampaignRow>(rows ?? [], 'spend', 'desc');

  if (rows === null) return <LoadingView label="Carregando campanhas..." />;

  const cplPeers = sorted.map((r) => r.cpl);
  const ctrPeers = sorted.map((r) => r.ctr);

  return (
    <div className="flex flex-col gap-6">
      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryTile label="Investimento" value={formatBRL(totals.spend)} />
          <SummaryTile label="Leads" value={formatNumber(totals.leadsCount)} />
          <SummaryTile label="CPL médio" value={formatBRL(totals.cpl)} />
          <SummaryTile label="Cliques" value={formatNumber(totals.clicks)} />
          <SummaryTile label="CTR médio" value={formatPercent(totals.ctr, 2)} />
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-3 text-left text-xs font-medium text-[var(--color-text-faint)]">Campanha</th>
              <SortHeader label="Investimento" colKey="spend" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Leads" colKey="leadsCount" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="CPL" colKey="cpl" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Cliques" colKey="clicks" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="CTR" colKey="ctr" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Alcance" colKey="reach" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const entity = entities.get(r.id);
              return (
              <tr key={r.id} className="border-b border-[var(--color-border-soft)]">
                <td className="py-3">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-medium text-[var(--color-text)]">{r.name}</p>
                    {entity?.status && (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusStyle[entity.status] ?? statusStyle.ARCHIVED}`}
                      >
                        {entity.status}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-[var(--color-text-faint)]">{r.adCount} anúncio(s)</p>
                </td>
                <td className="py-3 text-right text-[var(--color-text)]">{formatBRL(r.spend)}</td>
                <td className="py-3 text-right text-[var(--color-text)]">{formatNumber(r.leadsCount)}</td>
                <td className="px-2 py-3 text-right text-[var(--color-text)]" style={{ background: heatBg(r.cpl, cplPeers, true) }}>
                  {formatBRL(r.cpl)}
                </td>
                <td className="py-3 text-right text-[var(--color-text)]">{formatNumber(r.clicks)}</td>
                <td className="px-2 py-3 text-right text-[var(--color-text)]" style={{ background: heatBg(r.ctr, ctrPeers) }}>
                  {formatPercent(r.ctr, 2)}
                </td>
                <td className="py-3 text-right text-[var(--color-text)]">{formatNumber(r.reach)}</td>
              </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                  Sem dados sincronizados para este período. Vá em Configurações e clique em "Sincronizar agora".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <p className="text-[11px] text-[var(--color-text-faint)]">
        Dados reais da Meta Ads. Vendas, CAC e ROAS não aparecem aqui porque dependem do CRM/funil
        comercial — fora do escopo desta integração.
      </p>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-base font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}
