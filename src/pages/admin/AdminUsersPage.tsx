import { useEffect, useState } from 'react';
import { UserX, UserCheck } from 'lucide-react';
import { listOrganizationUsers, setUserStatus } from '../../services/users.service';
import type { ProfileRow } from '../../integrations/supabase/database.types';
import { LoadingView, ErrorView, EmptyView } from '../../components/ui/StateView';
import { Card } from '../../components/ui/Card';

const statusStyle: Record<ProfileRow['status'], { label: string; className: string }> = {
  ACTIVE: { label: 'Ativo', className: 'bg-[var(--color-good-soft)] text-[var(--color-good)]' },
  INVITED: { label: 'Convidado', className: 'bg-[var(--color-info-soft)] text-[var(--color-info)]' },
  DISABLED: { label: 'Desativado', className: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]' },
};

export function AdminUsersPage() {
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listOrganizationUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar os usuários.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleStatus(user: ProfileRow) {
    await setUserStatus(user.id, user.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED');
    void load();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Usuários</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Todos os usuários da organização. Novos usuários são convidados pela página do cliente.
        </p>
      </div>

      {loading && <LoadingView />}
      {!loading && error && <ErrorView message={error} onRetry={() => void load()} />}
      {!loading && !error && users.length === 0 && <EmptyView title="Nenhum usuário cadastrado." />}

      {!loading && !error && users.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                <th className="pb-3">Usuário</th>
                <th className="pb-3">E-mail</th>
                <th className="pb-3">Papel</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--color-border-soft)]">
                  <td className="py-3 text-[var(--color-text)]">{u.name}</td>
                  <td className="py-3 text-[var(--color-text-muted)]">{u.email}</td>
                  <td className="py-3">
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-[10px] ' +
                        (u.role === 'ADMIN'
                          ? 'bg-[var(--color-violet-soft)] text-[var(--color-violet)]'
                          : 'bg-[var(--color-panel-2)] text-[var(--color-text-muted)]')
                      }
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3">
                    <span
                      className={'rounded-full px-2 py-0.5 text-[10px] ' + statusStyle[u.status].className}
                    >
                      {statusStyle[u.status].label}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => void toggleStatus(u)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
                    >
                      {u.status === 'DISABLED' ? (
                        <>
                          <UserCheck size={12} /> Reativar
                        </>
                      ) : (
                        <>
                          <UserX size={12} /> Desativar
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
