import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Building2, CalendarClock, CheckCircle2, FileUp, ImagePlus, Link2, LogOut, Send, UsersRound } from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { listClients } from '../../services/clients.service';
import {
  createClientPortalDemand,
  getClientDemandProfile,
  listClientPortalDemands,
  uploadClientProfileAsset,
  upsertClientDemandProfile,
  type ClientDemandInput,
} from '../../services/clientDemandPortal.service';
import type { ClientDisparoProfileRow, ClientRow, DisparoTaskRow } from '../../integrations/supabase/database.types';
import { Card } from '../../components/ui/Card';
import { EmptyView, ErrorView, LoadingView } from '../../components/ui/StateView';
import { guessColumn, parseCsv, type ParsedCsv } from '../../lib/csv';
import { sanitizeContactRows, type ContactColumnMapping } from '../../lib/listSanitizer';

type FormState = {
  title: string;
  profileName: string;
  ddd: string;
  copyText: string;
  destinationLink: string;
  instagram: string;
  scheduledDate: string;
  scheduledTime: string;
  notes: string;
  profilePhotoPath: string | null;
  profileCoverPath: string | null;
};

const emptyForm = (): FormState => ({
  title: '', profileName: '', ddd: '', copyText: '', destinationLink: '', instagram: '',
  scheduledDate: '', scheduledTime: '', notes: '', profilePhotoPath: null, profileCoverPath: null,
});

const emptyMapping: ContactColumnMapping = { firstName: -1, lastName: -1, phone: -1, tag: -1 };

function guessedMapping(headers: string[]): ContactColumnMapping {
  return {
    firstName: guessColumn(headers, ['nome', 'name', 'contato']),
    lastName: guessColumn(headers, ['sobrenome', 'last name', 'lastname', 'apelido']),
    phone: guessColumn(headers, ['telefone', 'phone', 'celular', 'whatsapp', 'fone']),
    // Etiquetas operacionais são definidas pela agência, nunca pelo cliente.
    tag: -1,
  };
}

function fromProfile(profile: ClientDisparoProfileRow | null): FormState {
  const base = emptyForm();
  return {
    ...base,
    profileName: profile?.profile_name ?? '',
    ddd: profile?.default_ddd ?? '',
    profilePhotoPath: profile?.profile_photo_path ?? null,
    profileCoverPath: profile?.profile_cover_path ?? null,
  };
}

function demandStatusLabel(task: DisparoTaskRow) {
  if (task.client_portal_status === 'action_required') return 'Ação necessária';
  if (task.client_portal_status === 'under_review') return 'Em conferência';
  if (task.client_portal_status === 'approved') return 'Aprovada';
  if (task.status === 'pedido') return 'Recebida';
  return task.status.replace('_', ' ');
}

function formatDate(value: string | null) {
  if (!value) return 'Data ainda não definida';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`));
}

export function ClientDisparoPortalPage() {
  const { profile: userProfile, signOut } = useAuth();
  const { clientId: requestedClientId } = useParams();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [activeClientId, setActiveClientId] = useState('');
  const [profile, setProfile] = useState<ClientDisparoProfileRow | null>(null);
  const [demands, setDemands] = useState<DisparoTaskRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [sourceListFile, setSourceListFile] = useState<File | null>(null);
  const [parsedList, setParsedList] = useState<ParsedCsv>({ headers: [], rows: [] });
  const [mapping, setMapping] = useState<ContactColumnMapping>(emptyMapping);
  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'photo' | 'cover' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const listInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const activeClient = clients.find((client) => client.id === activeClientId) ?? null;
  const listResult = useMemo(
    () => sanitizeContactRows(parsedList.rows, mapping, ''),
    [mapping, parsedList.rows]
  );

  const loadClient = useCallback(async (clientId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [nextProfile, nextDemands] = await Promise.all([
        getClientDemandProfile(clientId),
        listClientPortalDemands(clientId),
      ]);
      setProfile(nextProfile);
      setDemands(nextDemands);
      setForm(fromProfile(nextProfile));
      setSourceListFile(null);
      setParsedList({ headers: [], rows: [] });
      setMapping(emptyMapping);
      setSaveAsDefault(true);
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar suas demandas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextClients = await listClients();
        if (!active) return;
        setClients(nextClients);
        const initialClient = requestedClientId
          ? nextClients.find((client) => client.id === requestedClientId)
          : nextClients[0];
        if (initialClient) {
          setActiveClientId(initialClient.id);
          await loadClient(initialClient.id);
        } else {
          if (requestedClientId) setError('Você não tem acesso a este painel de cliente.');
          setLoading(false);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Não foi possível identificar seu cliente.');
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [loadClient, requestedClientId]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function selectContactList(file?: File) {
    if (!file) return;
    setError(null);
    setSuccess(null);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Envie a lista em CSV ou TXT. Se estiver no Excel, salve como CSV UTF-8.');
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      setError('A lista deve ter no máximo 16 MB.');
      return;
    }
    try {
      const nextParsed = parseCsv(await file.text());
      if (nextParsed.headers.length === 0 || nextParsed.rows.length === 0) {
        setError('A lista não contém cabeçalho e contatos para analisar.');
        return;
      }
      setSourceListFile(file);
      setParsedList(nextParsed);
      setMapping(guessedMapping(nextParsed.headers));
      setConfirmed(false);
    } catch {
      setError('Não foi possível ler a lista. Salve o arquivo como CSV UTF-8 e tente novamente.');
    }
  }

  async function selectProfileAsset(kind: 'photo' | 'cover', file?: File) {
    if (!file || !activeClientId) return;
    setUploading(kind);
    setError(null);
    try {
      const path = await uploadClientProfileAsset(activeClientId, kind, file);
      setField(kind === 'photo' ? 'profilePhotoPath' : 'profileCoverPath', path);
      setSuccess(kind === 'photo' ? 'Foto de perfil enviada.' : 'Foto de capa enviada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a imagem.');
    } finally {
      setUploading(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeClient) return;
    setError(null);
    setSuccess(null);
    if (!form.title.trim()) return setError('Informe um título para a demanda.');
    if (!form.profileName.trim()) return setError('Informe o nome do perfil.');
    if (form.ddd.replace(/\D/g, '').length < 2) return setError('Informe o DDD do perfil.');
    if (!form.copyText.trim()) return setError('Informe o corpo da mensagem.');
    if (!form.destinationLink.trim()) return setError('Informe o link de destino.');
    if (!sourceListFile) return setError('Anexe a lista de contatos para a demanda.');
    if (mapping.phone < 0) return setError('Selecione a coluna de telefone da lista.');
    if (listResult.contacts.length === 0) return setError('Nenhum telefone válido foi encontrado na lista.');
    if (!confirmed) return setError('Confirme o resumo da lista antes de enviar a demanda.');

    setSaving(true);
    try {
      let savedProfile: ClientDisparoProfileRow | null = profile;
      if (saveAsDefault) {
        const nextProfile = await upsertClientDemandProfile({
          clientId: activeClient.id,
          profileName: form.profileName,
          ddd: form.ddd,
          profilePhotoPath: form.profilePhotoPath,
          profileCoverPath: form.profileCoverPath,
          previousProfilePhotoPath: profile?.profile_photo_path,
          previousProfileCoverPath: profile?.profile_cover_path,
        });
        setProfile(nextProfile);
        savedProfile = nextProfile;
      }

      const input: ClientDemandInput = {
        clientId: activeClient.id,
        title: form.title,
        scheduledDate: form.scheduledDate || null,
        scheduledTime: form.scheduledTime || null,
        profileName: form.profileName,
        ddd: form.ddd,
        profilePhotoPath: form.profilePhotoPath,
        profileCoverPath: form.profileCoverPath,
        copyText: form.copyText,
        destinationLink: form.destinationLink,
        instagram: form.instagram,
        notes: form.notes,
        listFile: sourceListFile,
        originalListFileName: sourceListFile.name,
        mapping: { firstName: mapping.firstName, lastName: mapping.lastName, phone: mapping.phone },
      };
      const created = await createClientPortalDemand(input);
      setDemands((current) => [created, ...current]);
      setForm(fromProfile(savedProfile));
      setSourceListFile(null);
      setParsedList({ headers: [], rows: [] });
      setMapping(emptyMapping);
      setConfirmed(false);
      if (listInput.current) listInput.current.value = '';
      setSuccess('Demanda enviada para a agência. Ela já está na etapa Pedido.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a demanda.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingView label="Carregando seu painel de demandas..." />;
  if (error && !activeClient) return <ErrorView message={error} onRetry={() => activeClientId && void loadClient(activeClientId)} />;
  if (!activeClient) return <EmptyView title="Nenhum cliente vinculado" description="Peça à agência para liberar seu acesso ao painel de demandas." />;

  return (
    <main className="min-h-screen bg-[var(--color-bg)] p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-brand)]"><Send size={15} /> Portal de demandas</div>
            <h1 className="text-2xl font-semibold text-[var(--color-text)]">Solicite seu próximo disparo</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">Envie os dados completos. A equipe confere a lista, configura número, etiqueta, template e disparo.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {clients.length > 1 && (
              <select value={activeClientId} onChange={(event) => { setActiveClientId(event.target.value); void loadClient(event.target.value); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text)]">
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            )}
            <span className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">{userProfile?.name}</span>
            <button type="button" onClick={() => void signOut()} className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"><LogOut size={13} /> Sair</button>
          </div>
        </header>

        {error && <p role="alert" className="mb-5 rounded-xl border border-[var(--color-bad)]/35 bg-[var(--color-bad-soft)] px-4 py-3 text-sm text-[var(--color-bad)]">{error}</p>}
        {success && <p role="status" className="mb-5 rounded-xl border border-[var(--color-good)]/35 bg-[var(--color-good-soft)] px-4 py-3 text-sm text-[var(--color-good)]">{success}</p>}

        <form onSubmit={(event) => void submit(event)} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-5">
            <Card title="Nova demanda">
              <p className="-mt-2 mb-5 text-xs text-[var(--color-text-muted)]">Esta solicitação entra em “Pedido”. Você não precisa escolher sender, etiqueta ou quantidade.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome da demanda *"><input required value={form.title} onChange={(event) => setField('title', event.target.value)} placeholder="Ex.: Oferta pós-graduação agosto" className={inputClass} /></Field>
                <Field label="Data desejada"><input type="date" value={form.scheduledDate} onChange={(event) => setField('scheduledDate', event.target.value)} className={inputClass} /></Field>
                <Field label="Horário desejado"><input type="time" value={form.scheduledTime} onChange={(event) => setField('scheduledTime', event.target.value)} className={inputClass} /></Field>
                <Field label="Instagram (opcional)"><input value={form.instagram} onChange={(event) => setField('instagram', event.target.value)} placeholder="@empresa" className={inputClass} /></Field>
              </div>
            </Card>

            <Card title="Perfil padrão do WhatsApp">
              <p className="-mt-2 mb-5 text-xs text-[var(--color-text-muted)]">Os dados abaixo já vêm do seu perfil salvo. Altere se necessário; a demanda guarda sua própria cópia.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome do perfil *"><input required value={form.profileName} onChange={(event) => setField('profileName', event.target.value)} placeholder="Ex.: Faculdade Exemplo" className={inputClass} /></Field>
                <Field label="DDD *"><input required inputMode="numeric" maxLength={3} value={form.ddd} onChange={(event) => setField('ddd', event.target.value.replace(/\D/g, ''))} placeholder="11" className={inputClass} /></Field>
                <AssetButton label="Foto de perfil" value={form.profilePhotoPath ? 'Imagem enviada' : 'Enviar foto'} loading={uploading === 'photo'} onClick={() => photoInput.current?.click()} />
                <AssetButton label="Foto de capa" value={form.profileCoverPath ? 'Imagem enviada' : 'Enviar capa'} loading={uploading === 'cover'} onClick={() => coverInput.current?.click()} />
              </div>
              <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void selectProfileAsset('photo', event.target.files?.[0])} />
              <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void selectProfileAsset('cover', event.target.files?.[0])} />
              <label className="mt-5 flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-muted)]"><input type="checkbox" checked={saveAsDefault} onChange={(event) => setSaveAsDefault(event.target.checked)} className="accent-[var(--color-brand)]" /> Atualizar meu perfil padrão com estes dados</label>
            </Card>

            <Card title="Mensagem e lista">
              <div className="flex flex-col gap-4">
                <Field label="Corpo da mensagem *"><textarea required value={form.copyText} onChange={(event) => setField('copyText', event.target.value)} rows={6} placeholder="Escreva a mensagem que deseja enviar…" className={`${inputClass} resize-y`} /></Field>
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Link de destino *"><div className="relative"><Link2 size={15} className="pointer-events-none absolute left-3 top-3 text-[var(--color-text-faint)]" /><input required type="url" value={form.destinationLink} onChange={(event) => setField('destinationLink', event.target.value)} placeholder="https://" className={`${inputClass} pl-9`} /></div></Field><Field label="Lista de contatos *"><button type="button" onClick={() => listInput.current?.click()} className="flex h-[38px] w-full items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 text-left text-sm text-[var(--color-text-muted)] hover:border-[var(--color-brand)]"><FileUp size={15} className="text-[var(--color-brand)]" /><span className="truncate">{sourceListFile?.name ?? 'Anexar CSV ou TXT'}</span></button><input ref={listInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(event) => void selectContactList(event.target.files?.[0])} /></Field></div>
                <Field label="Observações para a agência"><textarea value={form.notes} onChange={(event) => setField('notes', event.target.value)} rows={3} placeholder="Informações adicionais, restrições ou contexto da campanha." className={`${inputClass} resize-y`} /></Field>
              </div>
              {sourceListFile && (
                <div className="mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-[var(--color-text)]">Confira as colunas e a higienização</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">Apenas o CSV higienizado será guardado de forma privada.</p></div><span className="rounded-full bg-[var(--color-brand-soft)] px-2.5 py-1 text-[11px] text-[var(--color-brand)]">{parsedList.rows.length} linha(s) analisada(s)</span></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><MappingSelect label="Nome" value={mapping.firstName} headers={parsedList.headers} onChange={(value) => setMapping((current) => ({ ...current, firstName: value }))} /><MappingSelect label="Sobrenome" value={mapping.lastName} headers={parsedList.headers} onChange={(value) => setMapping((current) => ({ ...current, lastName: value }))} optional /><MappingSelect label="Telefone *" value={mapping.phone} headers={parsedList.headers} onChange={(value) => { setMapping((current) => ({ ...current, phone: value })); setConfirmed(false); }} /></div>
                  {mapping.phone < 0 && <p className="mt-3 text-xs text-[var(--color-bad)]">Selecione a coluna de telefone para continuar.</p>}
                  {mapping.phone >= 0 && <div className="mt-4 grid gap-3 sm:grid-cols-4"><ListStat label="Recebidos" value={parsedList.rows.length} color="var(--color-info)" /><ListStat label="Válidos" value={listResult.contacts.length} color="var(--color-good)" /><ListStat label="Inválidos" value={listResult.invalidPhones + listResult.emptyRows} color="var(--color-bad)" /><ListStat label="Duplicados" value={listResult.duplicates} color="var(--color-warn)" /></div>}
                  {mapping.phone >= 0 && listResult.contacts.length > 0 && <p className={`mt-4 text-xs ${listResult.contacts.length >= 1000 ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'}`}>{listResult.contacts.length >= 1000 ? 'Lista pronta para seguir à conferência da agência.' : 'A demanda pode ser enviada para análise, mas não poderá avançar ao disparo antes de atingir 1.000 contatos válidos.'}</p>}
                </div>
              )}
              <label className="mt-5 flex cursor-pointer items-start gap-2 text-xs text-[var(--color-text-muted)]"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 accent-[var(--color-brand)]" /> Confirmo os dados, o resumo da lista e o envio desta demanda para a agência.</label>
              <div className="mt-5 flex justify-end"><button disabled={saving || uploading !== null || !confirmed} type="submit" className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Enviando demanda…' : <><Send size={15} /> Confirmar e enviar</>}</button></div>
            </Card>
          </div>

          <aside className="flex flex-col gap-5">
            <Card title="Como funciona"><ol className="flex flex-col gap-3 text-xs text-[var(--color-text-muted)]"><Step icon={<Building2 size={15} />} text="Você envia dados e lista." /><Step icon={<UsersRound size={15} />} text="A agência higieniza e confere os contatos." /><Step icon={<CheckCircle2 size={15} />} text="A equipe configura e solicita sua aprovação." /></ol></Card>
            <Card title={`Demandas enviadas (${demands.length})`} className="p-0 overflow-hidden"><div className="max-h-[540px] overflow-y-auto">{demands.length === 0 ? <div className="p-5"><EmptyView title="Nenhuma demanda enviada" description="Sua primeira solicitação aparecerá aqui." /></div> : demands.map((task) => <article key={task.id} className="border-b border-[var(--color-border-soft)] p-4 last:border-0"><div className="flex gap-2"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${task.client_portal_status === 'action_required' ? 'bg-[var(--color-warn)]' : 'bg-[var(--color-brand)]'}`} /><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--color-text)]">{task.title}</p><p className="mt-1 text-[11px] text-[var(--color-text-muted)]"><CalendarClock className="mr-1 inline" size={11} />{formatDate(task.scheduled_date)}</p><p className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] ${task.client_portal_status === 'action_required' ? 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' : 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]'}`}>{demandStatusLabel(task)}</p>{task.source_list_file_name && <p className="mt-2 truncate text-[10px] text-[var(--color-text-faint)]">{task.list_valid_count.toLocaleString('pt-BR')} contatos válidos · {task.source_list_file_name}</p>}{task.client_portal_status === 'action_required' && task.client_feedback_comment && <div className="mt-3 rounded-lg border border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] p-2.5 text-[11px] leading-4 text-[var(--color-warn)]"><strong>Pendência da agência:</strong> {task.client_feedback_comment}</div>}</div></div></article>)}</div></Card>
          </aside>
        </form>
      </div>
    </main>
  );
}

const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20';

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--color-text-muted)]"><span>{label}</span>{children}</label>; }
function AssetButton({ label, value, loading, onClick }: { label: string; value: string; loading: boolean; onClick: () => void }) { return <div className="flex flex-col gap-1.5 text-xs font-medium text-[var(--color-text-muted)]"><span>{label}</span><button type="button" disabled={loading} onClick={onClick} className="flex h-[38px] items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 text-left text-sm text-[var(--color-text-muted)] hover:border-[var(--color-brand)] disabled:opacity-50"><ImagePlus size={15} className="text-[var(--color-brand)]" />{loading ? 'Enviando…' : value}</button></div>; }
function Step({ icon, text }: { icon: ReactNode; text: string }) { return <li className="flex items-start gap-2"><span className="mt-0.5 text-[var(--color-brand)]">{icon}</span><span>{text}</span></li>; }
function MappingSelect({ label, value, headers, onChange, optional = false }: { label: string; value: number; headers: string[]; onChange: (value: number) => void; optional?: boolean }) { return <label className="flex flex-col gap-1 text-[11px] text-[var(--color-text-muted)]"><span>{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-2 text-xs text-[var(--color-text)]"><option value={-1}>{optional ? 'Não importar' : 'Selecionar coluna'}</option>{headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Coluna ${index + 1}`}</option>)}</select></label>; }
function ListStat({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-panel)] px-3 py-2"><p className="text-[10px] text-[var(--color-text-faint)]">{label}</p><p className="mt-0.5 text-sm font-semibold" style={{ color }}>{value.toLocaleString('pt-BR')}</p></div>; }
