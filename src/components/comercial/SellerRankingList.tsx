import { useState } from 'react';
import { Plus, MinusCircle } from 'lucide-react';
import type { SellerRankRow } from '../../services/crmLeads.service';
import { formatScore, formatBRL } from '../../lib/format';
import { Avatar } from './Avatar';

export function SellerRankingList({
  rows,
  canManage,
  onAdjust,
}: {
  rows: SellerRankRow[];
  canManage: boolean;
  onAdjust?: (sellerId: string, amount: number, note: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { amount: string; note: string }>>({});

  function draftFor(sellerId: string) {
    return drafts[sellerId] ?? { amount: '', note: '' };
  }

  function apply(sellerId: string, sign: 1 | -1) {
    const draft = draftFor(sellerId);
    const raw = Number(draft.amount);
    if (!raw || Number.isNaN(raw)) return;
    onAdjust?.(sellerId, sign * Math.abs(raw), draft.note);
    setDrafts((prev) => ({ ...prev, [sellerId]: { amount: '', note: '' } }));
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const pct = row.salesGoal > 0 ? Math.min(100, (row.points / row.salesGoal) * 100) : 0;
        const missing = Math.max(0, row.salesGoal - row.points);
        const draft = draftFor(row.sellerId);
        return (
          <div
            key={row.sellerId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-panel)] text-xs font-bold text-[var(--color-text-muted)]">
              {i + 1}
            </span>
            <Avatar name={row.name} photoUrl={row.photoUrl} size={36} />

            <div className="min-w-[160px] flex-1">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{row.name}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {formatScore(row.points, 'pontos')} · {formatBRL(row.revenue)}
              </p>
              {row.salesGoal > 0 && (
                <>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1b1c25]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: pct >= 100 ? 'var(--color-good)' : 'var(--color-brand)',
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[11px] font-medium text-[var(--color-text)]">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                    {missing > 0 ? `Faltam: ${missing} venda${missing > 1 ? 's' : ''}` : 'Meta atingida 🎉'}
                  </p>
                </>
              )}
            </div>

            {canManage && onAdjust && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={draft.amount}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [row.sellerId]: { ...draftFor(row.sellerId), amount: e.target.value },
                    }))
                  }
                  placeholder="Valor"
                  className="w-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-right text-xs text-[var(--color-text)]"
                />
                <input
                  value={draft.note}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [row.sellerId]: { ...draftFor(row.sellerId), note: e.target.value },
                    }))
                  }
                  placeholder="Motivo"
                  className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                />
                <button
                  onClick={() => apply(row.sellerId, 1)}
                  title="Adicionar valor"
                  className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-good)] hover:border-[var(--color-good)]"
                >
                  <Plus size={14} />
                </button>
                <button
                  onClick={() => apply(row.sellerId, -1)}
                  title="Retirar valor (lança correção no histórico)"
                  className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-bad)] hover:border-[var(--color-bad)]"
                >
                  <MinusCircle size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
