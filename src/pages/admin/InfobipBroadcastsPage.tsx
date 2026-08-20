import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { listBroadcastDrafts } from '../../services/infobipTemplates.service';
import { BroadcastDraftModal, BroadcastWorkspace } from './InfobipTemplatesPage';
import type { BroadcastDraft } from './InfobipTemplatesPage';

export function InfobipBroadcastsPage() {
  const [drafts, setDrafts] = useState<BroadcastDraft[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    try { setDrafts(await listBroadcastDrafts()); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as transmissões. Aplique a migration 0033.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  return <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
    <header><div className="flex items-center gap-2 text-xs font-medium text-sky-300"><Send size={15} /> WhatsApp pela Infobip</div><h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--color-text)]">Transmissões</h1><p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">Informe o sender, puxe os templates aprovados e as etiquetas que já estão na Infobip e salve somente o apontamento como rascunho.</p></header>
    {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
    {message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</div>}
    {loading ? <div className="grid min-h-52 place-items-center text-sm text-[var(--color-text-muted)]">Carregando transmissões...</div> : <BroadcastWorkspace drafts={drafts} onCreate={() => setShowCreate(true)} />}
    {showCreate && <BroadcastDraftModal onClose={() => setShowCreate(false)} onSaved={async () => { setShowCreate(false); await load(); setMessage('Transmissão salva como rascunho.'); }} />}
  </main>;
}
