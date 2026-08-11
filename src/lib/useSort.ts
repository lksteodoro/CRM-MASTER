import { useMemo, useState } from 'react';

export function useSort<T>(
  rows: T[],
  defaultKey: keyof T,
  defaultDir: 'asc' | 'desc' = 'desc'
) {
  const [key, setKey] = useState<keyof T>(defaultKey);
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'asc' ? av - bv : bv - av;
      }
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [rows, key, dir]);

  function toggle(k: keyof T) {
    if (k === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setKey(k);
      setDir('desc');
    }
  }

  return { sorted, sortKey: key, sortDir: dir, toggle };
}
