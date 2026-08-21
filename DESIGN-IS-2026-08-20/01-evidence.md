# Evidências

## Estrutura

- O quadro possui quatro colunas reutilizando o componente `Column`: `src/services/agencyTasks.service.ts:7-12`, `src/pages/admin/AgencyKanbanPage.tsx:57-124,331-345`.
- A criação existe em três pontos: botão global, ícone da coluna e estado vazio da coluna (`AgencyKanbanPage.tsx:90-119,299-317`).
- Os cards suportam clique e arrastar, porém o card é uma `div` sem semântica de botão: `src/components/agency/AgencyTaskCard.tsx:39-56`.
- Não há busca, filtros, ordenação ou limite na consulta de tarefas ativas: `src/services/agencyTasks.service.ts:21-29`.

## Visual e estados

- A referência do usuário mostra uma composição escura, centralizada, com cards de borda sutil e quatro colunas.
- O código usa escala concentrada de 10/12/14/16/24 px e espaçamentos de 8/12/16/24 px (`AgencyKanbanPage.tsx:79-119,282-317`; `AgencyTaskModal.tsx:10-13,80-186`).
- Estados presentes: vazio (`AgencyKanbanPage.tsx:112-120`), carregamento/erro (`AgencyKanbanPage.tsx:275-276`), foco em campos (`AgencyTaskModal.tsx:10-13`) e desabilitado em salvar/excluir (`AgencyTaskModal.tsx:197-220`).
- Estados ausentes ou incompletos: confirmação de salvamento, foco/teclado no card e comportamento explícito de diálogo/modal.

## Copy e honestidade

- A estrutura “Demandas / Organize as atividades internas por etapa.” é compatível com o comportamento de drag-and-drop (`AgencyKanbanPage.tsx:288-295,221-233`).
- “Backlog” mistura inglês com “A fazer”, “Fazendo” e “Finalizado” (`agencyTasks.service.ts:7-12`).
- “Arquivados” sugere ação/histórico, mas não existe comando de arquivar/reverter; apenas consulta de `archived_at` (`AgencyKanbanPage.tsx:299-305`, `agencyTasks.service.ts:31-40`).
- A antiga promessa de arquivamento diário não é implementada no serviço ou migrations: não há mutação de `archived_at` em `create/update/move` (`agencyTasks.service.ts:51-118`).

## Peso e fricção

- Build atual: JS principal 1.416 MB bruto / 380,82 KB gzip; CSS 88,64 KB bruto / 15,74 KB gzip; chunk Excel carregado sob demanda 424,11 KB bruto (`npm run build`, 20/08/2026).
- A abertura do quadro faz um request de dados além dos recursos estáticos: `listAgencyTasks()` chamado no `useEffect` (`AgencyKanbanPage.tsx:142-159`; `agencyTasks.service.ts:21-28`).
- Não há animação contínua em repouso; transições são de hover/drag e spinner só aparece durante salvar/excluir (`AgencyKanbanPage.tsx:90-118`; `AgencyTaskModal.tsx:197,219`).

## Acessibilidade

- Ações principais usam `button`, e o campo título recebe foco automático (`AgencyKanbanPage.tsx:90-96,299-317`; `AgencyTaskModal.tsx:87-105`).
- O card clicável/arrastável não possui acionamento por teclado nem nome acessível (`AgencyTaskCard.tsx:39-56`).
- O modal não declara `role="dialog"`, `aria-modal`, foco contido ou fechamento por Escape (`AgencyTaskModal.tsx:80-95`).
