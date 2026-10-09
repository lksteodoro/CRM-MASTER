import { formatMoney } from '../../../supabase/functions/optimization-ia/engine.ts';
import type { OptimizationAction } from '../../services/optimization.service';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return 'nunca';
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff)) return '—';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

/** Centavos ↔ texto em reais para os campos do formulário. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function inputToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^\d,.-]/g, '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function payloadText(action: Pick<OptimizationAction, 'requested_payload'>, currency: string): string | null {
  const payload = action.requested_payload;
  if (!payload || payload.kind === 'none') return null;
  if (payload.kind === 'status') return 'Status: ativo → pausado';
  const sign = payload.toCents >= payload.fromCents ? '+' : '−';
  return `Orçamento diário: ${formatMoney(payload.fromCents, currency)} → ${formatMoney(payload.toCents, currency)} (${sign}${payload.pct}%)`;
}
