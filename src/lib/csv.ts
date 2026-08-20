export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Planilhas exportadas pelo Excel no Windows frequentemente usam ANSI/Windows-1252.
 * Quando a leitura UTF-8 encontra bytes inválidos (�), tenta automaticamente essa
 * codificação para preservar acentos em nomes, tags e cabeçalhos.
 */
export function decodeCsvText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("\uFFFD")
    ? new TextDecoder("windows-1252").decode(buffer)
    : utf8;
}

function xmlName(element: Element) {
  return (element.localName || element.tagName).toLowerCase();
}

/** Lê XML simples de contatos e XML exportado por planilhas (Row/Cell). */
export function parseXml(text: string): ParsedCsv {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) return { headers: [], rows: [] };

  const spreadsheetRows = Array.from(document.querySelectorAll("Row, row"))
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => xmlName(cell) === "cell")
        .map((cell) => (cell.textContent ?? "").trim()),
    )
    .filter((row) => row.length > 0);
  if (spreadsheetRows.length > 0) {
    return {
      headers: spreadsheetRows[0],
      rows: spreadsheetRows.slice(1),
    };
  }

  const candidates = new Map<string, Element[]>();
  for (const element of Array.from(document.querySelectorAll("*"))) {
    const children = Array.from(element.children);
    if (!children.length || children.some((child) => child.children.length > 0))
      continue;
    const key = xmlName(element);
    candidates.set(key, [...(candidates.get(key) ?? []), element]);
  }
  const records = Array.from(candidates.values())
    .filter((items) => items.length > 0)
    .sort((a, b) => b.length - a.length)[0];
  if (!records?.length) return { headers: [], rows: [] };

  const headers = Array.from(
    new Set(
      records.flatMap((record) =>
        Array.from(record.children).map(
          (child) => child.localName || child.tagName,
        ),
      ),
    ),
  );
  const rows = records.map((record) => {
    const values = new Map(
      Array.from(record.children).map((child) => [
        child.localName || child.tagName,
        (child.textContent ?? "").trim(),
      ]),
    );
    return headers.map((header) => values.get(header) ?? "");
  });
  return { headers, rows };
}

/** Lê a primeira aba de arquivos Excel (.xlsx, .xlsm e .xls) no navegador. */
export async function parseSpreadsheet(
  buffer: ArrayBuffer,
): Promise<ParsedCsv> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(buffer, { type: "array", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const nonEmptyRows = matrix
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  if (!nonEmptyRows.length) return { headers: [], rows: [] };
  return { headers: nonEmptyRows[0], rows: nonEmptyRows.slice(1) };
}

export function parseCsv(text: string): ParsedCsv {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const parsedRows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) parsedRows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) parsedRows.push(row);
  if (parsedRows.length === 0) return { headers: [], rows: [] };

  const headers = parsedRows[0];
  const rows = parsedRows.slice(1);
  return { headers, rows };
}

const NAME_KEYS = ["nome", "name"];
const EMAIL_KEYS = ["email", "e-mail"];
const PHONE_KEYS = ["telefone", "phone", "celular", "whatsapp"];

export function guessColumn(headers: string[], keys: string[]): number {
  return headers.findIndex((h) =>
    keys.some((k) => h.toLowerCase().includes(k)),
  );
}

export function guessMapping(headers: string[]) {
  return {
    name: guessColumn(headers, NAME_KEYS),
    email: guessColumn(headers, EMAIL_KEYS),
    phone: guessColumn(headers, PHONE_KEYS),
  };
}
