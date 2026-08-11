export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitLine = (line: string) => line.split(/[,;]/).map((cell) => cell.trim().replace(/^"|"$/g, ''));

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

const NAME_KEYS = ['nome', 'name'];
const EMAIL_KEYS = ['email', 'e-mail'];
const PHONE_KEYS = ['telefone', 'phone', 'celular', 'whatsapp'];

export function guessColumn(headers: string[], keys: string[]): number {
  return headers.findIndex((h) => keys.some((k) => h.toLowerCase().includes(k)));
}

export function guessMapping(headers: string[]) {
  return {
    name: guessColumn(headers, NAME_KEYS),
    email: guessColumn(headers, EMAIL_KEYS),
    phone: guessColumn(headers, PHONE_KEYS),
  };
}
