import { X, Repeat, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LeadGroup } from '../../lib/leadHistory';
import { campaignName, adSetName, adName, sales } from '../../data/leadSalesData';
import { formatBRL } from '../../lib/format';
import type { LeadStatus } from '../../types';
import { useProjectPath } from '../../hooks/useProjectPath';

const statusColor: Record<LeadStatus, string> = {
  Novo: 'var(--color-info)',
  Contatado: 'var(--color-warn)',
  Qualificado: 'var(--color-violet)',
  'Negociação': 'var(--color-brand)',
  Matriculado: 'var(--color-good)',
  Perdido: 'var(--color-bad)',
};

export function LeadHistoryModal({ group, onClose }: { group: LeadGroup; onClose: () => void }) {
  const projectPath = useProjectPath();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">{group.name}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {group.email} · {group.phone}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-panel-2)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3">
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-info-soft)] px-2.5 py-1 text-xs text-[var(--color-info)]">
            <Repeat size={12} /> {group.count} entrada{group.count > 1 ? 's' : ''}
          </span>
          <span className="text-xs text-[var(--color-text-faint)]">
            primeira em {group.firstEntry.createdAt.slice(0, 10)} · última em {group.lastEntry.createdAt.slice(0, 10)}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-3">
            {group.entries.map((entry) => {
              const sale = sales.find((s) => s.leadId === entry.id);
              const isImported = !entry.adId;
              return (
                <div key={entry.id} className="rounded-xl border border-[var(--color-border-soft)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-faint)]">
                      {entry.createdAt.slice(0, 10)} às {entry.createdAt.slice(11, 16)}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{
                        background: `color-mix(in srgb, ${statusColor[entry.status]} 16%, transparent)`,
                        color: statusColor[entry.status],
                      }}
                    >
                      {entry.status}
                    </span>
                  </div>

                  {isImported ? (
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">Importação manual (CSV)</p>
                  ) : (
                    <>
                      <Link
                        to={projectPath(`anuncios/${entry.adId}`)}
                        onClick={onClose}
                        className="mt-2 block text-xs text-[var(--color-text)] hover:text-[var(--color-brand)]"
                      >
                        {campaignName(entry.campaignId)} › {adSetName(entry.adSetId)} › {adName(entry.adId)}
                      </Link>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <UtmPill label="source" value={entry.utm.source} />
                        <UtmPill label="medium" value={entry.utm.medium} />
                        <UtmPill label="campaign" value={entry.utm.campaign} />
                        <UtmPill label="content" value={entry.utm.content} />
                        <UtmPill label="term" value={entry.utm.term} />
                      </div>
                    </>
                  )}

                  {sale && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-good)]">
                      <Webhook size={12} /> Venda fechada: {formatBRL(sale.value)} em {sale.closedAt.slice(0, 10)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function UtmPill({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <span className="rounded-md bg-[var(--color-panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
      <span className="text-[var(--color-text-faint)]">utm_{label}=</span>
      {value}
    </span>
  );
}
