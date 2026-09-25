import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, ExternalLink, Link2, Loader2, RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { metaGetAll, MetaNotConnectedError } from '../../lib/metaGraph';

type AdAccount = { id: string; name?: string; account_status?: number; business?: { name?: string } };

type GraphAd = {
  id: string;
  name?: string;
  effective_status?: string;
  campaign?: { id: string; name?: string; effective_status?: string };
  adset?: { name?: string };
  creative?: {
    object_story_spec?: Record<string, any>;
    asset_feed_spec?: Record<string, any>;
    link_url?: string;
    object_url?: string;
  };
};

type GraphCampaign = { id: string; name?: string; effective_status?: string };

type UrlGroup = {
  url: string;
  ads: { id: string; name: string; adset: string; status: string }[];
};

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  urlGroups: UrlGroup[];
  adCount: number;
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  CAMPAIGN_PAUSED: 'Pausada',
  ADSET_PAUSED: 'Pausada',
  ARCHIVED: 'Arquivada',
  DELETED: 'Excluída',
  IN_PROCESS: 'Em análise',
  PENDING_REVIEW: 'Em análise',
  DISAPPROVED: 'Reprovada',
  WITH_ISSUES: 'Com problemas',
};

const inputClass =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45';

function accountLabel(account: AdAccount) {
  return `${account.name || account.id}${account.business?.name ? ` · ${account.business.name}` : ''}`;
}

/** Junta todas as URLs de destino que um criativo pode carregar. */
function creativeUrls(creative: GraphAd['creative']): string[] {
  if (!creative) return [];
  const found: unknown[] = [creative.link_url, creative.object_url];
  const spec = creative.object_story_spec ?? {};
  const link = spec.link_data;
  const video = spec.video_data;
  found.push(link?.link, link?.call_to_action?.value?.link);
  for (const child of link?.child_attachments ?? []) found.push(child?.link);
  found.push(video?.call_to_action?.value?.link);
  for (const item of creative.asset_feed_spec?.link_urls ?? []) found.push(item?.website_url);

  return found
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function MetaCampaignUrls() {
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountFilter, setAccountFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [onlyActive, setOnlyActive] = useState(true);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CampaignRow[]>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await metaGetAll<AdAccount>('me/adaccounts', {
          fields: 'id,name,account_status,business{id,name}',
          limit: 200,
        });
        if (!cancelled) setAccounts(rows);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof MetaNotConnectedError || caught instanceof Error
              ? caught.message
              : 'Não foi possível listar as contas de anúncio.'
          );
        }
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

  const visibleAccounts = useMemo(() => {
    const term = accountFilter.trim().toLowerCase();
    return term ? accounts.filter((account) => accountLabel(account).toLowerCase().includes(term)) : accounts;
  }, [accounts, accountFilter]);

  const loadAccount = useCallback(
    async (accountId: string): Promise<CampaignRow[]> => {
      const filtering = onlyActive
        ? JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }])
        : undefined;

      const [campaigns, ads] = await Promise.all([
        metaGetAll<GraphCampaign>(`${accountId}/campaigns`, {
          fields: 'id,name,effective_status',
          limit: 200,
          ...(filtering ? { filtering } : {}),
        }),
        metaGetAll<GraphAd>(
          `${accountId}/ads`,
          {
            fields:
              'id,name,effective_status,adset{name},campaign{id,name,effective_status},creative{object_story_spec,asset_feed_spec,link_url,object_url}',
            limit: 100,
            ...(filtering ? { filtering } : {}),
          },
          { maxPages: 30 }
        ),
      ]);

      const byCampaign = new Map<string, CampaignRow>();
      for (const campaign of campaigns) {
        byCampaign.set(campaign.id, {
          id: campaign.id,
          name: campaign.name || campaign.id,
          status: campaign.effective_status || '',
          urlGroups: [],
          adCount: 0,
        });
      }
      for (const ad of ads) {
        const campaignId = ad.campaign?.id;
        if (!campaignId) continue;
        const row =
          byCampaign.get(campaignId) ??
          {
            id: campaignId,
            name: ad.campaign?.name || campaignId,
            status: ad.campaign?.effective_status || '',
            urlGroups: [],
            adCount: 0,
          };
        row.adCount += 1;
        const entry = {
          id: ad.id,
          name: ad.name || ad.id,
          adset: ad.adset?.name || '',
          status: ad.effective_status || '',
        };
        for (const url of creativeUrls(ad.creative)) {
          const group = row.urlGroups.find((item) => item.url === url);
          if (group) group.ads.push(entry);
          else row.urlGroups.push({ url, ads: [entry] });
        }
        byCampaign.set(campaignId, row);
      }
      for (const row of byCampaign.values()) row.urlGroups.sort((a, b) => b.ads.length - a.ads.length);
      return [...byCampaign.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    },
    [onlyActive]
  );

  const load = useCallback(async () => {
    if (selected.length === 0) {
      setResults({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const entries = await Promise.all(
        selected.map(async (accountId) => [accountId, await loadAccount(accountId)] as const)
      );
      setResults(Object.fromEntries(entries));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as campanhas.');
    } finally {
      setLoading(false);
    }
  }, [selected, loadAccount]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleAccount(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((current) => (current === text ? null : current)), 1500);
    } catch {
      // clipboard indisponível: o usuário ainda pode selecionar o texto
    }
  }

  function exportCsv() {
    const lines = [['Conta', 'ID da conta', 'Campanha', 'ID da campanha', 'Status', 'URL', 'Anúncios com essa URL', 'Nomes dos anúncios']];
    for (const accountId of selected) {
      const account = accountById.get(accountId);
      for (const row of results[accountId] ?? []) {
        const groups: UrlGroup[] = row.urlGroups.length > 0 ? row.urlGroups : [{ url: '', ads: [] }];
        for (const group of groups) {
          lines.push([
            account?.name || accountId,
            accountId,
            row.name,
            row.id,
            STATUS_LABEL[row.status] ?? row.status,
            group.url,
            String(group.ads.length),
            group.ads.map((ad) => ad.name).join(' | '),
          ]);
        }
      }
    }
    const csv = '﻿' + lines.map((line) => line.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `campanhas_urls_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const term = search.trim().toLowerCase();

  return (
    <section className="mt-6 rounded-3xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-200">
            <Link2 size={20} />
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[var(--color-text)]">
            Campanhas e URLs por conta
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            Escolha uma ou mais contas de anúncio e veja, campanha por campanha, qual URL de destino
            os anúncios estão usando agora.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <input type="checkbox" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} />
            Só campanhas e anúncios ativos
          </label>
          <button
            onClick={() => void load()}
            disabled={loading || selected.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <RefreshCw size={13} className={clsx(loading && 'animate-spin')} /> Atualizar
          </button>
          <button
            onClick={exportCsv}
            disabled={selected.length === 0 || Object.keys(results).length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <Download size={13} /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <input
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
              placeholder="Buscar conta ou BM"
              className={clsx(inputClass, 'w-full pl-9')}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-text-faint)]">
            <span>{selected.length} de {accounts.length} selecionada(s)</span>
            {selected.length > 0 && (
              <button onClick={() => setSelected([])} className="hover:text-[var(--color-text)]">Limpar</button>
            )}
          </div>
          <div className="mt-2 max-h-96 space-y-0.5 overflow-y-auto">
            {loadingAccounts && (
              <p className="flex items-center gap-2 p-3 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={13} className="animate-spin" /> Carregando contas...
              </p>
            )}
            {!loadingAccounts && visibleAccounts.length === 0 && (
              <p className="p-3 text-xs text-[var(--color-text-faint)]">Nenhuma conta encontrada.</p>
            )}
            {visibleAccounts.map((account) => (
              <label
                key={account.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-xs hover:bg-[var(--color-panel-2)]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.includes(account.id)}
                  onChange={() => toggleAccount(account.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--color-text)]">{account.name || account.id}</span>
                  <span className="block truncate text-[10px] text-[var(--color-text-faint)]">
                    {account.id}{account.business?.name ? ` · ${account.business.name}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {error && (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
          )}

          {selected.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-5 py-14 text-center text-sm text-[var(--color-text-muted)]">
              Selecione uma conta de anúncio ao lado pra listar as campanhas e as URLs.
            </div>
          ) : (
            <>
              <div className="relative mb-3 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filtrar campanha ou URL"
                  className={clsx(inputClass, 'w-full pl-9')}
                />
              </div>

              {loading && Object.keys(results).length === 0 && (
                <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                  <Loader2 size={15} className="animate-spin" /> Buscando campanhas e URLs na Meta...
                </p>
              )}

              <div className="space-y-5">
                {selected.map((accountId) => {
                  const account = accountById.get(accountId);
                  const rows = (results[accountId] ?? []).filter(
                    (row) =>
                      !term ||
                      row.name.toLowerCase().includes(term) ||
                      row.urlGroups.some((group) => group.url.toLowerCase().includes(term))
                  );
                  return (
                    <div key={accountId} className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                            {account?.name || accountId}
                          </p>
                          <p className="text-[11px] text-[var(--color-text-faint)]">
                            {accountId}{account?.business?.name ? ` · ${account.business.name}` : ''}
                          </p>
                        </div>
                        <a
                          href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(accountId.replace(/^act_/i, ''))}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:underline"
                        >
                          <ExternalLink size={11} /> Abrir no Gerenciador
                        </a>
                      </div>

                      {rows.length === 0 ? (
                        <p className="px-4 py-6 text-center text-xs text-[var(--color-text-faint)]">
                          {results[accountId]
                            ? onlyActive
                              ? 'Nenhuma campanha ativa nesta conta.'
                              : 'Nenhuma campanha encontrada.'
                            : 'Carregando...'}
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[640px] text-left text-xs">
                            <thead className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                              <tr>
                                <th className="px-4 py-2 font-medium">Campanha</th>
                                <th className="px-2 py-2 font-medium">Status</th>
                                <th className="px-2 py-2 text-right font-medium">Anúncios</th>
                                <th className="px-4 py-2 font-medium">URL de destino</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <tr key={row.id} className="border-t border-[var(--color-border-soft)] align-top">
                                  <td className="px-4 py-3">
                                    <p className="font-medium text-[var(--color-text)]">{row.name}</p>
                                    {row.urlGroups.length > 1 && (
                                      <span className="mt-1 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                        {row.urlGroups.length} URLs diferentes
                                      </span>
                                    )}
                                    <p className="font-mono text-[10px] text-[var(--color-text-faint)]">{row.id}</p>
                                  </td>
                                  <td className="px-2 py-3">
                                    <span
                                      className={clsx(
                                        'rounded-full px-2 py-0.5 text-[10px]',
                                        row.status === 'ACTIVE'
                                          ? 'bg-emerald-500/10 text-emerald-300'
                                          : 'bg-[var(--color-panel-2)] text-[var(--color-text-muted)]'
                                      )}
                                    >
                                      {STATUS_LABEL[row.status] ?? (row.status || '—')}
                                    </span>
                                  </td>
                                  <td className="px-2 py-3 text-right text-[var(--color-text-muted)]">{row.adCount}</td>
                                  <td className="px-4 py-3">
                                    {row.urlGroups.length === 0 ? (
                                      <span className="text-[var(--color-text-faint)]">
                                        {row.adCount === 0 ? 'Sem anúncios' : 'URL não encontrada nos criativos'}
                                      </span>
                                    ) : (
                                      <ul className="space-y-2">
                                        {row.urlGroups.map((group) => {
                                          const key = `${row.id}|${group.url}`;
                                          const open = expanded.has(key);
                                          return (
                                            <li key={key} className="rounded-lg border border-[var(--color-border-soft)] p-2">
                                              <div className="flex items-start gap-2">
                                                <a
                                                  href={group.url}
                                                  target="_blank"
                                                  rel="noreferrer noopener"
                                                  className="min-w-0 flex-1 break-all text-cyan-300 hover:underline"
                                                >
                                                  {group.url}
                                                </a>
                                                <button
                                                  onClick={() => void copy(group.url)}
                                                  title="Copiar URL"
                                                  className="shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                                                >
                                                  {copied === group.url ? <span className="text-emerald-400">Copiado</span> : <Copy size={12} />}
                                                </button>
                                              </div>
                                              <button
                                                onClick={() => toggleExpanded(key)}
                                                className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                              >
                                                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                                {group.ads.length} anúncio(s) usam esta URL
                                              </button>
                                              {open && (
                                                <ul className="mt-1.5 space-y-0.5 border-l border-[var(--color-border)] pl-3 text-[11px] text-[var(--color-text-muted)]">
                                                  {group.ads.map((ad) => (
                                                    <li key={ad.id} className="truncate" title={ad.name}>
                                                      {ad.name}
                                                      {ad.adset && <span className="text-[var(--color-text-faint)]"> · {ad.adset}</span>}
                                                      {ad.status && ad.status !== 'ACTIVE' && (
                                                        <span className="text-[var(--color-text-faint)]"> · {STATUS_LABEL[ad.status] ?? ad.status}</span>
                                                      )}
                                                    </li>
                                                  ))}
                                                </ul>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
