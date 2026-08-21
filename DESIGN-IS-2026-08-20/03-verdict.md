# Veredito: REDESIGN

O Kanban deve ser redesenhado em sua experiência de operação, não apenas estilizado: a base de criação e arrastar funciona, mas a hierarquia para volume, a clareza de termos, a honestidade do arquivamento e a acessibilidade ainda falham em dimensões essenciais.

Movimentos de maior impacto:

1. **#2 Útil:** criar uma barra de operação com busca, filtro de responsável/categoria/prazo e ordenação por urgência. Evidência: `src/services/agencyTasks.service.ts:21-29` não aplica filtros ou limite.
2. **#4 Entendível:** trocar “Backlog” por “Entrada” e tornar card clicável distinto de alça de arrastar, com teclado. Evidência: `src/services/agencyTasks.service.ts:7-12`; `src/components/agency/AgencyTaskCard.tsx:39-56`.
3. **#6 Honesto:** trocar “Arquivados” por “Histórico” até haver uma ação e job reais de arquivamento; remover qualquer promessa automática sem backend. Evidência: `src/pages/admin/AgencyKanbanPage.tsx:299-305`; `src/services/agencyTasks.service.ts:31-118`.
4. **#8 Minucioso:** implementar confirmação de salvamento, modal acessível e estados de erro por coluna. Evidência: `src/components/agency/AgencyTaskModal.tsx:80-220`.
5. **#9 Sustentável:** dividir o bundle de áreas administrativas e carregar dependências pesadas só quando sua rota for aberta. Evidência: build de 20/08/2026, JS principal 1,416 MB bruto.
