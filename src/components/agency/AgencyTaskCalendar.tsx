import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import type { AgencyTaskRow } from "../../integrations/supabase/database.types";

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const accents: Record<AgencyTaskRow["status"], string> = {
  backlog: "bg-slate-400",
  a_fazer: "bg-sky-400",
  fazendo: "bg-amber-400",
  finalizado: "bg-emerald-400",
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AgencyTaskCalendar({
  tasks,
  onOpen,
}: {
  tasks: AgencyTaskRow[];
  onOpen: (task: AgencyTaskRow) => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const tasksByDate = useMemo(() => {
    const map = new Map<string, AgencyTaskRow[]>();
    for (const task of tasks) {
      if (!task.due_date) continue;
      map.set(task.due_date, [...(map.get(task.due_date) ?? []), task]);
    }
    return map;
  }, [tasks]);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array.from(
    { length: firstWeekday + daysInMonth },
    (_, index) =>
      index < firstWeekday
        ? null
        : new Date(year, monthIndex, index - firstWeekday + 1),
  );
  const today = dateKey(new Date());

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 shadow-sm sm:p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
            <CalendarDays size={17} />
          </span>
          <div>
            <h2 className="font-semibold text-[var(--color-text)]">
              Calendário de prazos
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Clique em uma tarefa para abrir os detalhes.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}
            className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel-2)]"
          >
            <ChevronLeft size={15} />
          </button>
          <p className="min-w-32 text-center text-sm font-semibold capitalize text-[var(--color-text)]">
            {month.toLocaleDateString("pt-BR", {
              month: "long",
              year: "numeric",
            })}
          </p>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}
            className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel-2)]"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-[var(--color-border)]">
        {weekdays.map((day) => (
          <div
            key={day}
            className="border-b border-r border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]"
          >
            {day}
          </div>
        ))}
        {cells.map((date, index) => {
          if (!date)
            return (
              <div
                key={`blank-${index}`}
                className="min-h-28 border-b border-r border-[var(--color-border)] bg-[var(--color-panel-2)]/35"
              />
            );
          const key = dateKey(date);
          const dayTasks = tasksByDate.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-28 border-b border-r border-[var(--color-border)] p-2 ${key === today ? "bg-[var(--color-brand-soft)]/30" : ""}`}
            >
              <span
                className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs ${key === today ? "bg-[var(--color-brand)] text-white" : "text-[var(--color-text-muted)]"}`}
              >
                {date.getDate()}
              </span>
              <div className="flex flex-col gap-1">
                {dayTasks.slice(0, 3).map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    title={task.title}
                    onClick={() => onOpen(task)}
                    className="flex items-center gap-1 truncate rounded-md bg-[var(--color-panel-2)] px-1.5 py-1 text-left text-[10px] text-[var(--color-text)] transition hover:bg-[var(--color-brand-soft)]"
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${accents[task.status]}`}
                    />
                    <span className="truncate">{task.title}</span>
                  </button>
                ))}
                {dayTasks.length > 3 && (
                  <span className="px-1 text-[10px] text-[var(--color-text-faint)]">
                    +{dayTasks.length - 3} tarefas
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
