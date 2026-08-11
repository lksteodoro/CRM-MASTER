# Design — Ranking de Vendedores + Painel Telão (Comercial)

Data: 2026-08-10
Projeto: Leads Hub (D:\CRM - MASTER\src), Supabase `ibtdjnbefsltgguoopih`

## 1. Motivação

O antigo painel de ranking de vendedores (Podium/RankingBoard, hoje órfão em
`src/components/comercial/`) era inteiramente mock: usava `data/mockData.ts`
e não tinha correspondência no modelo real de dados (`sales` não tem campo de
vendedor). Este design reconstrói o ranking sobre dados reais, e adiciona um
modo "telão" — uma tela cheia, sem login, pensada para ficar aberta num
monitor/TV da sala comercial.

## 2. Decisões (via brainstorming com o usuário)

- **Vendedor** = cadastro simples (nome + status ativo), sem login, por
  **cliente** (não por projeto) — o mesmo time vende vários projetos do
  mesmo cliente.
- **Atribuição de vendedor a uma venda**: dupla via — automática pelo
  webhook (campo opcional `seller_name`, casado por nome com um vendedor já
  cadastrado daquele cliente) **e** manual na tela (dropdown na aba Vendas).
  O webhook nunca cria vendedor novo sozinho — nome sem match fica sem
  vendedor até alguém atribuir manualmente.
- **Métrica do ranking**: pontos = 1 ponto por venda com `status = 'PAID'`
  no período filtrado. Sem multiplicador configurável. Receita total do
  vendedor é exibida ao lado, mas não decide a ordem.
- **Layout visual**: reaproveita o estilo do pódio mock existente
  (`src/components/comercial/Podium.tsx` — coroa no 1º, cores de
  ouro/prata/bronze, pedestal) tanto na tela logada quanto no telão, só sem
  os elementos que saem de escopo (prêmios, faixa de bônus, delta de
  posição). Busca em outros projetos do usuário (D:\CRM, CRM GESTOR,
  pipeflow-crm, oneflow, dash-nta-v1, dashboard-mql, nexus-analytics,
  SalesGPS-SaaS) e na memória de sessões anteriores não encontrou nenhum
  painel de telão pré-existente para reaproveitar — esse Podium mock é a
  única referência visual real disponível.
- **Fora de escopo** (não entra nesta versão): metas por vendedor, prêmios
  configuráveis por posição, ajuste manual de pontos com histórico/ledger.
  Tudo isso existia no mock antigo e foi propositalmente deixado de fora.
- **Navegação**: "Comercial" ganha um submenu "Ranking" (primeiro submenu do
  app — hoje a sidebar é uma lista plana). A tela de Ranking é logada e
  concentra gestão de vendedores + link do telão.
- **Telão**: rota pública separada (`/telao/:token`), sem login, sem menu,
  full-screen, protegida por um token opaco por cliente (não por ID
  previsível). Busca dados via uma Edge Function pública nova, nunca lendo
  as tabelas diretamente com a chave anônima (RLS bloquearia, e mesmo que
  não bloqueasse, não queremos expor tabelas cruas).

## 3. Modelo de dados

### 3.1 Tabela nova `sellers`

```sql
create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sellers_client_id_idx on public.sellers(client_id);
```

### 3.2 Coluna nova em `sales`

```sql
alter table public.sales
  add column seller_id uuid references public.sellers(id) on delete set null;
```

Vendedor desativado (`active = false`): vendas já atribuídas a ele
continuam contando no ranking (o ponto foi ganho de verdade); ele só some do
dropdown de atribuição de **novas** vendas.

### 3.3 Colunas novas em `clients`

```sql
alter table public.clients
  add column telao_token text unique,
  add column telao_active boolean not null default false;
```

Token gerado só quando o usuário clicar em "Gerar link" pela primeira vez
(`telao_active` começa `false`, sem token). Regenerar troca o token e
invalida o link antigo imediatamente.

### 3.4 RLS

Novo helper, mesmo padrão de `private.has_client_access`:

```sql
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
```

Policies:

- `sellers_select`: `private.is_admin() OR private.has_client_access(client_id)`
- `sellers_write` (ALL): `private.is_admin() OR private.has_client_edit_settings(client_id)`
- `sales_update_seller` (UPDATE, nova — hoje `sales` só tem policy de
  SELECT): `private.is_admin() OR private.has_project_permission(project_id, 'edit_settings')`.
  Simplificação aceita: a policy libera UPDATE na linha inteira de `sales`
  (Postgres RLS não restringe coluna por coluna sem trigger); na prática só
  a UI de atribuição de vendedor grava nesse caminho, então o risco é baixo
  num CRM interno de agência.
- `clients` já tem policy de update para admin
  (`clients_admin_write`); adiciono uma policy extra
  `clients_telao_write` (UPDATE, só colunas de telão via aplicação, mesma
  ressalva acima) usando `private.has_client_edit_settings(id)`.

## 4. Backend

### 4.1 `webhook-sales` (editar Edge Function existente)

Depois de resolver `contactId`, antes do upsert em `sales`: se
`body.seller_name` (ou `body.seller`) for string não vazia, buscar em
`sellers` por `client_id = clientId and active = true and lower(name) = lower(trim(seller_name))`.
Se achar, inclui `seller_id` no upsert. Se não achar, segue sem `seller_id`
(sem erro, sem criar vendedor).

### 4.2 `sellers.service.ts` (novo)

`listSellers(clientId)`, `createSeller(clientId, name)`,
`renameSeller(id, name)`, `setSellerActive(id, active)`.

### 4.3 `crmLeads.service.ts` (editar)

Nova função `assignSeller(saleId, sellerId | null)` — `update sales set
seller_id = ... where id = saleId`.

Nova função `listSellerRanking(clientId, range)`: busca `sales` de todos os
projetos do cliente no período com `status = 'PAID'`, agrupa por
`seller_id`, calcula `points` (contagem) e `revenue` (soma de `amount`).
Ordena por `points desc`. Vendas com `seller_id null` ficam de fora do
ranking mas contam num contador separado "vendas sem vendedor" (mostrado na
tela como aviso, não como erro).

### 4.4 Edge Function nova `telao-ranking`

`GET /functions/v1/telao-ranking?token=...&since=...&until=...` (sem
autenticação, `verify_jwt=false`, mesmo padrão de `webhook-sales`).

1. Busca `clients` por `telao_token = token and telao_active = true`. Não
   achou → 404 genérico (não revela se o token existe ou não).
2. Roda a mesma agregação de `listSellerRanking` do lado do servidor
   (service role), devolve só `{ name, points, revenue }[]` — nunca IDs
   internos, nunca dados de outros clientes.

## 5. Frontend

### 5.1 Sidebar (`Sidebar.tsx`)

`projectNav` ganha uma estrutura de item com filho opcional. Só "Comercial"
tem `children: [{ path: 'comercial/ranking', label: 'Ranking' }]` por
enquanto — os demais itens continuam simples. Renderizado como um item
indentado logo abaixo de "Comercial", sempre visível (não precisa
expandir/colidir, é um item só).

### 5.2 Rota nova logada — `RankingPage.tsx`

`/project/:projectId/comercial/ranking`, dentro do `ProjectLayout` /
`ProtectedRoute` / `ProjectRoute` existentes (mesmo guard das outras
páginas do projeto).

Conteúdo:
- Pódio (top 3) + lista dos demais — visual novo, mais simples que o
  `Podium`/`RankingBoard` antigos (sem metas, sem prêmios, sem inputs de
  ajuste manual). `Podium`/`RankingBoard`/`RankingConfigModal` antigos ficam
  **removidos** (código morto, dependiam de tipos/dados que não existem
  mais).
- Painel "Vendedores": lista com toggle ativo/inativo e botão renomear;
  input + botão "Adicionar vendedor".
- Card "Telão": se `telao_active` for falso, botão "Gerar link do telão";
  se verdadeiro, mostra a URL com botão copiar e botão "Regenerar" (com
  confirmação, já que invalida o link atual na hora).
- Aviso textual se houver vendas `PAID` no período sem `seller_id` (contador
  de "Vendas sem vendedor atribuído").

A página em si é visível a qualquer um com acesso ao projeto (mesmo padrão
de "Comercial" hoje — não é escondida por `can_view_commercial`, a proteção
real de dados já está na RLS). Só os **controles de edição** (cadastrar
vendedor, ativar/desativar, gerar/regenerar link do telão) ficam
condicionados a `can_edit_settings` no projeto atual ou `is_admin` — mesmo
gate que hoje decide se o item "Configurações" aparece na sidebar. Sem essa
permissão, a pessoa vê pódio/lista normalmente, só sem os botões de gestão.

### 5.3 `LeadsPage.tsx`, aba Vendas

Nova coluna "Vendedor" na tabela de vendas: `<select>` com os vendedores
ativos do cliente + opção "— sem vendedor —". `onChange` chama
`assignSeller`. Mesmo gate de permissão da seção 5.2 controla se o select é
editável ou só mostra o nome como texto.

### 5.4 Rota nova pública — `TelaoPage.tsx`

`/telao/:token`, registrada em `App.tsx` **fora** de `<ProtectedRoute>`
(irmã de `/login`). Sem sidebar/topbar. Busca dados direto na Edge Function
`telao-ranking` via `fetch` (não usa o client Supabase autenticado). Faz
polling a cada 30s. Layout full-screen, fontes grandes, pódio + lista,
pensado pra leitura à distância numa TV.

Token inválido/inativo → tela de erro simples e genérica ("Link inválido ou
expirado"), sem detalhar o motivo.

## 6. Casos de borda

- Cliente sem nenhum vendedor cadastrado: Ranking mostra estado vazio
  ("Nenhum vendedor cadastrado") em vez de pódio vazio; telão mostra a
  mesma mensagem.
- Nenhuma venda `PAID` no período: pódio vazio, lista vazia, sem erro.
- Regenerar token do telão: quem tiver a aba antiga aberta passa a ver
  "Link inválido" no próximo polling — comportamento esperado e aceito.
- `seller_name` do webhook com nome de vendedor **inativo**: tratado como
  "não achou" (mesma regra do match: `active = true`) — fica sem vendedor.

## 7. Verificação

Com o dev server já rodando local (`localhost:5173`) e o lead+venda de
teste já existentes (Instituto NTA / Engenharia de Dados e IA, R$ 2.497,00):

1. Aplicar a migration (tabela `sellers`, coluna `seller_id`, colunas de
   telão, policies, função `has_client_edit_settings`) e fazer deploy das
   duas Edge Functions (`webhook-sales` atualizada, `telao-ranking` nova)
   via MCP do Supabase.
2. Login no app, ir em Comercial > Ranking, cadastrar 1-2 vendedores de
   teste.
3. Ir em Leads > Vendas, atribuir a venda de teste a um vendedor pelo
   dropdown; conferir que ela aparece no ranking.
4. Gerar o link do telão, abrir `/telao/:token` numa aba anônima (sem
   sessão) e conferir que os dados batem.
5. Enviar um novo POST de teste pro `webhook-sales` com `seller_name`
   batendo o nome de um vendedor cadastrado; conferir que a venda já chega
   com `seller_id` preenchido, sem passar pela atribuição manual.
6. `npm run build` pra garantir que não quebrou o build de produção.

## 8. Fora de escopo (explícito)

Metas por vendedor, prêmios configuráveis, ajuste manual de pontos com
histórico, ranking por projeto (em vez de por cliente), autenticação no
telão, criação automática de vendedor a partir do webhook.
