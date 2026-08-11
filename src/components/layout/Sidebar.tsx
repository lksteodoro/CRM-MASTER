import { NavLink, useParams } from 'react-router-dom';
import {
  LayoutGrid,
  LayoutDashboard,
  Megaphone,
  Target,
  Users,
  Handshake,
  Building2,
  FolderKanban,
  ScrollText,
  LifeBuoy,
  GraduationCap,
  Settings,
  Kanban,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../providers/AuthProvider';
import { useProjectOptional } from '../../state/ProjectContext';
import { ProjectContextPanel } from './ProjectContextPanel';

interface ProjectNavItem {
  path: string;
  icon: typeof LayoutGrid;
  label: string;
  children?: { path: string; label: string }[];
}

const projectNav: ProjectNavItem[] = [
  { path: 'portfolio', icon: LayoutGrid, label: 'Visão Geral' },
  { path: 'dashboard', icon: LayoutDashboard, label: 'Métricas' },
  { path: 'campanhas', icon: Megaphone, label: 'Campanhas' },
  { path: 'anuncios', icon: Target, label: 'Anúncios' },
  { path: 'leads', icon: Users, label: 'Leads' },
  {
    path: 'comercial',
    icon: Handshake,
    label: 'Comercial',
    children: [{ path: 'comercial/ranking', label: 'Ranking' }],
  },
];

const adminNav = [
  { to: '/agency', icon: Building2, label: 'Central' },
  { to: '/agency/kanban', icon: Kanban, label: 'Kanban' },
  { to: '/admin/clients', icon: Building2, label: 'Clientes' },
  { to: '/admin/projects', icon: FolderKanban, label: 'Projetos' },
  { to: '/admin/users', icon: Users, label: 'Usuários' },
  { to: '/admin/audit', icon: ScrollText, label: 'Auditoria' },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]'
  );

export function Sidebar({ showProjectContext = true }: { showProjectContext?: boolean }) {
  const { isAdmin } = useAuth();
  const { projectId } = useParams();
  const projectCtx = useProjectOptional();
  const canEditSettings = isAdmin || projectCtx?.permissions.can_edit_settings;

  return (
    <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-panel)] p-4 lg:flex">
      <div className="mb-5 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand)]">
          <GraduationCap size={18} className="text-white" />
        </div>
        <span className="text-sm font-semibold tracking-wide text-[var(--color-text)]">
          Leads Hub
        </span>
      </div>

      {showProjectContext && projectId && <ProjectContextPanel />}

      <nav className="flex flex-1 flex-col gap-1">
        {projectId &&
          projectNav.map((item) => (
            <div key={item.path}>
              <NavLink
                to={`/project/${projectId}/${item.path}`}
                className={linkClass}
                end={Boolean(item.children)}
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
              {item.children?.map((child) => (
                <NavLink
                  key={child.path}
                  to={`/project/${projectId}/${child.path}`}
                  className={({ isActive }) =>
                    clsx(
                      'ml-7 flex items-center rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                      isActive
                        ? 'text-[var(--color-brand)]'
                        : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
                    )
                  }
                >
                  {child.label}
                </NavLink>
              ))}
            </div>
          ))}

        {projectId && canEditSettings && (
          <NavLink to={`/project/${projectId}/configuracoes`} className={linkClass}>
            <Settings size={17} />
            Configurações
          </NavLink>
        )}

        {isAdmin && (
          <>
            {projectId && <div className="my-2 border-t border-[var(--color-border-soft)]" />}
            <p className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
              Agência
            </p>
            {adminNav.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass} end>
                <item.icon size={17} />
                {item.label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      <div className="flex flex-col gap-1 border-t border-[var(--color-border)] pt-3">
        <NavLink to="/projects" className={linkClass}>
          <FolderKanban size={17} />
          Meus projetos
        </NavLink>
        <button className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]">
          <LifeBuoy size={17} />
          Suporte
        </button>
      </div>
    </aside>
  );
}
