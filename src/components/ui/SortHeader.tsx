import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

export function SortHeader<K extends string>({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  align = 'right',
}: {
  label: string;
  colKey: K;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: K) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === colKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={align === 'right' ? 'text-right' : 'text-left'}>
      <button
        onClick={() => onSort(colKey)}
        className={
          'inline-flex items-center gap-1 text-xs font-medium hover:text-[var(--color-text)] ' +
          (active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]')
        }
      >
        {label}
        <Icon size={11} />
      </button>
    </th>
  );
}
