import { useEffect, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { useFilters } from '../../state/FiltersContext';
import { listAdInsights, listMetaEntities } from '../../services/metaAds.service';
import { realAdRollups, type RealAdRow } from '../../lib/realRollups';
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

export function RealAdsTable() {
  const { project } = useProject();
  const { dateRange } = useFilters();

  const [rows, setRows] = useState<RealAdRow[] | null>(null);
  const [entities, setEntities] = useState<Map<string, MetaEntityRow>>(new Map());

  useEffect(() => {
    let active = true;
    setRows(null);
    (async () => {
      const [insights, adEntities] = await Promise.all([
        listAdInsights(project.id, { since: dateRange.start, until: dateRange.end }),
        listMetaEntities(project.id, 'ad').catch(() => []),
      ]);
      if (!active) return;
      setRows(realAdRollups(insights));
      setEntities(new Map(adEntities.map((e) => [e.external_id, e])));
    })();
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end]);

  const { sorted, sortKey, sortDir, toggle } = useSort<RealAdRow>(rows ?? [], 'leadsCount', 'desc');

  if (rows === null) return <LoadingView label="Carregando anúncios..." />;

  const cplPeers = sorted.map((r) => r.cpl);
  const ctrPeers = sorted.map((r) => r.ctr);

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-3 text-left text-xs font-medium text-[var(--color-text-faint)]">Anúncio</th>
              <SortHeader label="Invest." colKey="spend" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Leads" colKey="leadsCount" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="CPL" colKey="cpl" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="Cliques" colKey="clicks" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="CTR" colKey="ctr" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
              <SortHeader label="CPM" colKey="cpm" sortKey={sortKey as string} sortDir={sortDir} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const entity = entities.get(r.id);
              return (
                <tr key={r.id} className="border-b border-[var(--color-border-soft)]">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {entity?.thumbnail_url ? (
                        <img
                          src={entity.thumbnail_url}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="h-8 w-8 shrink-0 rounded-md bg-[var(--color-panel-2)]" />
                      )}
                      <div className="min-w-0">
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
                        <p className="truncate text-[11px] text-[var(--color-text-faint)]">
                          {r.campaignName}
                          {r.adsetName ? ` · ${r.adsetName}` : ''}
                        </p>
                      </div>
                    </div>
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
                  <td className="py-3 text-right text-[var(--color-text)]">{formatBRL(r.cpm)}</td>
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
        Dados reais da Meta Ads. Vendas, CAC e conversão em matrícula não aparecem aqui porque
        dependem do CRM/funil comercial — fora do escopo desta integração.
      </p>
    </div>
  );
}
