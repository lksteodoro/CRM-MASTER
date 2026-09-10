import { supabase } from '../integrations/supabase/client';
import type {
  CsGroupRow,
  CsMessageRow,
  CsScheduledMessageRow,
} from '../integrations/supabase/database.types';

// ---------------------------------------------------------------------------
// Integração com a Evolution API (tudo passa pela Edge Function `cs-evolution`,
// que é quem conhece a api_key)
// ---------------------------------------------------------------------------

export interface CsConfig {
  configured: boolean;
  base_url?: string;
  instance_name?: string;
  connected?: boolean;
  last_synced_at?: string | null;
  webhook_url?: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('cs-evolution', { body });
  if (error) {
    // A mensagem útil da Evolution vem no corpo da resposta, não no erro do
    // supabase-js — sem isso o usuário só veria "Edge Function returned 400".
    const detail = await readFunctionError(error);
    throw new Error(detail ?? error.message);
  }
  if (!data) throw new Error('Sem resposta da função cs-evolution.');
  return data;
}

async function readFunctionError(error: unknown): Promise<string | null> {
  const response = (error as { context?: Response })?.context;
  if (!response || typeof response.text !== 'function') return null;
  try {
    const text = await response.text();
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text.slice(0, 300);
  } catch {
    return null;
  }
}

export function getCsConfig() {
  return invoke<CsConfig>({ action: 'get_config' });
}

export function saveCsConfig(input: { base_url: string; api_key: string; instance_name: string }) {
  return invoke<CsConfig & { evolution_ok?: boolean; evolution_response?: unknown }>({
    action: 'save_config',
    ...input,
  });
}

export function testCsConnection() {
  return invoke<{ ok: boolean; connected: boolean; response?: unknown }>({ action: 'test' });
}

export function setCsWebhook() {
  return invoke<{ ok: boolean; webhook_url: string }>({ action: 'set_webhook' });
}

export function syncCsGroups() {
  return invoke<{ ok: boolean; synced: number }>({ action: 'sync_groups' });
}

export function sendCsMessage(groupId: string, body: string) {
  return invoke<{ ok: boolean; message: CsMessageRow }>({
    action: 'send_message',
    group_id: groupId,
    body,
  });
}

export function fetchCsHistory(groupId: string, limit = 50) {
  return invoke<{ ok: boolean; imported: number }>({
    action: 'fetch_history',
    group_id: groupId,
    limit,
  });
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

export async function listCsGroups(): Promise<CsGroupRow[]> {
  const { data, error } = await supabase
    .from('cs_groups')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function updateCsGroup(
  id: string,
  patch: { is_managed?: boolean; client_id?: string | null }
): Promise<CsGroupRow> {
  const { data, error } = await supabase
    .from('cs_groups')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function markCsGroupRead(id: string) {
  const { error } = await supabase.from('cs_groups').update({ unread_count: 0 }).eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export async function listCsMessages(groupId: string, limit = 100): Promise<CsMessageRow[]> {
  const { data, error } = await supabase
    .from('cs_messages')
    .select('*')
    .eq('group_id', groupId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Vem do banco em ordem decrescente (pra pegar as mais recentes com limit) e
  // é exibido em ordem cronológica.
  return (data ?? []).slice().reverse();
}

// ---------------------------------------------------------------------------
// Mensagens programadas
// ---------------------------------------------------------------------------

export type CsRecurrence = CsScheduledMessageRow['recurrence'];

export const csRecurrenceLabels: Record<CsRecurrence, string> = {
  once: 'Uma vez',
  daily: 'Todo dia',
  weekly: 'Toda semana',
  monthly: 'Todo mês',
};

export const csWeekdayLabels = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

export interface CsScheduleInput {
  group_id: string;
  title: string;
  body: string;
  recurrence: CsRecurrence;
  send_time: string;
  weekday: number | null;
  day_of_month: number | null;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
}

export async function listCsScheduledMessages(): Promise<CsScheduledMessageRow[]> {
  const { data, error } = await supabase
    .from('cs_scheduled_messages')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createCsScheduledMessage(
  input: CsScheduleInput
): Promise<CsScheduledMessageRow> {
  const { data, error } = await supabase
    .from('cs_scheduled_messages')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateCsScheduledMessage(
  id: string,
  input: Partial<CsScheduleInput>
): Promise<CsScheduledMessageRow> {
  const { data, error } = await supabase
    .from('cs_scheduled_messages')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCsScheduledMessage(id: string) {
  const { error } = await supabase.from('cs_scheduled_messages').delete().eq('id', id);
  if (error) throw error;
}

export interface CsNextRun {
  at: Date;
  /**
   * O horário já passou e o envio continua pendente — o job pega no próximo
   * ciclo (roda de 10 em 10 minutos). Acontece quando o agendamento é criado
   * depois do horário do dia, ou quando o job ficou fora do ar.
   */
  overdue: boolean;
}

function isoDateOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** Hoje cai nessa recorrência? Só a data — o horário é checado por fora. */
function matchesDate(schedule: CsScheduledMessageRow, date: Date): boolean {
  const iso = isoDateOf(date);
  if (iso < schedule.starts_on) return false;
  if (schedule.ends_on && iso > schedule.ends_on) return false;

  switch (schedule.recurrence) {
    case 'daily':
      return true;
    case 'weekly':
      return date.getDay() === schedule.weekday;
    case 'monthly':
      return date.getDate() === schedule.day_of_month;
    case 'once':
      return iso === schedule.starts_on;
  }
}

function occurrenceOn(schedule: CsScheduledMessageRow, date: Date): Date {
  const [hours, minutes] = schedule.send_time.split(':').map(Number);
  const occurrence = new Date(date);
  occurrence.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return occurrence;
}

/**
 * Próximo envio de um agendamento.
 *
 * Espelha a decisão da Edge Function `cs-run-scheduled`: uma ocorrência que já
 * passou mas ainda não foi enviada continua na fila, então aqui ela aparece
 * como pendente (`overdue`) em vez de sumir como se não fosse mais sair.
 */
export function nextCsRun(
  schedule: CsScheduledMessageRow,
  from = new Date()
): CsNextRun | null {
  if (!schedule.active) return null;

  // Ocorrência de hoje ainda pendente conta como próxima, mesmo atrasada.
  if (matchesDate(schedule, from)) {
    const today = occurrenceOn(schedule, from);
    const alreadySent =
      schedule.last_sent_at && new Date(schedule.last_sent_at).getTime() >= today.getTime();
    if (!alreadySent) return { at: today, overdue: today.getTime() < from.getTime() };
  }

  if (schedule.recurrence === 'once') return null;

  for (let dayOffset = 1; dayOffset <= 366; dayOffset += 1) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + dayOffset);
    if (schedule.ends_on && isoDateOf(candidate) > schedule.ends_on) return null;
    if (matchesDate(schedule, candidate)) return { at: occurrenceOn(schedule, candidate), overdue: false };
  }

  return null;
}
