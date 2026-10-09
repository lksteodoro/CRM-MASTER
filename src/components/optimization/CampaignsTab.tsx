import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, RefreshCw } from 'lucide-react';
import { LEAD_ACTION_TYPES } from '../../lib/metaBulkEdit';
import { optimizationApi, type AdAccountOption, type CampaignSummary } from '../../services/optimization.service';
import { formatMoney } from '../../../supabase/functions/optimization-ia/engine.ts';
import { ErrorView, LoadingView } from '../ui/StateView';
import { EmptyState, Field, StatCard, ghostButton, inputClass } from './shared';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  ARCHIVED: 'Arquivada',
  DELETED: 'Excluída',
  IN_PROCESS: 'Em processamento',
  WITH_ISSUES: 'Com problemas',
};

function leadsOf(actions?: Array<{ action_type: string; value: string }>) {
  for (const type of LEAD_ACTION_TYPES) {
    const hit = actions?.find((action) => action.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

/** Orçamento vem em centavos da moeda da conta. */
function budgetText(row: CampaignSummary, currency: string) {
  const daily = Number(row.daily_budget);
  if (daily > 0) return `${formatMoney(daily, currency)} / dia`;
  const lifetime = Number(row.lifetime_budget);
  if (lifetime > 0) return `${formatMoney(lifetime, currency)} total`;
  return 'Nos conjuntos';
}

export function CampaignsTab({ accounts, accountsError }: { accounts: AdAccountOption[] | null; accountsError: string | null }) {
  const [accountId, setAccountId] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const selectedId = accountId || accounts?.[0]?.id || '';
  const account = accounts?.find((item) => item.id === selectedId) ?? null;
  const currency = account?.currency ?? 'BRL';

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setError(null);
    setLoading(true);
    try {
      setCampaigns(await optimizationApi.campaigns(id));
      setLoadedAt(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar as campanhas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void load(selectedId);
  }, [selectedId, load]);

  const totals = useMemo(() => {
    let spend = 0;
    let leads = 0;
    let active = 0;
    for (const campaign of campaigns) {
      const row = campaign.insights?.data?.[0];
      spend += Math.round((Number(row?.spend) || 0) * 100);
      leads += leadsOf(row?.actions);
      if (campaign.effective_status === 'ACTIVE') active += 1;
    }
    return { spend, leads, active, cpl: leads > 0 ? spend / leads : null };
  }, [campaigns]);

  if (accountsError) return <ErrorView message={accountsError} />;
  if (!accounts) return <LoadingView label="Carregando contas de anúncios..." />;
  if (accounts.length === 0) {
    return <EmptyState icon={<ListChecks size={20} />} title="Nenhuma conta de anúncios" description="A conexão Meta da agência não tem acesso a contas de anúncios." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-md">
          <Field label="Conta de anúncios" htmlFor="opt-campaign-account">
            <select id="opt-campaign-account" value={selectedId} onChange={(event) => setAccountId(event.target.value)} className={inputClass}>
              {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}
            </select>
          </Field>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          {loadedAt && <span>Lido às {loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" onClick={() => void load(selectedId)} disabled={loading} className={ghostButton}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {error ? (
        <ErrorView message={error} onRetry={() => void load(selectedId)} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Gasto · últimos 7 dias" value={formatMoney(totals.spend, currency)} />
            <StatCard label="Leads · últimos 7 dias" value={totals.leads.toLocaleString('pt-BR')} />
            <StatCard label="Custo por lead" value={formatMoney(totals.cpl, currency)} />
            <StatCard label="Campanhas ativas" value={`${totals.active} de ${campaigns.length}`} />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
            {loading && campaigns.length === 0 ? (
              <LoadingView label="Carregando campanhas..." />
            ) : campaigns.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">Nenhuma campanha nesta conta.</p>
            ) : (
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Campanha</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Orçamento</th>
                    <th className="px-4 py-3 text-right font-medium">Gasto 7d</th>
                    <th className="px-4 py-3 text-right font-medium">Leads</th>
                    <th className="px-4 py-3 text-right font-medium">Custo por lead</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => {
                    const row = campaign.insights?.data?.[0];
                    const spend = Math.round((Number(row?.spend) || 0) * 100);
                    const leads = leadsOf(row?.actions);
                    return (
                      <tr key={campaign.id} className="border-b border-[var(--color-border-soft)] last:border-0">
                        <td className="px-4 py-3 text-[var(--color-text)]">{campaign.name}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{STATUS_LABEL[campaign.effective_status] ?? campaign.effective_status}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{budgetText(campaign, currency)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{formatMoney(spend, currency)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{leads}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{leads > 0 ? formatMoney(spend / leads, currency) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-faint)]">
            Leads contam os tipos de ação de lead da Meta, com a atribuição padrão da conta. Os números de dias recentes ainda podem mudar.
          </p>
        </>
      )}
    </div>
  );
}
