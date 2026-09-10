import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, Send, Star, History, Wifi, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../../integrations/supabase/client';
import {
  fetchCsHistory,
  listCsMessages,
  markCsGroupRead,
  sendCsMessage,
  updateCsGroup,
} from '../../services/consumerSuccess.service';
import type {
  CsGroupRow,
  CsMessageRow,
} from '../../integrations/supabase/database.types';

/**
 * Rede de segurança: a resposta do cliente chega pelo Realtime no instante em
 * que o webhook grava. Este intervalo longo só cobre o caso do socket cair sem
 * o cliente perceber.
 */
const FALLBACK_POLL_MS = 30_000;

function initials(name: string | null): string {
  if (!name) return '#';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  return sameDay
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function CsInbox({
  groups,
  clients,
  onGroupsChanged,
}: {
  groups: CsGroupRow[];
  clients: { id: string; name: string }[];
  onGroupsChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CsMessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyManaged, setOnlyManaged] = useState(true);
  const [live, setLive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const selected = groups.find((group) => group.id === selectedId) ?? null;

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups
      .filter((group) => (onlyManaged ? group.is_managed : true))
      .filter((group) => (term ? (group.name ?? '').toLowerCase().includes(term) : true));
  }, [groups, onlyManaged, search]);

  async function loadMessages(groupId: string, showSpinner = false) {
    if (showSpinner) setLoadingMessages(true);
    try {
      setMessages(await listCsMessages(groupId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as mensagens.');
    } finally {
      if (showSpinner) setLoadingMessages(false);
    }
  }

  // Troca de grupo: carrega o histórico e zera o contador de não-lidas.
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId, true);
    void markCsGroupRead(selectedId).then(onGroupsChanged).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /**
   * Tempo real: o webhook grava a mensagem e o Postgres avisa a tela na hora.
   * A assinatura é montada uma vez e usa `selectedIdRef` pra saber qual grupo
   * está aberto — assim trocar de conversa não derruba e reabre o socket.
   */
  useEffect(() => {
    const channel = supabase
      .channel('cs-inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cs_messages' },
        (payload) => {
          const message = payload.new as CsMessageRow;
          if (message.group_id === selectedIdRef.current) {
            setMessages((current) =>
              current.some((item) => item.id === message.id) ? current : [...current, message]
            );
            void markCsGroupRead(message.group_id).catch(() => undefined);
          }
          onGroupsChanged();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cs_groups' },
        () => onGroupsChanged()
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rede de segurança pra queda de socket — o caminho normal é o Realtime acima.
  useEffect(() => {
    const timer = setInterval(() => {
      if (selectedIdRef.current) void loadMessages(selectedIdRef.current);
      onGroupsChanged();
    }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function handleSend() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendCsMessage(selected.id, draft.trim());
      setDraft('');
      await loadMessages(selected.id);
      onGroupsChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function handleImportHistory() {
    if (!selected || importing) return;
    setImporting(true);
    setError(null);
    try {
      await fetchCsHistory(selected.id, 100);
      await loadMessages(selected.id, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível importar o histórico.');
    } finally {
      setImporting(false);
    }
  }

  async function toggleManaged(group: CsGroupRow) {
    try {
      await updateCsGroup(group.id, { is_managed: !group.is_managed });
      onGroupsChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível atualizar o grupo.');
    }
  }

  async function linkClient(group: CsGroupRow, clientId: string) {
    try {
      await updateCsGroup(group.id, { client_id: clientId || null });
      onGroupsChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível vincular o cliente.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Lista de grupos */}
        <aside className="flex h-[600px] flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
          <div className="border-b border-[var(--color-border)] p-3">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar grupo"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-2 pl-9 pr-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45"
              />
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={onlyManaged}
                onChange={(event) => setOnlyManaged(event.target.checked)}
              />
              Mostrar só os grupos que eu acompanho
            </label>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visibleGroups.length === 0 && (
              <p className="p-4 text-xs text-[var(--color-text-faint)]">
                {onlyManaged
                  ? 'Nenhum grupo marcado como acompanhado ainda. Desmarque o filtro e clique na estrela dos grupos que você atende.'
                  : 'Nenhum grupo encontrado. Sincronize os grupos da Evolution.'}
              </p>
            )}

            {visibleGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => setSelectedId(group.id)}
                className={clsx(
                  'flex w-full items-start gap-3 border-b border-[var(--color-border-soft)] px-3 py-3 text-left transition-colors',
                  group.id === selectedId
                    ? 'bg-[var(--color-brand-soft)]'
                    : 'hover:bg-[var(--color-panel-2)]'
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-panel-2)] text-[11px] font-semibold text-[var(--color-text-muted)]">
                  {initials(group.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[var(--color-text)]">
                      {group.name ?? group.evolution_jid}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-faint)]">
                      {timeLabel(group.last_message_at)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-[var(--color-text-muted)]">
                      {group.last_message_preview ?? 'Sem mensagens ainda'}
                    </span>
                    {group.unread_count > 0 && (
                      <span className="shrink-0 rounded-full bg-[var(--color-brand)] px-1.5 text-[10px] font-semibold text-white">
                        {group.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Conversa */}
        <section className="flex h-[600px] flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]">
          {!selected ? (
            <div className="grid flex-1 place-items-center px-6 text-center text-sm text-[var(--color-text-muted)]">
              Escolha um grupo à esquerda pra ver a conversa e responder sem abrir o celular.
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                    {selected.name ?? selected.evolution_jid}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-faint)]">
                    {selected.participant_count
                      ? `${selected.participant_count} participantes`
                      : selected.evolution_jid}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selected.client_id ?? ''}
                    onChange={(event) => void linkClient(selected, event.target.value)}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[11px] text-[var(--color-text)] outline-none"
                    title="Vincular a um cliente do CRM"
                  >
                    <option value="">Sem cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => void toggleManaged(selected)}
                    title={
                      selected.is_managed
                        ? 'Parar de acompanhar este grupo'
                        : 'Acompanhar este grupo'
                    }
                    className={clsx(
                      'rounded-lg border p-1.5 transition-colors',
                      selected.is_managed
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                        : 'border-[var(--color-border)] text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
                    )}
                  >
                    <Star size={14} fill={selected.is_managed ? 'currentColor' : 'none'} />
                  </button>

                  <span
                    title={
                      live
                        ? 'As respostas do cliente aparecem aqui sozinhas, na hora'
                        : 'Conexão ao vivo caiu — a tela recarrega sozinha a cada 30s'
                    }
                    className={clsx(
                      'flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px]',
                      live ? 'text-emerald-300' : 'text-amber-300'
                    )}
                  >
                    {live ? <Wifi size={13} /> : <WifiOff size={13} />}
                    {live ? 'Ao vivo' : 'Reconectando'}
                  </span>

                  <button
                    onClick={() => void loadMessages(selected.id, true)}
                    title="Atualizar agora"
                    className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {loadingMessages && messages.length === 0 && (
                  <p className="text-xs text-[var(--color-text-faint)]">Carregando mensagens...</p>
                )}
                {!loadingMessages && messages.length === 0 && (
                  <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-dashed border-[var(--color-border)] p-5 text-center">
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Ainda não há mensagens registradas neste grupo. Daqui pra frente, tudo que o
                      cliente responder aparece aqui sozinho — não precisa atualizar nada.
                    </p>
                    <button
                      onClick={() => void handleImportHistory()}
                      disabled={importing}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
                    >
                      {importing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <History size={13} />
                      )}
                      Trazer conversas antigas do WhatsApp
                    </button>
                    <p className="mt-2 text-[10px] text-[var(--color-text-faint)]">
                      Só uma vez, pra puxar o que já estava no grupo antes da conexão.
                    </p>
                  </div>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={clsx('flex', message.from_me ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={clsx(
                        'max-w-[75%] rounded-2xl px-3 py-2',
                        message.from_me
                          ? 'bg-[var(--color-brand)] text-white'
                          : 'bg-[var(--color-panel-2)] text-[var(--color-text)]'
                      )}
                    >
                      {!message.from_me && message.sender_name && (
                        <p className="mb-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                          {message.sender_name}
                        </p>
                      )}
                      {message.media_type && !message.body && (
                        <p className="text-sm italic opacity-80">[{message.media_type}]</p>
                      )}
                      {message.body && (
                        <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                      )}
                      <p
                        className={clsx(
                          'mt-1 text-right text-[10px]',
                          message.from_me ? 'text-white/70' : 'text-[var(--color-text-faint)]'
                        )}
                      >
                        {timeLabel(message.occurred_at)}
                        {message.scheduled_message_id && ' · automática'}
                        {message.status === 'failed' && ' · falhou'}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="flex items-end gap-2 border-t border-[var(--color-border)] p-3">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={2}
                  placeholder="Escreva a mensagem (Enter envia, Shift+Enter quebra linha)"
                  className="flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/45"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={sending || !draft.trim()}
                  className="flex items-center gap-1.5 rounded-xl bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Enviar
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
