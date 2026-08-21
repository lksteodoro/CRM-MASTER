import { useEffect, useState } from 'react';
import { Check, Loader2, ShieldCheck, SlidersHorizontal, UserCheck, UserX, X } from 'lucide-react';
import { listOrganizationUsers, setUserStatus } from '../../services/users.service';
import type { ProfileRow } from '../../integrations/supabase/database.types';
import { LoadingView, ErrorView, EmptyView } from '../../components/ui/StateView';
import { Card } from '../../components/ui/Card';
import {
  agencyToolGroups,
  listOrganizationAgencyToolPermissions,
  setUserAgencyToolPermissions,
  type AgencyToolKey,
} from '../../services/agencyTools.service';

const statusStyle: Record<ProfileRow['status'], { label: string; className: string }> = {
  ACTIVE: { label: 'Ativo', className: 'bg-[var(--color-good-soft)] text-[var(--color-good)]' },
  INVITED: { label: 'Convidado', className: 'bg-[var(--color-info-soft)] text-[var(--color-info)]' },
  DISABLED: { label: 'Desativado', className: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]' },
};

export function AdminUsersPage() {
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toolPermissions, setToolPermissions] = useState<Record<string, AgencyToolKey[]>>({});
  const [editingAccess, setEditingAccess] = useState<ProfileRow | null>(null);
  const [savingAccess, setSavingAccess] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [userRows, accessRows] = await Promise.all([
        listOrganizationUsers(),
        listOrganizationAgencyToolPermissions(),
      ]);
      setUsers(userRows);
      setToolPermissions(accessRows);
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

  async function saveToolAccess(tools: AgencyToolKey[]) {
    if (!editingAccess) return;
    setSavingAccess(true);
    try {
      await setUserAgencyToolPermissions(editingAccess.id, tools);
      setToolPermissions((current) => ({ ...current, [editingAccess.id]: tools }));
      setEditingAccess(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar os acessos.');
    } finally {
      setSavingAccess(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Usuários</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Ative usuários e escolha exatamente quais ferramentas da agência cada pessoa pode abrir.
        </p>
      </div>

      {loading && <LoadingView />}
      {!loading && error && <ErrorView message={error} onRetry={() => void load()} />}
      {!loading && !error && users.length === 0 && <EmptyView title="Nenhum usuário cadastrado." />}

      {!loading && !error && users.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                <th className="pb-3">Usuário</th>
                <th className="pb-3">E-mail</th>
                <th className="pb-3">Papel</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Ferramentas liberadas</th>
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
                    {u.role === 'ADMIN' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300"><ShieldCheck size={13} /> Acesso total</span>
                    ) : (
                      <button
                        type="button"
                        disabled={u.status === 'DISABLED'}
                        onClick={() => setEditingAccess(u)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <SlidersHorizontal size={12} />
                        {toolPermissions[u.id]?.length ?? 0} liberada(s)
                      </button>
                    )}
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

      {editingAccess && (
        <ToolAccessModal
          user={editingAccess}
          initialTools={toolPermissions[editingAccess.id] ?? []}
          saving={savingAccess}
          onClose={() => !savingAccess && setEditingAccess(null)}
          onSave={saveToolAccess}
        />
      )}
    </div>
  );
}

function ToolAccessModal({
  user,
  initialTools,
  saving,
  onClose,
  onSave,
}: {
  user: ProfileRow;
  initialTools: AgencyToolKey[];
  saving: boolean;
  onClose: () => void;
  onSave: (tools: AgencyToolKey[]) => void;
}) {
  const [selected, setSelected] = useState<AgencyToolKey[]>(initialTools);
  const selectedSet = new Set(selected);

  function toggle(key: AgencyToolKey) {
    setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="tool-access-title">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-brand)]">Usuário e acessos</p>
            <h2 id="tool-access-title" className="mt-1 text-lg font-semibold text-[var(--color-text)]">Ferramentas de {user.name}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Marque somente o que esta pessoa poderá visualizar no menu Ferramentas.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"><X size={18} /></button>
        </header>

        <div className="space-y-5 px-6 py-5">
          {agencyToolGroups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{group.label}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.tools.map((tool) => {
                  const active = selectedSet.has(tool.key);
                  return (
                    <button
                      key={tool.key}
                      type="button"
                      onClick={() => toggle(tool.key)}
                      className={`flex items-center justify-between rounded-xl border px-3.5 py-3 text-left text-sm transition ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-text)]' : 'border-[var(--color-border)] bg-[var(--color-panel-2)] text-[var(--color-text-muted)] hover:border-[var(--color-brand)]/60'}`}
                    >
                      <span>{tool.label}</span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${active ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white' : 'border-[var(--color-border)]'}`}>{active && <Check size={13} />}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-6 py-4">
          <p className="text-xs text-[var(--color-text-muted)]">{selected.length} ferramenta(s) liberada(s).</p>
          <div className="flex gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancelar</button><button type="button" onClick={() => onSave(selected)} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />} Salvar acessos</button></div>
        </footer>
      </div>
    </div>
  );
}
