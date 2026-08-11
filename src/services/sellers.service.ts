import { supabase } from '../integrations/supabase/client';
import type { SellerRow } from '../integrations/supabase/database.types';

export async function listSellers(
  clientId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<SellerRow[]> {
  let query = supabase.from('sellers').select('*').eq('client_id', clientId).order('name');
  if (opts.activeOnly) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createSeller(clientId: string, name: string): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .insert({ client_id: clientId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameSeller(id: string, name: string): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .update({ name })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setSellerActive(id: string, active: boolean): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .update({ active })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setSellerGoal(id: string, salesGoal: number): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .update({ sales_goal: salesGoal })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadSellerPhoto(clientId: string, sellerId: string, file: File): Promise<SellerRow> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${clientId}/${sellerId}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('seller-photos')
    .upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('seller-photos').getPublicUrl(path);

  const { data, error } = await supabase
    .from('sellers')
    .update({ photo_url: `${publicUrlData.publicUrl}?v=${Date.now()}` })
    .eq('id', sellerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
