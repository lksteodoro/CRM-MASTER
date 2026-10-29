import { supabase } from '../integrations/supabase/client';
import type { Json, QuizResponseRow, QuizRow } from '../integrations/supabase/database.types';
import { normalizeRedirectSlug } from './redirectLinks.service';

export type QuizQuestionType = 'name' | 'phone' | 'email' | 'text' | 'number' | 'choice';

export interface QuizOption {
  id: string;
  label: string;
  /** false = quem escolhe esta opção é desqualificado. */
  qualifies: boolean;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  label: string;
  placeholder?: string;
  required: boolean;
  /** Só em 'number': abaixo deste valor o lead é desqualificado. */
  min?: number | null;
  options?: QuizOption[];
}

/** Pergunta como a página pública recebe: sem mínimo e sem a marcação das opções. */
export type PublicQuizQuestion = Omit<QuizQuestion, 'min' | 'options'> & { options?: { id: string; label: string }[] };

export interface Quiz extends Omit<QuizRow, 'questions'> {
  questions: QuizQuestion[];
}

export interface QuizInput {
  name: string;
  slug: string;
  title: string;
  description: string | null;
  questions: QuizQuestion[];
  qualified_link_id: string | null;
  disqualified_link_id: string | null;
  active: boolean;
}

export interface PublicQuiz {
  title: string;
  description: string | null;
  questions: PublicQuizQuestion[];
}

export const quizQuestionTypes: { value: QuizQuestionType; label: string }[] = [
  { value: 'name', label: 'Nome' },
  { value: 'phone', label: 'WhatsApp / telefone' },
  { value: 'email', label: 'E-mail' },
  { value: 'text', label: 'Texto livre' },
  { value: 'number', label: 'Número (com mínimo)' },
  { value: 'choice', label: 'Múltipla escolha' },
];

export function newQuizId() {
  return crypto.randomUUID().slice(0, 8);
}

/** Modelo pronto para pré-qualificar o serviço de disparo (mínimo de 1.000 contatos). */
export function disparoQuizTemplate(): QuizInput {
  return {
    name: 'Pré-qualificação de disparo',
    slug: 'qualificacao-disparo',
    title: 'Vamos ver se o disparo é para você',
    description: 'Responda em menos de 1 minuto.',
    active: true,
    qualified_link_id: null,
    disqualified_link_id: null,
    questions: [
      { id: newQuizId(), type: 'name', label: 'Qual é o seu nome?', required: true },
      { id: newQuizId(), type: 'phone', label: 'Qual é o seu WhatsApp?', placeholder: '(11) 99999-9999', required: true },
      { id: newQuizId(), type: 'text', label: 'Qual é a sua empresa?', required: false },
      {
        id: newQuizId(),
        type: 'choice',
        label: 'Quantos contatos você quer atingir em um único disparo?',
        required: true,
        options: [
          { id: newQuizId(), label: 'Menos de 1.000', qualifies: false },
          { id: newQuizId(), label: 'De 1.000 a 5.000', qualifies: true },
          { id: newQuizId(), label: 'De 5.000 a 20.000', qualifies: true },
          { id: newQuizId(), label: 'Mais de 20.000', qualifies: true },
        ],
      },
    ],
  };
}

function toQuiz(row: QuizRow): Quiz {
  return { ...row, questions: Array.isArray(row.questions) ? (row.questions as unknown as QuizQuestion[]) : [] };
}

function normalizedInput(input: QuizInput): QuizInput {
  const name = input.name.trim();
  const title = input.title.trim();
  const slug = normalizeRedirectSlug(input.slug);
  if (!name) throw new Error('Informe um nome para identificar o quiz.');
  if (!title) throw new Error('Informe o título que o lead vai ver.');
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) throw new Error('O endereço do quiz deve ter entre 3 e 80 caracteres.');
  if (input.questions.length === 0) throw new Error('Adicione pelo menos uma pergunta.');
  const questions = input.questions.map((question, index) => {
    const label = question.label.trim();
    if (!label) throw new Error(`A pergunta ${index + 1} está sem texto.`);
    const clean: QuizQuestion = { id: question.id, type: question.type, label, required: question.required };
    if (question.placeholder?.trim()) clean.placeholder = question.placeholder.trim();
    if (question.type === 'number' && question.min !== null && question.min !== undefined && !Number.isNaN(question.min)) {
      clean.min = question.min;
    }
    if (question.type === 'choice') {
      const options = (question.options ?? [])
        .map((option) => ({ ...option, label: option.label.trim() }))
        .filter((option) => option.label);
      if (options.length < 2) throw new Error(`A pergunta ${index + 1} precisa de pelo menos duas opções.`);
      clean.options = options;
    }
    return clean;
  });
  if (!input.qualified_link_id) throw new Error('Escolha o link de quem for qualificado.');
  return { ...input, name, title, slug, description: input.description?.trim() || null, questions };
}

export async function listQuizzes(): Promise<Quiz[]> {
  const { data, error } = await supabase.from('quizzes').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toQuiz);
}

export async function createQuiz(input: QuizInput): Promise<Quiz> {
  const clean = normalizedInput(input);
  const { data, error } = await supabase
    .from('quizzes')
    .insert({ ...clean, questions: clean.questions as unknown as Json })
    .select()
    .single();
  if (error) throw error;
  return toQuiz(data);
}

export async function updateQuiz(quizId: string, input: QuizInput): Promise<Quiz> {
  const clean = normalizedInput(input);
  const { data, error } = await supabase
    .from('quizzes')
    .update({ ...clean, questions: clean.questions as unknown as Json })
    .eq('id', quizId)
    .select()
    .single();
  if (error) throw error;
  return toQuiz(data);
}

export async function setQuizActive(quizId: string, active: boolean): Promise<Quiz> {
  const { data, error } = await supabase.from('quizzes').update({ active }).eq('id', quizId).select().single();
  if (error) throw error;
  return toQuiz(data);
}

export async function deleteQuiz(quizId: string) {
  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  if (error) throw error;
}

export async function listQuizResponses(quizId: string): Promise<QuizResponseRow[]> {
  const { data, error } = await supabase
    .from('quiz_responses')
    .select('*')
    .eq('quiz_id', quizId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data ?? [];
}

export async function getPublicQuiz(slug: string): Promise<PublicQuiz | null> {
  const { data, error } = await supabase.rpc('get_public_quiz', { p_slug: normalizeRedirectSlug(slug) });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return { ...row, questions: row.questions as unknown as PublicQuizQuestion[] };
}

export async function submitQuizResponse(
  slug: string,
  answers: Record<string, string>
): Promise<{ qualified: boolean; redirect_slug: string | null }> {
  const { data, error } = await supabase.rpc('submit_quiz_response', {
    p_slug: normalizeRedirectSlug(slug),
    p_answers: answers,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error('Não foi possível enviar suas respostas.');
  return row;
}
