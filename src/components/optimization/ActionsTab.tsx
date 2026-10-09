import { useMemo, useState } from 'react';
import { Check, ClipboardCheck, ExternalLink, Eye, Stethoscope, X } from 'lucide-react';
import { adsManagerLink } from '../../lib/metaBulkEdit';
import { optimizationApi, type OptimizationAction, type OptimizationProfile } from '../../services/optimization.service';
import {
  LEVEL_LABEL,
  METRICS,
  formatMetric,
  type Metric,
} from '../../../supabase/functions/optimization-ia/engine.ts';
import { formatDateTime, payloadText, timeAgo } from './format';
import { Chip, EmptyState, Field, SeverityIcon, StatusChip, dangerButton, ghostButton, inputClass, primaryButton } from './shared';

export type Notify = (text: string, tone?: 'good' | 'warn' | 'bad') => void;

const EVIDENCE_ROWS: Metric[] = ['spend', 'results', 'cpa', 'ctr', 'cpm', 'cpc', 'frequency', 'impressions'];


function isOpen(action: OptimizationAction) {
  return action.status === 'PROPOSED' || action.status === 'PENDING_APPROVAL';
}

export function ActionCard({
  action,
  profile,
  onDecided,
  notify,
  compact = false,
}: {
  action: OptimizationAction;
  profile: OptimizationProfile | undefined;
  onDecided: () => void;
  notify: Notify;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(!compact);
  const currency = profile?.currency ?? 'BRL';
  const change = payloadText(action, currency);
  const isWrite = action.action_type !== 'ALERT';
  const evidence = action.evidence ?? {};
  const level = action.resource_level === 'CAMPAIGN' ? 'campaign' : action.resource_level === 'ADSET' ? 'adset' : null;

  const decide = async (decision: 'approve' | 'reject' | 'dismiss') => {
    let note: string | undefined;
    if (decision === 'approve') {
      const ok = window.confirm(
        `Aprovar e executar agora na Meta?\n\n${action.title}\n${LEVEL_LABEL[action.resource_level]}: ${action.resource_name ?? action.resource_id}\n${change ?? ''}\n\nAntes de enviar, o sistema confere status, orçamento, teto, cooldown e limites. Se algo mudou, a ação não é executada.`,
      );
      if (!ok) return;
    }
    if (decision === 'reject') {
      const reason = window.prompt('Motivo da rejeição (opcional):', '');
      if (reason === null) return;
      note = reason;
    }
    setBusy(true);
    try {
      const result = await optimizationApi.decide(action.id, decision, note);
      if (result.status === 'EXECUTED') notify(result.confirmed ? 'Executada e confirmada na Meta.' : 'Executada. A Meta ainda não confirmou a leitura do novo valor.', result.confirmed ? 'good' : 'warn');
      else if (result.status === 'SKIPPED') notify(`Não executada: ${(result.reasons ?? []).join('; ')}`, 'warn');
      else if (result.status === 'FAILED') notify(`A Meta recusou: ${result.message ?? 'erro desconhecido'}`, 'bad');
      else if (result.status === 'REJECTED') notify('Proposta rejeitada.', 'good');
      else notify('Item dispensado.', 'good');
      onDecided();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Falha ao registrar a decisão.', 'bad');
      onDecided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <SeverityIcon severity={action.severity} size={18} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--color-text)]">{action.title}</h4>
            <StatusChip status={action.status} />
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {LEVEL_LABEL[action.resource_level]}: <span className="text-[var(--color-text)]">{action.resource_name ?? action.resource_id}</span>
            {profile && <> · Perfil {profile.name}</>} · {timeAgo(action.created_at)}
          </p>
          {change && <p className="mt-2 inline-flex rounded-lg bg-white/5 px-2.5 py-1 text-xs font-medium text-[var(--color-text)]">{change}</p>}
        </div>
        {level && profile && (
          <a
            href={adsManagerLink(level, profile.ad_account_id, action.resource_id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Gerenciador <ExternalLink size={12} />
          </a>
        )}
      </div>

      {compact && (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-2 text-xs text-[var(--color-brand)] hover:underline">
          {expanded ? 'Ocultar detalhes' : 'Ver evidências'}
        </button>
      )}

      {expanded && (
        <div className="mt-3 space-y-3">
          {action.reason && <p className="text-xs leading-5 text-[var(--color-text-muted)]"><span className="font-medium text-[var(--color-text)]">Por quê: </span>{action.reason}</p>}

          {evidence.current && Object.keys(evidence.current).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead className="text-[var(--color-text-faint)]">
                  <tr>
                    <th className="py-1 pr-3 text-left font-medium">Métrica</th>
                    <th className="py-1 pr-3 text-right font-medium">Período atual</th>
                    <th className="py-1 text-right font-medium">Período anterior</th>
                  </tr>
                </thead>
                <tbody>
                  {EVIDENCE_ROWS.filter((metric) => metric in (evidence.current ?? {})).map((metric) => (
                    <tr key={metric} className="border-t border-[var(--color-border-soft)]">
                      <td className="py-1 pr-3 text-[var(--color-text-muted)]">{METRICS[metric].label}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-[var(--color-text)]">{formatMetric(metric, evidence.current?.[metric] ?? null, currency)}</td>
                      <td className="py-1 text-right tabular-nums text-[var(--color-text-muted)]">{formatMetric(metric, evidence.previous?.[metric] ?? null, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(action.diagnosis?.causes?.length || action.diagnosis?.recommendation) && (
            <div className="grid gap-3 rounded-xl bg-white/[0.03] p-3 text-xs leading-5 sm:grid-cols-2">
              {action.diagnosis?.causes && action.diagnosis.causes.length > 0 && (
                <div>
                  <p className="font-medium text-[var(--color-text)]">Causas prováveis</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--color-text-muted)]">
                    {action.diagnosis.causes.map((cause) => <li key={cause}>{cause}</li>)}
                  </ul>
                </div>
              )}
              <div className="space-y-2">
                {action.diagnosis?.recommendation && <p className="text-[var(--color-text-muted)]"><span className="font-medium text-[var(--color-text)]">Sugestão: </span>{action.diagnosis.recommendation}</p>}
                {action.risk && <p className="text-[var(--color-text-muted)]"><span className="font-medium text-[var(--color-text)]">Risco: </span>{action.risk}</p>}
              </div>
            </div>
          )}

          {evidence.notes && evidence.notes.length > 0 && (
            <p className="text-xs text-[var(--color-warn)]">Bloqueios: {evidence.notes.join('; ')}</p>
          )}
          {action.validation_report?.reasons && action.validation_report.reasons.length > 0 && (
            <p className="text-xs text-[var(--color-warn)]">Conferência: {action.validation_report.reasons.join('; ')}</p>
          )}
          {action.error_summary && <p className="text-xs text-[var(--color-bad)]">Erro da Meta: {action.error_summary}</p>}
          {action.decision_note && <p className="text-xs text-[var(--color-text-muted)]">Nota da decisão: {action.decision_note}</p>}
        </div>
      )}

      {isOpen(action) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-soft)] pt-3">
          {action.status === 'PENDING_APPROVAL' && (
            <>
              <button type="button" disabled={busy} onClick={() => void decide('approve')} className={primaryButton}><Check size={15} /> Aprovar e executar</button>
              <button type="button" disabled={busy} onClick={() => void decide('reject')} className={dangerButton}><X size={15} /> Rejeitar</button>
              {action.expires_at && <span className="text-[11px] text-[var(--color-text-faint)]">Vale até {formatDateTime(action.expires_at)}</span>}
            </>
          )}
          {action.status === 'PROPOSED' && (
            <>
              <button type="button" disabled={busy} onClick={() => void decide('dismiss')} className={ghostButton}><X size={15} /> Dispensar</button>
              {isWrite && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-faint)]">
                  <Eye size={12} /> Perfil em observação: para executar, um administrador muda o perfil para "Com aprovação".
                </span>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function ActionsTab({
  kind,
  actions,
  profiles,
  onChanged,
  notify,
}: {
  kind: 'diagnostics' | 'approvals';
  actions: OptimizationAction[];
  profiles: OptimizationProfile[];
  onChanged: () => void;
  notify: Notify;
}) {
  const [profileId, setProfileId] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);

  const list = actions.filter((action) =>
    (kind === 'diagnostics' ? action.action_type === 'ALERT' : action.action_type !== 'ALERT') &&
    (!profileId || action.profile_id === profileId) &&
    (!onlyOpen || isOpen(action)),
  );
  const pending = list.filter((action) => action.status === 'PENDING_APPROVAL').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Field label="Perfil" htmlFor={`opt-${kind}-profile`}>
            <select id={`opt-${kind}-profile`} value={profileId} onChange={(event) => setProfileId(event.target.value)} className={inputClass}>
              <option value="">Todos os perfis</option>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </Field>
        </div>
        <div role="group" aria-label="Filtro de situação" className="flex rounded-xl border border-[var(--color-border)] p-1">
          {[{ value: true, label: 'Abertos' }, { value: false, label: 'Todos' }].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={onlyOpen === option.value}
              onClick={() => setOnlyOpen(option.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${onlyOpen === option.value ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {kind === 'approvals' && pending > 0 && <Chip tone="warn">{pending} aguardando decisão</Chip>}
      </div>

      <p className="text-xs leading-5 text-[var(--color-text-muted)]">
        {kind === 'diagnostics'
          ? 'Alertas e diagnósticos das regras. Eles não alteram nada na Meta; servem para orientar a sua revisão.'
          : 'Propostas de pausa e de orçamento. Em perfis "Com aprovação", cada uma só é enviada à Meta quando alguém aprova, e o sistema confere tudo de novo antes de enviar.'}
      </p>

      {list.length === 0 ? (
        <EmptyState
          icon={kind === 'diagnostics' ? <Stethoscope size={20} /> : <ClipboardCheck size={20} />}
          title={onlyOpen ? 'Nada em aberto' : 'Nada por aqui ainda'}
          description={kind === 'diagnostics' ? 'Quando uma regra de alerta disparar, o diagnóstico aparece aqui.' : 'Quando uma regra propuser pausa ou mudança de orçamento, ela aparece aqui.'}
        />
      ) : (
        <div className="space-y-3">
          {list.map((action) => (
            <ActionCard key={action.id} action={action} profile={profileById.get(action.profile_id)} onDecided={onChanged} notify={notify} compact={!isOpen(action)} />
          ))}
        </div>
      )}
    </div>
  );
}
