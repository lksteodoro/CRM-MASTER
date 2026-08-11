import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useFilters } from '../../state/FiltersContext';
import { campaignIdsForProject, hourlySeries, hourlyByCampaign } from '../../lib/metrics';
import { formatNumber } from '../../lib/format';
import { Card } from '../ui/Card';

const hourLabel = (h: number) => `${h.toString().padStart(2, '0')}h`;

function intensityColor(value: number, max: number) {
  if (max === 0) return 'rgba(91,124,250,0.06)';
  const ratio = value / max;
  const alpha = 0.08 + ratio * 0.85;
  return `rgba(91,124,250,${alpha.toFixed(2)})`;
}

export function IntradayWaveGantt() {
  const { selectedProject } = useFilters();
  const campaignIds = campaignIdsForProject(selectedProject);

  const wave = hourlySeries(campaignIds).map((h) => ({
    hour: hourLabel(h.hour),
    leads: h.leads,
  }));

  const perCampaign = hourlyByCampaign(campaignIds);
  const maxLeads = Math.max(1, ...perCampaign.flatMap((c) => c.hours.map((h) => h.leads)));

  return (
    <Card
      title="Atividade de Leads ao Longo do Dia"
      action={
        <span className="text-xs text-[var(--color-text-muted)]">Hoje · por campanha e hora</span>
      }
    >
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={wave} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="waveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.55} />
                <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1b1c25" vertical={false} />
            <XAxis
              dataKey="hour"
              stroke="#5c5e6b"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval={1}
            />
            <Tooltip
              contentStyle={{
                background: '#16171f',
                border: '1px solid #23252f',
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e7e8ec' }}
              formatter={(value) => [formatNumber(Number(value)), 'Leads']}
            />
            <Area
              type="monotone"
              dataKey="leads"
              stroke="var(--color-brand)"
              strokeWidth={2}
              fill="url(#waveGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5 overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="mb-1 grid grid-cols-[140px_repeat(24,1fr)] gap-[2px] text-[9px] text-[var(--color-text-faint)]">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? h : ''}
              </span>
            ))}
          </div>
          {perCampaign.map(({ campaign, hours }) => (
            <div
              key={campaign.id}
              className="mb-[3px] grid grid-cols-[140px_repeat(24,1fr)] items-center gap-[2px]"
            >
              <span className="truncate pr-2 text-[11px] text-[var(--color-text-muted)]" title={campaign.name}>
                {campaign.name}
              </span>
              {hours.map((h) => (
                <div
                  key={h.hour}
                  title={`${hourLabel(h.hour)} · ${h.leads} leads`}
                  className="h-4 rounded-[3px]"
                  style={{ background: intensityColor(h.leads, maxLeads) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
