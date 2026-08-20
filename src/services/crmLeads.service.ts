import { supabase } from '../integrations/supabase/client';
import type {
  ContactRow,
  LeadEventRow,
  ProjectIntegrationRow,
  ProjectCustomFieldRow,
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
  const rows: LeadEventRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('lead_events').select('*').eq('project_id', projectId).order('occurred_at', { ascending: false }).range(from, from + pageSize - 1);
    if (range) query = query.gte('occurred_at', range.since).lte('occurred_at', `${range.until}T23:59:59`);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

/** Busca eventos já vinculados às vendas, inclusive quando o lead ocorreu antes do período do painel. */
export async function listLeadEventsByIds(ids: string[]): Promise<LeadEventRow[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 200) chunks.push(uniqueIds.slice(index, index + 200));
  const results = await Promise.all(chunks.map((chunk) => supabase.from('lead_events').select('*').in('id', chunk)));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return results.flatMap((result) => result.data ?? []);
}

export async function listSales(
  projectId: string,
  range?: { since: string; until: string }
): Promise<SaleRow[]> {
  const rows: SaleRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('sales').select('*').eq('project_id', projectId).order('sold_at', { ascending: false }).range(from, from + pageSize - 1);
    if (range) query = query.gte('sold_at', range.since).lte('sold_at', `${range.until}T23:59:59`);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function listContactsByIds(ids: string[]): Promise<ContactRow[]> {
  if (ids.length === 0) return [];
  const uniqueIds = Array.from(new Set(ids));
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 200) chunks.push(uniqueIds.slice(index, index + 200));
  const results = await Promise.all(chunks.map((chunk) => supabase.from('contacts').select('*').in('id', chunk)));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return results.flatMap((result) => result.data ?? []);
}

type CsvSaleImportRow = {
  external_sale_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  sold_at: string;
  amount: number | null;
  status: string;
  payment_method: string | null;
  seller_name: string | null;
  raw_payload: Record<string, string>;
  custom_fields: Record<string, string>;
};

export type SalesCsvMapping = Partial<Record<'date' | 'type' | 'name' | 'email' | 'phone' | 'payment' | 'seller' | 'onboarding' | 'bonus' | 'observation', number>>;
export type SalesCsvCustomColumn = { index: number; label: string };

export async function listProjectCustomFields(projectId: string, entityType: 'sale' | 'lead'): Promise<ProjectCustomFieldRow[]> {
  const { data, error } = await supabase.from('project_custom_fields').select('*').eq('project_id', projectId).eq('entity_type', entityType).eq('active', true).order('created_at');
  if (error) throw error;
  return data ?? [];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value.replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function parseSaleDate(value: string): string | null {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})[-/ ]([a-zçã]+|\d{1,2})[-/ ](\d{2,4})$/i);
  if (!match) return null;
  const months: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const day = Number(match[1]);
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : months[match[2].slice(0, 3)];
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!month || day < 1 || day > 31 || year < 2000) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00.000Z`;
}

function parseSaleAmount(value: string): number | null {
  const text = value.toLowerCase().replace(/r\$\s*/g, '').trim();
  if (!text) return null;
  let total = 0;
  let found = false;
  for (const match of text.matchAll(/(\d+)\s*x\s*([\d.]+(?:,\d{1,2})?)/gi)) {
    const unit = Number(match[2].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(unit)) {
      total += Number(match[1]) * unit;
      found = true;
    }
  }
  for (const match of text.matchAll(/(?:^|\+)\s*([\d.]+(?:,\d{1,2})?)\s*k\b/gi)) {
    total += Number(match[1].replace(/\./g, '').replace(',', '.')) * 1000;
    found = true;
  }
  if (found) return Math.round(total * 100) / 100;
  const plain = text.match(/[\d.]+(?:,\d{1,2})?/);
  if (!plain) return null;
  const amount = Number(plain[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

export async function importSalesCsv(projectId: string, csvText: string, customMapping?: SalesCsvMapping, customColumns: SalesCsvCustomColumn[] = []) {
  const matrix = parseCsv(csvText);
  if (matrix.length < 2) throw new Error('O CSV não possui linhas de matrícula válidas.');
  const headers = matrix[0].map(normalizeHeader);
  const index = (name: string) => headers.indexOf(normalizeHeader(name));
  const columns = {
    date: index('Data da Venda'), type: index('Tipo'), name: index('Nome'), email: index('E-mail'),
    phone: index('WhatsApp'), payment: index('Forma de pagamento'), seller: index('Vendedor'),
    onboarding: index('Onboarding'), bonus: index('Bonus'), observation: index('Observação'),
  };
  if (customMapping) Object.assign(columns, customMapping);
  if (columns.date < 0 || columns.name < 0) throw new Error('CSV inválido: as colunas Data da Venda e Nome são obrigatórias. Os demais campos podem ser ignorados.');
  const rows: CsvSaleImportRow[] = [];
  matrix.slice(1).forEach((values, rowIndex) => {
    const get = (column: number) => (column >= 0 ? values[column]?.trim() ?? '' : '');
    const name = get(columns.name);
    const soldAt = parseSaleDate(get(columns.date));
    if (!name || !soldAt) return;
    const email = get(columns.email).toLowerCase() || null;
    const phone = get(columns.phone).replace(/\D/g, '') || null;
    const type = get(columns.type);
    rows.push({
      external_sale_id: `csv-matriculas-pos-eng-${rowIndex + 1}`,
      name,
      email,
      phone,
      sold_at: soldAt,
      amount: parseSaleAmount(get(columns.payment)),
      status: /^cancelad/i.test(type) ? 'CANCELADO' : 'PAID',
      payment_method: get(columns.payment) || null,
      seller_name: get(columns.seller) || null,
      raw_payload: { tipo: type, onboarding: get(columns.onboarding), bonus: get(columns.bonus), observacao: get(columns.observation) },
      custom_fields: Object.fromEntries(customColumns.map((column) => [column.label, get(column.index)]).filter(([, value]) => value !== '')),
    });
  });
  if (rows.length === 0) throw new Error('Nenhuma matrícula com nome e data válida foi encontrada.');
  const { data, error } = await supabase.rpc('import_sales_batch', { p_project_id: projectId, p_rows: rows });
  if (error) {
    if (error.code === '42883' || /import_sales_batch|function.*does not exist/i.test(error.message)) {
      throw new Error('A importação ainda não foi ativada no banco. Aplique a migration 0022_sales_csv_import.sql no Supabase e tente novamente.');
    }
    if (/sem permiss[aã]o|permission/i.test(error.message)) {
      throw new Error('Seu usuário não tem permissão para importar vendas. Entre com um administrador ou conceda "Editar configurações" ao projeto.');
    }
    throw error;
  }
  const dates = rows.map((row) => row.sold_at.slice(0, 10)).sort();
  return { ...((data as unknown as { inserted_count: number; skipped_count: number; invalid_count: number }[])[0] ?? { inserted_count: 0, skipped_count: 0, invalid_count: 0 }), parsed: rows.length, start: dates[0], end: dates[dates.length - 1] };
}

export type LeadsCsvMapping = Partial<Record<'date' | 'time' | 'name' | 'email' | 'phone' | 'source' | 'campaign' | 'medium' | 'content' | 'term' | 'status', number>>;
export type LeadsCsvCustomColumn = { index: number; label: string };
type CsvLeadImportRow = {
  external_id: string; name: string; email: string | null; phone: string | null; occurred_at: string;
  utm_source: string | null; utm_campaign: string | null; utm_medium: string | null; utm_content: string | null; utm_term: string | null;
  status: string; raw_payload: Record<string, string>; custom_fields: Record<string, string>;
};

function parseLeadDate(dateValue: string, timeValue: string): string | null {
  const match = dateValue.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const month = Number(match[2]);
  const day = Number(match[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(timeValue.trim()) ? timeValue.trim() : '12:00:00';
  const normalizedTime = time.split(':').length === 2 ? `${time}:00` : time;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${normalizedTime}-03:00`;
}

export type LeadImportProgress = { processed: number; total: number; inserted: number; updated: number; invalid: number };

export async function importLeadsCsv(projectId: string, csvText: string, mapping: LeadsCsvMapping, customColumns: LeadsCsvCustomColumn[] = [], onProgress?: (progress: LeadImportProgress) => void) {
  const matrix = parseCsv(csvText);
  if (matrix.length < 2) throw new Error('O CSV não possui linhas de leads válidas.');
  if ((mapping.date ?? -1) < 0 || (mapping.name ?? -1) < 0) throw new Error('Data e Nome são obrigatórios.');
  const rows: CsvLeadImportRow[] = [];
  matrix.slice(1).forEach((values, rowIndex) => {
    const get = (column: number | undefined) => column != null && column >= 0 ? values[column]?.trim() ?? '' : '';
    const name = get(mapping.name);
    const occurredAt = parseLeadDate(get(mapping.date), get(mapping.time));
    if (!name || !occurredAt) return;
    const formed = get(mapping.status);
    rows.push({
      external_id: `csv-leads-pos-dados-${rowIndex + 1}`,
      name,
      email: get(mapping.email).toLowerCase() || null,
      phone: get(mapping.phone).replace(/\D/g, '') || null,
      occurred_at: occurredAt,
      utm_source: get(mapping.source) || null,
      utm_campaign: get(mapping.campaign) || null,
      utm_medium: get(mapping.medium) || null,
      utm_content: get(mapping.content) || null,
      utm_term: get(mapping.term) || null,
      status: formed && !/^(n[aã]o|nao|0|false)$/i.test(formed) ? 'FORMADO' : 'NOVO',
      raw_payload: { formado: formed },
      custom_fields: Object.fromEntries(customColumns.map((column) => [column.label, get(column.index)]).filter(([, value]) => value !== '')),
    });
  });
  if (rows.length === 0) throw new Error('Nenhum lead com nome e data válida foi encontrado.');
  const totals = { inserted_count: 0, updated_count: 0, invalid_count: matrix.length - 1 - rows.length };
  let processed = 0;
  const report = () => onProgress?.({ processed, total: rows.length, inserted: totals.inserted_count, updated: totals.updated_count, invalid: totals.invalid_count });
  report();
  async function processBatch(batch: CsvLeadImportRow[]): Promise<void> {
    const { data, error } = await supabase.rpc('import_leads_batch', { p_project_id: projectId, p_rows: batch });
    if (error) {
      if (/sem permiss[aã]o|permission|import_leads_batch|does not exist/i.test(error.message)) throw new Error(error.message);
      if (batch.length === 1) { totals.invalid_count += 1; processed += 1; report(); return; }
      const middle = Math.ceil(batch.length / 2);
      await processBatch(batch.slice(0, middle));
      await processBatch(batch.slice(middle));
      return;
    }
    const result = (data as unknown as Array<{ inserted_count: number; updated_count: number; invalid_count: number }>)[0];
    if (result) { totals.inserted_count += result.inserted_count; totals.updated_count += result.updated_count; totals.invalid_count += result.invalid_count; }
    processed += batch.length;
    report();
  }
  for (let index = 0; index < rows.length; index += 150) await processBatch(rows.slice(index, index + 150));
  const dates = rows.map((row) => row.occurred_at.slice(0, 10)).sort();
  return { ...totals, parsed: rows.length, start: dates[0], end: dates[dates.length - 1] };
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
