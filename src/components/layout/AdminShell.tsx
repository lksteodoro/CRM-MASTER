import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AdminShell() {
  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar showProjectContext={false} />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Topbar />
        <Outlet />
      </div>
    </div>
  );
}
