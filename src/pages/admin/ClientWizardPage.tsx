import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { useFilters } from '../../state/FiltersContext';
import { createAdAccount } from '../../data/mockData';
import { Stepper } from '../../components/ui/Stepper';
import { Card } from '../../components/ui/Card';

const steps = ['Dados do Cliente', 'Contas de Anúncio', 'Revisão'];

interface DraftAccount {
  name: string;
  metaAccountId: string;
}

export function ClientWizardPage() {
  const { addClient } = useFilters();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  const [name, setName] = useState('');
  const [segment, setSegment] = useState('');
  const [accounts, setAccounts] = useState<DraftAccount[]>([{ name: '', metaAccountId: '' }]);

  function updateAccount(i: number, field: keyof DraftAccount, value: string) {
    setAccounts((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  }

  function addAccountRow() {
    setAccounts((prev) => [...prev, { name: '', metaAccountId: '' }]);
  }

  function removeAccountRow(i: number) {
    setAccounts((prev) => prev.filter((_, idx) => idx !== i));
  }

  const step1Valid = name.trim().length > 0 && segment.trim().length > 0;
  const validAccounts = accounts.filter((a) => a.name.trim() && a.metaAccountId.trim());

  function finish() {
    const client = addClient(name.trim(), segment.trim());
    for (const acc of validAccounts) {
      createAdAccount(client.id, acc.name.trim(), acc.metaAccountId.trim());
    }
    navigate(`/admin/clientes/${client.id}`);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <button
          onClick={() => navigate('/admin')}
          className="mb-3 flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ChevronLeft size={14} /> Clientes
        </button>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Novo Cliente</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Cadastre o cliente em poucas etapas antes de criar os projetos dele
        </p>
      </div>

      <Stepper steps={steps} current={step} />

      <Card>
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--color-text-muted)]">Nome do cliente</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Faculdade Horizonte"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[var(--color-text-muted)]">Segmento</span>
              <input
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="ex: Educação Superior"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)]"
              />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Adicione as contas de anúncio da Meta deste cliente (nome e ID da conta, ex:
              act_1234567890). Você pode adicionar mais depois em Configurações.
            </p>
            {accounts.map((acc, i) => (
              <div key={i} className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nome da conta
                  <input
                    value={acc.name}
                    onChange={(e) => updateAccount(i, 'name', e.target.value)}
                    placeholder="ex: Horizonte — Captação Graduação"
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)]"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  ID da conta (Meta)
                  <input
                    value={acc.metaAccountId}
                    onChange={(e) => updateAccount(i, 'metaAccountId', e.target.value)}
                    placeholder="act_1234567890"
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)]"
                  />
                </label>
                {accounts.length > 1 && (
                  <button
                    onClick={() => removeAccountRow(i)}
                    className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-faint)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addAccountRow}
              className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
            >
              <Plus size={13} /> Adicionar outra conta
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border-soft)] p-4">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--color-good)]" />
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{segment}</p>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-faint)]">
                Contas de anúncio ({validAccounts.length})
              </p>
              {validAccounts.length === 0 && (
                <p className="text-xs text-[var(--color-text-faint)]">
                  Nenhuma conta adicionada — você pode incluir depois.
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                {validAccounts.map((a, i) => (
                  <div key={i} className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm">
                    <span className="text-[var(--color-text)]">{a.name}</span>{' '}
                    <span className="text-[var(--color-text-faint)]">· {a.metaAccountId}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-0"
        >
          <ChevronLeft size={15} /> Voltar
        </button>

        {step < steps.length ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={step === 1 && !step1Valid}
            className="flex items-center gap-1 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continuar <ChevronRight size={15} />
          </button>
        ) : (
          <button
            onClick={finish}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <CheckCircle2 size={15} /> Criar Cliente
          </button>
        )}
      </div>
    </div>
  );
}
