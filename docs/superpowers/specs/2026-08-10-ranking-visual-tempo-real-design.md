# Design — Ranking estilo "bet": metas, prêmios, fotos, tempo real e animação

Data: 2026-08-10
Projeto: Leads Hub (D:\CRM - MASTER\src), Supabase `ibtdjnbefsltgguoopih`
Continuação de: [2026-08-10-ranking-vendedores-telao-design.md](2026-08-10-ranking-vendedores-telao-design.md) (já implementado — tabela `sellers`, `sales.seller_id`, telão público, submenu Comercial &gt; Ranking)

## 1. Motivação

O usuário mandou uma referência visual (print de um painel estilo casa de apostas: pódio com foto, faixa de bônus, troféu, e uma lista lateral com meta/progresso e botões de ajuste manual de valor) e pediu três coisas:

1. O link do telão "sem token" — investigação mostrou que era sobre o *tamanho* do token (64 caracteres), não sobre remover a proteção.
2. Visual da referência — que inclui metas, prêmios e ajuste manual, itens que tinham sido deixados fora do escopo na primeira rodada.
3. Uma experiência tipo "bet": quando uma venda entra, o telão anima e toca um som — configurável.

## 2. Decisões (via brainstorming)

- **Token do telão**: encurta de 64 para 8 caracteres alfanuméricos. Continua secreto — só muda o tamanho, não a lógica de proteção.
- **Foto do vendedor**: upload opcional (Supabase Storage). Sem foto, cai nas iniciais como hoje.
- **Metas voltam**: meta é em **quantidade de vendas** no período (mesma unidade do ranking por pontos), não em receita — assim a barra de progresso bate exatamente com a posição no ranking.
- **Prêmios voltam**: texto livre por posição (1º/2º/3º) + uma faixa de destaque configurável (“bonus label”, ex: “2X Comissão Dobrada”) — nível cliente, não por vendedor.
- **Ajuste manual volta, com auditoria**: cada lançamento (positivo ou negativo) vira uma linha imutável num ledger (quem, quando, quanto, motivo) — nunca sobrescreve o total.
- **Critério do ranking continua só pontos**: pontos = vendas pagas no período **mais** a soma dos ajustes manuais no período. Essa é a mesma métrica usada pra ordenar o ranking e pra medir o progresso da meta.
- **Tempo real via Supabase Realtime *Broadcast*** (não *postgres_changes*): a tabela `sales` exige login por RLS, então um visitante anônimo do telão nunca poderia "escutar" mudanças nela sem abrir uma brecha de segurança. Em vez disso, o `webhook-sales` (que já roda com privilégio de serviço) transmite um evento no canal `telao:<token>` sempre que uma venda com vendedor identificado é processada. O telão escuta esse canal. Fallback: polling de segurança a cada 60s, caso a conexão caia.
- **Som**: sintetizado no navegador via Web Audio API (osciladores) — sem baixar/hospedar arquivos de áudio. Três opções: sino, aplausos, caixa registradora.
- **Autoplay de áudio**: navegadores bloqueiam som automático sem interação prévia. O telão mostra um botão "Ativar som" na primeira carga; um toque libera o áudio pro resto da sessão da aba.
- **Divisão de telas**:
  - **Comercial &gt; Ranking** (logada): pódio + lista com foto, meta/progresso, prêmios, faixa de bônus, **e** os controles de edição (cadastro de vendedor com foto, meta, ajuste manual com motivo, configuração de som/animação/mensagem).
  - **Telão** (`/telao/:token`, público): mesmo visual rico, **sem** nenhum controle de edição — só leitura, mais a animação/som em tempo real e o botão "Ativar som".

## 3. Modelo de dados

### 3.1 `sellers` — colunas novas

```sql
alter table public.sellers
  add column photo_url text,
  add column sales_goal integer not null default 0;
```

### 3.2 Tabela nova `client_ranking_settings` (1 linha por cliente)

```sql
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
```

Criada sob demanda (upsert por `client_id`) na primeira vez que alguém salva as configurações — não precisa existir de antemão pra todo cliente.

### 3.3 Tabela nova `seller_point_adjustments` (ledger imutável)

```sql
create table public.seller_point_adjustments (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  amount integer not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
```

Sem UPDATE/DELETE liberado pra ninguém (nem admin) — é auditoria, corrige-se lançando um novo ajuste negativo, nunca apagando o anterior. Mesmo espírito de `audit_logs`, que já existe no banco com essa mesma filosofia.

### 3.4 Storage — bucket `seller-photos`

Bucket público (leitura), caminho dos arquivos `<client_id>/<seller_id>.<ext>`. Escrita restrita por RLS de `storage.objects` usando o primeiro segmento do caminho como `client_id` e o mesmo helper `private.has_client_edit_settings` já usado pra `sellers`.

### 3.5 RLS

- `client_ranking_settings`: select por `has_client_access(client_id)`; insert/update por `has_client_edit_settings(client_id)` (mesmo padrão de `sellers_write`).
- `seller_point_adjustments`: select por quem tem acesso ao cliente do vendedor (`has_client_access` via join em `sellers`); insert por `has_client_edit_settings` via o mesmo join. Sem policy de update/delete (ninguém pode alterar/apagar, por design).
- `storage.objects` (bucket `seller-photos`): select público; insert/update/delete por `has_client_edit_settings` do `client_id` extraído do caminho do arquivo.

## 4. Backend

### 4.1 Geração do token do telão

`regenerateTelaoToken` (já existe) passa a gerar 8 caracteres alfanuméricos (`Math.random`-based ou `crypto.getRandomValues` mapeado pra base36) em vez do token de 128 caracteres hex atual.

### 4.2 Cálculo de pontos (client-side `listSellerRanking` e Edge Function `telao-ranking`)

Ambos passam a: (a) somar `seller_point_adjustments.amount` do vendedor com `created_at` dentro do período, ao total de vendas pagas; (b) trazer `photo_url` e `sales_goal` de cada vendedor; (c) trazer as configurações de `client_ranking_settings` do cliente (prêmios, faixa de bônus — e, só na função pública, também som/animação/mensagem, já que o telão não tem outro jeito de ler isso). `revenue` continua sendo só a soma do valor das vendas (ajuste manual não mexe em receita, só em pontos).

### 4.3 `webhook-sales` — broadcast em tempo real

Depois de resolver `sellerId` e gravar a venda: se `sellerId` não for nulo, busca `clients.telao_token`/`telao_active` do cliente; se `telao_active`, publica um evento Realtime Broadcast no canal `telao:<telao_token>` com `{ event: 'sale', sellerName, amount }`. Vendas sem vendedor identificado não disparam nada (mesma regra de "não aparece no ranking").

### 4.4 Serviços novos/alterados no frontend

- `sellers.service.ts`: `uploadSellerPhoto(clientId, sellerId, file)`, `setSellerGoal(id, salesGoal)`.
- `rankingSettings.service.ts` (novo): `getRankingSettings(clientId)`, `updateRankingSettings(clientId, patch)` (upsert).
- `pointAdjustments.service.ts` (novo): `addPointAdjustment(sellerId, amount, note)`, `listPointAdjustments(sellerId, range)`.
- `crmLeads.service.ts`: `listSellerRanking` passa a incluir os ajustes no total de pontos e os campos novos de vendedor/config descritos em 4.2.

## 5. Frontend

### 5.1 `RankingPage.tsx` (logada)

- Pódio (`SellerPodium`) ganha: foto (ou iniciais), faixa de bônus no topo, badge de prêmio por posição.
- Lista (`SellerRankingList`) ganha: foto, barra de progresso da meta (`pontos / sales_goal`), "Faltam: X vendas", e — só quando `canManage` — campo de valor + motivo com botões "Adicionar"/"Retirar" que chamam `addPointAdjustment`.
- Cadastro de vendedor ganha: input de meta (número) e upload de foto (`<input type="file">`).
- Novo card "Configurações do Telão": campos de prêmio (1º/2º/3º), faixa de bônus, toggle de som + dropdown de som, toggle de animação, texto da mensagem de venda — tudo via `rankingSettings.service.ts`.

### 5.2 `TelaoPage.tsx` (pública)

- Mesmo visual de pódio/lista da 5.1, sem nenhum controle de edição.
- Ao montar: cria o client Supabase (chave anônima, já usada no resto do app) e assina o canal `telao:<token>` via Realtime Broadcast.
- Ao receber evento `sale`: toca o som configurado (Web Audio API, sintetizado) se `sound_enabled`, mostra a animação (faixa com `sale_banner_message` + nome do vendedor + valor, com destaque visual tipo flash/confete) se `animation_enabled`, e recarrega o ranking.
- Overlay inicial "Ativar som" (some após o primeiro clique/toque; guarda em memória da aba que já foi ativado).
- Poll de segurança a cada 60s (antes era o único mecanismo, a 30s; agora é só rede de proteção).

## 6. Casos de borda

- Upload de foto falha (rede, formato inválido): mantém o vendedor com iniciais, mostra erro pontual, não bloqueia o resto do cadastro.
- Ajuste manual deixando o total negativo: o ledger guarda o valor real (inclusive negativo), mas a exibição do total nunca mostra menos que 0.
- Realtime cai (aba em segundo plano, rede instável): o poll de 60s garante que o ranking não fica desatualizado por muito tempo; só a animação/som daquela venda específica que não dispara.
- Cliente sem `client_ranking_settings` configurado ainda: usa os defaults da tabela (sino, animação ligada, "VENDA FECHADA!", sem prêmios/faixa).
- Venda sem vendedor identificado: não soma ponto, não conta pra meta, não dispara broadcast/animação — mesma regra já usada na v1.

## 7. Verificação

1. Aplicar migration (colunas novas em `sellers`, tabelas `client_ranking_settings`/`seller_point_adjustments`, bucket de storage, RLS) e regenerar tipos.
2. Cadastrar um vendedor de teste com foto e meta; conferir que a foto aparece no pódio/lista e a barra de progresso bate com o número de vendas.
3. Lançar um ajuste manual (+3, motivo "bônus campanha") e conferir que o total do ranking soma certo e o lançamento aparece no histórico.
4. Configurar prêmios/faixa/som/mensagem em Comercial &gt; Ranking.
5. Abrir o telão em aba anônima com o token curto novo, clicar em "Ativar som".
6. Disparar uma venda de teste via `curl` no `webhook-sales` com `seller_name` de um vendedor cadastrado e conferir, no telão: (a) o evento chega em tempo real (sem precisar recarregar), (b) a animação/faixa aparece com o nome certo, (c) o som toca, (d) o ranking atualiza.
7. Derrubar a conexão Realtime (ex: recarregar sem token de teste) pra confirmar que o poll de 60s ainda mantém o ranking correto.
8. `npm run build` pra garantir que o build de produção continua passando.

## 8. Fora de escopo

Múltiplos sons por vendedor (é por cliente, não por pessoa), histórico visual de "quem editou o quê" fora do ledger cru, notificação sonora diferenciada por valor da venda, suporte a vídeo/GIF customizado na animação (fica só CSS/confete simples por enquanto).
