# Scorecard — 20/30

1. Good design is innovative — Score: 2/3
   Evidence: copiar individual e em lote melhora um formulário operacional conhecido (`01-evidence.md#estrutura`).
   Justification: atualiza um padrão existente com ganho real, mas não cria uma interação inédita.

2. Good design makes a product useful — Score: 2/3
   Evidence: toda a preparação do disparo cabe no modal, com cópia rápida e anexos (`01-evidence.md#estrutura`).
   Justification: a tarefa é atendida, mas a superfície longa e densa adiciona esforço.

3. Good design is aesthetic — Score: 1/3
   Evidence: cinco tons escuros próximos dominam a captura e a hierarquia depende quase só de bordas (`01-evidence.md#visual`).
   Justification: há sistema de espaçamento e tipo, porém a monotonia e o excesso de caixas são uma violação visual clara.

4. Good design makes a product understandable — Score: 2/3
   Evidence: grupos são nomeados, mas WABA, Copy e os dois conceitos de Tag/Lista exigem contexto (`01-evidence.md#texto-e-honestidade`).
   Justification: o fluxo principal é identificável, com alguns rótulos que ainda precisam explicação.

5. Good design is unobtrusive — Score: 2/3
   Evidence: não há decoração gratuita, mas quatro níveis de borda competem na área de números (`01-evidence.md#visual`).
   Justification: o chrome é contido, embora ainda mais visível que o necessário.

6. Good design is honest — Score: 2/3
   Evidence: alegações têm implementação, mas avançar/trocar/baixar têm pequenas divergências de expectativa (`01-evidence.md#texto-e-honestidade`).
   Justification: não há engano intencional; existem inconsistências operacionais a corrigir.

7. Good design is long-lasting — Score: 3/3
   Evidence: Inter/system, cores sólidas, sem gradiente ou modismo visual (`src/index.css:4-27`).
   Justification: a linguagem é neutra e deve continuar atual nos próximos anos.

8. Good design is thorough down to the last detail — Score: 2/3
   Evidence: estados principais existem, mas foco completo e sucesso de salvar estão ausentes (`01-evidence.md#visual`).
   Justification: falta um estado relevante, portanto não alcança acabamento total.

9. Good design is environmentally friendly — Score: 1/3
   Evidence: JS inicial medido em 1.145.286 bytes, sem animação ociosa (`01-evidence.md#peso-e-fricção`).
   Justification: o peso está na faixa de 500 KB–2 MB apesar da boa contenção de movimento.

10. Good design is as little design as possible — Score: 3/3
   Evidence: criação de etiqueta é recolhida, ações de cópia são contextuais e mídia só aparece após salvar (`DisparoTaskModal.tsx:588-731,806-870`).
   Justification: os elementos presentes servem diretamente à operação, com pouca decoração removível.
