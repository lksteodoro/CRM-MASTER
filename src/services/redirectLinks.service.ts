import { supabase } from '../integrations/supabase/client';
import type { RedirectDestinationRow, RedirectLinkRow } from '../integrations/supabase/database.types';

export interface RedirectLinkWithDestinations extends RedirectLinkRow {
  destinations: RedirectDestinationRow[];
}

export interface RedirectDestinationInput {
  label: string | null;
  target_url: string;
}

export interface RedirectLinkInput {
  client_id: string;
  name: string;
  slug: string;
  strategy: RedirectLinkRow['strategy'];
  delay_seconds: number;
  active: boolean;
  destinations: RedirectDestinationInput[];
}

export interface ResolvedRedirect {
  target_url: string;
  delay_seconds: number;
  link_name: string;
}

export function normalizeRedirectSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizedInput(input: RedirectLinkInput): RedirectLinkInput {
  const name = input.name.trim();
  const slug = normalizeRedirectSlug(input.slug);
  if (!input.client_id) throw new Error('Selecione o cliente deste link.');
  if (!name) throw new Error('Informe um nome para identificar o link.');
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) throw new Error('O endereço do link deve ter entre 3 e 80 caracteres.');
  if (!Number.isInteger(input.delay_seconds) || input.delay_seconds < 0 || input.delay_seconds > 300) {
    throw new Error('O tempo de redirecionamento deve ficar entre 0 e 300 segundos.');
  }
  const destinations = input.destinations
    .map((destination) => ({ label: destination.label?.trim() || null, target_url: destination.target_url.trim() }))
    .filter((destination) => destination.target_url);
  if (destinations.length === 0) throw new Error('Adicione pelo menos um destino.');
  destinations.forEach((destination) => {
    let parsed: URL;
    try {
      parsed = new URL(destination.target_url);
    } catch {
      throw new Error(`Destino inválido: ${destination.target_url}`);
    }
    if (parsed.protocol !== 'https:') throw new Error('Os destinos devem começar com https://.');
  });
  return { ...input, name, slug, destinations };
}

function toDestinationRows(linkId: string, destinations: RedirectDestinationInput[]) {
  return destinations.map((destination, position) => ({
    redirect_link_id: linkId,
    label: destination.label,
    target_url: destination.target_url,
    position,
  }));
}

export async function listRedirectLinks(): Promise<RedirectLinkWithDestinations[]> {
  const { data: links, error: linksError } = await supabase
    .from('redirect_links')
    .select('*')
    .order('created_at', { ascending: false });
  if (linksError) throw linksError;
  if (!links?.length) return [];
  const { data: destinations, error: destinationsError } = await supabase
    .from('redirect_destinations')
    .select('*')
    .in('redirect_link_id', links.map((link) => link.id))
    .order('position');
  if (destinationsError) throw destinationsError;
  const grouped = new Map<string, RedirectDestinationRow[]>();
  for (const destination of destinations ?? []) {
    grouped.set(destination.redirect_link_id, [...(grouped.get(destination.redirect_link_id) ?? []), destination]);
  }
  return links.map((link) => ({ ...link, destinations: grouped.get(link.id) ?? [] }));
}

export async function createRedirectLink(input: RedirectLinkInput): Promise<RedirectLinkWithDestinations> {
  const clean = normalizedInput(input);
  const { destinations, ...linkInput } = clean;
  const { data: link, error: linkError } = await supabase.from('redirect_links').insert(linkInput).select().single();
  if (linkError) throw linkError;
  const { data: destinationRows, error: destinationsError } = await supabase
    .from('redirect_destinations')
    .insert(toDestinationRows(link.id, destinations))
    .select();
  if (destinationsError) {
    await supabase.from('redirect_links').delete().eq('id', link.id);
    throw destinationsError;
  }
  return { ...link, destinations: destinationRows ?? [] };
}

export async function updateRedirectLink(
  linkId: string,
  input: RedirectLinkInput
): Promise<RedirectLinkWithDestinations> {
  const clean = normalizedInput(input);
  const { destinations, ...linkInput } = clean;
  const { data: previousDestinations, error: previousError } = await supabase
    .from('redirect_destinations').select('*').eq('redirect_link_id', linkId).order('position');
  if (previousError) throw previousError;
  const { data: link, error: linkError } = await supabase
    .from('redirect_links').update(linkInput).eq('id', linkId).select().single();
  if (linkError) throw linkError;
  const { error: deleteError } = await supabase.from('redirect_destinations').delete().eq('redirect_link_id', linkId);
  if (deleteError) throw deleteError;
  const { data: destinationRows, error: destinationsError } = await supabase
    .from('redirect_destinations').insert(toDestinationRows(linkId, destinations)).select();
  if (destinationsError) {
    if (previousDestinations?.length) {
      await supabase.from('redirect_destinations').insert(
        previousDestinations.map(({ id: _id, created_at: _createdAt, ...destination }) => destination)
      );
    }
    throw destinationsError;
  }
  return { ...link, destinations: destinationRows ?? [] };
}

export async function setRedirectLinkActive(linkId: string, active: boolean): Promise<RedirectLinkRow> {
  const { data, error } = await supabase.from('redirect_links').update({ active }).eq('id', linkId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRedirectLink(linkId: string) {
  const { error } = await supabase.from('redirect_links').delete().eq('id', linkId);
  if (error) throw error;
}

export async function resolveRedirectLink(slug: string): Promise<ResolvedRedirect | null> {
  const { data, error } = await supabase.rpc('resolve_redirect_link', { p_slug: normalizeRedirectSlug(slug) });
  if (error) throw error;
  return data?.[0] ?? null;
}
