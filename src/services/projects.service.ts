import { supabase } from '../integrations/supabase/client';
import type {
  ProjectRow,
  ProjectSettingsRow,
  ProjectStatus,
  ProjectUserRow,
} from '../integrations/supabase/database.types';

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Projetos visíveis ao usuário. RLS garante que um CLIENT só receba projetos
 * liberados em project_users — inclusive se tentar filtrar por id na URL.
 */
export async function listProjects(options?: {
  clientId?: string;
  includeArchived?: boolean;
}): Promise<ProjectRow[]> {
  let query = supabase.from('projects').select('*').order('name');
  if (options?.clientId) query = query.eq('client_id', options.clientId);
  if (!options?.includeArchived) query = query.neq('status', 'ARCHIVED');

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CreateProjectInput {
  organizationId: string;
  clientId: string;
  name: string;
  description?: string | null;
  timezone?: string;
  currency?: string;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  const { data: userData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('projects')
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
      timezone: input.timezone ?? 'America/Sao_Paulo',
      currency: input.currency ?? 'BRL',
      created_by: userData.user?.id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateProject(
  projectId: string,
  patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'status' | 'timezone' | 'currency'>>
): Promise<ProjectRow> {
  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', projectId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function archiveProject(projectId: string): Promise<ProjectRow> {
  return updateProject(projectId, { status: 'ARCHIVED' as ProjectStatus });
}

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------

export async function getProjectSettings(projectId: string): Promise<ProjectSettingsRow | null> {
  const { data, error } = await supabase
    .from('project_settings')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProjectSettings(
  projectId: string,
  patch: Partial<
    Pick<
      ProjectSettingsRow,
      | 'lead_identity_strategy'
      | 'attribution_strategy'
      | 'alerts_enabled'
      | 'commercial_enabled'
      | 'ranking_enabled'
    >
  >
): Promise<ProjectSettingsRow> {
  const { data, error } = await supabase
    .from('project_settings')
    .update(patch)
    .eq('project_id', projectId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Permissão do usuário logado sobre o projeto
// ---------------------------------------------------------------------------

export async function getMyProjectPermissions(projectId: string): Promise<ProjectUserRow | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from('project_users')
    .select('*')
    .eq('project_id', projectId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}
