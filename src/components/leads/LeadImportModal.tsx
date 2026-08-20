import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, UploadCloud, X } from 'lucide-react';
import { parseCsv, type ParsedCsv } from '../../lib/csv';
import { importLeadsCsv, listProjectCustomFields, type LeadsCsvCustomColumn, type LeadsCsvMapping } from '../../services/crmLeads.service';
import { useProject } from '../../state/ProjectContext';

type SystemKey = keyof LeadsCsvMapping;
type Target = 'ignore' | `system:${SystemKey}` | 'custom' | `existing:${string}`;
const fields: Array<{ key: SystemKey; label: string; required?: boolean; hints: string[] }> = [
  { key: 'date', label: 'Data da entrada', required: true, hints: ['data', 'date'] },
  { key: 'time', label: 'Hora da entrada', hints: ['hora', 'time'] },
  { key: 'name', label: 'Nome', required: true, hints: ['nome', 'name'] },
  { key: 'phone', label: 'Telefone / WhatsApp', hints: ['telefone', 'whatsapp', 'phone'] },
  { key: 'email', label: 'E-mail', hints: ['email', 'e-mail'] },
  { key: 'source', label: 'UTM Source', hints: ['source', 'utm_source'] },
  { key: 'campaign', label: 'UTM Campaign', hints: ['campaing', 'campaign', 'utm_campaign'] },
  { key: 'medium', label: 'UTM Medium', hints: ['medium', 'utm_medium'] },
  { key: 'content', label: 'UTM Content', hints: ['content', 'utm_content'] },
  { key: 'term', label: 'UTM Term', hints: ['term', 'utm_term'] },
  { key: 'status', label: 'Formado / status', hints: ['formado', 'status'] },
];
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function guess(headers: string[]): Record<number, Target> { return Object.fromEntries(headers.map((header, index) => { const exact = fields.find((field) => field.hints.some((hint) => normalize(header) === normalize(hint))); return [index, exact ? `system:${exact.key}` : 'ignore']; })) as Record<number, Target>; }

export function LeadImportModal({ onClose, onImported }: { onClose: () => void; onImported: (range: { start: string; end: string }) => void }) {
  const { project } = useProject();
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState('');
  const [targets, setTargets] = useState<Record<number, Target>>({});
  const [customLabels, setCustomLabels] = useState<Record<number, string>>({});
  const [existingFields, setExistingFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0, inserted: 0, updated: 0, invalid: 0 });
  useEffect(() => { void listProjectCustomFields(project.id, 'lead').then((rows) => setExistingFields(rows.map((row) => row.label))).catch(() => setExistingFields([])); }, [project.id]);
  const missing = useMemo(() => fields.filter((field) => field.required && !Object.values(targets).includes(`system:${field.key}`)), [targets]);
  const invalidCustom = Object.entries(targets).some(([index, target]) => target === 'custom' && !customLabels[Number(index)]?.trim());

  async function choose(file: File | undefined) {
    if (!file) return;
    const csv = parseCsv(await file.text());
    if (!csv.rows.length) { setMessage('Arquivo sem registros válidos.'); return; }
    setFileName(file.name); setParsed(csv); setTargets(guess(csv.headers)); setMessage('');
  }
  function setTarget(index: number, target: Target) {
    setTargets((current) => ({ ...current, [index]: target }));
    if (target === 'custom') setCustomLabels((current) => ({ ...current, [index]: current[index] || parsed?.headers[index] || '' }));
  }
  async function submit() {
    if (!parsed || missing.length || invalidCustom) return;
    const mapping: LeadsCsvMapping = {}; const custom: LeadsCsvCustomColumn[] = [];
    Object.entries(targets).forEach(([rawIndex, target]) => { const index = Number(rawIndex); if (target.startsWith('system:')) mapping[target.slice(7) as SystemKey] = index; if (target === 'custom') custom.push({ index, label: customLabels[index].trim() }); if (target.startsWith('existing:')) custom.push({ index, label: target.slice(9) }); });
    const csv = [parsed.headers, ...parsed.rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    setBusy(true); setProgress({ processed: 0, total: parsed.rows.length, inserted: 0, updated: 0, invalid: 0 }); setMessage('Importando leads em lotes e unificando contatos...');
    try { const result = await importLeadsCsv(project.id, csv, mapping, custom, setProgress); setMessage(`${result.inserted_count} entrada(s) criada(s), ${result.updated_count} atualizada(s) e ${result.invalid_count} inválida(s).`); setDone(true); onImported({ start: result.start, end: result.end }); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível importar os leads.'); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
    <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4"><div><h2 className="text-base font-semibold text-[var(--color-text)]">Configurar importação de leads</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">Contatos repetidos serão unificados e cada linha permanecerá como uma entrada no histórico.</p></div><button onClick={onClose} disabled={busy} className="rounded-lg p-2 text-[var(--color-text-muted)] disabled:opacity-30"><X size={18} /></button></header>
    <div className="flex-1 overflow-y-auto p-6">{!parsed && <label onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); void choose(event.dataTransfer.files?.[0]); }} className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-14 text-center transition ${dragOver ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-brand)]'}`}><UploadCloud size={30} className="text-[var(--color-brand)]" /><span className="text-sm text-[var(--color-text)]">Arraste o CSV de leads para cá</span><span className="text-xs text-[var(--color-text-muted)]">ou clique para selecionar no computador</span><input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { void choose(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>}
      {parsed && <><div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-4"><p className="text-sm font-medium text-[var(--color-text)]">{fileName}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{parsed.rows.length} entradas encontradas</p></div>{!done && !busy && <div className="overflow-hidden rounded-xl border border-[var(--color-border)]"><div className="grid grid-cols-[1fr_1fr_1.25fr] bg-[var(--color-panel-2)] text-[11px] font-semibold uppercase text-[var(--color-text-faint)]"><div className="px-4 py-3">Coluna do CSV</div><div className="px-4 py-3">Exemplo</div><div className="border-l border-[var(--color-border)] px-4 py-3 text-[var(--color-brand)]">Importar como</div></div>{parsed.headers.map((header, index) => { const target = targets[index] ?? 'ignore'; return <div key={`${header}-${index}`} className="grid grid-cols-[1fr_1fr_1.25fr] items-center border-t border-[var(--color-border-soft)]"><div className="truncate px-4 py-3 text-xs font-medium text-[var(--color-text)]">{header}</div><div className="truncate px-4 py-3 text-[11px] text-[var(--color-text-muted)]">{parsed.rows[0]?.[index] || '—'}</div><div className="border-l border-[var(--color-border-soft)] px-4 py-2"><select value={target} onChange={(event) => setTarget(index, event.target.value as Target)} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text)]"><option value="ignore">Ignorar</option><optgroup label="Campos de Lead">{fields.map((field) => <option key={field.key} value={`system:${field.key}`}>{field.label}{field.required ? ' *' : ''}</option>)}</optgroup>{existingFields.length > 0 && <optgroup label="Campos criados">{existingFields.map((label) => <option key={label} value={`existing:${label}`}>{label}</option>)}</optgroup>}<option value="custom">+ Criar novo campo</option></select>{target === 'custom' && <input value={customLabels[index] ?? ''} onChange={(event) => setCustomLabels((current) => ({ ...current, [index]: event.target.value }))} className="mt-2 w-full rounded-lg border border-[var(--color-brand)]/40 bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text)]" />}</div></div>})}</div>}{done && <div className="flex flex-col items-center gap-3 py-12"><CheckCircle2 size={38} className="text-emerald-400" /><p className="text-sm text-[var(--color-text)]">Importação concluída e histórico unificado.</p></div>}</>}
      {missing.length > 0 && parsed && !done && <p className="mt-4 text-xs text-amber-300">Mapeie: {missing.map((field) => field.label).join(', ')}.</p>}{busy && <div className="mt-4 rounded-xl border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] p-4"><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-medium text-[var(--color-text)]"><Loader2 size={16} className="animate-spin text-[var(--color-brand)]" /> Importação em andamento</span><span className="text-xs font-semibold text-[var(--color-brand)]">{progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-panel)]"><div className="h-full rounded-full bg-[var(--color-brand)] transition-all duration-300" style={{ width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%` }} /></div><div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--color-text-muted)] sm:grid-cols-4"><span>{progress.processed} de {progress.total} processados</span><span>{progress.inserted} novos</span><span>{progress.updated} atualizados</span><span>{progress.invalid} inválidos</span></div><p className="mt-2 text-[10px] text-[var(--color-text-faint)]">Pode demorar alguns minutos. Não feche esta janela até concluir.</p></div>}{message && <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-text-muted)]">{message}</p>}
    </div>
    <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4"><button onClick={onClose} disabled={busy} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)] disabled:opacity-30">{done ? 'Fechar' : 'Cancelar'}</button>{parsed && !done && <button onClick={() => void submit()} disabled={busy || missing.length > 0 || invalidCustom} className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Importando em lotes...' : `Importar ${parsed.rows.length} entradas`}</button>}</footer>
  </div></div>;
}
