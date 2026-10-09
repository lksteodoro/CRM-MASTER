import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import type { OptimizationAction, OptimizationState } from '../../services/optimization.service';
import { ACTION_STATUS_LABEL, ACTION_TYPE_LABEL, LEVEL_LABEL, formatMoney, type ActionStatus, type ActionType } from '../../../supabase/functions/optimization-ia/engine.ts';

import { formatDate, formatDateTime, payloadText } from './format';
import { Chip, EmptyState, Field, Panel, RunStatusChip, StatusChip, inputClass } from './shared';

const EVENT_LABEL: Record<string, string> = {
  PROFILE_CREATED: 'Perfil criado',
  PROFILE_UPDATED: 'Perfil alterado',
  PROFILE_ARCHIVED: 'Perfil arquivado',
  EMERGENCY_STOP_ON: 'Parada ligada',
  EMERGENCY_STOP_OFF: 'Parada desligada',
  MANUAL_EVALUATION: 'Avaliação manual',
  ACTION_APPROVED: 'Aprovação',
  ACTION_REJECTED: 'Rejeição',
  ACTION_DISMISSED: 'Dispensa',
  ACTION_EXECUTED: 'Execução',
  ACTION_FAILED: 'Falha',
  ACTION_SKIPPED: 'Não executada',
};

function stateText(state: Record<string, unknown> | null, currency: string) {
  if (!state) return '—';
  const parts: string[] = [];
  if (state.status) parts.push(`status ${String(state.status) === 'PAUSED' ? 'pausado' : String(state.status) === 'ACTIVE' ? 'ativo' : String(state.status)}`);
  if (state.daily_budget) parts.push(`orçamento ${formatMoney(Number(state.daily_budget), currency)}/dia`);
  return parts.join(' · ') || '—';
}

function ActionRow({ action, profileName, people, currency }: { action: OptimizationAction; profileName: string; people: Record<string, string>; currency: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-b border-[var(--color-border-soft)] align-top">
        <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{formatDateTime(action.executed_at ?? action.decided_at ?? action.created_at)}</td>
        <td className="px-3 py-2.5">
          <p className="text-[var(--color-text)]">{action.title}</p>
          <p className="text-[11px] text-[var(--color-text-faint)]">{LEVEL_LABEL[action.resource_level]}: {action.resource_name ?? action.resource_id} · {profileName}</p>
        </td>
        <td className="px-3 py-2.5"><StatusChip status={action.status} /></td>
        <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{action.decided_by ? people[action.decided_by] ?? 'Usuário' : action.status === 'PROPOSED' || action.status === 'PENDING_APPROVAL' ? '—' : 'Sistema'}</td>
        <td className="px-3 py-2.5 text-right">
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="text-xs text-[var(--color-brand)] hover:underline">{open ? 'Fechar' : 'Detalhes'}</button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--color-border-soft)] bg-white/[0.02]">
          <td colSpan={5} className="space-y-1.5 px-3 py-3 text-xs leading-5 text-[var(--color-text-muted)]">
            <p><span className="text-[var(--color-text)]">Regra:</span> {action.rule_key}{action.rule_version ? ` (versão ${action.rule_version})` : ''} · origem {action.source === 'RULE_ENGINE' ? 'motor de regras' : action.source === 'HUMAN' ? 'humana' : 'IA'}</p>
            {payloadText(action, currency) && <p><span className="text-[var(--color-text)]">Pedido:</span> {payloadText(action, currency)}</p>}
            {action.reason && <p><span className="text-[var(--color-text)]">Evidência:</span> {action.reason}</p>}
            <p><span className="text-[var(--color-text)]">Antes:</span> {stateText(action.before_state, currency)} · <span className="text-[var(--color-text)]">Depois:</span> {stateText(action.after_state, currency)}</p>
            {action.meta_response_safe && <p><span className="text-[var(--color-text)]">Confirmação da Meta:</span> {action.meta_response_safe.confirmed ? 'valor novo lido de volta' : 'escrita aceita, leitura posterior não confirmou'}</p>}
            {action.validation_report?.reasons && action.validation_report.reasons.length > 0 && <p className="text-[var(--color-warn)]">Conferência: {action.validation_report.reasons.join('; ')}</p>}
            {action.error_summary && <p className="text-[var(--color-bad)]">Erro: {action.error_summary}</p>}
            {action.decision_note && <p>Nota: {action.decision_note}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

export function HistoryTab({ state }: { state: OptimizationState }) {
  const [profileId, setProfileId] = useState('');
  const [status, setStatus] = useState<ActionStatus | ''>('');
  const [type, setType] = useState<ActionType | ''>('');
  const profileById = useMemo(() => new Map(state.profiles.map((profile) => [profile.id, profile])), [state.profiles]);

  const actions = state.actions.filter((action) =>
    (!profileId || action.profile_id === profileId) && (!status || action.status === status) && (!type || action.action_type === type),
  );
  const runs = state.runs.filter((run) => !profileId || run.profile_id === profileId).slice(0, 20);
  const events = state.events.filter((event) => !profileId || event.profile_id === profileId).slice(0, 40);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Perfil" htmlFor="opt-history-profile">
          <select id="opt-history-profile" value={profileId} onChange={(event) => setProfileId(event.target.value)} className={inputClass}>
            <option value="">Todos</option>
            {state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </Field>
        <Field label="Situação" htmlFor="opt-history-status">
          <select id="opt-history-status" value={status} onChange={(event) => setStatus(event.target.value as ActionStatus | '')} className={inputClass}>
            <option value="">Todas</option>
            {(Object.keys(ACTION_STATUS_LABEL) as ActionStatus[]).map((key) => <option key={key} value={key}>{ACTION_STATUS_LABEL[key]}</option>)}
          </select>
        </Field>
        <Field label="Tipo" htmlFor="opt-history-type">
          <select id="opt-history-type" value={type} onChange={(event) => setType(event.target.value as ActionType | '')} className={inputClass}>
            <option value="">Todos</option>
            {(Object.keys(ACTION_TYPE_LABEL) as ActionType[]).map((key) => <option key={key} value={key}>{ACTION_TYPE_LABEL[key]}</option>)}
          </select>
        </Field>
      </div>

      <Panel title="Ações" description="Cada item guarda regra, evidência, quem decidiu, o estado antes e depois e a confirmação da Meta.">
        {actions.length === 0 ? (
          <EmptyState icon={<History size={20} />} title="Sem ações para os filtros escolhidos" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2 font-medium">Ação</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Decidido por</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <ActionRow key={action.id} action={action} profileName={profileById.get(action.profile_id)?.name ?? 'Perfil arquivado'} people={state.people} currency={profileById.get(action.profile_id)?.currency ?? 'BRL'} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Ciclos de avaliação" description="Execuções do motor de regras, automáticas ou manuais.">
          {runs.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Nenhum ciclo ainda.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-soft)] text-xs">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-24 text-[var(--color-text-muted)]">{formatDateTime(run.started_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{profileById.get(run.profile_id)?.name ?? 'Perfil arquivado'}</span>
                  <Chip>{run.trigger === 'CRON' ? 'Automático' : 'Manual'}</Chip>
                  <RunStatusChip status={run.status} />
                  <span className="w-full text-[var(--color-text-faint)] sm:w-auto">
                    {run.status === 'OK'
                      ? `${formatDate(run.window_since)}–${formatDate(run.window_until)} · ${run.resources_evaluated} recursos · ${run.actions_created} novos`
                      : run.error ?? ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Auditoria" description="Quem fez o quê: perfis, paradas de emergência e decisões.">
          {events.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Nenhum registro ainda.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-soft)] text-xs">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-24 text-[var(--color-text-muted)]">{formatDateTime(event.created_at)}</span>
                  <Chip tone={event.event_type.includes('FAILED') || event.event_type === 'EMERGENCY_STOP_ON' ? 'bad' : event.event_type === 'ACTION_EXECUTED' ? 'good' : 'muted'}>{EVENT_LABEL[event.event_type] ?? event.event_type}</Chip>
                  <span className="min-w-0 flex-1 text-[var(--color-text)]">{event.message}</span>
                  <span className="text-[var(--color-text-faint)]">{event.actor_id ? state.people[event.actor_id] ?? 'Usuário' : 'Sistema'}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
