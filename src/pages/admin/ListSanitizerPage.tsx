import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  Download,
  FileSpreadsheet,
  ShieldCheck,
  Shuffle,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { Card } from "../../components/ui/Card";
import { EmptyView } from "../../components/ui/StateView";
import {
  decodeCsvText,
  guessColumn,
  parseCsv,
  parseSpreadsheet,
  parseXml,
  type ParsedCsv,
} from "../../lib/csv";
import {
  contactsToCsv,
  sanitizeContactRows,
  type ContactColumnMapping,
} from "../../lib/listSanitizer";

const initialMapping: ContactColumnMapping = {
  firstName: -1,
  lastName: -1,
  phone: -1,
  tag: -1,
};

function guessedMapping(headers: string[]): ContactColumnMapping {
  return {
    firstName: guessColumn(headers, ["nome", "name", "contato"]),
    lastName: guessColumn(headers, [
      "sobrenome",
      "last name",
      "lastname",
      "apelido",
    ]),
    phone: guessColumn(headers, [
      "telefone",
      "phone",
      "celular",
      "whatsapp",
      "fone",
    ]),
    tag: guessColumn(headers, ["tag", "etiqueta", "segmento", "lista"]),
  };
}

export function ListSanitizerPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readVersionRef = useRef(0);
  const [sourceText, setSourceText] = useState("");
  const [sourceFormat, setSourceFormat] = useState<"csv" | "xml">("csv");
  const [uploadedParsed, setUploadedParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ContactColumnMapping>(initialMapping);
  const [fallbackTag, setFallbackTag] = useState("");
  const [splitIntoBatches, setSplitIntoBatches] = useState(false);
  const [batchSize, setBatchSize] = useState("500");
  const [shuffleBeforeSplit, setShuffleBeforeSplit] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(
    () =>
      uploadedParsed ??
      (sourceFormat === "xml" ? parseXml(sourceText) : parseCsv(sourceText)),
    [sourceFormat, sourceText, uploadedParsed],
  );

  useEffect(() => {
    setMapping(guessedMapping(parsed.headers));
  }, [parsed.headers]);

  const result = useMemo(
    () => sanitizeContactRows(parsed.rows, mapping, fallbackTag),
    [fallbackTag, mapping, parsed.rows],
  );
  const parsedBatchSize = Math.floor(Number(batchSize));
  const validBatchSize =
    Number.isFinite(parsedBatchSize) && parsedBatchSize >= 1
      ? parsedBatchSize
      : 0;
  const batchCount =
    splitIntoBatches && validBatchSize > 0
      ? Math.ceil(result.contacts.length / validBatchSize)
      : 0;

  async function readFile(file: File) {
    if (!/\.(csv|txt|xml|xlsx|xlsm|xls)$/i.test(file.name)) {
      setError("Envie um arquivo CSV, TXT, XML ou Excel.");
      return;
    }
    const readVersion = readVersionRef.current + 1;
    readVersionRef.current = readVersion;
    setIsReading(true);
    setSourceText("");
    setUploadedParsed(null);
    setSourceFormat(/\.xml$/i.test(file.name) ? "xml" : "csv");
    setMapping(initialMapping);
    setFileName(file.name);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      if (readVersion !== readVersionRef.current) return;
      if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
        const spreadsheet = await parseSpreadsheet(buffer);
        if (readVersion !== readVersionRef.current) return;
        setUploadedParsed(spreadsheet);
      } else {
        setSourceText(decodeCsvText(buffer));
      }
    } catch {
      if (readVersion === readVersionRef.current) {
        setError("Não foi possível ler o arquivo.");
      }
    } finally {
      if (readVersion === readVersionRef.current) setIsReading(false);
    }
  }

  function fileBaseName() {
    const today = new Date();
    const dateSuffix = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getFullYear()).slice(-2)}`;
    const tagName =
      (fallbackTag.trim() || result.contacts[0]?.tag || "lista")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .toLocaleLowerCase("pt-BR") || "lista";
    return `${tagName}${dateSuffix}`;
  }

  function downloadContacts(contacts: typeof result.contacts, name: string) {
    const blob = new Blob([contactsToCsv(contacts)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function downloadCsv() {
    if (result.contacts.length === 0) return;
    downloadContacts(result.contacts, fileBaseName());
  }

  async function downloadBatches() {
    if (result.contacts.length === 0 || validBatchSize < 1) return;
    const contacts = [...result.contacts];
    if (shuffleBeforeSplit) {
      for (let index = contacts.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [contacts[index], contacts[target]] = [
          contacts[target],
          contacts[index],
        ];
      }
    }
    const total = Math.ceil(contacts.length / validBatchSize);
    const baseName = fileBaseName();
    for (let index = 0; index < total; index += 1) {
      downloadContacts(
        contacts.slice(index * validBatchSize, (index + 1) * validBatchSize),
        `${baseName}_lote_${String(index + 1).padStart(2, "0")}_de_${String(total).padStart(2, "0")}`,
      );
      if (index < total - 1)
        await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }

  async function copyPhones() {
    if (result.contacts.length === 0) return;
    await navigator.clipboard.writeText(
      result.contacts.map((contact) => contact.phone).join("\n"),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }

  const mappingFields: Array<{
    key: keyof ContactColumnMapping;
    label: string;
    required?: boolean;
  }> = [
    { key: "firstName", label: "Nome ou nome completo" },
    { key: "lastName", label: "Sobrenome" },
    { key: "phone", label: "Telefone", required: true },
    { key: "tag", label: "Tag" },
  ];

  return (
    <main className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <WandSparkles size={20} className="text-[var(--color-brand)]" />
            <h1 className="text-xl font-semibold text-[var(--color-text)]">
              Higienizador de lista
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Separa nome e sobrenome, padroniza o telefone como 55 + DDD +
            número, remove duplicados e entrega um CSV pronto para disparo.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-good)]/25 bg-[var(--color-good-soft)] px-3 py-2 text-xs text-[var(--color-good)]">
          <ShieldCheck size={15} /> Processamento local: a lista não é enviada
          ao banco
        </div>
      </header>

      <Card title="1. Envie ou cole a lista">
        <div className="grid gap-4 lg:grid-cols-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void readFile(file);
            }}
            className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]" : "border-[var(--color-border)] hover:border-[var(--color-brand)]"}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xml,.xlsx,.xlsm,.xls,text/csv,text/plain,application/xml,text/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.ms-excel"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.currentTarget.value = "";
              }}
            />
            <UploadCloud size={26} className="text-[var(--color-brand)]" />
            <span className="text-sm font-medium text-[var(--color-text)]">
              Selecionar CSV, TXT, XML ou Excel
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">
              ou arraste o arquivo aqui · sem limite artificial de tamanho
            </span>
            {fileName && (
              <span className="mt-1 rounded-full bg-[var(--color-panel-2)] px-3 py-1 text-xs text-[var(--color-text)]">
                {fileName}
              </span>
            )}
          </button>

          <label className="flex min-h-40 flex-col gap-2 text-xs font-medium text-[var(--color-text-muted)]">
            Ou cole os dados com cabeçalho
            <textarea
              value={sourceText}
              onChange={(event) => {
                readVersionRef.current += 1;
                setIsReading(false);
                setUploadedParsed(null);
                setSourceFormat(
                  event.target.value.trimStart().startsWith("<")
                    ? "xml"
                    : "csv",
                );
                setSourceText(event.target.value);
                setFileName(null);
                setError(null);
              }}
              className="min-h-36 flex-1 resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3 font-mono text-xs text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
              placeholder={
                "nome;sobrenome;telefone;tag\nMaria;Silva;(11) 99999-9999;CLIENTES"
              }
            />
          </label>
        </div>
        {isReading && (
          <p className="mt-3 text-xs text-[var(--color-brand)]">
            Lendo e atualizando a nova lista…
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-[var(--color-bad)]">
            {error}
          </p>
        )}
      </Card>

      {parsed.headers.length > 0 && (
        <Card title="2. Confirme as colunas">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {mappingFields.map((field) => (
              <label
                key={field.key}
                className="flex flex-col gap-1.5 text-xs font-medium text-[var(--color-text-muted)]"
              >
                {field.label}
                {field.required ? " *" : ""}
                <select
                  value={mapping[field.key]}
                  onChange={(event) =>
                    setMapping((current) => ({
                      ...current,
                      [field.key]: Number(event.target.value),
                    }))
                  }
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                >
                  <option value={-1}>
                    {field.key === "lastName"
                      ? "Separar do nome completo"
                      : field.key === "tag"
                        ? "Usar tag padrão"
                        : "Não encontrada"}
                  </option>
                  {parsed.headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header || `Coluna ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
              Tag padrão
              <input
                value={fallbackTag}
                onChange={(event) => setFallbackTag(event.target.value)}
                placeholder="Ex: CLIENTES_AGOSTO"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
              />
            </label>
          </div>
          {mapping.phone < 0 && (
            <p role="alert" className="mt-3 text-xs text-[var(--color-bad)]">
              Selecione a coluna que contém os telefones.
            </p>
          )}
        </Card>
      )}

      {parsed.rows.length > 0 && mapping.phone >= 0 && (
        <>
          <section
            aria-label="Resumo da higienização"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Summary
              label="Linhas recebidas"
              value={parsed.rows.length}
              color="var(--color-info)"
            />
            <Summary
              label="Contatos válidos"
              value={result.contacts.length}
              color="var(--color-good)"
            />
            <Summary
              label="Telefones inválidos"
              value={result.invalidPhones}
              color="var(--color-bad)"
            />
            <Summary
              label="Duplicados removidos"
              value={result.duplicates}
              color="var(--color-warn)"
            />
          </section>

          <Card title="3. Criar lotes (opcional)">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={splitIntoBatches}
                    onChange={(event) =>
                      setSplitIntoBatches(event.target.checked)
                    }
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  Dividir a lista em lotes
                </label>
                {splitIntoBatches && (
                  <>
                    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-muted)]">
                      Contatos por lote
                      <input
                        type="number"
                        min="1"
                        max="100000"
                        inputMode="numeric"
                        value={batchSize}
                        onChange={(event) => setBatchSize(event.target.value)}
                        className="w-36 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/50"
                      />
                    </label>
                    <label className="flex items-center gap-2 pb-2 text-xs text-[var(--color-text-muted)]">
                      <input
                        type="checkbox"
                        checked={shuffleBeforeSplit}
                        onChange={(event) =>
                          setShuffleBeforeSplit(event.target.checked)
                        }
                        className="size-4 accent-[var(--color-brand)]"
                      />
                      <Shuffle size={14} /> Embaralhar antes de dividir
                    </label>
                  </>
                )}
              </div>
              {splitIntoBatches && (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {batchCount > 0
                      ? `${result.contacts.length.toLocaleString("pt-BR")} contatos gerarão ${batchCount} arquivo(s).`
                      : "Informe uma quantidade válida por lote."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void downloadBatches()}
                    disabled={batchCount === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    <Download size={14} /> Baixar {batchCount} lote(s)
                  </button>
                </div>
              )}
            </div>
          </Card>

          <Card
            title="4. Lista pronta"
            action={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyPhones()}
                  disabled={result.contacts.length === 0}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text)] hover:bg-[var(--color-panel-2)] disabled:opacity-40"
                >
                  {copied ? (
                    <Check size={14} className="text-[var(--color-good)]" />
                  ) : (
                    <Clipboard size={14} />
                  )}{" "}
                  {copied ? "Copiados" : "Copiar telefones"}
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  disabled={result.contacts.length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  <Download size={14} /> Baixar CSV higienizado
                </button>
              </div>
            }
            className="overflow-hidden p-0 [&>div:first-child]:px-5 [&>div:first-child]:pt-5"
          >
            {result.contacts.length === 0 ? (
              <div className="p-5">
                <EmptyView
                  title="Nenhum telefone válido"
                  description="Confira a coluna de telefone e o conteúdo da lista."
                />
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto px-5 pb-5">
                <table className="w-full min-w-[700px] border-collapse text-sm">
                  <caption className="sr-only">
                    Prévia da lista higienizada
                  </caption>
                  <thead className="sticky top-0 bg-[var(--color-panel)]">
                    <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                      <th scope="col" className="py-3">
                        Nome
                      </th>
                      <th scope="col" className="py-3">
                        Sobrenome
                      </th>
                      <th scope="col" className="py-3">
                        Telefone
                      </th>
                      <th scope="col" className="py-3">
                        Tag
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.contacts.slice(0, 500).map((contact) => (
                      <tr
                        key={`${contact.phone}-${contact.sourceRow}`}
                        className="border-b border-[var(--color-border-soft)]"
                      >
                        <td className="py-2.5 text-[var(--color-text)]">
                          {contact.firstName || "—"}
                        </td>
                        <td className="py-2.5 text-[var(--color-text-muted)]">
                          {contact.lastName || "—"}
                        </td>
                        <td className="py-2.5 font-mono text-[var(--color-good)]">
                          {contact.phone}
                        </td>
                        <td className="py-2.5 text-[var(--color-text-muted)]">
                          {contact.tag || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.contacts.length > 500 && (
                  <p className="py-3 text-center text-xs text-[var(--color-text-faint)]">
                    Prévia limitada a 500 linhas. O arquivo baixado contém todos
                    os contatos válidos.
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {parsed.headers.length === 0 && (
        <Card>
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-muted)]">
            <FileSpreadsheet size={20} /> Envie uma lista para começar.
          </div>
        </Card>
      )}
    </main>
  );
}

function Summary({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--color-text)]">
        {value.toLocaleString("pt-BR")}
      </p>
    </div>
  );
}
