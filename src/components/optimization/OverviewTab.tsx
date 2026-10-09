import { ArrowRight, CheckCircle2, Plus, ShieldAlert, Sparkles } from 'lucide-react';
import type { OptimizationState } from '../../services/optimization.service';
import { MODE_LABEL, formatMoney } from '../../../supabase/functions/optimization-ia/engine.ts';
import { ActionCard, type Notify } from './ActionsTab';
import { plural, timeAgo } from './format';
import { Chip, EmptyState, ModeChip, Panel, RunStatusChip, StatCard, ghostButton, primaryButton } from './shared';

export type TabId = 'overview' | 'campaigns' | 'automations' | 'diagnostics' | 'approvals' | 'history' | 'settings';

const WEEK_MS = 7 * 24 * 3600_000;

export function OverviewTab({ state, onNavigate, onChanged, notify }: { state: OptimizationState; onNavigate: (tab: TabId) => void; onChanged: () => void; notify: Notify }) {
  const profileById = new Map(state.profiles.map((profile) => [profile.id, profile]));
  const openAlerts = state.actions.filter((action) => action.action_type === 'ALERT' && action.status === 'PROPOSED');
  const pending = state.actions.filter((action) => action.status === 'PENDING_APPROVAL');
  const recommendations = state.actions.filter((action) => action.action_type !== 'ALERT' && action.status === 'PROPOSED');
  const executedWeek = state.actions.filter((action) => action.status === 'EXECUTED' && action.executed_at && Date.now() - Date.parse(action.executed_at) < WEEK_MS);
  const active = state.profiles.filter((profile) => profile.enabled && profile.mode !== 'PAUSED');
  const stopped = state.profiles.filter((profile) => profile.emergency_stop);
  const connected = state.connection?.status === 'CONNECTED';
  const attention = [...pending, ...openAlerts.filter((action) => action.severity === 'CRITICAL')].slice(0, 4);

  if (state.profiles.length === 0) {
    return (
      <div className="space-y-4">
        {!connected && <ConnectionWarning message={state.connection?.last_error ?? null} />}
        <EmptyState
          icon={<Sparkles size={20} />}
          title="Comece criando um perfil"
          description="Um perfil liga uma conta Meta a uma meta de custo e a um conjunto de regras. Ele começa só observando: você vê alertas e recomendações antes de qualquer alteração."
          action={<button type="button" onClick={() => onNavigate('automations')} className={primaryButton}><Plus size={15} /> Criar perfil</button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!connected && <ConnectionWarning message={state.connection?.last_error ?? null} />}
      {stopped.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] px-4 py-3 text-sm text-[var(--color-bad)]">
          <ShieldAlert size={16} /> Parada de emergência ativa em {plural(stopped.length, 'perfil', 'perfis')}. Nenhuma alteração será proposta nem executada neles.
          <button type="button" onClick={() => onNavigate('settings')} className="ml-auto text-xs underline">Configurações</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Perfis avaliando" value={`${active.length} de ${state.profiles.length}`} hint="Avaliação automática ligada e não pausados" />
        <StatCard label="Aguardando aprovação" value={pending.length} tone={pending.length > 0 ? 'warn' : undefined} hint={plural(recommendations.length, 'recomendação em observação', 'recomendações em observação')} />
        <StatCard label="Alertas abertos" value={openAlerts.length} tone={openAlerts.some((action) => action.severity === 'CRITICAL') ? 'bad' : undefined} />
        <StatCard label="Executadas em 7 dias" value={executedWeek.length} hint="Confirmadas pela leitura posterior na Meta" />
      </div>

      <Panel
        title="Saúde dos perfis"
        description="Status do último ciclo de cada perfil. Se a Meta limitar as requisições, o próximo ciclo tenta de novo."
        action={<button type="button" onClick={() => onNavigate('automations')} className={ghostButton}>Gerenciar <ArrowRight size={14} /></button>}
      >
        <div className="divide-y divide-[var(--color-border-soft)]">
          {state.profiles.map((profile) => {
            const lastRun = state.runs.find((run) => run.profile_id === profile.id);
            return (
              <div key={profile.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{profile.name}</span>
                <span className="text-xs text-[var(--color-text-muted)]">{profile.ad_account_name ?? profile.ad_account_id}</span>
                <span className="text-xs text-[var(--color-text-muted)]">meta {formatMoney(Number(profile.target_cpa_cents), profile.currency)}</span>
                <ModeChip mode={profile.mode} />
                {profile.emergency_stop && <Chip tone="bad">Parada</Chip>}
                <RunStatusChip status={profile.last_run_status} />
                <span className="w-28 text-right text-xs text-[var(--color-text-faint)]" title={lastRun?.error ?? undefined}>{timeAgo(profile.last_evaluated_at)}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Precisa da sua atenção"
        description="Propostas aguardando aprovação e alertas críticos."
        action={pending.length + openAlerts.length > 0 ? <button type="button" onClick={() => onNavigate(pending.length > 0 ? 'approvals' : 'diagnostics')} className={ghostButton}>Ver tudo <ArrowRight size={14} /></button> : undefined}
      >
        {attention.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><CheckCircle2 size={16} className="text-[var(--color-good)]" /> Nada pendente agora.</p>
        ) : (
          <div className="space-y-3">
            {attention.map((action) => <ActionCard key={action.id} action={action} profile={profileById.get(action.profile_id)} onDecided={onChanged} notify={notify} compact />)}
          </div>
        )}
      </Panel>

      <p className="text-xs leading-5 text-[var(--color-text-faint)]">
        Os modos são: {Object.values(MODE_LABEL).join(', ')}. Depois de uma alteração, o histórico mostra o que foi observado, sem afirmar que a mudança causou o resultado.
      </p>
    </div>
  );
}

function ConnectionWarning({ message }: { message: string | null }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-4 py-3 text-sm">
      <ShieldAlert size={16} className="mt-0.5 text-[var(--color-warn)]" />
      <div>
        <p className="font-medium text-[var(--color-text)]">A conexão com a Meta precisa de atenção</p>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{message ?? 'Peça a um administrador para conectar em Configurações › APIs › Meta Ads.'} Enquanto isso, as avaliações ficam suspensas.</p>
      </div>
    </div>
  );
}
