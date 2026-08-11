import { useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { createProject } from '../../services/projects.service';
import { grantProjectAccess } from '../../services/users.service';
import { upsertGoal, currentMonthPeriod, type GoalValues } from '../../services/goals.service';
import type { ProfileRow } from '../../integrations/supabase/database.types';
import { Stepper } from '../../components/ui/Stepper';
import { Card } from '../../components/ui/Card';

const steps = ['Informações', 'Metas', 'Usuários', 'Revisão'];

const goalFields: { key: keyof GoalValues; label: string; prefix?: string }[] = [
  { key: 'spend_goal', label: 'Investimento', prefix: 'R$' },
  { key: 'lead_goal', label: 'Leads' },
  { key: 'cpl_goal', label: 'CPL', prefix: 'R$' },
  { key: 'sales_goal', label: 'Vendas' },
  { key: 'cac_goal', label: 'CAC', prefix: 'R$' },
  { key: 'revenue_goal', label: 'Receita', prefix: 'R$' },
  { key: 'roas_goal', label: 'ROAS' },
];

export function NewProjectWizard({
  organizationId,
  clientId,
  clientName,
  users,
  onClose,
  onCreated,
}: {
  organizationId: string;
  clientId: string;
  clientName: string;
  users: ProfileRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [currency, setCurrency] = useState('BRL');
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = currentMonthPeriod();

  function toggleUser(id: string) {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const project = await createProject({
        organizationId,
        clientId,
        name: name.trim(),
        description: description.trim() || null,
        timezone,
        currency,
      });

      const values: Partial<GoalValues> = {};
      for (const field of goalFields) {
        const raw = goals[field.key];
        if (raw !== undefined && raw !== '') values[field.key] = Number(raw);
      }
      if (Object.keys(values).length > 0) {
        await upsertGoal({ projectId: project.id, ...period, values });
      }

      for (const userId of selectedUsers) {
        await grantProjectAccess(project.id, userId);
      }

      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar o projeto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Novo Projeto</h2>
          <p className="text-xs text-[var(--color-text-muted)]">para {clientName}</p>
        </div>

        <Stepper steps={steps} current={step} />

        <Card>
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--color-text-muted)]">Nome do projeto</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex: Pós IA"
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--color-text-muted)]">Descrição (opcional)</span>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--color-text-muted)]">Fuso horário</span>
                  <input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--color-text-muted)]">Moeda</span>
                  <input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
                  />
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[var(--color-text-muted)]">
                Metas do período {period.period_start} → {period.period_end}. Todos os campos são
                opcionais e podem ser ajustados depois.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {goalFields.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1.5 text-sm">
                    <span className="text-[var(--color-text-muted)]">
                      {f.label} {f.prefix && <span className="text-[var(--color-text-faint)]">({f.prefix})</span>}
                    </span>
                    <input
                      type="number"
                      value={goals[f.key] ?? ''}
                      onChange={(e) => setGoals((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-[var(--color-text)]"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                Quais usuários deste cliente terão acesso ao projeto? As permissões detalhadas podem
                ser ajustadas depois em "Editar acesso".
              </p>
              {users.map((u) => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--color-border-soft)] p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--color-text)]">{u.name}</p>
                    <p className="truncate text-[11px] text-[var(--color-text-faint)]">{u.email}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedUsers.has(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                </label>
              ))}
              {users.length === 0 && (
                <p className="text-xs text-[var(--color-text-faint)]">
                  Nenhum usuário vinculado a este cliente ainda.
                </p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border-soft)] p-4">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--color-good)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">{name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {clientName} · {timezone} · {currency}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                  Metas
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {goalFields
                    .filter((f) => goals[f.key])
                    .map((f) => (
                      <div key={f.key} className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2">
                        <p className="text-[10px] text-[var(--color-text-faint)]">{f.label}</p>
                        <p className="text-sm text-[var(--color-text)]">
                          {f.prefix} {goals[f.key]}
                        </p>
                      </div>
                    ))}
                </div>
                {goalFields.every((f) => !goals[f.key]) && (
                  <p className="text-xs text-[var(--color-text-faint)]">Nenhuma meta definida.</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                  Usuários com acesso ({selectedUsers.size})
                </p>
                {selectedUsers.size === 0 ? (
                  <p className="text-xs text-[var(--color-text-faint)]">
                    Nenhum — apenas o administrador verá este projeto.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {users
                      .filter((u) => selectedUsers.has(u.id))
                      .map((u) => (
                        <span
                          key={u.id}
                          className="rounded-full bg-[var(--color-panel-2)] px-2.5 py-1 text-xs text-[var(--color-text)]"
                        >
                          {u.name}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        {error && (
          <p className="rounded-lg border border-[var(--color-bad-soft)] bg-[var(--color-bad-soft)] p-3 text-xs text-[var(--color-bad)]">
            {error}
          </p>
        )}

        <div className="flex justify-between">
          <button
            onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
            className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {step === 1 ? 'Cancelar' : <><ChevronLeft size={15} /> Voltar</>}
          </button>

          {step < steps.length ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 && !name.trim()}
              className="flex items-center gap-1 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Continuar <ChevronRight size={15} />
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 size={15} /> {saving ? 'Criando...' : 'Criar Projeto'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
