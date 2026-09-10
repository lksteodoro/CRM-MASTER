/** Only retry failures known to precede submission. Ambiguous upstream outcomes need review. */
export function classifySendResponse(status: number, payload: unknown): {
  status: 'sent' | 'failed' | 'uncertain'; error?: string; messageId?: string;
} {
  const key = payload && typeof payload === 'object' && 'key' in payload ? (payload as { key?: unknown }).key : null;
  const messageId = key && typeof key === 'object' && 'id' in key && typeof key.id === 'string' && key.id.trim() ? key.id : undefined;
  if (status >= 200 && status < 300 && messageId) return { status: 'sent', messageId };
  // Even 5xx/429 can originate in a gateway after upstream submission: no blind retry.
  if ([400, 401, 403, 404, 405, 422].includes(status)) return { status: 'failed', error: `evolution_rejected_http_${status}` };
  return { status: 'uncertain', error: `evolution_result_unconfirmed_http_${status}_check_whatsapp` };
}
