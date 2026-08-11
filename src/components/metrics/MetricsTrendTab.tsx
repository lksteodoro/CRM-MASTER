import { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { DailyPoint } from '../../lib/metricsTrend';
import { formatDateShort, formatNumber } from '../../lib/format';
import { Card } from '../ui/Card';

export function MetricsTrendTab({
  currentSeries,
  previousSeries,
}: {
  currentSeries: DailyPoint[];
  previousSeries: DailyPoint[];
}) {
  const [showPrevious, setShowPrevious] = useState(false);

  if (currentSeries.length === 0) {
    return (
      <Card title="Evolução diária">
        <p className="text-sm text-[var(--color-text-faint)]">
          Aguardando dados diários da API (nenhuma linha em <code>meta_ad_insights_daily</code> no período
          selecionado — sincronize a Meta Ads em Configurações).
        </p>
      </Card>
    );
  }

  const chartData = currentSeries.map((p, i) => ({
    date: formatDateShort(p.date),
    impressions: p.impressions,
    clicks: p.clicks,
    metaLeads: p.metaLeads,
    crmLeads: p.uniqueLeadsReceived,
    sales: p.sales,
    prevImpressions: previousSeries[i]?.impressions ?? null,
    prevClicks: previousSeries[i]?.clicks ?? null,
    prevMetaLeads: previousSeries[i]?.metaLeads ?? null,
    prevCrmLeads: previousSeries[i]?.uniqueLeadsReceived ?? null,
    prevSales: previousSeries[i]?.sales ?? null,
  }));

  return (
    <Card
      title="Evolução diária"
      action={
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <input type="checkbox" checked={showPrevious} onChange={(e) => setShowPrevious(e.target.checked)} />
          Sobrepor período anterior
        </label>
      }
    >
      <p className="mb-3 text-[11px] text-[var(--color-text-faint)]">
        "Leads (evento Meta)" é a contagem que a própria Meta reporta por dia (não identifica a pessoa). "Leads
        CRM (únicos)" conta cada contato só no dia da primeira entrada dele no período — reentradas da mesma
        pessoa em dias diferentes não duplicam. As duas linhas vêm de sistemas diferentes e não são
        reconciliáveis pessoa a pessoa (a Meta não expõe identidade em lote), então divergência entre elas é
        esperada.
      </p>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#1b1c25" vertical={false} />
            <XAxis dataKey="date" stroke="#5c5e6b" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              yAxisId="left"
              stroke="#5c5e6b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={40}
              label={{ value: 'Impressões / Cliques', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#5c5e6b' }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#5c5e6b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={40}
              label={{ value: 'Leads / Vendas', angle: 90, position: 'insideRight', fontSize: 10, fill: '#5c5e6b' }}
            />
            <Tooltip
              contentStyle={{ background: '#16171f', border: '1px solid #23252f', borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: '#e7e8ec' }}
              formatter={(value, name) => [formatNumber(Number(value ?? 0)), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="impressions" name="Impressões" stroke="var(--color-brand)" strokeWidth={2} dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="clicks" name="Cliques" stroke="var(--color-info)" strokeWidth={2} dot={false} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="metaLeads"
              name="Leads (evento Meta)"
              stroke="var(--color-violet)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="crmLeads"
              name="Leads CRM (únicos, sem duplicar)"
              stroke="var(--color-good)"
              strokeWidth={2}
              dot={false}
            />
            <Line yAxisId="right" type="monotone" dataKey="sales" name="Vendas" stroke="var(--color-warn)" strokeWidth={2} dot={false} />
            {showPrevious && (
              <>
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="prevImpressions"
                  name="Impressões (anterior)"
                  stroke="var(--color-brand)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  opacity={0.6}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="prevClicks"
                  name="Cliques (anterior)"
                  stroke="var(--color-info)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  opacity={0.6}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="prevMetaLeads"
                  name="Leads Meta (anterior)"
                  stroke="var(--color-violet)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  opacity={0.6}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="prevCrmLeads"
                  name="Leads CRM (anterior)"
                  stroke="var(--color-good)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  opacity={0.6}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="prevSales"
                  name="Vendas (anterior)"
                  stroke="var(--color-warn)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  opacity={0.6}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
