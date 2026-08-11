# Ranking de Vendedores + Telão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir o ranking de vendedores da tela Comercial sobre dados reais (não mais mock), e adicionar um modo "telão" público, sem login, pra exibir esse ranking numa TV/monitor da sala comercial.

**Architecture:** Nova tabela `sellers` (cadastro simples por cliente, sem login) e coluna `sales.seller_id`; atribuição dupla (webhook por nome + manual na tela); nova página logada "Comercial &gt; Ranking" (submenu novo na sidebar); nova Edge Function pública `telao-ranking` servindo uma rota pública `/telao/:token` protegida por token opaco guardado em `clients.telao_token`.

**Tech Stack:** React 19 + TypeScript + Vite + react-router-dom (frontend), Supabase Postgres + RLS + Edge Functions/Deno (backend). Projeto Supabase: `ibtdjnbefsltgguoopih`. Sem framework de testes automatizados no projeto (nenhum vitest/jest configurado) e sem git nesta pasta — verificação é manual (build, SQL, curl, navegador) e não há passo de commit em nenhuma tarefa.

## Global Constraints

- Vendedor = cadastro simples (nome + ativo), por **cliente**, sem login.
- Atribuição de vendedor a uma venda: automática via webhook (`seller_name`/`seller`, casado por nome, case-insensitive, só entre vendedores **ativos**; sem match → sem erro, venda fica sem vendedor) **e** manual na aba Vendas.
- Ranking = 1 ponto por venda com `status = 'PAID'` no período filtrado (mesmo `dateRange` do resto do app). Receita é exibida, não decide ordem.
- Fora de escopo: metas, prêmios, ajuste manual de pontos com histórico, ranking por projeto (é por cliente).
- Vendedor desativado: pontos já ganhos continuam contando no ranking; só some do dropdown de atribuição de novas vendas.
- Telão: rota pública `/telao/:token`, sem login, sem menu, protegida por token opaco em `clients.telao_token` (não por ID previsível). Nunca lê tabelas diretamente — só via Edge Function `telao-ranking`, que devolve apenas `{ clientName, rows: [{ name, points, revenue }] }`.
- Controles de edição (cadastrar/renomear/(des)ativar vendedor, gerar/regenerar link do telão, atribuir vendedor a uma venda) exigem `is_admin` ou `permissions.can_edit_settings` no projeto atual — mesmo gate que hoje decide se "Configurações" aparece na sidebar. A visualização do ranking em si é aberta a qualquer um com acesso ao projeto.
- Reaproveitar o layout visual do pódio mock existente (`src/components/comercial/Podium.tsx`: coroa no 1º, cores `#f5c451`/`#7fd6c4`/`#e2686b`, pedestal) — é a única referência visual disponível (nenhum telão pré-existente foi encontrado em outros projetos do usuário nem na memória de sessões antigas).
- Seguir os padrões já estabelecidos no projeto: Card/LoadingView/StateView de `src/components/ui`, `formatBRL`/`formatNumber`/`formatScore` de `src/lib/format.ts`, estilo de migration com cabeçalho comentado + `for ... to authenticated using (...)`, Edge Functions no padrão `webhook-*` (CORS, `json()` helper, `Deno.serve`).

Spec completa: [`docs/superpowers/specs/2026-08-10-ranking-vendedores-telao-design.md`](../specs/2026-08-10-ranking-vendedores-telao-design.md)

---

## Task 1: Migration — tabela `sellers`, coluna `sales.seller_id`, colunas de telão em `clients`, RLS

**Files:**
- Create: `supabase/migrations/0012_seller_ranking_telao.sql`
- Modify: `src/integrations/supabase/database.types.ts`

**Interfaces:**
- Produces: tabela `public.sellers(id, client_id, name, active, created_at, updated_at)`; coluna `public.sales.seller_id uuid null`; colunas `public.clients.telao_token text unique null`, `public.clients.telao_active boolean not null default false`; função `private.has_client_edit_settings(p_client_id uuid) returns boolean`; tipo TS `SellerRow` (via `Tables['sellers']['Row']`); `SaleRow.seller_id: string | null`; `ClientRow.telao_token: string | null`, `ClientRow.telao_active: boolean`.

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- =============================================================================
-- 0012 — Ranking de vendedores (cadastro simples) + telão público
--
-- sellers: cadastro simples por cliente (sem login), substitui o antigo
-- conceito de "Vendedor" que só existia no mock. sales.seller_id liga uma
-- venda a um vendedor — atribuído manualmente na tela ou casado por nome
-- vindo do webhook (ver webhook-sales). Vendedor desativado continua
-- contando pontos já ganhos; só some do cadastro pra novas atribuições.
--
-- clients.telao_token/telao_active: um link público por cliente (sem login)
-- pra exibir o ranking numa TV/monitor da sala comercial — protegido por um
-- token opaco em vez de ID previsível. A Edge Function telao-ranking é quem
-- valida o token e devolve só dados agregados.
-- =============================================================================

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sellers_client on public.sellers (client_id);

alter table public.sales
  add column seller_id uuid references public.sellers(id) on delete set null;

alter table public.clients
  add column telao_token text unique,
  add column telao_active boolean not null default false;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.sellers enable row level security;

create or replace function private.has_client_edit_settings(p_client_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.project_users pu
      join public.projects p on p.id = pu.project_id
     where p.client_id = p_client_id
       and pu.user_id = auth.uid()
       and pu.can_edit_settings = true
  );
$$;

create policy sellers_select on public.sellers
  for select to authenticated
  using (private.is_admin() or private.has_client_access(client_id));

create policy sellers_write on public.sellers
  for all to authenticated
  using (private.is_admin() or private.has_client_edit_settings(client_id))
  with check (private.is_admin() or private.has_client_edit_settings(client_id));

-- sales só tinha policy de SELECT até aqui — atribuir vendedor exige UPDATE.
-- Libera a linha inteira (RLS não restringe coluna sem trigger); na prática
-- só a UI de atribuição de vendedor grava por esse caminho.
create policy sales_update_seller on public.sales
  for update to authenticated
  using (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'))
  with check (private.is_admin() or private.has_project_permission(project_id, 'edit_settings'));

create policy clients_telao_write on public.clients
  for update to authenticated
  using (private.is_admin() or private.has_client_edit_settings(id))
  with check (private.is_admin() or private.has_client_edit_settings(id));
```

Salve exatamente esse conteúdo em `supabase/migrations/0012_seller_ranking_telao.sql`.

- [ ] **Step 2: Aplicar a migration no Supabase**

Use a ferramenta MCP do Supabase `apply_migration` com `project_id: "ibtdjnbefsltgguoopih"`, `name: "seller_ranking_telao"` e `query` igual ao conteúdo do Step 1.

- [ ] **Step 3: Verificar que a migration aplicou certo**

Rode via MCP `execute_sql` (project_id `ibtdjnbefsltgguoopih`):

```sql
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'sales' and column_name = 'seller_id')
   or (table_name = 'clients' and column_name in ('telao_token','telao_active')))
order by table_name, column_name;
```

Esperado: 3 linhas (`clients.telao_active`, `clients.telao_token`, `sales.seller_id`). Rode também:

```sql
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('sellers','sales','clients')
order by tablename, policyname;
```

Esperado: `sellers_select`/`sellers_write` em `sellers`; `sales_select`/`sales_update_seller` em `sales`; `clients_admin_write`/`clients_select`/`clients_telao_write` em `clients`.

- [ ] **Step 4: Regenerar os tipos TypeScript**

Use a ferramenta MCP `generate_typescript_types` com `project_id: "ibtdjnbefsltgguoopih"`. Pegue o resultado e substitua o conteúdo de `src/integrations/supabase/database.types.ts` **da primeira linha até logo antes do bloco de aliases manuais** (o bloco que começa em `export type ContactRow = Tables['contacts']['Row'];`, hoje por volta da linha 809) pelo texto gerado — mantendo o bloco de aliases manuais como está.

Depois, adicione ao final do arquivo (junto dos outros aliases `export type ...Row = Tables[...]`) esta linha nova:

```ts
export type SellerRow = Tables['sellers']['Row'];
```

- [ ] **Step 5: Confirmar que os tipos batem**

```bash
grep -n "seller_id" "D:\CRM - MASTER\src\src\integrations\supabase\database.types.ts"
grep -n "telao_token\|telao_active" "D:\CRM - MASTER\src\src\integrations\supabase\database.types.ts"
grep -n "SellerRow" "D:\CRM - MASTER\src\src\integrations\supabase\database.types.ts"
```

Expected: cada grep encontra ocorrências (nas seções `Row`, `Insert` e `Update` de `sales`/`clients`, e a linha do alias `SellerRow`). Se o `generate_typescript_types` não tiver incluído `seller_id`/`telao_token`/`telao_active` (pode acontecer se o cache de schema não tiver atualizado), adicione manualmente nos três blocos (`Row`, `Insert`, `Update`) de `sales` (`seller_id: string | null;` / `seller_id?: string | null;`) e de `clients` (`telao_token: string | null; telao_active: boolean;` / `telao_token?: string | null; telao_active?: boolean;`), seguindo o estilo dos campos vizinhos já existentes.

---

## Task 2: Serviços — `sellers.service.ts` (novo) e adições em `crmLeads.service.ts` / `clients.service.ts`

**Files:**
- Create: `src/services/sellers.service.ts`
- Modify: `src/services/crmLeads.service.ts`
- Modify: `src/services/clients.service.ts`

**Interfaces:**
- Consumes: `SellerRow`, `ClientRow` de `src/integrations/supabase/database.types.ts` (Task 1); `supabase` client de `src/integrations/supabase/client.ts`.
- Produces: `listSellers(clientId, opts?)`, `createSeller(clientId, name)`, `renameSeller(id, name)`, `setSellerActive(id, active)` (todas em `sellers.service.ts`); `assignSeller(saleId, sellerId)`, `listSellerRanking(clientId, range)` retornando `Promise<{ rows: SellerRankRow[]; unassignedSales: number }>`, e o tipo `SellerRankRow` (em `crmLeads.service.ts`); `regenerateTelaoToken(clientId)` retornando `Promise<ClientRow>` (em `clients.service.ts`).

- [ ] **Step 1: Criar `src/services/sellers.service.ts`**

```ts
import { supabase } from '../integrations/supabase/client';
import type { SellerRow } from '../integrations/supabase/database.types';

export async function listSellers(
  clientId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<SellerRow[]> {
  let query = supabase.from('sellers').select('*').eq('client_id', clientId).order('name');
  if (opts.activeOnly) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createSeller(clientId: string, name: string): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .insert({ client_id: clientId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameSeller(id: string, name: string): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .update({ name })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setSellerActive(id: string, active: boolean): Promise<SellerRow> {
  const { data, error } = await supabase
    .from('sellers')
    .update({ active })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Adicionar `assignSeller` e `listSellerRanking` em `src/services/crmLeads.service.ts`**

No topo do arquivo, o import de tipos já existe (`ContactRow, LeadEventRow, ProjectIntegrationRow, SaleRow, WebhookInboxRow`) — não precisa mexer nele. Adicione ao final do arquivo:

```ts
export async function assignSeller(saleId: string, sellerId: string | null): Promise<void> {
  const { error } = await supabase.from('sales').update({ seller_id: sellerId }).eq('id', saleId);
  if (error) throw error;
}

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

- [ ] **Step 3: Adicionar `regenerateTelaoToken` em `src/services/clients.service.ts`**

Adicione ao final do arquivo:

```ts
function generateTelaoToken() {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Gera (ou regenera, invalidando o link antigo na hora) o token do telão do cliente. */
export async function regenerateTelaoToken(clientId: string): Promise<ClientRow> {
  const { data, error } = await supabase
    .from('clients')
    .update({ telao_token: generateTelaoToken(), telao_active: true })
    .eq('id', clientId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Verificar que compila**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros relacionados a `sellers.service.ts`, `crmLeads.service.ts` ou `clients.service.ts`. (Pode haver erros pré-existentes em outros arquivos que ainda serão tocados nas próximas tarefas — ignore por enquanto se forem em `Sidebar.tsx`, `LeadsPage.tsx`, ou arquivos que essa tarefa não modificou.)

---

## Task 3: Edge Function `webhook-sales` — casar `seller_name` com vendedor cadastrado

**Files:**
- Modify: `supabase/functions/webhook-sales/index.ts`

**Interfaces:**
- Consumes: tabela `sellers` (Task 1).
- Produces: `sales.seller_id` preenchido quando `body.seller_name`/`body.seller` casar com um vendedor ativo do cliente.

- [ ] **Step 1: Atualizar o comentário de cabeçalho do arquivo**

Encontre este bloco no topo do arquivo:

```
//   {
//     "project": "MBA_DIREITO",
//     "external_sale_id": "sale_992",
//     "name": "João Silva",
//     "phone": "45999999999",
//     "email": "joao@email.com",
//     "amount": 2497,
//     "payment_method": "cartao",
//     "status": "PAID",
//     "sold_at": "2026-08-10T12:00:00Z"
//   }
```

Substitua por (adiciona a linha `seller_name`):

```
//   {
//     "project": "MBA_DIREITO",
//     "external_sale_id": "sale_992",
//     "name": "João Silva",
//     "phone": "45999999999",
//     "email": "joao@email.com",
//     "amount": 2497,
//     "payment_method": "cartao",
//     "status": "PAID",
//     "sold_at": "2026-08-10T12:00:00Z",
//     "seller_name": "Maria Vendedora"
//   }
```

- [ ] **Step 2: Inserir a busca do vendedor antes do upsert em `sales`**

Encontre este bloco (já existente, logo antes do `admin.from('sales').upsert(...)`):

```ts
    const { data: relatedLead } = await admin
      .from('lead_events')
      .select('id')
      .eq('contact_id', contactId)
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: sale, error: saleError } = await admin
      .from('sales')
      .upsert(
        {
          contact_id: contactId,
          project_id: projectId,
          lead_event_id: relatedLead?.id ?? null,
          external_sale_id: typeof body.external_sale_id === 'string' ? body.external_sale_id : null,
          amount: typeof body.amount === 'number' ? body.amount : null,
          status: (typeof body.status === 'string' ? body.status : 'PAID').toUpperCase(),
          payment_method: typeof body.payment_method === 'string' ? body.payment_method : null,
          sold_at: typeof body.sold_at === 'string' ? body.sold_at : new Date().toISOString(),
          raw_payload: body,
        },
        { onConflict: 'project_id,external_sale_id' }
      )
      .select('id')
      .single();
```

Substitua por:

```ts
    const { data: relatedLead } = await admin
      .from('lead_events')
      .select('id')
      .eq('contact_id', contactId)
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sellerName =
      typeof body.seller_name === 'string'
        ? body.seller_name
        : typeof body.seller === 'string'
          ? body.seller
          : null;
    let sellerId: string | null = null;
    if (sellerName && sellerName.trim()) {
      const { data: sellerMatch } = await admin
        .from('sellers')
        .select('id')
        .eq('client_id', clientId)
        .eq('active', true)
        .ilike('name', sellerName.trim())
        .maybeSingle();
      sellerId = sellerMatch?.id ?? null;
    }

    const { data: sale, error: saleError } = await admin
      .from('sales')
      .upsert(
        {
          contact_id: contactId,
          project_id: projectId,
          lead_event_id: relatedLead?.id ?? null,
          seller_id: sellerId,
          external_sale_id: typeof body.external_sale_id === 'string' ? body.external_sale_id : null,
          amount: typeof body.amount === 'number' ? body.amount : null,
          status: (typeof body.status === 'string' ? body.status : 'PAID').toUpperCase(),
          payment_method: typeof body.payment_method === 'string' ? body.payment_method : null,
          sold_at: typeof body.sold_at === 'string' ? body.sold_at : new Date().toISOString(),
          raw_payload: body,
        },
        { onConflict: 'project_id,external_sale_id' }
      )
      .select('id')
      .single();
```

- [ ] **Step 3: Deploy da função atualizada**

Use a ferramenta MCP `deploy_edge_function` com `project_id: "ibtdjnbefsltgguoopih"`, `slug: "webhook-sales"`, usando o conteúdo atualizado de `supabase/functions/webhook-sales/index.ts` como `index.ts`.

- [ ] **Step 4: Verificar com uma chamada real**

Antes do teste, cadastre um vendedor de teste direto no banco via MCP `execute_sql` (troque `<client_id>` pelo id real do Instituto NTA, `72a84bfc-9536-4fe7-bf52-ec0624f44c97`):

```sql
insert into public.sellers (client_id, name) values ('72a84bfc-9536-4fe7-bf52-ec0624f44c97', 'Maria Vendedora')
returning id, name;
```

Depois rode (mesmo secret já usado antes, projeto `ENGENHARIA_DE_DADOS_E_IA`):

```bash
curl -s -X POST "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/webhook-sales" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: d4005c5623684de9be37675a04577f3b1a6b775db34e48c8a71c470ecb7abb64" \
  -d '{
    "project": "ENGENHARIA_DE_DADOS_E_IA",
    "external_sale_id": "teste_seller_match_001",
    "name": "Cliente Teste Seller",
    "phone": "45988880000",
    "email": "teste.seller@leadshub.com",
    "amount": 997,
    "payment_method": "pix",
    "status": "PAID",
    "seller_name": "maria vendedora"
  }'
```

Expected: resposta `{"received":true,...,"sale_id":"..."}`. Confirme via `execute_sql`:

```sql
select s.seller_id, sel.name from public.sales s
join public.sellers sel on sel.id = s.seller_id
where s.external_sale_id = 'teste_seller_match_001';
```

Expected: 1 linha com `name = 'Maria Vendedora'` (o match funcionou mesmo com `"maria vendedora"` em minúsculas no payload).

---

## Task 4: Edge Function `telao-ranking` (nova)

**Files:**
- Create: `supabase/functions/telao-ranking/index.ts`

**Interfaces:**
- Consumes: `clients.telao_token`/`telao_active`, `sellers`, `sales` (Task 1).
- Produces: `GET /functions/v1/telao-ranking?token=...&since=YYYY-MM-DD&until=YYYY-MM-DD` → `{ clientName: string, rows: { name: string; points: number; revenue: number }[] }` em caso de sucesso; `{ error: string }` com status 404 se o token for inválido/inativo.

- [ ] **Step 1: Criar o arquivo**

```ts
// Edge Function: telao-ranking
//
// Endpoint público (sem login) que devolve o ranking de vendedores de um
// cliente para exibição num telão/TV compartilhado. Protegido por um token
// opaco por cliente (clients.telao_token) — nunca por login. Nunca expõe
// tabelas cruas nem IDs internos, só os campos agregados abaixo.
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
    .select('id, name, active')
    .eq('client_id', client.id);
  if (sellerError) return json({ error: sellerError.message }, 500);

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

  const byId = new Map<string, { sellerId: string; name: string; points: number; revenue: number }>();
  for (const s of sellerRows ?? []) {
    if (s.active) byId.set(s.id, { sellerId: s.id, name: s.name, points: 0, revenue: 0 });
  }
  for (const sale of saleRows) {
    if (!sale.seller_id) continue;
    let row = byId.get(sale.seller_id);
    if (!row) {
      const seller = (sellerRows ?? []).find((s) => s.id === sale.seller_id);
      if (!seller) continue;
      row = { sellerId: seller.id, name: seller.name, points: 0, revenue: 0 };
      byId.set(seller.id, row);
    }
    row.points += 1;
    row.revenue += sale.amount ?? 0;
  }

  const rows = Array.from(byId.values())
    .sort((a, b) => b.points - a.points || b.revenue - a.revenue)
    .map((r) => ({ name: r.name, points: r.points, revenue: r.revenue }));

  return json({ clientName: client.name, rows });
});
```

- [ ] **Step 2: Deploy da função nova**

Use a ferramenta MCP `deploy_edge_function` com `project_id: "ibtdjnbefsltgguoopih"`, `slug: "telao-ranking"`, `verify_jwt: false`, usando o conteúdo do Step 1.

- [ ] **Step 3: Gerar um token de teste e verificar com curl**

Via `execute_sql`, gere um token de teste pro cliente Instituto NTA:

```sql
update public.clients
set telao_token = 'teste_telao_token_0001', telao_active = true
where id = '72a84bfc-9536-4fe7-bf52-ec0624f44c97'
returning id, name, telao_token, telao_active;
```

Depois:

```bash
curl -s "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/telao-ranking?token=teste_telao_token_0001&since=2026-08-01&until=2026-08-10"
```

Expected: JSON com `clientName: "INSTITUTO NTA"` e `rows` contendo `"Maria Vendedora"` com `points: 1` (a venda de teste do Task 3) — mais qualquer outro vendedor cadastrado sem vendas aparecendo com `points: 0`. Teste também um token errado:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://ibtdjnbefsltgguoopih.supabase.co/functions/v1/telao-ranking?token=token-invalido&since=2026-08-01&until=2026-08-10"
```

Expected: `404`.

---

## Task 5: Componentes de ranking (pódio + lista) e remoção dos componentes mock

**Files:**
- Create: `src/components/comercial/SellerPodium.tsx`
- Create: `src/components/comercial/SellerRankingList.tsx`
- Delete: `src/components/comercial/Podium.tsx`
- Delete: `src/components/comercial/RankingBoard.tsx`
- Delete: `src/components/comercial/RankingConfigModal.tsx`

**Interfaces:**
- Consumes: `SellerRankRow` de `src/services/crmLeads.service.ts` (Task 2); `formatScore`, `formatBRL` de `src/lib/format.ts`.
- Produces: `<SellerPodium rows={SellerRankRow[]} />`, `<SellerRankingList rows={SellerRankRow[]} />` (componente "burro" — assume `rows.length > 0`, quem chama decide quando renderizar).

- [ ] **Step 1: Confirmar que nada mais importa os componentes antigos**

```bash
cd "D:\CRM - MASTER\src" && grep -rln "components/comercial/Podium\|components/comercial/RankingBoard\|components/comercial/RankingConfigModal" src --include=*.tsx --include=*.ts
```

Expected: nenhum resultado fora dos próprios três arquivos (eles não são importados por nenhuma página hoje — é código órfão).

- [ ] **Step 2: Apagar os três componentes mock**

```bash
cd "D:\CRM - MASTER\src" && rm src/components/comercial/Podium.tsx src/components/comercial/RankingBoard.tsx src/components/comercial/RankingConfigModal.tsx
```

- [ ] **Step 3: Criar `src/components/comercial/SellerPodium.tsx`**

```tsx
import { Crown } from 'lucide-react';
import type { SellerRankRow } from '../../services/crmLeads.service';
import { formatScore, formatBRL } from '../../lib/format';

const rankStyle = [
  { color: '#f5c451', glow: 'rgba(245,196,81,0.45)', label: '1º', height: 'h-40' },
  { color: '#7fd6c4', glow: 'rgba(127,214,196,0.35)', label: '2º', height: 'h-32' },
  { color: '#e2686b', glow: 'rgba(226,104,107,0.35)', label: '3º', height: 'h-28' },
];

// Ordem de exibição: 2º, 1º, 3º (pódio clássico com o 1º no centro).
const displayOrder = [1, 0, 2];

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function SellerPodium({ rows }: { rows: SellerRankRow[] }) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-faint)]">
        Sem vendas no período para montar o pódio.
      </p>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl px-4 py-6"
      style={{
        background:
          'radial-gradient(circle at 50% 0%, rgba(91,124,250,0.16), transparent 55%), linear-gradient(180deg, #0e1018 0%, #0a0b0f 100%)',
      }}
    >
      <div className="flex items-end justify-center gap-3 sm:gap-5">
        {displayOrder.map((rankIdx) => {
          const row = top3[rankIdx];
          if (!row) return <div key={rankIdx} className="w-24 sm:w-32" />;
          const style = rankStyle[rankIdx];
          const isFirst = rankIdx === 0;

          return (
            <div key={row.sellerId} className="flex w-24 flex-col items-center sm:w-32">
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
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-[#0a0b0f] sm:h-14 sm:w-14"
                  style={{ background: style.color, boxShadow: `0 0 14px ${style.glow}` }}
                >
                  {initials(row.name)}
                </div>
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

- [ ] **Step 4: Criar `src/components/comercial/SellerRankingList.tsx`**

```tsx
import type { SellerRankRow } from '../../services/crmLeads.service';
import { formatScore, formatBRL } from '../../lib/format';

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function SellerRankingList({ rows }: { rows: SellerRankRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div
          key={row.sellerId}
          className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)] p-3"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-panel)] text-xs font-bold text-[var(--color-text-muted)]">
            {i + 4}
          </span>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ background: 'var(--color-brand)' }}
          >
            {initials(row.name)}
          </div>
          <div className="min-w-[140px] flex-1">
            <p className="truncate text-sm font-semibold text-[var(--color-text)]">{row.name}</p>
            <p className="text-[11px] text-[var(--color-text-muted)]">{formatBRL(row.revenue)}</p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-[var(--color-text)]">
            {formatScore(row.points, 'pontos')}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Verificar que compila**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros novos vindos de `src/components/comercial/`.

---

## Task 6: Submenu na Sidebar + página logada "Comercial &gt; Ranking"

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Create: `src/pages/RankingPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `listSellers`/`createSeller`/`renameSeller`/`setSellerActive` (Task 2), `listSellerRanking` + `SellerRankRow` (Task 2), `getClient`/`regenerateTelaoToken` (Task 2), `SellerPodium`/`SellerRankingList` (Task 5), `useAuth`, `useProject`, `useFilters`.
- Produces: rota `/project/:projectId/comercial/ranking`.

- [ ] **Step 1: Editar `src/components/layout/Sidebar.tsx` — suportar submenu**

Encontre:

```tsx
const projectNav = [
  { path: 'portfolio', icon: LayoutGrid, label: 'Visão Geral' },
  { path: 'dashboard', icon: LayoutDashboard, label: 'Métricas' },
  { path: 'campanhas', icon: Megaphone, label: 'Campanhas' },
  { path: 'anuncios', icon: Target, label: 'Anúncios' },
  { path: 'leads', icon: Users, label: 'Leads' },
  { path: 'comercial', icon: Handshake, label: 'Comercial' },
];
```

Substitua por:

```tsx
interface ProjectNavItem {
  path: string;
  icon: typeof LayoutGrid;
  label: string;
  children?: { path: string; label: string }[];
}

const projectNav: ProjectNavItem[] = [
  { path: 'portfolio', icon: LayoutGrid, label: 'Visão Geral' },
  { path: 'dashboard', icon: LayoutDashboard, label: 'Métricas' },
  { path: 'campanhas', icon: Megaphone, label: 'Campanhas' },
  { path: 'anuncios', icon: Target, label: 'Anúncios' },
  { path: 'leads', icon: Users, label: 'Leads' },
  {
    path: 'comercial',
    icon: Handshake,
    label: 'Comercial',
    children: [{ path: 'comercial/ranking', label: 'Ranking' }],
  },
];
```

Encontre:

```tsx
        {projectId &&
          projectNav.map((item) => (
            <NavLink key={item.path} to={`/project/${projectId}/${item.path}`} className={linkClass}>
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
```

Substitua por:

```tsx
        {projectId &&
          projectNav.map((item) => (
            <div key={item.path}>
              <NavLink
                to={`/project/${projectId}/${item.path}`}
                className={linkClass}
                end={Boolean(item.children)}
              >
                <item.icon size={17} />
                {item.label}
              </NavLink>
              {item.children?.map((child) => (
                <NavLink
                  key={child.path}
                  to={`/project/${projectId}/${child.path}`}
                  className={({ isActive }) =>
                    clsx(
                      'ml-7 flex items-center rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                      isActive
                        ? 'text-[var(--color-brand)]'
                        : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
                    )
                  }
                >
                  {child.label}
                </NavLink>
              ))}
            </div>
          ))}
```

- [ ] **Step 2: Criar `src/pages/RankingPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Trophy, Plus, Copy, Check, RefreshCw, MonitorPlay, Ban, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import { listSellers, createSeller, renameSeller, setSellerActive } from '../services/sellers.service';
import { listSellerRanking, type SellerRankRow } from '../services/crmLeads.service';
import { getClient, regenerateTelaoToken } from '../services/clients.service';
import type { SellerRow, ClientRow } from '../integrations/supabase/database.types';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';
import { SellerPodium } from '../components/comercial/SellerPodium';
import { SellerRankingList } from '../components/comercial/SellerRankingList';

export function RankingPage() {
  const { isAdmin } = useAuth();
  const { project, permissions } = useProject();
  const { dateRange } = useFilters();
  const canManage = isAdmin || permissions.can_edit_settings;

  const [sellers, setSellers] = useState<SellerRow[] | null>(null);
  const [ranking, setRanking] = useState<{ rows: SellerRankRow[]; unassignedSales: number } | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reload() {
    const range = { since: dateRange.start, until: dateRange.end };
    const [sellerRows, rankingResult, clientRow] = await Promise.all([
      listSellers(project.client_id),
      listSellerRanking(project.client_id, range),
      getClient(project.client_id),
    ]);
    setSellers(sellerRows);
    setRanking(rankingResult);
    setClient(clientRow);
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)]">Ranking de Vendedores — {project.name}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          1 ponto por venda paga no período — soma todos os projetos do cliente
        </p>
      </div>

      {ranking.unassignedSales > 0 && (
        <p className="rounded-lg border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]">
          {ranking.unassignedSales} venda{ranking.unassignedSales > 1 ? 's' : ''} paga
          {ranking.unassignedSales > 1 ? 's' : ''} no período sem vendedor atribuído. Atribua em Leads &gt; Vendas.
        </p>
      )}

      <Card title="Pódio">
        <SellerPodium rows={ranking.rows} />
      </Card>

      {ranking.rows.length > 3 && (
        <Card title="Demais vendedores">
          <SellerRankingList rows={ranking.rows.slice(3)} />
        </Card>
      )}

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
            <div key={seller.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2">
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
        <Card
          title="Telão"
          action={
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-info-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-info)]">
              <MonitorPlay size={12} />
              {client?.telao_active ? 'Ativo' : 'Não gerado'}
            </span>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Link público, sem login, feito pra ficar aberto numa TV/monitor da sala comercial. Mostra o
              mesmo ranking em tela cheia, atualizando sozinho.
            </p>
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
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Registrar a rota em `src/App.tsx`**

Encontre:

```tsx
import { ComercialPage } from './pages/ComercialPage';
```

Substitua por:

```tsx
import { ComercialPage } from './pages/ComercialPage';
import { RankingPage } from './pages/RankingPage';
```

Encontre:

```tsx
              <Route path="comercial" element={<ComercialPage />} />
```

Substitua por:

```tsx
              <Route path="comercial" element={<ComercialPage />} />
              <Route path="comercial/ranking" element={<RankingPage />} />
```

- [ ] **Step 4: Verificar que compila**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros em `Sidebar.tsx`, `RankingPage.tsx` ou `App.tsx`.

- [ ] **Step 5: Verificar visualmente no navegador**

Com o dev server já rodando em `http://localhost:5173` (task iniciada em sessão anterior — se não estiver rodando, `npm run dev` na pasta do projeto), faça login e navegue até o projeto **ENGENHARIA DE DADOS E IA** → Comercial. Confirme que agora aparece um subitem "Ranking" abaixo de "Comercial" na barra lateral, clique nele, e confirme que a página carrega mostrando "Maria Vendedora" no pódio (1 ponto, a venda de teste do Task 3) e o botão "Gerar link do telão".

---

## Task 7: Atribuição de vendedor na aba Vendas (`LeadsPage.tsx`)

**Files:**
- Modify: `src/pages/LeadsPage.tsx`

**Interfaces:**
- Consumes: `listSellers` (Task 2, com `{ activeOnly: true }`), `assignSeller` (Task 2), `useAuth`.

- [ ] **Step 1: Atualizar imports**

Encontre:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Search, Info, Repeat } from 'lucide-react';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import {
  listLeadEvents,
  listSales,
  listContactsByIds,
  computeCrmLeadStats,
  type CrmLeadStats,
} from '../services/crmLeads.service';
import { formatBRL, formatNumber, formatPercent } from '../lib/format';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';
import { RealLeadHistoryModal } from '../components/leads/RealLeadHistoryModal';
import type { ContactRow, LeadEventRow, SaleRow } from '../integrations/supabase/database.types';
```

Substitua por:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Search, Info, Repeat } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { useProject } from '../state/ProjectContext';
import { useFilters } from '../state/FiltersContext';
import {
  listLeadEvents,
  listSales,
  listContactsByIds,
  computeCrmLeadStats,
  assignSeller,
  type CrmLeadStats,
} from '../services/crmLeads.service';
import { listSellers } from '../services/sellers.service';
import { formatBRL, formatNumber, formatPercent } from '../lib/format';
import { Card } from '../components/ui/Card';
import { LoadingView } from '../components/ui/StateView';
import { RealLeadHistoryModal } from '../components/leads/RealLeadHistoryModal';
import type { ContactRow, LeadEventRow, SaleRow, SellerRow } from '../integrations/supabase/database.types';
```

- [ ] **Step 2: Buscar vendedores e expor `canManage`**

Encontre:

```tsx
export function LeadsPage() {
  const { project } = useProject();
  const { dateRange } = useFilters();
  const [tab, setTab] = useState<'leads' | 'vendas'>('leads');
  const [search, setSearch] = useState('');
  const [showInfo, setShowInfo] = useState(true);

  const [events, setEvents] = useState<LeadEventRow[] | null>(null);
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [openContact, setOpenContact] = useState<ContactGroup | null>(null);
```

Substitua por:

```tsx
export function LeadsPage() {
  const { isAdmin } = useAuth();
  const { project, permissions } = useProject();
  const { dateRange } = useFilters();
  const canManage = isAdmin || permissions.can_edit_settings;
  const [tab, setTab] = useState<'leads' | 'vendas'>('leads');
  const [search, setSearch] = useState('');
  const [showInfo, setShowInfo] = useState(true);

  const [events, setEvents] = useState<LeadEventRow[] | null>(null);
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [openContact, setOpenContact] = useState<ContactGroup | null>(null);
```

Encontre (logo depois do `useEffect` principal que busca `events`/`sales`/`contacts`, antes do `const groups = useMemo...`):

```tsx
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end]);

  const groups = useMemo<ContactGroup[]>(() => {
```

Substitua por:

```tsx
    return () => {
      active = false;
    };
  }, [project.id, dateRange.start, dateRange.end]);

  useEffect(() => {
    let active = true;
    void listSellers(project.client_id, { activeOnly: true }).then((rows) => {
      if (active) setSellers(rows);
    });
    return () => {
      active = false;
    };
  }, [project.client_id]);

  async function handleAssignSeller(saleId: string, sellerId: string) {
    await assignSeller(saleId, sellerId || null);
    setSales((prev) => (prev ? prev.map((s) => (s.id === saleId ? { ...s, seller_id: sellerId || null } : s)) : prev));
  }

  const groups = useMemo<ContactGroup[]>(() => {
```

- [ ] **Step 3: Adicionar a coluna "Vendedor" na tabela de Vendas**

Encontre:

```tsx
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                  <th className="pb-3">Contato</th>
                  <th className="pb-3">Fechamento</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 100).map((sale) => {
                  const contact = contacts.find((c) => c.id === sale.contact_id);
                  return (
                    <tr key={sale.id} className="border-b border-[var(--color-border-soft)]">
                      <td className="py-3 text-[var(--color-text)]">{contact?.name || '—'}</td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        {new Date(sale.sold_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="py-3 text-[var(--color-text-muted)]">{sale.status}</td>
                      <td className="py-3 text-right font-medium text-[var(--color-good)]">
                        {sale.amount != null ? formatBRL(sale.amount) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {sales.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                      Nenhuma venda registrada no período.
                    </td>
                  </tr>
                )}
              </tbody>
```

Substitua por:

```tsx
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-faint)]">
                  <th className="pb-3">Contato</th>
                  <th className="pb-3">Fechamento</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Vendedor</th>
                  <th className="pb-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 100).map((sale) => {
                  const contact = contacts.find((c) => c.id === sale.contact_id);
                  return (
                    <tr key={sale.id} className="border-b border-[var(--color-border-soft)]">
                      <td className="py-3 text-[var(--color-text)]">{contact?.name || '—'}</td>
                      <td className="py-3 text-[var(--color-text-muted)]">
                        {new Date(sale.sold_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="py-3 text-[var(--color-text-muted)]">{sale.status}</td>
                      <td className="py-3">
                        {canManage ? (
                          <select
                            value={sale.seller_id ?? ''}
                            onChange={(e) => handleAssignSeller(sale.id, e.target.value)}
                            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-1 text-xs text-[var(--color-text)]"
                          >
                            <option value="">— sem vendedor —</option>
                            {sellers.map((seller) => (
                              <option key={seller.id} value={seller.id}>
                                {seller.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {sellers.find((s) => s.id === sale.seller_id)?.name ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right font-medium text-[var(--color-good)]">
                        {sale.amount != null ? formatBRL(sale.amount) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {sales.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs text-[var(--color-text-faint)]">
                      Nenhuma venda registrada no período.
                    </td>
                  </tr>
                )}
              </tbody>
```

- [ ] **Step 4: Verificar que compila**

```bash
cd "D:\CRM - MASTER\src" && npx tsc -b --noEmit
```

Expected: sem erros em `LeadsPage.tsx`.

- [ ] **Step 5: Verificar no navegador**

Na aba Leads → Vendas do projeto ENGENHARIA DE DADOS E IA, confirme a nova coluna "Vendedor" com um dropdown por linha. Atribua a venda de teste original (R$ 2.497,00, "Lead Teste Demo") a "Maria Vendedora" pelo dropdown. Volte em Comercial → Ranking e confirme que "Maria Vendedora" agora mostra 2 pontos (a venda deste passo + a do Task 3) e receita somando R$ 3.494,00.

---

## Task 8: Rota pública do telão + verificação end-to-end

**Files:**
- Create: `src/pages/public/TelaoPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Edge Function `telao-ranking` (Task 4), via `fetch` direto (não usa o client Supabase autenticado).

- [ ] **Step 1: Criar `src/pages/public/TelaoPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { formatBRL } from '../../lib/format';

const FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/functions/v1`;
const POLL_MS = 30_000;

interface TelaoRow {
  name: string;
  points: number;
  revenue: number;
}

const rankStyle = [
  { color: '#f5c451', glow: 'rgba(245,196,81,0.45)' },
  { color: '#7fd6c4', glow: 'rgba(127,214,196,0.35)' },
  { color: '#e2686b', glow: 'rgba(226,104,107,0.35)' },
];

const displayOrder = [1, 0, 2];

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

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
  const [rows, setRows] = useState<TelaoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="flex h-screen flex-col items-center gap-10 overflow-y-auto bg-[#0a0b0f] px-10 py-12 text-white">
      <h1 className="text-3xl font-bold">Ranking de Vendas — {clientName}</h1>

      {top3.length === 0 ? (
        <p className="text-xl text-white/60">Sem vendas registradas este mês ainda.</p>
      ) : (
        <div className="flex items-end justify-center gap-8">
          {displayOrder.map((rankIdx) => {
            const row = top3[rankIdx];
            if (!row) return <div key={rankIdx} className="w-40" />;
            const style = rankStyle[rankIdx];
            return (
              <div key={row.name} className="flex w-40 flex-col items-center">
                {rankIdx === 0 && <Crown size={36} className="mb-2" style={{ color: style.color }} />}
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-[#0a0b0f]"
                  style={{ background: style.color, boxShadow: `0 0 24px ${style.glow}` }}
                >
                  {initials(row.name)}
                </div>
                <p className="mt-3 text-center text-lg font-semibold">{row.name}</p>
                <p className="text-xl font-bold" style={{ color: style.color }}>
                  {row.points} pts
                </p>
                <p className="text-sm text-white/60">{formatBRL(row.revenue)}</p>
              </div>
            );
          })}
        </div>
      )}

      {rest.length > 0 && (
        <div className="flex w-full max-w-xl flex-col gap-2">
          {rest.map((row, i) => (
            <div key={row.name} className="flex items-center gap-4 rounded-xl bg-white/5 px-4 py-3">
              <span className="w-6 text-center text-sm font-bold text-white/50">{i + 4}</span>
              <span className="flex-1 text-sm font-medium">{row.name}</span>
              <span className="text-sm font-semibold">{row.points} pts</span>
              <span className="text-sm text-white/50">{formatBRL(row.revenue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota pública em `src/App.tsx`**

Encontre:

```tsx
import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { ProjectsPage } from './pages/ProjectsPage';
```

Substitua por:

```tsx
import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { TelaoPage } from './pages/public/TelaoPage';
```

Encontre:

```tsx
          {/* Públicas */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
```

Substitua por:

```tsx
          {/* Públicas */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
          <Route path="/telao/:token" element={<TelaoPage />} />
```

- [ ] **Step 3: Build de produção completo**

```bash
cd "D:\CRM - MASTER\src" && npm run build
```

Expected: `tsc -b` e `vite build` terminam sem erro (saída final tipo `✓ built in Xs`).

- [ ] **Step 4: Verificar o telão no navegador, sem login**

Reinicie o dev server se necessário (`npm run dev`) e abra `http://localhost:5173/telao/<telao_token>` — use o token que o Step 3 do Task 4 gerou (`teste_telao_token_0001`) ou o token real gerado pela UI no Task 6/Step 5. Confirme:
- A página carrega em tela cheia, sem sidebar/topbar, sem exigir login.
- Mostra "Maria Vendedora" no centro do pódio (1º lugar) com os pontos e receita do mês corrente.
- Depois de 30s, os dados atualizam sozinhos (pode confirmar criando mais uma venda de teste via `curl` no `webhook-sales` e vendo ela aparecer sem recarregar a página).

- [ ] **Step 5: Testar token inválido**

Abra `http://localhost:5173/telao/token-que-nao-existe` e confirme que aparece a mensagem "Link inválido ou expirado." em vez de qualquer dado.

- [ ] **Step 6: Limpar dados de teste (opcional)**

Se não quiser que "Cliente Teste Seller" e o vendedor "Maria Vendedora" fiquem visíveis pros gestores, rode via `execute_sql`:

```sql
delete from public.sales where external_sale_id in ('teste_seller_match_001');
update public.sellers set active = false where name = 'Maria Vendedora' and client_id = '72a84bfc-9536-4fe7-bf52-ec0624f44c97';
```

(Os dois registros de teste do lead/venda originais — "Lead Teste Demo" — continuam como estavam, combinados com o usuário anteriormente.)

---

## Self-Review

**Cobertura da spec:** Task 1 cobre seção 3 (modelo de dados) e 3.4 (RLS); Task 2–3 cobrem seção 4.1–4.3 (backend); Task 4 cobre 4.4 (Edge Function telão); Task 5–6 cobrem 5.1–5.2 (nav + página de gestão) e a remoção dos componentes mock citada na seção 5.2; Task 7 cobre 5.3 (atribuição na aba Vendas); Task 8 cobre 5.4 (rota pública). Casos de borda da seção 6 (cliente sem vendedor, sem vendas PAID, token regenerado, seller_name inativo) estão refletidos nas mensagens de estado vazio e no filtro `active = true` do match do webhook.

**Placeholders:** nenhum "TBD"/"TODO" — todo código é completo e executável.

**Consistência de tipos:** `SellerRankRow { sellerId, name, points, revenue }` é o mesmo formato usado em `crmLeads.service.ts` (Task 2), `SellerPodium`/`SellerRankingList` (Task 5) e `RankingPage.tsx` (Task 6). `listSellerRanking` retorna `{ rows, unassignedSales }` consistente entre Task 2 e seu uso em Task 6. `SellerRow`/`ClientRow` vêm de `database.types.ts` (Task 1) e são usados sem alteração de forma em Task 2, 6 e 7.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-10-ranking-vendedores-telao.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
