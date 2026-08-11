import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, Percent, Wallet, Receipt, Award } from 'lucide-react';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import { listLeadEvents, listSales, computeCrmLeadStats } from '../services/crmLeads.service';
import { listAdInsights } from '../services/metaAds.service';
import { realProjectRollup } from '../lib/realRollups';
import { formatBRL, formatNumber, formatPercent } from '../lib/format';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';

/**
 * Performance Comercial real: conecta o gasto de mídia (Meta Ads, quando
 * conectado) com as vendas recebidas via webhook. Substitui o antigo painel
 * de ranking de vendedores, que era inteiramente mock e não tinha
 * correspondência no modelo de dados real (não existe "vendedor" em
 * `sales`) — reintroduzir ranking de vendedores exige um campo próprio,
 * fora do escopo desta passada.
 */
export function ComercialPage() {
  const { project } = useProject();
  const { dateRange } = useFilters();

  const [loading, setLoading] = useState(true);
  const [uniqueLeads, setUniqueLeads] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [spend, setSpend] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const range = { since: dateRange.start, until: dateRange.end };
      const [leadEvents, sales, adInsights] = await Promise.all([
        listLeadEvents(project.id, range),
        listSales(project.id, range),
        listAdInsights(project.id, range).catch(() => []),
      ]);
      if (!active) return;
      const stats = computeCrmLeadStats(leadEvents, sales);
      setUniqueLeads(stats.uniqueContacts);
      setSalesCount(stats.sales);
      setRevenue(stats.revenue);
      setSpend(adInsights.length > 0 ? realProjectRollup(adInsights).spend : null);
    })().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end]);

  if (loading) return <LoadingView label="Carregando dados comerciais..." />;

  const conversionRate = uniqueLeads > 0 ? (salesCount / uniqueLeads) * 100 : 0;
  const ticketMedio = salesCount > 0 ? revenue / salesCount : 0;
  const revenuePerLead = uniqueLeads > 0 ? revenue / uniqueLeads : 0;
  const cpa = spend != null && salesCount > 0 ? spend / salesCount : null;
  const roas = spend != null && spend > 0 ? revenue / spend : null;

  const hasAnyData = uniqueLeads > 0 || salesCount > 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Comercial — {project.name}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Vendas reais (webhook) cruzadas com investimento em mídia real (Meta Ads)
        </p>
      </div>

      {!hasAnyData ? (
        <Card className="flex flex-col items-center gap-2 py-14 text-center">
          <Award size={22} className="text-[var(--color-text-faint)]" />
          <p className="text-sm font-medium text-[var(--color-text)]">Sem leads ou vendas neste período</p>
          <p className="max-w-sm text-xs text-[var(--color-text-muted)]">
            Configure o webhook em Configurações para começar a receber leads e vendas reais deste
            projeto.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi icon={Wallet} label="Leads únicos" value={formatNumber(uniqueLeads)} />
            <Kpi icon={Award} label="Vendas" value={formatNumber(salesCount)} accent="var(--color-good)" />
            <Kpi icon={Percent} label="Taxa Lead → Venda" value={formatPercent(conversionRate)} accent="var(--color-info)" />
            <Kpi icon={DollarSign} label="CPA (Custo por Venda)" value={cpa != null ? formatBRL(cpa) : '—'} />
            <Kpi icon={Receipt} label="Receita" value={formatBRL(revenue)} accent="var(--color-good)" />
            <Kpi icon={TrendingUp} label="Ticket Médio" value={formatBRL(ticketMedio)} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card title="ROAS">
              {roas != null ? (
                <>
                  <p className="text-2xl font-semibold text-[var(--color-text)]">{roas.toFixed(2)}x</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Cada R$ 1 investido gerou {formatBRL(roas)} em receita.
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--color-text-faint)]">
                  Conecte a Meta Ads em Configurações para calcular o ROAS (precisa do investimento).
                </p>
              )}
            </Card>
            <Card title="Receita por Lead">
              <p className="text-2xl font-semibold text-[var(--color-text)]">{formatBRL(revenuePerLead)}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Receita total dividida pelos leads únicos do período — mede a qualidade da aquisição,
                não só o volume.
              </p>
            </Card>
          </div>

          <p className="text-[11px] text-[var(--color-text-faint)]">
            Ranking de vendedores e funil de estágios (contatado, negociando, matriculado) ainda não
            migraram para dados reais — dependiam de um campo de vendedor que não existe no modelo
            atual de <code>sales</code>. Podem ser adicionados se for necessário.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  accent = 'var(--color-brand)',
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <Icon size={14} style={{ color: accent }} />
      <p className="mt-2 text-base font-semibold text-[var(--color-text)]">{value}</p>
      <p className="text-[10px] text-[var(--color-text-faint)]">{label}</p>
    </div>
  );
}
