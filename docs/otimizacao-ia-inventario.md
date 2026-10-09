# Inventário — módulo Otimização IA (Meta Ads)

Versão: 1.0 — 09/10/2026
Base: especificação `DOCUMENTACAO_MODULO_OTIMIZACAO_IA_META_ADS.md`, seção 0 (procedimento obrigatório).

## 1. Stack real (diverge da especificação em alguns pontos)

| Item | Especificação | Projeto real |
|---|---|---|
| Front | Next.js ou equivalente | Vite + React 19 + TypeScript + Tailwind + lucide-react |
| Banco/Auth | PostgreSQL/Supabase | Supabase (projeto `ibtdjnbefsltgguoopih`), RLS e funções `private.current_organization_id()` |
| Tenant | `tenant_id` | `organization_id` (todas as tabelas Meta já usam esse campo) |
| Rotas | `/api/optimization/*` | Rotas React em `src/routes`; dados via Supabase e Edge Functions, sem API REST própria |
| Agendamento | worker/queue | `pg_cron` chamando Edge Function (padrão de `0054_meta_daily_report.sql`) |
| Versão Graph | fixar versão testada | `GRAPH_VERSION = 'v24.0'` em `supabase/functions/meta-proxy/index.ts` |
| IA | serviço de IA | Nenhum provedor de IA no código hoje (sem chamadas a Anthropic/OpenAI/Gemini) |

## 2. O que já existe e será reaproveitado

### Autenticação e permissões
- Papéis e membership existentes (`organization_id`). Não refazer login.
- Ferramenta por agência: `agency_tool_permissions` com a chave `meta_ads` (`0039_agency_tool_permissions.sql`, `0052_agency_tools_union_keys.sql`) e a rota `AgencyToolRoute tool="meta_ads"` em `src/routes`.
- Já há dois níveis de acesso à ferramenta: ver e operar. O módulo novo deve herdar essa chave ou criar uma chave `optimization_ia` na mesma tabela.

### Conexão Meta
- `meta_oauth_connections` (uma conexão por agência, admin-only) e `private.meta_oauth_secrets` (token sem policy). Não duplicar.
- `meta_publishing_profiles` e `meta_publishing_profile_users`: perfis de publicação por usuário.
- `meta_integrations` (credenciais legadas por projeto, admin-only). Confirmar se ainda é usada antes de escolher a conexão.
- Edge Function `meta-proxy`: único caminho para a Graph API. O token nunca vai ao navegador. Já tem:
  - lista de operações (`get`, `post`, `batch`, `update`, `video_status` etc.);
  - validação de caminho (`path_not_allowed`);
  - validação de parâmetros de escrita (`updateParamsError`: status em {ACTIVE, PAUSED}, orçamento com dígitos, nome ≤ 400);
  - retry de rede e erro de conexão ausente (`meta_not_connected`, `meta_token_expired`).
- Ponto de atenção: o `meta-proxy` não tem limitador de taxa por conta nem controle de concorrência entre usuários. Foi a causa do aviso "Limite de requisições da Meta" ao publicar lotes. O executor do módulo novo precisa de fila/lock por conta antes de escrever.

### Dados de campanhas e métricas
| Tabela | Conteúdo | Uso no módulo |
|---|---|---|
| `meta_entities` | Árvore campanha/conjunto/anúncio (`0011`) | Navegação e elegibilidade |
| `meta_insights_daily` | Métricas diárias por conta (`0021`, `0007`) | Base de `optimization_snapshots` |
| `meta_ad_insights_daily` | Métricas diárias por anúncio | Regras no nível de anúncio |
| `meta_report_campaigns` | Campanhas selecionadas por organização/conta (`0054`) | Escopo de perfis (equivale a `optimization_profile_targets`) |
| `meta_report_daily`, `meta_report_state` | Resumo diário e estado de sincronização (`0054`) | Modelo para `optimization_sync_runs` |
| `crm_leads`, `lead_events` | Leads e eventos do CRM (`0009`, `0055`) | Fonte confiável para CPL/CPA por lead |

### Agendamento
- `meta-daily-report` (Edge Function + `pg_cron` + `meta_report_cron_config` com segredo de cron, `0054`/`0056`). É o modelo para os jobs de coleta a cada hora e de avaliação a cada 3 horas.

### Interface
- `src/pages/admin/MetaAdsToolPage.tsx`: abas Publicar, Editor em massa, Campanhas e Resumo diário. A aba "Otimização IA" entra aqui como nova aba, sem trocar o layout.
- `src/components/ads/MetaBulkEditor.tsx` e `src/lib/metaBulkEdit.ts`: reaproveitar componentes de tabela, painel lateral e confirmação com "Desfazer".
- `src/components/ads/MetaCampaignUrls.tsx` e `MetaDailyReportPanel.tsx`: padrão visual de cards e de tabela.
- `src/services/metaAds.service.ts`, `metaDailyReport.service.ts`, `metaOAuth.service.ts` e `src/lib/metaGraph.ts`: ponte com a Edge Function. Reutilizar; não criar cliente novo.

### Já existe, reaproveitar como está
- Validação de URL e de compliance (`src/lib/metaCompliance.ts`).
- Helpers de criativo e orçamento (`src/lib/metaBulkEdit.ts`: `nextBudgetCents`, `isAggressiveBudgetChange` com limite de 20%, `formatBRL`, `parseReais`).

## 3. O que precisa ser criado

Tabelas (prefixo `optimization_`, todas com `organization_id` e RLS):
- `optimization_profiles`, `optimization_profile_targets`, `optimization_rules`
- `optimization_snapshots`, `optimization_sync_runs`
- `optimization_evaluations`, `optimization_recommendations`
- `optimization_actions`, `optimization_approvals`
- `optimization_budget_policies`, `optimization_alerts`
- `optimization_ai_analyses` (só na PR 4)

Código:
- `src/features/optimization/` conforme seção 6 da especificação, com `domain/` (regras, guardrails, conflitos) em funções puras e testadas.
- Executor como Edge Function separada, com lock por recurso e idempotência, chamando `meta-proxy` (ou compartilhando o validador).
- Chave de ferramenta e permissões por papel (seção 13).

## 4. Riscos identificados

1. **Cota da conta de anúncios.** Coleta horária somada a publicação em lote e à aba de métricas pode bater no limite (códigos 4, 17, 32, 80004). Coletar com fila e espaçamento por conta antes de habilitar qualquer escrita.
2. **Janela de atribuição.** `meta_insights_daily` é reconciliado pela Meta com atraso. Regras destrutivas só com janela de 3+ dias e dados `OK` (seção 12).
3. **Escrita sem executor único.** Hoje a escrita está espalhada entre `MetaAdCreator.jsx`, `MetaBulkEditor.tsx` e `metaBulkEdit.ts`. O executor do módulo precisa ser o único caminho de escrita automática; as telas atuais continuam manuais.
4. **Orçamento CBO/ABO.** O editor atual escreve orçamento no nível escolhido pelo usuário, sem checar se o nível controla o gasto. O validador novo precisa ler `daily_budget`/`lifetime_budget` da campanha e do conjunto antes de qualquer escrita.
5. **Sem provedor de IA.** A PR 4 precisa de chave de API em segredo do servidor e de um orçamento de custo por organização.
6. **Token vencido.** Já houve conexão Meta vencida em outubro de 2026. O estado `TOKEN_EXPIRED` precisa aparecer na aba e suspender ações.

## 5. O que foi entregue (09/10/2026)

| Item | Onde |
|---|---|
| Permissão `optimization_ia` e item "Otimização IA" no menu, abaixo de Ferramentas | `0058_optimization_ia_tool_permission.sql`, `Sidebar.tsx`, `App.tsx` |
| Tabelas, RLS (só leitura para quem tem a ferramenta) e cron de hora em hora | `0059_optimization_ia.sql` |
| Motor determinístico: métricas, DSL validada, 9 regras padrão, estratégias, guardrails, conflitos e conferência antes de escrever | `supabase/functions/optimization-ia/engine.ts` (testes em `tests/optimization-engine.test.ts`) |
| Edge Function única (`verify_jwt` falso, autenticação própria: segredo do cron ou JWT + ferramenta) | `supabase/functions/optimization-ia/index.ts` |
| Telas: Visão geral, Campanhas, Automações, Diagnósticos, Aprovações, Histórico, Configurações | `src/pages/admin/OptimizationAiPage.tsx`, `src/components/optimization/` |

Decisões:
- Usa a mesma conexão Meta da agência (`meta_oauth_connections` + `meta_oauth_secret_get`), sem token novo.
- Toda escrita passa pela Edge Function `optimization-ia`; o navegador não grava nas tabelas.
- Modo padrão "Somente observar". "Com aprovação" só por administrador. "Automático limitado" recusado pelo servidor até haver piloto.
- Parada de emergência: qualquer usuário com a ferramenta liga; só administrador desliga.
- Janela de análise termina ontem, no fuso da conta.
- O motor só pausa, reduz ou aumenta orçamento diário. Nunca reativa nada.

## 6. Pendências

- PR 4 (diagnóstico com modelo de IA): não há provedor de IA configurado. Hoje os diagnósticos vêm do catálogo de regras (causas, sugestão e risco). Para ligar um modelo é preciso uma chave de API como segredo da Edge Function e um teto de custo por organização.
- PR 5 (automático limitado): depende de um piloto em "Com aprovação" com conta real.
- Reversão de uma ação executada: hoje é feita manualmente no Editor em massa; a ação de reverter auditada ainda não existe.
- Eventos de conversão por cliente: cada perfil escolhe o seu; vale revisar com o time qual evento usar em cada conta.
