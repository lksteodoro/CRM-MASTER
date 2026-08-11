import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, Archive } from 'lucide-react';
import { listClients, createClient, archiveClient } from '../../services/clients.service';
import { useAuth } from '../../providers/AuthProvider';
import type { ClientRow } from '../../integrations/supabase/database.types';
import { LoadingView, ErrorView, EmptyView } from '../../components/ui/StateView';
import { Stepper } from '../../components/ui/Stepper';
import { Card } from '../../components/ui/Card';

export function ClientsListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setClients(await listClients());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar os clientes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Clientes</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Gerencie os clientes da agência e os projetos de cada um
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus size={15} /> Novo Cliente
        </button>
      </div>

      {loading && <LoadingView label="Carregando clientes..." />}
      {!loading && error && <ErrorView message={error} onRetry={() => void load()} />}

      {!loading && !error && clients.length === 0 && (
        <EmptyView
          title="Nenhum cliente cadastrado."
          description="Crie seu primeiro cliente para começar."
          action={
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus size={14} /> Novo cliente
            </button>
          }
        />
      )}

      {!loading && !error && clients.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <div
              key={c.id}
              className="group flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
            >
              <button
                onClick={() => navigate(`/admin/clients/${c.id}`)}
                className="flex w-full items-start justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-[var(--color-text)]">
                    {c.name}
                  </h2>
                  {c.legal_name && (
                    <p className="truncate text-xs text-[var(--color-text-muted)]">{c.legal_name}</p>
                  )}
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
                    (c.status === 'ACTIVE'
                      ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]'
                      : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]')
                  }
                >
                  {c.status === 'ACTIVE' ? 'Ativo' : c.status === 'INACTIVE' ? 'Inativo' : 'Arquivado'}
                </span>
                <button
                  onClick={async () => {
                    await archiveClient(c.id);
                    void load();
                  }}
                  title="Arquivar cliente"
                  className="flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-bad)]"
                >
                  <Archive size={11} /> Arquivar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && profile?.organization_id && (
        <NewClientWizard
          organizationId={profile.organization_id}
          onClose={() => setCreating(false)}
          onCreated={(client) => {
            setCreating(false);
            navigate(`/admin/clients/${client.id}`);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistente de novo cliente
// A etapa de conta Meta foi removida nesta fase — entra na fase de integrações.
// ---------------------------------------------------------------------------
const steps = ['Dados', 'Revisão'];

function NewClientWizard({
  organizationId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  onClose: () => void;
  onCreated: (client: ClientRow) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [document, setDocument] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const created = await createClient({
        organizationId,
        name: name.trim(),
        legalName: legalName.trim() || null,
        document: document.trim() || null,
      });
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar o cliente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">Novo Cliente</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Cadastre o cliente antes de criar os projetos dele
          </p>
        </div>

        <Stepper steps={steps} current={step} />

        <Card>
          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <Field label="Nome do cliente" value={name} onChange={setName} autoFocus />
              <Field label="Razão social (opcional)" value={legalName} onChange={setLegalName} />
              <Field label="CNPJ / documento (opcional)" value={document} onChange={setDocument} />
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <Row label="Nome" value={name} />
              <Row label="Razão social" value={legalName || '—'} />
              <Row label="Documento" value={document || '—'} />
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
            onClick={step === 1 ? onClose : () => setStep(1)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!name.trim()}
              className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Continuar
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Criando...' : 'Criar Cliente'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-[var(--color-panel-2)] px-3 py-2">
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <span className="text-[var(--color-text)]">{value}</span>
    </div>
  );
}
