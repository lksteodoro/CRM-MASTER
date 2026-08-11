import { supabase } from '../integrations/supabase/client';
import type { SellerPointAdjustmentRow } from '../integrations/supabase/database.types';

export async function addPointAdjustment(
  sellerId: string,
  amount: number,
  note: string
): Promise<SellerPointAdjustmentRow> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('seller_point_adjustments')
    .insert({ seller_id: sellerId, amount, note, created_by: userData.user?.id ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listPointAdjustments(
  sellerId: string,
  range: { since: string; until: string }
): Promise<SellerPointAdjustmentRow[]> {
  const { data, error } = await supabase
    .from('seller_point_adjustments')
    .select('*')
    .eq('seller_id', sellerId)
    .gte('created_at', range.since)
    .lte('created_at', `${range.until}T23:59:59`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
