import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Plus,
  Archive,
  ShieldAlert,
  Send,
  CalendarClock,
  CheckCircle2,
  Paperclip,
  LayoutDashboard,
  ChevronRight,
} from 'lucide-react';
import {
  listDisparoTasks,
  createDisparoTask,
  updateDisparoTask,
  deleteDisparoTask,
  moveDisparoTask,
  listDisparoTags,
  createDisparoTag,
  disparoTaskColumns,
  nextStage,
  portalDisparoBlockReason,
  type DisparoTaskStatus,
  type DisparoTaskInput,
  type DisparoTaskWithRelations,
} from '../../services/disparoTasks.service';
import { createClient, listClients } from '../../services/clients.service';
import { useAuth } from '../../providers/AuthProvider';
import type { ClientRow, DisparoTagRow } from '../../integrations/supabase/database.types';
import { DisparoTaskCard } from '../../components/disparo/DisparoTaskCard';
import { DisparoTaskModal } from '../../components/disparo/DisparoTaskModal';
import { DisparoTaskArchiveList } from '../../components/disparo/DisparoTaskArchiveList';
import { LoadingView, ErrorView } from '../../components/ui/StateView';

type ColumnMap = Record<DisparoTaskStatus, DisparoTaskWithRelations[]>;

const columnStyles: Record<
  DisparoTaskStatus,
  { accent: string; soft: string; dot: string; description: string }
> = {
  pedido: { accent: 'border-t-blue-500', soft: 'bg-blue-500/8', dot: 'bg-blue-400', description: 'Novas demandas' },
  pagamento: { accent: 'border-t-amber-500', soft: 'bg-amber-500/8', dot: 'bg-amber-400', description: 'Aguardando confirmação' },
  numero_perfil: { accent: 'border-t-violet-500', soft: 'bg-violet-500/8', dot: 'bg-violet-400', description: 'Configuração da conta' },
  template_midia: { accent: 'border-t-cyan-500', soft: 'bg-cyan-500/8', dot: 'bg-cyan-400', description: 'Mensagem e criativos' },
  lista: { accent: 'border-t-sky-500', soft: 'bg-sky-500/8', dot: 'bg-sky-400', description: 'Preparação dos contatos' },
  teste: { accent: 'border-t-fuchsia-500', soft: 'bg-fuchsia-500/8', dot: 'bg-fuchsia-400', description: 'Validação antes do envio' },
  disparo: { accent: 'border-t-orange-500', soft: 'bg-orange-500/8', dot: 'bg-orange-400', description: 'Campanhas em andamento' },
  finalizado: { accent: 'border-t-emerald-500', soft: 'bg-emerald-500/8', dot: 'bg-emerald-400', description: 'Entregas concluídas' },
};

function emptyColumns(): ColumnMap {
  const map = {} as ColumnMap;
  for (const col of disparoTaskColumns) map[col.key] = [];
  return map;
}

function groupByStatus(tasks: DisparoTaskWithRelations[]): ColumnMap {
  const map = emptyColumns();
  for (const t of tasks) map[t.status].push(t);
  return map;
}

function findContainer(id: string, columns: ColumnMap): DisparoTaskStatus | undefined {
  if (id in columns) return id as DisparoTaskStatus;
  return (Object.keys(columns) as DisparoTaskStatus[]).find((key) =>
    columns[key].some((t) => t.id === id)
  );
}

function stageIndex(status: DisparoTaskStatus): number {
  return disparoTaskColumns.findIndex((c) => c.key === status);
}

function localIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Retroceder é livre; avançar segue uma etapa por vez, sem checklist. */
function canMoveTo(from: DisparoTaskStatus, to: DisparoTaskStatus): {
  allowed: boolean;
  reason?: string;
} {
  const fromIdx = stageIndex(from);
  const toIdx = stageIndex(to);
  if (toIdx <= fromIdx) return { allowed: true };
  if (toIdx === fromIdx + 1) return { allowed: true };
  return { allowed: false, reason: 'Não dá pra pular etapas — avance uma de cada vez.' };
}

function Column({
  status,
  label,
  tasks,
  tagsById,
  clientsById,
  onAdd,
  onOpen,
}: {
  status: DisparoTaskStatus;
  label: string;
  tasks: DisparoTaskWithRelations[];
  tagsById: Map<string, DisparoTagRow>;
  clientsById: Map<string, ClientRow>;
  onAdd: () => void;
  onOpen: (task: DisparoTaskWithRelations) => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });
  const style = columnStyles[status];

  return (
    <section
      aria-label={`${label}, ${tasks.length} demandas`}
      className={`flex w-[310px] shrink-0 flex-col overflow-hidden rounded-2xl border border-t-2 border-[var(--color-border)] bg-[var(--color-panel)] ${style.accent}`}
    >
      <header className={`flex min-h-18 items-center justify-between gap-3 px-4 py-3 ${style.soft}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
            <h2 className="truncate text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text)]">
              {label}
            </h2>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-black/20 px-1.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
              {tasks.length}
            </span>
          </div>
          <p className="mt-1 truncate pl-4 text-[10px] text-[var(--color-text-muted)]">{style.description}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Adicionar demanda em ${label}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/8 bg-black/15 text-[var(--color-text-muted)] transition-colors hover:border-white/20 hover:bg-white/8 hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <Plus size={16} />
        </button>
      </header>

      <div ref={setNodeRef} className="flex min-h-[360px] flex-1 flex-col gap-2.5 p-3">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <DisparoTaskCard
              key={task.id}
              task={task}
              tagsById={tagsById}
              clientsById={clientsById}
              onClick={() => onOpen(task)}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] text-[var(--color-text-faint)] transition-colors hover:border-[var(--color-text-faint)] hover:bg-white/[0.02] hover:text-[var(--color-text-muted)]"
          >
            <Plus size={16} />
            <span className="text-[11px]">Adicionar demanda</span>
          </button>
        )}
      </div>
    </section>
  );
}

export function DisparoKanbanPage() {
  const { profile } = useAuth();
  const [columns, setColumns] = useState<ColumnMap>(emptyColumns());
  const [tags, setTags] = useState<DisparoTagRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalTask, setModalTask] = useState<DisparoTaskWithRelations | null | 'new'>(null);
  const [newTaskStatus, setNewTaskStatus] = useState<DisparoTaskStatus>('pedido');
  const [showArchive, setShowArchive] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const dragStartContainer = useRef<DisparoTaskStatus | null>(null);
  const dragStartTask = useRef<DisparoTaskWithRelations | null>(null);

  function flashDragError(message: string) {
    setDragError(message);
    setTimeout(() => setDragError((current) => (current === message ? null : current)), 4000);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const boardTasks = useMemo(() => Object.values(columns).flat(), [columns]);
  const boardStats = useMemo(() => {
    const today = localIsoDate();
    return {
      total: boardTasks.length,
      today: boardTasks.filter((task) => task.scheduled_date === today).length,
      approved: boardTasks.filter((task) => task.copy_approved).length,
      withMedia: boardTasks.filter(
        (task) => task.profile_photo_url || task.image_url || task.video_url || task.list_file_url
      ).length,
    };
  }, [boardTasks]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [tasks, tagRows, clientRows] = await Promise.all([
        listDisparoTasks(),
        listDisparoTags(),
        listClients(),
      ]);
      setColumns(groupByStatus(tasks));
      setTags(tagRows);
      setClients(clientRows);
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
    const id = String(event.active.id);
    const container = findContainer(id, columns) ?? null;
    dragStartContainer.current = container;
    dragStartTask.current = container ? (columns[container].find((t) => t.id === id) ?? null) : null;
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = findContainer(activeId, columns);
    const to = findContainer(overId, columns);
    if (!from || !to || from === to) return;

    const origin = dragStartContainer.current;
    const originTask = dragStartTask.current;
    if (origin && originTask) {
      const { allowed } = canMoveTo(origin, to);
      if (!allowed) return;
      if ((to === 'disparo' || to === 'finalizado') && portalDisparoBlockReason(originTask)) return;
    }

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
    const startTask = dragStartTask.current;
    dragStartContainer.current = null;
    dragStartTask.current = null;
    if (!over || !startContainer) return;

    const overId = String(over.id);
    const attemptedTarget = findContainer(overId, columns);
    if (attemptedTarget && startTask) {
      const { allowed, reason } = canMoveTo(startContainer, attemptedTarget);
      if (!allowed && reason) flashDragError(reason);
      const portalReason = (attemptedTarget === 'disparo' || attemptedTarget === 'finalizado')
        ? portalDisparoBlockReason(startTask)
        : null;
      if (portalReason) {
        flashDragError(portalReason);
        void load();
        return;
      }
    }

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
      await moveDisparoTask({
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

  async function handleCreate(input: DisparoTaskInput) {
    const created = await createDisparoTask(input, newTaskStatus, columns[newTaskStatus].length);
    setColumns((prev) => ({ ...prev, [newTaskStatus]: [...prev[newTaskStatus], created] }));
    return created;
  }

  async function handleUpdate(id: string, input: DisparoTaskInput) {
    const updated = await updateDisparoTask(id, input);
    setColumns((prev) => ({
      ...prev,
      [updated.status]: prev[updated.status].map((t) => (t.id === id ? updated : t)),
    }));
    return updated;
  }

  function handleSaved(row: DisparoTaskWithRelations) {
    setColumns((prev) => ({
      ...prev,
      [row.status]: prev[row.status].map((t) => (t.id === row.id ? row : t)),
    }));
  }

  /** Avança um card pra próxima etapa (chamado pelo botão "Avançar" no modal). */
  async function handleAdvance(taskToAdvance: DisparoTaskWithRelations) {
    const to = nextStage(taskToAdvance.status);
    if (!to) return null;
    const { allowed, reason } = canMoveTo(taskToAdvance.status, to);
    if (!allowed) {
      if (reason) flashDragError(reason);
      return null;
    }
    const portalReason = (to === 'disparo' || to === 'finalizado')
      ? portalDisparoBlockReason(taskToAdvance)
      : null;
    if (portalReason) {
      flashDragError(portalReason);
      return null;
    }

    const from = taskToAdvance.status;
    const sourceIds = columns[from].filter((t) => t.id !== taskToAdvance.id).map((t) => t.id);
    const targetIds = [...columns[to].map((t) => t.id), taskToAdvance.id];
    const advanced = { ...taskToAdvance, status: to };

    setColumns((prev) => ({
      ...prev,
      [from]: prev[from].filter((t) => t.id !== taskToAdvance.id),
      [to]: [...prev[to], advanced],
    }));

    try {
      await moveDisparoTask({
        targetStatus: to,
        orderedIdsInTargetColumn: targetIds,
        sourceStatus: from,
        orderedIdsInSourceColumn: sourceIds,
      });
    } catch {
      void load();
      return null;
    }
    return advanced;
  }

  async function handleDelete(id: string) {
    await deleteDisparoTask(id);
    setColumns((prev) => {
      const next = emptyColumns();
      for (const key of Object.keys(prev) as DisparoTaskStatus[]) {
        next[key] = prev[key].filter((t) => t.id !== id);
      }
      return next;
    });
    setModalTask(null);
  }

  async function handleCreateTag(name: string, color: string) {
    const tag = await createDisparoTag(name, color);
    setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  }

  async function handleCreateClient(name: string) {
    if (!profile?.organization_id) throw new Error('Organização do usuário não encontrada.');
    const client = await createClient({ organizationId: profile.organization_id, name });
    setClients((current) => [...current, client].sort((a, b) => a.name.localeCompare(b.name)));
    return client;
  }

  if (loading) return <LoadingView label="Carregando demandas de disparo..." />;
  if (error) return <ErrorView message={error} onRetry={() => void load()} />;

  return (
    <div className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
      <header className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
              <Send size={20} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-[var(--color-text)]">Demandas de disparo</h1>
                <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-good)]">
                  Infobip
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-text-muted)]">
                Acompanhe cada campanha desde o pedido até a entrega. Arraste os cards para avançar uma etapa.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowArchive((value) => !value)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-text-faint)] hover:text-[var(--color-text)]"
            >
              <Archive size={14} />
              {showArchive ? 'Voltar ao quadro' : 'Arquivados'}
            </button>
            {!showArchive && (
              <button
                type="button"
                onClick={() => {
                  setNewTaskStatus('pedido');
                  setModalTask('new');
                }}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-950/20 hover:brightness-110"
              >
                <Plus size={15} />
                Novo disparo
              </button>
            )}
          </div>
        </div>

        {!showArchive && (
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--color-border-soft)] pt-4 sm:grid-cols-4">
            {[
              { label: 'Demandas ativas', value: boardStats.total, icon: LayoutDashboard, color: 'text-[var(--color-brand)]' },
              { label: 'Agendadas hoje', value: boardStats.today, icon: CalendarClock, color: 'text-[var(--color-warn)]' },
              { label: 'Mensagem aprovada', value: boardStats.approved, icon: CheckCircle2, color: 'text-[var(--color-good)]' },
              { label: 'Com arquivos', value: boardStats.withMedia, icon: Paperclip, color: 'text-[var(--color-info)]' },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center gap-3 rounded-xl bg-[var(--color-bg)] px-3 py-2.5">
                <stat.icon size={16} className={stat.color} />
                <div>
                  <p className="text-base font-semibold leading-none text-[var(--color-text)]">{stat.value}</p>
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </header>

      {dragError && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">
          <ShieldAlert size={14} />
          {dragError}
        </div>
      )}

      {showArchive ? (
        <DisparoTaskArchiveList />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <div className="kanban-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 sm:gap-4">
            {disparoTaskColumns.map((col) => (
              <div key={col.key} className="snap-start">
                <Column
                  status={col.key}
                  label={col.label}
                  tasks={columns[col.key]}
                  tagsById={tagsById}
                  clientsById={clientsById}
                  onAdd={() => {
                    setNewTaskStatus(col.key);
                    setModalTask('new');
                  }}
                  onOpen={(task) => setModalTask(task)}
                />
              </div>
            ))}
            <div className="flex w-8 shrink-0 items-center justify-center text-[var(--color-text-faint)]" aria-hidden="true">
              <ChevronRight size={18} />
            </div>
          </div>
        </DndContext>
      )}

      {modalTask && (
        <DisparoTaskModal
          task={modalTask === 'new' ? null : modalTask}
          clients={clients}
          tags={tags}
          onCreateClient={handleCreateClient}
          onCreateTag={handleCreateTag}
          onClose={() => setModalTask(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onSaved={handleSaved}
          onAdvance={handleAdvance}
        />
      )}
    </div>
  );
}
