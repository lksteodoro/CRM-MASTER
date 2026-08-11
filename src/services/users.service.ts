import { supabase } from '../integrations/supabase/client';
import type { ProfileRow, ProjectUserRow } from '../integrations/supabase/database.types';

/** Usuários vinculados a um cliente. */
export async function listClientUsers(clientId: string): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('client_users')
    .select('user_id, profiles:user_id (*)')
    .eq('client_id', clientId)
    .eq('status', 'ACTIVE');

  if (error) throw error;

  return (data ?? [])
    .map((row) => (row as unknown as { profiles: ProfileRow | null }).profiles)
    .filter((p): p is ProfileRow => Boolean(p));
}

export async function listOrganizationUsers(): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function linkUserToClient(clientId: string, userId: string) {
  const { error } = await supabase
    .from('client_users')
    .upsert({ client_id: clientId, user_id: userId }, { onConflict: 'client_id,user_id' });
  if (error) throw error;
}

export async function unlinkUserFromClient(clientId: string, userId: string) {
  const { error } = await supabase
    .from('client_users')
    .delete()
    .eq('client_id', clientId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function setUserStatus(userId: string, status: ProfileRow['status']) {
  const { error } = await supabase.from('profiles').update({ status }).eq('id', userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Permissões por projeto
// ---------------------------------------------------------------------------

export type ProjectPermissionFlags = Pick<
  ProjectUserRow,
  | 'can_view'
  | 'can_edit_goals'
  | 'can_edit_settings'
  | 'can_view_leads'
  | 'can_view_sales'
  | 'can_view_commercial'
  | 'can_export'
>;

export const defaultPermissions: ProjectPermissionFlags = {
  can_view: true,
  can_edit_goals: false,
  can_edit_settings: false,
  can_view_leads: true,
  can_view_sales: true,
  can_view_commercial: true,
  can_export: false,
};

export async function listProjectUsers(projectId: string): Promise<ProjectUserRow[]> {
  const { data, error } = await supabase
    .from('project_users')
    .select('*')
    .eq('project_id', projectId);
  if (error) throw error;
  return data ?? [];
}

export async function listUserProjectAccess(userId: string): Promise<ProjectUserRow[]> {
  const { data, error } = await supabase.from('project_users').select('*').eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

export async function grantProjectAccess(
  projectId: string,
  userId: string,
  permissions: Partial<ProjectPermissionFlags> = {}
) {
  const { error } = await supabase.from('project_users').upsert(
    { project_id: projectId, user_id: userId, ...defaultPermissions, ...permissions },
    { onConflict: 'project_id,user_id' }
  );
  if (error) throw error;
}

export async function revokeProjectAccess(projectId: string, userId: string) {
  const { error } = await supabase
    .from('project_users')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Convida um usuário.
 *
 * `signUp` cria o usuário no Auth e dispara o e-mail de confirmação; o trigger
 * handle_new_user cria o profile correspondente. Uma senha temporária aleatória
 * é usada porque a pessoa definirá a própria senha ao confirmar o convite.
 *
 * Observação: `auth.admin.inviteUserByEmail` seria mais adequado, mas exige a
 * service_role key — que não pode existir no front-end. Em produção, mova este
 * fluxo para uma Edge Function.
 */
export async function inviteUser(input: {
  email: string;
  name: string;
  organizationId: string;
  clientId: string;
}) {
  const temporaryPassword = `${crypto.randomUUID()}Aa1!`;

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: temporaryPassword,
    options: {
      data: {
        name: input.name,
        role: 'CLIENT',
        organization_id: input.organizationId,
      },
      emailRedirectTo: `${window.location.origin}/redefinir-senha`,
    },
  });

  if (error) throw error;

  const userId = data.user?.id;
  if (userId) await linkUserToClient(input.clientId, userId);

  return { userId, email: input.email };
}
