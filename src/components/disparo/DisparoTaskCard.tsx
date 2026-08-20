import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarClock,
  CheckCircle2,
  FileSpreadsheet,
  Image as ImageIcon,
  UserRound,
  Video,
  Copy,
  Check,
  Building2,
  GripVertical,
} from 'lucide-react';
import clsx from 'clsx';
import type { DisparoTaskWithRelations } from '../../services/disparoTasks.service';
import type { DisparoTagRow } from '../../integrations/supabase/database.types';
import type { ClientRow } from '../../integrations/supabase/database.types';

function formatScheduled(date: string | null, time: string | null): string | null {
  if (!date && !time) return null;
  const datePart = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : null;
  const timePart = time ? time.slice(0, 5) : null;
  return [datePart, timePart].filter(Boolean).join(' ');
}

export function DisparoTaskCard({
  task,
  tagsById,
  clientsById,
  onClick,
}: {
  task: DisparoTaskWithRelations;
  tagsById: Map<string, DisparoTagRow>;
  clientsById: Map<string, ClientRow>;
  onClick: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const scheduled = formatScheduled(task.scheduled_date, task.scheduled_time);
  const testNumber = task.disparo_task_numbers.find((n) => n.is_test);
  const client = task.client_id ? clientsById.get(task.client_id) : null;
  const tags = task.disparo_task_tags
    .map((t) => tagsById.get(t.tag_id))
    .filter((t): t is DisparoTagRow => Boolean(t));
  const mediaCount = [task.profile_photo_url, task.image_url, task.video_url, task.list_file_url].filter(Boolean).length;

  async function copyTestNumber(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!testNumber?.number) return;
    await navigator.clipboard.writeText(testNumber.number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={clsx(
        'group relative flex cursor-grab flex-col gap-2.5 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3.5 text-left shadow-sm transition-all active:cursor-grabbing',
        isDragging
          ? 'scale-[0.98] opacity-40'
          : 'hover:-translate-y-0.5 hover:border-[var(--color-text-faint)] hover:shadow-lg hover:shadow-black/20'
      )}
    >
      <div className="absolute inset-y-0 left-0 w-0.5 bg-[var(--color-brand)] opacity-0 transition-opacity group-hover:opacity-100" />

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 rounded-full bg-[var(--color-panel)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tag.color }} />
              {tag.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{task.title}</p>
          {client && (
            <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-[var(--color-text-muted)]">
              <Building2 size={11} className="shrink-0" />
              {client.name}
            </p>
          )}
        </div>
        <GripVertical size={15} className="mt-0.5 shrink-0 text-[var(--color-text-faint)] opacity-40 group-hover:opacity-100" />
      </div>

      {task.request_source === 'client_portal' && (
        <div className={`rounded-lg px-2.5 py-2 text-[10px] ${task.client_portal_status === 'action_required' ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' : 'bg-sky-500/10 text-sky-300'}`}>
          <span className="font-semibold">Portal do cliente</span> · {task.list_valid_count.toLocaleString('pt-BR')} válidos
          {task.list_valid_count < 1000 && ' · mínimo 1.000'}
          {task.client_portal_status === 'action_required' && ' · pendência enviada'}
        </div>
      )}

      {(task.profile_photo_url || task.image_url) && (
        <div className="flex items-center gap-2.5 rounded-lg bg-[var(--color-panel)] p-2">
          <img
            src={task.profile_photo_url ?? task.image_url ?? ''}
            alt="Prévia da mídia"
            className="h-11 w-11 shrink-0 rounded-lg border border-[var(--color-border-soft)] object-cover"
          />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-[var(--color-text-muted)]">
              {task.profile_photo_url && task.image_url ? 'Perfil + criativo' : 'Mídia anexada'}
            </p>
            <p className="mt-0.5 text-[9px] text-[var(--color-text-faint)]">
              {mediaCount} {mediaCount === 1 ? 'arquivo disponível' : 'arquivos disponíveis'}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-[var(--color-border-soft)] pt-2.5 text-[10px] text-[var(--color-text-muted)]">
        {scheduled && (
          <span className="flex items-center gap-1">
            <CalendarClock size={11} />
            {scheduled}
          </span>
        )}
        {task.image_url && <ImageIcon size={12} aria-label="Imagem anexada" />}
        {task.video_url && <Video size={12} aria-label="Vídeo anexado" />}
        {task.profile_photo_url && <UserRound size={12} aria-label="Foto de perfil anexada" />}
        {(task.list_file_url || task.source_list_path) && <FileSpreadsheet size={12} aria-label="Lista anexada" />}
        {task.copy_approved && (
          <span className="flex items-center gap-1 text-[var(--color-good)]">
            <CheckCircle2 size={11} />
            Mensagem aprovada
          </span>
        )}
      </div>

      {testNumber && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-bg)] px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">Número de teste</p>
            <p className="mt-0.5 truncate font-mono text-[10px] font-medium text-[var(--color-text-muted)]">
              {testNumber.number}{testNumber.name ? ` · ${testNumber.name}` : ''}
            </p>
          </div>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => void copyTestNumber(event)}
            aria-label="Copiar número de teste"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-faint)] hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          >
            {copied ? <Check size={13} className="text-[var(--color-good)]" /> : <Copy size={13} />}
          </button>
        </div>
      )}
    </div>
  );
}
