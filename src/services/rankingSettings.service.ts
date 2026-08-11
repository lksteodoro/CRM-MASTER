import { supabase } from '../integrations/supabase/client';
import type { ClientRankingSettingsRow } from '../integrations/supabase/database.types';

export async function getRankingSettings(clientId: string): Promise<ClientRankingSettingsRow | null> {
  const { data, error } = await supabase
    .from('client_ranking_settings')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateRankingSettings(
  clientId: string,
  patch: Partial<
    Pick<
      ClientRankingSettingsRow,
      | 'prize_first'
      | 'prize_second'
      | 'prize_third'
      | 'bonus_label'
      | 'sound_enabled'
      | 'sound_choice'
      | 'animation_enabled'
      | 'sale_banner_message'
      | 'panel_title'
      | 'panel_subtitle'
      | 'panel_live_badge'
      | 'panel_season_label'
      | 'panel_brand_subtitle'
      | 'panel_celebration_label'
      | 'panel_footer_text'
    >
  >
): Promise<ClientRankingSettingsRow> {
  const { data, error } = await supabase
    .from('client_ranking_settings')
    .upsert({ client_id: clientId, ...patch }, { onConflict: 'client_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
