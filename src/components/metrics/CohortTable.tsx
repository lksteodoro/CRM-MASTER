import { useMemo } from 'react';
import { useFilters } from '../../state/FiltersContext';
import { campaignIdsForProject } from '../../lib/metrics';
import { computeCohort } from '../../lib/cohort';
import { formatDateShort, formatNumber } from '../../lib/format';
import { Card } from '../ui/Card';

function cellBg(pct: number) {
  const t = Math.min(1, pct / 40); // 40%+ conversion reads as fully "hot"
  return `rgba(52, 211, 153, ${(0.06 + t * 0.4).toFixed(2)})`;
}

export function CohortTable() {
  const { selectedProject } = useFilters();
  const campaignIds = campaignIdsForProject(selectedProject);
  const rows = useMemo(() => computeCohort(campaignIds), [selectedProject]);

  return (
    <Card
      title="Cohort de Conversão Lead → Venda"
      action={<span className="text-xs text-[var(--color-text-faint)]">por semana de entrada</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
              <th className="pb-2">Semana</th>
              <th className="pb-2 text-right">Leads</th>
              <th className="pb-2 text-right">1 sem.</th>
              <th className="pb-2 text-right">2 sem.</th>
              <th className="pb-2 text-right">3 sem.</th>
              <th className="pb-2 text-right">4 sem.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.weekStart} className="border-b border-[var(--color-border-soft)]">
                <td className="py-2 text-[var(--color-text)]">{formatDateShort(row.weekStart)}</td>
                <td className="py-2 text-right text-[var(--color-text-muted)]">
                  {formatNumber(row.totalLeads)}
                </td>
                {row.cells.map((cell, i) => (
                  <td
                    key={i}
                    className="py-2 text-right text-[var(--color-text)]"
                    style={{ background: cell !== null ? cellBg(cell) : 'transparent' }}
                  >
                    {cell !== null ? `${cell.toFixed(0)}%` : <span className="text-[var(--color-text-faint)]">—</span>}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                  Sem dados suficientes para montar o cohort.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--color-text-faint)]">
        % de leads daquela semana que já viraram venda até N semanas depois. Células em branco ainda não
        completaram a janela.
      </p>
    </Card>
  );
}
