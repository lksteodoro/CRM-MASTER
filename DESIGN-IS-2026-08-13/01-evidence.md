# Evidências

## Estrutura

- A superfície reúne dados básicos, números, etiquetas, lista/links, mensagem, quatro anexos, relatório e ações em um único modal (`src/components/disparo/DisparoTaskModal.tsx:469-925`).
- Contagem estrutural: 36 definições interativas JSX; o total renderizado varia com números, etiquetas e mídias (`DisparoTaskModal.tsx:73-89,205-260,486-924`).
- Profundidade máxima observada: 9 níveis JSX na linha de número (`DisparoTaskModal.tsx:470-654`).
- Padrões repetidos: copiar aparece em número, WABA, “copiar todos”, links e mídia; inputs/bordas aparecem em todos os grupos; upload repete quatro slots (`DisparoTaskModal.tsx:45-93,140-265,588-674,754-770,821-864`).
- Não há prop morta ou import não utilizado detectado pelo build/lint na superfície auditada.

## Visual

- Escala de espaçamento inferida: 2, 4, 6, 8, 10, 12, 16, 20, 24 e 44 px (`DisparoTaskModal.tsx:38-41,69-90,192-264,470-925`).
- Escala tipográfica: 10, 11, 12 e 14 px (`DisparoTaskModal.tsx:39-40,69-88,199-259,474-923`).
- O modal referencia 22 cores/tokens estáticos, mas a captura mostra cinco superfícies escuras muito próximas dominando a composição; azul fica concentrado em borda, foco e botão (captura fornecida, região central; `src/index.css:4-25`).
- Contraste mínimo inferido: 1,56:1 nas etiquetas inativas porque a opacidade é aplicada ao botão inteiro; texto faint sobre panel-2 chega a cerca de 2,78:1 (`DisparoTaskModal.tsx:676-690`; `src/index.css:6,11`).
- Estados: vazio, loading, erro e disabled existem; sucesso é claro apenas em cópia; foco é parcial e não cobre botões/dropzone (`DisparoTaskModal.tsx:38-40,58-89,216-231,352-464,608-614,883-923`).

## Texto e honestidade

- Não há superlativos, falsa urgência ou dark pattern. As promessas de link público, otimização e limite têm implementação correspondente (`DisparoTaskModal.tsx:810-864`; `src/services/disparoTasks.service.ts:349-378`; `src/lib/disparoMedia.ts:61-110`).
- Há jargão e duplicação: “WABA / API”, “Copy”, “Tag” versus “Etiquetas” e “Lista (contatos)” versus arquivo “Lista de contatos” (`DisparoTaskModal.tsx:623-641,676-786,853-862`).
- Riscos de honestidade operacional: “Avançar” pode descartar edição não salva; “Trocar arquivo” remove o anterior antes do novo upload; “Baixar” pode abrir outra aba dependendo do navegador (`DisparoTaskModal.tsx:404-413,248-256,907-915`; `src/services/disparoTasks.service.ts:335-364`).

## Peso e fricção

- Bundle JS de produção medido: 1.145.286 bytes; CSS: 42.064 bytes (`dist/assets/index-B0Yu_h3R.js`, `dist/assets/index-BwoefcHX.css`).
- Contagem de requests e TTI não foram medidos porque a sessão disponível está no login; a avaliação de peso usa o bundle gerado.
- Não há animação ociosa; spinners existem apenas durante operações assíncronas (`DisparoTaskModal.tsx:225,534,727,893,913,922`).
- Modal inicial: 1; badges variam conforme números/etiquetas; vídeo não usa autoplay (`DisparoTaskModal.tsx:205,469-471,576-583`).

## Acessibilidade

- Controles nativos são alcançáveis por teclado, mas a dropzone é uma `div` e não possui alternativa de teclado própria (`DisparoTaskModal.tsx:179-198`).
- Ordem de foco segue o DOM: fechar → evento → cliente/data/hora → números → etiquetas → links → mensagem → mídias → relatório → rodapé (`DisparoTaskModal.tsx:486-925`).
- Não existem atributos `aria-*` no modal; não há landmark ou skip-link local.
- Inputs têm foco de borda; botões, links, checkboxes, summary e dropzone não têm `focus-visible` explícito (`DisparoTaskModal.tsx:38-40,81-89,179-264,486-925`).

## Limitações

- A sessão do navegador está em `/login`; estilos computados, tabulação real, requests e TTI do modal não puderam ser medidos.
- A captura cobre apenas a região superior/central. As demais áreas foram avaliadas por código.
