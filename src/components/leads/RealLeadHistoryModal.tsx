import { X, Flag, GraduationCap } from 'lucide-react';
import { formatBRL } from '../../lib/format';
import type { ContactRow, LeadEventRow, SaleRow } from '../../integrations/supabase/database.types';

const attributionLabel: Record<string, { label: string; className: string }> = {
  COMPLETE: { label: 'Atribuição completa', className: 'text-[var(--color-good)] bg-[var(--color-good-soft)]' },
  PARTIAL: { label: 'Atribuição parcial', className: 'text-[var(--color-warn)] bg-[var(--color-warn-soft)]' },
  NONE: { label: 'Sem atribuição', className: 'text-[var(--color-text-faint)] bg-[var(--color-panel-2)]' },
  CONFLICT: { label: 'Conflito', className: 'text-[var(--color-bad)] bg-[var(--color-bad-soft)]' },
};

export function RealLeadHistoryModal({
  contact,
  events,
  sales,
  onClose,
}: {
  contact: ContactRow;
  events: LeadEventRow[];
  sales: SaleRow[];
  onClose: () => void;
}) {
  const timeline = [
    ...events.map((e) => ({ type: 'lead' as const, at: e.occurred_at, data: e })),
    ...sales.map((s) => ({ type: 'sale' as const, at: s.sold_at, data: s })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {contact.name || 'Contato sem nome'}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {contact.original_email ?? contact.normalized_email ?? '—'} ·{' '}
              {contact.original_phone ?? contact.normalized_phone ?? '—'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-3">
            {timeline.map((item, idx) => {
              if (item.type === 'lead') {
                const e = item.data;
                const attr = attributionLabel[e.attribution_status] ?? attributionLabel.NONE;
                return (
                  <div key={`lead-${idx}`} className="flex gap-3">
                    <Flag size={14} className="mt-1 shrink-0 text-[var(--color-info)]" />
                    <div className="flex-1 rounded-lg border border-[var(--color-border-soft)] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-[var(--color-text-faint)]">
                          {new Date(e.occurred_at).toLocaleString('pt-BR')}
                        </p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${attr.className}`}>
                          {attr.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-text)]">
                        Entrou como lead · status <b>{e.status}</b>
                      </p>
                      {(e.utm_campaign || e.utm_source) && (
                        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                          {e.utm_source && `utm_source=${e.utm_source} `}
                          {e.utm_campaign && `utm_campaign=${e.utm_campaign} `}
                          {e.utm_content && `utm_content=${e.utm_content}`}
                        </p>
                      )}
                      {(e.campaign_id || e.ad_id) && (
                        <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                          {e.campaign_id && `campanha=${e.campaign_id} `}
                          {e.ad_id && `anúncio=${e.ad_id}`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }
              const s = item.data;
              return (
                <div key={`sale-${idx}`} className="flex gap-3">
                  <GraduationCap size={14} className="mt-1 shrink-0 text-[var(--color-good)]" />
                  <div className="flex-1 rounded-lg border border-[var(--color-good)] bg-[var(--color-good-soft)] p-3">
                    <p className="text-xs text-[var(--color-text-faint)]">
                      {new Date(s.sold_at).toLocaleString('pt-BR')}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text)]">
                      Venda — {s.amount != null ? formatBRL(s.amount) : 'valor não informado'}
                    </p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">status {s.status}</p>
                  </div>
                </div>
              );
            })}
            {timeline.length === 0 && (
              <p className="text-center text-xs text-[var(--color-text-faint)]">Sem histórico.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
