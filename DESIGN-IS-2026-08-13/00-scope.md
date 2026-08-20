# Escopo da auditoria

- Superfície auditada: modal `DisparoTaskModal`, especialmente o cadastro de números API/WABA e a hierarquia cromática das seções.
- URL de referência: `http://127.0.0.1:5173/agency/disparo` (a sessão visível está parada no login, portanto a captura enviada e o código são as fontes visuais primárias).
- Componentes: `src/components/disparo/DisparoTaskModal.tsx`, `src/components/disparo/DisparoTaskCard.tsx` e tokens em `src/index.css`.
- Usuário principal: operador interno responsável por preparar disparos em massa na Infobip.
- Tarefa principal: localizar, copiar e conferir rapidamente número/WABA, links, copy e mídias de cada demanda.
- Restrições: React + Tailwind, tema escuro já estabelecido, preservar os tokens da marca, manter boa leitura e reduzir carga cognitiva.
- Referência fornecida: captura do bloco “Números da API / WABA”, apontando monotonia cromática e pouca separação visual.
- Fora do escopo: navegação global, login, redesign do Kanban inteiro e mudança do fluxo de dados/Supabase.
