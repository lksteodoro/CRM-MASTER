import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CheckCircle2, Copy, CopyPlus, Download, ExternalLink, GitBranch, ListChecks, Loader2, Plus, Power, Trash2, Users, Webhook, X, XCircle } from 'lucide-react';
import {
  createQuiz,
  deleteQuiz,
  duplicateQuiz,
  listQuizProducts,
  listQuizSessions,
  listQuizStats,
  listQuizVersions,
  listQuizWebhookDeliveries,
  listQuizzes,
  setQuizActive,
  type Quiz,
  type QuizStats,
  type QuizTemplate,
} from '../../services/quizzes.service';
import { normalizeRedirectSlug } from '../../services/redirectLinks.service';
import type { QuizProductRow, QuizSessionRow, QuizWebhookDeliveryRow } from '../../integrations/supabase/database.types';
import { EmptyView, ErrorView, LoadingView } from '../../components/ui/StateView';
import { inputClass, labelClass } from '../../components/quiz/quizStyles';

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export function QuizzesPage() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [stats, setStats] = useState<Record<string, QuizStats>>({});
  const [versionNumbers, setVersionNumbers] = useState<Record<string, number>>({});
  const [products, setProducts] = useState<QuizProductRow[]>([]);
  const [productFilter, setProductFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Quiz | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [quizRows, statRows, productRows] = await Promise.all([listQuizzes(), listQuizStats(), listQuizProducts()]);
      setQuizzes(quizRows);
      setStats(statRows);
      setProducts(productRows);
      const published = quizRows.filter((quiz) => quiz.published_version_id);
      const versions = await Promise.all(published.map((quiz) => listQuizVersions(quiz.id).then((rows) => [quiz.id, rows.find((row) => row.id === quiz.published_version_id)?.version ?? 0] as const)));
      setVersionNumbers(Object.fromEntries(versions));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os quizzes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => quizzes.filter((quiz) => productFilter === 'all' || (productFilter === 'none' ? !quiz.product_id : quiz.product_id === productFilter)), [quizzes, productFilter]);

  async function copyLink(quiz: Quiz) {
    await navigator.clipboard.writeText(`${window.location.origin}/q/${quiz.slug}`);
    setCopiedId(quiz.id);
    setTimeout(() => setCopiedId(null), 1_500);
  }

  async function run(quiz: Quiz, action: () => Promise<void>, failure: string) {
    if (mutatingId) return;
    setMutatingId(quiz.id);
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : failure); }
    finally { setMutatingId(null); }
  }

  if (loading) return <LoadingView label="Carregando quizzes..." />;
  if (error && quizzes.length === 0) return <ErrorView message={error} onRetry={() => void load()} />;

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><ListChecks size={20} className="text-[var(--color-brand)]" /><h1 className="text-xl font-semibold text-[var(--color-text)]">Quiz de qualificação</h1></div><p className="mt-1 text-sm text-[var(--color-text-muted)]">Monte fluxos visuais com perguntas, condições e automações, e mande cada lead para o destino certo.</p></div>
        <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"><Plus size={15} /> Novo quiz</button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">{error}</p>}

      {products.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[['all', 'Todos'], ...products.map((product) => [product.id, product.name]), ['none', 'Sem produto']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setProductFilter(id)} className={`rounded-full px-3 py-1 text-xs ${productFilter === id ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-panel)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{label}</button>
          ))}
        </div>
      )}

      {quizzes.length === 0 ? (
        <EmptyView title="Nenhum quiz criado" description="Comece pelo modelo de pré-qualificação de disparo e ajuste o fluxo no editor visual." action={<button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white">Criar quiz</button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((quiz) => {
            const stat = stats[quiz.id] ?? { started: 0, completed: 0, qualified: 0, last_at: null };
            const product = products.find((item) => item.id === quiz.product_id);
            const version = versionNumbers[quiz.id];
            return (
              <article key={quiz.id} className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{quiz.name}</h3>
                      {!quiz.active ? <span className="rounded-full bg-[var(--color-panel-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-faint)]">Pausado</span> : version ? <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[10px] text-[var(--color-good)]">No ar · v{version}</span> : <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[10px] text-[var(--color-warn)]">Rascunho · não publicado</span>}
                      {product && <span className="rounded-full bg-[var(--color-panel-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">{product.name}</span>}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-[var(--color-brand)]">{window.location.origin}/q/{quiz.slug}</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                  {[
                    ['Iniciados', stat.started.toLocaleString('pt-BR'), ''],
                    ['Concluídos', stat.completed.toLocaleString('pt-BR'), `${percent(stat.completed, stat.started)}%`],
                    ['Qualificados', stat.qualified.toLocaleString('pt-BR'), `${percent(stat.qualified, stat.completed)}%`],
                    ['Abandono', (stat.started - stat.completed).toLocaleString('pt-BR'), `${percent(stat.started - stat.completed, stat.started)}%`],
                  ].map(([label, value, rate]) => (
                    <div key={label} className="rounded-lg bg-[var(--color-bg)] px-2 py-2">
                      <dt className="text-[10px] text-[var(--color-text-faint)]">{label}</dt>
                      <dd className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{value}</dd>
                      {rate && <dd className="text-[10px] tabular-nums text-[var(--color-text-muted)]">{rate}</dd>}
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => navigate(`/agency/ferramentas/quiz/${quiz.id}`)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-2.5 py-1.5 text-xs font-medium text-white hover:brightness-110"><GitBranch size={13} /> Editar fluxo</button>
                  <button type="button" onClick={() => setViewing(quiz)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><Users size={13} /> Resultados</button>
                  <button type="button" onClick={() => void copyLink(quiz)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]">{copiedId === quiz.id ? <Check size={13} className="text-[var(--color-good)]" /> : <Copy size={13} />}{copiedId === quiz.id ? 'Copiado' : 'Copiar'}</button>
                  {version ? <a href={`/q/${quiz.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><ExternalLink size={13} /> Abrir</a> : null}
                  <button type="button" onClick={() => void run(quiz, async () => { const copy = await duplicateQuiz(quiz); navigate(`/agency/ferramentas/quiz/${copy.id}`); }, 'Não foi possível duplicar.')} disabled={Boolean(mutatingId)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]"><CopyPlus size={13} /> Duplicar</button>
                  <button type="button" onClick={() => void run(quiz, async () => { const updated = await setQuizActive(quiz.id, !quiz.active); setQuizzes((current) => current.map((item) => item.id === quiz.id ? updated : item)); }, 'Não foi possível alterar o quiz.')} disabled={Boolean(mutatingId)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]"><Power size={13} /> {quiz.active ? 'Pausar' : 'Ativar'}</button>
                  <button type="button" onClick={() => { if (window.confirm(`Excluir o quiz “${quiz.name}”? O link deixará de funcionar e todas as respostas e versões serão apagadas.`)) void run(quiz, async () => { await deleteQuiz(quiz.id); setQuizzes((current) => current.filter((item) => item.id !== quiz.id)); }, 'Não foi possível excluir.'); }} disabled={Boolean(mutatingId)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]">{mutatingId === quiz.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {creating && <NewQuizModal products={products} onClose={() => setCreating(false)} onCreated={(quiz) => navigate(`/agency/ferramentas/quiz/${quiz.id}`)} />}
      {viewing && <ResultsModal quiz={viewing} onClose={() => setViewing(null)} />}
    </main>
  );
}

function NewQuizModal({ products, onClose, onCreated }: { products: QuizProductRow[]; onClose: () => void; onCreated: (quiz: Quiz) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [productId, setProductId] = useState('');
  const [template, setTemplate] = useState<QuizTemplate>('disparo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try { onCreated(await createQuiz({ name, slug: slug || name, title: name, product_id: productId || null, template })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível criar o quiz.'); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="new-quiz-title" className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-2xl">
        <div className="flex items-start justify-between"><h2 id="new-quiz-title" className="font-semibold text-[var(--color-text)]">Novo quiz</h2><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={17} /></button></div>
        <div className="mt-4 space-y-3">
          <div><label className={labelClass}>Nome</label><input value={name} onChange={(event) => { setName(event.target.value); if (!slugTouched) setSlug(normalizeRedirectSlug(event.target.value)); }} className={inputClass} placeholder="Ex.: Diagnóstico de tráfego pago" required autoFocus /></div>
          <div><label className={labelClass}>Link público</label><div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-3 text-xs text-[var(--color-text-faint)]"><span className="whitespace-nowrap">{window.location.origin}/q/</span><input value={slug} onChange={(event) => { setSlugTouched(true); setSlug(normalizeRedirectSlug(event.target.value)); }} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-[var(--color-brand)] outline-none" required /></div></div>
          {products.length > 0 && <div><label className={labelClass}>Produto</label><select value={productId} onChange={(event) => setProductId(event.target.value)} className={inputClass}><option value="">— Sem produto —</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></div>}
          <div>
            <label className={labelClass}>Começar de</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {([['disparo', 'Qualificação de disparo', 'Nome, WhatsApp, empresa e volume, com regra de 1.000 contatos e tela inicial.'], ['blank', 'Em branco', 'Só o início, uma pergunta de nome e a tela final.']] as const).map(([value, label, description]) => (
                <button key={value} type="button" onClick={() => setTemplate(value)} className={`rounded-xl border p-3 text-left ${template === value ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] bg-[var(--color-bg)]'}`}>
                  <p className="text-sm font-medium text-[var(--color-text)]">{label}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{description}</p>
                </button>
              ))}
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-[var(--color-bad)]">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancelar</button><button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 size={14} className="animate-spin" />} Criar e abrir editor</button></div>
      </form>
    </div>
  );
}

type AnswerRow = { node_id: string; variable: string; label: string; display: string };

function csvCell(value: string) {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function ResultsModal({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  const [tab, setTab] = useState<'leads' | 'webhooks'>('leads');
  const [sessions, setSessions] = useState<QuizSessionRow[] | null>(null);
  const [deliveries, setDeliveries] = useState<QuizWebhookDeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'completed' | 'qualified' | 'disqualified' | 'abandoned' | 'all'>('completed');

  useEffect(() => {
    void Promise.all([listQuizSessions(quiz.id), listQuizWebhookDeliveries(quiz.id)])
      .then(([sessionRows, deliveryRows]) => { setSessions(sessionRows); setDeliveries(deliveryRows); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os resultados.'));
  }, [quiz.id]);

  const answersOf = (row: QuizSessionRow) => (Array.isArray(row.answers) ? row.answers : []) as unknown as AnswerRow[];
  const visible = (sessions ?? []).filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'abandoned') return row.status === 'started';
    if (row.status !== 'completed') return false;
    if (filter === 'qualified') return row.qualified === true;
    if (filter === 'disqualified') return row.qualified !== true;
    return true;
  });

  function exportCsv() {
    const variables = [...new Set(visible.flatMap((row) => answersOf(row).map((answer) => answer.variable)))];
    const header = ['Início', 'Status', 'Qualificado', 'Pontuação', 'Tags', 'Nome', 'WhatsApp', 'E-mail', 'Origem', 'Campanha', 'Dispositivo', ...variables];
    const lines = visible.map((row) => {
      const byVariable = new Map(answersOf(row).map((answer) => [answer.variable, answer.display]));
      const utm = (row.utm ?? {}) as Record<string, string>;
      return [new Date(row.started_at).toLocaleString('pt-BR'), row.status === 'completed' ? 'Concluído' : 'Abandonado', row.qualified === true ? 'Sim' : row.qualified === false ? 'Não' : '', String(row.score ?? 0), (row.tags ?? []).join(', '), row.contact_name ?? '', row.contact_phone ?? '', row.contact_email ?? '', utm.utm_source ?? '', utm.utm_campaign ?? '', row.device ?? '', ...variables.map((variable) => byVariable.get(variable) ?? '')];
    });
    const csv = [header, ...lines].map((line) => line.map((cell) => csvCell(String(cell))).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${quiz.slug}-resultados.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="quiz-results-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="quiz-results-title" className="font-semibold text-[var(--color-text)]">Resultados · {quiz.name}</h2><p className="text-xs text-[var(--color-text-muted)]">{sessions ? `${sessions.length.toLocaleString('pt-BR')} sessões${sessions.length === 2000 ? ' (as 2.000 mais recentes)' : ''}` : 'Carregando...'}</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={17} /></button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
            <button type="button" onClick={() => setTab('leads')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${tab === 'leads' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}><Users size={12} /> Leads</button>
            <button type="button" onClick={() => setTab('webhooks')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${tab === 'webhooks' ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)]'}`}><Webhook size={12} /> Webhooks{deliveries?.some((item) => !item.ok) ? ' ⚠' : ''}</button>
          </div>
          {tab === 'leads' && (
            <>
              <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)]" aria-label="Filtrar sessões">
                <option value="completed">Concluídos</option>
                <option value="qualified">Qualificados</option>
                <option value="disqualified">Não qualificados</option>
                <option value="abandoned">Abandonados (com o que responderam)</option>
                <option value="all">Todos</option>
              </select>
              <button type="button" onClick={exportCsv} disabled={!visible.length} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)] disabled:opacity-40"><Download size={13} /> Exportar CSV</button>
            </>
          )}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-border)]">
          {error ? <p className="p-4 text-xs text-[var(--color-bad)]">{error}</p> : !sessions || !deliveries ? <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[var(--color-brand)]" /></div> : tab === 'leads' ? (
            visible.length === 0 ? <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">Nenhuma sessão neste filtro.</p> : (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[var(--color-panel-2)] text-[var(--color-text-muted)]"><tr><th className="px-3 py-2 font-medium">Data</th><th className="px-3 py-2 font-medium">Resultado</th><th className="px-3 py-2 font-medium">Contato</th><th className="px-3 py-2 font-medium">Origem</th><th className="px-3 py-2 font-medium">Respostas</th></tr></thead>
                <tbody>
                  {visible.map((row) => {
                    const utm = (row.utm ?? {}) as Record<string, string>;
                    return (
                      <tr key={row.id} className="border-t border-[var(--color-border-soft)] align-top text-[var(--color-text)]">
                        <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text-muted)]">{new Date(row.started_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{row.device && <p className="text-[10px]">{row.device === 'mobile' ? 'Celular' : 'Computador'}</p>}</td>
                        <td className="px-3 py-2">
                          {row.status === 'started' ? <span className="rounded-full bg-[var(--color-panel-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">Abandonou</span> : row.qualified ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[10px] text-[var(--color-good)]"><CheckCircle2 size={10} /> Qualificado</span> : <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-[10px] text-[var(--color-bad)]"><XCircle size={10} /> Não qualificado</span>}
                          {Number(row.score) !== 0 && <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{row.score} pontos</p>}
                          {(row.tags ?? []).length > 0 && <p className="mt-1 flex flex-wrap gap-1">{row.tags.map((tag) => <span key={tag} className="rounded bg-[var(--color-panel-2)] px-1 text-[10px]">{tag}</span>)}</p>}
                        </td>
                        <td className="px-3 py-2">{row.contact_name || '—'}{row.contact_phone && <p><a href={whatsappHref(row.contact_phone)} target="_blank" rel="noreferrer" className="text-[var(--color-brand)] hover:underline">{row.contact_phone}</a></p>}{row.contact_email && <p className="text-[var(--color-text-muted)]">{row.contact_email}</p>}</td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">{utm.utm_source || 'direto'}{utm.utm_campaign && <p className="text-[10px]">{utm.utm_campaign}</p>}</td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">{answersOf(row).map((answer) => <p key={answer.node_id}><span className="text-[var(--color-text-faint)]">{answer.label}:</span> {answer.display || '—'}</p>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : deliveries.length === 0 ? <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">Nenhum webhook enviado ainda.</p> : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[var(--color-panel-2)] text-[var(--color-text-muted)]"><tr><th className="px-3 py-2 font-medium">Data</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Destino</th><th className="px-3 py-2 font-medium">Resposta</th></tr></thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="border-t border-[var(--color-border-soft)] align-top text-[var(--color-text)]">
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text-muted)]">{new Date(delivery.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                    <td className="px-3 py-2">{delivery.ok ? <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[10px] text-[var(--color-good)]">{delivery.status_code} · ok</span> : <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-[10px] text-[var(--color-bad)]">{delivery.status_code ?? 'falhou'}</span>}<p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{delivery.attempts} tentativa{delivery.attempts > 1 ? 's' : ''}</p></td>
                    <td className="max-w-[260px] truncate px-3 py-2 font-mono text-[11px] text-[var(--color-text-muted)]">{delivery.url}</td>
                    <td className="max-w-[320px] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">{delivery.error || delivery.response_snippet || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
