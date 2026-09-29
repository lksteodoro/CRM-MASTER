import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, ChevronDown, ChevronRight, Download, Loader2, RefreshCw } from 'lucide-react';
import {
  getRedirectClickStats,
  type RedirectClickStat,
  type RedirectLinkWithDestinations,
} from '../../services/redirectLinks.service';
import type { ClientRow } from '../../integrations/supabase/database.types';

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

const selectClass =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';

/** Data (AAAA-MM-DD) no fuso de São Paulo — o mesmo usado para agrupar no banco. */
function spDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

function shortDay(iso: string) {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function RedirectClickAnalytics({
  links,
  clients,
}: {
  links: RedirectLinkWithDestinations[];
  clients: ClientRow[];
}) {
  const [periodDays, setPeriodDays] = useState(30);
  const [clientId, setClientId] = useState('');
  const [linkId, setLinkId] = useState('');
  const [stats, setStats] = useState<RedirectClickStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openLinks, setOpenLinks] = useState<Set<string>>(new Set());

  const from = spDate(-(periodDays - 1));
  const to = spDate(0);
  const today = to;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await getRedirectClickStats(from, to));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os cliques.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const clientsWithLinks = useMemo(
    () => clients.filter((client) => links.some((link) => link.client_id === client.id)),
    [clients, links]
  );
  const linksInScope = useMemo(
    () => links.filter((link) => (!clientId || link.client_id === clientId) && (!linkId || link.id === linkId)),
    [links, clientId, linkId]
  );
  const scopeIds = useMemo(() => new Set(linksInScope.map((link) => link.id)), [linksInScope]);
  const scopedStats = useMemo(() => stats.filter((row) => scopeIds.has(row.redirect_link_id)), [stats, scopeIds]);

  const days = useMemo(() => {
    const list: string[] = [];
    for (let offset = periodDays - 1; offset >= 0; offset -= 1) list.push(spDate(-offset));
    return list;
  }, [periodDays]);

  const chartData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const row of scopedStats) byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.clicks);
    return days.map((day) => ({ day, label: shortDay(day), cliques: byDay.get(day) ?? 0 }));
  }, [scopedStats, days]);

  const periodTotal = chartData.reduce((sum, item) => sum + item.cliques, 0);
  const todayTotal = chartData.find((item) => item.day === today)?.cliques ?? 0;
  const bestDay = chartData.reduce((best, item) => (item.cliques > best.cliques ? item : best), chartData[0] ?? { label: '—', cliques: 0 });
  const lifetimeTotal = linksInScope.reduce((sum, link) => sum + link.hit_count, 0);

  const perLink = useMemo(() => {
    return linksInScope
      .map((link) => {
        const rows = scopedStats.filter((row) => row.redirect_link_id === link.id);
        const byUrl = new Map<string, { period: number; today: number }>();
        for (const row of rows) {
          const current = byUrl.get(row.target_url) ?? { period: 0, today: 0 };
          current.period += row.clicks;
          if (row.day === today) current.today += row.clicks;
          byUrl.set(row.target_url, current);
        }
        // URLs atuais aparecem mesmo sem clique no período; as antigas só se tiveram clique.
        for (const destination of link.destinations) {
          if (!byUrl.has(destination.target_url)) byUrl.set(destination.target_url, { period: 0, today: 0 });
        }
        const period = rows.reduce((sum, row) => sum + row.clicks, 0);
        const todayClicks = rows.filter((row) => row.day === today).reduce((sum, row) => sum + row.clicks, 0);
        const labels = new Map(link.destinations.map((destination) => [destination.target_url, destination.label]));
        const current = new Set(link.destinations.map((destination) => destination.target_url));
        const urls = [...byUrl.entries()]
          .map(([url, counts]) => ({ url, label: labels.get(url) ?? null, current: current.has(url), ...counts }))
          .sort((a, b) => b.period - a.period);
        return { link, period, today: todayClicks, urls };
      })
      .sort((a, b) => b.period - a.period || b.link.hit_count - a.link.hit_count);
  }, [linksInScope, scopedStats, today]);

  function toggle(id: string) {
    setOpenLinks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const linkById = new Map(links.map((link) => [link.id, link]));
    const lines = [['Dia', 'Cliente', 'Link', 'Endereço', 'URL de destino', 'Cliques'].map(csvCell).join(',')];
    for (const row of [...scopedStats].sort((a, b) => a.day.localeCompare(b.day))) {
      const link = linkById.get(row.redirect_link_id);
      lines.push(
        [
          row.day,
          clientById.get(link?.client_id ?? '')?.name ?? '',
          link?.name ?? '',
          link ? `/r/${link.slug}` : '',
          row.target_url,
          row.clicks,
        ]
          .map(csvCell)
          .join(',')
      );
    }
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cliques_${from}_a_${to}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-[var(--color-brand)]" />
            <h2 className="font-semibold text-[var(--color-text)]">Analytics de cliques</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Cliques por dia e por URL de destino. No randomizador, mostra quantos acessos cada URL recebeu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--color-border)] p-0.5">
            {PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                onClick={() => setPeriodDays(period.days)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  periodDays === period.days
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {period.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Filtrar por cliente"
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setLinkId('');
            }}
            className={selectClass}
          >
            <option value="">Todos os clientes</option>
            {clientsWithLinks.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
          <select aria-label="Filtrar por link" value={linkId} onChange={(event) => setLinkId(event.target.value)} className={selectClass}>
            <option value="">Todos os links</option>
            {links
              .filter((link) => !clientId || link.client_id === clientId)
              .map((link) => (
                <option key={link.id} value={link.id}>{link.name}</option>
              ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={scopedStats.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            <Download size={12} /> CSV
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-[var(--color-bad)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label={`Cliques em ${periodDays} dias`} value={periodTotal} />
        <Kpi label="Cliques hoje" value={todayTotal} />
        <Kpi label="Melhor dia" value={bestDay.cliques} hint={bestDay.cliques > 0 ? bestDay.label : undefined} />
        <Kpi label="Total acumulado" value={lifetimeTotal} hint="desde a criação" />
      </div>

      <div className="mt-4 h-56">
        {loading && stats.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Loader2 size={14} className="animate-spin" /> Carregando cliques...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border-soft)" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} stroke="var(--color-text-faint)" minTickGap={12} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={10} width={32} stroke="var(--color-text-faint)" />
              <Tooltip
                cursor={{ fill: 'var(--color-brand-soft)' }}
                contentStyle={{ background: '#16171f', border: '1px solid #2b2d38', borderRadius: 12, fontSize: 11 }}
                formatter={(value) => [Number(value ?? 0).toLocaleString('pt-BR'), 'Cliques']}
              />
              <Bar dataKey="cliques" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
            <tr>
              <th className="pb-2 font-medium">Link</th>
              <th className="pb-2 text-right font-medium">Hoje</th>
              <th className="pb-2 text-right font-medium">{periodDays} dias</th>
              <th className="pb-2 text-right font-medium">Total acumulado</th>
            </tr>
          </thead>
          <tbody>
            {perLink.map(({ link, period, today: todayClicks, urls }) => {
              const open = openLinks.has(link.id);
              return (
                <Fragment key={link.id}>
                  <tr className="border-t border-[var(--color-border-soft)]">
                    <td className="py-2.5 pr-3">
                      <button type="button" onClick={() => toggle(link.id)} className="flex min-w-0 items-start gap-1.5 text-left">
                        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0" /> : <ChevronRight size={13} className="mt-0.5 shrink-0" />}
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--color-text)]">{link.name}</span>
                          <span className="block truncate text-[10px] text-[var(--color-text-faint)]">
                            {clientById.get(link.client_id)?.name ?? ''} · /r/{link.slug} · {urls.length} URL{urls.length === 1 ? '' : 's'}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="text-right">{todayClicks.toLocaleString('pt-BR')}</td>
                    <td className="text-right font-semibold text-[var(--color-text)]">{period.toLocaleString('pt-BR')}</td>
                    <td className="text-right text-[var(--color-text-muted)]">{link.hit_count.toLocaleString('pt-BR')}</td>
                  </tr>
                  {open &&
                    urls.map((item) => (
                      <tr key={`${link.id}-${item.url}`} className="bg-[var(--color-bg)]/60">
                        <td className="py-2 pl-7 pr-3">
                          <p className="truncate text-[var(--color-text-muted)]" title={item.url}>
                            {item.label ? <span className="text-[var(--color-text)]">{item.label} · </span> : null}
                            {item.url}
                            {!item.current && <span className="ml-1 text-[10px] text-[var(--color-text-faint)]">(removida)</span>}
                          </p>
                          {period > 0 && (
                            <div className="mt-1 h-1 w-full max-w-xs overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                              <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${(item.period / period) * 100}%` }} />
                            </div>
                          )}
                        </td>
                        <td className="text-right text-[var(--color-text-muted)]">{item.today.toLocaleString('pt-BR')}</td>
                        <td className="text-right text-[var(--color-text-muted)]">
                          {item.period.toLocaleString('pt-BR')}
                          {period > 0 && <span className="ml-1 text-[10px] text-[var(--color-text-faint)]">{Math.round((item.period / period) * 100)}%</span>}
                        </td>
                        <td />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {perLink.length === 0 && <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Nenhum link neste filtro.</p>}
      </div>

      <p className="mt-3 text-[10px] text-[var(--color-text-faint)]">
        O detalhamento por dia começou a ser registrado em 29/09/2026. Antes disso, só existe o total acumulado de cada link.
      </p>
    </section>
  );
}


function Kpi({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5">
      <p className="text-[10px] text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[var(--color-text)]">
        {value.toLocaleString('pt-BR')}
        {hint && <span className="ml-1.5 text-[10px] font-normal text-[var(--color-text-faint)]">{hint}</span>}
      </p>
    </div>
  );
}
