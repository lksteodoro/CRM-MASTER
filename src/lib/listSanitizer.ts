export interface SanitizedContact {
  firstName: string;
  lastName: string;
  phone: string;
  tag: string;
  sourceRow: number;
}

export interface SanitizeResult {
  contacts: SanitizedContact[];
  invalidPhones: number;
  duplicates: number;
  emptyRows: number;
}

export interface ContactColumnMapping {
  firstName: number;
  lastName: number;
  phone: number;
  tag: number;
}

const LOWERCASE_PARTICLES = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCase(value: string) {
  return cleanText(value)
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((part, index) => {
      if (index > 0 && LOWERCASE_PARTICLES.has(part)) return part;
      return part ? `${part[0].toLocaleUpperCase('pt-BR')}${part.slice(1)}` : '';
    })
    .join(' ');
}

export function splitBrazilianName(firstNameValue: string, lastNameValue = '') {
  const explicitLastName = cleanText(lastNameValue);
  const fullName = cleanText(firstNameValue);
  if (explicitLastName) {
    return { firstName: titleCase(fullName), lastName: titleCase(explicitLastName) };
  }
  const [firstName = '', ...lastNameParts] = fullName.split(' ');
  return { firstName: titleCase(firstName), lastName: titleCase(lastNameParts.join(' ')) };
}

export function normalizeBrazilianPhone(value: string): string | null {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) digits = digits.slice(2);
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  const localNumber = digits.slice(2);
  if (!/^[2-9]\d{7,8}$/.test(localNumber)) return null;
  return `55${digits}`;
}

export function sanitizeContactRows(
  rows: string[][],
  mapping: ContactColumnMapping,
  fallbackTag: string
): SanitizeResult {
  const contacts: SanitizedContact[] = [];
  const seenPhones = new Set<string>();
  let invalidPhones = 0;
  let duplicates = 0;
  let emptyRows = 0;

  rows.forEach((row, index) => {
    if (row.every((cell) => !cleanText(cell ?? ''))) {
      emptyRows += 1;
      return;
    }
    const phone = normalizeBrazilianPhone(mapping.phone >= 0 ? row[mapping.phone] ?? '' : '');
    if (!phone) {
      invalidPhones += 1;
      return;
    }
    if (seenPhones.has(phone)) {
      duplicates += 1;
      return;
    }
    seenPhones.add(phone);
    const { firstName, lastName } = splitBrazilianName(
      mapping.firstName >= 0 ? row[mapping.firstName] ?? '' : '',
      mapping.lastName >= 0 ? row[mapping.lastName] ?? '' : ''
    );
    contacts.push({
      firstName,
      lastName,
      phone,
      tag: cleanText(mapping.tag >= 0 ? row[mapping.tag] ?? '' : '') || cleanText(fallbackTag),
      sourceRow: index + 2,
    });
  });

  return { contacts, invalidPhones, duplicates, emptyRows };
}

function csvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

export function contactsToCsv(contacts: SanitizedContact[]) {
  const header = ['nome', 'sobrenome', 'telefone', 'tag'];
  const lines = contacts.map((contact) =>
    [contact.firstName, contact.lastName, contact.phone, contact.tag].map(csvCell).join(';')
  );
  return `\uFEFF${header.join(';')}\r\n${lines.join('\r\n')}`;
}
