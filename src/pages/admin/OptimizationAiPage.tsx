import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardCheck,
  History,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  X,
} from 'lucide-react';
import { optimizationApi, type AdAccountOption, type OptimizationState } from '../../services/optimization.service';
import { ErrorView, LoadingView } from '../../components/ui/StateView';
import { OverviewTab, type TabId } from '../../components/optimization/OverviewTab';
import { CampaignsTab } from '../../components/optimization/CampaignsTab';
import { AutomationsTab } from '../../components/optimization/AutomationsTab';
import { ActionsTab, type Notify } from '../../components/optimization/ActionsTab';
import { HistoryTab } from '../../components/optimization/HistoryTab';
import { SettingsTab } from '../../components/optimization/SettingsTab';
import { ghostButton } from '../../components/optimization/shared';

/**
 * Otimização IA: perfis com regras determinísticas sobre a conta Meta da
 * agência. O motor recomenda; nada vai para a Meta sem o modo "Com aprovação"
 * e o aceite de uma pessoa. Toda leitura e escrita passa pela Edge Function
 * `optimization-ia`, com o mesmo token já configurado no sistema.
 */

const TABS: Array<{ id: TabId; label: string; icon: typeof Sparkles }> = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campanhas', icon: ListChecks },
  { id: 'automations', label: 'Automações', icon: SlidersHorizontal },
  { id: 'diagnostics', label: 'Diagnósticos', icon: Stethoscope },
  { id: 'approvals', label: 'Aprovações', icon: ClipboardCheck },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'settings', label: 'Configurações', icon: Settings2 },
];

type Toast = { text: string; tone: 'good' | 'warn' | 'bad' };

const TOAST_CLASS: Record<Toast['tone'], string> = {
  good: 'border-[var(--color-good)]/40 bg-[var(--color-good-soft)] text-[var(--color-good)]',
  warn: 'border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  bad: 'border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] text-[var(--color-bad)]',
};

export function OptimizationAiPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('aba');
  const tab: TabId = TABS.some((item) => item.id === requested) ? (requested as TabId) : 'overview';
  const [state, setState] = useState<OptimizationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AdAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await optimizationApi.state());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar a Otimização IA.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Contas só são lidas na Meta quando uma aba precisa delas.
  const needsAccounts = tab === 'campaigns' || tab === 'automations';
  useEffect(() => {
    if (!needsAccounts || accounts || accountsError) return;
    let alive = true;
    optimizationApi.accounts()
      .then((list) => { if (alive) setAccounts(list); })
      .catch((caught) => { if (alive) setAccountsError(caught instanceof Error ? caught.message : 'Falha ao carregar as contas.'); });
    return () => { alive = false; };
  }, [needsAccounts, accounts, accountsError]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify: Notify = useCallback((text, tone = 'good') => setToast({ text, tone }), []);
  const selectTab = (id: TabId) => {
    const next = new URLSearchParams(params);
    if (id === 'overview') next.delete('aba');
    else next.set('aba', id);
    setParams(next, { replace: true });
  };

  const badges: Partial<Record<TabId, number>> = state
    ? {
        diagnostics: state.actions.filter((action) => action.action_type === 'ALERT' && action.status === 'PROPOSED').length,
        approvals: state.actions.filter((action) => action.status === 'PENDING_APPROVAL').length,
      }
    : {};

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-brand)]">Ferramenta</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-[var(--color-text)]">
            <Sparkles size={22} /> Otimização IA
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Regras que acompanham as campanhas Meta, explicam o que mudou e propõem pausas e ajustes de orçamento. Nada é alterado sem o seu aceite.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={ghostButton}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </header>

      {toast && (
        <div role="status" aria-live="polite" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${TOAST_CLASS[toast.tone]}`}>
          {toast.tone === 'good' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso" className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <div role="tablist" aria-label="Seções da Otimização IA" className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
        {TABS.map((item) => {
          const active = item.id === tab;
          const Icon = item.icon;
          const badge = badges[item.id] ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`opt-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`opt-panel-${item.id}`}
              onClick={() => selectTab(item.id)}
              className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60 ${active ? 'border-[var(--color-brand)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            >
              <Icon size={15} /> {item.label}
              {badge > 0 && <span className="rounded-full bg-[var(--color-warn-soft)] px-1.5 text-[11px] font-semibold text-[var(--color-warn)]">{badge}</span>}
            </button>
          );
        })}
      </div>

      <section id={`opt-panel-${tab}`} role="tabpanel" aria-labelledby={`opt-tab-${tab}`}>
        {!state && loading ? (
          <LoadingView label="Carregando a Otimização IA..." />
        ) : !state ? (
          <ErrorView message={error ?? 'Falha ao carregar.'} onRetry={() => void load()} />
        ) : (
          <>
            {error && <p className="mb-4 text-xs text-[var(--color-warn)]">Não foi possível atualizar agora: {error}</p>}
            {tab === 'overview' && <OverviewTab state={state} onNavigate={selectTab} onChanged={() => void load()} notify={notify} />}
            {tab === 'campaigns' && <CampaignsTab accounts={accounts} accountsError={accountsError} />}
            {tab === 'automations' && <AutomationsTab state={state} accounts={accounts} accountsError={accountsError} onChanged={() => void load()} notify={notify} />}
            {tab === 'diagnostics' && <ActionsTab kind="diagnostics" actions={state.actions} profiles={state.profiles} onChanged={() => void load()} notify={notify} />}
            {tab === 'approvals' && <ActionsTab kind="approvals" actions={state.actions} profiles={state.profiles} onChanged={() => void load()} notify={notify} />}
            {tab === 'history' && <HistoryTab state={state} />}
            {tab === 'settings' && <SettingsTab state={state} onChanged={() => void load()} notify={notify} />}
          </>
        )}
      </section>
    </div>
  );
}
