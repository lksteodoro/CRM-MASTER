import { NavLink, useLocation, useParams } from 'react-router-dom';
import {
  LayoutGrid,
  LayoutDashboard,
  Megaphone,
  Target,
  Users,
  Handshake,
  Building2,
  FolderKanban,
  LifeBuoy,
  GraduationCap,
  Settings,
  Kanban,
  Send,
  Wrench,
  WandSparkles,
  ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import { useAuth } from '../../providers/AuthProvider';
import { useProjectOptional } from '../../state/ProjectContext';
import { ProjectContextPanel } from './ProjectContextPanel';
import { agencyTools, type AgencyToolKey } from '../../services/agencyTools.service';

interface ProjectNavItem {
  path: string;
  icon: typeof LayoutGrid;
  label: string;
  children?: { path: string; label: string }[];
}

interface AdminNavItem {
  to: string;
  icon: typeof LayoutGrid;
  label: string;
  children?: { to: string; label: string; tool?: AgencyToolKey; emphasis?: boolean }[];
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

const adminNav: AdminNavItem[] = [
  { to: '/agency', icon: Building2, label: 'Central' },
  { to: '/agency/kanban', icon: Kanban, label: 'Kanban' },
  {
    to: '/agency/disparo',
    icon: Send,
    label: 'Disparos',
    children: [
      { to: '/agency/disparo/dashboard', label: 'Dashboard', tool: 'disparo.dashboard' },
      { to: '/agency/disparo/redirecionador', label: 'Redirecionador', tool: 'disparo.redirects' },
      { to: '/agency/disparo/templates', label: 'Templates Infobip', tool: 'disparo.templates' },
      { to: '/agency/disparo/transmissoes', label: 'Transmissões', tool: 'disparo.broadcasts' },
      { to: '/agency/disparo/solicitar', label: 'Solicitar disparo', tool: 'disparo.request' },
      { to: '/agency/disparo/demandas', label: 'Demandas', tool: 'disparo.demands' },
      { to: '/agency/disparo/higienizador', label: 'Higienizador de lista', tool: 'disparo.sanitizer' },
      { to: '/agency/disparo/relatorio', label: 'Relatório do fornecedor', tool: 'disparo.report' },
    ],
  },
  {
    to: '/agency/ferramentas',
    icon: Wrench,
    label: 'Ferramentas',
    children: [
      { to: '/agency/ferramentas/meta-ads', label: 'Meta Ads', tool: 'meta_ads' },
      { to: '/agency/ferramentas/meta-ads?criar=1', label: 'Abrir criador de anúncios', tool: 'meta_ads', emphasis: true },
      { to: '/agency/ferramentas/zpl-pdf', label: 'ZPL para PDF', tool: 'zpl_pdf' },
    ],
  },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60',
    isActive
      ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'
      : 'text-[#b4b7c7] hover:bg-[#202333] hover:text-white'
  );

export function Sidebar({ showProjectContext = true }: { showProjectContext?: boolean }) {
  const { isAdmin, agencyToolAccess } = useAuth();
  const { projectId } = useParams();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const projectCtx = useProjectOptional();
  const canEditSettings = isAdmin || projectCtx?.permissions.can_edit_settings;
  const clientTools = agencyTools.filter((tool) => agencyToolAccess.includes(tool.key));
  const visibleAgencyNav: AdminNavItem[] = isAdmin
    ? adminNav
    : clientTools.length > 0
      ? [{
          to: clientTools[0].path,
          icon: Wrench,
          label: 'Ferramentas',
          children: clientTools.map((tool) => ({ to: tool.path, label: tool.label, tool: tool.key })),
        }]
      : [];

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

        {(isAdmin || visibleAgencyNav.length > 0) && (
          <>
            {projectId && <div className="my-2 border-t border-[var(--color-border-soft)]" />}
            <p className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wide text-[#858b9e]">
              Agência
            </p>
            {visibleAgencyNav.map((item) => {
              const hasChildren = Boolean(item.children?.length);
              const isOpen = openGroups[item.to] ?? Boolean(
                item.children?.some((child) => location.pathname === child.to.split('?')[0])
              );
              return (
                <div key={item.to}>
                  <div className="flex items-center gap-1">
                    <NavLink
                      to={item.to}
                      className={({ isActive }) => clsx(linkClass({ isActive }), 'min-w-0 flex-1')}
                      end={!hasChildren}
                    >
                      <item.icon size={17} />
                      {item.label}
                    </NavLink>
                    {hasChildren && (
                      <button
                        type="button"
                        aria-label={isOpen ? `Recolher ${item.label}` : `Expandir ${item.label}`}
                        aria-expanded={isOpen}
                        onClick={() => setOpenGroups((current) => ({ ...current, [item.to]: !isOpen }))}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#9da3b5] transition hover:bg-[#202333] hover:text-white"
                      >
                        <ChevronDown size={15} className={clsx('transition-transform', !isOpen && '-rotate-90')} />
                      </button>
                    )}
                  </div>
                  {hasChildren && isOpen && (
                    <div className="ml-4 mt-1 space-y-0.5 border-l border-[#303345] pl-3">
                      {item.children?.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          className={({ isActive }) =>
                            clsx(
                              'flex min-h-8 items-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/60',
                              child.emphasis
                                ? 'mt-1 gap-1.5 border border-[var(--color-brand)]/35 bg-[var(--color-brand-soft)] text-[var(--color-brand)] font-medium hover:bg-[var(--color-brand-soft)]/75'
                                : isActive
                                  ? 'bg-[#202333] text-white'
                                  : 'text-[#a7acbd] hover:bg-[#202333] hover:text-white'
                            )
                          }
                        >
                          {child.emphasis && <WandSparkles size={13} />}
                          <span>{child.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>

      <div className="flex flex-col gap-1 border-t border-[var(--color-border)] pt-3">
        {isAdmin ? (
          <NavLink to="/agency/configuracoes" className={linkClass}>
            <Settings size={17} />
            Configurações
          </NavLink>
        ) : (
          <NavLink to="/projects" className={linkClass}>
            <FolderKanban size={17} />
            Meus projetos
          </NavLink>
        )}
        <button className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]">
          <LifeBuoy size={17} />
          Suporte
        </button>
      </div>
    </aside>
  );
}
