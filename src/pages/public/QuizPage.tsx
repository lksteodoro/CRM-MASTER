import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { getPublicQuiz, submitQuizResponse, type PublicQuiz, type PublicQuizQuestion } from '../../services/quizzes.service';

function validate(question: PublicQuizQuestion, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return question.required ? 'Responda para continuar.' : null;
  if (question.type === 'phone' && trimmed.replace(/\D/g, '').length < 10) return 'Informe o número com DDD.';
  if (question.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Informe um e-mail válido.';
  if (question.type === 'number' && !/^\d[\d.]*(,\d+)?$/.test(trimmed)) return 'Informe apenas números.';
  return null;
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
  return `+${digits}`;
}

function formatNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return digits ? Number(digits).toLocaleString('pt-BR') : '';
}

export function QuizPage() {
  const { slug = '' } = useParams();
  const [quiz, setQuiz] = useState<PublicQuiz | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void getPublicQuiz(slug)
      .then((result) => {
        if (!active) return;
        if (!result || result.questions.length === 0) setLoadError('Este quiz não existe ou está pausado.');
        else setQuiz(result);
      })
      .catch(() => active && setLoadError('Não foi possível abrir este quiz.'));
    return () => { active = false; };
  }, [slug]);

  useEffect(() => { inputRef.current?.focus(); }, [step, quiz]);

  if (loadError) {
    return <Shell><h1 className="text-lg font-semibold text-[var(--color-text)]">Quiz indisponível</h1><p className="mt-2 text-sm text-[var(--color-text-muted)]">{loadError}</p></Shell>;
  }
  if (!quiz) return <Shell><div className="flex justify-center py-10"><Loader2 className="animate-spin text-[var(--color-brand)]" /></div></Shell>;

  if (finished) {
    return <Shell><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-good-soft)] text-[var(--color-good)]"><Check size={22} /></span><h1 className="mt-4 text-lg font-semibold text-[var(--color-text)]">Respostas enviadas</h1><p className="mt-2 text-sm text-[var(--color-text-muted)]">Obrigado! Em breve entraremos em contato.</p></Shell>;
  }

  const question = quiz.questions[step];
  const value = answers[question.id] ?? '';
  const isLast = step === quiz.questions.length - 1;
  const progress = Math.round((step / quiz.questions.length) * 100);

  async function advance(nextAnswers: Record<string, string>) {
    if (!quiz) return;
    const problem = validate(question, nextAnswers[question.id] ?? '');
    if (problem) { setFieldError(problem); return; }
    setFieldError(null);
    if (!isLast) { setStep((current) => current + 1); return; }
    setSubmitting(true);
    try {
      const result = await submitQuizResponse(slug, nextAnswers);
      // O redirecionador conta o acesso e escolhe o destino (inclusive em rodízio).
      if (result.redirect_slug) window.location.replace(`/r/${result.redirect_slug}`);
      else setFinished(true);
    } catch {
      setFieldError('Não foi possível enviar agora. Tente de novo.');
      setSubmitting(false);
    }
  }

  function setValue(next: string) {
    const formatted = question.type === 'phone' ? formatPhone(next) : question.type === 'number' ? formatNumber(next) : next;
    setAnswers((current) => ({ ...current, [question.id]: formatted }));
    setFieldError(null);
  }

  function choose(optionId: string) {
    if (submitting) return;
    const next = { ...answers, [question.id]: optionId };
    setAnswers(next);
    void advance(next);
  }

  return (
    <Shell>
      <div className="text-left">
        {step === 0 && (
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-[var(--color-text)]">{quiz.title}</h1>
            {quiz.description && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{quiz.description}</p>}
          </div>
        )}
        <div className="mb-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]"><div className="h-full rounded-full bg-[var(--color-brand)] transition-all duration-300" style={{ width: `${progress}%` }} /></div>
          <span className="text-[11px] text-[var(--color-text-faint)]">{step + 1}/{quiz.questions.length}</span>
        </div>

        <form key={question.id} onSubmit={(event) => { event.preventDefault(); void advance(answers); }}>
          <label htmlFor={`quiz-${question.id}`} className="block text-base font-medium text-[var(--color-text)]">{question.label}{!question.required && <span className="ml-1 text-xs font-normal text-[var(--color-text-faint)]">(opcional)</span>}</label>

          {question.type === 'choice' ? (
            <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label={question.label}>
              {(question.options ?? []).map((option, index) => (
                <button key={option.id} type="button" role="radio" aria-checked={value === option.id} disabled={submitting} onClick={() => choose(option.id)} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:opacity-60 ${value === option.id ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-text)]' : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:border-[var(--color-brand)]'}`}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-muted)]">{String.fromCharCode(65 + index)}</span>
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <input
              id={`quiz-${question.id}`}
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              type={question.type === 'email' ? 'email' : 'text'}
              inputMode={question.type === 'phone' ? 'tel' : question.type === 'number' ? 'numeric' : undefined}
              autoComplete={question.type === 'name' ? 'name' : question.type === 'phone' ? 'tel' : question.type === 'email' ? 'email' : 'off'}
              placeholder={question.placeholder || 'Digite sua resposta'}
              disabled={submitting}
              className="mt-4 w-full border-b-2 border-[var(--color-border)] bg-transparent py-2 text-lg text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-brand)]"
            />
          )}

          {fieldError && <p role="alert" className="mt-3 text-xs text-[var(--color-bad)]">{fieldError}</p>}

          <div className="mt-6 flex items-center justify-between">
            {step > 0 ? <button type="button" disabled={submitting} onClick={() => { setFieldError(null); setStep((current) => current - 1); }} className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><ArrowLeft size={14} /> Voltar</button> : <span />}
            {question.type !== 'choice' && (
              <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : isLast ? <Check size={15} /> : <ArrowRight size={15} />}
                {isLast ? 'Enviar' : 'Continuar'}
              </button>
            )}
            {question.type === 'choice' && submitting && <Loader2 size={16} className="animate-spin text-[var(--color-brand)]" />}
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center shadow-2xl sm:p-8">{children}</div>
    </main>
  );
}
