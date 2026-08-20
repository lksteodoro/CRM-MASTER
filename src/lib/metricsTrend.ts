import type {
  MetaAdInsightDailyRow,
  LeadEventRow,
  SaleRow,
  MetaEntityRow,
} from '../integrations/supabase/database.types';
import { realProjectRollup, type RealRollup } from './realRollups';
import { computeCrmLeadStats } from '../services/crmLeads.service';
import type { MetaAdsManagerMetrics } from '../services/metaAds.service';

export interface PeriodData {
  rollup: RealRollup;
  totalLeads: number;
  uniqueLeads: number;
  salesCount: number;
  revenue: number;
}

export function computePeriodData(
  adInsights: MetaAdInsightDailyRow[],
  leadEvents: LeadEventRow[],
  sales: SaleRow[],
  metaSummary?: MetaAdsManagerMetrics | null
): PeriodData {
  const stats = computeCrmLeadStats(leadEvents, sales);
  const fallbackRollup = realProjectRollup(adInsights);
  const rollup = metaSummary
    ? {
        spend: metaSummary.spend,
        leadsCount: metaSummary.leads,
        impressions: metaSummary.impressions,
        clicks: metaSummary.clicks,
        linkClicks: metaSummary.link_clicks,
        reach: metaSummary.reach,
        cpl: metaSummary.leads > 0 ? metaSummary.spend / metaSummary.leads : 0,
        ctr: metaSummary.ctr,
        cpc: metaSummary.cpc,
        cpm: metaSummary.cpm,
        frequency: metaSummary.frequency,
      }
    : fallbackRollup;
  return {
    rollup,
    totalLeads: stats.totalLeads,
    uniqueLeads: stats.uniqueContacts,
    salesCount: stats.sales,
    revenue: stats.revenue,
  };
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  spend: number;
  /** Leads que a Meta reportou como evento de conversão (actions.lead), por dia. */
  metaLeads: number;
  /** Toda entrada recebida via webhook nesse dia — a mesma pessoa pode aparecer mais de uma vez. */
  leadsReceived: number;
  /**
   * Contatos novos no CRM real nesse dia — cada pessoa conta só no dia da
   * primeira entrada dela dentro do período consultado (sem duplicar
   * reentradas do mesmo contato em dias diferentes).
   */
  uniqueLeadsReceived: number;
  sales: number;
  revenue: number;
}

/** Agrega insights de mídia + eventos de CRM (leads/vendas) por dia. */
export function buildDailySeries(
  adInsights: MetaAdInsightDailyRow[],
  leadEvents: LeadEventRow[],
  sales: SaleRow[]
): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();

  function point(date: string): DailyPoint {
    let p = byDate.get(date);
    if (!p) {
      p = {
        date,
        impressions: 0,
        clicks: 0,
        spend: 0,
        metaLeads: 0,
        leadsReceived: 0,
        uniqueLeadsReceived: 0,
        sales: 0,
        revenue: 0,
      };
      byDate.set(date, p);
    }
    return p;
  }

  for (const r of adInsights) {
    const p = point(r.date);
    p.impressions += r.impressions;
    p.clicks += r.clicks;
    p.spend += Number(r.spend);
    p.metaLeads += r.leads;
  }
  for (const e of leadEvents) {
    point(e.occurred_at.slice(0, 10)).leadsReceived += 1;
  }

  // Primeira entrada de cada contato dentro do período — é isso que conta
  // como "lead único" naquele dia, pra não duplicar reentradas da mesma
  // pessoa em dias diferentes.
  const firstSeenByContact = new Map<string, string>();
  for (const e of leadEvents) {
    const day = e.occurred_at.slice(0, 10);
    const seen = firstSeenByContact.get(e.contact_id);
    if (!seen || day < seen) firstSeenByContact.set(e.contact_id, day);
  }
  for (const day of firstSeenByContact.values()) {
    point(day).uniqueLeadsReceived += 1;
  }

  for (const s of sales) {
    const p = point(s.sold_at.slice(0, 10));
    p.sales += 1;
    p.revenue += s.amount ?? 0;
  }

  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface AdTimelineRow {
  id: string;
  name: string;
  campaignName: string;
  firstDate: string;
  lastDate: string;
  /** null = status real desconhecido (meta_entities ainda não sincronizado pra este anúncio). */
  status: string | null;
  totalLeads: number;
  dailyLeads: { date: string; leads: number }[];
}

/**
 * Monta o período "ativo" de cada anúncio pro Gantt.
 *
 * TODO(dados reais): a Meta Ads API tem `created_time`/`start_time` no
 * objeto do anúncio, mas nossa sincronização hoje não busca nem guarda
 * isso (nem em `meta_entities` nem em `meta_ad_insights_daily`). Até isso
 * existir, usamos o primeiro e o último dia com métrica registrada dentro
 * do período filtrado como proxy — é dado real, mas representa "quando
 * gerou métrica nesta janela", não o início/fim de verdade do anúncio.
 */
export function buildAdTimeline(adInsights: MetaAdInsightDailyRow[], entities: MetaEntityRow[]): AdTimelineRow[] {
  const byAd = new Map<string, MetaAdInsightDailyRow[]>();
  for (const r of adInsights) {
    const list = byAd.get(r.ad_id) ?? [];
    list.push(r);
    byAd.set(r.ad_id, list);
  }

  const statusByAdId = new Map(
    entities.filter((e) => e.entity_type === 'ad').map((e) => [e.external_id, e.status])
  );

  return Array.from(byAd.entries()).map(([adId, rows]) => {
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
    const leadsByDate = new Map<string, number>();
    let totalLeads = 0;
    for (const r of rows) {
      leadsByDate.set(r.date, (leadsByDate.get(r.date) ?? 0) + r.leads);
      totalLeads += r.leads;
    }
    return {
      id: adId,
      name: sorted[0].ad_name,
      campaignName: sorted[0].campaign_name,
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
      status: statusByAdId.get(adId) ?? null,
      totalLeads,
      dailyLeads: Array.from(leadsByDate.entries())
        .map(([date, leads]) => ({ date, leads }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  });
}
