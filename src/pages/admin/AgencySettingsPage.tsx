import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, FolderKanban, KeyRound, Plus, ScrollText, Settings, Users } from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { listClients } from '../../services/clients.service';
import { listOrganizationUsers } from '../../services/users.service';
import type { ClientRow, ProfileRow } from '../../integrations/supabase/database.types';
import { ClientsListPage } from './ClientsListPage';
import { AdminProjectsPage } from './AdminProjectsPage';
import { AdminUsersPage } from './AdminUsersPage';
import { AuditLogPage } from './AuditLogPage';
import { NewProjectWizard } from './NewProjectWizard';
import { AgencyApiSettingsPanel } from './AgencyApiSettingsPanel';

type SettingsTab = 'overview' | 'clients' | 'projects' | 'users' | 'apis' | 'audit';

const tabs: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'overview', label: 'Visão geral', icon: Settings },
  { id: 'clients', label: 'Clientes', icon: Building2 },
  { id: 'projects', label: 'Projetos', icon: FolderKanban },
  { id: 'users', label: 'Usuários e acessos', icon: Users },
  { id: 'apis', label: 'APIs', icon: KeyRound },
  { id: 'audit', label: 'Auditoria', icon: ScrollText },
];

export function AgencySettingsPage() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('aba') as SettingsTab | null;
  const activeTab: SettingsTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab! : 'overview';
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingForClient, setCreatingForClient] = useState<ClientRow | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [loadingPicker, setLoadingPicker] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  useEffect(() => {
    if (!pickerOpen || clients.length > 0) return;
    setLoadingPicker(true);
    Promise.all([listClients(), listOrganizationUsers()])
      .then(([clientRows, userRows]) => {
        setClients(clientRows);
        setUsers(userRows);
        setSelectedClientId((current) => current || clientRows[0]?.id || '');
      })
      .finally(() => setLoadingPicker(false));
  }, [pickerOpen, clients.length]);

  function selectTab(tab: SettingsTab) {
    setSearchParams(tab === 'overview' ? {} : { aba: tab });
  }

  function openProjectPicker() {
    setPickerOpen(true);
  }

  const content = {
    overview: (
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SettingsCard icon={Building2} title="Clientes" description="Cadastre e mantenha os clientes da agência." onClick={() => selectTab('clients')} />
        <SettingsCard icon={FolderKanban} title="Projetos" description="Veja todos os projetos e crie um novo para um cliente." onClick={() => selectTab('projects')} />
        <SettingsCard icon={Users} title="Usuários e acessos" description="Ative usuários e libere cada ferramenta da agência individualmente." onClick={() => selectTab('users')} />
        <SettingsCard icon={KeyRound} title="APIs" description="Centralize as integrações Infobip, Meta Ads e futuras conexões." onClick={() => selectTab('apis')} />
        <SettingsCard icon={ScrollText} title="Auditoria" description="Consulte alterações, permissões e operações registradas." onClick={() => selectTab('audit')} />
      </section>
    ),
    clients: <ClientsListPage />,
    projects: <AdminProjectsPage />,
    users: <AdminUsersPage />,
    apis: <AgencyApiSettingsPanel />,
    audit: <AuditLogPage />,
  } as const;

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-7 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]"><Settings size={14} /> Agência</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-text)]">Configurações da agência</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">Centralize clientes, projetos, usuários, acessos e auditoria em um único lugar.</p>
        </div>
        <button type="button" onClick={openProjectPicker} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"><Plus size={16} /> Novo projeto</button>
      </header>

      <nav className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-1.5" aria-label="Seções de configuração">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return <button key={tab.id} type="button" onClick={() => selectTab(tab.id)} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${selected ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]'}`}><Icon size={14} /> {tab.label}</button>;
        })}
      </nav>

      <div className="mt-5">{content[activeTab]}</div>

      {pickerOpen && !creatingForClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Cadastrar projeto</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Todo projeto pertence a um cliente. Escolha para quem será criado.</p>
            {loadingPicker ? <p className="mt-5 text-sm text-[var(--color-text-muted)]">Carregando clientes...</p> : clients.length === 0 ? <p className="mt-5 rounded-xl border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">Cadastre um cliente antes de criar um projeto.</p> : <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)} className="mt-5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2.5 text-sm text-[var(--color-text)]"><option value="">Selecione o cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>}
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setPickerOpen(false)} className="rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancelar</button><button type="button" disabled={!selectedClient} onClick={() => { if (selectedClient) { setPickerOpen(false); setCreatingForClient(selectedClient); } }} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Continuar</button></div>
          </div>
        </div>
      )}

      {creatingForClient && profile?.organization_id && <NewProjectWizard organizationId={profile.organization_id} clientId={creatingForClient.id} clientName={creatingForClient.name} users={users} onClose={() => setCreatingForClient(null)} onCreated={() => { setCreatingForClient(null); selectTab('projects'); }} />}
    </main>
  );
}

function SettingsCard({ icon: Icon, title, description, onClick }: { icon: typeof Settings; title: string; description: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--color-brand)] hover:shadow-lg"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]"><Icon size={18} /></span><h2 className="mt-4 font-semibold text-[var(--color-text)]">{title}</h2><p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">{description}</p></button>;
}
