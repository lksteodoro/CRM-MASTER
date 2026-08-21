import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, CalendarDays } from "lucide-react";
import clsx from "clsx";
import type { AgencyTaskRow } from "../../integrations/supabase/database.types";
import { agencyTaskCategoryLabels } from "../../services/agencyTasks.service";

const cardAccents = [
  {
    dot: "bg-blue-400",
    border: "border-l-blue-400",
    hover: "hover:border-blue-400/70",
  },
  {
    dot: "bg-violet-400",
    border: "border-l-violet-400",
    hover: "hover:border-violet-400/70",
  },
  {
    dot: "bg-emerald-400",
    border: "border-l-emerald-400",
    hover: "hover:border-emerald-400/70",
  },
  {
    dot: "bg-amber-400",
    border: "border-l-amber-400",
    hover: "hover:border-amber-400/70",
  },
  {
    dot: "bg-rose-400",
    border: "border-l-rose-400",
    hover: "hover:border-rose-400/70",
  },
  {
    dot: "bg-cyan-400",
    border: "border-l-cyan-400",
    hover: "hover:border-cyan-400/70",
  },
];

function accentForTask(task: AgencyTaskRow) {
  let hash = 0;
  for (const character of task.id || task.title) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return cardAccents[hash % cardAccents.length];
}

function formatDuration(minutes: number | null): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}min`;
}

function formatDueDate(
  date: string | null,
): { label: string; overdue: boolean } | null {
  if (!date) return null;
  const due = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = due.getTime() < today.getTime();
  return {
    label: due.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    }),
    overdue,
  };
}

export function AgencyTaskCard({
  task,
  onClick,
}: {
  task: AgencyTaskRow;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
  });

  const duration = formatDuration(task.estimated_minutes);
  const due = formatDueDate(task.due_date);
  const accent = accentForTask(task);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={clsx(
        `flex cursor-grab flex-col gap-2 rounded-xl border border-l-2 border-[var(--color-border)] bg-[var(--color-panel-2)] p-3 text-left shadow-sm transition active:cursor-grabbing ${accent.border}`,
        isDragging
          ? "opacity-40"
          : `hover:-translate-y-0.5 ${accent.hover} hover:shadow-md`,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
          {agencyTaskCategoryLabels[task.category]}
        </span>
      </div>

      <p className="line-clamp-3 text-sm font-semibold leading-snug text-[var(--color-text)]">
        {task.title}
      </p>

      {task.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {task.description}
        </p>
      )}

      {(duration || due) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
          {duration && (
            <span className="flex items-center gap-1 rounded-md bg-[var(--color-panel)] px-1.5 py-1">
              <Clock size={11} />
              {duration}
            </span>
          )}
          {due && (
            <span
              className={clsx(
                "flex items-center gap-1 rounded-md bg-[var(--color-panel)] px-1.5 py-1",
                due.overdue &&
                  task.status !== "finalizado" &&
                  "bg-[var(--color-bad-soft)] font-medium text-[var(--color-bad)]",
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
