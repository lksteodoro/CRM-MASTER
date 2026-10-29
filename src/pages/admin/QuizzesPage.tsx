import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, CheckCircle2, Copy, Download, ExternalLink, ListChecks, Loader2, Pencil, Plus, Power, Trash2, Users, X, XCircle } from 'lucide-react';
import { listClients } from '../../services/clients.service';
import { listRedirectLinks, normalizeRedirectSlug, type RedirectLinkWithDestinations } from '../../services/redirectLinks.service';
import {
  createQuiz,
  deleteQuiz,
  disparoQuizTemplate,
  listQuizResponses,
  listQuizzes,
  newQuizId,
  quizQuestionTypes,
  setQuizActive,
  updateQuiz,
  type Quiz,
  type QuizInput,
  type QuizQuestion,
  type QuizQuestionType,
} from '../../services/quizzes.service';
import type { ClientRow, QuizResponseRow } from '../../integrations/supabase/database.types';
import { EmptyView, ErrorView, LoadingView } from '../../components/ui/StateView';

const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';

function emptyQuiz(): QuizInput {
  return { name: '', slug: '', title: '', description: null, active: true, qualified_link_id: null, disqualified_link_id: null, questions: [{ id: newQuizId(), type: 'name', label: 'Qual é o seu nome?', required: true }] };
}

function linkLabel(link: RedirectLinkWithDestinations | undefined, clients: ClientRow[]) {
  if (!link) return 'Link removido';
  const client = clients.find((item) => item.id === link.client_id);
  return `${client ? `${client.name} · ` : ''}${link.name}`;
}

export function QuizzesPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [links, setLinks] = useState<RedirectLinkWithDestinations[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ quiz: Quiz | null; initial: QuizInput } | null>(null);
  const [viewing, setViewing] = useState<Quiz | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientRows, linkRows, quizRows] = await Promise.all([listClients(), listRedirectLinks(), listQuizzes()]);
      setClients(clientRows);
      setLinks(linkRows);
      setQuizzes(quizRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os quizzes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function copyLink(quiz: Quiz) {
    await navigator.clipboard.writeText(`${window.location.origin}/q/${quiz.slug}`);
    setCopiedId(quiz.id);
    setTimeout(() => setCopiedId(null), 1_500);
  }

  async function toggleActive(quiz: Quiz) {
    if (mutatingId) return;
    setMutatingId(quiz.id);
    try {
      const updated = await setQuizActive(quiz.id, !quiz.active);
      setQuizzes((current) => current.map((item) => item.id === quiz.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível alterar o quiz.');
    } finally { setMutatingId(null); }
  }

  async function remove(quiz: Quiz) {
    if (!window.confirm(`Excluir o quiz “${quiz.name}”? O link deixará de funcionar e as respostas serão apagadas.`)) return;
    setMutatingId(quiz.id);
    try {
      await deleteQuiz(quiz.id);
      setQuizzes((current) => current.filter((item) => item.id !== quiz.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível excluir o quiz.');
    } finally { setMutatingId(null); }
  }

  function edit(quiz: Quiz) {
    setEditing({ quiz, initial: { name: quiz.name, slug: quiz.slug, title: quiz.title, description: quiz.description, active: quiz.active, qualified_link_id: quiz.qualified_link_id, disqualified_link_id: quiz.disqualified_link_id, questions: quiz.questions } });
  }

  if (loading) return <LoadingView label="Carregando quizzes..." />;
  if (error && quizzes.length === 0 && links.length === 0) return <ErrorView message={error} onRetry={() => void load()} />;

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><ListChecks size={20} className="text-[var(--color-brand)]" /><h1 className="text-xl font-semibold text-[var(--color-text)]">Quiz de qualificação</h1></div><p className="mt-1 text-sm text-[var(--color-text-muted)]">Monte perguntas no estilo Typebot e mande cada lead para um link do redirecionador conforme a resposta.</p></div>
        <button type="button" onClick={() => setEditing({ quiz: null, initial: emptyQuiz() })} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"><Plus size={15} /> Novo quiz</button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">{error}</p>}
      {links.length === 0 && <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-muted)]">Crie antes um link no Redirecionador: é para ele que o quiz manda o lead qualificado.</p>}

      {quizzes.length === 0 ? <EmptyView title="Nenhum quiz criado" description="Comece pelo modelo de pré-qualificação de disparo (mínimo de 1.000 contatos) e ajuste as perguntas." action={<button type="button" onClick={() => setEditing({ quiz: null, initial: disparoQuizTemplate() })} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white">Usar modelo de disparo</button>} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {quizzes.map((quiz) => {
            const rate = quiz.response_count ? Math.round((quiz.qualified_count / quiz.response_count) * 100) : 0;
            return (
              <article key={quiz.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{quiz.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${quiz.active ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]' : 'bg-[var(--color-panel-2)] text-[var(--color-text-faint)]'}`}>{quiz.active ? 'Ativo' : 'Pausado'}</span></div><p className="mt-1 truncate font-mono text-xs text-[var(--color-brand)]">{window.location.origin}/q/{quiz.slug}</p></div><button type="button" onClick={() => edit(quiz)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label={`Editar ${quiz.name}`}><Pencil size={14} /></button></div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[var(--color-text-muted)]"><span className="rounded-full bg-[var(--color-panel-2)] px-2 py-1">{quiz.questions.length} pergunta{quiz.questions.length === 1 ? '' : 's'}</span><span className="rounded-full bg-[var(--color-panel-2)] px-2 py-1">{quiz.response_count.toLocaleString('pt-BR')} respostas</span><span className="rounded-full bg-[var(--color-good-soft)] px-2 py-1 text-[var(--color-good)]">{quiz.qualified_count.toLocaleString('pt-BR')} qualificados ({rate}%)</span></div>
                <div className="mt-3 space-y-1 border-t border-[var(--color-border-soft)] pt-3 text-xs">
                  <p className="flex min-w-0 items-center gap-2"><CheckCircle2 size={13} className="shrink-0 text-[var(--color-good)]" /><span className="text-[var(--color-text-faint)]">Qualificado →</span><span className="truncate text-[var(--color-text-muted)]">{quiz.qualified_link_id ? linkLabel(links.find((link) => link.id === quiz.qualified_link_id), clients) : 'Sem link'}</span></p>
                  <p className="flex min-w-0 items-center gap-2"><XCircle size={13} className="shrink-0 text-[var(--color-bad)]" /><span className="text-[var(--color-text-faint)]">Não qualificado →</span><span className="truncate text-[var(--color-text-muted)]">{quiz.disqualified_link_id ? linkLabel(links.find((link) => link.id === quiz.disqualified_link_id), clients) : 'Mensagem de agradecimento'}</span></p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setViewing(quiz)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><Users size={13} /> Respostas</button><button type="button" onClick={() => void copyLink(quiz)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]">{copiedId === quiz.id ? <Check size={13} className="text-[var(--color-good)]" /> : <Copy size={13} />}{copiedId === quiz.id ? 'Copiado' : 'Copiar'}</button><a href={`/q/${quiz.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"><ExternalLink size={13} /> Testar</a><button type="button" onClick={() => void toggleActive(quiz)} disabled={Boolean(mutatingId)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]"><Power size={13} /> {quiz.active ? 'Pausar' : 'Ativar'}</button><button type="button" onClick={() => void remove(quiz)} disabled={Boolean(mutatingId)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]">{mutatingId === quiz.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir</button></div>
              </article>
            );
          })}
        </div>
      )}

      {editing && <QuizModal quiz={editing.quiz} initial={editing.initial} links={links} clients={clients} onClose={() => setEditing(null)} onSaved={(saved) => { setQuizzes((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]); setEditing(null); }} />}
      {viewing && <ResponsesModal quiz={viewing} onClose={() => setViewing(null)} />}
    </main>
  );
}

function QuizModal({ quiz, initial, links, clients, onClose, onSaved }: { quiz: Quiz | null; initial: QuizInput; links: RedirectLinkWithDestinations[]; clients: ClientRow[]; onClose: () => void; onSaved: (quiz: Quiz) => void }) {
  const [form, setForm] = useState<QuizInput>(initial);
  const [slugTouched, setSlugTouched] = useState(Boolean(quiz) || Boolean(initial.slug));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkOptions = useMemo(() => links.map((link) => ({ id: link.id, label: `${linkLabel(link, clients)}${link.active ? '' : ' (pausado)'}` })), [links, clients]);

  function updateQuestion(index: number, patch: Partial<QuizQuestion>) {
    setForm((current) => ({ ...current, questions: current.questions.map((question, itemIndex) => itemIndex === index ? { ...question, ...patch } : question) }));
  }
  function changeType(index: number, type: QuizQuestionType) {
    const question = form.questions[index];
    updateQuestion(index, {
      type,
      min: type === 'number' ? question.min ?? 1000 : undefined,
      options: type === 'choice' ? (question.options?.length ? question.options : [{ id: newQuizId(), label: 'Opção 1', qualifies: true }, { id: newQuizId(), label: 'Opção 2', qualifies: true }]) : undefined,
    });
  }
  function moveQuestion(index: number, delta: number) {
    setForm((current) => {
      const questions = [...current.questions];
      const target = index + delta;
      if (target < 0 || target >= questions.length) return current;
      [questions[index], questions[target]] = [questions[target], questions[index]];
      return { ...current, questions };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try { onSaved(quiz ? await updateQuiz(quiz.id, form) : await createQuiz(form)); }
    catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Não foi possível salvar o quiz.';
      setError(/duplicate key|quizzes_slug_key/.test(message) ? 'Já existe um quiz com esse endereço. Escolha outro.' : message);
    }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"><form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="quiz-modal-title" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl sm:p-6">
    <div className="flex items-start justify-between"><div><h2 id="quiz-modal-title" className="font-semibold text-[var(--color-text)]">{quiz ? 'Editar quiz' : 'Novo quiz'}</h2><p className="text-xs text-[var(--color-text-muted)]">Perguntas, regra de qualificação e para onde cada lead vai.</p></div><div className="flex items-center gap-2">{!quiz && <button type="button" onClick={() => { setForm(disparoQuizTemplate()); setSlugTouched(true); }} className="text-xs text-[var(--color-brand)] hover:underline">Usar modelo de disparo</button>}<button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={17} /></button></div></div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <div><label className={labelClass}>Nome interno</label><input value={form.name} onChange={(event) => { const name = event.target.value; setForm((current) => ({ ...current, name, slug: slugTouched ? current.slug : normalizeRedirectSlug(name) })); }} className={inputClass} placeholder="Ex: Pré-qualificação de disparo" required /></div>
      <div><label className={labelClass}>Link público</label><div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] pl-3 text-xs text-[var(--color-text-faint)]"><span className="whitespace-nowrap">{window.location.origin}/q/</span><input value={form.slug} onChange={(event) => { setSlugTouched(true); setForm((current) => ({ ...current, slug: normalizeRedirectSlug(event.target.value) })); }} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-[var(--color-brand)] outline-none" required /></div></div>
      <div><label className={labelClass}>Título que o lead vê</label><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} placeholder="Ex: Vamos ver se o disparo é para você" required /></div>
      <div><label className={labelClass}>Subtítulo (opcional)</label><input value={form.description ?? ''} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className={inputClass} placeholder="Ex: Responda em menos de 1 minuto." /></div>
    </div>

    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-[var(--color-good)]/40 bg-[var(--color-good-soft)] p-3"><label className={labelClass}><span className="inline-flex items-center gap-1 text-[var(--color-good)]"><CheckCircle2 size={13} /> Qualificado vai para</span></label><select value={form.qualified_link_id ?? ''} onChange={(event) => setForm((current) => ({ ...current, qualified_link_id: event.target.value || null }))} className={inputClass} required><option value="">— Escolha um link do redirecionador —</option>{linkOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
      <div className="rounded-xl border border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] p-3"><label className={labelClass}><span className="inline-flex items-center gap-1 text-[var(--color-bad)]"><XCircle size={13} /> Não qualificado vai para</span></label><select value={form.disqualified_link_id ?? ''} onChange={(event) => setForm((current) => ({ ...current, disqualified_link_id: event.target.value || null }))} className={inputClass}><option value="">— Mensagem de agradecimento —</option>{linkOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
    </div>

    <div className="mt-5 flex items-center justify-between"><div><h3 className="text-sm font-medium text-[var(--color-text)]">Perguntas</h3><p className="text-[11px] text-[var(--color-text-muted)]">Uma por tela, nesta ordem. O lead é desqualificado se escolher uma opção marcada como “desqualifica” ou digitar um número abaixo do mínimo.</p></div><button type="button" onClick={() => setForm((current) => ({ ...current, questions: [...current.questions, { id: newQuizId(), type: 'text', label: '', required: true }] }))} className="shrink-0 text-xs text-[var(--color-brand)] hover:underline">+ Adicionar pergunta</button></div>

    <div className="mt-3 space-y-3">
      {form.questions.map((question, index) => (
        <div key={question.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
          <div className="grid gap-2 sm:grid-cols-[32px_1fr_200px_auto]">
            <span className="flex h-9 w-8 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-xs font-semibold text-[var(--color-brand)]">{index + 1}</span>
            <input value={question.label} onChange={(event) => updateQuestion(index, { label: event.target.value })} className={inputClass} placeholder="Texto da pergunta" required />
            <select value={question.type} onChange={(event) => changeType(index, event.target.value as QuizQuestionType)} className={inputClass} aria-label={`Tipo da pergunta ${index + 1}`}>{quizQuestionTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => moveQuestion(index, -1)} disabled={index === 0} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] disabled:opacity-30" aria-label="Subir pergunta"><ArrowUp size={14} /></button>
              <button type="button" onClick={() => moveQuestion(index, 1)} disabled={index === form.questions.length - 1} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)] disabled:opacity-30" aria-label="Descer pergunta"><ArrowDown size={14} /></button>
              {form.questions.length > 1 && <button type="button" onClick={() => setForm((current) => ({ ...current, questions: current.questions.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-lg p-2 text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]" aria-label={`Remover pergunta ${index + 1}`}><Trash2 size={14} /></button>}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 sm:pl-10">
            {question.type !== 'choice' && <input value={question.placeholder ?? ''} onChange={(event) => updateQuestion(index, { placeholder: event.target.value })} className={`${inputClass} max-w-xs`} placeholder="Texto de exemplo no campo (opcional)" />}
            {question.type === 'number' && <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">Mínimo para qualificar<input type="number" min={0} value={question.min ?? ''} onChange={(event) => updateQuestion(index, { min: Number.isNaN(event.target.valueAsNumber) ? null : event.target.valueAsNumber })} className={`${inputClass} w-28`} placeholder="1000" /></label>}
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(index, { required: event.target.checked })} /> Obrigatória</label>
          </div>

          {question.type === 'choice' && (
            <div className="mt-2 space-y-1.5 sm:pl-10">
              {(question.options ?? []).map((option, optionIndex) => (
                <div key={option.id} className="flex items-center gap-2">
                  <span className="w-5 text-center text-[11px] font-semibold text-[var(--color-text-faint)]">{String.fromCharCode(65 + optionIndex)}</span>
                  <input value={option.label} onChange={(event) => updateQuestion(index, { options: question.options?.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item) })} className={inputClass} placeholder={`Opção ${optionIndex + 1}`} />
                  <button type="button" onClick={() => updateQuestion(index, { options: question.options?.map((item) => item.id === option.id ? { ...item, qualifies: !item.qualifies } : item) })} className={`shrink-0 rounded-lg px-2.5 py-2 text-[11px] font-medium ${option.qualifies ? 'bg-[var(--color-good-soft)] text-[var(--color-good)]' : 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]'}`} title="Clique para alternar">{option.qualifies ? 'Qualifica' : 'Desqualifica'}</button>
                  {(question.options?.length ?? 0) > 2 && <button type="button" onClick={() => updateQuestion(index, { options: question.options?.filter((item) => item.id !== option.id) })} className="rounded-lg p-2 text-[var(--color-text-faint)] hover:bg-[var(--color-panel-2)]" aria-label="Remover opção"><X size={13} /></button>}
                </div>
              ))}
              <button type="button" onClick={() => updateQuestion(index, { options: [...(question.options ?? []), { id: newQuizId(), label: '', qualifies: true }] })} className="pl-7 text-xs text-[var(--color-brand)] hover:underline">+ Adicionar opção</button>
            </div>
          )}
        </div>
      ))}
    </div>

    <label className="mt-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Quiz ativo (link público funcionando)</label>
    {error && <p role="alert" className="mt-4 text-xs text-[var(--color-bad)]">{error}</p>}
    <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancelar</button><button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 size={14} className="animate-spin" />}{quiz ? 'Salvar alterações' : 'Criar quiz'}</button></div>
  </form></div>;
}

function csvCell(value: string) {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function ResponsesModal({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  const [rows, setRows] = useState<QuizResponseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'qualified' | 'disqualified'>('all');

  useEffect(() => {
    void listQuizResponses(quiz.id).then(setRows).catch((caught) => setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as respostas.'));
  }, [quiz.id]);

  const visible = (rows ?? []).filter((row) => filter === 'all' || (filter === 'qualified') === row.qualified);
  const answersOf = (row: QuizResponseRow) => (Array.isArray(row.answers) ? row.answers : []) as { question_id: string; label: string; value: string }[];

  function exportCsv() {
    const header = ['Data', 'Qualificado', ...quiz.questions.map((question) => question.label)];
    const lines = visible.map((row) => {
      const byQuestion = new Map(answersOf(row).map((answer) => [answer.question_id, answer.value]));
      return [new Date(row.created_at).toLocaleString('pt-BR'), row.qualified ? 'Sim' : 'Não', ...quiz.questions.map((question) => byQuestion.get(question.id) ?? '')];
    });
    const csv = [header, ...lines].map((line) => line.map((cell) => csvCell(String(cell))).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${quiz.slug}-respostas.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"><div role="dialog" aria-modal="true" aria-labelledby="quiz-responses-title" className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><h2 id="quiz-responses-title" className="font-semibold text-[var(--color-text)]">Respostas · {quiz.name}</h2><p className="text-xs text-[var(--color-text-muted)]">{rows ? `${rows.length.toLocaleString('pt-BR')} resposta${rows.length === 1 ? '' : 's'}${rows.length === 1000 ? ' (as 1.000 mais recentes)' : ''}` : 'Carregando...'}</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]" aria-label="Fechar"><X size={17} /></button></div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">{([['all', 'Todas'], ['qualified', 'Qualificados'], ['disqualified', 'Não qualificados']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-md px-2.5 py-1 text-xs ${filter === value ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>{label}</button>)}</div>
      <button type="button" onClick={exportCsv} disabled={!visible.length} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)] disabled:opacity-40"><Download size={13} /> Exportar CSV</button>
    </div>
    <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--color-border)]">
      {error ? <p className="p-4 text-xs text-[var(--color-bad)]">{error}</p> : !rows ? <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[var(--color-brand)]" /></div> : visible.length === 0 ? <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">Nenhuma resposta ainda.</p> : (
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--color-panel-2)] text-[var(--color-text-muted)]"><tr><th className="px-3 py-2 font-medium">Data</th><th className="px-3 py-2 font-medium">Resultado</th><th className="px-3 py-2 font-medium">Nome</th><th className="px-3 py-2 font-medium">WhatsApp</th><th className="px-3 py-2 font-medium">Respostas</th></tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-t border-[var(--color-border-soft)] align-top text-[var(--color-text)]">
                <td className="whitespace-nowrap px-3 py-2 text-[var(--color-text-muted)]">{new Date(row.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="px-3 py-2">{row.qualified ? <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[10px] text-[var(--color-good)]">Qualificado</span> : <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-[10px] text-[var(--color-bad)]">Não qualificado</span>}</td>
                <td className="px-3 py-2">{row.contact_name || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2">{row.contact_phone ? <a href={`https://wa.me/${row.contact_phone.replace(/\D/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')}`} target="_blank" rel="noreferrer" className="text-[var(--color-brand)] hover:underline">{row.contact_phone}</a> : '—'}</td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">{answersOf(row).filter((answer) => !['name', 'phone'].includes(quiz.questions.find((question) => question.id === answer.question_id)?.type ?? '')).map((answer) => <p key={answer.question_id}><span className="text-[var(--color-text-faint)]">{answer.label}:</span> {answer.value}</p>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div></div>;
}
