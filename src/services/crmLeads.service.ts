import { supabase } from '../integrations/supabase/client';
import type {
  ContactRow,
  LeadEventRow,
  ProjectIntegrationRow,
  SaleRow,
  WebhookInboxRow,
} from '../integrations/supabase/database.types';

export async function getProjectIntegration(projectId: string): Promise<ProjectIntegrationRow | null> {
  const { data, error } = await supabase
    .from('project_integrations')
    .select('*')
    .eq('project_id', projectId)
    .eq('integration_type', 'webhook')
    .maybeSingle();
  if (error) throw error;
  return data;
}

function generateSecret() {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

function slugifyCode(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')
    .slice(0, 40);
}

/** Cria (ou regenera o segredo de) a integração de webhook deste projeto. */
export async function regenerateIntegration(
  projectId: string,
  projectName: string
): Promise<ProjectIntegrationRow> {
  const { data: userData } = await supabase.auth.getUser();
  const existing = await getProjectIntegration(projectId);

  const baseCode = existing?.external_code ?? (slugifyCode(projectName) || `PROJETO_${projectId.slice(0, 8)}`);

  try {
    const { data, error } = await supabase
      .from('project_integrations')
      .upsert(
        {
          project_id: projectId,
          integration_type: 'webhook',
          external_code: baseCode,
          secret: generateSecret(),
          active: true,
          created_by: userData.user?.id ?? null,
        },
        { onConflict: 'project_id,integration_type' }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (e) {
    // Código já usado por outro projeto — tenta de novo com um sufixo curto.
    const fallbackCode = `${baseCode}_${projectId.slice(0, 4).toUpperCase()}`;
    const { data, error } = await supabase
      .from('project_integrations')
      .upsert(
        {
          project_id: projectId,
          integration_type: 'webhook',
          external_code: fallbackCode,
          secret: generateSecret(),
          active: true,
          created_by: userData.user?.id ?? null,
        },
        { onConflict: 'project_id,integration_type' }
      )
      .select()
      .single();
    if (error) throw e;
    return data;
  }
}

export async function listLeadEvents(
  projectId: string,
  range?: { since: string; until: string }
): Promise<LeadEventRow[]> {
  let query = supabase
    .from('lead_events')
    .select('*')
    .eq('project_id', projectId)
    .order('occurred_at', { ascending: false });

  if (range) {
    query = query.gte('occurred_at', range.since).lte('occurred_at', `${range.until}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listSales(
  projectId: string,
  range?: { since: string; until: string }
): Promise<SaleRow[]> {
  let query = supabase
    .from('sales')
    .select('*')
    .eq('project_id', projectId)
    .order('sold_at', { ascending: false });

  if (range) {
    query = query.gte('sold_at', range.since).lte('sold_at', `${range.until}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listContactsByIds(ids: string[]): Promise<ContactRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('contacts').select('*').in('id', ids);
  if (error) throw error;
  return data ?? [];
}

export interface CrmLeadStats {
  totalLeads: number;
  uniqueContacts: number;
  sales: number;
  revenue: number;
  percentConverted: number;
}

export function computeCrmLeadStats(leadEvents: LeadEventRow[], sales: SaleRow[]): CrmLeadStats {
  const uniqueContacts = new Set(leadEvents.map((l) => l.contact_id)).size;
  const revenue = sales.reduce((acc, s) => acc + (s.amount ?? 0), 0);
  return {
    totalLeads: leadEvents.length,
    uniqueContacts,
    sales: sales.length,
    revenue,
    percentConverted: uniqueContacts > 0 ? (sales.length / uniqueContacts) * 100 : 0,
  };
}

export interface WebhookHealth {
  received: number;
  processed: number;
  partial: number;
  failed: number;
}

/** Resumo das últimas 24h da inbox — só ADMIN consegue ler (RLS). */
export async function getWebhookHealth(projectId: string): Promise<WebhookHealth> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('webhook_inbox')
    .select('processing_status')
    .eq('project_id', projectId)
    .gte('received_at', since);
  if (error) throw error;

  const rows = (data ?? []) as Pick<WebhookInboxRow, 'processing_status'>[];
  return {
    received: rows.length,
    processed: rows.filter((r) => r.processing_status === 'PROCESSED').length,
    partial: rows.filter((r) => r.processing_status === 'PARTIAL').length,
    failed: rows.filter((r) => r.processing_status === 'FAILED' || r.processing_status === 'DEAD_LETTER').length,
  };
}

export async function assignSeller(saleId: string, sellerId: string | null): Promise<void> {
  const { error } = await supabase.from('sales').update({ seller_id: sellerId }).eq('id', saleId);
  if (error) throw error;
}

export interface SellerRankRow {
  sellerId: string;
  name: string;
  photoUrl: string | null;
  points: number;
  revenue: number;
  salesGoal: number;
}

export interface SellerRankingResult {
  rows: SellerRankRow[];
  unassignedSales: number;
}

/**
 * Ranking de vendedores de um cliente inteiro (todos os projetos). Pontos =
 * 1 por venda PAID no período, mais a soma dos ajustes manuais
 * (seller_point_adjustments) no mesmo período — nunca exibe total negativo,
 * mas o ledger guarda o valor real. Vendedor desativado com pontos no
 * período continua aparecendo (o ponto foi ganho de verdade); só não
 * aparece se não tiver nada nesse período.
 */
export async function listSellerRanking(
  clientId: string,
  range: { since: string; until: string }
): Promise<SellerRankingResult> {
  const { data: projectRows, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('client_id', clientId);
  if (projectError) throw projectError;
  const projectIds = (projectRows ?? []).map((p) => p.id);

  const { data: sellerRows, error: sellerError } = await supabase
    .from('sellers')
    .select('id, name, active, photo_url, sales_goal')
    .eq('client_id', clientId);
  if (sellerError) throw sellerError;
  const sellerIds = (sellerRows ?? []).map((s) => s.id);

  const [saleResult, adjustmentResult] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from('sales')
          .select('seller_id, amount')
          .in('project_id', projectIds)
          .eq('status', 'PAID')
          .gte('sold_at', range.since)
          .lte('sold_at', `${range.until}T23:59:59`)
      : Promise.resolve({ data: [] as { seller_id: string | null; amount: number | null }[], error: null }),
    sellerIds.length > 0
      ? supabase
          .from('seller_point_adjustments')
          .select('seller_id, amount')
          .in('seller_id', sellerIds)
          .gte('created_at', range.since)
          .lte('created_at', `${range.until}T23:59:59`)
      : Promise.resolve({ data: [] as { seller_id: string; amount: number }[], error: null }),
  ]);
  if (saleResult.error) throw saleResult.error;
  if (adjustmentResult.error) throw adjustmentResult.error;
  const saleRows = saleResult.data ?? [];
  const adjustmentRows = adjustmentResult.data ?? [];

  const byId = new Map<string, SellerRankRow>();
  for (const s of sellerRows ?? []) {
    if (s.active) {
      byId.set(s.id, {
        sellerId: s.id,
        name: s.name,
        photoUrl: s.photo_url,
        points: 0,
        revenue: 0,
        salesGoal: s.sales_goal,
      });
    }
  }

  function findOrCreate(sellerId: string): SellerRankRow | null {
    let row = byId.get(sellerId);
    if (row) return row;
    const seller = (sellerRows ?? []).find((s) => s.id === sellerId);
    if (!seller) return null;
    row = {
      sellerId: seller.id,
      name: seller.name,
      photoUrl: seller.photo_url,
      points: 0,
      revenue: 0,
      salesGoal: seller.sales_goal,
    };
    byId.set(seller.id, row);
    return row;
  }

  let unassignedSales = 0;
  for (const sale of saleRows) {
    if (!sale.seller_id) {
      unassignedSales += 1;
      continue;
    }
    const row = findOrCreate(sale.seller_id);
    if (!row) {
      unassignedSales += 1;
      continue;
    }
    row.points += 1;
    row.revenue += sale.amount ?? 0;
  }

  for (const adj of adjustmentRows) {
    const row = findOrCreate(adj.seller_id);
    if (row) row.points += adj.amount;
  }

  const rows = Array.from(byId.values())
    .map((r) => ({ ...r, points: Math.max(0, r.points) }))
    .sort((a, b) => b.points - a.points || b.revenue - a.revenue);
  return { rows, unassignedSales };
}
