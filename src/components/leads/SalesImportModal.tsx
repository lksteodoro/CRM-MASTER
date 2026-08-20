import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, UploadCloud, X } from 'lucide-react';
import { parseCsv, type ParsedCsv } from '../../lib/csv';
import { importSalesCsv, listProjectCustomFields, type SalesCsvCustomColumn, type SalesCsvMapping } from '../../services/crmLeads.service';
import { useProject } from '../../state/ProjectContext';

type SystemKey = keyof SalesCsvMapping;
type Target = 'ignore' | `system:${SystemKey}` | 'custom' | `existing:${string}`;
const systemFields: Array<{ key: SystemKey; label: string; required?: boolean; hints: string[] }> = [
  { key: 'date', label: 'Data da venda', required: true, hints: ['data da venda', 'data', 'date'] },
  { key: 'name', label: 'Contato / nome', required: true, hints: ['nome', 'name', 'contato'] },
  { key: 'email', label: 'E-mail', hints: ['email', 'e-mail'] },
  { key: 'phone', label: 'WhatsApp / telefone', hints: ['whatsapp', 'telefone', 'phone', 'celular'] },
  { key: 'payment', label: 'Valor / forma de pagamento', hints: ['forma de pagamento', 'pagamento', 'valor', 'payment', 'preco'] },
  { key: 'type', label: 'Status / tipo', hints: ['tipo', 'status', 'situacao'] },
  { key: 'seller', label: 'Vendedor', hints: ['vendedor', 'seller', 'closer'] },
  { key: 'onboarding', label: 'Onboarding', hints: ['onboarding'] },
  { key: 'bonus', label: 'Bônus', hints: ['bonus'] },
  { key: 'observation', label: 'Observação', hints: ['observacao', 'obs'] },
];
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function guessTargets(headers: string[]): Record<number, Target> {
  return Object.fromEntries(headers.map((header, index) => {
    const field = systemFields.find((item) => item.hints.some((hint) => normalize(header).includes(normalize(hint))));
    return [index, field ? `system:${field.key}` : 'ignore'];
  })) as Record<number, Target>;
}

export function SalesImportModal({ onClose, onImported }: { onClose: () => void; onImported: (range: { start: string; end: string }) => void }) {
  const { project } = useProject();
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [targets, setTargets] = useState<Record<number, Target>>({});
  const [customLabels, setCustomLabels] = useState<Record<number, string>>({});
  const [existingFields, setExistingFields] = useState<string[]>([]);
  const [step, setStep] = useState<'file' | 'mapping' | 'done'>('file');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => { void listProjectCustomFields(project.id, 'sale').then((rows) => setExistingFields(rows.map((row) => row.label))).catch(() => setExistingFields([])); }, [project.id]);
  const missingRequired = useMemo(() => systemFields.filter((field) => field.required && !Object.values(targets).includes(`system:${field.key}`)), [targets]);
  const invalidCustom = useMemo(() => Object.entries(targets).some(([index, target]) => target === 'custom' && !customLabels[Number(index)]?.trim()), [targets, customLabels]);
  const importedColumns = Object.values(targets).filter((target) => target !== 'ignore').length;

  async function selectFile(file: File | undefined) {
    if (!file) return;
    const csv = parseCsv(await file.text());
    if (csv.headers.length === 0 || csv.rows.length === 0) { setMessage('O arquivo não possui colunas ou registros válidos.'); return; }
    setFileName(file.name); setParsed(csv); setTargets(guessTargets(csv.headers)); setCustomLabels({}); setMessage(''); setStep('mapping');
  }
  function setTarget(index: number, target: Target) {
    setTargets((current) => ({ ...current, [index]: target }));
    if (target === 'custom') setCustomLabels((current) => ({ ...current, [index]: current[index] || parsed?.headers[index] || '' }));
  }
  async function submit() {
    if (!parsed || missingRequired.length > 0 || invalidCustom) return;
    const mapping: SalesCsvMapping = {};
    const customColumns: SalesCsvCustomColumn[] = [];
    Object.entries(targets).forEach(([rawIndex, target]) => {
      const index = Number(rawIndex);
      if (target.startsWith('system:')) mapping[target.slice(7) as SystemKey] = index;
      if (target === 'custom') customColumns.push({ index, label: customLabels[index].trim() });
      if (target.startsWith('existing:')) customColumns.push({ index, label: target.slice(9) });
    });
    const normalizedCsv = [parsed.headers, ...parsed.rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    setBusy(true); setMessage('Importando todas as linhas de venda...');
    try {
      const result = await importSalesCsv(project.id, normalizedCsv, mapping, customColumns);
      setMessage(`${result.inserted_count} venda(s) processada(s), ${result.skipped_count} ignorada(s) e ${result.invalid_count} inválida(s).`);
      setStep('done'); onImported({ start: result.start, end: result.end });
    } catch (error) {
      const detail = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
      setMessage(detail || 'Não foi possível importar o CSV.');
    } finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
    <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4"><div><h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]"><FileSpreadsheet size={18} className="text-[var(--color-brand)]" /> Configurar importação de vendas</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">Cada coluna pode ser ignorada, ligada ao sistema ou criada como campo novo em {project.name}.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"><X size={18} /></button></header>
    <div className="flex-1 overflow-y-auto p-6"><div className="mb-5 flex items-center gap-2 text-[11px] font-medium text-[var(--color-text-muted)]"><span className="rounded-full bg-[var(--color-brand-soft)] px-3 py-1 text-[var(--color-brand)]">1. Arquivo</span><span>→</span><span className={`rounded-full px-3 py-1 ${step !== 'file' ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand)]' : 'bg-[var(--color-panel-2)]'}`}>2. Colunas</span><span>→</span><span className={`rounded-full px-3 py-1 ${step === 'done' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-[var(--color-panel-2)]'}`}>3. Resultado</span></div>
      {step === 'file' && <label onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); void selectFile(event.dataTransfer.files?.[0]); }} className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-14 text-center transition ${dragOver ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-brand)]'}`}><UploadCloud size={30} className="text-[var(--color-brand)]" /><span className="text-sm text-[var(--color-text)]">Arraste a planilha CSV de vendas para cá</span><span className="text-xs text-[var(--color-text-faint)]">ou clique para selecionar no computador</span><input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>}
      {step !== 'file' && parsed && <><div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-4"><div><p className="text-sm font-medium text-[var(--color-text)]">{fileName}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{parsed.rows.length} linhas · {parsed.headers.length} colunas · {importedColumns} selecionadas</p></div>{step === 'mapping' && <button type="button" onClick={() => setStep('file')} className="text-xs text-[var(--color-brand)]">Trocar arquivo</button>}</div>
        {step === 'mapping' && <div className="overflow-hidden rounded-xl border border-[var(--color-border)]"><div className="grid grid-cols-[1fr_1fr_1.25fr] border-b border-[var(--color-border)] bg-[var(--color-panel-2)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]"><div className="px-4 py-3">Coluna do CSV</div><div className="px-4 py-3">Exemplo</div><div className="border-l border-[var(--color-border)] px-4 py-3 text-[var(--color-brand)]">Importar como</div></div>{parsed.headers.map((header, index) => { const target = targets[index] ?? 'ignore'; return <div key={`${header}-${index}`} className="grid grid-cols-[1fr_1fr_1.25fr] items-center border-b border-[var(--color-border-soft)] last:border-b-0"><div className="truncate px-4 py-3 text-xs font-medium text-[var(--color-text)]">{header || `Coluna ${index + 1}`}</div><div className="truncate px-4 py-3 text-[11px] text-[var(--color-text-muted)]">{parsed.rows[0]?.[index] || '—'}</div><div className="border-l border-[var(--color-border-soft)] px-4 py-2"><select value={target} onChange={(event) => setTarget(index, event.target.value as Target)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text)]"><option value="ignore">Ignorar esta coluna</option><optgroup label="Campos do sistema">{systemFields.map((field) => <option key={field.key} value={`system:${field.key}`}>{field.label}{field.required ? ' *' : ''}</option>)}</optgroup>{existingFields.length > 0 && <optgroup label="Campos criados neste projeto">{existingFields.map((label) => <option key={label} value={`existing:${label}`}>{label}</option>)}</optgroup>}<option value="custom">+ Criar novo campo</option></select>{target === 'custom' && <input value={customLabels[index] ?? ''} onChange={(event) => setCustomLabels((current) => ({ ...current, [index]: event.target.value }))} placeholder="Nome do novo campo" className="mt-2 w-full rounded-lg border border-[var(--color-brand)]/40 bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text)] outline-none" />}</div></div>})}</div>}
        {step === 'done' && <div className="flex flex-col items-center gap-3 py-12 text-center"><CheckCircle2 size={38} className="text-emerald-400" /><p className="font-medium text-[var(--color-text)]">Importação concluída</p><p className="text-xs text-[var(--color-text-muted)]">As vendas foram gravadas sem criar registros em Leads.</p></div>}
      </>}
      {missingRequired.length > 0 && step === 'mapping' && <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">Mapeie: {missingRequired.map((field) => field.label).join(', ')}.</p>}
      {message && <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">{message}</p>}
    </div>
    <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]">{step === 'done' ? 'Fechar' : 'Cancelar'}</button>{step === 'mapping' && <button type="button" onClick={() => void submit()} disabled={busy || missingRequired.length > 0 || invalidCustom} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Importando todas as linhas...' : `Importar ${parsed?.rows.length ?? 0} vendas`}</button>}</footer>
  </div></div>;
}
