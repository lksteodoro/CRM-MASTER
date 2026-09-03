import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Database, KeyRound, Loader2, Save, ShieldCheck, X } from 'lucide-react';
import { listProjects } from '../../services/projects.service';
import type { ProjectRow } from '../../integrations/supabase/database.types';
import { getIntegration, saveIntegration, testConnection } from '../../services/metaAds.service';
import { getInfobipApiConfig, saveInfobipApiConfig, testInfobipApiConfig } from '../../services/infobipTemplates.service';
import { disconnectMeta, getMetaOAuthConnection, saveMetaSystemUserToken, startMetaOAuth, type MetaOAuthConnection } from '../../services/metaOAuth.service';

type ApiId = 'infobip' | 'meta' | 'supabase';
type Feedback = { type: 'ok' | 'error'; text: string } | null;

const apiDefinitions: Array<{ id: ApiId; name: string; description: string; icon: typeof KeyRound; configurable: boolean }> = [
  { id: 'infobip', name: 'Infobip', description: 'Templates, senders e transmissões de WhatsApp.', icon: KeyRound, configurable: true },
  { id: 'meta', name: 'Meta Ads', description: 'Conta de anúncios e sincronização de métricas por projeto.', icon: Database, configurable: true },
  { id: 'supabase', name: 'Supabase', description: 'Banco, autenticação e arquivos internos da plataforma.', icon: ShieldCheck, configurable: false },
];

export function AgencyApiSettingsPanel() {
  const [selectedApi, setSelectedApi] = useState<ApiId | null>(null);
  const [infobipConfigured, setInfobipConfigured] = useState<boolean | null>(null);
  const [metaConnection, setMetaConnection] = useState<MetaOAuthConnection | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  useEffect(() => {
    void listProjects().then(setProjects).catch(() => setProjects([]));
    void getInfobipApiConfig().then((config) => setInfobipConfigured(config?.configured ?? false)).catch(() => setInfobipConfigured(false));
    void getMetaOAuthConnection().then(setMetaConnection).catch(() => setMetaConnection(null));
  }, []);

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">APIs e integrações</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Credenciais ficam centralizadas e só administradores podem configurá-las.</p>
      </div>
      <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
        {apiDefinitions.map((api) => {
          const Icon = api.icon;
          const connected = api.id === 'infobip' ? infobipConfigured : api.id === 'meta' ? metaConnection?.status === 'CONNECTED' : api.id === 'supabase' ? true : null;
          return (
            <div key={api.id} className="flex flex-wrap items-center gap-4 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><Icon size={18} /></span>
              <div className="min-w-[200px] flex-1">
                <h3 className="font-semibold text-[var(--color-text)]">{api.name}</h3>
                <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{api.description}</p>
              </div>
              {connected !== null && <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${connected ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{connected ? 'Configurada' : 'Não configurada'}</span>}
              {api.configurable ? <button type="button" onClick={() => setSelectedApi(api.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text-muted)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-text)]">Configurar <ChevronRight size={15} /></button> : <span className="text-xs text-[var(--color-text-faint)]">Gerenciada pelo ambiente</span>}
            </div>
          );
        })}
      </div>

      {selectedApi === 'infobip' && <InfobipApiModal onClose={() => setSelectedApi(null)} onConfigured={() => setInfobipConfigured(true)} />}
      {selectedApi === 'meta' && <MetaApiModal connection={metaConnection} projects={projects} onChanged={setMetaConnection} onClose={() => setSelectedApi(null)} />}
    </section>
  );
}

function ModalShell({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl"><header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5"><div><h2 className="text-lg font-semibold text-[var(--color-text)]">{title}</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"><X size={18} /></button></header>{children}</div></div>;
}

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return <p className={`mt-4 rounded-lg border px-3 py-2 text-sm ${feedback.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{feedback.text}</p>;
}

function InfobipApiModal({ onClose, onConfigured }: { onClose: () => void; onConfigured: () => void }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => { void getInfobipApiConfig().then((config) => setBaseUrl(config?.baseUrl ?? '')).catch(() => undefined); }, []);

  async function save() {
    setBusy(true); setFeedback(null);
    try { await saveInfobipApiConfig(baseUrl, apiKey); onConfigured(); setApiKey(''); setFeedback({ type: 'ok', text: 'Credenciais da Infobip salvas.' }); }
    catch (error) { setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar a Infobip.' }); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setFeedback(null);
    try { await testInfobipApiConfig(); setFeedback({ type: 'ok', text: 'Conexão com a Infobip validada.' }); }
    catch (error) { setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'A conexão falhou.' }); }
    finally { setBusy(false); }
  }

  return <ModalShell title="Configurar API Infobip" description="A chave fica armazenada no servidor e não é exibida novamente." onClose={onClose}><div className="px-6 py-5"><label className="block text-xs font-semibold text-[var(--color-text-muted)]">Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://xxxx.api.infobip.com" className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]" /></label><label className="mt-4 block text-xs font-semibold text-[var(--color-text-muted)]">API Key<input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="Cole uma nova chave para alterar" className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]" /></label><FeedbackMessage feedback={feedback} /></div><footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4"><button type="button" disabled={busy} onClick={() => void test()} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Testar conexão</button><button type="button" disabled={busy || !baseUrl || !apiKey} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 size={15} className="animate-spin" />}<Save size={15} /> Salvar</button></footer></ModalShell>;
}

/**
 * Conexão da agência com a Meta.
 *
 * Duas formas de conectar, ambas aceitas pela Meta e ambas guardando a
 * credencial no servidor:
 *
 *   OAuth          — login do Facebook. Bom quando quem opera é a própria
 *                    pessoa dona dos acessos.
 *   Token geral    — usuário de sistema da Business Manager. Credencial fixa,
 *                    que não expira e não depende de ninguém continuar logado.
 *
 * A terceira aba é outra coisa: token por projeto, usado só para ler métricas.
 * Ele não publica anúncios.
 */
function MetaApiModal({ connection, projects, onClose, onChanged }: { connection: MetaOAuthConnection | null; projects: ProjectRow[]; onClose: () => void; onChanged: (connection: MetaOAuthConnection | null) => void }) {
  const [mode, setMode] = useState<'oauth' | 'system' | 'project'>(connection?.credential_source === 'SYSTEM_USER' ? 'system' : 'oauth');
  const [projectId, setProjectId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [systemToken, setSystemToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projects, projectId]);
  const isConnected = connection?.status === 'CONNECTED';

  useEffect(() => {
    if (!projectId || mode !== 'project') return;
    void getIntegration(projectId).then((integration) => setAccountId(integration?.ad_account_id ?? '')).catch(() => setAccountId(''));
  }, [mode, projectId]);

  async function refreshConnection() {
    try { onChanged(await getMetaOAuthConnection()); } catch { /* a tela recarrega no próximo acesso */ }
  }

  async function connect() {
    setBusy(true); setFeedback(null);
    try { window.location.assign(await startMetaOAuth()); }
    catch (error) { setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível iniciar o login da Meta.' }); }
    finally { setBusy(false); }
  }

  async function saveSystemToken() {
    if (!systemToken.trim()) return;
    setBusy(true); setFeedback(null);
    try {
      const saved = await saveMetaSystemUserToken(systemToken.trim());
      setSystemToken('');
      await refreshConnection();
      setFeedback({ type: 'ok', text: `Credencial validada e guardada no servidor (${saved.name}). Permissões: ${saved.scopes.join(', ')}.` });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o token.' });
    } finally { setBusy(false); }
  }

  async function removeConnection() {
    setBusy(true); setFeedback(null);
    try {
      await disconnectMeta();
      await refreshConnection();
      setFeedback({ type: 'ok', text: 'Conexão removida. A credencial foi apagada do servidor.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível remover a conexão.' });
    } finally { setBusy(false); }
  }

  async function saveToken() {
    if (!projectId || !accountId.trim() || !token.trim()) return;
    setBusy(true); setFeedback(null);
    try {
      await saveIntegration(projectId, { adAccountId: accountId, accessToken: token });
      setToken('');
      setFeedback({ type: 'ok', text: 'Token salvo somente para este projeto.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o token.' });
    } finally { setBusy(false); }
  }

  async function testToken() {
    if (!projectId) return;
    setBusy(true); setFeedback(null);
    try {
      const result = await testConnection(projectId);
      setFeedback(result.ok ? { type: 'ok', text: `Conectado${result.accountName ? ` à conta ${result.accountName}` : ''}.` } : { type: 'error', text: result.error ?? 'A Meta recusou a conexão.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'A conexão falhou.' });
    } finally { setBusy(false); }
  }

  const tabClass = (active: boolean) => `rounded-lg px-3 py-2 text-xs font-semibold transition ${active ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`;
  const fieldClass = 'mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]';

  return (
    <ModalShell title="Conectar Meta Ads" description="A credencial fica no servidor. Nenhuma das opções guarda token no navegador." onClose={onClose}>
      <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
        {/* Estado atual da credencial que publica anúncios */}
        <div className={`mb-5 rounded-xl border p-4 text-sm ${isConnected ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/25 bg-amber-400/10 text-amber-100'}`}>
          <p className="font-semibold">
            {isConnected
              ? `Conectada${connection?.meta_user_name ? ` como ${connection.meta_user_name}` : ''} · ${connection?.credential_source === 'SYSTEM_USER' ? 'token geral da agência' : 'OAuth'}`
              : 'Nenhuma credencial da agência ativa'}
          </p>
          <p className="mt-1 text-xs opacity-80">
            {isConnected
              ? 'O criador de anúncios usa esta conexão. Funcionários publicam sem nunca ver a credencial.'
              : 'Enquanto isso, o criador de anúncios abre em modo demonstração e não publica. Escolha uma das duas formas abaixo.'}
          </p>
          {connection?.last_error && <p className="mt-2 text-xs opacity-90">Último erro: {connection.last_error}</p>}
          {isConnected && connection?.scopes?.length ? <p className="mt-2 text-[11px] opacity-70">Permissões: {connection.scopes.join(', ')}</p> : null}
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-1">
          <button type="button" onClick={() => { setMode('oauth'); setFeedback(null); }} className={tabClass(mode === 'oauth')}>Login da Meta</button>
          <button type="button" onClick={() => { setMode('system'); setFeedback(null); }} className={tabClass(mode === 'system')}>Token geral</button>
          <button type="button" onClick={() => { setMode('project'); setFeedback(null); }} className={tabClass(mode === 'project')}>Token por projeto</button>
        </div>

        {mode === 'oauth' && (
          <div className="space-y-3">
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Você entra na Meta, autoriza a agência e a credencial fica guardada no servidor. É o caminho mais simples quando quem configura já tem acesso à Business Manager, à conta de anúncios e às páginas.
            </p>
            <p className="text-xs leading-5 text-[var(--color-text-faint)]">
              O token gerado assim tem validade e pode exigir reconexão de tempos em tempos. Se preferir uma credencial que não expira, use a aba <strong className="text-[var(--color-text-muted)]">Token geral</strong>.
            </p>
          </div>
        )}

        {mode === 'system' && (
          <div className="space-y-4">
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Credencial fixa da agência, gerada como <strong className="text-[var(--color-text)]">usuário de sistema</strong> na sua Business Manager. É o mecanismo oficial da Meta para integração servidor-a-servidor: não expira e não depende de ninguém continuar logado.
            </p>

            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-4">
              <p className="text-xs font-semibold text-[var(--color-text)]">Como gerar o token</p>
              <ol className="mt-2 space-y-1.5 text-xs leading-5 text-[var(--color-text-muted)]">
                <li>1. Abra <strong className="text-[var(--color-text-muted)]">business.facebook.com</strong> › Configurações do Negócio › Usuários do sistema.</li>
                <li>2. Crie (ou escolha) um usuário de sistema com função de administrador e dê a ele acesso à conta de anúncios e às páginas.</li>
                <li>3. Clique em <strong className="text-[var(--color-text-muted)]">Gerar novo token</strong> e escolha <strong className="text-[var(--color-text-muted)]">o aplicativo desta agência</strong> — não outro.</li>
                <li>4. Marque as permissões <code className="rounded bg-[var(--color-panel)] px-1">ads_management</code>, <code className="rounded bg-[var(--color-panel)] px-1">ads_read</code>, <code className="rounded bg-[var(--color-panel)] px-1">pages_show_list</code> e <code className="rounded bg-[var(--color-panel)] px-1">business_management</code>.</li>
              </ol>
              <p className="mt-3 text-[11px] leading-5 text-[var(--color-text-faint)]">
                O token é conferido com a Meta antes de ser aceito. Se tiver sido gerado para outro aplicativo — o caso mais comum é o token do Graph API Explorer — ele é recusado: usar credencial de outro app viola as regras da plataforma e é o tipo de coisa que derruba a conta.
              </p>
            </div>

            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Token de usuário de sistema
              <input
                value={systemToken}
                onChange={(event) => setSystemToken(event.target.value)}
                type="password"
                autoComplete="off"
                placeholder="Cole o token aqui — ele não será exibido novamente"
                className={fieldClass}
              />
            </label>
            <p className="text-[11px] leading-5 text-[var(--color-text-faint)]">
              O token vai direto para o cofre do servidor e não fica salvo neste navegador.
            </p>
          </div>
        )}

        {mode === 'project' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3">
              <p className="text-xs leading-5 text-[var(--color-text-muted)]">
                Esta aba é só para <strong className="text-[var(--color-text)]">leitura de métricas</strong> de um projeto específico. Ela não publica anúncios — para publicar, use uma das duas primeiras abas.
              </p>
            </div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Projeto
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className={fieldClass}>
                <option value="">Selecione o projeto</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              ID da conta de anúncios
              <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="act_123456789 ou 123456789" className={fieldClass} />
            </label>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)]">
              Token de acesso Meta
              <input value={token} onChange={(event) => setToken(event.target.value)} type="password" placeholder="Cole apenas para salvar ou substituir" className={fieldClass} />
            </label>
            {selectedProject && <p className="text-xs text-[var(--color-text-faint)]">Esta credencial será usada somente em {selectedProject.name}.</p>}
          </div>
        )}

        <FeedbackMessage feedback={feedback} />
      </div>

      <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
        {isConnected && mode !== 'project' && (
          <button type="button" disabled={busy} onClick={() => void removeConnection()} className="mr-auto rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50">Desconectar</button>
        )}
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)]">Fechar</button>
        {mode === 'oauth' && (
          <button type="button" disabled={busy} onClick={() => void connect()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />}<KeyRound size={15} /> {connection ? 'Reconectar Meta' : 'Conectar com Meta'}
          </button>
        )}
        {mode === 'system' && (
          <button type="button" disabled={busy || !systemToken.trim()} onClick={() => void saveSystemToken()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" />}<ShieldCheck size={15} /> Validar e salvar
          </button>
        )}
        {mode === 'project' && (
          <>
            <button type="button" disabled={busy || !projectId} onClick={() => void testToken()} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] disabled:opacity-50">Testar</button>
            <button type="button" disabled={busy || !projectId || !accountId || !token} onClick={() => void saveToken()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" />}<Save size={15} /> Salvar token
            </button>
          </>
        )}
      </footer>
    </ModalShell>
  );
}
