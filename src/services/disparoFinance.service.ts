import { supabase } from '../integrations/supabase/client';
import type {
  DisparoFinancialSettingsRow,
  InfobipDepositRow,
} from '../integrations/supabase/database.types';

export const DEFAULT_SUPPLIER_UNIT_COST = 0.16;
export const INFOBIP_RECEIPTS_BUCKET = 'infobip-receipts';
export const MAX_INFOBIP_RECEIPT_BYTES = 16 * 1024 * 1024;
export const MIN_RECEIPT_SIGNED_URL_TTL_SECONDS = 30;
export const MAX_RECEIPT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const RECEIPT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const CANONICAL_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type InfobipDepositStatus = InfobipDepositRow['status'];

export interface FinancePeriod {
  start: string;
  end: string;
}

export interface DisparoFinanceTaskSummary {
  id: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  scheduled_date: string | null;
  contracted_quantity: number;
  sent_quantity: number;
  client_unit_price: number;
  client_revenue: number;
  supplier_unit_cost: number;
  supplier_cost: number;
  gross_profit: number;
  gross_margin_percent: number | null;
}

export interface DisparoFinanceSummary {
  period: FinancePeriod;
  contracted_quantity: number;
  sent_quantity: number;
  client_revenue: number;
  supplier_cost: number;
  gross_profit: number;
  gross_margin_percent: number | null;
  infobip_deposits: number;
  reconciliation_balance: number;
  tasks: DisparoFinanceTaskSummary[];
}

export interface DisparoFinanceDashboardData {
  summary: DisparoFinanceSummary;
  deposits: InfobipDepositRow[];
}

export interface InfobipDepositInput {
  amount: number;
  deposited_at: string;
  status: InfobipDepositStatus;
  reference: string | null;
  notes: string | null;
}

function isValidCivilDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function assertPeriod(period: FinancePeriod) {
  if (!isValidCivilDate(period.start) || !isValidCivilDate(period.end)) {
    throw new Error('O período financeiro deve usar datas civis válidas no formato YYYY-MM-DD.');
  }
  if (period.start > period.end) throw new Error('A data inicial não pode ser posterior à final.');
}

function nonNegativeScaledInteger(value: number, decimalPlaces: number, label: string): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} possui um valor inválido.`);
  const fixed = value.toFixed(decimalPlaces);
  const digits = fixed.replace('.', '');
  return BigInt(digits);
}

function safeQuantity(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} possui uma quantidade inválida.`);
  return BigInt(value);
}

function centsToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('O total financeiro excede o limite seguro para exibição.');
  }
  return Number(value) / 100;
}

function integerToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
    throw new Error('A quantidade total excede o limite seguro para exibição.');
  }
  return Number(value);
}

function marginPercent(profitCents: bigint, revenueCents: bigint): number | null {
  if (revenueCents === 0n) return null;
  const basisPoints = (profitCents * 10_000n) / revenueCents;
  if (
    basisPoints > BigInt(Number.MAX_SAFE_INTEGER) ||
    basisPoints < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new Error('A margem calculada excede o limite seguro para exibição.');
  }
  return Number(basisPoints) / 100;
}

async function currentOrganizationId(): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('Usuário não autenticado.');

  const { data, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user.id)
    .single();
  if (error) throw error;
  if (!data.organization_id) throw new Error('Usuário sem organização associada.');
  return data.organization_id;
}

/** Retorna a configuração da organização, criando o padrão de R$ 0,16 quando necessário. */
export async function getDisparoFinancialSettings(): Promise<DisparoFinancialSettingsRow> {
  const { data, error } = await supabase
    .from('disparo_financial_settings')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from('disparo_financial_settings')
    .insert({ supplier_unit_cost: DEFAULT_SUPPLIER_UNIT_COST })
    .select('*')
    .single();
  if (!insertError) return inserted;

  // Duas abas podem tentar criar o padrão simultaneamente. Nesse caso, relê a
  // linha vencedora em vez de apresentar um erro de chave duplicada ao usuário.
  const { data: existing, error: refetchError } = await supabase
    .from('disparo_financial_settings')
    .select('*')
    .single();
  if (refetchError) throw insertError;
  return existing;
}

export async function updateDisparoFinancialSettings(
  supplierUnitCost: number
): Promise<DisparoFinancialSettingsRow> {
  if (!Number.isFinite(supplierUnitCost) || supplierUnitCost < 0) {
    throw new Error('O custo unitário deve ser um número maior ou igual a zero.');
  }
  const current = await getDisparoFinancialSettings();
  const { data, error } = await supabase
    .from('disparo_financial_settings')
    .update({ supplier_unit_cost: supplierUnitCost })
    .eq('organization_id', current.organization_id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listInfobipDeposits(period?: FinancePeriod): Promise<InfobipDepositRow[]> {
  if (period) assertPeriod(period);
  let query = supabase
    .from('infobip_deposits')
    .select('*')
    .order('deposited_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (period) query = query.gte('deposited_at', period.start).lte('deposited_at', period.end);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createInfobipDeposit(input: InfobipDepositInput): Promise<InfobipDepositRow> {
  const { data, error } = await supabase
    .from('infobip_deposits')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateInfobipDeposit(
  id: string,
  input: Partial<InfobipDepositInput>
): Promise<InfobipDepositRow> {
  const { data, error } = await supabase
    .from('infobip_deposits')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Remove um comprovante com compensação entre banco e Storage.
 *
 * A referência é limpa antes da remoção física. Se o Storage falhar, os
 * metadados originais são restaurados. Se o rollback também falhar, ambos os
 * erros são preservados e o erro original do Storage permanece como `cause`.
 */
async function removeReceiptCompensated(
  deposit: InfobipDepositRow
): Promise<InfobipDepositRow> {
  if (!deposit.receipt_path) return deposit;

  const receiptMetadata = {
    receipt_path: deposit.receipt_path,
    receipt_file_name: deposit.receipt_file_name,
    receipt_content_type: deposit.receipt_content_type,
  };
  const { data: cleared, error: clearError } = await supabase
    .from('infobip_deposits')
    .update({ receipt_path: null, receipt_file_name: null, receipt_content_type: null })
    .eq('id', deposit.id)
    .eq('receipt_path', receiptMetadata.receipt_path)
    .select('*')
    .maybeSingle();
  if (clearError) throw clearError;
  if (!cleared) {
    const { data: latest, error: refetchError } = await supabase
      .from('infobip_deposits')
      .select('*')
      .eq('id', deposit.id)
      .single();
    if (refetchError) throw refetchError;
    return latest;
  }

  const { error: storageError } = await supabase.storage
    .from(INFOBIP_RECEIPTS_BUCKET)
    .remove([receiptMetadata.receipt_path]);
  if (!storageError) return cleared;

  const { data: restored, error: restoreError } = await supabase
    .from('infobip_deposits')
    .update(receiptMetadata)
    .eq('id', deposit.id)
    .is('receipt_path', null)
    .select('id')
    .maybeSingle();
  if (restoreError) {
    throw new AggregateError(
      [storageError, restoreError],
      `Falha ao remover o comprovante e ao restaurar seus metadados; receiptPath=${receiptMetadata.receipt_path}`,
      { cause: storageError }
    );
  }
  if (!restored) {
    const concurrencyError = new Error(
      `Uma atualização concorrente impediu restaurar os metadados; receiptPath=${receiptMetadata.receipt_path}`
    );
    throw new AggregateError(
      [storageError, concurrencyError],
      `Falha ao remover o comprovante e restauração concorrente; receiptPath=${receiptMetadata.receipt_path}`,
      { cause: storageError }
    );
  }
  throw storageError;
}

export async function deleteInfobipDeposit(id: string): Promise<void> {
  const { data: deposit, error: fetchError } = await supabase
    .from('infobip_deposits')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) throw fetchError;

  if (deposit.receipt_path) {
    const receiptMetadata = {
      receipt_path: deposit.receipt_path,
      receipt_file_name: deposit.receipt_file_name,
      receipt_content_type: deposit.receipt_content_type,
    };
    const { data: cleared, error: clearError } = await supabase
      .from('infobip_deposits')
      .update({ receipt_path: null, receipt_file_name: null, receipt_content_type: null })
      .eq('id', deposit.id)
      .eq('receipt_path', deposit.receipt_path)
      .select('id')
      .maybeSingle();
    if (clearError) throw clearError;
    if (!cleared) {
      throw new Error('O comprovante foi atualizado simultaneamente; exclua o depósito novamente.');
    }

    const { error: storageError } = await supabase.storage
      .from(INFOBIP_RECEIPTS_BUCKET)
      .remove([deposit.receipt_path]);
    if (storageError) {
      const { data: restored, error: restoreError } = await supabase
        .from('infobip_deposits')
        .update(receiptMetadata)
        .eq('id', deposit.id)
        .is('receipt_path', null)
        .select('id')
        .maybeSingle();
      if (restoreError || !restored) {
        const restoreFailure = restoreError ?? new Error('Restauração impedida por concorrência.');
        throw new AggregateError(
          [storageError, restoreFailure],
          `Falha ao remover o comprovante e ao restaurar seus metadados; receiptPath=${deposit.receipt_path}`,
          { cause: storageError }
        );
      }
      throw storageError;
    }
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('infobip_deposits')
    .delete()
    .eq('id', deposit.id)
    .is('receipt_path', null)
    .select('id')
    .maybeSingle();
  if (deleteError) throw deleteError;
  if (!deleted) {
    throw new Error('O depósito foi atualizado simultaneamente e não foi excluído.');
  }
}

function receiptExtension(file: File) {
  const byType: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  return byType[file.type];
}

function validateReceipt(file: File) {
  if (!file.name.trim() || file.name.length > 255) {
    throw new Error('O nome do comprovante deve ter entre 1 e 255 caracteres.');
  }
  if (!RECEIPT_TYPES.has(file.type)) {
    throw new Error('O comprovante deve ser PDF, PNG, JPG ou WEBP.');
  }
  if (file.size <= 0 || file.size > MAX_INFOBIP_RECEIPT_BYTES) {
    throw new Error('O comprovante deve ter no máximo 16 MiB.');
  }
}

function isCanonicalReceiptPath(path: string, organizationId: string, depositId: string) {
  const [pathOrganizationId, pathDepositId, fileName, ...extra] = path.split('/');
  return (
    extra.length === 0 &&
    CANONICAL_UUID_REGEX.test(organizationId) &&
    CANONICAL_UUID_REGEX.test(depositId) &&
    pathOrganizationId === organizationId &&
    pathDepositId === depositId &&
    /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg|webp)$/.test(
      fileName ?? ''
    )
  );
}

async function removeNewUploadOrThrow(path: string, originalError: unknown): Promise<void> {
  const { error: cleanupError } = await supabase.storage
    .from(INFOBIP_RECEIPTS_BUCKET)
    .remove([path]);
  if (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      `Falha na operação do comprovante e ao limpar o novo upload; receiptPath=${path}`,
      { cause: originalError }
    );
  }
}

/**
 * Faz upload privado e só troca o caminho no depósito depois do upload concluir.
 * Se o update falhar, remove o arquivo novo; o comprovante anterior é preservado.
 */
export async function uploadInfobipReceipt(
  depositId: string,
  file: File
): Promise<InfobipDepositRow> {
  validateReceipt(file);
  const organizationId = await currentOrganizationId();
  const { data: current, error: fetchError } = await supabase
    .from('infobip_deposits')
    .select('*')
    .eq('id', depositId)
    .single();
  if (fetchError) throw fetchError;
  if (current.organization_id !== organizationId) {
    throw new Error('O depósito não pertence à organização autenticada.');
  }

  const path = `${organizationId}/${current.id}/${Date.now()}-${crypto.randomUUID()}.${receiptExtension(file)}`;
  const { error: uploadError } = await supabase.storage
    .from(INFOBIP_RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  let updateQuery = supabase
    .from('infobip_deposits')
    .update({
      receipt_path: path,
      receipt_file_name: file.name,
      receipt_content_type: file.type,
    })
    .eq('id', current.id);
  updateQuery = current.receipt_path
    ? updateQuery.eq('receipt_path', current.receipt_path)
    : updateQuery.is('receipt_path', null);
  const { data, error: updateError } = await updateQuery
    .select('*')
    .maybeSingle();
  if (updateError) {
    await removeNewUploadOrThrow(path, updateError);
    throw updateError;
  }

  if (!data) {
    const conflictError = new Error(
      'Outro upload atualizou este depósito ao mesmo tempo; foi mantido o comprovante vencedor.'
    );
    await removeNewUploadOrThrow(path, conflictError);
    const { data: winner, error: refetchError } = await supabase
      .from('infobip_deposits')
      .select('*')
      .eq('id', current.id)
      .single();
    if (refetchError) throw refetchError;
    return winner;
  }

  if (current.receipt_path && current.receipt_path !== path) {
    // O banco já aponta para o arquivo novo. A limpeza do objeto substituído é
    // best effort: falhar aqui não deve induzir retry nem substituir novamente.
    const { error: oldReceiptCleanupError } = await supabase.storage
      .from(INFOBIP_RECEIPTS_BUCKET)
      .remove([current.receipt_path]);
    if (oldReceiptCleanupError) {
      console.warn('Falha ao limpar comprovante substituído no Storage.', {
        receiptPath: current.receipt_path,
        error: oldReceiptCleanupError,
      });
    }
  }
  return data;
}

export async function removeInfobipReceipt(depositId: string): Promise<InfobipDepositRow> {
  const { data: current, error: fetchError } = await supabase
    .from('infobip_deposits')
    .select('*')
    .eq('id', depositId)
    .single();
  if (fetchError) throw fetchError;

  return removeReceiptCompensated(current);
}

/** Gera uma URL temporária; nunca retorna URL pública para comprovantes. */
export async function createInfobipReceiptSignedUrl(
  receiptPath: string,
  expiresInSeconds = 300
): Promise<string> {
  if (!receiptPath) throw new Error('Este depósito não possui comprovante.');
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < MIN_RECEIPT_SIGNED_URL_TTL_SECONDS ||
    expiresInSeconds > MAX_RECEIPT_SIGNED_URL_TTL_SECONDS
  ) {
    throw new Error(
      `A URL temporária deve expirar entre ${MIN_RECEIPT_SIGNED_URL_TTL_SECONDS} e ${MAX_RECEIPT_SIGNED_URL_TTL_SECONDS} segundos.`
    );
  }

  const organizationId = await currentOrganizationId();
  const depositId = receiptPath.split('/')[1] ?? '';
  if (!isCanonicalReceiptPath(receiptPath, organizationId, depositId)) {
    throw new Error('Caminho de comprovante inválido para a organização autenticada.');
  }
  const { data: deposit, error: depositError } = await supabase
    .from('infobip_deposits')
    .select('id')
    .eq('id', depositId)
    .eq('organization_id', organizationId)
    .eq('receipt_path', receiptPath)
    .maybeSingle();
  if (depositError) throw depositError;
  if (!deposit) throw new Error('Comprovante não encontrado neste depósito.');

  const { data, error } = await supabase.storage
    .from(INFOBIP_RECEIPTS_BUCKET)
    .createSignedUrl(receiptPath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function getDisparoFinanceDashboardData(
  period: FinancePeriod
): Promise<DisparoFinanceDashboardData> {
  assertPeriod(period);
  const [tasksResult, deposits] = await Promise.all([
    supabase
      .from('disparo_tasks')
      .select(
        'id,title,client_id,scheduled_date,contracted_quantity,sent_quantity,client_revenue,supplier_unit_cost,clients(name)'
      )
      .gte('scheduled_date', period.start)
      .lte('scheduled_date', period.end)
      .order('scheduled_date', { ascending: true }),
    listInfobipDeposits(period),
  ]);
  if (tasksResult.error) throw tasksResult.error;

  type FinanceQueryRow = {
    id: string;
    title: string;
    client_id: string | null;
    scheduled_date: string | null;
    contracted_quantity: number;
    sent_quantity: number;
    client_revenue: number;
    supplier_unit_cost: number;
    clients: { name: string } | null;
  };

  const tasks = ((tasksResult.data ?? []) as unknown as FinanceQueryRow[]).map((task) => {
    const { clients, ...taskFields } = task;
    const sentQuantity = safeQuantity(task.sent_quantity, `A demanda ${task.title}`);
    const unitCostScaled = nonNegativeScaledInteger(
      task.supplier_unit_cost,
      4,
      `O custo unitário da demanda ${task.title}`
    );
    const clientUnitPriceCents = nonNegativeScaledInteger(
      task.client_revenue,
      2,
      `O preço por mensagem da demanda ${task.title}`
    );
    const revenueCents = sentQuantity * clientUnitPriceCents;
    // unitCostScaled usa 4 casas. Dividir por 100 converte para centavos, com
    // arredondamento half-up, sem multiplicação em ponto flutuante.
    const supplierCostCents = (sentQuantity * unitCostScaled + 50n) / 100n;
    const grossProfitCents = revenueCents - supplierCostCents;
    return {
      ...taskFields,
      client_unit_price: task.client_revenue,
      client_revenue: centsToNumber(revenueCents),
      client_name: clients?.name ?? null,
      supplier_cost: centsToNumber(supplierCostCents),
      gross_profit: centsToNumber(grossProfitCents),
      gross_margin_percent: marginPercent(grossProfitCents, revenueCents),
    };
  });

  const contractedQuantity = tasks.reduce(
    (sum, task) => sum + safeQuantity(task.contracted_quantity, `A demanda ${task.title}`),
    0n
  );
  const sentQuantity = tasks.reduce(
    (sum, task) => sum + safeQuantity(task.sent_quantity, `A demanda ${task.title}`),
    0n
  );
  const clientRevenueCents = tasks.reduce(
    (sum, task) => sum + nonNegativeScaledInteger(task.client_revenue, 2, `A receita da demanda ${task.title}`),
    0n
  );
  const supplierCostCents = tasks.reduce(
    (sum, task) => sum + nonNegativeScaledInteger(task.supplier_cost, 2, `O custo da demanda ${task.title}`),
    0n
  );
  const grossProfitCents = clientRevenueCents - supplierCostCents;
  const infobipDepositCents = deposits
    .filter((deposit) => deposit.status === 'confirmed')
    .reduce(
      (sum, deposit) => sum + nonNegativeScaledInteger(deposit.amount, 2, 'O depósito Infobip'),
      0n
    );

  const summary = {
    period,
    contracted_quantity: integerToSafeNumber(contractedQuantity),
    sent_quantity: integerToSafeNumber(sentQuantity),
    client_revenue: centsToNumber(clientRevenueCents),
    supplier_cost: centsToNumber(supplierCostCents),
    gross_profit: centsToNumber(grossProfitCents),
    gross_margin_percent: marginPercent(grossProfitCents, clientRevenueCents),
    infobip_deposits: centsToNumber(infobipDepositCents),
    reconciliation_balance: centsToNumber(supplierCostCents - infobipDepositCents),
    tasks,
  };
  return { summary, deposits };
}

export async function getDisparoFinanceSummary(period: FinancePeriod): Promise<DisparoFinanceSummary> {
  return (await getDisparoFinanceDashboardData(period)).summary;
}
