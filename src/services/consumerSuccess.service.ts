import { supabase } from '../integrations/supabase/client';
import type {
  CsGroupRow,
  CsDeliveryRow,
  CsMessageRow,
  CsParticipantRow,
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
  patch: { is_managed?: boolean; client_id?: string | null; greeting?: string; automation_paused?: boolean }
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
// Participantes (nome + foto de quem fala nos grupos)
// ---------------------------------------------------------------------------

export async function listCsParticipants(): Promise<CsParticipantRow[]> {
  const { data, error } = await supabase.from('cs_participants').select('*');
  if (error) throw error;
  return data ?? [];
}

/** Pede à Evolution a foto de quem falou no grupo (só os que faltam ou venceram). */
export function syncCsParticipants(groupId: string) {
  return invoke<{ ok: boolean; checked: number; updated: number }>({
    action: 'sync_participants',
    group_id: groupId,
  });
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
  group_id: string | null;
  recipient_mode: 'single' | 'selected' | 'all_active';
  group_ids: string[];
  variants: string[];
  rotation_mode: 'sequential' | 'random';
  weekdays: number[];
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
    .insert({ ...input, next_run_at: null })
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


export function csError(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Não foi possível concluir a operação.';
  if (/schema cache|does not exist|could not find/i.test(message)) return 'A atualização do Consumer Success ainda não está instalada no servidor. Solicite a aplicação das migrações e a atualização das funções antes de usar as programações.';
  return message;
}
export async function getCsServerNow(): Promise<string> {
  const { data, error } = await supabase.rpc('cs_server_now');
  if (error) throw error;
  return data;
}
export async function listCsClients(): Promise<CsClient[]> {
  const { data, error } = await supabase.rpc('cs_list_clients');
  if (error) throw error;
  return data ?? [];
}
export async function enqueueCsSchedule(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('cs_send_schedule_now', { p_schedule_id: id });
  if (error) throw error;
  return data;
}
export async function listCsDeliveries(): Promise<CsDeliveryRow[]> {
  const { data, error } = await supabase.from('cs_deliveries').select('*').order('occurrence_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data ?? [];
}
export function formatCsDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
export function csEligible(group: CsGroupRow, clients: CsClient[], allActive = false): boolean {
  return group.is_managed && !group.automation_paused && (group.client_id ? clients.some(c => c.id === group.client_id && c.status === 'ACTIVE') : !allActive);
}
export function csRecipients(input: Pick<CsScheduleInput, 'recipient_mode' | 'group_id' | 'group_ids'>, groups: CsGroupRow[], clients: CsClient[]) {
  return groups.filter(g => csEligible(g, clients, input.recipient_mode === 'all_active') && (input.recipient_mode === 'all_active' || (input.recipient_mode === 'single' ? g.id === input.group_id : input.group_ids.includes(g.id))));
}
export function previewCsBody(body: string, group: CsGroupRow | undefined, clients: CsClient[]): string {
  const client = clients.find(c => c.id === group?.client_id);
  return body.replace(/{{\s*(saudacao|cliente|grupo)\s*}}/g, (_, key: string) => ({ saudacao: group?.greeting?.trim() || 'pessoal', cliente: client?.name || 'pessoal', grupo: group?.name || 'pessoal' })[key] || 'pessoal');
}

export interface CsClient { id: string; name: string; status: string }
