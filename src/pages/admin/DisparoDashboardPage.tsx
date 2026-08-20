import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Banknote,
  CalendarDays,
  CircleDollarSign,
  ExternalLink,
  FileCheck2,
  Landmark,
  Loader2,
  MessageSquareText,
  Percent,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LucideIcon } from 'lucide-react';
import type { InfobipDepositRow } from '../../integrations/supabase/database.types';
import {
  createInfobipDeposit,
  createInfobipReceiptSignedUrl,
  getDisparoFinanceDashboardData,
  MAX_INFOBIP_RECEIPT_BYTES,
  uploadInfobipReceipt,
  type DisparoFinanceSummary,
  type FinancePeriod,
  type InfobipDepositStatus,
} from '../../services/disparoFinance.service';
import { Card } from '../../components/ui/Card';
import { EmptyView, ErrorView, LoadingView } from '../../components/ui/StateView';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');
const compactBrl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat('pt-BR');

const inputClass =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35 disabled:cursor-not-allowed disabled:opacity-60';
const labelClass = 'mb-1 block text-xs font-medium text-[var(--color-text-muted)]';
const MAX_NUMERIC_14_2 = 999_999_999_999.99;
const receiptTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

const statusLabels: Record<InfobipDepositStatus, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

const statusClasses: Record<InfobipDepositStatus, string> = {
  pending: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  confirmed: 'bg-[var(--color-good-soft)] text-[var(--color-good)]',
  cancelled: 'bg-[var(--color-bad-soft)] text-[var(--color-bad)]',
};

function localIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function currentMonth() {
  return localIsoDate().slice(0, 7);
}

function periodFromMonth(month: string): FinancePeriod {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function dateInPeriod(date: string, period: FinancePeriod) {
  return date >= period.start && date <= period.end;
}

function formatCivilDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function safeDownloadName(value: string | null) {
  const sanitized = Array.from(value ?? 'comprovante-infobip')
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (sanitized || 'comprovante-infobip').slice(0, 255);
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function supplierSettlementLabel(balance: number) {
  return balance >= 0 ? 'A pagar ao fornecedor' : 'Crédito para o próximo acerto';
}

async function printSupplierReport(summary: DisparoFinanceSummary, deposits: InfobipDepositRow[], month: string) {
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) throw new Error('O navegador bloqueou a abertura do relatório. Libere pop-ups para continuar.');
  reportWindow.opener = null;
  reportWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Gerando relatório...</title></head><body style="font-family:Arial;padding:32px">Gerando links seguros dos comprovantes…</body></html>');
  const reportLinkTtlSeconds = 7 * 24 * 60 * 60;
  const depositLinks = new Map<string, string>();
  await Promise.all(deposits.map(async (deposit) => {
    if (!deposit.receipt_path) return;
    try {
      depositLinks.set(
        deposit.id,
        await createInfobipReceiptSignedUrl(deposit.receipt_path, reportLinkTtlSeconds)
      );
    } catch {
      // O relatório continua disponível e identifica o comprovante sem link.
    }
  }));
  const confirmedDeposits = deposits.filter((deposit) => deposit.status === 'confirmed');
  const periodLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T12:00:00`));
  const balance = summary.reconciliation_balance;
  const taskRows = summary.tasks.map((task) => `
    <tr>
      <td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.client_name || 'Não informado')}</td>
      <td>${escapeHtml(task.scheduled_date ? formatCivilDate(task.scheduled_date) : '—')}</td>
      <td class="number">${escapeHtml(integer.format(task.sent_quantity))}</td>
      <td class="number">${escapeHtml(brl.format(task.supplier_unit_cost))}</td>
      <td class="number">${escapeHtml(brl.format(task.supplier_cost))}</td>
    </tr>`).join('');
  const depositRows = deposits.map((deposit) => `
    <tr>
      <td>${escapeHtml(formatCivilDate(deposit.deposited_at))}</td>
      <td>${escapeHtml(deposit.reference || '—')}</td><td>${escapeHtml(statusLabels[deposit.status])}</td>
      <td class="number">${escapeHtml(brl.format(deposit.amount))}</td>
      <td>${escapeHtml(deposit.notes || '—')}</td>
      <td>${depositLinks.has(deposit.id) ? `<a href="${escapeHtml(depositLinks.get(deposit.id))}" target="_blank" rel="noopener noreferrer">Abrir comprovante</a>` : deposit.receipt_path ? 'Link indisponível' : 'Sem comprovante'}</td>
    </tr>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Acerto fornecedor - ${escapeHtml(periodLabel)}</title>
  <style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;font-size:12px;margin:0}
    h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:24px 0 8px}.muted{color:#64748b}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.box{border:1px solid #cbd5e1;border-radius:8px;padding:12px}.box strong{display:block;font-size:17px;margin-top:6px}.due{border:2px solid #2563eb;background:#eff6ff}.formula{text-align:center;margin:12px 0;color:#475569}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:7px 6px;text-align:left;vertical-align:top}th{background:#f8fafc;font-size:10px;text-transform:uppercase;color:#475569}.number{text-align:right;white-space:nowrap}.final{margin-top:20px;border:2px solid #0f766e;background:#f0fdfa;border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:center}.final strong{font-size:22px}.footer{margin-top:28px;padding-top:10px;border-top:1px solid #cbd5e1;color:#64748b;font-size:10px}@media print{button{display:none}}
  </style></head><body>
  <h1>Relatório de acerto com fornecedor</h1><p class="muted">Período: ${escapeHtml(periodLabel)} · Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</p>
  <div class="summary"><div class="box"><span>Mensagens entregues</span><strong>${escapeHtml(integer.format(summary.sent_quantity))}</strong></div><div class="box"><span>Custo total (fornecedor + Infobip)</span><strong>${escapeHtml(brl.format(summary.supplier_cost))}</strong></div><div class="box"><span>Depósitos Infobip confirmados</span><strong>${escapeHtml(brl.format(summary.infobip_deposits))}</strong></div></div>
  <p class="formula">Custo total da operação − depósitos confirmados na Infobip = acerto com o fornecedor</p>
  <h2>Mensagens entregues por demanda</h2><table><thead><tr><th>Demanda</th><th>Cliente</th><th>Data</th><th class="number">Entregues</th><th class="number">Custo/un.</th><th class="number">Custo total</th></tr></thead><tbody>${taskRows || '<tr><td colspan="6">Nenhuma demanda no período.</td></tr>'}</tbody></table>
  <h2>Resumo dos depósitos Infobip</h2><table><thead><tr><th>Data</th><th>Referência</th><th>Status</th><th class="number">Valor</th><th>Observação</th><th>Comprovante</th></tr></thead><tbody>${depositRows || '<tr><td colspan="6">Nenhum depósito no período.</td></tr>'}</tbody></table>
  <div class="final"><div><span>${escapeHtml(supplierSettlementLabel(balance))}</span><p class="muted">${confirmedDeposits.length} depósito(s) confirmado(s) abatido(s)</p></div><strong>${escapeHtml(brl.format(Math.abs(balance)))}</strong></div>
  <p class="footer">Este relatório considera o custo unitário total da demanda (fornecedor + Infobip). Os depósitos confirmados na Infobip são tratados como adiantamento e abatidos do valor do acerto. Por segurança, os links dos comprovantes são privados e válidos por 7 dias após a geração deste relatório.</p>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
          <p className="mt-2 truncate text-xl font-semibold text-[var(--color-text)]">{value}</p>
          <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-faint)]">{detail}</p>
        </div>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
        >
          <Icon size={17} style={{ color }} />
        </span>
      </div>
    </div>
  );
}

function SupplierSettlementCard({
  summary,
  onPrint,
}: {
  summary: DisparoFinanceSummary;
  onPrint: () => void;
}) {
  const balance = summary.reconciliation_balance;
  const paidPercent = summary.supplier_cost > 0
    ? Math.min((summary.infobip_deposits / summary.supplier_cost) * 100, 100)
    : 0;
  return (
    <section id="acerto-fornecedor" className="scroll-mt-6 overflow-hidden rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-[var(--color-panel)] to-cyan-500/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-blue-300">Acerto com o fornecedor</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--color-text)]">Fornecedor + Infobip dentro do custo de R$ 0,16</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">O depósito na Infobip é um adiantamento e reduz o valor que falta pagar ao fornecedor.</p>
        </div>
        <button type="button" onClick={onPrint} className="flex items-center gap-2 rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60">
          <Printer size={15} /> Gerar relatório do fornecedor
        </button>
      </div>
      <div className="mt-5 grid items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_1.15fr]">
        <div className="rounded-xl border border-[var(--color-border)] bg-black/10 p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Custo total da operação</p>
          <p className="mt-1 text-xl font-semibold text-[var(--color-warn)]">{brl.format(summary.supplier_cost)}</p>
          <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">{integer.format(summary.sent_quantity)} entregues × custo unitário</p>
        </div>
        <span className="hidden text-xl text-[var(--color-text-faint)] md:block">−</span>
        <div className="rounded-xl border border-[var(--color-border)] bg-black/10 p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Depósitos Infobip</p>
          <p className="mt-1 text-xl font-semibold text-[var(--color-brand)]">{brl.format(summary.infobip_deposits)}</p>
          <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">Somente depósitos confirmados</p>
        </div>
        <span className="hidden text-xl text-[var(--color-text-faint)] md:block">=</span>
        <div className={`rounded-xl border p-4 ${balance >= 0 ? 'border-blue-400/40 bg-blue-500/10' : 'border-[var(--color-good)]/40 bg-[var(--color-good-soft)]'}`}>
          <p className="text-xs text-[var(--color-text-muted)]">{supplierSettlementLabel(balance)}</p>
          <p className={`mt-1 text-2xl font-semibold ${balance >= 0 ? 'text-blue-200' : 'text-[var(--color-good)]'}`}>{brl.format(Math.abs(balance))}</p>
          <p className="mt-1 text-[10px] text-[var(--color-text-faint)]">Valor final para o acerto do período</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-[10px] text-[var(--color-text-faint)]"><span>Adiantado na Infobip</span><span>{paidPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do custo</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-panel-2)]"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${paidPercent}%` }} /></div>
      </div>
    </section>
  );
}

export function DisparoDashboardPage({ reportOnly = false }: { reportOnly?: boolean }) {
  const receiptInputId = useId();
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const replacementTarget = useRef<InfobipDepositRow | null>(null);
  const requestGeneration = useRef(0);
  const saveLock = useRef(false);
  const replacementLock = useRef(false);
  const [month, setMonth] = useState(currentMonth);
  const period = useMemo(() => periodFromMonth(month), [month]);
  const [summary, setSummary] = useState<DisparoFinanceSummary | null>(null);
  const [deposits, setDeposits] = useState<InfobipDepositRow[]>([]);
  const [loadedPeriodKey, setLoadedPeriodKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [receiptActionError, setReceiptActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openingReceiptId, setOpeningReceiptId] = useState<string | null>(null);
  const [replacingReceiptId, setReplacingReceiptId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [depositedAt, setDepositedAt] = useState(localIsoDate);
  const [status, setStatus] = useState<InfobipDepositStatus>('confirmed');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptRetryDeposit, setReceiptRetryDeposit] = useState<InfobipDepositRow | null>(null);
  const periodKey = `${period.start}:${period.end}`;

  const load = useCallback(async (clearSnapshot = false): Promise<boolean> => {
    const generation = ++requestGeneration.current;
    if (clearSnapshot) {
      setSummary(null);
      setDeposits([]);
      setLoadedPeriodKey(null);
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getDisparoFinanceDashboardData(period);
      if (generation !== requestGeneration.current) return false;
      setSummary(data.summary);
      setDeposits(data.deposits);
      setLoadedPeriodKey(periodKey);
      return true;
    } catch (caught) {
      if (generation !== requestGeneration.current) return false;
      setLoadError(caught instanceof Error ? caught.message : 'Não foi possível carregar o dashboard financeiro.');
      return false;
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [period, periodKey]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!dateInPeriod(depositedAt, period)) {
      const today = localIsoDate();
      setDepositedAt(dateInPeriod(today, period) ? today : period.start);
    }
  }, [depositedAt, period]);

  const dailyProfitData = useMemo(() => {
    if (!summary) return [];
    const totalsByDate = new Map<string, { profitCents: number; costCents: number }>();
    for (const task of summary.tasks) {
      if (!task.scheduled_date) continue;
      const current = totalsByDate.get(task.scheduled_date) ?? { profitCents: 0, costCents: 0 };
      current.profitCents += Math.round(task.gross_profit * 100);
      current.costCents += Math.round(task.supplier_cost * 100);
      totalsByDate.set(task.scheduled_date, current);
    }
    return Array.from(totalsByDate.entries())
      .sort(([firstDate], [secondDate]) => firstDate.localeCompare(secondDate))
      .map(([date, totals]) => ({
        date,
        label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
        profit: totals.profitCents / 100,
        cost: totals.costCents / 100,
      }));
  }, [summary]);

  function resetDepositForm() {
    setAmount('');
    setReference('');
    setNotes('');
    setReceipt(null);
    setReceiptRetryDeposit(null);
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  }

  function receiptValidationError(file: File | null) {
    if (!file) return null;
    if (!file.name.trim() || file.name.length > 255) return 'O nome do comprovante deve ter até 255 caracteres.';
    if (!receiptTypes.includes(file.type) || file.size <= 0 || file.size > MAX_INFOBIP_RECEIPT_BYTES) {
      return 'O comprovante deve ser PDF, PNG, JPG ou WEBP e ter no máximo 16 MiB.';
    }
    return null;
  }

  async function handleCreateDeposit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setCreateError(null);
    setUploadError(null);
    setReloadError(null);
    try {
      const fileError = receiptValidationError(receipt);
      if (fileError) {
        setUploadError(fileError);
        return;
      }

      if (receiptRetryDeposit) {
        if (!receipt) {
          setUploadError('Selecione o comprovante para tentar anexar novamente.');
          return;
        }
        try {
          await uploadInfobipReceipt(receiptRetryDeposit.id, receipt);
          resetDepositForm();
        } catch (caught) {
          setUploadError(caught instanceof Error ? caught.message : 'Não foi possível anexar o comprovante.');
          return;
        }
        if (!(await load())) setReloadError('O comprovante foi anexado, mas a lista não pôde ser atualizada.');
        return;
      }

      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > MAX_NUMERIC_14_2) {
        setCreateError(`Informe um valor maior que zero e menor ou igual a ${brl.format(MAX_NUMERIC_14_2)}.`);
        return;
      }
      if (!dateInPeriod(depositedAt, period)) {
        setCreateError('A data do depósito precisa estar dentro do mês selecionado.');
        return;
      }

      let deposit: InfobipDepositRow;
      try {
        deposit = await createInfobipDeposit({
          amount: Math.round((parsedAmount + Number.EPSILON) * 100) / 100,
          deposited_at: depositedAt,
          status,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        });
      } catch (caught) {
        setCreateError(caught instanceof Error ? caught.message : 'Não foi possível registrar o depósito.');
        return;
      }

      if (receipt) {
        try {
          await uploadInfobipReceipt(deposit.id, receipt);
        } catch (caught) {
          setReceiptRetryDeposit(deposit);
          setUploadError(
            `O depósito foi criado, mas o comprovante não foi anexado. ${caught instanceof Error ? caught.message : ''}`.trim()
          );
          if (!(await load())) setReloadError('O depósito foi criado, mas a lista não pôde ser atualizada.');
          return;
        }
      }

      resetDepositForm();
      if (!(await load())) setReloadError('O depósito foi criado, mas a lista não pôde ser atualizada.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function openReceipt(deposit: InfobipDepositRow, download: boolean) {
    if (!deposit.receipt_path || openingReceiptId) return;
    const placeholder = download ? null : window.open('about:blank', '_blank');
    if (placeholder) placeholder.opener = null;
    setOpeningReceiptId(deposit.id);
    setReceiptActionError(null);
    try {
      const url = await createInfobipReceiptSignedUrl(deposit.receipt_path);
      if (!download) {
        if (!placeholder) throw new Error('O navegador bloqueou a nova janela do comprovante.');
        placeholder.location.href = url;
        return;
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error('Não foi possível baixar o comprovante.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.rel = 'noopener noreferrer';
      anchor.download = safeDownloadName(deposit.receipt_file_name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (caught) {
      placeholder?.close();
      setReceiptActionError(caught instanceof Error ? caught.message : 'Não foi possível abrir o comprovante.');
    } finally {
      setOpeningReceiptId(null);
    }
  }

  function chooseReplacement(deposit: InfobipDepositRow) {
    if (replacementLock.current) return;
    replacementTarget.current = deposit;
    replacementInputRef.current?.click();
  }

  async function replaceReceipt(file: File | null) {
    const deposit = replacementTarget.current;
    replacementTarget.current = null;
    if (!file || !deposit || replacementLock.current) return;
    const validationError = receiptValidationError(file);
    if (validationError) {
      setReceiptActionError(validationError);
      if (replacementInputRef.current) replacementInputRef.current.value = '';
      return;
    }

    replacementLock.current = true;
    setReplacingReceiptId(deposit.id);
    setReceiptActionError(null);
    setReloadError(null);
    try {
      await uploadInfobipReceipt(deposit.id, file);
      if (!(await load())) setReloadError('O comprovante foi salvo, mas a lista não pôde ser atualizada.');
    } catch (caught) {
      setReceiptActionError(caught instanceof Error ? caught.message : 'Não foi possível salvar o comprovante.');
    } finally {
      replacementLock.current = false;
      setReplacingReceiptId(null);
      if (replacementInputRef.current) replacementInputRef.current.value = '';
    }
  }

  return (
    <main className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
      <input
        ref={replacementInputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        onChange={(event) => void replaceReceipt(event.target.files?.[0] ?? null)}
      />
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 sm:p-5 lg:flex-row lg:items-center">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
            <TrendingUp size={20} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-[var(--color-text)]">
                {reportOnly ? 'Relatório do fornecedor' : 'Dashboard de disparos'}
              </h1>
              <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-good)]">
                Infobip
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-text-muted)]">
              {reportOnly
                ? 'Confira mensagens entregues, depósitos Infobip e o valor final do acerto com o fornecedor.'
                : 'Acompanhe receita, custo total, lucro e os depósitos da operação.'}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="disparo-finance-month" className={labelClass}>Período</label>
            <input
              id="disparo-finance-month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value || currentMonth())}
              disabled={saving || replacingReceiptId !== null || Boolean(receiptRetryDeposit)}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Atualizar dashboard"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {loadError && loadedPeriodKey !== periodKey && <ErrorView message={loadError} onRetry={() => void load(true)} />}
      {loading && loadedPeriodKey !== periodKey && <LoadingView label="Carregando dados financeiros..." />}

      {summary && loadedPeriodKey === periodKey && (
        <>
          {(loadError || reloadError || receiptActionError) && (
            <p role="alert" className="rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">
              {receiptActionError ?? reloadError ?? loadError}
            </p>
          )}

          {!reportOnly && <section aria-label="Indicadores financeiros" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <KpiCard icon={CircleDollarSign} label="Receita" value={brl.format(summary.client_revenue)} detail="Mensagens entregues × preço unitário" color="var(--color-brand)" />
            <KpiCard icon={Banknote} label="Custo total da operação" value={brl.format(summary.supplier_cost)} detail="Fornecedor + Infobip" color="var(--color-warn)" />
            <KpiCard icon={TrendingUp} label="Lucro bruto" value={brl.format(summary.gross_profit)} detail="Receita menos custo total" color={summary.gross_profit < 0 ? 'var(--color-bad)' : 'var(--color-good)'} />
            <KpiCard icon={Percent} label="Margem bruta" value={summary.gross_margin_percent === null ? '—' : `${summary.gross_margin_percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} detail="Lucro dividido pela receita" color="var(--color-info)" />
            <KpiCard icon={MessageSquareText} label="Mensagens entregues" value={integer.format(summary.sent_quantity)} detail={`${integer.format(summary.contracted_quantity)} contratadas`} color="var(--color-info)" />
            <KpiCard icon={Landmark} label="Depósitos Infobip" value={brl.format(summary.infobip_deposits)} detail="Somente confirmados" color="var(--color-brand)" />
          </section>}

          {reportOnly && <SupplierSettlementCard
            summary={summary}
            onPrint={() => {
              setReceiptActionError(null);
              void printSupplierReport(summary, deposits, month).catch((caught) => {
                setReceiptActionError(caught instanceof Error ? caught.message : 'Não foi possível gerar o relatório.');
              });
            }}
          />}

          {!reportOnly && <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
            <Card title="Evolução diária: lucro × custo" className="min-w-0">
              {summary.tasks.length === 0 ? (
                <EmptyView title="Nenhuma demanda no período" description="As demandas com data agendada neste mês aparecerão aqui." />
              ) : (
                <div className="h-72" role="img" aria-label="Gráfico de linhas mostrando lucro e custo nos dias com disparos">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyProfitData} margin={{ top: 10, right: 8, left: 6, bottom: 0 }}>
                      <CartesianGrid stroke="var(--color-border-soft)" vertical={false} />
                      <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={24} tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(value: number) => compactBrl.format(value)} tick={{ fill: 'var(--color-text-faint)', fontSize: 10 }} axisLine={false} tickLine={false} width={72} />
                      <Tooltip labelFormatter={(label) => `Dia ${label}`} formatter={(value) => brl.format(Number(value))} contentStyle={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text)' }} />
                      <Line type="monotone" dataKey="profit" name="Lucro do dia" stroke="var(--color-good)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--color-good)', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="cost" name="Custo do dia" stroke="var(--color-bad)" strokeWidth={2} dot={{ r: 2.5, fill: 'var(--color-bad)', strokeWidth: 0 }} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Registrar depósito Infobip" action={<ReceiptText size={17} className="text-[var(--color-brand)]" />}>
              <form onSubmit={(event) => void handleCreateDeposit(event)}>
                <fieldset disabled={saving} className="flex min-w-0 flex-col gap-3 border-0 p-0">
                {receiptRetryDeposit && (
                  <div className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">
                    <p className="font-medium">O depósito já foi criado. Esta ação tentará somente anexar o comprovante.</p>
                    <button type="button" onClick={resetDepositForm} className="mt-1 underline underline-offset-2">
                      Continuar sem comprovante
                    </button>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="infobip-deposit-amount" className={labelClass}>Valor (R$)</label>
                    <input id="infobip-deposit-amount" type="number" min="0.01" max={MAX_NUMERIC_14_2} step="0.01" inputMode="decimal" required={!receiptRetryDeposit} disabled={Boolean(receiptRetryDeposit)} value={amount} onChange={(event) => { setAmount(event.target.value); setCreateError(null); }} aria-invalid={Boolean(createError)} aria-describedby={createError ? 'infobip-deposit-create-error' : undefined} className={inputClass} placeholder="0,00" />
                  </div>
                  <div>
                    <label htmlFor="infobip-deposit-date" className={labelClass}>Data do depósito</label>
                    <input id="infobip-deposit-date" type="date" min={period.start} max={period.end} required={!receiptRetryDeposit} disabled={Boolean(receiptRetryDeposit)} value={depositedAt} onChange={(event) => { setDepositedAt(event.target.value); setCreateError(null); }} aria-invalid={Boolean(createError)} aria-describedby={createError ? 'infobip-deposit-create-error' : undefined} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="infobip-deposit-status" className={labelClass}>Status</label>
                    <select id="infobip-deposit-status" disabled={Boolean(receiptRetryDeposit)} value={status} onChange={(event) => setStatus(event.target.value as InfobipDepositStatus)} className={inputClass}>
                      <option value="confirmed">Confirmado</option>
                      <option value="pending">Pendente</option>
                      <option value="cancelled">Cancelado</option>
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="infobip-deposit-reference" className={labelClass}>Referência</label>
                    <input id="infobip-deposit-reference" disabled={Boolean(receiptRetryDeposit)} maxLength={160} value={reference} onChange={(event) => setReference(event.target.value)} className={inputClass} placeholder="Ex: PIX 08/2026" />
                  </div>
                  <div>
                    <label htmlFor={receiptInputId} className={labelClass}>Comprovante (opcional)</label>
                    <input ref={receiptInputRef} id={receiptInputId} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => { setReceipt(event.target.files?.[0] ?? null); setUploadError(null); }} aria-invalid={Boolean(uploadError)} aria-describedby={uploadError ? 'infobip-deposit-upload-error' : undefined} className="block w-full cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-xs text-[var(--color-text-muted)] file:mr-3 file:border-0 file:bg-[var(--color-brand-soft)] file:px-3 file:py-2.5 file:text-xs file:font-medium file:text-[var(--color-brand)]" />
                  </div>
                </div>
                <div>
                  <label htmlFor="infobip-deposit-notes" className={labelClass}>Observação</label>
                  <textarea id="infobip-deposit-notes" disabled={Boolean(receiptRetryDeposit)} rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClass} placeholder="Detalhes para o acerto com o fornecedor" />
                </div>
                {createError && <p id="infobip-deposit-create-error" role="alert" aria-live="assertive" className="text-xs text-[var(--color-bad)]">{createError}</p>}
                {uploadError && <p id="infobip-deposit-upload-error" role="alert" aria-live="assertive" className="text-xs text-[var(--color-bad)]">{uploadError}</p>}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] text-[var(--color-text-faint)]">PDF, PNG, JPG ou WEBP · máximo de 16 MiB · acesso privado</p>
                  <button type="submit" className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                    {saving ? <Loader2 size={15} className="animate-spin" /> : receipt ? <Upload size={15} /> : <Plus size={15} />}
                    {saving ? 'Processando...' : receiptRetryDeposit ? 'Tentar anexar novamente' : 'Registrar depósito'}
                  </button>
                </div>
                </fieldset>
              </form>
            </Card>
          </section>}

          <Card title="Resultado por demanda" className="overflow-hidden p-0 [&>div:first-child]:px-5 [&>div:first-child]:pt-5">
            {summary.tasks.length === 0 ? (
              <div className="p-5"><EmptyView title="Sem resultados por demanda" description="Escolha outro mês ou preencha os dados financeiros das demandas." /></div>
            ) : (
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <caption className="sr-only">Resultado financeiro por demanda e cliente no período selecionado</caption>
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[11px] text-[var(--color-text-faint)]">
                      <th scope="col" className="pb-3 font-medium">Demanda / cliente</th><th scope="col" className="pb-3 font-medium">Data</th><th scope="col" className="pb-3 text-right font-medium">Entregues</th><th scope="col" className="pb-3 text-right font-medium">Preço/un.</th><th scope="col" className="pb-3 text-right font-medium">Receita</th><th scope="col" className="pb-3 text-right font-medium">Custo total</th><th scope="col" className="pb-3 text-right font-medium">Lucro</th><th scope="col" className="pb-3 text-right font-medium">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.tasks.map((task) => (
                      <tr key={task.id} className="border-b border-[var(--color-border-soft)] last:border-0 hover:bg-[var(--color-panel-2)]">
                        <td className="py-3 pr-4"><p className="font-medium text-[var(--color-text)]">{task.title}</p><p className="text-[11px] text-[var(--color-text-muted)]">{task.client_name ?? 'Cliente não informado'}</p></td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">{task.scheduled_date ? formatCivilDate(task.scheduled_date) : '—'}</td>
                        <td className="py-3 text-right text-[var(--color-text-muted)]">{integer.format(task.sent_quantity)}</td>
                        <td className="py-3 text-right text-[var(--color-text-muted)]">{brl.format(task.client_unit_price)}</td>
                        <td className="py-3 text-right text-[var(--color-text)]">{brl.format(task.client_revenue)}</td>
                        <td className="py-3 text-right text-[var(--color-warn)]">{brl.format(task.supplier_cost)}</td>
                        <td className={`py-3 text-right font-medium ${task.gross_profit < 0 ? 'text-[var(--color-bad)]' : 'text-[var(--color-good)]'}`}>{brl.format(task.gross_profit)}</td>
                        <td className="py-3 text-right text-[var(--color-text-muted)]">{task.gross_margin_percent === null ? '—' : `${task.gross_margin_percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Depósitos e comprovantes" action={<span className="text-xs text-[var(--color-text-muted)]">{deposits.length} lançamentos</span>} className="overflow-hidden p-0 [&>div:first-child]:px-5 [&>div:first-child]:pt-5">
            {deposits.length === 0 ? (
              <div className="p-5"><EmptyView title="Nenhum depósito neste mês" description="Registre o primeiro depósito para iniciar a conciliação com a Infobip." /></div>
            ) : (
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <caption className="sr-only">Depósitos Infobip e respectivos comprovantes no período selecionado</caption>
                  <thead><tr className="border-b border-[var(--color-border)] text-left text-[11px] text-[var(--color-text-faint)]"><th scope="col" className="pb-3 font-medium">Data</th><th scope="col" className="pb-3 font-medium">Referência</th><th scope="col" className="pb-3 font-medium">Status</th><th scope="col" className="pb-3 text-right font-medium">Valor</th><th scope="col" className="pb-3 font-medium">Observação</th><th scope="col" className="pb-3 text-right font-medium">Comprovante</th></tr></thead>
                  <tbody>
                    {deposits.map((deposit) => (
                      <tr key={deposit.id} className="border-b border-[var(--color-border-soft)] last:border-0 hover:bg-[var(--color-panel-2)]">
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1.5"><CalendarDays size={13} />{formatCivilDate(deposit.deposited_at)}</span></td>
                        <td className="max-w-48 truncate py-3 pr-4 text-[var(--color-text)]">{deposit.reference ?? '—'}</td>
                        <td className="py-3 pr-4"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasses[deposit.status]}`}>{statusLabels[deposit.status]}</span></td>
                        <td className="py-3 text-right font-medium text-[var(--color-text)]">{brl.format(deposit.amount)}</td>
                        <td className="max-w-64 truncate py-3 pl-4 text-xs text-[var(--color-text-muted)]" title={deposit.notes ?? undefined}>{deposit.notes ?? '—'}</td>
                        <td className="py-3 pl-4 text-right">
                          {deposit.receipt_path ? (
                            <div className="flex justify-end gap-1.5">
                              <button type="button" onClick={() => void openReceipt(deposit, false)} disabled={openingReceiptId !== null} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-brand)] disabled:opacity-50" aria-label={`Abrir comprovante de ${deposit.reference ?? formatCivilDate(deposit.deposited_at)}`}>
                                {openingReceiptId === deposit.id ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />} Abrir
                              </button>
                              <button type="button" onClick={() => void openReceipt(deposit, true)} disabled={openingReceiptId !== null} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-brand)] disabled:opacity-50" aria-label={`Baixar comprovante de ${deposit.reference ?? formatCivilDate(deposit.deposited_at)}`}>
                                <ArrowDownToLine size={13} /> Baixar
                              </button>
                              <button type="button" onClick={() => chooseReplacement(deposit)} disabled={replacingReceiptId !== null} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-brand)] disabled:opacity-50" aria-label={`Trocar comprovante de ${deposit.reference ?? formatCivilDate(deposit.deposited_at)}`}>
                                {replacingReceiptId === deposit.id ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Trocar
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => chooseReplacement(deposit)} disabled={replacingReceiptId !== null} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-brand)] disabled:opacity-50" aria-label={`Anexar comprovante de ${deposit.reference ?? formatCivilDate(deposit.deposited_at)}`}>
                              {replacingReceiptId === deposit.id ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} />} Anexar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
