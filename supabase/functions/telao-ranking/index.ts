// Edge Function: telao-ranking
//
// Endpoint público (sem login) que devolve o ranking de vendedores de um
// cliente para exibição num telão/TV compartilhado, junto com prêmios e
// configurações de som/animação. Protegido por um token opaco por cliente
// (clients.telao_token) — nunca por login. Nunca expõe tabelas cruas, nem
// project_id/client_id — só nome, foto, pontos, receita e meta por
// vendedor (o mesmo formato usado pela tela logada de ranking).
//
// GET /functions/v1/telao-ranking?token=...&since=YYYY-MM-DD&until=YYYY-MM-DD
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

interface RankRow {
  sellerId: string;
  name: string;
  photoUrl: string | null;
  points: number;
  revenue: number;
  salesGoal: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  if (!token || !since || !until) return json({ error: 'missing_params' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: client } = await admin
    .from('clients')
    .select('id, name')
    .eq('telao_token', token)
    .eq('telao_active', true)
    .maybeSingle();

  if (!client) return json({ error: 'invalid_token' }, 404);

  const { data: projectRows, error: projectError } = await admin
    .from('projects')
    .select('id')
    .eq('client_id', client.id);
  if (projectError) return json({ error: projectError.message }, 500);
  const projectIds = (projectRows ?? []).map((p) => p.id as string);

  const { data: sellerRows, error: sellerError } = await admin
    .from('sellers')
    .select('id, name, active, photo_url, sales_goal')
    .eq('client_id', client.id);
  if (sellerError) return json({ error: sellerError.message }, 500);
  const sellerIds = (sellerRows ?? []).map((s) => s.id as string);

  let saleRows: { seller_id: string | null; amount: number | null }[] = [];
  if (projectIds.length > 0) {
    const { data, error: saleError } = await admin
      .from('sales')
      .select('seller_id, amount')
      .in('project_id', projectIds)
      .eq('status', 'PAID')
      .gte('sold_at', since)
      .lte('sold_at', `${until}T23:59:59`);
    if (saleError) return json({ error: saleError.message }, 500);
    saleRows = data ?? [];
  }

  let adjustmentRows: { seller_id: string; amount: number }[] = [];
  if (sellerIds.length > 0) {
    const { data, error: adjustmentError } = await admin
      .from('seller_point_adjustments')
      .select('seller_id, amount')
      .in('seller_id', sellerIds)
      .gte('created_at', since)
      .lte('created_at', `${until}T23:59:59`);
    if (adjustmentError) return json({ error: adjustmentError.message }, 500);
    adjustmentRows = data ?? [];
  }

  const byId = new Map<string, RankRow>();
  for (const s of sellerRows ?? []) {
    if (s.active) {
      byId.set(s.id, {
        sellerId: s.id,
        name: s.name,
        photoUrl: s.photo_url,
        points: 0,
        revenue: 0,
        salesGoal: s.sales_goal,
      });
    }
  }

  function findOrCreate(sellerId: string): RankRow | null {
    let row = byId.get(sellerId);
    if (row) return row;
    const seller = (sellerRows ?? []).find((s) => s.id === sellerId);
    if (!seller) return null;
    row = {
      sellerId: seller.id,
      name: seller.name,
      photoUrl: seller.photo_url,
      points: 0,
      revenue: 0,
      salesGoal: seller.sales_goal,
    };
    byId.set(seller.id, row);
    return row;
  }

  for (const sale of saleRows) {
    if (!sale.seller_id) continue;
    const row = findOrCreate(sale.seller_id);
    if (!row) continue;
    row.points += 1;
    row.revenue += sale.amount ?? 0;
  }
  for (const adj of adjustmentRows) {
    const row = findOrCreate(adj.seller_id);
    if (row) row.points += adj.amount;
  }

  const rows = Array.from(byId.values())
    .map((r) => ({ ...r, points: Math.max(0, r.points) }))
    .sort((a, b) => b.points - a.points || b.revenue - a.revenue);

  const { data: settingsRow } = await admin
    .from('client_ranking_settings')
    .select('*')
    .eq('client_id', client.id)
    .maybeSingle();

  return json({
    clientName: client.name,
    rows,
    prizes: {
      first: settingsRow?.prize_first ?? null,
      second: settingsRow?.prize_second ?? null,
      third: settingsRow?.prize_third ?? null,
      bonusLabel: settingsRow?.bonus_label ?? null,
    },
    settings: {
      soundEnabled: settingsRow?.sound_enabled ?? true,
      soundChoice: settingsRow?.sound_choice ?? 'sino',
      animationEnabled: settingsRow?.animation_enabled ?? true,
      saleBannerMessage: settingsRow?.sale_banner_message ?? 'VENDA FECHADA!',
    },
    texts: {
      title: settingsRow?.panel_title ?? 'Campeões de vendas',
      subtitle:
        settingsRow?.panel_subtitle ??
        '1 ponto por venda paga (mais ajustes) • disputa atualizada em tempo real',
      liveBadge: settingsRow?.panel_live_badge ?? 'RANKING AO VIVO',
      seasonLabel: settingsRow?.panel_season_label ?? null,
      brandSubtitle: settingsRow?.panel_brand_subtitle ?? 'RANKING DE VENDAS',
      celebrationLabel: settingsRow?.panel_celebration_label ?? 'VENDA CONFIRMADA',
      footerText: settingsRow?.panel_footer_text ?? 'Modo TV ativo',
    },
  });
});
