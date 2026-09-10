import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import {
  createCsScheduledMessage,
  csRecurrenceLabels,
  csWeekdayLabels,
  deleteCsScheduledMessage,
  listCsScheduledMessages,
  nextCsRun,
  updateCsScheduledMessage,
  type CsRecurrence,
  type CsScheduleInput,
} from '../../services/consumerSuccess.service';
import type { CsGroupRow, CsScheduledMessageRow } from '../../integrations/supabase/database.types';
import { LoadingView } from '../ui/StateView';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function emptyForm(groupId = ''): CsScheduleInput {
  return {
    group_id: groupId,
    title: '',
    body: '',
    recurrence: 'weekly',
    send_time: '09:00',
    weekday: 1,
    day_of_month: null,
    starts_on: todayIso(),
    ends_on: null,
    active: true,
  };
}

function toForm(schedule: CsScheduledMessageRow): CsScheduleInput {
  return {
    group_id: schedule.group_id,
    title: schedule.title,
    body: schedule.body,
    recurrence: schedule.recurrence,
    send_time: schedule.send_time.slice(0, 5),
    weekday: schedule.weekday,
    day_of_month: schedule.day_of_month,
    starts_on: schedule.starts_on,
    ends_on: schedule.ends_on,
    active: schedule.active,
  };
}

function cadenceLabel(schedule: CsScheduledMessageRow): string {
  const time = schedule.send_time.slice(0, 5);
  switch (schedule.recurrence) {
    case 'daily':
      return `Todo dia às ${time}`;
    case 'weekly':
      return `Toda ${csWeekdayLabels[schedule.weekday ?? 0]} às ${time}`;
    case 'monthly':
      return `Todo dia ${schedule.day_of_month} às ${time}`;
    case 'once':
      return `Uma vez em ${new Date(`${schedule.starts_on}T00:00:00`).toLocaleDateString('pt-BR')} às ${time}`;
  }
}

function nextRunLabel(schedule: CsScheduledMessageRow): string {
  if (!schedule.active) return 'Pausada';
  const next = nextCsRun(schedule);
  if (!next) return 'Sem próximo envio';
  return next.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ScheduleModal({
  groups,
  schedule,
  onClose,
  onSaved,
}: {
  groups: CsGroupRow[];
  schedule: CsScheduledMessageRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CsScheduleInput>(
    schedule ? toForm(schedule) : emptyForm(groups[0]?.id ?? '')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CsScheduleInput>(key: K, value: CsScheduleInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeRecurrence(recurrence: CsRecurrence) {
    setForm((current) => ({
      ...current,
      recurrence,
      // Cada recorrência usa um campo diferente; zera o que não vale mais pra
      // não salvar um dia da semana em uma mensagem mensal, por exemplo.
      weekday: recurrence === 'weekly' ? (current.weekday ?? 1) : null,
      day_of_month: recurrence === 'monthly' ? (current.day_of_month ?? 1) : null,
    }));
  }

  async function handleSave() {
    if (!form.group_id) return setError('Escolha o grupo que vai receber.');
    if (!form.title.trim()) return setError('Dá um nome pra essa mensagem.');
    if (!form.body.trim()) return setError('Escreva o texto que vai ser enviado.');

    setSaving(true);
    setError(null);
    try {
      const payload: CsScheduleInput = {
        ...form,
        title: form.title.trim(),
        body: form.body.trim(),
        ends_on: form.ends_on || null,
      };
      if (schedule) await updateCsScheduledMessage(schedule.id, payload);
      else await createCsScheduledMessage(payload);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--color-text)]">
            {schedule ? 'Editar mensagem periódica' : 'Nova mensagem periódica'}
          </h3>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1 text-[var(--color-text-faint)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass}>Grupo</label>
            <select
              className={inputClass}
              value={form.group_id}
              onChange={(event) => set('group_id', event.target.value)}
            >
              <option value="">Selecione...</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name ?? group.evolution_jid}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Nome interno</label>
            <input
              className={inputClass}
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
              placeholder="Ex: Resumo semanal de resultados"
            />
          </div>

          <div>
            <label className={labelClass}>Mensagem</label>
            <textarea
              className={inputClass}
              rows={5}
              value={form.body}
              onChange={(event) => set('body', event.target.value)}
              placeholder="Texto que vai ser enviado no grupo"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Frequência</label>
              <select
                className={inputClass}
                value={form.recurrence}
                onChange={(event) => changeRecurrence(event.target.value as CsRecurrence)}
              >
                {Object.entries(csRecurrenceLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Horário</label>
              <input
                type="time"
                className={inputClass}
                value={form.send_time}
                onChange={(event) => set('send_time', event.target.value)}
              />
            </div>
          </div>

          {form.recurrence === 'weekly' && (
            <div>
              <label className={labelClass}>Dia da semana</label>
              <select
                className={inputClass}
                value={form.weekday ?? 1}
                onChange={(event) => set('weekday', Number(event.target.value))}
              >
                {csWeekdayLabels.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.recurrence === 'monthly' && (
            <div>
              <label className={labelClass}>Dia do mês</label>
              <input
                type="number"
                min={1}
                max={28}
                className={inputClass}
                value={form.day_of_month ?? 1}
                onChange={(event) =>
                  set('day_of_month', Math.min(28, Math.max(1, Number(event.target.value))))
                }
              />
              <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                Até 28 pra cair todo mês, inclusive fevereiro.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Começa em</label>
              <input
                type="date"
                className={inputClass}
                value={form.starts_on}
                onChange={(event) => set('starts_on', event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Termina em (opcional)</label>
              <input
                type="date"
                className={inputClass}
                value={form.ends_on ?? ''}
                onChange={(event) => set('ends_on', event.target.value || null)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => set('active', event.target.checked)}
            />
            Ativa (envia automaticamente)
          </label>

          {error && <p className="text-xs text-[var(--color-bad)]">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

export function CsScheduledPanel({ groups }: { groups: CsGroupRow[] }) {
  const [schedules, setSchedules] = useState<CsScheduledMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CsScheduledMessageRow | null | undefined>(undefined);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setSchedules(await listCsScheduledMessages());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível carregar as mensagens programadas.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleActive(schedule: CsScheduledMessageRow) {
    setMutatingId(schedule.id);
    try {
      await updateCsScheduledMessage(schedule.id, { active: !schedule.active });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível alterar.');
    } finally {
      setMutatingId(null);
    }
  }

  async function remove(schedule: CsScheduledMessageRow) {
    setMutatingId(schedule.id);
    try {
      await deleteCsScheduledMessage(schedule.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível excluir.');
    } finally {
      setMutatingId(null);
    }
  }

  const groupById = new Map(groups.map((group) => [group.id, group]));

  if (loading) return <LoadingView label="Carregando mensagens programadas..." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">
          O sistema envia sozinho no horário. A verificação roda a cada 10 minutos, então pode sair
          alguns minutos depois do horário marcado.
        </p>
        <button
          onClick={() => setEditing(null)}
          disabled={groups.length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Plus size={15} />
          Nova mensagem
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          Nenhuma mensagem periódica ainda. Crie a primeira pra manter os grupos aquecidos sem
          depender de lembrete.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {schedules.map((schedule) => {
            const group = groupById.get(schedule.group_id);
            return (
              <article
                key={schedule.id}
                className={clsx(
                  'flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-[var(--color-panel)] p-4',
                  schedule.active
                    ? 'border-[var(--color-border)]'
                    : 'border-[var(--color-border-soft)] opacity-60'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                    {schedule.title}
                  </p>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {group?.name ?? 'Grupo removido'} · {cadenceLabel(schedule)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-[var(--color-text-faint)]">
                    {schedule.body}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 rounded-lg bg-[var(--color-panel-2)] px-2 py-1.5 text-[11px] text-[var(--color-text-muted)]">
                    <CalendarClock size={12} />
                    {nextRunLabel(schedule)}
                  </span>

                  <button
                    onClick={() => void toggleActive(schedule)}
                    disabled={mutatingId === schedule.id}
                    title={schedule.active ? 'Pausar' : 'Ativar'}
                    className={clsx(
                      'rounded-lg border p-1.5 transition-colors disabled:opacity-50',
                      schedule.active
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-[var(--color-border)] text-[var(--color-text-faint)]'
                    )}
                  >
                    <Power size={14} />
                  </button>
                  <button
                    onClick={() => setEditing(schedule)}
                    title="Editar"
                    className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => void remove(schedule)}
                    disabled={mutatingId === schedule.id}
                    title="Excluir"
                    className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)] disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing !== undefined && (
        <ScheduleModal
          groups={groups}
          schedule={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await load();
          }}
        />
      )}
    </div>
  );
}
