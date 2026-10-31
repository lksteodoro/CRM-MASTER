// Edge Function: quiz-runtime
//
// Única porta pública dos quizzes em fluxo (/q/:slug). Sem login.
//
// POST { action: 'load', slug }                         → versão publicada (sem segredos)
// POST { action: 'start', slug, version_id, context, device, referrer } → abre a sessão
// POST { action: 'progress', session_id, answers }      → salva o caminho até agora
// POST { action: 'complete', session_id, answers }      → recalcula e devolve o destino
//
// O navegador só navega. Qualificação, pontuação, tags, webhooks e destino são
// recalculados aqui com o fluxo completo da versão em que a sessão começou.
// Webhooks disparam assim que o caminho passa por eles (captura progressiva),
// uma vez por sessão, com até 3 tentativas e registro em quiz_webhook_deliveries.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  interpolate,
  nodeTitle,
  publicFlow,
  QuizRunError,
  runFlow,
  scopeOf,
  type QuizFlow,
  type QuizNode,
  type RawAnswers,
  type RunResult,
} from '../_shared/quizFlow.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const SLUG = /^[a-z0-9][a-z0-9-]{2,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Session = {
  id: string;
  quiz_id: string;
  version_id: string | null;
  organization_id: string;
  status: 'started' | 'completed';
  utm: Record<string, string>;
  webhooks_fired: string[];
};

function cleanAnswers(value: unknown): RawAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_answers');
  if (JSON.stringify(value).length > 30_000) throw new Error('invalid_answers');
  const answers: RawAnswers = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) continue;
    if (typeof raw === 'string') answers[key] = raw.slice(0, 500);
    else if (Array.isArray(raw)) answers[key] = raw.filter((item): item is string => typeof item === 'string').slice(0, 50).map((item) => item.slice(0, 100));
  }
  return answers;
}

function cleanContext(value: unknown): Record<string, string> {
  const context: Record<string, string> = {};
  if (!value || typeof value !== 'object') return context;
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === 'string' && raw.trim()) context[key] = raw.trim().slice(0, 200);
  }
  return context;
}

async function loadVersionFlow(versionId: string | null): Promise<QuizFlow | null> {
  if (!versionId) return null;
  const { data } = await supabase.from('quiz_versions').select('flow').eq('id', versionId).maybeSingle();
  return (data?.flow as QuizFlow | undefined) ?? null;
}

/** Só as respostas que estão no caminho percorrido (descarta ramos abandonados). */
function answersOnPath(answers: RawAnswers, result: RunResult) {
  const onPath: RawAnswers = {};
  for (const nodeId of result.state.path) if (answers[nodeId] !== undefined) onPath[nodeId] = answers[nodeId];
  if (result.status === 'pending' && result.node && answers[result.node.id] !== undefined) onPath[result.node.id] = answers[result.node.id];
  return onPath;
}

function contactOf(flow: QuizFlow, result: RunResult) {
  const contact: { contact_name?: string; contact_phone?: string; contact_email?: string } = {};
  for (const answer of result.state.answers) {
    const node = flow.nodes.find((item) => item.id === answer.node_id);
    if (!node || node.type !== 'input' || answer.value === null) continue;
    if (node.data.inputKind === 'name') contact.contact_name = String(answer.value);
    if (node.data.inputKind === 'phone') contact.contact_phone = String(answer.value);
    if (node.data.inputKind === 'email') contact.contact_email = String(answer.value);
  }
  return contact;
}

function sessionPatch(flow: QuizFlow, answers: RawAnswers, result: RunResult) {
  return {
    raw_answers: answersOnPath(answers, result),
    answers: result.state.answers,
    variables: scopeOf(result.state),
    path: result.state.path,
    current_node_id: result.node?.id ?? null,
    qualified: result.state.qualified,
    score: result.state.score,
    tags: result.state.tags,
    updated_at: new Date().toISOString(),
    ...contactOf(flow, result),
  };
}

async function deliver(session: Session, quiz: { id: string; name: string; slug: string }, flow: QuizFlow, node: QuizNode, result: RunResult, completed: boolean) {
  const url = node.data.url ?? '';
  if (!/^https:\/\//i.test(url)) return;
  const payload = {
    event: completed ? 'quiz.completed' : 'quiz.progress',
    quiz,
    session_id: session.id,
    block: { id: node.id, name: nodeTitle(node) },
    qualified: result.state.qualified,
    score: result.state.score,
    tags: result.state.tags,
    variables: scopeOf(result.state),
    answers: result.state.answers.map((answer) => ({ variable: answer.variable, question: answer.label, value: answer.value, display: answer.display })),
    utm: session.utm,
    completed,
    sent_at: new Date().toISOString(),
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'LeadsHub-Quiz/1.0' };
  if (node.data.headerName?.trim() && node.data.headerValue) headers[node.data.headerName.trim()] = node.data.headerValue;

  let attempts = 0;
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  let snippet: string | null = null;
  let ok = false;
  for (const wait of [0, 1_000, 3_000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    attempts += 1;
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000) });
      lastStatus = response.status;
      snippet = (await response.text()).slice(0, 500);
      lastError = null;
      if (response.ok) { ok = true; break; }
      if (response.status < 500 && response.status !== 429) break; // erro do destino que repetir não resolve
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : 'Falha de rede';
    }
  }
  await supabase.from('quiz_webhook_deliveries').insert({
    quiz_id: quiz.id, session_id: session.id, organization_id: session.organization_id, node_id: node.id,
    url, ok, status_code: lastStatus, attempts, error: lastError, response_snippet: snippet,
  });
}

/** Dispara os webhooks novos do caminho e marca na sessão antes de enviar (evita duplicar). */
async function fireWebhooks(session: Session, flow: QuizFlow, result: RunResult, completed: boolean) {
  const pending = result.state.webhooks.filter((id) => !session.webhooks_fired.includes(id));
  if (!pending.length) return;
  const { data: quiz } = await supabase.from('quizzes').select('id, name, slug').eq('id', session.quiz_id).single();
  if (!quiz) return;
  await supabase.from('quiz_sessions').update({ webhooks_fired: [...session.webhooks_fired, ...pending] }).eq('id', session.id);
  const work = Promise.all(pending.map((id) => {
    const node = flow.nodes.find((item) => item.id === id);
    return node ? deliver(session, quiz, flow, node, result, completed).catch(() => undefined) : undefined;
  }));
  // Não segura a resposta do lead esperando o destino do webhook.
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(work);
  else await work;
}

async function resolveTarget(node: QuizNode, scope: Record<string, unknown>) {
  const text = (value?: string) => interpolate(value, scope as never);
  if (node.data.target === 'link' && node.data.linkId) {
    const { data } = await supabase.from('redirect_links').select('slug, active').eq('id', node.data.linkId).maybeSingle();
    return data?.active ? `/r/${data.slug}` : null;
  }
  if (node.data.target === 'url') {
    const url = text(node.data.url);
    return /^https:\/\/\S+$/i.test(url) ? url : null;
  }
  if (node.data.target === 'whatsapp') {
    const digits = (node.data.phone ?? '').replace(/\D/g, '');
    if (digits.length < 10) return null;
    const message = text(node.data.message);
    return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  }
  return null;
}

async function getSession(id: unknown) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const { data } = await supabase
    .from('quiz_sessions')
    .select('id, quiz_id, version_id, organization_id, status, utm, webhooks_fired')
    .eq('id', id)
    .maybeSingle();
  return data as Session | null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'invalid_body' }, 400); }

  try {
    switch (body.action) {
      case 'load': {
        const slug = String(body.slug ?? '').toLowerCase();
        if (!SLUG.test(slug)) return json({ error: 'not_found' }, 404);
        const { data: quiz } = await supabase
          .from('quizzes')
          .select('id, active, published_version_id')
          .eq('slug', slug)
          .maybeSingle();
        if (!quiz?.active || !quiz.published_version_id) return json({ error: 'not_found' }, 404);
        const { data: version } = await supabase
          .from('quiz_versions')
          .select('id, flow, theme, title')
          .eq('id', quiz.published_version_id)
          .single();
        if (!version) return json({ error: 'not_found' }, 404);
        return json({ version_id: version.id, title: version.title, theme: version.theme ?? {}, flow: publicFlow(version.flow as QuizFlow) });
      }

      case 'start': {
        const slug = String(body.slug ?? '').toLowerCase();
        if (!SLUG.test(slug)) return json({ error: 'not_found' }, 404);
        const { data: quiz } = await supabase
          .from('quizzes')
          .select('id, organization_id, active, published_version_id')
          .eq('slug', slug)
          .maybeSingle();
        if (!quiz?.active || !quiz.published_version_id) return json({ error: 'not_found' }, 404);
        // A sessão fica presa à versão que o lead abriu, mesmo que outra seja publicada no meio.
        const versionId = typeof body.version_id === 'string' && UUID.test(body.version_id) ? body.version_id : quiz.published_version_id;
        const { data: version } = await supabase.from('quiz_versions').select('id').eq('id', versionId).eq('quiz_id', quiz.id).maybeSingle();
        const device = body.device === 'mobile' || body.device === 'desktop' ? body.device : null;
        const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null;
        const { data: session, error } = await supabase
          .from('quiz_sessions')
          .insert({ quiz_id: quiz.id, organization_id: quiz.organization_id, version_id: version?.id ?? quiz.published_version_id, utm: cleanContext(body.context), device, referrer })
          .select('id')
          .single();
        if (error) throw error;
        return json({ session_id: session.id });
      }

      case 'progress':
      case 'complete': {
        const session = await getSession(body.session_id);
        if (!session) return json({ error: 'session_not_found' }, 404);
        if (session.status === 'completed') return json({ error: 'already_completed' }, 409);
        const flow = await loadVersionFlow(session.version_id);
        if (!flow) return json({ error: 'version_not_found' }, 404);
        const answers = cleanAnswers(body.answers);
        const completing = body.action === 'complete';

        let result: RunResult;
        try {
          result = runFlow(flow, answers, session.utm ?? {}, !completing);
        } catch (error) {
          if (error instanceof QuizRunError) {
            // Progresso com resposta inválida não derruba a sessão; conclusão sim.
            if (!completing) return json({ ok: false });
            return json({ error: error.code, message: error.message, node_id: error.nodeId }, 422);
          }
          throw error;
        }

        if (!completing) {
          await supabase.from('quiz_sessions').update(sessionPatch(flow, answers, result)).eq('id', session.id).eq('status', 'started');
          await fireWebhooks(session, flow, result, false);
          return json({ ok: true });
        }

        const terminal = result.node;
        const scope = scopeOf(result.state);
        const { data: updated } = await supabase
          .from('quiz_sessions')
          .update({ ...sessionPatch(flow, answers, result), status: 'completed', completed_at: new Date().toISOString(), outcome_node_id: terminal?.id ?? null })
          .eq('id', session.id)
          .eq('status', 'started')
          .select('id');
        if (!updated?.length) return json({ error: 'already_completed' }, 409);
        await fireWebhooks(session, flow, result, true);

        if (terminal?.type === 'redirect') {
          const href = await resolveTarget(terminal, scope);
          if (href) return json({ kind: 'redirect', href });
          return json({ kind: 'end', title: 'Respostas enviadas', text: 'Obrigado! Em breve entraremos em contato.' });
        }
        const cta = terminal?.data.ctaLabel && terminal.data.target ? await resolveTarget(terminal, scope) : null;
        return json({
          kind: 'end',
          title: interpolate(terminal?.data.title || 'Respostas enviadas', scope),
          text: interpolate(terminal?.data.text || (terminal ? '' : 'Obrigado! Em breve entraremos em contato.'), scope),
          cta: cta ? { label: interpolate(terminal?.data.ctaLabel, scope), href: cta } : null,
        });
      }

      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_answers') return json({ error: 'invalid_answers' }, 400);
    console.error('quiz-runtime', error);
    return json({ error: 'internal_error' }, 500);
  }
});
