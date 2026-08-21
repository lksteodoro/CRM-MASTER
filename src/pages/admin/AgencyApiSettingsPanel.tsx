import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Database, KeyRound, Loader2, Save, ShieldCheck, X } from 'lucide-react';
import { listProjects } from '../../services/projects.service';
import type { ProjectRow } from '../../integrations/supabase/database.types';
import { getIntegration, saveIntegration, testConnection } from '../../services/metaAds.service';
import { getInfobipApiConfig, saveInfobipApiConfig, testInfobipApiConfig } from '../../services/infobipTemplates.service';
import { getMetaOAuthConnection, startMetaOAuth, type MetaOAuthConnection } from '../../services/metaOAuth.service';

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
      {selectedApi === 'meta' && <MetaApiModal connection={metaConnection} projects={projects} onClose={() => setSelectedApi(null)} />}
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

function MetaApiModal({ connection, projects, onClose }: { connection: MetaOAuthConnection | null; projects: ProjectRow[]; onClose: () => void }) {
  const [mode, setMode] = useState<'oauth' | 'token'>('oauth');
  const [projectId, setProjectId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projects, projectId]);

  useEffect(() => {
    if (!projectId || mode !== 'token') return;
    void getIntegration(projectId).then((integration) => setAccountId(integration?.ad_account_id ?? '')).catch(() => setAccountId(''));
  }, [mode, projectId]);
  async function connect() {
    setBusy(true); setFeedback(null);
    try { window.location.assign(await startMetaOAuth()); }
    catch (error) { setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível iniciar o login da Meta.' }); }
    finally { setBusy(false); }
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

  return <ModalShell title="Conectar Meta Ads" description="Escolha OAuth para a conexão da agência ou token manual por projeto." onClose={onClose}><div className="px-6 py-5"><div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-1"><button type="button" onClick={() => { setMode('oauth'); setFeedback(null); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'oauth' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}>OAuth da agência</button><button type="button" onClick={() => { setMode('token'); setFeedback(null); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'token' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}>Token por projeto</button></div>{mode === 'oauth' ? <div className="space-y-4">{connection?.status === 'CONNECTED' ? <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm text-emerald-200"><p className="font-semibold">Meta conectada{connection.meta_user_name ? ` como ${connection.meta_user_name}` : ''}.</p><p className="mt-1 text-xs text-emerald-100/70">Funcionários usam os perfis liberados e nunca visualizam a credencial.</p></div> : <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100"><p className="font-semibold">Nenhuma conexão OAuth ativa.</p><p className="mt-1 text-xs text-amber-100/70">Entre na Meta, autorize a agência e deixe a conexão salva no servidor.</p></div>}<p className="text-xs leading-5 text-[var(--color-text-muted)]">Recomendado para a operação compartilhada da agência.</p></div> : <div className="space-y-4"><p className="text-xs leading-5 text-[var(--color-text-muted)]">Use somente para uma conta/projeto específico ou enquanto OAuth não estiver configurado. O token não é exibido novamente após salvar.</p><label className="block text-xs font-semibold text-[var(--color-text-muted)]">Projeto<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]"><option value="">Selecione o projeto</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="block text-xs font-semibold text-[var(--color-text-muted)]">ID da conta de anúncios<input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="act_123456789 ou 123456789" className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]" /></label><label className="block text-xs font-semibold text-[var(--color-text-muted)]">Token de acesso Meta<input value={token} onChange={(event) => setToken(event.target.value)} type="password" placeholder="Cole apenas para salvar ou substituir" className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]" /></label>{selectedProject && <p className="text-xs text-[var(--color-text-faint)]">Esta credencial será usada somente em {selectedProject.name}.</p>}</div>}<FeedbackMessage feedback={feedback} /></div><footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)]">Fechar</button>{mode === 'oauth' ? <button type="button" disabled={busy} onClick={() => void connect()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 size={15} className="animate-spin" />}<KeyRound size={15} /> {connection ? 'Reconectar Meta' : 'Conectar com Meta'}</button> : <><button type="button" disabled={busy || !projectId} onClick={() => void testToken()} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] disabled:opacity-50">Testar</button><button type="button" disabled={busy || !projectId || !accountId || !token} onClick={() => void saveToken()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 size={15} className="animate-spin" />}<Save size={15} /> Salvar token</button></>}</footer></ModalShell>;
}
