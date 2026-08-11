import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Volume2 } from 'lucide-react';
import { supabase } from '../../integrations/supabase/client';
import { formatBRL } from '../../lib/format';
import { playTelaoSound, unlockAudio, type SoundChoice } from '../../lib/telaoSounds';
import { Avatar } from '../../components/comercial/Avatar';
import { ArenaPodium, type RankingPrizes } from '../../components/comercial/ArenaPodium';
import type { SellerRankRow } from '../../services/crmLeads.service';

const FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/functions/v1`;
const POLL_MS = 60_000;
const CELEBRATION_MS = 6000;
const CONFETTI_COLORS = ['#22e6e6', '#ffd04e', '#ff554f', '#fff', '#4c7dff', '#35efb5'];

interface TelaoSettings {
  soundEnabled: boolean;
  soundChoice: SoundChoice;
  animationEnabled: boolean;
  saleBannerMessage: string;
}

interface TelaoTexts {
  title: string;
  subtitle: string;
  liveBadge: string;
  seasonLabel: string | null;
  brandSubtitle: string;
  celebrationLabel: string;
  footerText: string;
}

const defaultSettings: TelaoSettings = {
  soundEnabled: true,
  soundChoice: 'sino',
  animationEnabled: true,
  saleBannerMessage: 'VENDA FECHADA!',
};

const defaultTexts: TelaoTexts = {
  title: 'Campeões de vendas',
  subtitle: '1 ponto por venda paga (mais ajustes) • disputa atualizada em tempo real',
  liveBadge: 'RANKING AO VIVO',
  seasonLabel: null,
  brandSubtitle: 'RANKING DE VENDAS',
  celebrationLabel: 'VENDA CONFIRMADA',
  footerText: 'Modo TV ativo',
};

// Telão sempre mostra o mês corrente — não tem UI de filtro (é uma tela
// sem interação, só leitura, feita pra ficar ligada numa TV).
function currentMonthRange() {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const until = now.toISOString().slice(0, 10);
  return { since, until };
}

function Confetti() {
  const pieces = Array.from({ length: 130 }, (_, i) => ({
    left: (i * 47) % 100,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: -((i % 17) * 0.18),
    duration: 2.2 + (i % 7) * 0.18,
    rotate: (i * 37) % 360,
  }));
  return (
    <div className="va-confetti">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export function TelaoPage() {
  const { token } = useParams();
  const [clientName, setClientName] = useState<string | null>(null);
  const [rows, setRows] = useState<SellerRankRow[] | null>(null);
  const [prizes, setPrizes] = useState<RankingPrizes>({ first: null, second: null, third: null, bonusLabel: null });
  const [settings, setSettings] = useState<TelaoSettings>(defaultSettings);
  const [texts, setTexts] = useState<TelaoTexts>(defaultTexts);
  const [error, setError] = useState<string | null>(null);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const [celebration, setCelebration] = useState<{ sellerName: string; amount: number } | null>(null);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const soundUnlockedRef = useRef(soundUnlocked);
  useEffect(() => {
    soundUnlockedRef.current = soundUnlocked;
  }, [soundUnlocked]);

  useEffect(() => {
    if (!token) return;
    let active = true;

    async function load() {
      const { since, until } = currentMonthRange();
      try {
        const res = await fetch(
          `${FUNCTIONS_URL}/telao-ranking?token=${encodeURIComponent(token!)}&since=${since}&until=${until}`
        );
        const body = await res.json();
        if (!active) return;
        if (!res.ok) {
          setError('Link inválido ou expirado.');
          return;
        }
        setError(null);
        setClientName(body.clientName);
        setRows(body.rows);
        setPrizes(body.prizes);
        setSettings(body.settings);
        setTexts(body.texts);
      } catch {
        if (active) setError('Não foi possível carregar o ranking agora.');
      }
    }

    void load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const channel = supabase.channel(`telao:${token}`);
    channel
      .on('broadcast', { event: 'sale' }, ({ payload }) => {
        const sellerName = typeof payload?.sellerName === 'string' ? payload.sellerName : 'Vendedor';
        const amount = typeof payload?.amount === 'number' ? payload.amount : 0;

        if (settingsRef.current.animationEnabled) {
          setCelebration({ sellerName, amount });
          setTimeout(() => setCelebration(null), CELEBRATION_MS);
        }
        if (settingsRef.current.soundEnabled && soundUnlockedRef.current) {
          playTelaoSound(settingsRef.current.soundChoice);
        }

        const { since, until } = currentMonthRange();
        void fetch(`${FUNCTIONS_URL}/telao-ranking?token=${encodeURIComponent(token)}&since=${since}&until=${until}`)
          .then((res) => res.json())
          .then((body) => {
            setClientName(body.clientName);
            setRows(body.rows);
            setPrizes(body.prizes);
            setSettings(body.settings);
            setTexts(body.texts);
          })
          .catch(() => {});
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [token]);

  function activateSound() {
    unlockAudio();
    setSoundUnlocked(true);
  }

  if (error) {
    return (
      <div className="va-arena flex min-h-screen items-center justify-center text-center">
        <p className="text-lg">{error}</p>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="va-arena flex min-h-screen items-center justify-center">
        <p className="text-lg">Carregando ranking...</p>
      </div>
    );
  }

  const winnerRow = celebration ? rows.find((r) => r.name === celebration.sellerName) : null;
  const seasonLabel = texts.seasonLabel ?? `TEMPORADA ${new Date().getFullYear()}`;

  return (
    <div className="va-arena">
      <div className="va-ray va-r1" />
      <div className="va-ray va-r2" />

      {!soundUnlocked && (
        <button
          onClick={activateSound}
          className="fixed right-6 top-6 z-40 flex items-center gap-2 rounded-full bg-[#f5c451] px-4 py-2 text-sm font-semibold text-[#0a0b0f] shadow-lg"
        >
          <Volume2 size={16} /> Ativar som
        </button>
      )}

      <header className="va-header">
        <div className="va-brand">
          <span className="va-brand-logo">
            <b>{(clientName ?? '?').charAt(0).toUpperCase()}</b>
          </span>
          <div>
            <strong>{clientName}</strong>
            <small>{texts.brandSubtitle}</small>
          </div>
        </div>
        <div className="va-live">
          <i /> {texts.liveBadge}
        </div>
      </header>

      <section className="va-title">
        <span className="va-season">{seasonLabel}</span>
        <h1>{texts.title}</h1>
        <p>{texts.subtitle}</p>
      </section>

      <ArenaPodium rows={rows} prizes={prizes} winnerId={winnerRow?.sellerId ?? null} />

      {rows.length > 3 && (
        <div className="va-rest">
          {rows.slice(3).map((row, i) => (
            <div key={row.sellerId} className="va-rest-row">
              <span className="va-rest-place">{i + 4}</span>
              <Avatar name={row.name} photoUrl={row.photoUrl} size={32} />
              <span className="flex-1 text-sm font-medium text-white/90">{row.name}</span>
              <span className="text-sm font-bold text-white">{row.points} pts</span>
              <span className="text-xs text-white/50">{formatBRL(row.revenue)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="va-footer">
        {texts.footerText}{' '}
        <span className="va-sound-note">
          • {soundUnlocked ? 'som ativado' : 'clique em "Ativar som" para ouvir as comemorações'}
        </span>
      </div>

      {celebration && (
        <div className="va-celebration">
          <div className="va-flash-overlay" />
          <Confetti />
          <div className="va-alert">
            <div className="va-ok">✓</div>
            <small>{texts.celebrationLabel}</small>
            <h2>{settings.saleBannerMessage}</h2>
            <p className="mt-1 text-lg font-semibold">{celebration.sellerName}</p>
            <b>{formatBRL(celebration.amount)}</b>
          </div>
        </div>
      )}
    </div>
  );
}
