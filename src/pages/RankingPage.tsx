import { useEffect, useState } from 'react';
import {
  Trophy,
  Plus,
  Copy,
  Check,
  RefreshCw,
  MonitorPlay,
  Ban,
  CheckCircle2,
  Image as ImageIcon,
  PartyPopper,
} from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import { supabase } from '../integrations/supabase/client';
import {
  listSellers,
  createSeller,
  renameSeller,
  setSellerActive,
  setSellerGoal,
  uploadSellerPhoto,
} from '../services/sellers.service';
import { listSellerRanking, type SellerRankRow } from '../services/crmLeads.service';
import { addPointAdjustment } from '../services/pointAdjustments.service';
import { getRankingSettings, updateRankingSettings } from '../services/rankingSettings.service';
import { getClient, regenerateTelaoToken } from '../services/clients.service';
import type { SellerRow, ClientRow, ClientRankingSettingsRow } from '../integrations/supabase/database.types';
import type { SoundChoice } from '../lib/telaoSounds';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';
import { ArenaPodium } from '../components/comercial/ArenaPodium';
import { SellerRankingList } from '../components/comercial/SellerRankingList';

interface SettingsDraft {
  prizeFirst: string;
  prizeSecond: string;
  prizeThird: string;
  bonusLabel: string;
  soundEnabled: boolean;
  soundChoice: SoundChoice;
  animationEnabled: boolean;
  saleBannerMessage: string;
  panelTitle: string;
  panelSubtitle: string;
  panelLiveBadge: string;
  panelSeasonLabel: string;
  panelBrandSubtitle: string;
  panelCelebrationLabel: string;
  panelFooterText: string;
}

const emptyDraft: SettingsDraft = {
  prizeFirst: '',
  prizeSecond: '',
  prizeThird: '',
  bonusLabel: '',
  soundEnabled: true,
  soundChoice: 'sino',
  animationEnabled: true,
  saleBannerMessage: 'VENDA FECHADA!',
  panelTitle: 'Campeões de vendas',
  panelSubtitle: '1 ponto por venda paga (mais ajustes) • disputa atualizada em tempo real',
  panelLiveBadge: 'RANKING AO VIVO',
  panelSeasonLabel: '',
  panelBrandSubtitle: 'RANKING DE VENDAS',
  panelCelebrationLabel: 'VENDA CONFIRMADA',
  panelFooterText: 'Modo TV ativo',
};

export function RankingPage() {
  const { isAdmin } = useAuth();
  const { project, permissions } = useProject();
  const { dateRange } = useFilters();
  const canManage = isAdmin || permissions.can_edit_settings;

  const [sellers, setSellers] = useState<SellerRow[] | null>(null);
  const [ranking, setRanking] = useState<{ rows: SellerRankRow[]; unassignedSales: number } | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [settings, setSettings] = useState<ClientRankingSettingsRow | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(emptyDraft);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reload() {
    const range = { since: dateRange.start, until: dateRange.end };
    const [sellerRows, rankingResult, clientRow, settingsRow] = await Promise.all([
      listSellers(project.client_id),
      listSellerRanking(project.client_id, range),
      getClient(project.client_id),
      getRankingSettings(project.client_id),
    ]);
    setSellers(sellerRows);
    setRanking(rankingResult);
    setClient(clientRow);
    setSettings(settingsRow);
    setSettingsDraft(
      settingsRow
        ? {
            prizeFirst: settingsRow.prize_first ?? '',
            prizeSecond: settingsRow.prize_second ?? '',
            prizeThird: settingsRow.prize_third ?? '',
            bonusLabel: settingsRow.bonus_label ?? '',
            soundEnabled: settingsRow.sound_enabled,
            soundChoice: settingsRow.sound_choice as SoundChoice,
            animationEnabled: settingsRow.animation_enabled,
            saleBannerMessage: settingsRow.sale_banner_message,
            panelTitle: settingsRow.panel_title,
            panelSubtitle: settingsRow.panel_subtitle,
            panelLiveBadge: settingsRow.panel_live_badge,
            panelSeasonLabel: settingsRow.panel_season_label ?? '',
            panelBrandSubtitle: settingsRow.panel_brand_subtitle,
            panelCelebrationLabel: settingsRow.panel_celebration_label,
            panelFooterText: settingsRow.panel_footer_text,
          }
        : emptyDraft
    );
  }

  useEffect(() => {
    setSellers(null);
    setRanking(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.client_id, dateRange.start, dateRange.end]);

  async function handleAddSeller() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createSeller(project.client_id, name);
      setNewName('');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(seller: SellerRow) {
    setBusy(true);
    try {
      await setSellerActive(seller.id, !seller.active);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  function startRename(seller: SellerRow) {
    setEditingId(seller.id);
    setEditValue(seller.name);
  }

  async function confirmRename(seller: SellerRow) {
    const name = editValue.trim();
    setEditingId(null);
    if (!name || name === seller.name) return;
    setBusy(true);
    try {
      await renameSeller(seller.id, name);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleGoalChange(seller: SellerRow, salesGoal: number) {
    if (Number.isNaN(salesGoal) || salesGoal === seller.sales_goal) return;
    setBusy(true);
    try {
      await setSellerGoal(seller.id, salesGoal);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadPhoto(seller: SellerRow, file: File) {
    setBusy(true);
    try {
      await uploadSellerPhoto(project.client_id, seller.id, file);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(sellerId: string, amount: number, note: string) {
    await addPointAdjustment(sellerId, amount, note);
    await reload();
  }

  async function handleSaveSettings() {
    setBusy(true);
    try {
      setSettings(
        await updateRankingSettings(project.client_id, {
          prize_first: settingsDraft.prizeFirst || null,
          prize_second: settingsDraft.prizeSecond || null,
          prize_third: settingsDraft.prizeThird || null,
          bonus_label: settingsDraft.bonusLabel || null,
          sound_enabled: settingsDraft.soundEnabled,
          sound_choice: settingsDraft.soundChoice,
          animation_enabled: settingsDraft.animationEnabled,
          sale_banner_message: settingsDraft.saleBannerMessage,
          panel_title: settingsDraft.panelTitle,
          panel_subtitle: settingsDraft.panelSubtitle,
          panel_live_badge: settingsDraft.panelLiveBadge,
          panel_season_label: settingsDraft.panelSeasonLabel || null,
          panel_brand_subtitle: settingsDraft.panelBrandSubtitle,
          panel_celebration_label: settingsDraft.panelCelebrationLabel,
          panel_footer_text: settingsDraft.panelFooterText,
        })
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateTelao() {
    setBusy(true);
    try {
      setClient(await regenerateTelaoToken(project.client_id));
    } finally {
      setBusy(false);
    }
  }

  function copyTelaoLink() {
    if (!client?.telao_token) return;
    navigator.clipboard.writeText(`${window.location.origin}/telao/${client.telao_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  /**
   * Dispara um evento de venda fake no mesmo canal Realtime que o telão
   * escuta — testa a animação/som ao vivo sem criar nenhuma venda real
   * (não grava nada em `sales`, não mexe no ranking).
   */
  async function handleSendTestSale() {
    if (!client?.telao_token) return;
    const channel = supabase.channel(`telao:${client.telao_token}`);
    await channel.send({
      type: 'broadcast',
      event: 'sale',
      payload: { sellerName: 'Teste', amount: 999 },
    });
    supabase.removeChannel(channel);
  }

  if (sellers === null || ranking === null) return <LoadingView label="Carregando ranking..." />;

  const prizes = {
    first: settings?.prize_first ?? null,
    second: settings?.prize_second ?? null,
    third: settings?.prize_third ?? null,
    bonusLabel: settings?.bonus_label ?? null,
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Ranking de Vendedores — {project.name}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          1 ponto por venda paga no período (mais ajustes manuais) — soma todos os projetos do cliente
        </p>
      </div>

      {ranking.unassignedSales > 0 && (
        <p className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">
          {ranking.unassignedSales} venda{ranking.unassignedSales > 1 ? 's' : ''} paga
          {ranking.unassignedSales > 1 ? 's' : ''} no período sem vendedor atribuído. Atribua em Leads &gt; Vendas.
        </p>
      )}

      <Card title="Pódio">
        <ArenaPodium rows={ranking.rows} prizes={prizes} />
      </Card>

      <Card title="Ranking completo">
        <SellerRankingList rows={ranking.rows} canManage={canManage} onAdjust={canManage ? handleAdjust : undefined} />
      </Card>

      <Card
        title="Vendedores"
        action={
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-faint)]">
            <Trophy size={12} /> {sellers.length} cadastrado{sellers.length !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex flex-col gap-2">
          {sellers.map((seller) => (
            <div key={seller.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2">
              {editingId === seller.id ? (
                <>
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-sm text-[var(--color-text)]"
                  />
                  <button
                    onClick={() => confirmRename(seller)}
                    disabled={busy}
                    className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-good)] disabled:opacity-50"
                  >
                    Salvar
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)]"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span
                    className={
                      'flex-1 text-sm ' +
                      (seller.active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)] line-through')
                    }
                  >
                    {seller.name}
                  </span>
                  {canManage && (
                    <>
                      <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                        <ImageIcon size={12} /> Foto
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleUploadPhoto(seller, file);
                          }}
                        />
                      </label>
                      <input
                        type="number"
                        min={0}
                        defaultValue={seller.sales_goal}
                        key={`${seller.id}-${seller.sales_goal}`}
                        onBlur={(e) => void handleGoalChange(seller, Number(e.target.value))}
                        title="Meta de vendas no período"
                        className="w-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-right text-xs text-[var(--color-text)]"
                      />
                      <button
                        onClick={() => startRename(seller)}
                        disabled={busy}
                        className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
                      >
                        Renomear
                      </button>
                      <button
                        onClick={() => handleToggleActive(seller)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
                      >
                        {seller.active ? <Ban size={12} /> : <CheckCircle2 size={12} />}
                        {seller.active ? 'Desativar' : 'Ativar'}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
          {sellers.length === 0 && (
            <p className="text-xs text-[var(--color-text-faint)]">Nenhum vendedor cadastrado para este cliente.</p>
          )}

          {canManage && (
            <div className="mt-2 flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome do novo vendedor"
                className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)]"
              />
              <button
                onClick={handleAddSeller}
                disabled={busy || !newName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                <Plus size={14} /> Adicionar
              </button>
            </div>
          )}
        </div>
      </Card>

      {canManage && (
        <Card title="Prêmios e Telão">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                🥇 1º lugar
                <input
                  value={settingsDraft.prizeFirst}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, prizeFirst: e.target.value }))}
                  placeholder="ex: Bônus R$ 500"
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                🥈 2º lugar
                <input
                  value={settingsDraft.prizeSecond}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, prizeSecond: e.target.value }))}
                  placeholder="ex: Bônus R$ 250"
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                🥉 3º lugar
                <input
                  value={settingsDraft.prizeThird}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, prizeThird: e.target.value }))}
                  placeholder="ex: Vale-presente"
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              Faixa de destaque (topo do pódio)
              <input
                value={settingsDraft.bonusLabel}
                onChange={(e) => setSettingsDraft((p) => ({ ...p, bonusLabel: e.target.value }))}
                placeholder="ex: 2X Comissão Dobrada"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
              />
            </label>

            <div className="flex flex-wrap items-center gap-4 border-t border-[var(--color-border)] pt-3">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={settingsDraft.soundEnabled}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, soundEnabled: e.target.checked }))}
                />
                Som ao vivo no telão
              </label>
              <select
                value={settingsDraft.soundChoice}
                onChange={(e) => setSettingsDraft((p) => ({ ...p, soundChoice: e.target.value as SoundChoice }))}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
              >
                <option value="sino">Sino</option>
                <option value="aplausos">Aplausos</option>
                <option value="caixa">Caixa registradora</option>
                <option value="vitoria">Fanfarra de vitória</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={settingsDraft.animationEnabled}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, animationEnabled: e.target.checked }))}
                />
                Animação de venda
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
              Mensagem da faixa de venda (telão)
              <input
                value={settingsDraft.saleBannerMessage}
                onChange={(e) => setSettingsDraft((p) => ({ ...p, saleBannerMessage: e.target.value }))}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
              />
            </label>

            <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
              <p className="text-xs font-medium text-[var(--color-text)]">Textos do telão</p>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Título principal
                <input
                  value={settingsDraft.panelTitle}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, panelTitle: e.target.value }))}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Subtítulo
                <input
                  value={settingsDraft.panelSubtitle}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, panelSubtitle: e.target.value }))}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Selo "ao vivo"
                  <input
                    value={settingsDraft.panelLiveBadge}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, panelLiveBadge: e.target.value }))}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Selo de temporada
                  <input
                    value={settingsDraft.panelSeasonLabel}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, panelSeasonLabel: e.target.value }))}
                    placeholder={`TEMPORADA ${new Date().getFullYear()} (padrão)`}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Texto sob o nome do cliente
                <input
                  value={settingsDraft.panelBrandSubtitle}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, panelBrandSubtitle: e.target.value }))}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Selo da celebração
                  <input
                    value={settingsDraft.panelCelebrationLabel}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, panelCelebrationLabel: e.target.value }))}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Texto do rodapé
                  <input
                    value={settingsDraft.panelFooterText}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, panelFooterText: e.target.value }))}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                  />
                </label>
              </div>
            </div>

            <button
              onClick={handleSaveSettings}
              disabled={busy}
              className="flex w-fit items-center gap-1.5 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Salvar configurações
            </button>

            <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
              <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <MonitorPlay size={12} />
                Link do telão: {client?.telao_active ? 'ativo' : 'não gerado'}
              </div>
              {client?.telao_active && client.telao_token && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-text)]">
                    {window.location.origin}/telao/{client.telao_token}
                  </code>
                  <button
                    onClick={copyTelaoLink}
                    title="Copiar link"
                    className="shrink-0 rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
                  >
                    {copied ? <Check size={14} className="text-[var(--color-good)]" /> : <Copy size={14} />}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleGenerateTelao}
                  disabled={busy}
                  className="flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)] disabled:opacity-50"
                >
                  <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
                  {client?.telao_active ? 'Regenerar link' : 'Gerar link do telão'}
                </button>
                <button
                  onClick={handleSendTestSale}
                  disabled={!client?.telao_active}
                  title={
                    client?.telao_active
                      ? 'Dispara a animação/som no telão agora, sem criar venda real'
                      : 'Gere o link do telão antes de testar'
                  }
                  className="flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)] disabled:opacity-50"
                >
                  <PartyPopper size={14} />
                  Enviar venda de teste
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
