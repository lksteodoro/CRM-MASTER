import { useEffect, useState } from 'react';
import { listArchivedAgencyTasks, agencyTaskCategoryLabels } from '../../services/agencyTasks.service';
import type { AgencyTaskRow } from '../../integrations/supabase/database.types';
import { LoadingView, ErrorView } from '../ui/StateView';
import { Card } from '../ui/Card';

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function AgencyTaskArchiveList() {
  const [tasks, setTasks] = useState<AgencyTaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listArchivedAgencyTasks()
      .then((rows) => {
        if (active) setTasks(rows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Não foi possível carregar o arquivo.');
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <ErrorView message={error} />;
  if (!tasks) return <LoadingView label="Carregando arquivo..." />;

  if (tasks.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-text-faint)]">
          Nenhuma tarefa arquivada ainda — cards finalizados são arquivados automaticamente todo dia.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Arquivadas (${tasks.length})`}>
      <div className="flex flex-col divide-y divide-[var(--color-border-soft)]">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm text-[var(--color-text)]">{task.title}</p>
              <p className="text-xs text-[var(--color-text-faint)]">
                {agencyTaskCategoryLabels[task.category]}
                {task.finished_at && ` · finalizada em ${formatDateTime(task.finished_at)}`}
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">
              {task.archived_at && `arquivada ${formatDateTime(task.archived_at)}`}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
