import type { AdTimelineRow } from '../../lib/metricsTrend';
import { formatDateShort } from '../../lib/format';
import { Card } from '../ui/Card';

const statusColor: Record<string, string> = {
  ACTIVE: 'var(--color-good)',
  PAUSED: 'var(--color-warn)',
  ARCHIVED: 'var(--color-text-faint)',
};

function dayMs(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}

function eachDate(since: string, until: string): string[] {
  const out: string[] = [];
  let cur = dayMs(since);
  const end = dayMs(until);
  while (cur <= end) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86400000;
  }
  return out;
}

export function MetricsTimelineTab({ ads }: { ads: AdTimelineRow[] }) {
  const top = [...ads].sort((a, b) => b.totalLeads - a.totalLeads).slice(0, 6);

  if (top.length === 0) {
    return (
      <Card title="Timeline de anúncios">
        <p className="text-sm text-[var(--color-text-faint)]">Sem dados de anúncios no período selecionado.</p>
      </Card>
    );
  }

  const rangeStart = Math.min(...top.map((a) => dayMs(a.firstDate)));
  const rangeEnd = Math.max(...top.map((a) => dayMs(a.lastDate)));
  const totalSpan = Math.max(rangeEnd - rangeStart, 86400000);
  const hasAnyStatus = top.some((a) => a.status !== null);

  const maxDailyLeads = Math.max(1, ...top.flatMap((a) => a.dailyLeads.map((d) => d.leads)));

  return (
    <Card title="Timeline de anúncios">
      <p className="mb-4 text-[11px] text-[var(--color-text-faint)]">
        Barra = do primeiro ao último dia com métrica registrada no período filtrado (a Meta Ads API não expõe a
        data real de criação do anúncio hoje). Quadrados abaixo = leads por dia nesse anúncio.
        {!hasAnyStatus &&
          ' Status real (ativo/pausado) indisponível — sincronize os anúncios em Configurações para ver a cor por status.'}
      </p>

      <div className="flex flex-col gap-4">
        {top.map((ad) => {
          const offsetPct = ((dayMs(ad.firstDate) - rangeStart) / totalSpan) * 100;
          const widthPct = Math.max(((dayMs(ad.lastDate) - dayMs(ad.firstDate)) / totalSpan) * 100, 2);
          const color = ad.status ? (statusColor[ad.status] ?? 'var(--color-brand)') : 'var(--color-brand)';
          const leadsByDate = new Map(ad.dailyLeads.map((d) => [d.date, d.leads]));

          return (
            <div key={ad.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-xs font-medium text-[var(--color-text)]" title={ad.name}>
                  {ad.name}
                </p>
                <span className="shrink-0 text-[10px] text-[var(--color-text-faint)]">
                  {formatDateShort(ad.firstDate)} – {formatDateShort(ad.lastDate)}
                </span>
              </div>

              <div className="relative h-3 w-full rounded-full bg-[#1b1c25]">
                <div
                  className="absolute h-3 rounded-full"
                  style={{ left: `${offsetPct}%`, width: `${widthPct}%`, background: color }}
                  title={ad.status ?? 'status desconhecido'}
                />
              </div>

              <div className="flex w-full gap-[2px]">
                {eachDate(ad.firstDate, ad.lastDate).map((date) => {
                  const leads = leadsByDate.get(date) ?? 0;
                  const opacity = leads === 0 ? 0.08 : 0.25 + (leads / maxDailyLeads) * 0.75;
                  return (
                    <div
                      key={date}
                      title={`${formatDateShort(date)}: ${leads} lead${leads === 1 ? '' : 's'}`}
                      className="h-2.5 flex-1 rounded-[2px]"
                      style={{ background: `color-mix(in srgb, var(--color-info) ${opacity * 100}%, transparent)` }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
