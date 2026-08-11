import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, Megaphone } from 'lucide-react';
import { useFilters } from '../../state/FiltersContext';
import { adAccounts } from '../../data/mockData';

export function AdminClientsPage() {
  const { clients } = useFilters();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Clientes</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Gerencie os clientes da agência e os projetos de cada um
          </p>
        </div>
        <button
          onClick={() => navigate('/admin/clientes/novo')}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus size={15} /> Novo Cliente
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => {
          const accounts = adAccounts.filter((a) => a.clientId === c.id);
          return (
            <button
              key={c.id}
              onClick={() => navigate(`/admin/clientes/${c.id}`)}
              className="group flex flex-col items-start rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-left hover:border-[var(--color-brand)]"
            >
              <div className="flex w-full items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--color-text)]">{c.name}</h2>
                <ArrowRight
                  size={16}
                  className="text-[var(--color-text-faint)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-brand)]"
                />
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{c.segment}</p>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--color-text-faint)]">
                <Megaphone size={12} /> {accounts.length} conta(s) de anúncio
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
