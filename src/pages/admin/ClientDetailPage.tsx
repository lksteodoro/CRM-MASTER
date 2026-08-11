import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Plus, UserPlus, ArrowRight, ShieldCheck, Archive } from 'lucide-react';
import { getClient } from '../../services/clients.service';
import { listProjects, archiveProject } from '../../services/projects.service';
import { listClientUsers, inviteUser, listUserProjectAccess } from '../../services/users.service';
import { useAuth } from '../../providers/AuthProvider';
import type { ClientRow, ProfileRow, ProjectRow } from '../../integrations/supabase/database.types';
import { LoadingView, ErrorView, EmptyView } from '../../components/ui/StateView';
import { Card } from '../../components/ui/Card';
import { NewProjectWizard } from './NewProjectWizard';
import { UserAccessModal } from './UserAccessModal';

export function ClientDetailPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [client, setClient] = useState<ClientRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [accessCount, setAccessCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creatingProject, setCreatingProject] = useState(false);
  const [invitingUser, setInvitingUser] = useState(false);
  const [editingUser, setEditingUser] = useState<ProfileRow | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, p, u] = await Promise.all([
        getClient(clientId),
        listProjects({ clientId }),
        listClientUsers(clientId),
      ]);
      setClient(c);
      setProjects(p);
      setUsers(u);

      const counts: Record<string, number> = {};
      await Promise.all(
        u.map(async (user) => {
          const access = await listUserProjectAccess(user.id);
          const projectIds = new Set(p.map((x) => x.id));
          counts[user.id] = access.filter((a) => a.can_view && projectIds.has(a.project_id)).length;
        })
      );
      setAccessCount(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o cliente.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={() => void load()} />;
  if (!client) return <ErrorView message="Cliente não encontrado." />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <button
          onClick={() => navigate('/admin/clients')}
          className="mb-3 flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ChevronLeft size={14} /> Clientes
        </button>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">{client.name}</h1>
        {client.legal_name && (
          <p className="text-sm text-[var(--color-text-muted)]">{client.legal_name}</p>
        )}
      </div>

      {/* Usuários -------------------------------------------------------- */}
      <Card
        title="Usuários"
        action={
          <button
            onClick={() => setInvitingUser(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <UserPlus size={13} /> Convidar usuário
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-soft)] p-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] text-[11px] font-semibold text-white">
                {u.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--color-text)]">{u.name}</p>
                <p className="truncate text-[11px] text-[var(--color-text-faint)]">{u.email}</p>
              </div>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {accessCount[u.id] ?? 0} projeto(s)
              </span>
              {u.status !== 'ACTIVE' && (
                <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] text-[var(--color-warn)]">
                  {u.status === 'INVITED' ? 'Convidado' : 'Desativado'}
                </span>
              )}
              <button
                onClick={() => setEditingUser(u)}
                className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
              >
                <ShieldCheck size={12} /> Editar acesso
              </button>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-xs text-[var(--color-text-faint)]">
              Nenhum usuário vinculado a este cliente.
            </p>
          )}
        </div>
      </Card>

      {/* Projetos -------------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--color-text)]">Projetos</h2>
        <button
          onClick={() => setCreatingProject(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          <Plus size={13} /> Novo Projeto
        </button>
      </div>

      {projects.length === 0 ? (
        <EmptyView
          title="Nenhum projeto cadastrado."
          description="Crie o primeiro projeto deste cliente."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
            >
              <button
                onClick={() => navigate(`/project/${p.id}/dashboard`)}
                className="flex w-full items-start justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-[var(--color-text)]">
                    {p.name}
                  </h3>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {p.timezone} · {p.currency}
                  </p>
                </div>
                <ArrowRight
                  size={16}
                  className="shrink-0 text-[var(--color-text-faint)] group-hover:text-[var(--color-brand)]"
                />
              </button>
              <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border-soft)] pt-3">
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-[10px] ' +
                    (p.status === 'ACTIVE'
                      ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]'
                      : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]')
                  }
                >
                  {p.status === 'ACTIVE' ? 'Ativo' : p.status === 'PAUSED' ? 'Pausado' : 'Arquivado'}
                </span>
                <button
                  onClick={async () => {
                    await archiveProject(p.id);
                    void load();
                  }}
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-bad)]"
                >
                  <Archive size={11} /> Arquivar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creatingProject && profile?.organization_id && (
        <NewProjectWizard
          organizationId={profile.organization_id}
          clientId={client.id}
          clientName={client.name}
          users={users}
          onClose={() => setCreatingProject(false)}
          onCreated={() => {
            setCreatingProject(false);
            void load();
          }}
        />
      )}

      {invitingUser && profile?.organization_id && (
        <InviteUserModal
          organizationId={profile.organization_id}
          clientId={client.id}
          onClose={() => setInvitingUser(false)}
          onInvited={() => {
            setInvitingUser(false);
            void load();
          }}
        />
      )}

      {editingUser && (
        <UserAccessModal
          user={editingUser}
          projects={projects}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function InviteUserModal({
  organizationId,
  clientId,
  onClose,
  onInvited,
}: {
  organizationId: string;
  clientId: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await inviteUser({ email: email.trim(), name: name.trim(), organizationId, clientId });
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível convidar o usuário.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Convidar usuário</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            A pessoa receberá um e-mail para definir a senha. O acesso aos projetos é liberado
            depois, em "Editar acesso".
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--color-text-muted)]">Nome</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[var(--color-text-muted)]">E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
          />
        </label>

        {error && (
          <p className="rounded-lg border border-[var(--color-bad-soft)] bg-[var(--color-bad-soft)] p-3 text-xs text-[var(--color-bad)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving || !name.trim() || !email.trim()}
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Enviando...' : 'Enviar convite'}
          </button>
        </div>
      </div>
    </div>
  );
}
