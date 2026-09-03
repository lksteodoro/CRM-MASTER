import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  ExternalLink,
  Megaphone,
  ImagePlus,
  Play,
  Settings2,
  ShieldCheck,
  Trash2,
  WalletCards,
} from 'lucide-react';
import MetaAdCreator from '../../components/MetaAdCreator';
import { listProjects } from '../../services/projects.service';
import type { ProjectRow } from '../../integrations/supabase/database.types';
import { ErrorView, LoadingView } from '../../components/ui/StateView';

const META_PRESETS_STORAGE_KEY = 'meta_account_presets';
const LEGACY_META_PRESETS_STORAGE_KEY = 'meta_ads_client_presets_v1';

type MetaClientPreset = {
  id: string;
  name: string;
  projectId?: string;
  bmId?: string;
  bmName?: string;
  accountName?: string;
  adAccountName?: string;
  adAccountId?: string;
  pageId?: string;
  pageName?: string;
  instagramId?: string;
  instagramName?: string;
  pixelId?: string;
  pixelName?: string;
  budget?: number;
  imageData?: string;
};

/**
 * Central de Meta Ads da agência.
 *
 * Nenhum token da Meta é lido ou gravado neste navegador: o criador de anúncios
 * conversa com a Graph API pela Edge Function `meta-proxy`, que usa a conexão
 * OAuth da agência guardada no servidor. Os perfis de publicação abaixo são
 * apenas atalhos de configuração (IDs de conta, página, pixel) e ficam neste
 * navegador — nenhum deles é credencial.
 */
export function MetaAdsToolPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [presets, setPresets] = useState<MetaClientPreset[]>([]);
  const [creatorPreset, setCreatorPreset] = useState<MetaClientPreset | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId]
  );

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listProjects();
      setProjects(result);
      setProjectId((current) => current || result[0]?.id || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os projetos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(META_PRESETS_STORAGE_KEY) ?? '[]');
      const legacy = JSON.parse(localStorage.getItem(LEGACY_META_PRESETS_STORAGE_KEY) ?? '[]');
      const entries = Array.isArray(stored) && stored.length > 0 ? stored : legacy;
      if (Array.isArray(entries)) setPresets(entries);
    } catch {
      setPresets([]);
    }
  }, []);

  useEffect(() => {
    if (searchParams.get('criar') === '1' && selectedProject) {
      setCreatorPreset(null);
      setCreatorOpen(true);
    }
  }, [searchParams, selectedProject]);

  useEffect(() => {
    // Perfis antigos não tinham projectId. Nesse caso, o projeto escolhido na
    // biblioteca é a referência para abrir o criador, em vez de bloquear a ação.
    if (creatorPreset && selectedProject && (!creatorPreset.projectId || selectedProject.id === creatorPreset.projectId)) {
      setCreatorOpen(true);
    }
  }, [creatorPreset, selectedProject]);

  function closeCreator() {
    setCreatorOpen(false);
    setCreatorPreset(null);
    if (searchParams.has('criar')) {
      const next = new URLSearchParams(searchParams);
      next.delete('criar');
      setSearchParams(next, { replace: true });
    }
  }

  function persistPresets(next: MetaClientPreset[] | ((current: MetaClientPreset[]) => MetaClientPreset[])) {
    setPresets((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      localStorage.setItem(META_PRESETS_STORAGE_KEY, JSON.stringify(resolved));
      return resolved;
    });
  }

  function updatePresetImage(preset: MetaClientPreset, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const imageData = String(reader.result || '');
      persistPresets((current) => current.map((item) => item.id === preset.id ? { ...item, imageData } : item));
    };
    reader.readAsDataURL(file);
  }

  function handleCreatorProfileSaved(profile: MetaClientPreset) {
    let alreadyExists = false;
    persistPresets((current) => {
      alreadyExists = current.some((preset) => preset.id === profile.id);
      return alreadyExists
        ? current.map((preset) => preset.id === profile.id ? profile : preset)
        : [...current, profile];
    });
    setCreatorPreset(profile);
    setNotice(`Perfil “${profile.name}” ${alreadyExists ? 'atualizado' : 'criado'} e pronto para reutilizar.`);
  }

  function openPreset(preset: MetaClientPreset) {
    setError(null);
    setCreatorOpen(false);
    const resolvedProjectId = preset.projectId || projectId || projects[0]?.id || '';
    setCreatorPreset({ ...preset, projectId: resolvedProjectId });
    setProjectId(resolvedProjectId);
  }

  if (loading) return <LoadingView />;
  if (error && projects.length === 0) return <ErrorView message={error} onRetry={() => void loadProjects()} />;

  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 py-7 md:px-10 xl:px-14">
      <section className="overflow-hidden rounded-3xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/15 via-[var(--color-panel)] to-cyan-500/10 p-6 shadow-[0_22px_60px_-34px_rgba(79,70,229,0.7)]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-300/25 bg-indigo-500/15 text-indigo-300">
              <Megaphone size={21} />
            </span>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Ferramentas da agência</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text)]">Meta Ads</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              Centralize a conta, confira campanhas e prepare publicações usando a credencial segura de cada projeto.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            <ShieldCheck size={17} /> Credenciais protegidas no servidor
          </div>
        </div>

      <div className="mt-8 border-t border-indigo-300/15 pt-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-200"><WalletCards size={20} /></span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--color-text)]">Perfis de publicação</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-text-muted)]">Sua biblioteca de clientes. Os perfis são criados dentro do Meta Ad Creator, após configurar os dados reais da conta.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/agency/configuracoes?aba=apis" className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"><Settings2 size={14} /> APIs e integrações</Link>
            <button type="button" onClick={() => { setCreatorPreset(null); setCreatorOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-[#6f8ca3] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110"><Play size={15} /> Abrir criador</button>
          </div>
        </div>

        {presets.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] px-5 py-14 text-center"><WalletCards size={28} className="mx-auto text-[var(--color-text-faint)]" /><p className="mt-3 text-sm font-medium text-[var(--color-text)]">Sua biblioteca está vazia</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">Abra o Creator, escolha BM, conta, página e Instagram; depois use “+ Config” para criar o primeiro card.</p></div>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {presets.map((preset) => (
              <article key={preset.id} className="group overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] transition duration-200 hover:-translate-y-1 hover:border-cyan-300/35 hover:shadow-[0_18px_42px_-26px_rgba(34,211,238,0.7)]">
                <div className="relative flex h-64 items-center justify-center overflow-hidden border-b border-[var(--color-border-soft)] bg-[radial-gradient(circle_at_50%_42%,rgba(70,103,126,0.26),transparent_25%),radial-gradient(circle_at_68%_35%,rgba(27,92,111,0.18),transparent_32%),linear-gradient(145deg,#10161d,#070a0d)]">
                  {preset.imageData && <img src={preset.imageData} alt={`Perfil de ${preset.name}`} className="absolute inset-0 h-full w-full object-cover opacity-75 transition duration-300 group-hover:scale-105" />}
                  {preset.imageData && <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/10" />}
                  <div className="absolute h-36 w-36 rotate-12 rounded-[2.2rem] border border-cyan-100/10 bg-cyan-200/[0.03] shadow-[inset_0_0_32px_rgba(100,210,235,0.08)]" />
                  <div className="absolute h-24 w-24 -rotate-12 rounded-3xl border border-indigo-200/10 bg-indigo-300/[0.04]" />
                  <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.08] text-cyan-200 shadow-[0_0_40px_rgba(34,211,238,0.12)]"><Megaphone size={28} /></span>
                  <p className="absolute bottom-5 left-5 right-5 truncate text-center text-xs font-medium tracking-wide text-cyan-100/75">{preset.adAccountName || preset.accountName || preset.adAccountId || 'Conta Meta'}</p>
                  <label className="absolute right-3 top-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-black/45 px-2.5 py-2 text-[10px] font-semibold text-white backdrop-blur transition hover:bg-black/70" title="Alterar foto do perfil">
                    <ImagePlus size={13} /> Foto
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) updatePresetImage(preset, file); event.currentTarget.value = ''; }} />
                  </label>
                </div>
                <div className="p-4">
                  <div className="min-w-0"><h3 className="truncate font-semibold text-[var(--color-text)]" title={preset.name}>{preset.name}</h3></div>
                  <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]"><p className="truncate text-[var(--color-text-muted)]" title={preset.bmName || preset.bmId}>BM: <span className="text-[var(--color-text)]">{preset.bmName || preset.bmId || '—'}</span></p><p className="truncate text-[var(--color-text-muted)]" title={preset.adAccountName || preset.accountName || preset.adAccountId}>Conta: <span className="text-[var(--color-text)]">{preset.adAccountName || preset.accountName || preset.adAccountId || '—'}</span></p><p className="col-span-2 truncate text-[var(--color-text-muted)]" title={preset.adAccountId}>ID conta: <span className="font-mono text-[var(--color-text)]">{preset.adAccountId || '—'}</span></p><p className="truncate text-[var(--color-text-muted)]">Página: <span className="text-[var(--color-text)]">{preset.pageName || preset.pageId || '—'}</span></p><p className="truncate text-[var(--color-text-muted)]">Instagram: <span className="text-[var(--color-text)]">{preset.instagramName || preset.instagramId || '—'}</span></p><p className="truncate text-[var(--color-text-muted)]">Pixel: <span className="text-[var(--color-text)]">{preset.pixelName || preset.pixelId || '—'}</span></p><p className="text-[var(--color-text-muted)]">Diário: <span className="font-semibold text-emerald-300">R$ {(Number(preset.budget) || 50).toLocaleString('pt-BR')}</span></p></div>
                  <div className="mt-4 flex gap-2"><button type="button" onClick={() => openPreset(preset)} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-500 to-slate-400 px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(148,163,184,0.9)] transition hover:brightness-110"><Play size={15} /> Usar perfil</button><button type="button" onClick={() => persistPresets(presets.filter((item) => item.id !== preset.id))} className="rounded-xl border border-[var(--color-border)] px-3 text-[var(--color-text-muted)] hover:border-red-400/40 hover:text-red-300" title="Excluir perfil"><Trash2 size={15} /></button></div>
                  <div className="mt-2 flex gap-2 border-t border-[var(--color-border-soft)] pt-2">
                    {preset.adAccountId && <a href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(preset.adAccountId.replace(/^act_/i, ''))}`} target="_blank" rel="noreferrer" className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-2 py-2 text-[10px] font-semibold text-cyan-300 hover:bg-cyan-400/15"><ExternalLink size={11} /> Abrir conta</a>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="mt-4 text-[11px] text-[var(--color-text-faint)]">Os perfis guardam apenas atalhos de configuração (conta, página, pixel) e ficam neste navegador. A credencial da Meta nunca passa por aqui: ela fica no servidor, na conexão feita em Configurações › APIs.</p>
      </div>
      </section>

      {notice && <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 size={17} />{notice}</div>}

      {creatorOpen && selectedProject && (
        <div
          style={{
            '--bg-app': '#090c12',
            '--bg-surface': '#11141c',
            '--border-light': '#242936',
            '--border-main': '#303746',
            '--text-main': '#f5f7fb',
            '--text-muted': '#8992a6',
            '--primary': '#2f80ff',
          } as React.CSSProperties}
        >
          <MetaAdCreator
            projectId={selectedProject.id}
            quickPreset={creatorPreset}
            startBlank={!creatorPreset}
            onProfileSaved={handleCreatorProfileSaved}
            card={{
              id: `meta-tool-${selectedProject.id}`,
              clientId: selectedProject.client_id,
              clientName: selectedProject.name,
              title: selectedProject.name,
              demandaObjetivo: 'LEADS',
              demandaOrcamento: '50',
              demandaPublico: 'Brasil, 18–65 anos',
              demandaDescricao: '',
              linkComplete: '',
            }}
            onClose={closeCreator}
            onComplete={() => {
              closeCreator();
              setNotice('Fluxo do criador concluído. Confira os anúncios no Gerenciador da Meta.');
            }}
          />
        </div>
      )}
    </main>
  );
}
