import { useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useFilters } from '../state/FiltersContext';
import { ads, campaigns, adSets } from '../data/mockData';
import { leads, sales } from '../data/leadSalesData';
import { adRollup, adDailySeries } from '../lib/rollups';
import { formatBRL, formatNumber, formatPercent, formatDateShort } from '../lib/format';
import { Card } from '../components/ui/Card';
import { CreativeThumb } from '../components/ui/CreativeThumb';
import { useProjectPath } from '../hooks/useProjectPath';

const statusColor: Record<string, string> = {
  Novo: 'var(--color-info)',
  Contatado: 'var(--color-warn)',
  Qualificado: 'var(--color-violet)',
  'Negociação': 'var(--color-brand)',
  Matriculado: 'var(--color-good)',
  Perdido: 'var(--color-bad)',
};

export function AdDetailPage() {
  const { adId } = useParams();
  const { dateRange } = useFilters();
  const navigate = useNavigate();
  const projectPath = useProjectPath();

  const ad = ads.find((a) => a.id === adId);
  const campaign = ad ? campaigns.find((c) => c.id === ad.campaignId) : undefined;
  const adSet = ad ? adSets.find((s) => s.id === ad.adSetId) : undefined;

  const rollup = useMemo(() => (adId ? adRollup(adId, dateRange) : undefined), [adId, dateRange]);
  const series = useMemo(() => (adId ? adDailySeries(adId, dateRange) : []), [adId, dateRange]);

  const adLeads = useMemo(() => {
    if (!adId) return [];
    return leads
      .filter((l) => l.adId === adId && l.createdAt.slice(0, 10) >= dateRange.start && l.createdAt.slice(0, 10) <= dateRange.end)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 25);
  }, [adId, dateRange]);

  const saleByLeadId = useMemo(() => {
    const map = new Map<string, (typeof sales)[number]>();
    for (const s of sales) map.set(s.leadId, s);
    return map;
  }, []);

  if (!ad || !campaign || !rollup) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-muted)]">Anúncio não encontrado.</p>
      </div>
    );
  }

  const chartData = series.map((s) => ({ ...s, dateLabel: formatDateShort(s.date) }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <button
          onClick={() => navigate(projectPath('anuncios'))}
          className="mb-3 flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ChevronLeft size={14} /> Anúncios
        </button>
        <div className="flex items-center gap-2">
          <CreativeThumb id={ad.id} creativeType={ad.creativeType} size={44} />
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{ad.name}</h1>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">
          <Link to={projectPath(`campanhas/${campaign.id}`)} className="hover:text-[var(--color-brand)]">
            {campaign.name}
          </Link>{' '}
          · {adSet?.name} · {ad.creativeType}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Investimento (est.)" value={formatBRL(rollup.spend)} />
        <Kpi label="Leads" value={formatNumber(rollup.leadsCount)} />
        <Kpi label="CPL" value={formatBRL(rollup.cpl)} />
        <Kpi label="Vendas" value={formatNumber(rollup.salesCount)} accent="var(--color-good)" />
        <Kpi label="CAC" value={formatBRL(rollup.cac)} accent="var(--color-violet)" />
        <Kpi label="Conversão" value={formatPercent(rollup.conversionRate)} accent="var(--color-info)" />
      </div>

      <Card title="Leads x Vendas por Dia">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="adLeads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1b1c25" vertical={false} />
              <XAxis dataKey="dateLabel" stroke="#5c5e6b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#5c5e6b" fontSize={11} tickLine={false} axisLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: '#16171f', border: '1px solid #23252f', borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: '#e7e8ec' }}
              />
              <Area type="monotone" dataKey="leads" stroke="var(--color-info)" strokeWidth={2} fill="url(#adLeads)" name="Leads" />
              <Line type="monotone" dataKey="sales" stroke="var(--color-good)" strokeWidth={2} dot={false} name="Vendas" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card
        title="Leads Gerados por Este Anúncio"
        action={
          <span className="text-xs text-[var(--color-text-faint)]">
            {adLeads.length} mais recentes no período
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                <th className="pb-2">Lead</th>
                <th className="pb-2">Contato</th>
                <th className="pb-2">Entrada</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Venda</th>
              </tr>
            </thead>
            <tbody>
              {adLeads.map((lead) => {
                const sale = saleByLeadId.get(lead.id);
                return (
                  <tr key={lead.id} className="border-b border-[var(--color-border-soft)]">
                    <td className="py-2 text-[var(--color-text)]">{lead.name}</td>
                    <td className="py-2 text-[var(--color-text-muted)]">{lead.email}</td>
                    <td className="py-2 text-[var(--color-text-muted)]">
                      {lead.createdAt.slice(0, 10)}
                    </td>
                    <td className="py-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px]"
                        style={{
                          background: `color-mix(in srgb, ${statusColor[lead.status]} 16%, transparent)`,
                          color: statusColor[lead.status],
                        }}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="py-2 text-right text-[var(--color-good)]">
                      {sale ? formatBRL(sale.value) : '—'}
                    </td>
                  </tr>
                );
              })}
              {adLeads.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                    Nenhum lead neste período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, accent = 'var(--color-text)' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
