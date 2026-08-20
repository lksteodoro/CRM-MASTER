import { supabase } from '../integrations/supabase/client';
import type {
  DisparoTaskRow,
  DisparoTaskNumberRow,
  DisparoTagRow,
} from '../integrations/supabase/database.types';

export type DisparoTaskStatus = DisparoTaskRow['status'];

export interface DisparoChecklistItem {
  key: string;
  label: string;
}

export interface DisparoChecklistStage {
  key: DisparoTaskStatus;
  label: string;
  items: DisparoChecklistItem[];
}

/**
 * Processo enxuto de disparo — 8 etapas fixas, cada uma com seu checklist.
 * As etapas permanecem fixas para organizar visualmente o quadro.
 */
export const disparoChecklistStages: DisparoChecklistStage[] = [
  {
    key: 'pedido',
    label: 'Pedido',
    items: [
      { key: 'cliente', label: 'Cliente' },
      { key: 'volume', label: 'Volume' },
      { key: 'valor', label: 'Valor' },
      { key: 'data_disparo', label: 'Data do disparo' },
      { key: 'responsavel', label: 'Responsável' },
    ],
  },
  {
    key: 'pagamento',
    label: 'Pagamento',
    items: [
      { key: 'pix_enviado', label: 'PIX enviado' },
      { key: 'pagamento_confirmado', label: 'Pagamento confirmado' },
    ],
  },
  {
    key: 'numero_perfil',
    label: 'Número e perfil',
    items: [
      { key: 'nome_ddd', label: 'Nome + DDD recebidos' },
      { key: 'numero_cadastrado', label: 'Número cadastrado' },
      { key: 'foto_adicionada', label: 'Foto adicionada' },
      { key: 'numero_ativo_infobip', label: 'Número ativo na Infobip' },
    ],
  },
  {
    key: 'template_midia',
    label: 'Template e mídia',
    items: [
      { key: 'template_enviado', label: 'Template enviado' },
      { key: 'template_aprovado', label: 'Template aprovado' },
      { key: 'midia_adicionada', label: 'Mídia adicionada' },
      { key: 'link_testado', label: 'Link público gerado e testado' },
    ],
  },
  {
    key: 'lista',
    label: 'Lista',
    items: [
      { key: 'lista_recebida', label: 'Lista recebida' },
      { key: 'duplicados_removidos', label: 'Duplicados e inválidos removidos' },
      { key: 'quantidade_conferida', label: 'Quantidade final conferida' },
      { key: 'lista_importada', label: 'Lista importada' },
    ],
  },
  {
    key: 'teste',
    label: 'Teste',
    items: [
      { key: 'teste_enviado', label: 'Teste enviado' },
      { key: 'itens_conferidos', label: 'Texto, variáveis, mídia e botão conferidos' },
      { key: 'cliente_aprovou', label: 'Cliente aprovou' },
    ],
  },
  {
    key: 'disparo',
    label: 'Disparo',
    items: [
      { key: 'data_horario_confirmados', label: 'Data e horário confirmados' },
      { key: 'campanha_iniciada', label: 'Campanha iniciada' },
      { key: 'entregas_acompanhadas', label: 'Entregas e falhas acompanhadas' },
    ],
  },
  {
    key: 'finalizado',
    label: 'Finalizado',
    items: [
      { key: 'quantidade_enviada', label: 'Mensagens entregues' },
      { key: 'saldo_restante', label: 'Saldo restante' },
      { key: 'relatorio_enviado', label: 'Relatório enviado ao cliente' },
    ],
  },
];

export const disparoTaskColumns: { key: DisparoTaskStatus; label: string }[] = disparoChecklistStages.map(
  (s) => ({ key: s.key, label: s.label })
);

function stageItemKeys(stage: DisparoTaskStatus): string[] {
  return disparoChecklistStages.find((s) => s.key === stage)?.items.map((i) => i.key) ?? [];
}

/** true quando todo item do checklist da etapa informada está marcado. */
export function isStageComplete(stage: DisparoTaskStatus, checklist: Record<string, boolean>): boolean {
  const keys = stageItemKeys(stage);
  return keys.length > 0 && keys.every((k) => checklist[`${stage}.${k}`] === true);
}

export function stageProgress(stage: DisparoTaskStatus, checklist: Record<string, boolean>) {
  const keys = stageItemKeys(stage);
  const done = keys.filter((k) => checklist[`${stage}.${k}`] === true).length;
  return { done, total: keys.length };
}

/** Próxima etapa na sequência fixa, ou null se já estiver em "finalizado". */
export function nextStage(stage: DisparoTaskStatus): DisparoTaskStatus | null {
  const index = disparoChecklistStages.findIndex((s) => s.key === stage);
  return index >= 0 && index < disparoChecklistStages.length - 1
    ? disparoChecklistStages[index + 1].key
    : null;
}

/** O portal aceita a demanda menor para análise, mas não para iniciar envio. */
export function canStartPortalDisparo(task: Pick<DisparoTaskRow, 'request_source' | 'list_valid_count' | 'client_portal_status'>) {
  return task.request_source !== 'client_portal' || (task.list_valid_count >= 1000 && task.client_portal_status === 'approved');
}

export function portalDisparoBlockReason(task: Pick<DisparoTaskRow, 'request_source' | 'list_valid_count' | 'client_portal_status'>) {
  if (task.request_source !== 'client_portal') return null;
  if (task.client_portal_status !== 'approved') return 'A agência precisa aprovar esta demanda antes de iniciar o disparo.';
  if (canStartPortalDisparo(task)) return null;
  return `A lista tem ${task.list_valid_count.toLocaleString('pt-BR')} contatos válidos. São necessários pelo menos 1.000 para iniciar o disparo.`;
}

export interface DisparoTaskWithRelations extends DisparoTaskRow {
  disparo_task_numbers: DisparoTaskNumberRow[];
  disparo_task_tags: { tag_id: string }[];
}

const SELECT_WITH_RELATIONS = '*, disparo_task_numbers(*), disparo_task_tags(tag_id)';

function sortRelations(row: DisparoTaskWithRelations): DisparoTaskWithRelations {
  return {
    ...row,
    disparo_task_numbers: [...row.disparo_task_numbers].sort((a, b) => a.position - b.position),
  };
}

/** Board ativo do admin logado — tudo que ainda não foi arquivado. */
export async function listDisparoTasks(): Promise<DisparoTaskWithRelations[]> {
  const { data, error } = await supabase
    .from('disparo_tasks')
    .select(SELECT_WITH_RELATIONS)
    .is('archived_at', null)
    .order('position', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as DisparoTaskWithRelations[]).map(sortRelations);
}

export async function listArchivedDisparoTasks(): Promise<DisparoTaskWithRelations[]> {
  const { data, error } = await supabase
    .from('disparo_tasks')
    .select(SELECT_WITH_RELATIONS)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as DisparoTaskWithRelations[]).map(sortRelations);
}

export interface DisparoNumberInput {
  waba_label: string | null;
  number: string;
  name: string | null;
  is_test: boolean;
}

export interface DisparoTaskInput {
  title: string;
  client_id: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  contact_list_ref: string | null;
  list_tag: string | null;
  full_link: string | null;
  short_link: string | null;
  instagram: string | null;
  copy_text: string | null;
  copy_approved: boolean;
  final_report: string | null;
  /** Snapshots financeiros da demanda. Derivados como custo e lucro não são persistidos. */
  contracted_quantity: number;
  sent_quantity: number;
  client_revenue: number;
  supplier_unit_cost: number;
  checklist: Record<string, boolean>;
  numbers: DisparoNumberInput[];
  tagIds: string[];
}

async function replaceNumbers(taskId: string, numbers: DisparoNumberInput[]) {
  const { error: deleteError } = await supabase
    .from('disparo_task_numbers')
    .delete()
    .eq('disparo_task_id', taskId);
  if (deleteError) throw deleteError;

  if (numbers.length === 0) return;

  const { error: insertError } = await supabase.from('disparo_task_numbers').insert(
    numbers.map((n, index) => ({
      disparo_task_id: taskId,
      waba_label: n.waba_label,
      number: n.number,
      name: n.name,
      is_test: n.is_test,
      position: index,
    }))
  );
  if (insertError) throw insertError;
}

async function replaceTags(taskId: string, tagIds: string[]) {
  const { error: deleteError } = await supabase
    .from('disparo_task_tags')
    .delete()
    .eq('disparo_task_id', taskId);
  if (deleteError) throw deleteError;

  if (tagIds.length === 0) return;

  const { error: insertError } = await supabase
    .from('disparo_task_tags')
    .insert(tagIds.map((tag_id) => ({ disparo_task_id: taskId, tag_id })));
  if (insertError) throw insertError;
}

async function fetchOne(taskId: string): Promise<DisparoTaskWithRelations> {
  const { data, error } = await supabase
    .from('disparo_tasks')
    .select(SELECT_WITH_RELATIONS)
    .eq('id', taskId)
    .single();
  if (error) throw error;
  return sortRelations(data as unknown as DisparoTaskWithRelations);
}

export async function createDisparoTask(
  input: DisparoTaskInput,
  status: DisparoTaskStatus,
  position: number
): Promise<DisparoTaskWithRelations> {
  const { numbers, tagIds, ...rest } = input;
  const { data, error } = await supabase
    .from('disparo_tasks')
    .insert({ ...rest, status, position })
    .select('*')
    .single();
  if (error) throw error;

  await Promise.all([replaceNumbers(data.id, numbers), replaceTags(data.id, tagIds)]);
  return fetchOne(data.id);
}

export async function updateDisparoTask(
  id: string,
  input: DisparoTaskInput
): Promise<DisparoTaskWithRelations> {
  const { numbers, tagIds, ...rest } = input;
  const { error } = await supabase.from('disparo_tasks').update(rest).eq('id', id);
  if (error) throw error;

  await Promise.all([replaceNumbers(id, numbers), replaceTags(id, tagIds)]);
  return fetchOne(id);
}

/** A agência devolve uma demanda ao cliente sem abrir campos operacionais. */
export async function requestClientPortalAdjustment(taskId: string, comment: string) {
  const cleanComment = comment.trim();
  if (!cleanComment) throw new Error('Descreva a pendência para o cliente.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error('Sessão não encontrada.');

  const { error } = await supabase
    .from('disparo_tasks')
    .update({
      client_portal_status: 'action_required',
      client_feedback_comment: cleanComment,
      client_feedback_at: new Date().toISOString(),
      client_feedback_by: auth.user.id,
    })
    .eq('id', taskId)
    .eq('request_source', 'client_portal');
  if (error) throw error;
  return fetchOne(taskId);
}

export async function approveClientPortalDemand(taskId: string) {
  const { error } = await supabase
    .from('disparo_tasks')
    .update({
      client_portal_status: 'approved',
      client_feedback_comment: null,
      client_feedback_at: null,
      client_feedback_by: null,
    })
    .eq('id', taskId)
    .eq('request_source', 'client_portal');
  if (error) throw error;
  return fetchOne(taskId);
}

export async function deleteDisparoTask(id: string) {
  const { error } = await supabase.from('disparo_tasks').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Reescreve status e posição (0..n) dos cards de uma coluna após um
 * drag-and-drop. Quando o card muda de coluna, passe também a coluna de
 * origem já sem o card movido, pra reordenar quem ficou pra trás.
 */
export async function moveDisparoTask(params: {
  targetStatus: DisparoTaskStatus;
  orderedIdsInTargetColumn: string[];
  sourceStatus?: DisparoTaskStatus;
  orderedIdsInSourceColumn?: string[];
}): Promise<void> {
  const { targetStatus, orderedIdsInTargetColumn, sourceStatus, orderedIdsInSourceColumn } = params;
  const updates: { id: string; status: DisparoTaskStatus; position: number }[] = [];

  orderedIdsInTargetColumn.forEach((id, index) => {
    updates.push({ id, status: targetStatus, position: index });
  });

  if (sourceStatus && orderedIdsInSourceColumn) {
    orderedIdsInSourceColumn.forEach((id, index) => {
      updates.push({ id, status: sourceStatus, position: index });
    });
  }

  await Promise.all(
    updates.map(({ id, status, position }) =>
      supabase
        .from('disparo_tasks')
        .update({ status, position })
        .eq('id', id)
        .then(({ error }) => {
          if (error) throw error;
        })
    )
  );
}

export type DisparoMediaKind = 'profile_photo' | 'image' | 'video' | 'contact_list';

function mediaUpdate(kind: DisparoMediaKind, url: string | null) {
  switch (kind) {
    case 'profile_photo':
      return { profile_photo_url: url };
    case 'image':
      return { image_url: url };
    case 'video':
      return { video_url: url };
    case 'contact_list':
      return { list_file_url: url };
  }
}

function mediaFileNameUpdate(kind: DisparoMediaKind, fileName: string | null) {
  return kind === 'contact_list' ? { list_file_name: fileName } : {};
}

function safeExtension(file: File) {
  const candidate = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return candidate || file.type.split('/').pop()?.replace(/[^a-z0-9]/g, '') || 'bin';
}

async function removeStoredVersions(
  userId: string,
  taskId: string,
  kind: DisparoMediaKind,
  preservePath?: string
) {
  const folder = `${userId}/${taskId}`;
  const { data, error } = await supabase.storage.from('disparo-media').list(folder, { limit: 100 });
  if (error) throw error;
  const paths = (data ?? [])
    .filter((entry) => entry.name.startsWith(`${kind}.`) || entry.name.startsWith(`${kind}-`))
    .map((entry) => `${folder}/${entry.name}`)
    .filter((path) => path !== preservePath);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from('disparo-media').remove(paths);
    if (removeError) throw removeError;
  }
}

export async function uploadDisparoMedia(
  taskId: string,
  kind: DisparoMediaKind,
  file: File
): Promise<DisparoTaskRow> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;

  const ext = safeExtension(file);
  const version = `${Date.now()}-${crypto.randomUUID()}`;
  const path = `${userData.user.id}/${taskId}/${kind}-${version}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('disparo-media')
    .upload(path, file, { upsert: false });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('disparo-media').getPublicUrl(path);

  const { data, error } = await supabase
    .from('disparo_tasks')
    .update({
      ...mediaUpdate(kind, `${publicUrlData.publicUrl}?v=${Date.now()}`),
      ...mediaFileNameUpdate(kind, file.name),
    })
    .eq('id', taskId)
    .select('*')
    .single();
  if (error) throw error;

  await removeStoredVersions(userData.user.id, taskId, kind, path);
  return data;
}

export async function removeDisparoMedia(taskId: string, kind: DisparoMediaKind): Promise<DisparoTaskRow> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  await removeStoredVersions(userData.user.id, taskId, kind);

  const { data, error } = await supabase
    .from('disparo_tasks')
    .update({ ...mediaUpdate(kind, null), ...mediaFileNameUpdate(kind, null) })
    .eq('id', taskId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Etiquetas (vocabulário configurável)
// ---------------------------------------------------------------------------

export async function listDisparoTags(): Promise<DisparoTagRow[]> {
  const { data, error } = await supabase.from('disparo_tags').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createDisparoTag(name: string, color: string): Promise<DisparoTagRow> {
  const { data, error } = await supabase
    .from('disparo_tags')
    .insert({ name, color })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDisparoTag(id: string) {
  const { error } = await supabase.from('disparo_tags').delete().eq('id', id);
  if (error) throw error;
}
