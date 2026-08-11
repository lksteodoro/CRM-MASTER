import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ChevronDown, Settings2, ArrowLeftRight, Building } from 'lucide-react';
import { useProject } from '../../state/ProjectContext';
import { useProjectPath } from '../../hooks/useProjectPath';
import { listProjects } from '../../services/projects.service';
import { getClient } from '../../services/clients.service';
import type { ProjectRow } from '../../integrations/supabase/database.types';

/**
 * Contexto do workspace (cliente + projeto ativo) no topo da sidebar.
 * Lista apenas projetos que o usuário pode ver — o filtro é do RLS.
 */
export function ProjectContextPanel() {
  const { project, permissions } = useProject();
  const projectPath = useProjectPath();
  const [open, setOpen] = useState(false);
  const [siblings, setSiblings] = useState<ProjectRow[]>([]);
  const [clientName, setClientName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [list, client] = await Promise.all([
          listProjects({ clientId: project.client_id }),
          getClient(project.client_id),
        ]);
        if (!active) return;
        setSiblings(list);
        setClientName(client?.name ?? '');
      } catch {
        // Silencioso: o painel continua utilizável mostrando só o projeto atual.
      }
    })();
    return () => {
      active = false;
    };
  }, [project.client_id]);

  return (
    <div className="mb-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3">
      <div className="mb-2 flex items-start gap-2">
        <Building size={13} className="mt-0.5 shrink-0 text-[var(--color-text-faint)]" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Cliente</p>
          <p className="truncate text-sm font-semibold text-[var(--color-text)]" title={clientName}>
            {clientName || '—'}
          </p>
        </div>
      </div>

      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-2 text-left text-sm hover:border-[var(--color-brand)]"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Projeto</p>
            <p className="truncate font-medium text-[var(--color-text)]">{project.name}</p>
          </div>
          <ChevronDown size={14} className="shrink-0 text-[var(--color-text-muted)]" />
        </button>

        {open && (
          <div className="absolute left-0 right-0 z-30 mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-1.5 shadow-xl">
            {siblings.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setOpen(false);
                  navigate(`/project/${p.id}/dashboard`);
                }}
                className={
                  'block w-full truncate rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--color-panel-2)] ' +
                  (p.id === project.id ? 'text-[var(--color-brand)]' : 'text-[var(--color-text)]')
                }
              >
                {p.name}
              </button>
            ))}
            {siblings.length === 0 && (
              <p className="px-2.5 py-2 text-xs text-[var(--color-text-faint)]">
                Nenhum outro projeto disponível.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-1.5">
        {permissions.can_edit_settings && (
          <Link
            to={projectPath('configuracoes')}
            title="Configurar projeto"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
          >
            <Settings2 size={12} />
            Configurar
          </Link>
        )}
        <button
          onClick={() => navigate('/projects')}
          title="Trocar projeto"
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
        >
          <ArrowLeftRight size={12} />
          Trocar
        </button>
      </div>
    </div>
  );
}
