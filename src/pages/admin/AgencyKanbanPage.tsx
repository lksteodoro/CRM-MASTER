import { useEffect, useRef, useState } from 'react';
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
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Archive } from 'lucide-react';
import {
  listAgencyTasks,
  createAgencyTask,
  updateAgencyTask,
  deleteAgencyTask,
  moveAgencyTask,
  agencyTaskColumns,
  type AgencyTaskStatus,
  type AgencyTaskInput,
} from '../../services/agencyTasks.service';
import type { AgencyTaskRow } from '../../integrations/supabase/database.types';
import { AgencyTaskCard } from '../../components/agency/AgencyTaskCard';
import { AgencyTaskModal } from '../../components/agency/AgencyTaskModal';
import { AgencyTaskArchiveList } from '../../components/agency/AgencyTaskArchiveList';
import { LoadingView, ErrorView } from '../../components/ui/StateView';

type ColumnMap = Record<AgencyTaskStatus, AgencyTaskRow[]>;

function emptyColumns(): ColumnMap {
  return { backlog: [], a_fazer: [], fazendo: [], finalizado: [] };
}

function groupByStatus(tasks: AgencyTaskRow[]): ColumnMap {
  const map = emptyColumns();
  for (const t of tasks) map[t.status].push(t);
  return map;
}

function findContainer(id: string, columns: ColumnMap): AgencyTaskStatus | undefined {
  if (id in columns) return id as AgencyTaskStatus;
  return (Object.keys(columns) as AgencyTaskStatus[]).find((key) =>
    columns[key].some((t) => t.id === id)
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

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {label}
          </p>
          <span className="rounded-full bg-[var(--color-panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-faint)]">
            {tasks.length}
          </span>
        </div>
        <button onClick={onAdd} className="text-[var(--color-text-faint)] hover:text-[var(--color-brand)]">
          <Plus size={16} />
        </button>
      </div>

      <div ref={setNodeRef} className="flex min-h-[60px] flex-col gap-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <AgencyTaskCard key={task.id} task={task} onClick={() => onOpen(task)} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

export function AgencyKanbanPage() {
  const [columns, setColumns] = useState<ColumnMap>(emptyColumns());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalTask, setModalTask] = useState<AgencyTaskRow | null | 'new'>(null);
  const [newTaskStatus, setNewTaskStatus] = useState<AgencyTaskStatus>('backlog');
  const [showArchive, setShowArchive] = useState(false);
  const dragStartContainer = useRef<AgencyTaskStatus | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const tasks = await listAgencyTasks();
      setColumns(groupByStatus(tasks));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o quadro.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function handleDragStart(event: DragStartEvent) {
    dragStartContainer.current = findContainer(String(event.active.id), columns) ?? null;
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
        finalColumns = { ...columns, [currentContainer]: arrayMove(items, oldIndex, newIndex) };
        setColumns(finalColumns);
      }
    }

    if (startContainer === currentContainer && finalColumns === columns) return;

    try {
      await moveAgencyTask({
        targetStatus: currentContainer,
        orderedIdsInTargetColumn: finalColumns[currentContainer].map((t) => t.id),
        sourceStatus: startContainer !== currentContainer ? startContainer : undefined,
        orderedIdsInSourceColumn:
          startContainer !== currentContainer ? finalColumns[startContainer].map((t) => t.id) : undefined,
      });
    } catch {
      void load();
    }
  }

  async function handleSaveNew(input: AgencyTaskInput) {
    const created = await createAgencyTask(input, newTaskStatus, columns[newTaskStatus].length);
    setColumns((prev) => ({ ...prev, [newTaskStatus]: [...prev[newTaskStatus], created] }));
    setModalTask(null);
  }

  async function handleSaveEdit(id: string, input: AgencyTaskInput) {
    const updated = await updateAgencyTask(id, input);
    setColumns((prev) => ({
      ...prev,
      [updated.status]: prev[updated.status].map((t) => (t.id === id ? updated : t)),
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
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Kanban da Agência</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Uso interno — demandas de marketing e disparo em massa. Cards finalizados são arquivados
            automaticamente todo dia, esvaziando essa coluna.
          </p>
        </div>
        <button
          onClick={() => setShowArchive((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <Archive size={14} />
          {showArchive ? 'Voltar ao quadro' : 'Ver arquivados'}
        </button>
      </div>

      {showArchive ? (
        <AgencyTaskArchiveList />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <div className="flex gap-4 overflow-x-auto pb-2">
            {agencyTaskColumns.map((col) => (
              <Column
                key={col.key}
                status={col.key}
                label={col.label}
                tasks={columns[col.key]}
                onAdd={() => {
                  setNewTaskStatus(col.key);
                  setModalTask('new');
                }}
                onOpen={(task) => setModalTask(task)}
              />
            ))}
          </div>
        </DndContext>
      )}

      {modalTask === 'new' && (
        <AgencyTaskModal task={null} onClose={() => setModalTask(null)} onSave={handleSaveNew} />
      )}
      {modalTask && modalTask !== 'new' && (
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
