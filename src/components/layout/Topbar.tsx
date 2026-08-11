import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { useProjectOptional } from '../../state/ProjectContext';
import { DateRangePicker } from './DateRangePicker';

export function Topbar() {
  const { profile, isAdmin, signOut } = useAuth();
  const projectCtx = useProjectOptional();

  const initials = (profile?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-6 py-4">
      <div className="min-w-0">
        {projectCtx ? (
          <>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-faint)]">Projeto</p>
            <p className="truncate text-sm font-semibold text-[var(--color-text)]">
              {projectCtx.project.name}
            </p>
          </>
        ) : (
          <p className="text-sm font-semibold text-[var(--color-text)]">Leads Hub</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {projectCtx && <DateRangePicker />}
        <button className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <Bell size={16} />
        </button>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white">
            {initials}
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-xs font-medium text-[var(--color-text)]">{profile?.name}</p>
            <p className="text-[10px] text-[var(--color-text-faint)]">
              {isAdmin ? 'Administrador' : 'Cliente'}
            </p>
          </div>
        </div>
        <button
          onClick={() => void signOut()}
          title="Sair"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] p-2 text-[var(--color-text-muted)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
