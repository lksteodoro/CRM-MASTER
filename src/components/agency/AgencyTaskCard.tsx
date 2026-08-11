import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, CalendarDays } from 'lucide-react';
import clsx from 'clsx';
import type { AgencyTaskRow } from '../../integrations/supabase/database.types';
import { agencyTaskCategoryLabels } from '../../services/agencyTasks.service';

const categoryDot: Record<AgencyTaskRow['category'], string> = {
  marketing: 'var(--color-brand)',
  disparo_massa: 'var(--color-violet)',
  outro: 'var(--color-text-faint)',
};

function formatDuration(minutes: number | null): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}min`;
}

function formatDueDate(date: string | null): { label: string; overdue: boolean } | null {
  if (!date) return null;
  const due = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = due.getTime() < today.getTime();
  return { label: due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), overdue };
}

export function AgencyTaskCard({
  task,
  onClick,
}: {
  task: AgencyTaskRow;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const duration = formatDuration(task.estimated_minutes);
  const due = formatDueDate(task.due_date);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={clsx(
        'flex cursor-grab flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3 text-left transition-shadow active:cursor-grabbing',
        isDragging ? 'opacity-40' : 'hover:border-[var(--color-brand)]'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: categoryDot[task.category] }}
        />
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
          {agencyTaskCategoryLabels[task.category]}
        </span>
      </div>

      <p className="text-sm font-medium text-[var(--color-text)]">{task.title}</p>

      {(duration || due) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
          {duration && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {duration}
            </span>
          )}
          {due && (
            <span
              className={clsx(
                'flex items-center gap-1',
                due.overdue && task.status !== 'finalizado' && 'font-medium text-[var(--color-bad)]'
              )}
            >
              <CalendarDays size={11} />
              {due.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
