import type { SellerRankRow } from '../../services/crmLeads.service';
import { Avatar } from './Avatar';
import { formatBRL } from '../../lib/format';
import './arena.css';

export interface RankingPrizes {
  first: string | null;
  second: string | null;
  third: string | null;
  bonusLabel: string | null;
}

const rankStyle = [
  { accent: '#ffd04e', label: '★', placeLabel: '1º LUGAR' },
  { accent: '#22e6e6', label: '2º', placeLabel: '2º LUGAR' },
  { accent: '#ff554f', label: '3º', placeLabel: '3º LUGAR' },
];

// Ordem de exibição no DOM: 2º, 1º, 3º (pódio clássico com o 1º no centro).
const displayOrder = [1, 0, 2];

export function ArenaPodium({
  rows,
  prizes,
  winnerId,
}: {
  rows: SellerRankRow[];
  prizes: RankingPrizes;
  winnerId?: string | null;
}) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) {
    return <p className="text-center text-sm text-white/50">Sem vendas no período para montar o pódio.</p>;
  }
  const prizeByRank = [prizes.first, prizes.second, prizes.third];

  return (
    <section className="va-podium">
      {displayOrder.map((rankIdx) => {
        const row = top3[rankIdx];
        if (!row) return <div key={rankIdx} />;
        const style = rankStyle[rankIdx];
        const isFirst = rankIdx === 0;
        const prize = prizeByRank[rankIdx];

        return (
          <article
            key={row.sellerId}
            className={`va-player${winnerId === row.sellerId ? ' va-winner' : ''}`}
            data-place={String(rankIdx + 1)}
            style={{ ['--accent' as string]: style.accent }}
          >
            <div className="va-reward">
              <div className="va-round">{isFirst ? '★' : `${rankIdx + 1}º`}</div>
              {prize && <small>{prize}</small>}
              <i className="va-diamond" />
            </div>
            <div className="va-shield-wrap">
              <div className="va-wings" />
              <div className="va-shield-edge">
                <div className="va-shield">
                  <div className="va-avatar-wrap">
                    <Avatar name={row.name} photoUrl={row.photoUrl} size={isFirst ? 72 : 58} accentColor={style.accent} />
                  </div>
                  <h2>{row.name}</h2>
                  <div className="va-score">
                    <b>{row.points} PTS</b>
                    {formatBRL(row.revenue)}
                  </div>
                  <span className="va-place-label">{style.placeLabel}</span>
                </div>
              </div>
            </div>
            <div className="va-base" />
          </article>
        );
      })}
    </section>
  );
}
