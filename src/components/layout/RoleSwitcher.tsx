import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, User, ChevronDown } from 'lucide-react';
import { useFilters } from '../../state/FiltersContext';

// Simulates "logging in" as the agency (sees every client) or as a single
// client (scoped to only their own data) — there's no real backend here, so
// this stands in for what an auth layer would enforce in production.
export function RoleSwitcher() {
  const { role, setRole, clients, activeClientId, switchClient } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const activeClient = clients.find((c) => c.id === activeClientId);
  const label = role === 'agencia' ? 'Agência (todos os clientes)' : `Cliente: ${activeClient?.name ?? ''}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Modo de visualização (simula o acesso restrito por cliente)"
        className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)]"
      >
        {role === 'agencia' ? <ShieldCheck size={14} /> : <User size={14} />}
        <span className="max-w-[160px] truncate">{label}</span>
        <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-1.5 shadow-xl">
          <p className="px-3 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Ver como
          </p>
          <button
            onClick={() => {
              setRole('agencia');
              setOpen(false);
            }}
            className={
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-panel-2)] ' +
              (role === 'agencia' ? 'text-[var(--color-brand)]' : 'text-[var(--color-text)]')
            }
          >
            <ShieldCheck size={14} /> Agência (todos os clientes)
          </button>

          <div className="my-1 border-t border-[var(--color-border-soft)]" />

          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                switchClient(c.id);
                setRole('cliente');
                setOpen(false);
                navigate('/');
              }}
              className={
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-panel-2)] ' +
                (role === 'cliente' && c.id === activeClientId
                  ? 'text-[var(--color-brand)]'
                  : 'text-[var(--color-text)]')
              }
            >
              <User size={14} /> {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
