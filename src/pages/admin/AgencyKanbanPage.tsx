import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Archive, ClipboardList, CalendarDays } from "lucide-react";
import {
  listAgencyTasks,
  createAgencyTask,
  updateAgencyTask,
  deleteAgencyTask,
  moveAgencyTask,
  agencyTaskColumns,
  type AgencyTaskStatus,
  type AgencyTaskInput,
} from "../../services/agencyTasks.service";
import type { AgencyTaskRow } from "../../integrations/supabase/database.types";
import { AgencyTaskCard } from "../../components/agency/AgencyTaskCard";
import { AgencyTaskModal } from "../../components/agency/AgencyTaskModal";
import { AgencyTaskArchiveList } from "../../components/agency/AgencyTaskArchiveList";
import { AgencyTaskCalendar } from "../../components/agency/AgencyTaskCalendar";
import { LoadingView, ErrorView } from "../../components/ui/StateView";

type ColumnMap = Record<AgencyTaskStatus, AgencyTaskRow[]>;

function emptyColumns(): ColumnMap {
  return { backlog: [], a_fazer: [], fazendo: [], finalizado: [] };
}

function groupByStatus(tasks: AgencyTaskRow[]): ColumnMap {
  const map = emptyColumns();
  for (const t of tasks) map[t.status].push(t);
  return map;
}

function findContainer(
  id: string,
  columns: ColumnMap,
): AgencyTaskStatus | undefined {
  if (id in columns) return id as AgencyTaskStatus;
  return (Object.keys(columns) as AgencyTaskStatus[]).find((key) =>
    columns[key].some((t) => t.id === id),
  );
}

function Column({
  status,
  label,
  tasks,
  onAdd,
  onOpen,
}: {
  status: AgencyTaskStatus;
  label: string;
  tasks: AgencyTaskRow[];
  onAdd: () => void;
  onOpen: (task: AgencyTaskRow) => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });
  const tone: Record<AgencyTaskStatus, string> = {
    backlog: "bg-slate-400",
    a_fazer: "bg-sky-400",
    fazendo: "bg-amber-400",
    finalizado: "bg-emerald-400",
  };
  const surface: Record<AgencyTaskStatus, string> = {
    backlog: "border-slate-400/25 bg-slate-400/[0.035]",
    a_fazer: "border-sky-400/25 bg-sky-400/[0.035]",
    fazendo: "border-amber-400/25 bg-amber-400/[0.035]",
    finalizado: "border-emerald-400/25 bg-emerald-400/[0.035]",
  };

  return (
    <div
      className={`flex min-h-[210px] flex-col rounded-2xl border bg-[var(--color-panel)] p-3.5 shadow-sm ${surface[status]}`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full shadow-[0_0_12px_currentColor] ${tone[status]}`}
          />
          <p className="text-sm font-semibold text-[var(--color-text)]">
            {label}
          </p>
          <span className="rounded-full bg-[var(--color-panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-faint)]">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={onAdd}
          aria-label={`Adicionar em ${label}`}
          className="rounded-md p-1 text-[var(--color-text-faint)] transition hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
        >
          <Plus size={16} />
        </button>
      </div>

      <div ref={setNodeRef} className="flex min-h-[112px] flex-col gap-2">
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <AgencyTaskCard
              key={task.id}
              task={task}
              onClick={() => onOpen(task)}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-12 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-faint)] transition hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]/30 hover:text-[var(--color-brand)]"
          >
            + Adicionar tarefa
          </button>
        )}
      </div>
    </div>
  );
}

export function AgencyKanbanPage() {
  const [columns, setColumns] = useState<ColumnMap>(emptyColumns());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalTask, setModalTask] = useState<AgencyTaskRow | null | "new">(
    null,
  );
  const [newTaskStatus, setNewTaskStatus] =
    useState<AgencyTaskStatus>("backlog");
  const [showArchive, setShowArchive] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const dragStartContainer = useRef<AgencyTaskStatus | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const tasks = await listAgencyTasks();
      setColumns(groupByStatus(tasks));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível carregar o quadro.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function handleDragStart(event: DragStartEvent) {
    dragStartContainer.current =
      findContainer(String(event.active.id), columns) ?? null;
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = findContainer(activeId, columns);
    const to = findContainer(overId, columns);
    if (!from || !to || from === to) return;

    setColumns((prev) => {
      const activeItems = prev[from];
      const overItems = prev[to];
      const activeIndex = activeItems.findIndex((t) => t.id === activeId);
      if (activeIndex === -1) return prev;
      const overIndex = overItems.findIndex((t) => t.id === overId);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;

      const moved = { ...activeItems[activeIndex], status: to };
      const nextActive = activeItems.filter((t) => t.id !== activeId);
      const nextOver = [...overItems];
      nextOver.splice(insertAt, 0, moved);

      return { ...prev, [from]: nextActive, [to]: nextOver };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeId = String(active.id);
    const startContainer = dragStartContainer.current;
    dragStartContainer.current = null;
    if (!over || !startContainer) return;

    const overId = String(over.id);
    const currentContainer = findContainer(activeId, columns);
    if (!currentContainer) return;

    let finalColumns = columns;

    const overContainer = findContainer(overId, columns);
    if (overContainer === currentContainer) {
      const items = columns[currentContainer];
      const oldIndex = items.findIndex((t) => t.id === activeId);
      const newIndex = items.findIndex((t) => t.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalColumns = {
          ...columns,
          [currentContainer]: arrayMove(items, oldIndex, newIndex),
        };
        setColumns(finalColumns);
      }
    }

    if (startContainer === currentContainer && finalColumns === columns) return;

    try {
      await moveAgencyTask({
        targetStatus: currentContainer,
        orderedIdsInTargetColumn: finalColumns[currentContainer].map(
          (t) => t.id,
        ),
        sourceStatus:
          startContainer !== currentContainer ? startContainer : undefined,
        orderedIdsInSourceColumn:
          startContainer !== currentContainer
            ? finalColumns[startContainer].map((t) => t.id)
            : undefined,
        movedTaskId: activeId,
        previousStatus: startContainer,
      });
    } catch {
      void load();
    }
  }

  async function handleSaveNew(input: AgencyTaskInput) {
    const created = await createAgencyTask(
      input,
      newTaskStatus,
      columns[newTaskStatus].length,
    );
    setColumns((prev) => ({
      ...prev,
      [newTaskStatus]: [...prev[newTaskStatus], created],
    }));
    setModalTask(null);
  }

  async function handleSaveEdit(id: string, input: AgencyTaskInput) {
    const updated = await updateAgencyTask(id, input);
    setColumns((prev) => ({
      ...prev,
      [updated.status]: prev[updated.status].map((t) =>
        t.id === id ? updated : t,
      ),
    }));
    setModalTask(null);
  }

  async function handleDelete(id: string) {
    await deleteAgencyTask(id);
    setColumns((prev) => {
      const next = emptyColumns();
      for (const key of Object.keys(prev) as AgencyTaskStatus[]) {
        next[key] = prev[key].filter((t) => t.id !== id);
      }
      return next;
    });
    setModalTask(null);
  }

  if (loading) return <LoadingView label="Carregando o quadro..." />;
  if (error) return <ErrorView message={error} onRetry={() => void load()} />;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]/55 p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] text-[var(--color-brand)] shadow-lg shadow-[var(--color-brand)]/10">
            <ClipboardList size={20} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">
                Demandas
              </h1>
              <span className="rounded-md border border-[var(--color-brand)]/25 bg-[var(--color-brand-soft)] px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-[var(--color-brand)]">
                AGÊNCIA
              </span>
            </div>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Organize as atividades internas por etapa.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowArchive((v) => !v);
              setShowCalendar(false);
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3.5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          >
            <Archive size={14} />
            {showArchive ? "Voltar ao quadro" : "Histórico"}
          </button>
          {!showArchive && (
            <button
              type="button"
              onClick={() => setShowCalendar((value) => !value)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3.5 py-2.5 text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            >
              <CalendarDays size={14} />
              {showCalendar ? "Quadro" : "Calendário"}
            </button>
          )}
          {!showArchive && (
            <button
              onClick={() => {
                setNewTaskStatus("backlog");
                setModalTask("new");
              }}
              className="flex items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--color-brand)]/20 transition hover:-translate-y-0.5 hover:opacity-90"
            >
              <Plus size={16} /> Nova tarefa
            </button>
          )}
        </div>
      </div>

      {showArchive ? (
        <AgencyTaskArchiveList />
      ) : showCalendar ? (
        <AgencyTaskCalendar
          tasks={Object.values(columns).flat()}
          onOpen={(task) => setModalTask(task)}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {agencyTaskColumns.map((col) => (
              <Column
                key={col.key}
                status={col.key}
                label={col.label}
                tasks={columns[col.key]}
                onAdd={() => {
                  setNewTaskStatus(col.key);
                  setModalTask("new");
                }}
                onOpen={(task) => setModalTask(task)}
              />
            ))}
          </div>
        </DndContext>
      )}

      {modalTask === "new" && (
        <AgencyTaskModal
          task={null}
          onClose={() => setModalTask(null)}
          onSave={handleSaveNew}
        />
      )}
      {modalTask && modalTask !== "new" && (
        <AgencyTaskModal
          task={modalTask}
          onClose={() => setModalTask(null)}
          onSave={(input) => handleSaveEdit(modalTask.id, input)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
