import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import {
  Area,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useFilters } from '../state/FiltersContext';
import { campaigns, adAccounts } from '../data/mockData';
import {
  adSetsForCampaign,
  adsForCampaign,
  campaignRollup,
  campaignFunnel,
  campaignDailySeries,
  adSetRollup,
  adRollup,
} from '../lib/rollups';
import { formatBRL, formatNumber, formatPercent, formatDateShort } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Funnel } from '../components/charts/Funnel';
import { CreativeThumb } from '../components/ui/CreativeThumb';
import { useProjectPath } from '../hooks/useProjectPath';

export function CampaignDetailPage() {
  const { campaignId } = useParams();
  const { dateRange } = useFilters();
  const navigate = useNavigate();
  const projectPath = useProjectPath();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const campaign = campaigns.find((c) => c.id === campaignId);

  const rollup = useMemo(
    () => (campaignId ? campaignRollup(campaignId, dateRange) : undefined),
    [campaignId, dateRange]
  );
  const funnel = useMemo(
    () => (campaignId ? campaignFunnel(campaignId, dateRange) : undefined),
    [campaignId, dateRange]
  );
  const series = useMemo(
    () => (campaignId ? campaignDailySeries(campaignId, dateRange) : []),
    [campaignId, dateRange]
  );
  const adSets = campaignId ? adSetsForCampaign(campaignId) : [];
  const allAds = campaignId ? adsForCampaign(campaignId) : [];

  if (!campaign || !rollup || !funnel) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-muted)]">Campanha não encontrada.</p>
      </div>
    );
  }

  const account = adAccounts.find((a) => a.id === campaign.adAccountId);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const chartData = series.map((s) => ({ ...s, dateLabel: formatDateShort(s.date) }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <button
          onClick={() => navigate(projectPath('campanhas'))}
          className="mb-3 flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ChevronLeft size={14} /> Campanhas
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--color-text)]">{campaign.name}</h1>
          <span
            className={
              'rounded-full px-2 py-0.5 text-[10px] ' +
              (campaign.status === 'active'
                ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]'
                : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]')
            }
          >
            {campaign.status === 'active' ? 'Ativa' : 'Pausada'}
          </span>
          <span className="rounded-full bg-[var(--color-panel-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
            {campaign.objective}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">{account?.name}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Investimento" value={formatBRL(rollup.spend)} />
        <Kpi label="Leads" value={formatNumber(rollup.leadsCount)} />
        <Kpi label="CPL" value={formatBRL(rollup.cpl)} />
        <Kpi label="Matriculados" value={formatNumber(rollup.formedCount)} />
        <Kpi label="Vendas" value={formatNumber(rollup.salesCount)} accent="var(--color-good)" />
        <Kpi label="Receita" value={formatBRL(rollup.revenue)} accent="var(--color-good)" />
        <Kpi label="CAC" value={formatBRL(rollup.cac)} accent="var(--color-violet)" />
        <Kpi label="ROAS" value={`${rollup.roas.toFixed(2)}x`} accent="var(--color-info)" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card title="Funil da Campanha">
          <Funnel
            stages={[
              { label: 'Impressões', value: funnel.impressions, color: 'var(--color-brand)' },
              { label: 'Cliques no Link', value: funnel.linkClicks, color: 'var(--color-info)' },
              { label: 'Visitas à Página', value: funnel.pageViews, color: 'var(--color-violet)' },
              { label: 'Leads', value: funnel.leads, color: 'var(--color-warn)' },
              { label: 'Conectados', value: funnel.connected, color: 'var(--color-good)' },
              { label: 'Matriculados / Vendas', value: funnel.sales, color: 'var(--color-good)' },
            ]}
          />
        </Card>

        <Card title="Leads x Vendas por Dia">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="cdLeads" x1="0" y1="0" x2="0" y2="1">
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
                <Area type="monotone" dataKey="leads" stroke="var(--color-info)" strokeWidth={2} fill="url(#cdLeads)" name="Leads" />
                <Line type="monotone" dataKey="sales" stroke="var(--color-good)" strokeWidth={2} dot={false} name="Vendas" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card
        title="Conjuntos de Anúncios"
        action={
          <span className="text-xs text-[var(--color-text-faint)]">
            {adSets.length} conjunto(s) · {allAds.length} anúncio(s)
          </span>
        }
      >
        <div className="flex flex-col gap-2">
          {adSets.map((set) => {
            const setRollup = adSetRollup(set.id, dateRange);
            const setAds = allAds.filter((a) => a.adSetId === set.id);
            const isOpen = expanded.has(set.id);
            return (
              <div key={set.id} className="rounded-xl border border-[var(--color-border-soft)]">
                <button
                  onClick={() => toggle(set.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-panel-2)]"
                >
                  {isOpen ? (
                    <ChevronDown size={14} className="text-[var(--color-text-faint)]" />
                  ) : (
                    <ChevronRight size={14} className="text-[var(--color-text-faint)]" />
                  )}
                  <span className="flex-1 text-sm font-medium text-[var(--color-text)]">
                    {set.name}
                  </span>
                  <MiniStat label="Invest." value={formatBRL(setRollup.spend)} />
                  <MiniStat label="Leads" value={formatNumber(setRollup.leadsCount)} />
                  <MiniStat label="CPL" value={formatBRL(setRollup.cpl)} />
                  <MiniStat label="Vendas" value={formatNumber(setRollup.salesCount)} accent="var(--color-good)" />
                  <MiniStat label="CAC" value={formatBRL(setRollup.cac)} accent="var(--color-violet)" />
                </button>

                {isOpen && (
                  <div className="border-t border-[var(--color-border-soft)] px-4 py-2">
                    {setAds.map((ad) => {
                      const adR = adRollup(ad.id, dateRange);
                      return (
                        <Link
                          key={ad.id}
                          to={projectPath(`anuncios/${ad.id}`)}
                          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--color-panel-2)]"
                        >
                          <CreativeThumb id={ad.id} creativeType={ad.creativeType} size={28} />
                          <span className="flex-1 truncate text-[var(--color-text)]">{ad.name}</span>
                          <MiniStat label="Leads" value={formatNumber(adR.leadsCount)} />
                          <MiniStat label="CPL" value={formatBRL(adR.cpl)} />
                          <MiniStat label="Vendas" value={formatNumber(adR.salesCount)} accent="var(--color-good)" />
                          <MiniStat label="Conv." value={formatPercent(adR.conversionRate)} />
                        </Link>
                      );
                    })}
                    {setAds.length === 0 && (
                      <p className="px-2 py-2 text-xs text-[var(--color-text-faint)]">
                        Sem anúncios neste conjunto.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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

function MiniStat({ label, value, accent = 'var(--color-text)' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="hidden w-20 text-right sm:block">
      <p className="text-[9px] uppercase text-[var(--color-text-faint)]">{label}</p>
      <p className="text-xs font-medium" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
