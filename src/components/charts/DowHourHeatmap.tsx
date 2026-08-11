import { useMemo, useState } from 'react';
import { useFilters } from '../../state/FiltersContext';
import { campaignIdsForProject } from '../../lib/metrics';
import { computeDowHourPattern } from '../../lib/dowHeatmap';
import { Card } from '../ui/Card';

const dowLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function DowHourHeatmap() {
  const { selectedProject } = useFilters();
  const campaignIds = campaignIdsForProject(selectedProject);
  const grid = useMemo(() => computeDowHourPattern(campaignIds), [selectedProject]);
  const [hovered, setHovered] = useState<{ dow: number; hour: number; value: number } | null>(null);

  const max = Math.max(1, ...grid.flat().map((c) => c.avgLeads));

  return (
    <Card
      title="Padrão Semanal de Leads"
      action={<span className="text-xs text-[var(--color-text-faint)]">últimos 60 dias · dia × hora</span>}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="mb-1 grid grid-cols-[40px_repeat(24,1fr)] gap-[2px] text-[9px] text-[var(--color-text-faint)]">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 4 === 0 ? h : ''}
              </span>
            ))}
          </div>
          {grid.map((row, dow) => (
            <div key={dow} className="mb-[3px] grid grid-cols-[40px_repeat(24,1fr)] items-center gap-[2px]">
              <span className="text-[10px] text-[var(--color-text-muted)]">{dowLabels[dow]}</span>
              {row.map((cell) => {
                const ratio = cell.avgLeads / max;
                return (
                  <div
                    key={cell.hour}
                    onMouseEnter={() => setHovered({ dow, hour: cell.hour, value: cell.avgLeads })}
                    onMouseLeave={() => setHovered(null)}
                    className="h-4 rounded-[3px]"
                    style={{ background: `rgba(91,124,250,${(0.08 + ratio * 0.85).toFixed(2)})` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-[var(--color-text-muted)]">
        {hovered
          ? `${dowLabels[hovered.dow]} às ${String(hovered.hour).padStart(2, '0')}h — ${hovered.value.toFixed(1)} leads em média`
          : 'Passe o mouse sobre uma célula para ver a média de leads naquele horário'}
      </p>
    </Card>
  );
}
