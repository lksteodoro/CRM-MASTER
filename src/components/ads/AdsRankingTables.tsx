import { Webhook } from 'lucide-react';
import { useFilters } from '../../state/FiltersContext';
import { campaignIdsForProject, filterDaily } from '../../lib/metrics';
import { campaigns } from '../../data/mockData';
import { buildAdPerformance, type RankedAd } from '../../lib/adRanking';
import { formatBRL, formatNumber } from '../../lib/format';
import { Card } from '../ui/Card';
import { CreativeThumb } from '../ui/CreativeThumb';

function RankedList({ items, metric }: { items: RankedAd[]; metric: 'leads' | 'sales' }) {
  const max = Math.max(1, ...items.map((i) => i[metric]));
  return (
    <div className="flex flex-col gap-3">
      {items.map((ad, idx) => {
        const value = ad[metric];
        return (
          <div key={ad.id} className="flex items-center gap-3">
            <span className="w-4 text-xs font-medium text-[var(--color-text-faint)]">
              {idx + 1}
            </span>
            <CreativeThumb id={ad.id} creativeType={ad.creativeType as 'Imagem' | 'Vídeo' | 'Carrossel'} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[var(--color-text)]" title={ad.name}>
                {ad.name}
              </p>
              <p className="truncate text-[10px] text-[var(--color-text-faint)]">
                {ad.campaignName}
              </p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#1b1c25]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(value / max) * 100}%`,
                    background: metric === 'leads' ? 'var(--color-info)' : 'var(--color-good)',
                  }}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {formatNumber(value)}
              </p>
              <p className="text-[10px] text-[var(--color-text-faint)]">
                {metric === 'leads' ? formatBRL(ad.cpl) + ' CPL' : formatBRL(ad.spend) + ' inv.'}
              </p>
            </div>
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="text-xs text-[var(--color-text-faint)]">Sem dados no período.</p>
      )}
    </div>
  );
}

export function AdsRankingTables() {
  const { selectedProject, dateRange } = useFilters();
  const campaignIds = campaignIdsForProject(selectedProject);
  const rows = filterDaily(dateRange, campaignIds);

  const campaignTotals = new Map<string, { spend: number; leads: number; sales: number }>();
  for (const c of campaigns) {
    if (!campaignIds.has(c.id)) continue;
    const campRows = rows.filter((r) => r.campaignId === c.id);
    campaignTotals.set(c.id, {
      spend: campRows.reduce((a, r) => a + r.spend, 0),
      leads: campRows.reduce((a, r) => a + r.leads, 0),
      sales: campRows.reduce((a, r) => a + r.sales, 0),
    });
  }

  const perf = buildAdPerformance(campaignIds, campaignTotals);
  const topLeads = [...perf].sort((a, b) => b.leads - a.leads).slice(0, 6);
  const topSales = [...perf].sort((a, b) => b.sales - a.sales).slice(0, 6);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Anúncios que Mais Geram Leads">
        <RankedList items={topLeads} metric="leads" />
      </Card>
      <Card
        title="Anúncios que Mais Convertem em Vendas"
        action={
          <span className="flex items-center gap-1 rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-[10px] text-[var(--color-info)]">
            <Webhook size={11} /> via webhook
          </span>
        }
      >
        <RankedList items={topSales} metric="sales" />
      </Card>
    </div>
  );
}
