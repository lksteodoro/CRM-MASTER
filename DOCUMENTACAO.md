# Leads Hub — Documentação do Projeto

Dashboard de tráfego pago e performance comercial para agência, construído para gerenciar
múltiplos clientes, cada um com vários projetos (cursos), campanhas, anúncios, leads,
vendas e equipe comercial.

> **Status atual:** protótipo funcional completo de front-end. Todos os dados são gerados
> localmente (mock determinístico). As camadas de agregação foram desenhadas para serem
> trocadas por chamadas reais à **Meta Marketing API** e por **webhooks de venda** sem
> mexer nos componentes visuais.

---

## 1. Como rodar

Pré-requisitos: Node.js (instalado durante o projeto — v24.19.0).

```bash
npm install
```

```bash
npm run dev
```

Abre em `http://localhost:5173`.

Outros comandos:

```bash
npm run build
```

```bash
npx tsc -b
```

---

## 2. Stack

| Camada | Tecnologia |
| --- | --- |
| Build | Vite 8 |
| UI | React 19 + TypeScript |
| Estilo | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Gráficos | Recharts |
| Ícones | lucide-react |
| Rotas | react-router-dom |

Tema escuro definido por CSS custom properties em `src/index.css`
(`--color-bg`, `--color-panel`, `--color-brand`, `--color-good`, `--color-bad`, etc.).

---

## 3. Estrutura de pastas

```
src/
├── components/
│   ├── ads/          Rankings de anúncios (top leads / top vendas)
│   ├── alerts/       Painel de alertas automáticos
│   ├── charts/       Gráficos (evolução, funil, heatmaps, onda intradiária)
│   ├── comercial/    Pódio, placar de ranking, configuração, cards de funil
│   ├── layout/       Sidebar, Topbar, shells de rota, modais de configuração
│   ├── leads/        Importação CSV e histórico de lead
│   ├── metrics/      KPIs do topo, ritmo do mês, cohort
│   └── ui/           Blocos reutilizáveis (Card, Stepper, gauges, barras...)
├── data/             Geradores de dados mockados
├── lib/              Regras de negócio e agregações (sem JSX)
├── pages/            Uma página por rota
│   └── admin/        Área administrativa (clientes e projetos)
├── state/            Contexto global de filtros/sessão
└── types.ts          Contratos de dados
```

**Princípio de organização:** toda regra de cálculo vive em `src/lib/*`, isolada da UI.
É essa camada que será reapontada para a API real depois.

---

## 4. Modelo de dados (`src/types.ts`)

```
Client (cliente da agência)
 └── AdAccount (conta de anúncio Meta)
      └── Campaign
           └── AdSet
                └── Ad

Project (curso) ── vincula um conjunto de Campaign.id
 └── Lead ── atribuição completa: campaignId, adSetId, adId, utm, assignedTo
      └── Sale ── herda a atribuição do lead + vendedorId + forma de pagamento

Vendedor (equipe comercial do cliente)
PointsTransaction (ledger de ajustes manuais do ranking)
Annotation (marcações na linha do tempo)
```

Entidades de métricas: `DailyMetric` (60 dias de histórico por campanha) e
`HourlyMetric` (distribuição do dia atual).

### Decisões de modelagem relevantes

- **Atribuição gravada no lead, não inferida depois.** Cada lead nasce com campanha,
  conjunto, anúncio e UTM. A venda herda essa cadeia, então o fechamento pode acontecer
  semanas depois sem perder a origem.
- **Duas metas de leads por projeto:** `leadGoal` (referência do período exibido) e
  `monthlyLeadGoal` (mês calendário, usada no Ritmo do Mês). Eram conceitos diferentes
  sendo comparados com o mesmo número — isso gerava percentuais absurdos.
- **Ledger em vez de sobrescrita.** Ajustes manuais no ranking viram transações
  (`PointsTransaction`), preservando o histórico para auditoria.

---

## 5. Navegação e telas

### 5.1 Gate de projeto (`/`)

Tela inicial. Mostra o cliente ativo e os cards dos projetos dele (gasto, leads e vendas
dos últimos 7 dias). Só depois de escolher um projeto o app abre. Botão "Trocar projeto"
no topo volta para cá a qualquer momento.

### 5.2 Sidebar

No topo da sidebar fica o **painel de contexto**: cliente ativo, seletor de projeto e os
botões **Configurar** / **Trocar**. Ele foi movido do topbar para cá porque é contexto de
workspace, não controle de página — o topbar ficou só com papel de acesso, período,
notificações e usuário. Na área administrativa (`/admin`) o painel não aparece, já que ali
o contexto é o cliente e não um projeto específico.

| Item | Rota | Descrição |
| --- | --- | --- |
| Visão Geral | `/portfolio` | Comparativo entre todos os projetos do cliente |
| Principal | `/dashboard` | Dashboard de aquisição de leads |
| Campanhas | `/campanhas` | Macro + detalhe por campanha |
| Anúncios | `/anuncios` | Macro + detalhe por anúncio |
| Leads | `/leads` | Leads e Vendas |
| Comercial | `/comercial` | Performance da equipe + ranking gamificado |
| Clientes | `/admin` | Área administrativa (**só papel Agência**) |

### 5.3 Dashboard principal (`/dashboard`)

- **Painel de alertas** — CPL em disparada, anúncio que parou de gerar leads, fadiga de
  criativo (frequência alta), meta do mês em risco. Cada alerta linka para o item.
- **Ritmo do Mês (pacing)** — projeta o fechamento do mês pelo ritmo atual e compara com
  a meta mensal; marcadores de "esperado até hoje" e "projeção".
- **KPIs** — Valor Gasto, CPL, Leads, Matriculados (com variação vs. período anterior).
- **Gauges** — Meta de Leads e Meta de CPL (velocímetro semicircular).
- **Donut** — Matriculados x Não matriculados.
- **Barras** — Taxa de Conversão da Página e Connect Rate.
- **Mini-cards com sparkline** — Taxa de Impressão, CTR, CPM, Alcance, Frequência.
- **Evolução de Leads por Dia** — área com linha de meta diária e **anotações**
  (marcar "aumentei orçamento em 20%" no dia, com bandeirinha no gráfico).
- **Atividade ao Longo do Dia** — onda por hora + grade de intensidade por campanha.
- **Padrão Semanal** — heatmap dia da semana × hora (60 dias).
- **Cohort Lead → Venda** — % de cada safra semanal que converteu em 1/2/3/4 semanas.
  Células cuja janela ainda não fechou aparecem vazias, não como 0%.
- **Rankings de anúncios** — os que mais geram leads e os que mais convertem em vendas.

### 5.4 Campanhas

- **Macro** (`/campanhas`): tabela ordenável com Investimento, Leads, CPL, Vendas,
  Receita, CAC, ROAS e Conversão. Heatmap verde→vermelho nas colunas de eficiência.
  Selos automáticos de 🏆 Top vendas e 📈 Top conversão.
- **Micro** (`/campanhas/:id`): funil completo (Impressões → Cliques → Página → Leads →
  Conectados → Vendas), gráfico leads×vendas por dia e acordeão de conjuntos de anúncios,
  cada um expansível até os anúncios individuais.

### 5.5 Anúncios

- **Macro** (`/anuncios`): todos os anúncios do projeto ranqueados, com miniatura de
  criativo, heatmap e selos de destaque.
- **Micro** (`/anuncios/:id`): KPIs, tendência diária e **a lista real dos leads que
  aquele anúncio gerou**, com status e valor da venda quando houver.

### 5.6 Leads (`/leads`)

Duas sub-abas:

- **Leads** — agrupados por pessoa (e-mail como identidade). Quem preencheu o formulário
  mais de uma vez aparece como **uma linha** com selo "Nx"; clicar abre o histórico com
  cada entrada, sua origem (campanha › conjunto › anúncio) e UTM completo. A coluna de
  origem mostra `utm_campaign`, `utm_content`, `utm_source` e `utm_medium`.
- **Vendas** — total vendido, ticket médio, taxa lead→venda; cada venda com origem
  clicável e selo "Webhook" ou "Manual".

Botão **Importar Leads**: upload de CSV com drag-and-drop, mapeamento de colunas
(nome/email/telefone) e prévia antes de confirmar.

### 5.7 Comercial (`/comercial`)

**Aba Visão Geral**

- KPIs: Total de Matrículas, Tempo Médio de Venda (mediana lead→venda), Cursos no
  Período, Vendedores Ativos.
- Funil comercial: Oportunidade → Qualificação → Negociação → Fechamento, com as quatro
  taxas de conversão entre estágios.
- Evolução Mensal de Matrículas, Forma de Pagamento (donut), Matrículas por Curso,
  Ranking de Vendedores.
- Filtros por Vendedor e por Curso.

**Aba Ranking & Competição** (gamificada)

- Cabeçalho com título configurável, métrica ativa, **Total do time** e **Top 3**.
- **Pódio** com escudos/brasões (ouro, verde-água, vermelho), coroa no 1º lugar, faixa de
  destaque configurável (ex: "2X Comissão Dobrada"), chips de prêmio por posição e
  indicador de variação de posição.
- **Classificação** estilo placar: `Meta: X · Total: Y`, barra de progresso, percentual e
  `Faltam: Z`. Cada linha tem campo de valor com botões **+** (adicionar) e **−**
  (retirar) para lançamento manual.
- **Meta da Equipe** — barra consolidada com % alcançado.
- **Histórico de Lançamentos Manuais** — ledger de auditoria (correções não apagam
  registros, viram transações inversas).

**Configurar ranking** (modal com 3 abas):

| Aba | O que configura |
| --- | --- |
| Ranking | Título e critério de classificação: **Matrículas**, **Receita (R$)** ou **Pontos** (com regra de pontos por venda) |
| Prêmios | Faixa de destaque do 1º lugar e prêmio de cada posição |
| Metas | Meta de matrículas e meta de receita por vendedor |

Trocar o critério reordena o ranking e reformata todos os valores (contagem, moeda ou
pontos) em tempo real.

### 5.8 Área administrativa (`/admin`) — só papel Agência

- **Lista de clientes** com contas de anúncio de cada um.
- **Novo Cliente** — assistente de 3 passos: Dados → Contas de Anúncio → Revisão.
- **Detalhe do cliente** — contas, projetos e botão "Ver como este cliente".
- **Novo Projeto** — assistente de 4 passos: Projeto/Conta → Campanhas → Metas → Revisão.

Todos os assistentes usam o componente `Stepper` com indicador visual de progresso e
validação por etapa.

---

## 6. Isolamento por cliente

O seletor **"Ver como"** no topo alterna entre:

- **Agência** — enxerga todos os clientes, acessa a área administrativa.
- **Cliente X** — escopo restrito aos dados daquele cliente; o item "Clientes" some da
  sidebar e a rota `/admin` redireciona.

Gate, Visão Geral, Comercial e o modal de Configurar projeto são todos filtrados por
`activeClientId`.

> ⚠️ **Importante:** como não há backend neste protótipo, isso é uma **simulação** da
> regra de escopo. Em produção, essa restrição precisa ser aplicada no servidor
> (autenticação + autorização), não apenas na interface.

---

## 7. Camada de regras (`src/lib/`)

| Arquivo | Responsabilidade |
| --- | --- |
| `metrics.ts` | Presets de data, séries diárias/horárias, CPL, CTR, CPM, connect rate |
| `rollups.ts` | Agregações por campanha / conjunto / anúncio / projeto (spend, leads, vendas, CAC, ROAS) |
| `comercial.ts` | Funil comercial, tempo médio de venda, ranking de vendedores, totais do time |
| `alerts.ts` | Regras dos alertas automáticos |
| `pacing.ts` | Projeção do mês vs. meta mensal |
| `cohort.ts` | Cohort semanal lead→venda |
| `dowHeatmap.ts` | Padrão dia da semana × hora |
| `leadHistory.ts` | Agrupamento de leads repetidos por contato |
| `heatmap.ts` | Cor de fundo das células (verde→vermelho) |
| `adRanking.ts` | Distribuição de performance por anúncio |
| `csv.ts` | Parser e mapeamento de colunas do CSV |
| `format.ts` | Formatação BRL, número, percentual, score por métrica |
| `useSort.ts` | Hook de ordenação de tabelas |

---

## 8. Dados mockados

`src/data/mockData.ts` e `src/data/leadSalesData.ts` geram tudo com um **PRNG
determinístico** (mulberry32) — o dataset é estável entre renders e recarregamentos.

Dataset atual:

- 1 cliente (Faculdade Horizonte), 3 contas de anúncio, 6 projetos/cursos.
- ~9 campanhas, conjuntos e anúncios.
- 60 dias de métricas diárias por campanha.
- Leads individuais com atribuição e UTM; ~18% reaproveitam um contato existente
  (para simular a mesma pessoa entrando mais de uma vez).
- Vendas ligadas a leads, com vendedor e forma de pagamento.
- 6 vendedores com metas de matrículas e de receita.

---

## 9. Pontos de integração (próximos passos)

| O que | Onde plugar |
| --- | --- |
| **Meta Marketing API** | Substituir `dailyMetrics`/`hourlyMetrics` em `src/data/mockData.ts`; `src/lib/rollups.ts` e `metrics.ts` já consomem por interface |
| **Webhook de vendas** | Alimentar `sales` em `src/data/leadSalesData.ts`; o payload deve trazer o identificador do lead (ou e-mail/telefone) para herdar a atribuição |
| **Importação de leads** | `LeadsImportModal` já faz parse e mapeamento no navegador; falta persistir |
| **Miniatura de criativo** | `CreativeThumb` aceita `imageUrl` — basta passar a URL real da Meta |
| **Autenticação/escopo** | O `RoleSwitcher` simula papéis; a regra precisa ir para o servidor |
| **Ledger de pontos** | `PointsTransaction` já existe no formato de ledger; falta persistência |

---

## 10. Bugs encontrados e corrigidos durante o desenvolvimento

1. **Gauges invertidos** — o `sweep-flag` do arco SVG estava com valor errado, desenhando
   a metade de baixo do círculo. Corrigido, mais o desalinhamento entre altura e viewBox.
2. **Ranking de anúncios instável** — usava um PRNG compartilhado que avançava a cada
   render, mudando a ordem. Trocado por hash determinístico do ID do anúncio.
3. **Ritmo do mês com 776% da meta** — a projeção mensal estava sendo comparada com a
   meta calibrada para ~7 dias. Separado em `leadGoal` e `monthlyLeadGoal`.
4. **Cohort mostrando 0% enganoso** — semanas cuja janela ainda não fechou agora aparecem
   vazias em vez de zeradas.

---

## 11. Limitações conhecidas

- **Sem persistência.** Tudo vive em memória; recarregar a página reseta clientes,
  projetos, anotações, metas e o ledger criados na sessão.
- **Sem backend/autenticação.** O escopo por cliente é apenas visual.
- **Bundle grande** (~800 KB / 224 KB gzip). Vale aplicar code-splitting por rota antes
  de ir para produção.
- **Dados sintéticos.** Números, nomes e vendedores são fictícios.
- **Painel de TV** (modo público, tela cheia, atualização automática) ainda não foi
  construído — está mapeado como evolução natural do ranking.
