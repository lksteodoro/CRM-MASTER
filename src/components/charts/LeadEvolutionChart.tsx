import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Plus, X, Flag } from 'lucide-react';
import { useFilters } from '../../state/FiltersContext';
import { campaignIdsForProject, dailySeries } from '../../lib/metrics';
import { formatDateShort, formatBRL, formatNumber } from '../../lib/format';
import { Card } from '../ui/Card';

export function LeadEvolutionChart() {
  const { selectedProject, dateRange, annotations, addAnnotation, removeAnnotation } = useFilters();
  const campaignIds = campaignIdsForProject(selectedProject);
  const series = dailySeries(dateRange, campaignIds);
  const leadGoal = selectedProject?.leadGoal;
  const avgDailyGoal = leadGoal ? leadGoal / Math.max(series.length, 1) : undefined;

  const [showForm, setShowForm] = useState(false);
  const [newDate, setNewDate] = useState(dateRange.end);
  const [newText, setNewText] = useState('');

  const data = series.map((s) => ({
    date: formatDateShort(s.date),
    isoDate: s.date,
    leads: s.leads,
    formedLeads: s.formedLeads,
    spend: s.spend,
  }));

  const projectAnnotations = selectedProject
    ? annotations
        .filter((a) => a.projectId === selectedProject.id)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  const visibleAnnotations = projectAnnotations.filter((a) =>
    data.some((d) => d.isoDate === a.date)
  );

  function submit() {
    if (!selectedProject || !newText.trim()) return;
    addAnnotation(selectedProject.id, newDate, newText.trim());
    setNewText('');
    setShowForm(false);
  }

  return (
    <Card
      title="Evolução de Leads por Dia"
      action={
        <div className="flex items-center gap-3">
          {avgDailyGoal && (
            <span className="text-xs text-[var(--color-text-muted)]">
              Meta diária ref.: <b className="text-[var(--color-text)]">{avgDailyGoal.toFixed(1)}</b>
            </span>
          )}
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
          >
            <Plus size={12} /> Anotação
          </button>
        </div>
      }
    >
      {showForm && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Data
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-sm text-[var(--color-text)]"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            O que aconteceu?
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="ex: aumentei o orçamento em 20%"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-sm text-[var(--color-text)]"
            />
          </label>
          <button
            onClick={submit}
            className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Salvar
          </button>
        </div>
      )}

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="formedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-good)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--color-good)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1b1c25" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#5c5e6b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis stroke="#5c5e6b" fontSize={11} tickLine={false} axisLine={false} width={30} />
            <Tooltip
              contentStyle={{
                background: '#16171f',
                border: '1px solid #23252f',
                borderRadius: 10,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e7e8ec' }}
              formatter={(value, name) => {
                const num = Number(value);
                if (name === 'spend') return [formatBRL(num), 'Investimento'];
                if (name === 'formedLeads') return [formatNumber(num), 'Matriculados'];
                return [formatNumber(num), 'Leads'];
              }}
            />
            {avgDailyGoal && (
              <ReferenceLine
                y={avgDailyGoal}
                stroke="var(--color-warn)"
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
            )}
            {visibleAnnotations.map((a) => (
              <ReferenceLine
                key={a.id}
                x={formatDateShort(a.date)}
                stroke="var(--color-violet)"
                strokeDasharray="2 2"
                label={{ value: '🚩', position: 'top', fontSize: 12 }}
              />
            ))}
            <Area
              type="monotone"
              dataKey="leads"
              stroke="var(--color-info)"
              strokeWidth={2}
              fill="url(#leadsGrad)"
            />
            <Area
              type="monotone"
              dataKey="formedLeads"
              stroke="var(--color-good)"
              strokeWidth={2}
              fill="url(#formedGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--color-info)]" /> Leads
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--color-good)]" /> Matriculados
        </span>
        {avgDailyGoal && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--color-warn)]" /> Meta diária
          </span>
        )}
        {visibleAnnotations.length > 0 && (
          <span className="flex items-center gap-1.5">🚩 Anotação</span>
        )}
      </div>

      {projectAnnotations.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-border-soft)] pt-3">
          {projectAnnotations.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs">
              <Flag size={11} className="shrink-0 text-[var(--color-violet)]" />
              <span className="text-[var(--color-text-faint)]">{a.date}</span>
              <span className="text-[var(--color-text)]">{a.text}</span>
              <button
                onClick={() => removeAnnotation(a.id)}
                className="ml-auto text-[var(--color-text-faint)] hover:text-[var(--color-bad)]"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
