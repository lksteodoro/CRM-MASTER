import { supabase } from '../integrations/supabase/client';

export type AgencyToolKey =
  | 'disparo.dashboard'
  | 'disparo.redirects'
  | 'disparo.templates'
  | 'disparo.broadcasts'
  | 'disparo.request'
  | 'disparo.demands'
  | 'disparo.sanitizer'
  | 'disparo.report'
  | 'meta_ads';

export type AgencyToolDefinition = { key: AgencyToolKey; label: string; path: string };
export type AgencyToolGroup = { label: string; tools: AgencyToolDefinition[] };

export const agencyToolGroups: AgencyToolGroup[] = [
  {
    label: 'Disparos',
    tools: [
      { key: 'disparo.dashboard', label: 'Dashboard de disparos', path: '/agency/disparo/dashboard' },
      { key: 'disparo.redirects', label: 'Redirecionador', path: '/agency/disparo/redirecionador' },
      { key: 'disparo.templates', label: 'Templates Infobip', path: '/agency/disparo/templates' },
      { key: 'disparo.broadcasts', label: 'Transmissões', path: '/agency/disparo/transmissoes' },
      { key: 'disparo.request', label: 'Solicitar disparo', path: '/agency/disparo/solicitar' },
      { key: 'disparo.demands', label: 'Demandas', path: '/agency/disparo/demandas' },
      { key: 'disparo.sanitizer', label: 'Higienizador de lista', path: '/agency/disparo/higienizador' },
      { key: 'disparo.report', label: 'Relatório do fornecedor', path: '/agency/disparo/relatorio' },
    ],
  },
  {
    label: 'Ferramentas da agência',
    tools: [
      { key: 'meta_ads', label: 'Meta Ads', path: '/agency/ferramentas/meta-ads' },
    ],
  },
];

export const agencyTools = agencyToolGroups.flatMap((group) => group.tools);

export function isAgencyToolKey(value: string): value is AgencyToolKey {
  return agencyTools.some((tool) => tool.key === value);
}

export async function listMyAgencyToolPermissions(): Promise<AgencyToolKey[]> {
  const { data, error } = await supabase.from('agency_tool_permissions').select('tool_key');
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.tool_key)
    .filter((key): key is AgencyToolKey => isAgencyToolKey(key));
}

export async function listOrganizationAgencyToolPermissions(): Promise<Record<string, AgencyToolKey[]>> {
  const { data, error } = await supabase
    .from('agency_tool_permissions')
    .select('user_id, tool_key')
    .order('created_at');
  if (error) throw error;

  return (data ?? []).reduce<Record<string, AgencyToolKey[]>>((permissions, row) => {
    if (isAgencyToolKey(row.tool_key)) {
      permissions[row.user_id] = [...(permissions[row.user_id] ?? []), row.tool_key];
    }
    return permissions;
  }, {});
}

export async function setUserAgencyToolPermissions(userId: string, tools: AgencyToolKey[]) {
  const { error } = await supabase.rpc('set_user_agency_tool_permissions', {
    p_user_id: userId,
    p_tool_keys: [...new Set(tools)],
  });
  if (error) throw error;
}
