# Ranking Visual + Tempo Real Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar o ranking de vendedores (pódio + lista) com fotos, metas, prêmios e ajuste manual auditado, e fazer o telão público reagir em tempo real a vendas novas com animação e som configuráveis.

**Architecture:** Continuação de `docs/superpowers/plans/2026-08-10-ranking-vendedores-telao.md` (já implementado). Adiciona colunas/tabelas novas no Supabase, um bucket de Storage pra fotos, e Realtime Broadcast — o `webhook-sales` publica um evento via REST quando uma venda com vendedor entra, e o telão escuta esse evento (sem precisar de RLS de leitura em `sales`, que exigiria login).

**Tech Stack:** Mesmo do plano anterior — React 19 + TypeScript + Vite + react-router-dom, Supabase Postgres + RLS + Storage + Realtime Broadcast + Edge Functions/Deno. Projeto Supabase: `ibtdjnbefsltgguoopih`. Sem testes automatizados nem git nesta pasta — verificação é manual.

## Global Constraints

- Token do telão: 8 caracteres alfanuméricos (curto, mas ainda secreto) — troca a geração atual de 128 caracteres hex.
- Foto de vendedor: upload opcional via Supabase Storage, bucket público `seller-photos`, caminho `<client_id>/<seller_id>.<ext>`. Sem foto, cai nas iniciais.
- Meta por vendedor: quantidade de vendas no período (mesma unidade dos pontos), não receita.
- Prêmios (1º/2º/3º) e faixa de bônus: texto livre, por cliente, em `client_ranking_settings`.
- Pontos = vendas pagas no período **mais** soma de `seller_point_adjustments` no período. Nunca exibe total negativo (piso em 0), mas o ledger guarda o valor real.
- `seller_point_adjustments` é imutável: só INSERT e SELECT, nunca UPDATE/DELETE.
- Tempo real via Realtime **Broadcast** (REST, não Postgres Changes) — canal `telao:<telao_token>`. `webhook-sales` publica; telão assina. Nunca dar RLS de leitura anônima em `sales`.
- Som: sintetizado no navegador via Web Audio API (sino/aplausos/caixa) — nunca baixar arquivo de áudio externo.
- Autoplay de áudio: telão mostra um botão "Ativar som" na primeira carga antes de tocar qualquer som.
- Comercial > Ranking (logada) e Telão (pública) reaproveitam os **mesmos** componentes de pódio/lista — o telão só passa `canManage={false}` e não fornece `onAdjust`.
- A Edge Function pública `telao-ranking` nunca expõe nada além de `{ clientName, rows, prizes, settings }` — sem token de webhook, sem IDs de projeto/cliente.

Spec completa: [`docs/superpowers/specs/2026-08-10-ranking-visual-tempo-real-design.md`](../specs/2026-08-10-ranking-visual-tempo-real-design.md)

---

## Task 1: Migration — fotos, metas, prêmios, ajuste manual, Storage

**Files:**
- Create: `supabase/migrations/0013_ranking_visual_realtime.sql`
- Modify: `src/integrations/supabase/database.types.ts`

**Interfaces:**
- Produces: `sellers.photo_url text null`, `sellers.sales_goal integer not null default 0`; tabela `client_ranking_settings` (`id, client_id, prize_first, prize_second, prize_third, bonus_label, sound_enabled, sound_choice, animation_enabled, sale_banner_message, created_at, updated_at`); tabela `seller_point_adjustments` (`id, seller_id, amount, note, created_by, created_at`); bucket `seller-photos`; tipos TS `ClientRankingSettingsRow`, `SellerPointAdjustmentRow`.

- [ ] **Step 1: Criar a migration**

```sql
-- =============================================================================
-- 0013 — Ranking visual (fotos, metas, prêmios) + ajuste manual auditado
--
-- sellers.photo_url / sales_goal: personalização visual e meta de vendas
-- (quantidade) por vendedor, usada na barra de progresso do ranking.
--
-- client_ranking_settings: configuração por cliente do "espetáculo" do
-- ranking — prêmios por posição, faixa de bônus, e as opções de
-- som/animação do telão (que o telão, sendo público, só consegue ler por
-- aqui, já que não tem sessão logada).
--
-- seller_point_adjustments: ledger imutável de correções/bônus manuais de
-- pontos — nunca sobrescreve, cada lançamento fica registrado (quem,
-- quando, quanto, motivo). Sem UPDATE/DELETE liberado pra ninguém, mesmo
-- espírito de audit_logs.
--
-- Bucket seller-photos: primeiro uso de Storage neste projeto. Público pra
-- leitura (foto não é dado sensível); escrita só por quem já gerencia
-- vendedores do cliente dono do arquivo.
-- =============================================================================

alter table public.sellers
  add column photo_url text,
  add column sales_goal integer not null default 0;

create table public.client_ranking_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  prize_first text,
  prize_second text,
  prize_third text,
  bonus_label text,
  sound_enabled boolean not null default true,
  sound_choice text not null default 'sino' check (sound_choice in ('sino', 'aplausos', 'caixa')),
  animation_enabled boolean not null default true,
  sale_banner_message text not null default 'VENDA FECHADA!',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seller_point_adjustments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  amount integer not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_seller_point_adjustments_seller on public.seller_point_adjustments (seller_id, created_at);

alter table public.client_ranking_settings enable row level security;
alter table public.seller_point_adjustments enable row level security;

create policy client_ranking_settings_select on public.client_ranking_settings
  for select to authenticated
  using (private.is_admin() or private.has_client_access(client_id));

create policy client_ranking_settings_write on public.client_ranking_settings
  for all to authenticated
  using (private.is_admin() or private.has_client_edit_settings(client_id))
  with check (private.is_admin() or private.has_client_edit_settings(client_id));

create policy seller_point_adjustments_select on public.seller_point_adjustments
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.sellers s
       where s.id = seller_point_adjustments.seller_id
         and private.has_client_access(s.client_id)
    )
  );

create policy seller_point_adjustments_insert on public.seller_point_adjustments
  for insert to authenticated
  with check (
    private.is_admin()
    or exists (
      select 1 from public.sellers s
       where s.id = seller_point_adjustments.seller_id
         and private.has_client_edit_settings(s.client_id)
    )
  );

insert into storage.buckets (id, name, public)
values ('seller-photos', 'seller-photos', true)
on conflict (id) do nothing;

create policy seller_photos_public_read on storage.objects
  for select to public
  using (bucket_id = 'seller-photos');

create policy seller_photos_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'seller-photos'
    and (private.is_admin() or private.has_client_edit_settings(((storage.foldername(name))[1])::uuid))
  )
  with check (
    bucket_id = 'seller-photos'
    and (private.is_admin() or private.has_client_edit_settings(((storage.foldername(name))[1])::uuid))
  );
```

- [ ] **Step 2: Aplicar via MCP**

Use `apply_migration` com `project_id: "ibtdjnbefsltgguoopih"`, `name: "ranking_visual_realtime"`, `query` = conteúdo acima.

- [ ] **Step 3: Verificar**

```sql
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'sellers' and column_name in ('photo_url','sales_goal'))
   or (table_name in ('client_ranking_settings','seller_point_adjustments')))
order by table_name, column_name;

select id, public from storage.buckets where id = 'seller-photos';

select tablename, policyname, cmd from pg_policies
where schemaname in ('public','storage') and tablename in ('client_ranking_settings','seller_point_adjustments','objects')
order by tablename, policyname;
```

Expected: colunas/tabelas presentes; bucket com `public = true`; policies `client_ranking_settings_select`/`_write`, `seller_point_adjustments_select`/`_insert` (sem `_update`/`_delete`), `seller_photos_public_read`/`_write`.

- [ ] **Step 4: Regenerar tipos e editar manualmente**

Rode `generate_typescript_types` (project_id `ibtdjnbefsltgguoopih`) só pra conferência — como no plano anterior, `database.types.ts` é mantido à mão (usa tipos literais, não `string` cru) e `Tables['x']['Row']` é a convenção usada em todo o código, então **não substitua o arquivo inteiro**. Edite manualmente:

Em `sellers` (`Row`, `Insert`, `Update`), adicione `photo_url: string | null;` e `sales_goal: number;` (com `?` em Insert/Update) nos três blocos, junto dos campos existentes (`id`, `client_id`, `name`, `active`, ...).

Depois do bloco `sellers` (fechando com `Relationships: [];\n};`), adicione dois blocos novos:

```ts
      client_ranking_settings: {
        Row: {
          id: string;
          client_id: string;
          prize_first: string | null;
          prize_second: string | null;
          prize_third: string | null;
          bonus_label: string | null;
          sound_enabled: boolean;
          sound_choice: string;
          animation_enabled: boolean;
          sale_banner_message: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          prize_first?: string | null;
          prize_second?: string | null;
          prize_third?: string | null;
          bonus_label?: string | null;
          sound_enabled?: boolean;
          sound_choice?: string;
          animation_enabled?: boolean;
          sale_banner_message?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          prize_first?: string | null;
          prize_second?: string | null;
          prize_third?: string | null;
          bonus_label?: string | null;
          sound_enabled?: boolean;
          sound_choice?: string;
          animation_enabled?: boolean;
          sale_banner_message?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      seller_point_adjustments: {
        Row: {
          id: string;
          seller_id: string;
          amount: number;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          amount: number;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          amount?: number;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
```

No bloco de aliases no fim do arquivo (perto de `export type SellerRow = Tables['sellers']['Row'];`), adicione:

```ts
export type ClientRankingSettingsRow = Tables['client_ranking_settings']['Row'];
export type SellerPointAdjustmentRow = Tables['seller_point_adjustments']['Row'];
```

- [ ] **Step 5: Verificar**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros.

---

## Task 2: Serviços — fotos, metas, configurações e ajustes

**Files:**
- Modify: `src/services/sellers.service.ts`
- Create: `src/services/rankingSettings.service.ts`
- Create: `src/services/pointAdjustments.service.ts`
- Modify: `src/services/clients.service.ts`

**Interfaces:**
- Consumes: `SellerRow`, `ClientRankingSettingsRow`, `SellerPointAdjustmentRow` (Task 1).
- Produces: `uploadSellerPhoto(clientId, sellerId, file)`, `setSellerGoal(id, salesGoal)` (`sellers.service.ts`); `getRankingSettings(clientId)`, `updateRankingSettings(clientId, patch)` (`rankingSettings.service.ts`); `addPointAdjustment(sellerId, amount, note)`, `listPointAdjustments(sellerId, range)` (`pointAdjustments.service.ts`); `regenerateTelaoToken` com token de 8 caracteres (`clients.service.ts`, assinatura já existente inalterada).

- [ ] **Step 1: Adicionar `uploadSellerPhoto` e `setSellerGoal` em `sellers.service.ts`**

Adicione ao final do arquivo:

```ts
export async function setSellerGoal(id: string, salesGoal: number): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .update({ sales_goal: salesGoal })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadSellerPhoto(clientId: string, sellerId: string, file: File): Promise<SellerRow> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${clientId}/${sellerId}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('seller-photos')
    .upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('seller-photos').getPublicUrl(path);

  const { data, error } = await supabase
    .from('sellers')
    .update({ photo_url: `${publicUrlData.publicUrl}?v=${Date.now()}` })
    .eq('id', sellerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Criar `src/services/rankingSettings.service.ts`**

```ts
import { supabase } from '../integrations/supabase/client';
import type { ClientRankingSettingsRow } from '../integrations/supabase/database.types';

export async function getRankingSettings(clientId: string): Promise<ClientRankingSettingsRow | null> {
  const { data, error } = await supabase
    .from('client_ranking_settings')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateRankingSettings(
  clientId: string,
  patch: Partial<
    Pick<
      ClientRankingSettingsRow,
      | 'prize_first'
      | 'prize_second'
      | 'prize_third'
      | 'bonus_label'
      | 'sound_enabled'
      | 'sound_choice'
      | 'animation_enabled'
      | 'sale_banner_message'
    >
  >
): Promise<ClientRankingSettingsRow> {
  const { data, error } = await supabase
    .from('client_ranking_settings')
    .upsert({ client_id: clientId, ...patch }, { onConflict: 'client_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Criar `src/services/pointAdjustments.service.ts`**

```ts
import { supabase } from '../integrations/supabase/client';
import type { SellerPointAdjustmentRow } from '../integrations/supabase/database.types';

export async function addPointAdjustment(
  sellerId: string,
  amount: number,
  note: string
): Promise<SellerPointAdjustmentRow> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('seller_point_adjustments')
    .insert({ seller_id: sellerId, amount, note, created_by: userData.user?.id ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listPointAdjustments(
  sellerId: string,
  range: { since: string; until: string }
): Promise<SellerPointAdjustmentRow[]> {
  const { data, error } = await supabase
    .from('seller_point_adjustments')
    .select('*')
    .eq('seller_id', sellerId)
    .gte('created_at', range.since)
    .lte('created_at', `${range.until}T23:59:59`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 4: Encurtar o token do telão em `clients.service.ts`**

Encontre:

```ts
function generateTelaoToken() {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}
```

Substitua por:

```ts
function generateTelaoToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
```

- [ ] **Step 5: Verificar**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros.

---

## Task 3: `listSellerRanking` — fotos, metas e ajustes manuais no total

**Files:**
- Modify: `src/services/crmLeads.service.ts`

**Interfaces:**
- Consumes: tabelas `sellers` (com `photo_url`, `sales_goal`), `seller_point_adjustments` (Task 1).
- Produces: `SellerRankRow` ganha `photoUrl: string | null` e `salesGoal: number`; `listSellerRanking` passa a somar ajustes manuais no período e nunca devolve `points` negativo.

- [ ] **Step 1: Substituir `SellerRankRow` e `listSellerRanking`**

Encontre (bloco inteiro adicionado no plano anterior, de `export interface SellerRankRow` até o fechamento de `listSellerRanking`):

```ts
export interface SellerRankRow {
  sellerId: string;
  name: string;
  points: number;
  revenue: number;
}

export interface SellerRankingResult {
  rows: SellerRankRow[];
  unassignedSales: number;
}

/**
 * Ranking de vendedores de um cliente inteiro (todos os projetos), por
 * pontos = 1 por venda PAID no período. Vendedor desativado com vendas no
 * período continua aparecendo (o ponto foi ganho de verdade); só não
 * aparece se nunca vendeu nesse período.
 */
export async function listSellerRanking(
  clientId: string,
  range: { since: string; until: string }
): Promise<SellerRankingResult> {
  const { data: projectRows, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('client_id', clientId);
  if (projectError) throw projectError;
  const projectIds = (projectRows ?? []).map((p) => p.id);
  if (projectIds.length === 0) return { rows: [], unassignedSales: 0 };

  const { data: sellerRows, error: sellerError } = await supabase
    .from('sellers')
    .select('id, name, active')
    .eq('client_id', clientId);
  if (sellerError) throw sellerError;

  const { data: saleRows, error: saleError } = await supabase
    .from('sales')
    .select('seller_id, amount')
    .in('project_id', projectIds)
    .eq('status', 'PAID')
    .gte('sold_at', range.since)
    .lte('sold_at', `${range.until}T23:59:59`);
  if (saleError) throw saleError;

  const byId = new Map<string, SellerRankRow>();
  for (const s of sellerRows ?? []) {
    if (s.active) byId.set(s.id, { sellerId: s.id, name: s.name, points: 0, revenue: 0 });
  }

  let unassignedSales = 0;
  for (const sale of saleRows ?? []) {
    if (!sale.seller_id) {
      unassignedSales += 1;
      continue;
    }
    let row = byId.get(sale.seller_id);
    if (!row) {
      const seller = (sellerRows ?? []).find((s) => s.id === sale.seller_id);
      if (!seller) {
        unassignedSales += 1;
        continue;
      }
      row = { sellerId: seller.id, name: seller.name, points: 0, revenue: 0 };
      byId.set(seller.id, row);
    }
    row.points += 1;
    row.revenue += sale.amount ?? 0;
  }

  const rows = Array.from(byId.values()).sort(
    (a, b) => b.points - a.points || b.revenue - a.revenue
  );
  return { rows, unassignedSales };
}
```

Substitua por:

```ts
export interface SellerRankRow {
  sellerId: string;
  name: string;
  photoUrl: string | null;
  points: number;
  revenue: number;
  salesGoal: number;
}

export interface SellerRankingResult {
  rows: SellerRankRow[];
  unassignedSales: number;
}

/**
 * Ranking de vendedores de um cliente inteiro (todos os projetos). Pontos =
 * 1 por venda PAID no período, mais a soma dos ajustes manuais
 * (seller_point_adjustments) no mesmo período — nunca exibe total negativo,
 * mas o ledger guarda o valor real. Vendedor desativado com pontos no
 * período continua aparecendo (o ponto foi ganho de verdade); só não
 * aparece se não tiver nada nesse período.
 */
export async function listSellerRanking(
  clientId: string,
  range: { since: string; until: string }
): Promise<SellerRankingResult> {
  const { data: projectRows, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('client_id', clientId);
  if (projectError) throw projectError;
  const projectIds = (projectRows ?? []).map((p) => p.id);

  const { data: sellerRows, error: sellerError } = await supabase
    .from('sellers')
    .select('id, name, active, photo_url, sales_goal')
    .eq('client_id', clientId);
  if (sellerError) throw sellerError;
  const sellerIds = (sellerRows ?? []).map((s) => s.id);

  const [saleResult, adjustmentResult] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from('sales')
          .select('seller_id, amount')
          .in('project_id', projectIds)
          .eq('status', 'PAID')
          .gte('sold_at', range.since)
          .lte('sold_at', `${range.until}T23:59:59`)
      : Promise.resolve({ data: [] as { seller_id: string | null; amount: number | null }[], error: null }),
    sellerIds.length > 0
      ? supabase
          .from('seller_point_adjustments')
          .select('seller_id, amount')
          .in('seller_id', sellerIds)
          .gte('created_at', range.since)
          .lte('created_at', `${range.until}T23:59:59`)
      : Promise.resolve({ data: [] as { seller_id: string; amount: number }[], error: null }),
  ]);
  if (saleResult.error) throw saleResult.error;
  if (adjustmentResult.error) throw adjustmentResult.error;
  const saleRows = saleResult.data ?? [];
  const adjustmentRows = adjustmentResult.data ?? [];

  const byId = new Map<string, SellerRankRow>();
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

  function findOrCreate(sellerId: string): SellerRankRow | null {
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

  let unassignedSales = 0;
  for (const sale of saleRows) {
    if (!sale.seller_id) {
      unassignedSales += 1;
      continue;
    }
    const row = findOrCreate(sale.seller_id);
    if (!row) {
      unassignedSales += 1;
      continue;
    }
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
  return { rows, unassignedSales };
}
```

- [ ] **Step 2: Verificar**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: erros esperados nos arquivos que ainda consomem `SellerRankRow`/`SellerPodium`/`SellerRankingList` sem as props novas (`RankingPage.tsx`) — serão corrigidos nas próximas tarefas. Confirme que o erro aponta pra esses arquivos e não pra `crmLeads.service.ts`.

---

## Task 4: `webhook-sales` — Broadcast em tempo real

**Files:**
- Modify: `supabase/functions/webhook-sales/index.ts`

**Interfaces:**
- Consumes: `clients.telao_token`/`telao_active` (já existentes), `sellers.name`.
- Produces: publica `POST {SUPABASE_URL}/realtime/v1/api/broadcast` com `{ messages: [{ topic: "telao:<token>", event: "sale", payload: { sellerName, amount } }] }` sempre que uma venda com vendedor identificado é processada e o telão do cliente está ativo. Best-effort — falha no broadcast nunca derruba o registro da venda.

- [ ] **Step 1: Inserir o broadcast depois do upsert da venda**

Encontre:

```ts
    if (saleError) throw saleError;

    await admin
      .from('webhook_inbox')
      .update({
        processing_status: 'PROCESSED',
        processed_at: new Date().toISOString(),
        normalized_event_id: sale.id,
      })
      .eq('id', inboxRow.id);

    return json({ received: true, event_id: inboxRow.id, sale_id: sale.id });
```

Substitua por:

```ts
    if (saleError) throw saleError;

    if (sellerId) {
      const { data: clientRow } = await admin
        .from('clients')
        .select('telao_token, telao_active')
        .eq('id', clientId)
        .maybeSingle();

      if (clientRow?.telao_active && clientRow.telao_token) {
        const { data: sellerRow } = await admin.from('sellers').select('name').eq('id', sellerId).maybeSingle();
        // Best-effort: o telão em tempo real é um bônus, nunca pode derrubar o
        // registro da venda se o broadcast falhar.
        fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: serviceKey },
          body: JSON.stringify({
            messages: [
              {
                topic: `telao:${clientRow.telao_token}`,
                event: 'sale',
                payload: {
                  sellerName: sellerRow?.name ?? 'Vendedor',
                  amount: typeof body.amount === 'number' ? body.amount : 0,
                },
              },
            ],
          }),
        }).catch(() => {});
      }
    }

    await admin
      .from('webhook_inbox')
      .update({
        processing_status: 'PROCESSED',
        processed_at: new Date().toISOString(),
        normalized_event_id: sale.id,
      })
      .eq('id', inboxRow.id);

    return json({ received: true, event_id: inboxRow.id, sale_id: sale.id });
```

- [ ] **Step 2: Deploy**

Use `deploy_edge_function`, `project_id: "ibtdjnbefsltgguoopih"`, `name: "webhook-sales"`, **`verify_jwt: false`** (a função continua pública, autenticada só pelo `x-webhook-secret` — omitir esse parâmetro reverte pra `true` e quebra o webhook), com o conteúdo atualizado do arquivo completo.

- [ ] **Step 3: Verificar que a venda continua funcionando (sem checar o broadcast ainda — isso é validado na Task 9)**

```bash
curl -s -X POST "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/webhook-sales" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: d4005c5623684de9be37675a04577f3b1a6b775db34e48c8a71c470ecb7abb64" \
  -d '{
    "project": "ENGENHARIA_DE_DADOS_E_IA",
    "external_sale_id": "teste_broadcast_smoke_001",
    "phone": "45977770000",
    "amount": 100,
    "status": "PAID"
  }'
echo
```

Expected: `{"received":true,...,"sale_id":"..."}` (sem `seller_name`, não deve tentar broadcast, deve responder normal). Depois:

```bash
curl -s -X POST "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/telao-ranking?token=x" -o /dev/null -w "smoke ok, http=%{http_code}\n"
```

(essa chamada só confirma que a função `telao-ranking` continua no ar; a resposta real dela muda na Task 5). Limpe o registro de teste:

```sql
delete from public.sales where external_sale_id = 'teste_broadcast_smoke_001';
```

---

## Task 5: `telao-ranking` — fotos, metas, prêmios e configurações

**Files:**
- Modify: `supabase/functions/telao-ranking/index.ts`

**Interfaces:**
- Produces: resposta muda de `{ clientName, rows: {name,points,revenue}[] }` para `{ clientName, rows: SellerRankRow[], prizes, settings }`, onde `rows` tem o mesmo formato de `SellerRankRow` do frontend (`sellerId, name, photoUrl, points, revenue, salesGoal`) — `sellerId` de um vendedor não é dado sensível, só a receita/nome precisavam de proteção, e devolver o mesmo formato do frontend elimina uma camada de adaptação no `TelaoPage`.

- [ ] **Step 1: Substituir o corpo da função inteira**

```ts
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
  });
});
```

- [ ] **Step 2: Deploy**

Use `deploy_edge_function`, `project_id: "ibtdjnbefsltgguoopih"`, `name: "telao-ranking"`, **`verify_jwt: false`**, com o conteúdo do Step 1.

- [ ] **Step 3: Verificar**

```bash
curl -s "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/telao-ranking?token=teste_telao_token_0001&since=2026-08-01&until=2026-08-10"
```

Expected: o token de teste está com `telao_active = false` (desativado no final do plano anterior), então espera-se `{"error":"invalid_token"}` com status 404. Reative temporariamente pra ver o formato novo:

```sql
update public.clients set telao_active = true where id = '72a84bfc-9536-4fe7-bf52-ec0624f44c97';
```

```bash
curl -s "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/telao-ranking?token=teste_telao_token_0001&since=2026-08-01&until=2026-08-10"
```

Expected: `{"clientName":"INSTITUTO NTA","rows":[...],"prizes":{"first":null,"second":null,"third":null,"bonusLabel":null},"settings":{"soundEnabled":true,"soundChoice":"sino","animationEnabled":true,"saleBannerMessage":"VENDA FECHADA!"}}` — cada linha de `rows` com `sellerId`, `photoUrl` (null se não tiver foto ainda) e `salesGoal` (0 se nenhuma meta definida).

---

## Task 6: `Avatar` compartilhado + síntese de som

**Files:**
- Create: `src/components/comercial/Avatar.tsx`
- Create: `src/lib/telaoSounds.ts`

**Interfaces:**
- Produces: `<Avatar name={string} photoUrl={string | null} size={number} />` (usado por `SellerPodium`, `SellerRankingList`, `TelaoPage`); `playTelaoSound(kind: 'sino'|'aplausos'|'caixa')`, `unlockAudio()` de `telaoSounds.ts`.

- [ ] **Step 1: Criar `Avatar.tsx`**

```tsx
import { useState } from 'react';

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({
  name,
  photoUrl,
  size = 40,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);

  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ width: size, height: size, background: 'var(--color-brand)' }}
    >
      {initials(name)}
    </div>
  );
}
```

- [ ] **Step 2: Criar `src/lib/telaoSounds.ts`**

```ts
export type SoundChoice = 'sino' | 'aplausos' | 'caixa';

let audioContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType = 'sine',
  gainPeak = 0.3
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainPeak, ctx.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

function playSino(ctx: AudioContext) {
  tone(ctx, 1568, 0, 0.6, 'sine', 0.25);
  tone(ctx, 2093, 0.05, 0.5, 'sine', 0.15);
}

function playCaixa(ctx: AudioContext) {
  tone(ctx, 880, 0, 0.12, 'square', 0.2);
  tone(ctx, 1318, 0.12, 0.18, 'square', 0.2);
}

function playAplausos(ctx: AudioContext) {
  for (let i = 0; i < 10; i++) {
    const start = i * 0.05 + Math.random() * 0.02;
    tone(ctx, 200 + Math.random() * 400, start, 0.08, 'sawtooth', 0.08);
  }
}

/** Deve ser chamada dentro de um gesto do usuário (clique/toque) — libera o áudio no navegador. */
export function unlockAudio() {
  const ctx = getContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

export function playTelaoSound(kind: SoundChoice) {
  const ctx = getContext();
  if (ctx.state === 'suspended') void ctx.resume();
  if (kind === 'sino') playSino(ctx);
  else if (kind === 'caixa') playCaixa(ctx);
  else playAplausos(ctx);
}
```

- [ ] **Step 3: Verificar**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros novos vindos desses dois arquivos.

---

## Task 7: `SellerPodium` e `SellerRankingList` — visual redesenhado

**Files:**
- Modify: `src/components/comercial/SellerPodium.tsx`
- Modify: `src/components/comercial/SellerRankingList.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 6), `SellerRankRow` com `photoUrl`/`salesGoal` (Task 3).
- Produces: `SellerPodium({ rows, prizes: RankingPrizes })`; `RankingPrizes = { first: string|null; second: string|null; third: string|null; bonusLabel: string|null }` (exportado de `SellerPodium.tsx`); `SellerRankingList({ rows, canManage, onAdjust? })` onde `onAdjust?: (sellerId: string, amount: number, note: string) => void` — mostra todos os vendedores (não só a partir do 4º), com meta/progresso, e os controles de ajuste manual só quando `canManage` for `true` e `onAdjust` estiver definido.

- [ ] **Step 1: Substituir `SellerPodium.tsx` inteiro**

```tsx
import { Crown, Gift } from 'lucide-react';
import type { SellerRankRow } from '../../services/crmLeads.service';
import { formatScore, formatBRL } from '../../lib/format';
import { Avatar } from './Avatar';

const rankStyle = [
  { color: '#f5c451', glow: 'rgba(245,196,81,0.45)', label: '1º', height: 'h-40' },
  { color: '#7fd6c4', glow: 'rgba(127,214,196,0.35)', label: '2º', height: 'h-32' },
  { color: '#e2686b', glow: 'rgba(226,104,107,0.35)', label: '3º', height: 'h-28' },
];

// Ordem de exibição: 2º, 1º, 3º (pódio clássico com o 1º no centro).
const displayOrder = [1, 0, 2];

export interface RankingPrizes {
  first: string | null;
  second: string | null;
  third: string | null;
  bonusLabel: string | null;
}

export function SellerPodium({ rows, prizes }: { rows: SellerRankRow[]; prizes: RankingPrizes }) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-faint)]">
        Sem vendas no período para montar o pódio.
      </p>
    );
  }

  const prizeByRank = [prizes.first, prizes.second, prizes.third];

  return (
    <div
      className="relative overflow-hidden rounded-2xl px-4 py-6"
      style={{
        background:
          'radial-gradient(circle at 50% 0%, rgba(91,124,250,0.16), transparent 55%), linear-gradient(180deg, #0e1018 0%, #0a0b0f 100%)',
      }}
    >
      {prizes.bonusLabel && (
        <div className="mb-4 flex justify-center">
          <span className="rounded-lg border border-[#f5c451]/40 bg-[#f5c451]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#f5c451]">
            {prizes.bonusLabel}
          </span>
        </div>
      )}

      <div className="flex items-end justify-center gap-3 sm:gap-5">
        {displayOrder.map((rankIdx) => {
          const row = top3[rankIdx];
          if (!row) return <div key={rankIdx} className="w-24 sm:w-32" />;
          const style = rankStyle[rankIdx];
          const isFirst = rankIdx === 0;
          const prize = prizeByRank[rankIdx];

          return (
            <div key={row.sellerId} className="flex w-24 flex-col items-center sm:w-32">
              {prize && (
                <div className="mb-2 flex max-w-full items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1">
                  <Gift size={10} style={{ color: style.color }} className="shrink-0" />
                  <span className="truncate text-[9px] text-[var(--color-text-muted)]">{prize}</span>
                </div>
              )}

              {isFirst && <Crown size={22} className="mb-1" style={{ color: style.color }} />}

              <div
                className="relative flex w-full flex-col items-center px-2 pb-4 pt-4"
                style={{
                  background: `linear-gradient(180deg, color-mix(in srgb, ${style.color} 26%, #11151f) 0%, #11151f 100%)`,
                  border: `1px solid ${style.color}`,
                  borderRadius: '14px 14px 42% 42% / 14px 14px 22% 22%',
                  boxShadow: `0 0 22px ${style.glow}`,
                }}
              >
                <Avatar name={row.name} photoUrl={row.photoUrl} size={56} />
                <p className="mt-2 max-w-full truncate text-center text-[11px] font-semibold text-[var(--color-text)]">
                  {row.name}
                </p>
                <p className="text-[13px] font-bold" style={{ color: style.color }}>
                  {formatScore(row.points, 'pontos')}
                </p>
                <p className="text-[10px] text-[var(--color-text-faint)]">{formatBRL(row.revenue)}</p>
              </div>

              <div
                className={`flex w-full items-start justify-center rounded-b-lg ${style.height}`}
                style={{
                  background: `linear-gradient(180deg, color-mix(in srgb, ${style.color} 22%, transparent) 0%, transparent 100%)`,
                  borderTop: `2px solid ${style.color}`,
                }}
              >
                <span className="mt-2 text-xl font-black" style={{ color: style.color }}>
                  {style.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Substituir `SellerRankingList.tsx` inteiro**

```tsx
import { useState } from 'react';
import { Plus, MinusCircle } from 'lucide-react';
import type { SellerRankRow } from '../../services/crmLeads.service';
import { formatScore, formatBRL } from '../../lib/format';
import { Avatar } from './Avatar';

export function SellerRankingList({
  rows,
  canManage,
  onAdjust,
}: {
  rows: SellerRankRow[];
  canManage: boolean;
  onAdjust?: (sellerId: string, amount: number, note: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { amount: string; note: string }>>({});

  function draftFor(sellerId: string) {
    return drafts[sellerId] ?? { amount: '', note: '' };
  }

  function apply(sellerId: string, sign: 1 | -1) {
    const draft = draftFor(sellerId);
    const raw = Number(draft.amount);
    if (!raw || Number.isNaN(raw)) return;
    onAdjust?.(sellerId, sign * Math.abs(raw), draft.note);
    setDrafts((prev) => ({ ...prev, [sellerId]: { amount: '', note: '' } }));
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const pct = row.salesGoal > 0 ? Math.min(100, (row.points / row.salesGoal) * 100) : 0;
        const missing = Math.max(0, row.salesGoal - row.points);
        const draft = draftFor(row.sellerId);
        return (
          <div
            key={row.sellerId}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-panel)] text-xs font-bold text-[var(--color-text-muted)]">
              {i + 1}
            </span>
            <Avatar name={row.name} photoUrl={row.photoUrl} size={36} />

            <div className="min-w-[160px] flex-1">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{row.name}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {formatScore(row.points, 'pontos')} · {formatBRL(row.revenue)}
              </p>
              {row.salesGoal > 0 && (
                <>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1b1c25]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: pct >= 100 ? 'var(--color-good)' : 'var(--color-brand)',
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[11px] font-medium text-[var(--color-text)]">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                    {missing > 0 ? `Faltam: ${missing} venda${missing > 1 ? 's' : ''}` : 'Meta atingida 🎉'}
                  </p>
                </>
              )}
            </div>

            {canManage && onAdjust && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={draft.amount}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [row.sellerId]: { ...draftFor(row.sellerId), amount: e.target.value },
                    }))
                  }
                  placeholder="Valor"
                  className="w-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-right text-xs text-[var(--color-text)]"
                />
                <input
                  value={draft.note}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [row.sellerId]: { ...draftFor(row.sellerId), note: e.target.value },
                    }))
                  }
                  placeholder="Motivo"
                  className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                />
                <button
                  onClick={() => apply(row.sellerId, 1)}
                  title="Adicionar valor"
                  className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-good)] hover:border-[var(--color-good)]"
                >
                  <Plus size={14} />
                </button>
                <button
                  onClick={() => apply(row.sellerId, -1)}
                  title="Retirar valor (lança correção no histórico)"
                  className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-bad)] hover:border-[var(--color-bad)]"
                >
                  <MinusCircle size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verificar**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: erro esperado em `RankingPage.tsx` (ainda não passa `prizes`/`canManage`/`onAdjust`) — corrigido na Task 8. Nenhum erro deve vir dos dois arquivos desta tarefa.

---

## Task 8: `RankingPage.tsx` — fotos, metas, ajustes e configurações do telão

**Files:**
- Modify: `src/pages/RankingPage.tsx`

**Interfaces:**
- Consumes: `uploadSellerPhoto`, `setSellerGoal` (Task 2), `getRankingSettings`, `updateRankingSettings` (Task 2), `addPointAdjustment` (Task 2), `SellerPodium` com `prizes` (Task 7), `SellerRankingList` com `canManage`/`onAdjust` (Task 7).

- [ ] **Step 1: Substituir `RankingPage.tsx` inteiro**

```tsx
import { useEffect, useState } from 'react';
import { Trophy, Plus, Copy, Check, RefreshCw, MonitorPlay, Ban, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
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
import { SellerPodium } from '../components/comercial/SellerPodium';
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
        <SellerPodium rows={ranking.rows} prizes={prizes} />
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
              <button
                onClick={handleGenerateTelao}
                disabled={busy}
                className="flex w-fit items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:border-[var(--color-brand)] disabled:opacity-50"
              >
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
                {client?.telao_active ? 'Regenerar link' : 'Gerar link do telão'}
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros.

---

## Task 9: `TelaoPage.tsx` — tempo real, animação e som

**Files:**
- Modify: `src/pages/public/TelaoPage.tsx`

**Interfaces:**
- Consumes: `supabase` (cliente anônimo já existente em `src/integrations/supabase/client.ts`), `SellerPodium`/`SellerRankingList` (Task 7), `playTelaoSound`/`unlockAudio` (Task 6), resposta de `telao-ranking` no formato `{ clientName, rows: SellerRankRow[], prizes, settings }` (Task 5).

- [ ] **Step 1: Substituir `TelaoPage.tsx` inteiro**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Volume2 } from 'lucide-react';
import { supabase } from '../../integrations/supabase/client';
import { formatBRL } from '../../lib/format';
import { playTelaoSound, unlockAudio, type SoundChoice } from '../../lib/telaoSounds';
import { SellerPodium, type RankingPrizes } from '../../components/comercial/SellerPodium';
import { SellerRankingList } from '../../components/comercial/SellerRankingList';
import type { SellerRankRow } from '../../services/crmLeads.service';

const FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/functions/v1`;
const POLL_MS = 60_000;
const CELEBRATION_MS = 4500;

interface TelaoSettings {
  soundEnabled: boolean;
  soundChoice: SoundChoice;
  animationEnabled: boolean;
  saleBannerMessage: string;
}

const defaultSettings: TelaoSettings = {
  soundEnabled: true,
  soundChoice: 'sino',
  animationEnabled: true,
  saleBannerMessage: 'VENDA FECHADA!',
};

// Telão sempre mostra o mês corrente — não tem UI de filtro (é uma tela
// sem interação, só leitura, feita pra ficar ligada numa TV).
function currentMonthRange() {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const until = now.toISOString().slice(0, 10);
  return { since, until };
}

export function TelaoPage() {
  const { token } = useParams();
  const [clientName, setClientName] = useState<string | null>(null);
  const [rows, setRows] = useState<SellerRankRow[] | null>(null);
  const [prizes, setPrizes] = useState<RankingPrizes>({ first: null, second: null, third: null, bonusLabel: null });
  const [settings, setSettings] = useState<TelaoSettings>(defaultSettings);
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
      <div className="flex h-screen items-center justify-center bg-[#0a0b0f] text-center text-white">
        <p className="text-lg">{error}</p>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0b0f] text-white">
        <p className="text-lg">Carregando ranking...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen flex-col items-center gap-8 overflow-y-auto bg-[#0a0b0f] px-10 py-10 text-white">
      {!soundUnlocked && (
        <button
          onClick={activateSound}
          className="fixed right-6 top-6 z-40 flex items-center gap-2 rounded-full bg-[#f5c451] px-4 py-2 text-sm font-semibold text-[#0a0b0f] shadow-lg"
        >
          <Volume2 size={16} /> Ativar som
        </button>
      )}

      {celebration && (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity duration-500"
        >
          <div className="rounded-2xl border-4 border-[#f5c451] bg-[#11151f] px-10 py-8 text-center shadow-[0_0_60px_rgba(245,196,81,0.6)]">
            <p className="text-4xl font-black text-[#f5c451]">{settings.saleBannerMessage}</p>
            <p className="mt-2 text-2xl font-bold text-white">{celebration.sellerName}</p>
            <p className="text-xl text-white/70">{formatBRL(celebration.amount)}</p>
          </div>
        </div>
      )}

      <h1 className="text-3xl font-bold">Ranking de Vendas — {clientName}</h1>

      <div className="w-full max-w-3xl">
        <SellerPodium rows={rows} prizes={prizes} />
      </div>

      {rows.length > 0 && (
        <div className="w-full max-w-2xl">
          <SellerRankingList rows={rows} canManage={false} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros.

---

## Task 10: Verificação end-to-end

**Files:** nenhum (só validação manual).

- [ ] **Step 1: Build de produção**

```bash
cd "D:\CRM - MASTER\src" && npm run build
```

Expected: `tsc -b` e `vite build` terminam sem erro.

- [ ] **Step 2: Reativar o token de teste e regenerar via UI**

Já reativado no Task 5/Step 3 (`teste_telao_token_0001`). No navegador, logado, vá em Comercial &gt; Ranking do projeto ENGENHARIA DE DADOS E IA e clique "Regenerar link" — confirme que o link exibido agora tem 8 caracteres, e que o link antigo (`teste_telao_token_0001`) para de funcionar:

```bash
curl -s -o /dev/null -w "token antigo, http=%{http_code}\n" "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/telao-ranking?token=teste_telao_token_0001&since=2026-08-01&until=2026-08-10"
```

Expected: `404`.

- [ ] **Step 3: Cadastrar vendedor com foto e meta**

Em Comercial &gt; Ranking: reative "Maria Vendedora" (estava desativada) ou cadastre um vendedor novo de teste, defina meta de vendas (ex: 3), e envie uma foto qualquer pelo botão "Foto". Confirme que a foto aparece no pódio/lista em vez das iniciais.

- [ ] **Step 4: Lançar ajuste manual**

Na lista completa, lance +2 com motivo "bônus campanha" pro vendedor de teste. Confirme que o total de pontos sobe e a receita não muda.

- [ ] **Step 5: Configurar prêmios/som/animação**

Preencha 1º/2º/3º lugar, a faixa de bônus, escolha o som "caixa" e a mensagem "VENDEU!!!", salve. Confirme que o pódio mostra a faixa e os badges de prêmio.

- [ ] **Step 6: Abrir o telão com o link novo (8 caracteres) numa aba anônima**

Confirme: layout com foto/prêmios/faixa de bônus/meta batendo com a tela logada; clique em "Ativar som".

- [ ] **Step 7: Disparar venda em tempo real**

```bash
curl -s -X POST "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/webhook-sales" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: d4005c5623684de9be37675a04577f3b1a6b775db34e48c8a71c470ecb7abb64" \
  -d '{
    "project": "ENGENHARIA_DE_DADOS_E_IA",
    "external_sale_id": "teste_realtime_final_001",
    "phone": "45988880000",
    "amount": 500,
    "status": "PAID",
    "seller_name": "maria vendedora"
  }'
echo
```

Na aba do telão (sem recarregar), confirme: a faixa "VENDEU!!!" aparece com o nome do vendedor e R$ 500,00, o som "caixa" toca, e o ranking atualiza sozinho.

- [ ] **Step 8: Limpar dados de teste**

```sql
delete from public.sales where external_sale_id in ('teste_realtime_final_001');
delete from public.seller_point_adjustments where seller_id in (
  select id from public.sellers where client_id = '72a84bfc-9536-4fe7-bf52-ec0624f44c97' and name ilike '%teste%'
);
update public.sellers set active = false where client_id = '72a84bfc-9536-4fe7-bf52-ec0624f44c97' and name ilike '%teste%';
```

---

## Self-Review

**Cobertura da spec:** Task 1 cobre seção 3 (modelo de dados: colunas, tabelas, Storage, RLS); Task 2–3 cobrem 4.1–4.4 (serviços, token curto, cálculo de pontos com ajustes); Task 4 cobre a transmissão em tempo real via `webhook-sales`; Task 5 cobre a Edge Function pública enriquecida; Task 6–7 cobrem o visual compartilhado (avatar, som, pódio, lista); Task 8 cobre a tela de gestão completa; Task 9 cobre o telão com tempo real/animação/som/"Ativar som"; Task 10 cobre a seção 7 (verificação) da spec. Casos de borda da seção 6 (upload falho, total negativo, Realtime caindo, cliente sem configurações, venda sem vendedor) estão refletidos: `Avatar` já trata erro de imagem com fallback pras iniciais; `Math.max(0, points)` nunca mostra negativo; poll de 60s continua rodando independente do Realtime; `telao-ranking` usa `?? valores padrão` quando não há linha em `client_ranking_settings`; broadcast só dispara com `sellerId` resolvido.

**Placeholders:** nenhum "TBD"/"TODO" — todo código é completo. A única ressalva textual (import residual a remover na Task 8) foi tratada como instrução explícita de correção, não como placeholder.

**Consistência de tipos:** `SellerRankRow { sellerId, name, photoUrl, points, revenue, salesGoal }` é idêntico entre `crmLeads.service.ts` (Task 3), a resposta JSON de `telao-ranking` (Task 5), `SellerPodium`/`SellerRankingList` (Task 7), `RankingPage.tsx` (Task 8) e `TelaoPage.tsx` (Task 9) — o mesmo formato atravessa o backend público e as duas telas. `RankingPrizes` é exportado de `SellerPodium.tsx` (Task 7) e importado por `TelaoPage.tsx` (Task 9). `SoundChoice` é exportado de `telaoSounds.ts` (Task 6) e reusado em `RankingPage.tsx`/`TelaoPage.tsx`.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-10-ranking-visual-tempo-real.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
