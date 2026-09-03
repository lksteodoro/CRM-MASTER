import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Copy, ExternalLink, Link2, Loader2, Pencil, Plus, Power, Repeat2, Trash2, X } from 'lucide-react';
import { listClients } from '../../services/clients.service';
import {
  createRedirectLink,
  deleteRedirectLink,
  listRedirectLinks,
  normalizeRedirectSlug,
  setRedirectLinkActive,
  updateRedirectLink,
  type RedirectLinkInput,
  type RedirectLinkWithDestinations,
} from '../../services/redirectLinks.service';
import type { ClientRow } from '../../integrations/supabase/database.types';
import { EmptyView, ErrorView, LoadingView } from '../../components/ui/StateView';

const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';

function emptyForm(clientId = ''): RedirectLinkInput {
  return { client_id: clientId, name: '', slug: '', strategy: 'single', delay_seconds: 0, active: true, paid_ads_locked: false, destinations: [{ label: 'Destino principal', target_url: '' }] };
}

export function RedirectLinksPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [links, setLinks] = useState<RedirectLinkWithDestinations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RedirectLinkWithDestinations | null | undefined>(undefined);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientRows, linkRows] = await Promise.all([listClients(), listRedirectLinks()]);
      setClients(clientRows);
      setLinks(linkRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os redirecionadores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => clients.map((client) => ({
    client,
    links: links.filter((link) => link.client_id === client.id),
  })).filter((group) => group.links.length > 0), [clients, links]);

  async function copyLink(link: RedirectLinkWithDestinations) {
    await navigator.clipboard.writeText(`${window.location.origin}/r/${link.slug}`);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 1_500);
  }

  async function toggleActive(link: RedirectLinkWithDestinations) {
    if (mutatingId) return;
    setMutatingId(link.id);
    try {
      const updated = await setRedirectLinkActive(link.id, !link.active);
      setLinks((current) => current.map((item) => item.id === link.id ? { ...item, ...updated } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível alterar o link.');
    } finally { setMutatingId(null); }
  }

  async function remove(link: RedirectLinkWithDestinations) {
    if (!window.confirm(`Excluir o redirecionador “${link.name}”? O link deixará de funcionar.`)) return;
    setMutatingId(link.id);
    try {
      await deleteRedirectLink(link.id);
      setLinks((current) => current.filter((item) => item.id !== link.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível excluir o link.');
    } finally { setMutatingId(null); }
  }

  if (loading) return <LoadingView label="Carregando redirecionadores..." />;
  if (error && clients.length === 0) return <ErrorView message={error} onRetry={() => void load()} />;

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><Link2 size={20} className="text-[var(--color-brand)]" /><h1 className="text-xl font-semibold text-[var(--color-text)]">Redirecionador de links</h1></div><p className="mt-1 text-sm text-[var(--color-text-muted)]">Crie links únicos por cliente, defina o tempo e distribua acessos entre vários destinos em loop.</p></div>
        <button type="button" onClick={() => setEditing(null)} disabled={clients.length === 0} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"><Plus size={15} /> Novo redirecionador</button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">{error}</p>}

      {links.length === 0 ? <EmptyView title="Nenhum redirecionador criado" description="Crie um link para cada cliente e organize os destinos da campanha." action={<button type="button" onClick={() => setEditing(null)} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white">Criar primeiro link</button>} /> : (
        <div className="flex flex-col gap-5">
          {groups.map(({ client, links: clientLinks }) => (
            <section key={client.id} aria-labelledby={`redirect-client-${client.id}`} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between"><div><h2 id={`redirect-client-${client.id}`} className="font-semibold text-[var(--color-text)]">{client.name}</h2><p className="text-xs text-[var(--color-text-muted)]">{clientLinks.length} link{clientLinks.length === 1 ? '' : 's'} configurado{clientLinks.length === 1 ? '' : 's'}</p></div><button type="button" onClick={() => setEditing({ ...clientLinks[0], id: '', name: '', slug: '', hit_count: 0, last_accessed_at: null, destinations: [{ id: '', redirect_link_id: '', label: 'Destino principal', target_url: '', position: 0, hit_count: 0, created_at: '' }] })} className="text-xs text-[var(--color-brand)] hover:underline">+ Link para este cliente</button></div>
              <div className="grid gap-3 lg:grid-cols-2">
                {clientLinks.map((link) => (
                  <article key={link.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{link.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${link.active ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]' : 'bg-[var(--color-panel-2)] text-[var(--color-text-faint)]'}`}>{link.active ? 'Ativo' : 'Pausado'}</span></div><p className="mt-1 truncate font-mono text-xs text-[var(--color-brand)]">{window.location.origin}/r/{link.slug}</p></div><button type="button" onClick={() => setEditing(link)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label={`Editar ${link.name}`}><Pencil size={14} /></button></div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-panel-2)] px-2 py-1"><Clock3 size={11} /> {link.delay_seconds}s</span><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-panel-2)] px-2 py-1"><Repeat2 size={11} /> {link.strategy === 'round_robin' ? 'Loop' : 'Destino fixo'}</span>{link.paid_ads_locked && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-1 font-semibold text-amber-400">Anúncio pago · destino travado</span>}<span className="rounded-full bg-[var(--color-panel-2)] px-2 py-1">{link.hit_count.toLocaleString('pt-BR')} acessos</span></div>
                    <div className="mt-3 space-y-1 border-t border-[var(--color-border-soft)] pt-3">{link.destinations.map((destination, index) => <p key={destination.id} className="flex min-w-0 items-center gap-2 text-xs"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[10px] text-[var(--color-brand)]">{index + 1}</span><span className="truncate text-[var(--color-text-muted)]">{destination.label || destination.target_url}</span><span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-faint)]">{destination.hit_count} acessos</span></p>)}</div>
                    <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void copyLink(link)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]">{copiedId === link.id ? <Check size={13} className="text-[var(--color-good)]" /> : <Copy size={13} />}{copiedId === link.id ? 'Copiado' : 'Copiar'}</button><a href={`/r/${link.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><ExternalLink size={13} /> Testar</a><button type="button" onClick={() => void toggleActive(link)} disabled={Boolean(mutatingId)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]"><Power size={13} /> {link.active ? 'Pausar' : 'Ativar'}</button><button type="button" onClick={() => void remove(link)} disabled={Boolean(mutatingId)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]">{mutatingId === link.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir</button></div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing !== undefined && <RedirectLinkModal clients={clients} link={editing?.id ? editing : null} initialClientId={editing?.client_id ?? clients[0]?.id ?? ''} onClose={() => setEditing(undefined)} onSaved={(saved) => { setLinks((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]); setEditing(undefined); }} />}
    </main>
  );
}

function RedirectLinkModal({ clients, link, initialClientId, onClose, onSaved }: { clients: ClientRow[]; link: RedirectLinkWithDestinations | null; initialClientId: string; onClose: () => void; onSaved: (link: RedirectLinkWithDestinations) => void }) {
  const [form, setForm] = useState<RedirectLinkInput>(() => link ? { client_id: link.client_id, name: link.name, slug: link.slug, strategy: link.strategy, delay_seconds: link.delay_seconds, active: link.active, paid_ads_locked: link.paid_ads_locked, destinations: link.destinations.map((destination) => ({ label: destination.label, target_url: destination.target_url })) } : emptyForm(initialClientId));
  const [slugTouched, setSlugTouched] = useState(Boolean(link));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try { onSaved(link ? await updateRedirectLink(link.id, form) : await createRedirectLink(form)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o redirecionador.'); }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"><form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="redirect-modal-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between"><div><h2 id="redirect-modal-title" className="font-semibold text-[var(--color-text)]">{link ? 'Editar redirecionador' : 'Novo redirecionador'}</h2><p className="text-xs text-[var(--color-text-muted)]">Organize o link, o tempo e a ordem dos destinos.</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={17} /></button></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Cliente</label><select value={form.client_id} onChange={(event) => setForm((current) => ({ ...current, client_id: event.target.value }))} className={inputClass} required>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div><div><label className={labelClass}>Nome interno</label><input value={form.name} onChange={(event) => { const name = event.target.value; setForm((current) => ({ ...current, name, slug: slugTouched ? current.slug : normalizeRedirectSlug(name) })); }} className={inputClass} placeholder="Ex: Campanha agosto" required /></div></div>
    <div className="mt-3"><label className={labelClass}>Link público</label><div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-3 text-xs text-[var(--color-text-faint)]"><span className="whitespace-nowrap">{window.location.origin}/r/</span><input value={form.slug} onChange={(event) => { setSlugTouched(true); setForm((current) => ({ ...current, slug: normalizeRedirectSlug(event.target.value) })); }} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-[var(--color-brand)] outline-none" required /></div></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Distribuição</label><select value={form.strategy} disabled={form.paid_ads_locked} onChange={(event) => setForm((current) => ({ ...current, strategy: event.target.value as RedirectLinkInput['strategy'] }))} className={`${inputClass} disabled:opacity-60`}><option value="single">Destino fixo</option><option value="round_robin">Loop / rodízio</option></select>{form.paid_ads_locked && <p className="mt-1 text-[10px] text-amber-400">Fixo em destino único: exigência da Meta para links de anúncio.</p>}</div><div><label className={labelClass}>Tempo antes de redirecionar</label><div className="relative"><input type="number" min="0" max="300" step="1" value={form.delay_seconds} onChange={(event) => setForm((current) => ({ ...current, delay_seconds: event.target.valueAsNumber || 0 }))} className={`${inputClass} pr-16`} /><span className="absolute right-3 top-2.5 text-xs text-[var(--color-text-faint)]">segundos</span></div></div></div>
    {/* Trava de conformidade com a Meta: destino de anuncio pago nao pode
        mudar entre acessos nem ser trocado depois da aprovacao. */}
    <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${form.paid_ads_locked ? 'border-amber-400/40 bg-amber-400/5' : 'border-[var(--color-border)] bg-[var(--color-bg)]'}`}>
      <input type="checkbox" checked={form.paid_ads_locked} onChange={(event) => setForm((current) => ({ ...current, paid_ads_locked: event.target.checked, strategy: event.target.checked ? 'single' : current.strategy, destinations: event.target.checked ? current.destinations.slice(0, 1) : current.destinations }))} className="mt-0.5" />
      <span className="text-xs leading-relaxed text-[var(--color-text-muted)]"><strong className="text-[var(--color-text)]">Este link sera usado como destino de anuncio pago</strong><br />Trava o link em um unico destino, que nao podera mais ser alterado. A Meta trata destino que muda apos a aprovacao como cloaking e bloqueia a conta de anuncios. Para trocar o destino depois, crie um novo link.</span>
    </label>
    <div className="mt-5"><div className="flex items-center justify-between"><div><h3 className="text-sm font-medium text-[var(--color-text)]">Destinos</h3><p className="text-[11px] text-[var(--color-text-muted)]">No modo loop, cada acesso usa o próximo destino e recomeça ao chegar no fim.</p></div>{!form.paid_ads_locked && <button type="button" onClick={() => setForm((current) => ({ ...current, destinations: [...current.destinations, { label: `Destino ${current.destinations.length + 1}`, target_url: '' }] }))} className="text-xs text-[var(--color-brand)] hover:underline">+ Adicionar destino</button>}</div><div className="mt-3 space-y-2">{form.destinations.map((destination, index) => <div key={index} className="grid gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:grid-cols-[36px_0.7fr_1.5fr_auto]"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-xs font-semibold text-[var(--color-brand)]">{index + 1}</span><input value={destination.label ?? ''} onChange={(event) => setForm((current) => ({ ...current, destinations: current.destinations.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} className={inputClass} placeholder="Nome do destino" /><input type="url" value={destination.target_url} onChange={(event) => setForm((current) => ({ ...current, destinations: current.destinations.map((item, itemIndex) => itemIndex === index ? { ...item, target_url: event.target.value } : item) }))} className={inputClass} placeholder="https://destino.com/pagina" required />{form.destinations.length > 1 && <button type="button" onClick={() => setForm((current) => ({ ...current, destinations: current.destinations.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-lg p-2 text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]" aria-label={`Remover destino ${index + 1}`}><Trash2 size={14} /></button>}</div>)}</div></div>
    {error && <p role="alert" className="mt-4 text-xs text-[var(--color-bad)]">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancelar</button><button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 size={14} className="animate-spin" />}{link ? 'Salvar alterações' : 'Criar link'}</button></div>
  </form></div>;
}
