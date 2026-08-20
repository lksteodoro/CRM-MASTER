# Plano: mini painel de demandas e disparos por cliente

## Objetivo

Permitir que cada cliente envie sua própria demanda de disparo em um mini painel isolado, com foto de perfil, DDD, copy, link, lista e data desejada. O sistema deve higienizar a lista automaticamente, calcular os contatos válidos e criar uma demanda completa diretamente na primeira etapa `Pedido` do Kanban. Sender, etiqueta e quantidade ficam sob responsabilidade da agência. O cliente não cria transmissão e não dispara mensagens.

O envio para a Infobip, templates, testes, aprovação e disparo ficam fora do mini painel e continuam sob responsabilidade da agência. A aplicação não deve prometer funcionamento offline: a consulta/higienização pode ser preparada localmente, mas integrações dependem de internet.

## Diagnóstico atual

- `src/pages/admin/DisparoKanbanPage.tsx` contém o quadro administrativo com oito etapas: Pedido, Pagamento, Número e perfil, Template e mídia, Lista, Teste, Disparo e Finalizado.
- `src/components/disparo/DisparoTaskModal.tsx` já coleta cliente, data/horário, financeiro, WABA/número, etiquetas, links, copy, foto, imagem, vídeo e arquivo de lista.
- `src/services/disparoTasks.service.ts` faz CRUD e upload, mas não higieniza listas nem envia mensagens.
- `src/lib/listSanitizer.ts` já normaliza telefones, remove duplicados e separa inválidos, mas só é usado pela tela independente `ListSanitizerPage.tsx`.
- `infobip_broadcast_drafts` e `infobip_broadcast_items` já guardam rascunhos internos, mas não devem ser criados pelo cliente nesta primeira versão.
- As telas de disparo atuais ficam sob `AdminRoute`; as policies de `disparo_tasks`, `disparo_tags` e rascunhos exigem `private.is_admin()`. O cliente ainda não possui portal de demandas.

## Fase 0 — documentação e contratos (obrigatória antes do código)

Fontes consultadas:

- `src/components/disparo/DisparoTaskModal.tsx` e `src/services/disparoTasks.service.ts`: campos e persistência do card atual.
- `supabase/migrations/0017_disparo_kanban_media.sql`: tabelas, relações, Storage e RLS atuais.
- `src/lib/listSanitizer.ts` e `src/pages/admin/ListSanitizerPage.tsx`: contrato de higienização existente.
- `supabase/migrations/0002_functions_triggers.sql`, `0003_rls_policies.sql` e `0005_harden_security.sql`: organização, `client_users`, `has_client_access` e permissões.
- [Infobip — template messages](https://www.infobip.com/docs/whatsapp/message-types-and-templates/message-templates): templates aprovados são necessários fora da janela de 24 horas.
- [Infobip — enviar template](https://www.infobip.com/docs/tutorials/send-whatsapp-template-messages): sender deve estar registrado e a API Key precisa do escopo de envio.

Contratos que não devem ser inventados:

- Não enviar lista diretamente do navegador para a Infobip; a API Key deve permanecer na Edge Function.
- Não usar `disparo_tags` como se fossem etiquetas de contatos: hoje elas etiquetam tarefas do Kanban.
- Não expor `file_url` público para listas com telefones; usar bucket privado e URL assinada ou processar o arquivo no servidor.
- Não liberar a rota do cliente dentro de `AdminRoute`.

Verificação: confirmar os campos finais e o endpoint de envio da Infobip antes da Fase 5.

## Fase 1 — portal isolado do cliente e perfil padrão

### Implementar

- Criar rota autenticada de cliente, por exemplo `/client/disparos/nova` e `/client/disparos`.
- Mostrar somente o `client_id` vinculado ao usuário em `client_users`.
- Criar um “Perfil padrão de disparo” por cliente, reutilizado nas novas demandas:
  - nome do perfil;
  - DDD;
  - foto de perfil/capa;
  - data da última alteração.
- Ao abrir uma nova demanda, carregar o perfil padrão automaticamente. O cliente poderá alterar os dados naquela demanda e escolher se deseja atualizar o padrão.
- Salvar um snapshot dos dados do perfil dentro de cada demanda para preservar o histórico, mesmo que o perfil padrão mude depois.
- Criar formulário de demanda com:
  - nome do perfil e DDD preenchidos pelo padrão;
  - foto de perfil/capa preenchida pelo padrão;
  - copy/corpo da mensagem;
  - link completo e link de destino;
  - arquivo CSV da lista;
  - data e horário desejados;
  - observações.
- Mostrar ao cliente apenas suas demandas e seus próprios status.

### Banco e segurança

- Adicionar status de demanda: `SUBMITTED`, `IN_REVIEW`, `PENDING_CLIENT`, `APPROVED`, `DRAFT_READY`, `SCHEDULED`, `SENDING`, `FINISHED`, `CANCELLED`.
- RLS de `INSERT`: cliente só pode criar com seu próprio `client_id`.
- RLS de `SELECT/UPDATE`: cliente só pode acessar demandas do próprio cliente; ADMIN vê a organização inteira.
- Validar no banco, não apenas no React, que `client_id` pertence ao usuário.
- Isolar uploads por `organization_id/client_id/demand_id`.

### Aceite

- Um cliente não consegue consultar, editar ou inferir IDs de outro cliente.
- ADMIN continua vendo o quadro completo.
- O cliente consegue enviar uma demanda sem acessar Templates, API Key, sender de outro cliente ou rascunhos internos.

## Fase 2 — higienização automática da lista

### Implementar

- Ao receber CSV, executar o parser e mapeamento de colunas já existente.
- Detectar automaticamente nome, sobrenome e telefone; permitir ajuste quando a coluna não for reconhecida. A etiqueta não será definida pelo cliente.
- Mostrar resumo antes de confirmar: linhas recebidas, válidos, inválidos, duplicados e vazios.
- Salvar arquivo original e arquivo higienizado separadamente.
- Persistir `original_lead_count`, `valid_lead_count`, `invalid_lead_count`, `duplicate_lead_count` e o mapeamento utilizado. A quantidade é sempre calculada pelo sistema, nunca informada manualmente pelo cliente.
- Aplicar limite de 5.000 contatos por lote/template; listas maiores devem ser divididas manualmente ou em sublotes explícitos.
- Criar regra de mínimo operacional: uma demanda com menos de 1.000 contatos válidos pode ser criada e analisada, mas fica bloqueada para avançar ao envio até atingir 1.000 válidos.

### Aceite

- O cliente vê a prévia e confirma a lista limpa.
- Telefones ficam em formato internacional, duplicados não entram na transmissão e inválidos ficam auditáveis.
- Nenhum arquivo de telefone fica acessível por URL pública.
- O sistema exibe claramente “X válidos; mínimo para envio: 1.000”.

## Fase 3 — criação automática da demanda no primeiro estágio

### Implementar

- Ao confirmar o formulário, criar automaticamente um `disparo_task` com status `pedido`.
- Copiar para a demanda: `client_id`, usuário solicitante, snapshot do nome do perfil, DDD, foto de perfil/capa, copy, link, arquivo original, arquivo higienizado, quantidades calculadas, data, horário e observações.
- Deixar sender e etiqueta vazios na entrada; a agência define ambos durante as etapas internas.
- Gravar o resumo da higienização no próprio card para o operador não precisar reprocessar a lista.
- Não criar transmissão, não escolher template definitivo e não chamar endpoint de envio nessa etapa.
- Mostrar ao cliente o número da demanda e o status `Enviado para análise`.
- No Kanban, o operador abre a demanda e continua nas etapas Número e perfil, Template e mídia, Lista, Teste, Disparo e Finalizado.
- Registrar histórico de criação e alterações feitas pelo cliente.

### Aceite

- Toda demanda nova aparece em `Pedido` e não em outra coluna.
- Uma demanda criada pelo cliente nunca inicia transmissão automaticamente.
- A agência pode corrigir template, sender ou link sem perder o arquivo original.
- Alterar o perfil padrão não altera demandas antigas, pois cada uma possui seu snapshot.

## Fase 4 — painel operacional da agência (continuação do fluxo)

### Implementar

- No card de Demanda, substituir a coleta manual por um resumo operacional completo recebido do cliente.
- Ações: revisar lista, corrigir mapeamento, escolher template aprovado, testar sender, aprovar, devolver pendência e abrir rascunho.
- Exibir checklist já existente com preenchimento automático baseado nos dados reais.
- Mostrar preview da mensagem e uma amostra de contatos antes do envio.
- Mostrar o limite, a quantidade calculada e o bloqueio de mínimo de 1.000 válidos.

### Aceite

- O operador não precisa copiar manualmente dados entre Card, Higienizador e Transmissões.
- Cada item do rascunho tem template e lista identificáveis.
- Pendências retornam ao cliente com comentário e prazo.

## Fase 5 — fora do escopo inicial: execução controlada na Infobip

### Implementar

- Criar Edge Function exclusiva para envio de mensagens template somente em uma fase futura, após a operação do Kanban estar validada.
- Ler credenciais no servidor; nunca no frontend.
- Enviar em fila com idempotência por `draft_item_id + contact_id`.
- Controlar status por contato: `QUEUED`, `SENDING`, `ACCEPTED`, `DELIVERED`, `FAILED`.
- Implementar retry somente para erros transitórios, limite de taxa, pausa e cancelamento.
- Receber callbacks/webhooks da Infobip para entrega e falha.
- Não iniciar envio sem confirmação explícita da agência.

### Aceite futuro

- O sistema não duplica mensagens ao repetir uma chamada.
- O painel mostra progresso real, falhas e motivo por contato.
- Um rascunho aprovado pode ser pausado e retomado.

## Fase 5 — auditoria e proteção de dados do MVP

- Relatório por cliente: demandas recebidas, listas, válidos, inválidos, duplicados e pendências.
- Auditoria de download, alteração de copy, troca de sender e aprovação.
- Expiração/remoção configurável dos arquivos originais e higienizados.
- Máscara de telefone em telas que não precisam do número completo.
- Testes RLS automatizados com dois clientes e um ADMIN.

## Ordem recomendada de execução do MVP

1. Fase 0 e validação dos campos do card.
2. Fase 1: portal e RLS.
3. Fase 2: higienização integrada.
4. Fase 3: mini painel → demanda em `Pedido`.
5. Fase 4: painel operacional.
6. Fase 5: auditoria, privacidade e testes RLS.

O envio real pela Infobip fica como evolução posterior, sem bloquear a entrega do mini painel.

## Decisões que precisam da sua validação

- O cliente poderá editar uma demanda depois de enviada ou somente responder pendências?
- O cliente apenas informa o texto/copy; a agência escolhe ou cria o template definitivo.
- A etiqueta é sempre definida pela agência.
- O sender é sempre definido pela agência; o cliente informa apenas o DDD de referência.
- O cliente informa data e horário desejados, mas a agência pode ajustar antes do envio.
- Ao alterar nome, DDD ou foto, o cliente poderá escolher entre alterar somente a demanda atual ou atualizar também o perfil padrão.
- A agência deve poder editar a demanda recebida sem devolver ao cliente?
- Arquivos originais devem ser apagados automaticamente após quantos dias?
