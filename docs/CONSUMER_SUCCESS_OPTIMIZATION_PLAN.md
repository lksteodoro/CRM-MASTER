# Consumer Success — plano de implementação

## Objetivo
Centralizar relacionamento com grupos de clientes: seleção única, múltipla ou todos os clientes ativos; abordagens escritas pela agência, personalização, rodízio sem repetição consecutiva, envio imediato e recorrente, gestão e histórico organizado.

## Fase 0 — descoberta e contratos
- Base: `src/services/consumerSuccess.service.ts`, `src/components/consumerSuccess/CsScheduledPanel.tsx`, `src/pages/admin/ConsumerSuccessPage.tsx`, migrações 0043–0047 e funções `cs-evolution` / `cs-run-scheduled`.
- Clientes ativos usam `clients.status = 'ACTIVE'`. Cada organização possui uma integração Evolution.
- Reutilizar `supabase.from(...).select/insert/update`, `supabase.rpc`, `supabase.functions.invoke` e endpoint Evolution `/message/sendText/{instance}` já existentes.
- Documentação de filas: https://www.postgresql.org/docs/17/sql-select.html (FOR UPDATE SKIP LOCKED).
- Cron: https://supabase.com/docs/guides/cron/quickstart (30 seconds requer versão compatível; fallback explícito de um minuto).
- Não há configuração Supabase CLI nem ambiente local SQL pronto. Não enviar mensagens reais durante os testes.

## Fase 1 — banco e execução confiável
Preservar `cs_scheduled_messages` e migrar os agendamentos atuais. Adicionar destinatários, variantes, rodízio, múltiplos dias da semana e próximo envio calculado no banco. Grupos ganham saudação e pausa de automação.

Criar fila por programação/ocorrência/grupo com chave única, reivindicação atômica, tentativas limitadas e estado de resultado incerto sem reenvio automático. Resolver clientes ativos no momento da ocorrência e revalidar antes do envio. Avançar o rodízio por grupo após confirmação. Manter relógio/fuso do servidor como referência. Expor RPCs de relógio e envio imediato. Reduzir ciclo do cron conforme compatibilidade, sem promessa de entrega exata.

Referências: migrações 0043/0045/0046, worker existente e documentação SQL acima. Verificação: datas/fuso, recorrências, seleção dinâmica, personalização, pausa, concorrência, falhas e preservação dos registros. Evitar envio no navegador, retries cegos, clientes de outra organização e incremento do rodízio antes do sucesso.

## Fase 2 — serviço e experiência
Reutilizar componentes de formulário, estados de carregamento e estilos do sistema. Organizar abas Programações, Grupos, Conversas e Histórico. Exibir resumos operacionais; busca e filtros; seleção de grupos/clientes; saudação e pausa. Editor com destinatários, abordagens, frequência e prévia antes de salvar. Reutilizar mesma programação para envio imediato, informando a quantidade prevista e o estado de fila. Rodízio sequencial ou aleatório sem repetir a abordagem anterior. Não gerar afirmações de trabalho realizado: textos são definidos pelo usuário.

Referências: `CsScheduledPanel`, `CsInbox`, `ConsumerSuccessPage`, `agencyTools.service`. Verificação: build TypeScript, lint, formulários desktop/mobile e estados vazios/erro. Evitar dados de exemplo em produção, exposição de credenciais e previsões usando fuso do computador.

## Fase 3 — revisão e entrega
Revisão independente do contrato UI/banco/worker, testes de regressão relevantes e inspeção visual local com dados fictícios isolados quando não houver sessão autenticada. Documentar implantação, compatibilidade de cron e limitações verificadas. Não aplicar migrações remotas nem disparar WhatsApp como teste. Não fazer push/commit sem necessidade para entregar as alterações locais.

## Critérios de aceite
1. Uma programação atende um, vários ou todos os grupos de clientes ativos.
2. Cada grupo recebe saudação personalizada e histórico individual.
3. Várias abordagens alternam sem repetição consecutiva quando distintas.
4. Envio único, imediato, diário, semanal com vários dias e mensal funcionam no servidor.
5. Pausas e clientes inativos são respeitados, inclusive em fila.
6. Execuções concorrentes não reivindicam a mesma entrega; resultado incerto fica visível.
7. Agendamentos existentes são preservados e a tela mostra estados e próximo horário do servidor.
8. Compilação e testes apropriados passam; dependências externas pendentes são explicitadas.
