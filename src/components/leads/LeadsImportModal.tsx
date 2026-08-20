import { useRef, useState } from 'react';
import { X, UploadCloud, FileText, CheckCircle2 } from 'lucide-react';
import { parseCsv, guessMapping, type ParsedCsv } from '../../lib/csv';
import type { Lead } from '../../types';
import { useFilters } from '../../state/FiltersContext';

function normalizeHeaderlessCsv(csv: ParsedCsv): ParsedCsv {
  if (csv.headers.length === 0) return csv;

  const normalizedHeaders = csv.headers.map((header) => header.toLowerCase());
  const hasKnownHeader = normalizedHeaders.some((header) =>
    ['nome', 'name', 'email', 'e-mail', 'telefone', 'phone', 'celular', 'whatsapp'].some((key) =>
      header.includes(key)
    )
  );

  if (hasKnownHeader) return csv;

  const firstRow = csv.headers;
  const phoneColumn = firstRow.findIndex((value) => value.replace(/\D/g, '').length >= 8);
  const emailColumn = firstRow.findIndex((value) => value.includes('@'));
  const headers = firstRow.map((_, index) => {
    if (index === emailColumn) return 'Email';
    if (index === phoneColumn) return 'Telefone';
    if (index === 0) return 'Nome';
    return `Coluna ${index + 1}`;
  });

  return { headers, rows: [firstRow, ...csv.rows] };
}

export function LeadsImportModal({ onClose }: { onClose: () => void }) {
  const { selectedProject, addImportedLeads } = useFilters();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState({ name: -1, email: -1, phone: -1 });
  const [dragOver, setDragOver] = useState(false);
  const [imported, setImported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const csv = normalizeHeaderlessCsv(parseCsv(text));
      setParsed(csv);
      setMapping(guessMapping(csv.headers));
    };
    reader.readAsText(file);
  }

  function handleImport() {
    if (!parsed || !selectedProject) return;
    const newLeads: Lead[] = parsed.rows.map((row, idx) => ({
      id: `imported-${Date.now()}-${idx}`,
      projectId: selectedProject.id,
      campaignId: '',
      adSetId: '',
      adId: '',
      name: mapping.name >= 0 ? row[mapping.name] ?? '—' : '—',
      email: mapping.email >= 0 ? row[mapping.email] ?? '—' : '—',
      phone: mapping.phone >= 0 ? row[mapping.phone] ?? '—' : '—',
      createdAt: new Date().toISOString(),
      status: 'Novo',
      utm: { source: 'manual', medium: 'import', campaign: 'importacao-manual', content: '', term: '' },
      assignedTo: '',
    }));
    addImportedLeads(newLeads);
    setImported(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Importar Leads</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Envie uma planilha CSV com os leads captados para o projeto {selectedProject?.name}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {imported ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 size={32} className="text-[var(--color-good)]" />
              <p className="text-sm font-medium text-[var(--color-text)]">
                {parsed?.rows.length} leads importados
              </p>
              <p className="text-xs text-[var(--color-text-faint)]">
                Eles já aparecem na aba Leads, marcados como "Importação manual".
              </p>
            </div>
          ) : (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                onClick={() => inputRef.current?.click()}
                className={
                  'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ' +
                  (dragOver
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-brand)]')
                }
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
                <UploadCloud size={24} className="text-[var(--color-text-muted)]" />
                <p className="text-sm text-[var(--color-text)]">
                  Arraste um arquivo .csv aqui ou clique para selecionar
                </p>
                <p className="text-[11px] text-[var(--color-text-faint)]">
                  Colunas esperadas: nome, email, telefone
                </p>
              </div>

              {fileName && parsed && (
                <div className="mt-4 rounded-xl border border-[var(--color-border)] p-4">
                  <p className="mb-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    <FileText size={14} /> {fileName} · {parsed.rows.length} linhas detectadas
                  </p>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {(['name', 'email', 'phone'] as const).map((field) => (
                      <label key={field} className="flex flex-col gap-1 text-[var(--color-text-muted)]">
                        {field === 'name' ? 'Nome' : field === 'email' ? 'Email' : 'Telefone'}
                        <select
                          value={mapping[field]}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [field]: Number(e.target.value) }))
                          }
                          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-[var(--color-text)]"
                        >
                          <option value={-1}>—</option>
                          {parsed.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>

                  {parsed.rows.length > 0 && (
                    <div className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-[var(--color-panel-2)] p-2 text-[11px] text-[var(--color-text-muted)]">
                      {parsed.rows.slice(0, 3).map((row, i) => (
                        <p key={i} className="truncate">
                          {mapping.name >= 0 ? row[mapping.name] : '—'} ·{' '}
                          {mapping.email >= 0 ? row[mapping.email] : '—'} ·{' '}
                          {mapping.phone >= 0 ? row[mapping.phone] : '—'}
                        </p>
                      ))}
                      {parsed.rows.length > 3 && <p>+ {parsed.rows.length - 3} outros...</p>}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {imported ? 'Fechar' : 'Cancelar'}
          </button>
          {!imported && (
            <button
              onClick={handleImport}
              disabled={!parsed || parsed.rows.length === 0}
              className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Importar {parsed ? `(${parsed.rows.length})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
