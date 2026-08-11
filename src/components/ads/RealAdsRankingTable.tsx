import { useEffect, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { useFilters } from '../../state/FiltersContext';
import { listAdInsights } from '../../services/metaAds.service';
import { realAdRollups, type RealAdRow } from '../../lib/realRollups';
import { formatBRL, formatNumber } from '../../lib/format';
import { Card } from '../ui/Card';

function RankedList({ items }: { items: RealAdRow[] }) {
  const max = Math.max(1, ...items.map((i) => i.leadsCount));
  return (
    <div className="flex flex-col gap-3">
      {items.map((ad, idx) => (
        <div key={ad.id} className="flex items-center gap-3">
          <span className="w-4 text-xs font-medium text-[var(--color-text-faint)]">{idx + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-[var(--color-text)]" title={ad.name}>
              {ad.name}
            </p>
            <p className="truncate text-[10px] text-[var(--color-text-faint)]">{ad.campaignName}</p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#1b1c25]">
              <div
                className="h-full rounded-full"
                style={{ width: `${(ad.leadsCount / max) * 100}%`, background: 'var(--color-info)' }}
              />
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-[var(--color-text)]">{formatNumber(ad.leadsCount)}</p>
            <p className="text-[10px] text-[var(--color-text-faint)]">{formatBRL(ad.cpl)} CPL</p>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-xs text-[var(--color-text-faint)]">Sem dados no período.</p>}
    </div>
  );
}

/**
 * Ranking real de anúncios (por leads) — substitui o antigo AdsRankingTables
 * mock, que misturava anúncios de outros projetos de demonstração. O ranking
 * por vendas não existe ainda porque a Meta Ads API não tem esse dado — só
 * chega quando houver integração com o CRM/funil comercial.
 */
export function RealAdsRankingTable() {
  const { project } = useProject();
  const { dateRange } = useFilters();
  const [rows, setRows] = useState<RealAdRow[] | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    (async () => {
      const insights = await listAdInsights(project.id, { since: dateRange.start, until: dateRange.end });
      if (!active) return;
      setRows(realAdRollups(insights));
    })();
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end]);

  const topLeads = [...(rows ?? [])].sort((a, b) => b.leadsCount - a.leadsCount).slice(0, 6);

  return (
    <Card title="Anúncios que Mais Geram Leads">
      <RankedList items={topLeads} />
      <p className="mt-3 text-[10px] text-[var(--color-text-faint)]">
        Ranking por vendas aparece aqui quando o projeto tiver integração com CRM/funil comercial.
      </p>
    </Card>
  );
}
