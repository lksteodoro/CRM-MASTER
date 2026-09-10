import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  MessageSquare,
  RefreshCw,
  Settings,
  XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../providers/AuthProvider';
import {
  getCsConfig,
  listCsGroups,
  saveCsConfig,
  setCsWebhook,
  syncCsGroups,
  testCsConnection,
  listCsClients,
  type CsConfig,
  type CsClient,
} from '../../services/consumerSuccess.service';
import type { CsGroupRow } from '../../integrations/supabase/database.types';
import { CsInbox } from '../../components/consumerSuccess/CsInbox';
import { CsScheduledPanel } from '../../components/consumerSuccess/CsScheduledPanel';
import { ErrorView, LoadingView } from '../../components/ui/StateView';

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';

type Tab = 'inbox' | 'schedules';

function ConnectionForm({
  config,
  isAdmin,
  onSaved,
}: {
  config: CsConfig;
  isAdmin: boolean;
  onSaved: () => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(config.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [instanceName, setInstanceName] = useState(config.instance_name ?? '');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-sm text-[var(--color-text-muted)]">
        A conexão com a Evolution API ainda não foi configurada. Peça pra um administrador ligar a
        integração em Ferramentas → Consumer Success.
      </div>
    );
  }

  async function handleSave() {
    if (!baseUrl.trim() || !apiKey.trim() || !instanceName.trim()) {
      setError('Preencha URL, API key e o nome da instância.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveCsConfig({
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        instance_name: instanceName.trim(),
      });
      setApiKey('');
      setMessage(
        saved.connected
          ? 'Conectado à Evolution. Agora configure o webhook e sincronize os grupos.'
          : 'Configuração salva, mas a instância não respondeu como conectada. Confira o nome da instância e se o WhatsApp está pareado.'
      );
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a configuração.');
    } finally {
      setSaving(false);
    }
  }

  async function run(action: 'test' | 'webhook' | 'sync') {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      if (action === 'test') {
        const result = await testCsConnection();
        setMessage(
          result.connected
            ? 'Instância conectada.'
            : 'A Evolution respondeu, mas a instância não está com o WhatsApp conectado.'
        );
      }
      if (action === 'webhook') {
        await setCsWebhook();
        setMessage('Webhook configurado na Evolution. As mensagens novas já chegam sozinhas.');
      }
      if (action === 'sync') {
        const result = await syncCsGroups();
        setMessage(`${result.synced} grupo(s) sincronizado(s).`);
      }
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A ação falhou.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
      <div className="flex items-center gap-2">
        <Settings size={16} className="text-[var(--color-text-muted)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Conexão com a Evolution API</h2>
        {config.configured && (
          <span
            className={clsx(
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
              config.connected
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-amber-500/10 text-amber-300'
            )}
          >
            {config.connected ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {config.connected ? 'Conectada' : 'Desconectada'}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={labelClass}>URL do servidor</label>
          <input
            className={inputClass}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://evolution.seudominio.com.br"
          />
        </div>
        <div>
          <label className={labelClass}>Instância</label>
          <input
            className={inputClass}
            value={instanceName}
            onChange={(event) => setInstanceName(event.target.value)}
            placeholder="nome-da-instancia"
          />
        </div>
        <div className="sm:col-span-3">
          <label className={labelClass}>API key</label>
          <input
            className={inputClass}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={config.configured ? '•••••••• (preencha só pra trocar)' : 'API key da Evolution'}
          />
          <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
            A chave fica só no servidor — o navegador nunca recebe de volta.
          </p>
        </div>
      </div>

      {config.configured && config.webhook_url && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
          <p className={labelClass}>Webhook que a Evolution deve chamar</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-muted)]">
              {config.webhook_url}
            </code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(config.webhook_url ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              }}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
            O botão "Configurar webhook" já registra essa URL na instância. Use o copiar só se
            preferir colar manualmente no painel da Evolution.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {config.configured ? 'Salvar alterações' : 'Conectar'}
        </button>

        {config.configured && (
          <>
            <button
              onClick={() => void run('test')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Testar conexão
            </button>
            <button
              onClick={() => void run('webhook')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              {busy === 'webhook' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Configurar webhook
            </button>
            <button
              onClick={() => void run('sync')}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              {busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sincronizar grupos
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ConsumerSuccessPage() {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState<CsConfig | null>(null);
  const [groups, setGroups] = useState<CsGroupRow[]>([]);
  const [clients, setClients] = useState<CsClient[]>([]);
  const [tab, setTab] = useState<Tab>('inbox');
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadGroups() {
    try {
      setGroups(await listCsGroups());
    } catch {
      // O polling do inbox chama isso; falha isolada não deve derrubar a tela.
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [configResult, clientRows] = await Promise.all([getCsConfig(), listCsClients()]);
      setConfig(configResult);
      setClients(clientRows);
      if (configResult.configured) await loadGroups();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível carregar o Consumer Success.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <LoadingView label="Carregando Consumer Success..." />;
  if (error) return <ErrorView message={error} onRetry={() => void load()} />;
  if (!config) return null;

  const managedCount = groups.filter((group) => group.is_managed).length;

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
            <MessageSquare size={15} /> WhatsApp pela Evolution API
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--color-text)]">
            Consumer Success
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Os grupos dos clientes em um lugar só: acompanhe a conversa, responda sem abrir o
            celular e programe as mensagens que mantêm o cliente aquecido.
          </p>
        </div>

        {config.configured && isAdmin && (
          <button
            onClick={() => setShowSettings((current) => !current)}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <Settings size={14} />
            {showSettings ? 'Fechar conexão' : 'Conexão'}
          </button>
        )}
      </header>

      {(!config.configured || showSettings) && (
        <ConnectionForm
          config={config}
          isAdmin={isAdmin}
          onSaved={async () => {
            const updated = await getCsConfig();
            setConfig(updated);
            if (updated.configured) await loadGroups();
          }}
        />
      )}

      {config.configured && (
        <>
          <div className="flex gap-1 border-b border-[var(--color-border)]">
            <button
              onClick={() => setTab('inbox')}
              className={clsx(
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === 'inbox'
                  ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              )}
            >
              Conversas
              {groups.length > 0 && (
                <span className="ml-1.5 text-[11px] text-[var(--color-text-faint)]">
                  {managedCount}/{groups.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('schedules')}
              className={clsx(
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === 'schedules'
                  ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              )}
            >
              Mensagens programadas
            </button>
          </div>

          {groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
              Nenhum grupo por aqui ainda. Abra "Conexão" e clique em "Sincronizar grupos" pra
              trazer os grupos do WhatsApp.
            </div>
          ) : tab === 'inbox' ? (
            <CsInbox groups={groups} clients={clients} onGroupsChanged={() => void loadGroups()} />
          ) : (
            <CsScheduledPanel groups={groups.filter((group) => group.is_managed)} clients={clients} />
          )}
        </>
      )}
    </main>
  );
}
