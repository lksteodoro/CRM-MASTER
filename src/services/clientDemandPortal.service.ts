import { supabase } from '../integrations/supabase/client';
import type { ClientDisparoProfileRow, DisparoTaskRow } from '../integrations/supabase/database.types';
import type { ContactColumnMapping } from '../lib/listSanitizer';

export interface ClientDemandProfileInput {
  clientId: string;
  profileName: string;
  ddd: string;
  profilePhotoPath: string | null;
  profileCoverPath: string | null;
  previousProfilePhotoPath?: string | null;
  previousProfileCoverPath?: string | null;
}

export interface ClientDemandInput {
  clientId: string;
  title: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  profileName: string;
  ddd: string;
  profilePhotoPath: string | null;
  profileCoverPath: string | null;
  copyText: string;
  destinationLink: string;
  instagram: string;
  notes: string;
  /** Arquivo original; a Edge Function é a fonte final da higienização. */
  listFile: File;
  originalListFileName: string;
  mapping: Pick<ContactColumnMapping, 'firstName' | 'lastName' | 'phone'>;
}

const BUCKET = 'client-demand-files';

function normalizeDdd(ddd: string) {
  return ddd.replace(/\D/g, '').slice(0, 3);
}

function safeExtension(file: File) {
  return file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

function profilePath(clientId: string, kind: 'photo' | 'cover', file: File) {
  return `${clientId}/profile/${kind}-${Date.now()}-${crypto.randomUUID()}.${safeExtension(file)}`;
}

function incomingListPath(clientId: string, file: File) {
  return `${clientId}/incoming/${crypto.randomUUID()}/source.${safeExtension(file)}`;
}

export async function listClientPortalDemands(clientId: string): Promise<DisparoTaskRow[]> {
  const { data, error } = await supabase
    .from('disparo_tasks')
    .select('*')
    .eq('client_id', clientId)
    .eq('request_source', 'client_portal')
    .is('archived_at', null)
    .order('client_submitted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getClientDemandProfile(clientId: string): Promise<ClientDisparoProfileRow | null> {
  const { data, error } = await supabase
    .from('client_disparo_profiles')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function uploadClientProfileAsset(
  clientId: string,
  kind: 'photo' | 'cover',
  file: File
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Envie uma imagem JPG, PNG ou WEBP.');
  if (file.size > 5 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 5 MB.');

  const path = profilePath(clientId, kind, file);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

async function cleanupReplacedProfileAsset(
  clientId: string,
  kind: 'photo' | 'cover',
  previousPath: string | null | undefined,
  nextPath: string | null
) {
  if (!previousPath || previousPath === nextPath || !previousPath.startsWith(`${clientId}/profile/${kind}-`)) return;
  const snapshotField = kind === 'photo' ? 'profile_photo_path' : 'profile_cover_path';
  // Só apagamos depois de o perfil padrão já apontar ao arquivo novo e nunca
  // removemos uma imagem preservada como snapshot de uma demanda antiga.
  const { data: inUse, error } = await supabase
    .from('disparo_tasks')
    .select('id')
    .eq('client_id', clientId)
    .eq(snapshotField, previousPath)
    .limit(1);
  if (!error && (inUse?.length ?? 0) === 0) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }
}

export async function upsertClientDemandProfile(input: ClientDemandProfileInput) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error('Sessão não encontrada.');

  const { data, error } = await supabase
    .from('client_disparo_profiles')
    .upsert(
      {
        client_id: input.clientId,
        profile_name: input.profileName.trim() || null,
        default_ddd: normalizeDdd(input.ddd) || null,
        profile_photo_path: input.profilePhotoPath,
        profile_cover_path: input.profileCoverPath,
        updated_by: auth.user.id,
      },
      { onConflict: 'client_id' }
    )
    .select('*')
    .single();
  if (error) throw error;
  await Promise.all([
    cleanupReplacedProfileAsset(input.clientId, 'photo', input.previousProfilePhotoPath, input.profilePhotoPath),
    cleanupReplacedProfileAsset(input.clientId, 'cover', input.previousProfileCoverPath, input.profileCoverPath),
  ]);
  return data;
}

export async function createClientPortalDemand(input: ClientDemandInput): Promise<DisparoTaskRow> {
  if (input.listFile.size === 0) throw new Error('A lista higienizada está vazia.');
  if (input.listFile.size > 16 * 1024 * 1024) throw new Error('A lista deve ter no máximo 16 MB.');
  if (input.mapping.phone < 0) throw new Error('Selecione a coluna de telefone.');

  // O arquivo original é temporário. A Edge Function o lê, recalcula todos os
  // contadores, grava só o CSV limpo e cria a demanda; nenhum contador do
  // navegador é aceito como fonte final.
  const path = incomingListPath(input.clientId, input.listFile);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, input.listFile, { contentType: input.listFile.type || 'text/csv', upsert: false });
  if (uploadError) throw uploadError;

  try {
    const { data, error } = await supabase.functions.invoke<{ task?: DisparoTaskRow; error?: string }>('client-demand-submit', {
      body: {
        clientId: input.clientId, sourcePath: path, originalListFileName: input.originalListFileName,
        mapping: input.mapping, title: input.title, scheduledDate: input.scheduledDate, scheduledTime: input.scheduledTime,
        profileName: input.profileName, ddd: normalizeDdd(input.ddd), profilePhotoPath: input.profilePhotoPath,
        profileCoverPath: input.profileCoverPath, copyText: input.copyText, destinationLink: input.destinationLink,
        instagram: input.instagram, notes: input.notes,
      },
    });
    if (error || !data?.task) throw new Error(data?.error || error?.message || 'Não foi possível processar a demanda.');
    return data.task;
  } catch (cause) {
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([path]);
    if (cleanupError) console.warn('Não foi possível remover o arquivo de lista após falha:', cleanupError.message);
    throw cause;
  }
}

export async function createClientDemandFileUrl(path: string, expiresInSeconds = 60 * 10) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
