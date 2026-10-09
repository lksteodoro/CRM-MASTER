import { useState } from 'react';
import { OctagonX, Play, ShieldCheck } from 'lucide-react';
import { optimizationApi, type OptimizationState } from '../../services/optimization.service';
import { ACTION_STATUS_LABEL, MODE_LABEL, type ActionStatus } from '../../../supabase/functions/optimization-ia/engine.ts';
import type { Notify } from './ActionsTab';
import { plural } from './format';
import { Chip, ModeChip, Panel, dangerButton, ghostButton } from './shared';

const STATUS_HELP: Partial<Record<ActionStatus, string>> = {
  PROPOSED: 'Sugestão do motor. Não executa nada.',
  PENDING_APPROVAL: 'Aguarda alguém aprovar. Expira se ninguém decidir.',
  EXECUTED: 'Enviada à Meta e lida de volta.',
  SKIPPED: 'Aprovada, mas a conferência final encontrou algo diferente e não enviou.',
  FAILED: 'A Meta recusou o envio.',
  EXPIRED: 'Passou da validade sem decisão.',
};

export function SettingsTab({ state, onChanged, notify }: { state: OptimizationState; onChanged: () => void; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const anyStopped = state.profiles.some((profile) => profile.emergency_stop);

  const toggle = async (active: boolean, profileId?: string, name?: string) => {
    const target = name ? `o perfil "${name}"` : 'todos os perfis';
    const message = active
      ? `Ligar a parada de emergência para ${target}?\n\nPropostas pendentes são canceladas e nenhuma nova alteração é proposta ou executada. Alertas continuam aparecendo.`
      : `Desligar a parada de emergência para ${target}? As propostas voltam a ser geradas no próximo ciclo.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      const result = await optimizationApi.emergencyStop(active, profileId);
      if (active) {
        notify(
          `Parada ligada em ${plural(result.updated, 'perfil', 'perfis')}. ${plural(result.cancelled, 'proposta cancelada', 'propostas canceladas')}.${result.executing > 0 ? ` ${plural(result.executing, 'ação já estava', 'ações já estavam')} em envio e não pode ser desfeita por aqui.` : ''}`,
          'warn',
        );
      } else {
        notify('Parada de emergência desligada.', 'good');
      }
      onChanged();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Falha ao alterar a parada de emergência.', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Parada de emergência"
        description="Interrompe na hora qualquer proposta ou execução de alteração. Qualquer pessoa com acesso pode ligar; só administradores desligam."
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || state.profiles.length === 0} onClick={() => void toggle(true)} className={dangerButton}>
            <OctagonX size={15} /> Parar todos os perfis
          </button>
          {state.isAdmin && anyStopped && (
            <button type="button" disabled={busy} onClick={() => void toggle(false)} className={ghostButton}>
              <Play size={15} /> Retomar todos
            </button>
          )}
        </div>
        {state.profiles.length > 0 && (
          <div className="mt-4 divide-y divide-[var(--color-border-soft)]">
            {state.profiles.map((profile) => (
              <div key={profile.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{profile.name}</span>
                <ModeChip mode={profile.mode} />
                {profile.emergency_stop ? (
                  <>
                    <Chip tone="bad">Parada ligada</Chip>
                    {state.isAdmin && <button type="button" disabled={busy} onClick={() => void toggle(false, profile.id, profile.name)} className={ghostButton}>Desligar</button>}
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void toggle(true, profile.id, profile.name)} className={ghostButton}>Parar este</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Modos de execução">
          <ul className="space-y-2 text-xs leading-5 text-[var(--color-text-muted)]">
            <li><span className="font-medium text-[var(--color-text)]">{MODE_LABEL.OBSERVE}:</span> padrão de todo perfil novo. Lê, avalia, recomenda e alerta. Nada é enviado à Meta.</li>
            <li><span className="font-medium text-[var(--color-text)]">{MODE_LABEL.APPROVAL}:</span> propostas de pausa e orçamento vão para Aprovações. Só administradores ativam.</li>
            <li><span className="font-medium text-[var(--color-text)]">{MODE_LABEL.AUTO_LIMITED}:</span> ainda não liberado. Será habilitado por cliente depois de um piloto validado.</li>
            <li><span className="font-medium text-[var(--color-text)]">{MODE_LABEL.PAUSED}:</span> o perfil não avalia nada.</li>
          </ul>
        </Panel>

        <Panel title="O que cada situação significa">
          <ul className="space-y-2 text-xs leading-5 text-[var(--color-text-muted)]">
            {(Object.keys(STATUS_HELP) as ActionStatus[]).map((status) => (
              <li key={status}><span className="font-medium text-[var(--color-text)]">{ACTION_STATUS_LABEL[status]}:</span> {STATUS_HELP[status]}</li>
            ))}
          </ul>
        </Panel>

        <Panel title="Proteções sempre ativas">
          <ul className="list-disc space-y-1.5 pl-4 text-xs leading-5 text-[var(--color-text-muted)]">
            <li>Antes de enviar, o sistema lê o recurso na Meta e cancela se status ou orçamento mudaram desde a proposta.</li>
            <li>Orçamento só é alterado no nível que controla o gasto (campanha com CBO, conjunto com ABO) e só se for diário.</li>
            <li>Nada é reativado automaticamente. O módulo só pausa, reduz ou aumenta orçamento.</li>
            <li>Cliques sem nenhum resultado, quando antes havia, suspendem as ações da campanha (possível falha de rastreamento).</li>
            <li>Uma mesma proposta nunca é executada duas vezes, mesmo com dois cliques ao mesmo tempo.</li>
            <li>Os dias analisados terminam ontem, no fuso da conta, porque a Meta ainda atribui conversões com atraso.</li>
          </ul>
        </Panel>

        <Panel title="Acesso">
          <p className="flex items-start gap-2 text-xs leading-5 text-[var(--color-text-muted)]">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--color-good)]" />
            Usa a mesma conexão Meta da agência (Configurações › APIs), com o token guardado só no servidor. Quem tem a ferramenta "Otimização IA" liberada vê tudo, cria perfis e decide propostas. Administradores também ativam o modo com aprovação e desligam a parada de emergência.
          </p>
        </Panel>
      </div>
    </div>
  );
}
