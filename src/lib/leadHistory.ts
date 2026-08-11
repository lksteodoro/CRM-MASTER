import type { Lead } from '../types';

export interface LeadGroup {
  key: string;
  name: string;
  email: string;
  phone: string;
  entries: Lead[];
  firstEntry: Lead;
  lastEntry: Lead;
  count: number;
}

// Groups individual form submissions by the same person (email as identity
// key), so repeat entries across different campaigns surface as one lead
// with a visitation history instead of duplicate rows.
export function groupLeadsByContact(leadsList: Lead[]): LeadGroup[] {
  const byEmail = new Map<string, Lead[]>();
  for (const lead of leadsList) {
    const key = lead.email.toLowerCase();
    const list = byEmail.get(key) ?? [];
    list.push(lead);
    byEmail.set(key, list);
  }

  return Array.from(byEmail.entries()).map(([key, entries]) => {
    const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return {
      key,
      name: sorted[0].name,
      email: sorted[0].email,
      phone: sorted[0].phone,
      entries: sorted,
      firstEntry: sorted[sorted.length - 1],
      lastEntry: sorted[0],
      count: sorted.length,
    };
  });
}
