# Leads Hub — Fase 2 (parcial): Integração real com Meta Ads

> **Atualização:** além do total da conta, o sistema agora sincroniza e exibe
> **campanhas e anúncios reais individualmente** (nome, investimento, leads, CPL,
> cliques, CTR, CPM, alcance) nas páginas Campanhas e Anúncios, para qualquer
> projeto com integração `CONNECTED`. Testado com a conta real do projeto
> **MBA Direito** (25 campanhas, 120 anúncios, 1.963 linhas de métricas diárias
> sincronizadas) — números batendo com o Meta Ads Manager.

Complementa o [DOCUMENTACAO_FASE_1.md](DOCUMENTACAO_FASE_1.md). Esta fase troca a
primeira fatia de dados mockados por métricas reais, puxadas direto da Meta Marketing
API — sem passar por planilha, CSV ou qualquer simulação.

---

## 1. O que foi construído

| Peça | O quê |
| --- | --- |
| `supabase/migrations/0006_meta_ads_integration.sql` | Tabelas `meta_integrations` (credenciais) e `meta_insights_daily` (métricas sincronizadas) |
| `supabase/functions/meta-ads/index.ts` | Edge Function com as ações `test` e `sync`, publicada no projeto (`v2`) |
| `src/services/metaAds.service.ts` | Camada de acesso: salvar credenciais, testar conexão, sincronizar, listar métricas |
| `src/pages/ProjectSettingsPage.tsx` | Tela em `/project/:projectId/configuracoes` — formulário de ID da conta + token |
| `src/components/metrics/RealMetaMetricsCard.tsx` | Card no topo do Dashboard com métricas reais, só aparece quando conectado |
| Link "Configurações" no Sidebar | Visível para ADMIN ou quem tem `can_edit_settings` no projeto |

## 2. Como funciona

1. Um ADMIN abre **Configurações** dentro de um projeto, informa o **ID da conta de
   anúncios** (`act_...`) e um **token de acesso** da Meta Marketing API, e clica em
   **Salvar credenciais**.
2. **Testar conexão** chama a Edge Function `meta-ads` com `action: "test"` — ela lê o
   token do banco (usando o JWT de quem chamou, então só ADMIN passa pela RLS de
   `meta_integrations`), consulta `GET /act_.../` na Graph API e grava o resultado
   (`CONNECTED` ou `ERROR` com a mensagem original da Meta).
3. **Sincronizar agora** chama a mesma função com `action: "sync"` — busca
   `spend, impressions, clicks, reach` e a ação `lead` dos últimos 30 dias via
   `/act_.../insights?time_increment=1`, e grava uma linha por dia em
   `meta_insights_daily` (upsert por `project_id + date`).
4. O Dashboard mostra um card **"Métricas Reais (Meta Ads)"** no topo — só aparece se o
   projeto estiver `CONNECTED` — com investimento, leads, CPL, cliques, alcance e um
   gráfico de investimento diário, tudo vindo de `meta_insights_daily`.

## 3. Decisões de segurança

- **O token nunca é lido pelo navegador para fazer a chamada à Meta.** Ele fica salvo
  em `meta_integrations`, protegido por uma policy que só deixa `is_admin()` enxergar
  a linha (nem CLIENT com `can_edit_settings` vê o token). A Edge Function é quem
  chama `graph.facebook.com`, a partir do servidor.
- A Edge Function autentica o chamador com o **JWT do usuário** (não com a
  service_role) para decidir se ele pode ler o token — a própria RLS resolve a
  autorização. Só depois disso ela troca para a service_role, exclusivamente para
  gravar o resultado em `meta_insights_daily` (tabela sem policy de escrita para
  `authenticated` de propósito).
- `meta_insights_daily` é legível por qualquer pessoa com acesso de visualização ao
  projeto (a métrica em si não é secreta — o token é).

## 4. Testado nesta sessão

- Salvar credenciais (fictícias) → linha criada em `meta_integrations`. ✅
- Testar conexão com token inválido → a função chegou até a Graph API de verdade e
  devolveu o erro original da Meta ("Malformed access token..."), persistido como
  `status = ERROR` e mostrado na tela. ✅
- **Não testado**: sincronização com uma conta de anúncios e token reais (nenhum
  token de produção foi usado nesta sessão).

## 4b. Segunda atualização — correções + leads/matrícula reais via webhook

- **Visão Geral, ranking de anúncios e Dashboard**: paravam de mostrar dados de outros
  projetos (bug do dataset mock vazando entre projetos). Visão Geral agora lista os
  projetos reais do cliente; o ranking de anúncios usa `meta_ad_insights_daily` do
  próprio projeto.
- **Filtro de data**: presets Hoje / Ontem / 7 / 14 / 30 / 180 dias / Personalizado.
  Corrigido bug em que o card de métricas reais ignorava o período selecionado (estava
  fixo em "últimos 30 dias").
- **Seleção de campanhas por projeto** (`meta_integrations.selected_campaign_ids`): para
  quando a mesma conta de anúncios atende vários projetos. Em Configurações → "Campanhas
  deste projeto", lista todas as campanhas da conta (via nova ação `list_campaigns` da
  Edge Function) e deixa marcar quais pertencem a este projeto. A sincronização e a
  leitura dos dados respeitam essa seleção — corrigido um bug em que campanhas removidas
  da seleção continuavam aparecendo até a próxima sincronização.
- **Leads e matrícula reais via webhook** (`project_webhooks` + `crm_leads`): nova Edge
  Function pública `crm-webhook` (sem exigir login — é chamada pelo CRM/site do
  cliente). Em Configurações → "Webhook de Leads", gera uma URL única por projeto
  (`?project=<id>&token=<secret>`). O CRM manda um POST com `external_id`, dados de
  contato, UTM e `status`; reenviar o mesmo `external_id` com status diferente (ex:
  `MATRICULADO`) atualiza o lead em vez de duplicar. O Dashboard mostra um card com
  total de leads, matriculados e % de matrícula, tudo a partir desses dados reais —
  substitui os 277 leads / 34 vendas fictícios citados na solicitação original.

**Ainda não migrado**: a página Leads (lista individual, histórico) e Comercial (funil de
vendedores) continuam mostrando o dataset mock.

## 4c. Terceira atualização — modelo global de contatos/leads/vendas

Seguindo a "Documentação de Implementação — Próximas Otimizações" (anexada pelo usuário),
o modelo de `crm_leads`/`project_webhooks` (por projeto) foi **substituído** por um modelo
global por cliente:

- **`contacts`**: pessoa única dentro do cliente, identificada por telefone ou e-mail
  normalizado (dedupe automático — o mesmo contato em dois projetos do mesmo cliente não
  duplica).
- **`lead_events`**: uma linha por entrada/cadastro, ligada a um contato e a um projeto.
- **`sales`**: venda ligada a contato+projeto, com referência opcional ao `lead_event` mais
  recente do contato naquele projeto (atribuição simples, sem first/last touch ainda).
- **`webhook_inbox`**: blindagem — todo payload bruto é salvo aqui antes de qualquer
  tentativa de normalizar/atribuir. Se o processamento falhar, o evento fica com status
  `FAILED` mas nunca é perdido.
- **`project_integrations`**: roteamento por código externo curto (ex:
  `ENGENHARIA_DE_DADOS_E_IA`) gerado a partir do nome do projeto, em vez de expor o UUID.

Duas Edge Functions **globais** (uma URL para todos os clientes/projetos):
`webhook-leads` e `webhook-sales`. Autenticação via header `x-webhook-secret`; roteamento
via campo `project` no corpo. Normalizam aliases comuns de UTM (`utmSource`, `source`,
`campaign_name`, etc.) e calculam `attribution_status` (`COMPLETE`/`PARTIAL`/`NONE`) a
partir dos IDs de campanha/conjunto/anúncio e das UTMs recebidas.

Testado de ponta a ponta: dois leads com o mesmo telefone em requisições separadas
resultaram em 1 contato + 2 lead_events (não duplicou a pessoa); uma venda para o mesmo
telefone foi associada ao contato correto e apareceu no Dashboard como 100% de conversão.
Testado também: secret inválido é rejeitado com 401 sem tocar no banco.

## 4d. Quarta atualização — Metas reais, Central de Configurações e status/criativos Meta

- **Metas e pacing reais no Dashboard**: novo card "Ritmo do Período" — investimento e
  leads reais (Meta + webhook) comparados com a meta, o esperado até hoje (pró-rata pelos
  dias decorridos) e a projeção de fim de período. Usa `project_goals`, que já existia da
  Fase 1 mas não tinha nenhuma tela de edição depois da criação do projeto.
- **Central de Configurações**: Configurações do projeto ganhou as seções que faltavam —
  "Geral" (nome, status, timezone, moeda) e "Metas do mês atual" (todas as 7 metas,
  editáveis a qualquer momento, com histórico de períodos anteriores nunca sobrescrito,
  igual ao que já valia para `project_goals` desde a Fase 1).
  **Não implementado**: sincronização automática agendada (cron) — exigiria a
  `service_role key` do Supabase para autenticar chamadas periódicas à Edge Function, e
  essa chave não deve ser obtida/embutida em migration por mim. Requer configuração manual
  futura (pg_cron + Vault, ou um cron externo) com a chave fornecida por vocês.
- **Status real e criativos (Meta)**: nova tabela `meta_entities` guarda o status real
  (ACTIVE/PAUSED/ARCHIVED) de campanhas e anúncios, e a thumbnail do criativo de cada
  anúncio — mostrados agora como badge/imagem nas tabelas de Campanhas e Anúncios.
  Sincronizado por uma ação separada (`sync_entities`) da Edge Function `meta-ads`: juntar
  isso com a sincronização de métricas de 180 dias numa chamada só estourava o tempo de
  execução em contas grandes (25 campanhas / 120+ anúncios) — corrigido dividindo em duas
  chamadas encadeadas a partir do botão "Sincronizar agora".
  **Conjuntos de anúncios (adsets) como nível próprio de navegação, com tela de detalhe
  dedicada, não foram implementados** — o nome do conjunto já é capturado e mostrado como
  subtítulo nas tabelas de Anúncios, mas não existe uma página `/conjuntos/:id` real ainda.

**O que ainda falta do roadmap do documento** (é extenso — não cabe numa sessão):
attribution_status ainda não é exposto/usado na UI; não há fila de reprocessamento nem
Dead Letter Queue visual; não há Central de Atenção, Health Score, anomalias ou IA
explicativa; a hierarquia Meta ainda não inclui conjuntos de anúncios (adsets) nem
status/criativos reais; metas/pacing reais ainda não foram reconstruídas; e as páginas
Leads/Comercial dedicadas ainda mostram o dataset mock (só o card resumo do Dashboard é
real). Ordem sugerida para continuar: Sprint 1 (fechar remoção de mocks nas páginas
Leads/Comercial) → Sprint 4 (metas/pacing reais) → Sprint 2 (hierarquia Meta completa).

## 5. O que já é real vs. o que ainda é mock

| Página | Status |
| --- | --- |
| Configurações (token, teste, sync) | ✅ Real |
| Dashboard → card "Métricas Reais (Meta Ads)" | ✅ Real (nível conta) |
| **Campanhas** (lista) | ✅ Real quando `CONNECTED` — nome, investimento, leads, CPL, cliques, CTR, alcance |
| **Anúncios** (lista) | ✅ Real quando `CONNECTED` — nome, campanha/conjunto, investimento, leads, CPL, cliques, CTR, CPM |
| Detalhe de campanha / anúncio (drill-down) | ❌ Ainda mock — a página assume IDs do dataset de demonstração |
| Dashboard → gráfico de evolução, wave/gantt, heatmaps, ranking de anúncios, pacing/metas do mês | ❌ Ainda mock (`bindDemoDataset`) |
| Leads (lista individual, UTM, histórico) | ❌ Mock — exige a API de Lead Ads da Meta (formulário) ou webhook de CRM, não vem do Ads Insights |
| Comercial (funil de vendas, matrícula, ranking de vendedores) | ❌ Mock — não existe no universo da Meta; precisa de CRM próprio |

Quando um projeto **não** tem integração conectada, Campanhas e Anúncios continuam
mostrando o dataset de demonstração normalmente — nada quebra para quem ainda não
configurou a Meta.

Para fechar o resto do sistema com dados reais, os próximos passos são:
1. Refazer Campanha/Anúncio detalhe (drill-down) usando `meta_ad_insights_daily`.
2. Substituir gráfico de evolução diária, wave/gantt e heatmaps por séries reais
   (a granularidade horária exige `breakdowns=hourly_stats_aggregated_by_advertiser_time_zone`,
   uma chamada extra à Graph API).
3. Leads individuais: só saem do mock com uma integração separada — Lead Ads API
   (para formulários nativos da Meta) e/ou webhook do CRM da faculdade.
4. Comercial/matrícula: 100% depende de um CRM externo; não tem como vir da Meta.

## 6. Achamos um dado real durante o teste

Ao verificar o banco após os testes, a linha do projeto **MBA Direito** já tinha um
`ad_account_id` real (`590863113865895`) salvo, sem token testado ainda — indício de
que alguém já abriu a tela e começou a preencher em paralelo. Nada foi alterado nessa
linha.
