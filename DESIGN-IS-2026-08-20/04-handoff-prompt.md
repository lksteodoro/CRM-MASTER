````text
/make-plan Redesign Kanban de Demandas da Agência. Current design failed audit at 15/30 with critical gaps in principles #4 (understandable), #6 (honest), #8 (thorough) and #9 (environmentally friendly).

Verdict paragraph:
> O Kanban deve ser redesenhado em sua experiência de operação, não apenas estilizado: a base de criação e arrastar funciona, mas a hierarquia para volume, a clareza de termos, a honestidade do arquivamento e a acessibilidade ainda falham em dimensões essenciais.

Why redesign and not refine: o fluxo básico existe, mas termos, estados e acessibilidade alteram a compreensão e confiança do usuário, não apenas a aparência.

Preserve from current design:
- Tema escuro, tokens de painel/borda e cards discretos em `src/pages/admin/AgencyKanbanPage.tsx:79-119`.
- Persistência por arrastar e soltar em `src/pages/admin/AgencyKanbanPage.tsx:161-237`.
- Modal de criação/edição e dados existentes em `src/components/agency/AgencyTaskModal.tsx:15-226`.

Discard:
- Três pontos concorrentes para criar a mesma tarefa. Evidência: `src/pages/admin/AgencyKanbanPage.tsx:90-119,299-317`. Causa atrito na princípio #10.
- Uso de “Backlog” e Arquivados sem comportamento correspondente. Evidência: `src/services/agencyTasks.service.ts:7-12,31-118`. Causa falha em #4 e #6.

Top moves from the audit:
1. #2 Útil: criar uma barra de operação com busca, filtro de responsável/categoria/prazo e ordenação por urgência. Evidência: `src/services/agencyTasks.service.ts:21-29` não aplica filtros ou limite.
2. #4 Entendível: trocar “Backlog” por “Entrada” e tornar card clicável distinto de alça de arrastar, com teclado. Evidência: `src/services/agencyTasks.service.ts:7-12`; `src/components/agency/AgencyTaskCard.tsx:39-56`.
3. #6 Honesto: trocar “Arquivados” por “Histórico” até haver uma ação e job reais de arquivamento; remover qualquer promessa automática sem backend. Evidência: `src/pages/admin/AgencyKanbanPage.tsx:299-305`; `src/services/agencyTasks.service.ts:31-118`.
4. #8 Minucioso: implementar confirmação de salvamento, modal acessível e estados de erro por coluna. Evidência: `src/components/agency/AgencyTaskModal.tsx:80-220`.
5. #9 Sustentável: dividir o bundle de áreas administrativas e carregar dependências pesadas só quando sua rota for aberta. Evidência: build de 20/08/2026, JS principal 1,416 MB bruto.

Redesign principles in priority order:
1. #2 Útil — decidir a próxima tarefa em poucos segundos mesmo com muitas demandas.
2. #4 Entendível — cada controle deve declarar claramente se abre, move, cria ou filtra.
3. #10 Menos design — uma ação de criação principal, informações de card por prioridade e chrome silencioso.

Deliverables for the plan:
- Nova arquitetura de informação e wireframe baixo-fidelidade comparado ao quadro atual.
- Estados de vazio, carregamento, erro, sucesso, foco e desabilitado.
- Caminho de migração preservando as quatro colunas e tarefas existentes.
- Critério de corte para aposentar a interface atual.

Anti-patterns:
- Não portar a estrutura antiga apenas com CSS novo.
- Não manter os dois quadros em paralelo indefinidamente.
- Não prometer arquivamento ou produtividade sem comportamento implementado.
````
