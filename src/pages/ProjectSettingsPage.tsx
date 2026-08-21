import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ListChecks,
  Webhook,
  Copy,
  Check,
} from 'lucide-react';
import { useProject } from '../state/ProjectContext';
import { useAuth } from '../providers/AuthProvider';
import {
  getIntegration,
  syncInsights,
  syncEntities,
  listMetaCampaigns,
  saveCampaignSelection,
  type MetaCampaignSummary,
} from '../services/metaAds.service';
import {
  getProjectIntegration,
  regenerateIntegration,
  getWebhookHealth,
  type WebhookHealth,
} from '../services/crmLeads.service';
import { listGoals, upsertGoal, currentMonthPeriod, emptyGoals, type GoalValues } from '../services/goals.service';
import { updateProject } from '../services/projects.service';
import { fmt } from '../lib/metrics';
import type {
  MetaIntegrationRow,
  ProjectIntegrationRow,
  ProjectGoalRow,
  ProjectStatus,
} from '../integrations/supabase/database.types';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';

const FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/functions/v1`;

const statusLabel: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  CONNECTED: {
    label: 'Conectado',
    className: 'bg-[var(--color-good-soft)] text-[var(--color-good)]',
    icon: CheckCircle2,
  },
  ERROR: {
    label: 'Erro',
    className: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]',
    icon: XCircle,
  },
  DISCONNECTED: {
    label: 'Não conectado',
    className: 'bg-[var(--color-panel-2)] text-[var(--color-text-faint)]',
    icon: AlertTriangle,
  },
};

export function ProjectSettingsPage() {
  const { project, permissions, reloadGoals } = useProject();
  const { isAdmin } = useAuth();

  const [name, setName] = useState(project.name);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>(project.status);
  const [timezone, setTimezone] = useState(project.timezone);
  const [currency, setCurrency] = useState(project.currency);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalFeedback, setGeneralFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [goalHistory, setGoalHistory] = useState<ProjectGoalRow[] | null>(null);
  const [goalValues, setGoalValues] = useState<GoalValues>(emptyGoals);
  const [savingGoals, setSavingGoals] = useState(false);
  const [goalsFeedback, setGoalsFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [integration, setIntegration] = useState<MetaIntegrationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [syncStartDate, setSyncStartDate] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return fmt(date);
  });

  const [campaigns, setCampaigns] = useState<MetaCampaignSummary[] | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savingSelection, setSavingSelection] = useState(false);
  const [campaignFeedback, setCampaignFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(
    null
  );

  const [integrationRow, setIntegrationRow] = useState<ProjectIntegrationRow | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<'leads' | 'sales' | 'secret' | null>(null);
  const [health, setHealth] = useState<WebhookHealth | null>(null);

  const canEdit = permissions.can_edit_settings;

  async function reload() {
    setLoading(true);
    try {
      const row = await getIntegration(project.id);
      setIntegration(row);
      setSelectedIds(new Set(row?.selected_campaign_ids ?? []));
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadCampaigns() {
    setLoadingCampaigns(true);
    setCampaignFeedback(null);
    try {
      const result = await listMetaCampaigns(project.id);
      if (result.ok) {
        setCampaigns(result.campaigns ?? []);
      } else {
        setCampaignFeedback({ type: 'error', text: result.error ?? 'Falha ao listar campanhas.' });
      }
    } catch (e) {
      setCampaignFeedback({
        type: 'error',
        text: e instanceof Error ? e.message : 'Erro ao listar campanhas.',
      });
    } finally {
      setLoadingCampaigns(false);
    }
  }

  function toggleCampaign(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSaveSelection() {
    setSavingSelection(true);
    setCampaignFeedback(null);
    try {
      await saveCampaignSelection(project.id, Array.from(selectedIds));
      setCampaignFeedback({
        type: 'ok',
        text: 'Seleção salva. Clique em "Sincronizar agora" para aplicar aos dados já puxados.',
      });
    } catch (e) {
      setCampaignFeedback({ type: 'error', text: e instanceof Error ? e.message : 'Erro ao salvar.' });
    } finally {
      setSavingSelection(false);
    }
  }

  useEffect(() => {
    void reload();
    (async () => {
      setWebhookLoading(true);
      try {
        const row = await getProjectIntegration(project.id);
        setIntegrationRow(row);
        if (row) setHealth(await getWebhookHealth(project.id));
      } finally {
        setWebhookLoading(false);
      }
    })();
    (async () => {
      const history = await listGoals(project.id);
      setGoalHistory(history);
      const { period_start, period_end } = currentMonthPeriod();
      const current = history.find((g) => g.period_start === period_start && g.period_end === period_end);
      setGoalValues(
        current
          ? {
              spend_goal: current.spend_goal,
              lead_goal: current.lead_goal,
              cpl_goal: current.cpl_goal,
              sales_goal: current.sales_goal,
              cac_goal: current.cac_goal,
              revenue_goal: current.revenue_goal,
              roas_goal: current.roas_goal,
            }
          : emptyGoals
      );
    })();
    setName(project.name);
    setProjectStatus(project.status);
    setTimezone(project.timezone);
    setCurrency(project.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function handleSaveGeneral() {
    setSavingGeneral(true);
    setGeneralFeedback(null);
    try {
      await updateProject(project.id, { name, status: projectStatus, timezone, currency });
      setGeneralFeedback({ type: 'ok', text: 'Projeto atualizado.' });
    } catch (e) {
      setGeneralFeedback({ type: 'error', text: e instanceof Error ? e.message : 'Erro ao salvar.' });
    } finally {
      setSavingGeneral(false);
    }
  }

  async function handleSaveGoals() {
    setSavingGoals(true);
    setGoalsFeedback(null);
    try {
      const { period_start, period_end } = currentMonthPeriod();
      await upsertGoal({ projectId: project.id, period_start, period_end, values: goalValues });
      setGoalHistory(await listGoals(project.id));
      await reloadGoals();
      setGoalsFeedback({ type: 'ok', text: 'Metas do mês salvas.' });
    } catch (e) {
      setGoalsFeedback({ type: 'error', text: e instanceof Error ? e.message : 'Erro ao salvar.' });
    } finally {
      setSavingGoals(false);
    }
  }

  async function handleRegenerateWebhook() {
    setRegenerating(true);
    try {
      setIntegrationRow(await regenerateIntegration(project.id, project.name));
    } finally {
      setRegenerating(false);
    }
  }

  function copyWebhookUrl(kind: 'leads' | 'sales') {
    if (!integrationRow) return;
    void navigator.clipboard.writeText(`${FUNCTIONS_URL}/webhook-${kind}`);
    setCopiedKey(kind);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  function copySecret() {
    if (!integrationRow) return;
    void navigator.clipboard.writeText(integrationRow.secret);
    setCopiedKey('secret');
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleSync() {
    setSyncing(true);
    setFeedback(null);
    try {
      const until = fmt(new Date());
      if (!syncStartDate || syncStartDate > until) throw new Error('Escolha uma data inicial anterior ou igual a hoje.');
      const finalDate = new Date(`${until}T12:00:00`);
      let cursor = new Date(`${syncStartDate}T12:00:00`);
      let totalDays = 0;
      while (cursor <= finalDate) {
        const chunkStart = fmt(cursor);
        const chunkEndDate = new Date(cursor);
        chunkEndDate.setDate(chunkEndDate.getDate() + 29);
        if (chunkEndDate > finalDate) chunkEndDate.setTime(finalDate.getTime());
        const chunkEnd = fmt(chunkEndDate);
        setFeedback({ type: 'ok', text: `Sincronizando métricas de ${chunkStart} até ${chunkEnd}...` });
        const result = await syncInsights(project.id, { since: chunkStart, until: chunkEnd });
        if (!result.ok) throw new Error(result.error ?? `Falha ao sincronizar ${chunkStart} até ${chunkEnd}.`);
        totalDays += result.daysSynced ?? 0;
        cursor = new Date(chunkEndDate);
        cursor.setDate(cursor.getDate() + 1);
      }

      // Segunda chamada, separada de propósito (ver comentário no service) —
      // status real e criativos de campanha/anúncio.
      let entitiesText = '';
      try {
        const entitiesResult = await syncEntities(project.id);
        if (entitiesResult.ok) {
          entitiesText = ` · ${entitiesResult.entitiesSynced ?? 0} campanha(s)/anúncio(s) com status atualizado`;
        } else {
          entitiesText = ` · status/criativos não atualizaram (${entitiesResult.error ?? 'erro'})`;
        }
      } catch {
        entitiesText = ' · status/criativos não atualizaram';
      }

      setFeedback({
        type: 'ok',
        text: `Sincronização histórica concluída: ${totalDays} dia(s) atualizados de ${syncStartDate} até ${until}${entitiesText}.`,
      });
      await reload();
    } catch (e) {
      setFeedback({ type: 'error', text: e instanceof Error ? e.message : 'Erro ao sincronizar.' });
    } finally {
      setSyncing(false);
    }
  }

  function setSyncHistoryDays(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1));
    setSyncStartDate(fmt(date));
  }

  if (loading) return <LoadingView label="Carregando configurações..." />;

  const status = statusLabel[integration?.status ?? 'DISCONNECTED'];
  const StatusIcon = status.icon;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Configurações do projeto</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Conecte a conta de anúncios da Meta para puxar métricas reais deste projeto
        </p>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[var(--color-warn)]">
          Você não tem permissão para editar as configurações deste projeto — exibindo somente leitura.
        </div>
      )}

      <Card title="Geral">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Nome do projeto
            <input
              type="text"
              disabled={!canEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-60"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              Status
              <select
                disabled={!canEdit}
                value={projectStatus}
                onChange={(e) => setProjectStatus(e.target.value as ProjectStatus)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-60"
              >
                <option value="ACTIVE">Ativo</option>
                <option value="PAUSED">Pausado</option>
                <option value="ARCHIVED">Arquivado</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              Timezone
              <input
                type="text"
                disabled={!canEdit}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              Moeda
              <input
                type="text"
                disabled={!canEdit}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-60"
              />
            </label>
          </div>

          {generalFeedback && (
            <p className={`text-xs ${generalFeedback.type === 'ok' ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
              {generalFeedback.text}
            </p>
          )}

          {canEdit && (
            <button
              onClick={handleSaveGeneral}
              disabled={savingGeneral}
              className="w-fit rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {savingGeneral ? 'Salvando...' : 'Salvar'}
            </button>
          )}
        </div>
      </Card>

      <Card title="Metas do mês atual">
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[var(--color-text-muted)]">
            Metas de um período nunca são sobrescritas silenciosamente — salvar de novo o mesmo mês
            atualiza os valores (auditado), mas meses anteriores continuam intactos no histórico
            abaixo.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <GoalField label="Investimento (R$)" disabled={!canEdit} value={goalValues.spend_goal}
              onChange={(v) => setGoalValues((g) => ({ ...g, spend_goal: v }))} />
            <GoalField label="Leads" disabled={!canEdit} value={goalValues.lead_goal}
              onChange={(v) => setGoalValues((g) => ({ ...g, lead_goal: v }))} />
            <GoalField label="CPL máximo (R$)" disabled={!canEdit} value={goalValues.cpl_goal}
              onChange={(v) => setGoalValues((g) => ({ ...g, cpl_goal: v }))} />
            <GoalField label="Vendas" disabled={!canEdit} value={goalValues.sales_goal}
              onChange={(v) => setGoalValues((g) => ({ ...g, sales_goal: v }))} />
            <GoalField label="CAC máximo (R$)" disabled={!canEdit} value={goalValues.cac_goal}
              onChange={(v) => setGoalValues((g) => ({ ...g, cac_goal: v }))} />
            <GoalField label="Receita (R$)" disabled={!canEdit} value={goalValues.revenue_goal}
              onChange={(v) => setGoalValues((g) => ({ ...g, revenue_goal: v }))} />
            <GoalField label="ROAS mínimo" disabled={!canEdit} value={goalValues.roas_goal}
              onChange={(v) => setGoalValues((g) => ({ ...g, roas_goal: v }))} />
          </div>

          {goalsFeedback && (
            <p className={`text-xs ${goalsFeedback.type === 'ok' ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
              {goalsFeedback.text}
            </p>
          )}

          {canEdit && (
            <button
              onClick={handleSaveGoals}
              disabled={savingGoals}
              className="w-fit rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {savingGoals ? 'Salvando...' : 'Salvar metas do mês'}
            </button>
          )}

          {goalHistory && goalHistory.length > 0 && (
            <details className="rounded-lg border border-[var(--color-border)] p-3 text-xs">
              <summary className="cursor-pointer text-[var(--color-text)]">
                Histórico de metas ({goalHistory.length})
              </summary>
              <div className="mt-2 flex flex-col gap-1.5">
                {goalHistory.map((g) => (
                  <div
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-panel-2)] px-3 py-2"
                  >
                    <span className="text-[var(--color-text)]">
                      {g.period_start} — {g.period_end}
                    </span>
                    <span className="text-[var(--color-text-muted)]">
                      {g.spend_goal != null && `Invest. R$ ${g.spend_goal} · `}
                      {g.lead_goal != null && `Leads ${g.lead_goal}`}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </Card>

      <Card
        title="Integração Meta Ads"
        action={
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
          >
            <StatusIcon size={12} />
            {status.label}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[var(--color-text-muted)]">
            As credenciais da Meta são administradas centralmente pela agência. Este projeto usa a
            conexão definida em <strong className="text-[var(--color-text)]">Configurações → APIs</strong>.
          </p>
          {isAdmin && <Link to="/agency/configuracoes?aba=apis" className="inline-flex w-fit rounded-lg border border-[var(--color-brand)]/45 bg-[var(--color-brand-soft)] px-3 py-2 text-xs font-semibold text-[var(--color-brand)] hover:brightness-110">
            Gerenciar APIs da agência
          </Link>}

          {integration?.last_synced_at && (
            <p className="text-[11px] text-[var(--color-text-faint)]">
              Última sincronização: {new Date(integration.last_synced_at).toLocaleString('pt-BR')}
            </p>
          )}

          {feedback && (
            <p className={`text-xs ${feedback.type === 'ok' ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
              {feedback.text}
            </p>
          )}

          {canEdit && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3">
                <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-muted)]">Sincronizar desde<input type="date" value={syncStartDate} max={fmt(new Date())} onChange={(event) => setSyncStartDate(event.target.value)} disabled={syncing} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text)] disabled:opacity-50" /></label>
                <div className="flex flex-wrap gap-1"><button type="button" onClick={() => setSyncHistoryDays(180)} disabled={syncing} className="rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">180 dias</button><button type="button" onClick={() => setSyncHistoryDays(365)} disabled={syncing} className="rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">1 ano</button><button type="button" onClick={() => setSyncHistoryDays(730)} disabled={syncing} className="rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">2 anos</button></div>
                <span className="pb-2 text-[11px] text-[var(--color-text-faint)]">Até hoje: {fmt(new Date())}. A busca é feita em blocos de 30 dias.</span>
              </div>
              <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSync}
                disabled={syncing || integration?.status !== 'CONNECTED'}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)] disabled:opacity-50"
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Sincronizando histórico...' : 'Sincronizar de hoje para trás'}
              </button>
              </div>
            </div>
          )}

          {integration?.status === 'ERROR' && integration.last_error && (
            <p className="rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">
              {integration.last_error}
            </p>
          )}
        </div>
      </Card>

      <Card
        title="Webhooks (Leads e Vendas)"
        action={
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-info-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-info)]">
            <Webhook size={12} />
            {integrationRow ? 'Ativo' : 'Não configurado'}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-[var(--color-text-muted)]">
            As URLs de webhook são as mesmas para todos os projetos — o que muda é o código do
            projeto (<code>project</code>) e o token no corpo/cabeçalho de cada chamada. Configure
            seu CRM, site ou automação (Typebot, RD Station, Zapier) para enviar leads e vendas
            pra cá; reenviar o mesmo <code>external_id</code>/<code>external_sale_id</code>{' '}
            atualiza o registro em vez de duplicar.
          </p>

          {webhookLoading ? (
            <LoadingView label="Carregando..." />
          ) : (
            <>
              {integrationRow && (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
                      Código do projeto (campo <code>project</code> no corpo)
                    </p>
                    <code className="block truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-text)]">
                      {integrationRow.external_code}
                    </code>
                  </div>

                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
                      Token (cabeçalho <code>x-webhook-secret</code>)
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-text)]">
                        {integrationRow.secret}
                      </code>
                      <button
                        onClick={copySecret}
                        title="Copiar token"
                        className="shrink-0 rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
                      >
                        {copiedKey === 'secret' ? (
                          <Check size={14} className="text-[var(--color-good)]" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>

                  {(['leads', 'sales'] as const).map((kind) => (
                    <div key={kind}>
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">
                        URL de {kind === 'leads' ? 'leads' : 'vendas'}
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-text)]">
                          {FUNCTIONS_URL}/webhook-{kind}
                        </code>
                        <button
                          onClick={() => copyWebhookUrl(kind)}
                          title="Copiar URL"
                          className="shrink-0 rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
                        >
                          {copiedKey === kind ? (
                            <Check size={14} className="text-[var(--color-good)]" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {health && (
                <div className="grid grid-cols-4 gap-2 rounded-lg border border-[var(--color-border)] p-3 text-center">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">{health.received}</p>
                    <p className="text-[10px] text-[var(--color-text-faint)]">recebidos (24h)</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-good)]">{health.processed}</p>
                    <p className="text-[10px] text-[var(--color-text-faint)]">processados</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-warn)]">{health.partial}</p>
                    <p className="text-[10px] text-[var(--color-text-faint)]">parciais</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-bad)]">{health.failed}</p>
                    <p className="text-[10px] text-[var(--color-text-faint)]">falharam</p>
                  </div>
                </div>
              )}

              {canEdit && (
                <button
                  onClick={handleRegenerateWebhook}
                  disabled={regenerating}
                  className="flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)] disabled:opacity-50"
                >
                  <RefreshCw size={14} className={regenerating ? 'animate-spin' : ''} />
                  {regenerating
                    ? 'Gerando...'
                    : integrationRow
                      ? 'Gerar novo token (invalida o atual)'
                      : 'Gerar código e token deste projeto'}
                </button>
              )}

              <details className="rounded-lg border border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
                <summary className="cursor-pointer text-[var(--color-text)]">
                  Formato do corpo (JSON) esperado
                </summary>
                <p className="mt-2 font-medium text-[var(--color-text)]">Leads</p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-[var(--color-panel-2)] p-3 text-[11px] text-[var(--color-text)]">
{`{
  "project": "${integrationRow?.external_code ?? 'CODIGO_DO_PROJETO'}",
  "external_id": "id do lead no seu sistema",
  "name": "Maria Silva",
  "email": "maria@email.com",
  "phone": "+5511999999999",
  "utm_source": "facebook",
  "utm_campaign": "pos-ia-agosto",
  "campaign_id": "opcional, id real da Meta",
  "adset_id": "opcional",
  "ad_id": "opcional",
  "status": "NOVO"
}`}
                </pre>
                <p className="mt-3 font-medium text-[var(--color-text)]">Vendas</p>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-[var(--color-panel-2)] p-3 text-[11px] text-[var(--color-text)]">
{`{
  "project": "${integrationRow?.external_code ?? 'CODIGO_DO_PROJETO'}",
  "external_sale_id": "id da venda no seu sistema",
  "phone": "+5511999999999",
  "email": "maria@email.com",
  "amount": 2497,
  "payment_method": "cartao",
  "status": "PAID"
}`}
                </pre>
                <p className="mt-2">
                  O contato é identificado por telefone ou e-mail dentro do cliente — a mesma
                  pessoa em projetos diferentes continua sendo um único contato.
                </p>
              </details>
            </>
          )}
        </div>
      </Card>

      {integration?.status === 'CONNECTED' && (
        <Card title="Campanhas deste projeto">
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--color-text-muted)]">
              Se esta conta de anúncios é usada por mais de um projeto, marque abaixo quais
              campanhas pertencem a <b className="text-[var(--color-text)]">{project.name}</b>. Sem
              nenhuma marcada, o sistema sincroniza a conta inteira (padrão para quem usa uma conta
              por projeto).
            </p>

            {selectedIds.size > 0 && (
              <p className="text-[11px] text-[var(--color-good)]">
                {selectedIds.size} campanha(s) selecionada(s) para este projeto.
              </p>
            )}

            {canEdit && (
              <button
                onClick={handleLoadCampaigns}
                disabled={loadingCampaigns}
                className="flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)] disabled:opacity-50"
              >
                <ListChecks size={14} />
                {loadingCampaigns ? 'Carregando...' : 'Carregar campanhas da conta'}
              </button>
            )}

            {campaignFeedback && (
              <p
                className={`text-xs ${campaignFeedback.type === 'ok' ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}
              >
                {campaignFeedback.text}
              </p>
            )}

            {campaigns && (
              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--color-border)] p-2">
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleCampaign(c.id)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-panel-2)] disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        readOnly
                        checked={selectedIds.has(c.id)}
                        className="accent-[var(--color-brand)]"
                      />
                      <span className="text-[var(--color-text)]">{c.name}</span>
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-[10px] ' +
                          (c.status === 'ACTIVE'
                            ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]'
                            : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]')
                        }
                      >
                        {c.status}
                      </span>
                    </span>
                  </button>
                ))}
                {campaigns.length === 0 && (
                  <p className="px-3 py-2 text-xs text-[var(--color-text-faint)]">
                    Nenhuma campanha encontrada nesta conta.
                  </p>
                )}
              </div>
            )}

            {canEdit && campaigns && (
              <button
                onClick={handleSaveSelection}
                disabled={savingSelection}
                className="w-fit rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {savingSelection ? 'Salvando...' : 'Salvar seleção'}
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function GoalField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
      {label}
      <input
        type="number"
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-60"
      />
    </label>
  );
}
