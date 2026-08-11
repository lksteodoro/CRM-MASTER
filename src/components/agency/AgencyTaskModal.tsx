import { useState } from 'react';
import { X, Trash2, Loader2 } from 'lucide-react';
import type { AgencyTaskRow } from '../../integrations/supabase/database.types';
import {
  agencyTaskCategoryLabels,
  type AgencyTaskCategory,
  type AgencyTaskInput,
} from '../../services/agencyTasks.service';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';

export function AgencyTaskModal({
  task,
  onClose,
  onSave,
  onDelete,
}: {
  /** null = criando um card novo. */
  task: AgencyTaskRow | null;
  onClose: () => void;
  onSave: (input: AgencyTaskInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [category, setCategory] = useState<AgencyTaskCategory>(task?.category ?? 'marketing');
  const [hours, setHours] = useState(task ? Math.floor((task.estimated_minutes ?? 0) / 60) : 0);
  const [minutes, setMinutes] = useState(task ? (task.estimated_minutes ?? 0) % 60 : 0);
  const [dueDate, setDueDate] = useState(task?.due_date ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!title.trim()) {
      setError('Dá um título pra tarefa.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const totalMinutes = hours * 60 + minutes;
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        category,
        estimated_minutes: totalMinutes > 0 ? totalMinutes : null,
        due_date: dueDate || null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar a tarefa.');
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir a tarefa.');
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--color-text)]">
            {task ? 'Editar tarefa' : 'Nova tarefa'}
          </h3>
          <button onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass}>Título</label>
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Criar 5 criativos para campanha X"
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass}>Que tipo de trabalho preciso executar</label>
            <textarea
              className={inputClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhe o que precisa ser feito"
            />
          </div>

          <div>
            <label className={labelClass}>Categoria</label>
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value as AgencyTaskCategory)}
            >
              {Object.entries(agencyTaskCategoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Tempo estimado</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={hours}
                  onChange={(e) => setHours(Math.max(0, Number(e.target.value)))}
                  placeholder="h"
                />
                <span className="text-xs text-[var(--color-text-faint)]">h</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  className={inputClass}
                  value={minutes}
                  onChange={(e) => setMinutes(Math.min(59, Math.max(0, Number(e.target.value))))}
                  placeholder="min"
                />
                <span className="text-xs text-[var(--color-text-faint)]">min</span>
              </div>
            </div>

            <div>
              <label className={labelClass}>Prazo</label>
              <input
                type="date"
                className={inputClass}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-xs text-[var(--color-bad)]">{error}</p>}
        </div>

        <div className="mt-5 flex items-center justify-between">
          {task && onDelete ? (
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)] disabled:opacity-50"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Excluir
            </button>
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
