# Dashboard financeiro de disparos — plano de implementação

## Objetivo

Transformar o item administrativo **Disparo** em uma área **Disparos** com duas rotas reais: **Dashboard** (entrada principal) e **Demandas** (Kanban atual). O Dashboard deve registrar e conciliar volume enviado, receita, custo do fornecedor, depósitos na Infobip e seus comprovantes.

## Premissas do MVP

- “CPF” será tratado na interface como **contato/mensagem faturável enviada**.
- O custo do fornecedor é um snapshot por demanda, inicialmente **R$ 0,16 por envio** e editável.
- A receita é o valor total cobrado do cliente; lucro = receita − custo do fornecedor.
- Depósitos na Infobip são fluxo de caixa para conciliação e não reduzem o lucro novamente.
- Moeda única: BRL. Período inicial do Dashboard: mês atual.
- Comprovantes: PDF, PNG, JPG ou WEBP, até 16 MiB, em bucket privado com link temporário.

## Fase 1 — Persistência financeira e segurança

**Arquivos:**
- `supabase/migrations/0018_disparo_finance_dashboard.sql`
- `src/integrations/supabase/database.types.ts`
- `src/services/disparoFinance.service.ts`
- `src/services/disparoTasks.service.ts`

1. Adicionar snapshots financeiros em `disparo_tasks`: quantidade contratada, quantidade enviada, valor cobrado e custo unitário do fornecedor.
2. Criar `disparo_financial_settings` por organização com custo padrão de 0,1600 BRL.
3. Criar `infobip_deposits` com valor, data, status, referência, observação e caminho privado do comprovante.
4. Aplicar checks numéricos, índices, timestamps, auditoria e RLS ADMIN + organização.
5. Criar bucket privado `infobip-receipts` e policies por organização no primeiro segmento do path.
6. Implementar serviço tipado: configurações, resumo por período, depósitos, upload compensado e signed URL.

**Validação:** migration revisada; TypeScript compila; nenhuma URL pública de comprovante.

## Fase 2 — Captura financeira nas demandas

**Arquivos:**
- `src/components/disparo/DisparoTaskModal.tsx`
- `src/services/disparoTasks.service.ts`

1. Adicionar bloco “Financeiro” ao formulário da demanda.
2. Campos: contratado, enviado, custo unitário e valor cobrado.
3. Mostrar cálculo imediato de custo, lucro e margem, sem persistir derivados.
4. Preservar snapshots ao alterar o custo padrão futuro.
5. Manter validação, responsividade, labels e fluxo salvar/avançar existentes.

**Validação:** criar e editar demanda; cálculos com zero e valores decimais; build e lint.

## Fase 3 — Dashboard e conciliação Infobip

**Arquivos:**
- `src/pages/admin/DisparoDashboardPage.tsx`
- `src/services/disparoFinance.service.ts`

1. Criar filtro mensal e carregar dados uma vez por período.
2. KPIs: receita, custo do fornecedor, lucro bruto, margem, mensagens enviadas, depósitos Infobip e saldo de conciliação.
3. Gráfico comparativo receita × custo × lucro e tabela por demanda/cliente.
4. Criar lançamento Infobip com valor, data, status, referência, observação e comprovante opcional.
5. Listar depósitos e permitir abrir/baixar comprovante por URL assinada.
6. Exibir claramente que saldo de conciliação = depósitos Infobip − custo calculado do fornecedor.

**Validação:** estados loading/erro/vazio; upload privado; cálculos agregados; layout desktop e mobile.

## Fase 4 — Navegação e nomenclatura

**Arquivos:**
- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/pages/admin/DisparoKanbanPage.tsx`

1. Criar `/agency/disparo/dashboard` e `/agency/disparo/demandas`.
2. Redirecionar `/agency/disparo` para o Dashboard para preservar links antigos.
3. Substituir item plano por grupo “Disparos” com Dashboard e Demandas.
4. Renomear o cabeçalho do Kanban para “Demandas de disparo”.

**Validação:** rotas diretas, refresh, estado ativo da sidebar e redirect legado.

## Fase 5 — Verificação integrada

1. Executar lint e build.
2. Verificar `/agency/disparo/dashboard` e `/agency/disparo/demandas` no localhost.
3. Testar criação/edição financeira, depósito, comprovante, download e reconciliação.
4. Confirmar que mídias públicas do disparo continuam separadas dos comprovantes privados.

## Fora do escopo deste MVP

- Importação automática de relatórios da API Infobip.
- Rateio de um depósito entre várias demandas.
- Contabilidade fiscal, contas a pagar completa ou múltiplas moedas.
- Métricas de entregue/lido; o faturamento usa a quantidade enviada informada pelo operador.
