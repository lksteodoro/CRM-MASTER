import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useFilters } from '../../state/FiltersContext';
import type { DateRangePreset } from '../../types';

const presets: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: '14d', label: 'Últimos 14 dias' },
  { key: '30d', label: 'Últimos 30 dias' },
  { key: '180d', label: 'Últimos 180 dias' },
  { key: 'custom', label: 'Personalizado' },
];

export function DateRangePicker() {
  const { dateRange, setPreset, setCustomRange } = useFilters();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(dateRange.start);
  const [end, setEnd] = useState(dateRange.end);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const activeLabel = presets.find((p) => p.key === dateRange.preset)?.label ?? 'Personalizado';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)]"
      >
        <Calendar size={15} className="text-[var(--color-text-muted)]" />
        {activeLabel}
        {dateRange.preset === 'custom' && (
          <span className="text-[var(--color-text-faint)]">
            ({dateRange.start} — {dateRange.end})
          </span>
        )}
        <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-2 shadow-xl">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                if (p.key !== 'custom') {
                  setPreset(p.key);
                  setOpen(false);
                } else {
                  setPreset('custom');
                }
              }}
              className={clsx(
                'w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-panel-2)]',
                dateRange.preset === p.key
                  ? 'text-[var(--color-brand)]'
                  : 'text-[var(--color-text)]'
              )}
            >
              {p.label}
            </button>
          ))}

          {dateRange.preset === 'custom' && (
            <div className="mt-1 flex flex-col gap-2 border-t border-[var(--color-border)] p-2">
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Início
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-sm text-[var(--color-text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Fim
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-sm text-[var(--color-text)]"
                />
              </label>
              <button
                onClick={() => {
                  setCustomRange(start, end);
                  setOpen(false);
                }}
                className="mt-1 rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Aplicar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
