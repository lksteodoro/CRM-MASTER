import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import {
  listUserProjectAccess,
  grantProjectAccess,
  revokeProjectAccess,
  defaultPermissions,
  type ProjectPermissionFlags,
} from '../../services/users.service';
import type { ProfileRow, ProjectRow } from '../../integrations/supabase/database.types';

const permissionLabels: { key: keyof ProjectPermissionFlags; label: string }[] = [
  { key: 'can_view', label: 'Visualizar projeto' },
  { key: 'can_edit_goals', label: 'Editar metas' },
  { key: 'can_edit_settings', label: 'Editar configurações' },
  { key: 'can_view_leads', label: 'Visualizar leads' },
  { key: 'can_view_sales', label: 'Visualizar vendas' },
  { key: 'can_view_commercial', label: 'Visualizar comercial' },
  { key: 'can_export', label: 'Exportar' },
];

type AccessMap = Record<string, ProjectPermissionFlags | null>;

export function UserAccessModal({
  user,
  projects,
  onClose,
  onSaved,
}: {
  user: ProfileRow;
  projects: ProjectRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [access, setAccess] = useState<AccessMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await listUserProjectAccess(user.id);
        if (!active) return;
        const map: AccessMap = {};
        for (const p of projects) {
          const row = rows.find((r) => r.project_id === p.id);
          map[p.id] = row
            ? {
                can_view: row.can_view,
                can_edit_goals: row.can_edit_goals,
                can_edit_settings: row.can_edit_settings,
                can_view_leads: row.can_view_leads,
                can_view_sales: row.can_view_sales,
                can_view_commercial: row.can_view_commercial,
                can_export: row.can_export,
              }
            : null;
        }
        setAccess(map);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Erro ao carregar permissões.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user.id, projects]);

  function toggleProject(projectId: string) {
    setAccess((prev) => ({
      ...prev,
      [projectId]: prev[projectId] ? null : { ...defaultPermissions },
    }));
  }

  function togglePermission(projectId: string, key: keyof ProjectPermissionFlags) {
    setAccess((prev) => {
      const current = prev[projectId];
      if (!current) return prev;
      return { ...prev, [projectId]: { ...current, [key]: !current[key] } };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const p of projects) {
        const flags = access[p.id];
        if (flags) {
          await grantProjectAccess(p.id, user.id, flags);
        } else {
          await revokeProjectAccess(p.id, user.id);
        }
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar as permissões.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--color-text)]">{user.name}</h2>
            <p className="truncate text-xs text-[var(--color-text-muted)]">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[var(--color-brand)]" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {projects.map((p) => {
                const flags = access[p.id];
                return (
                  <div key={p.id} className="rounded-xl border border-[var(--color-border-soft)] p-3">
                    <label className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--color-text)]">{p.name}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(flags)}
                        onChange={() => toggleProject(p.id)}
                        className="h-4 w-4 accent-[var(--color-brand)]"
                      />
                    </label>

                    {flags ? (
                      <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-[var(--color-border-soft)] pt-3 sm:grid-cols-2">
                        {permissionLabels.map(({ key, label }) => (
                          <label
                            key={key}
                            className="flex cursor-pointer items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-[var(--color-text-muted)]">{label}</span>
                            <input
                              type="checkbox"
                              checked={flags[key]}
                              disabled={key === 'can_view'}
                              onChange={() => togglePermission(p.id, key)}
                              className="h-3.5 w-3.5 accent-[var(--color-brand)] disabled:opacity-50"
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-[var(--color-text-faint)]">Sem acesso</p>
                    )}
                  </div>
                );
              })}
              {projects.length === 0 && (
                <p className="text-xs text-[var(--color-text-faint)]">
                  Este cliente ainda não tem projetos.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg border border-[var(--color-bad-soft)] bg-[var(--color-bad-soft)] p-3 text-xs text-[var(--color-bad)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void save()}
            disabled={saving || loading}
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar acesso'}
          </button>
        </div>
      </div>
    </div>
  );
}
