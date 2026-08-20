```text
/make-plan Refine o modal de disparos em massa baseado em uma auditoria Dieter Rams (total 20/30).

Verdict paragraph:
> REFINE — 20/30: a estrutura operacional é útil e durável, mas precisa de hierarquia cromática semântica, menos bordas concorrentes e acabamento de contraste/foco; não há motivo para reconstruir o fluxo.

Keep:
- Principle #7 (long-lasting) scored 3 — Evidence: src/index.css:4-27. Regression check: confirmar Inter/system, cores sólidas e ausência de gradientes/modismos.
- Principle #10 (as little design as possible) scored 3 — Evidence: src/components/disparo/DisparoTaskModal.tsx:588-731,806-870. Regression check: manter criação de etiqueta recolhida, cópia contextual e mídia condicionada ao card salvo.

Fix in priority order:
1. Principle #3 — estética: criar cinco seções semânticas com uma faixa/ícone colorido e fundo tonal muito sutil — azul API, violeta etiquetas, ciano links, âmbar mensagem e verde arquivos — mantendo inputs neutros. Evidence: DESIGN-IS-2026-08-13/01-evidence.md#visual.
2. Principle #5 — discrição: remover bordas aninhadas e usar espaço + título + faixa lateral como separadores; limitar cada seção a uma única borda externa. Evidence: DESIGN-IS-2026-08-13/01-evidence.md#visual.
3. Principle #4 — compreensão: trocar “Copy” por “Mensagem”, “Tag” por “Tag da lista” e explicar WABA em linguagem operacional. Evidence: DESIGN-IS-2026-08-13/01-evidence.md#texto-e-honestidade.
4. Principle #8 — detalhe: adicionar focus-visible, elevar contraste de texto faint/etiquetas inativas e confirmar salvar/upload. Evidence: DESIGN-IS-2026-08-13/01-evidence.md#visual e #acessibilidade.
5. Principle #6 — honestidade: salvar antes de avançar e preservar o arquivo anterior até o novo upload concluir. Evidence: DESIGN-IS-2026-08-13/01-evidence.md#texto-e-honestidade.

Out of scope: navegação global, login, estrutura do Kanban, banco de dados e redesign completo.

Deliverables:
- Por correção: arquivos-alvo, mudança exata e verificação.
- Consolidar tokens/especificações cromáticas em um único lugar.
- Checklist de regressão para princípios #7 e #10.

Anti-patterns:
- Não adicionar abstrações quando uma mudança direta bastar.
- Não restilizar o que já pontuou 3.
- Não expandir para redesign estrutural.
- Não transformar cor semântica em arco-íris: usar apenas acento, ícone e fundo tonal sutil.
```
