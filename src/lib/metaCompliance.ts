/**
 * Regras de conformidade que a Meta exige na criação do anúncio.
 *
 * Estão aqui, e não espalhadas no formulário, porque cada uma corresponde a uma
 * política específica: declaração de categoria especial, identificação de quem
 * paga pelo anúncio e proibição de destino que muda depois da revisão.
 */

export type SpecialAdCategory =
  | 'NONE'
  | 'CREDIT'
  | 'EMPLOYMENT'
  | 'HOUSING'
  | 'ISSUES_ELECTIONS_POLITICS'
  | 'ONLINE_GAMBLING_AND_GAMING'
  | 'FINANCIAL_PRODUCTS_SERVICES';

/**
 * Categorias especiais da Meta. Declarar errado (ou declarar "nenhuma" para um
 * anunciante de crédito, emprego, moradia ou política) restringe a conta de
 * anúncios — por isso a escolha é obrigatória e não tem valor padrão.
 */
export const SPECIAL_AD_CATEGORIES: Array<{ value: SpecialAdCategory; label: string; hint: string }> = [
  {
    value: 'NONE',
    label: 'Nenhuma categoria especial',
    hint: 'Produto ou serviço comum: varejo, infoproduto, estética, restaurante, serviço local.',
  },
  {
    value: 'CREDIT',
    label: 'Crédito',
    hint: 'Empréstimo, financiamento, consórcio, cartão, antecipação, negociação de dívida.',
  },
  {
    value: 'EMPLOYMENT',
    label: 'Emprego',
    hint: 'Vaga, processo seletivo, recrutamento, estágio, oportunidade de trabalho.',
  },
  {
    value: 'HOUSING',
    label: 'Moradia',
    hint: 'Venda ou aluguel de imóvel, lançamento imobiliário, financiamento habitacional.',
  },
  {
    value: 'FINANCIAL_PRODUCTS_SERVICES',
    label: 'Produtos e serviços financeiros',
    hint: 'Investimento, seguro, previdência, corretora, criptoativo.',
  },
  {
    value: 'ISSUES_ELECTIONS_POLITICS',
    label: 'Assuntos sociais, eleições ou política',
    hint: 'Exige autorização e selo de responsabilidade concedidos previamente pela Meta.',
  },
  {
    value: 'ONLINE_GAMBLING_AND_GAMING',
    label: 'Jogos e apostas online',
    hint: 'Aposta, cassino, bingo. Exige autorização prévia da Meta.',
  },
];

/**
 * Formato que a Graph API espera em `special_ad_categories`: lista JSON, vazia
 * quando não há categoria. O valor sai da declaração do operador — nunca é
 * assumido pelo código.
 */
export function serializeSpecialAdCategories(category: SpecialAdCategory | ''): string {
  if (!category) throw new Error('Declare a categoria especial da campanha antes de publicar.');
  return JSON.stringify(category === 'NONE' ? [] : [category]);
}

export function specialAdCategoryLabel(category: SpecialAdCategory | '') {
  return SPECIAL_AD_CATEGORIES.find((item) => item.value === category)?.label ?? 'não declarada';
}

/** Categorias que a Meta só libera após autorização específica do anunciante. */
export const CATEGORIES_REQUIRING_AUTHORIZATION: SpecialAdCategory[] = [
  'ISSUES_ELECTIONS_POLITICS',
  'ONLINE_GAMBLING_AND_GAMING',
];

/**
 * Detecta um link do redirecionador interno usado como destino de anúncio.
 *
 * O redirecionador pode alternar destinos a cada acesso e permite trocar o
 * destino depois que o anúncio foi aprovado — exatamente o que a Meta classifica
 * como cloaking. Em tráfego pago o destino tem que ser a página final.
 */
export function isRedirectorUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return /^\/r\/[a-z0-9][a-z0-9-]{2,79}\/?$/i.test(parsed.pathname);
  } catch {
    return /\/r\/[a-z0-9][a-z0-9-]{2,79}\/?(\?|$)/i.test(url.trim());
  }
}

/** URL de destino precisa ser https e não pode ser o redirecionador interno. */
export function validateDestinationUrl(url: string): string | null {
  const value = (url ?? '').trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'O link de destino precisa ser um endereço completo, começando com https://.';
  }
  if (parsed.protocol !== 'https:') {
    return 'A Meta exige que o link de destino use https://.';
  }
  if (isRedirectorUrl(value)) {
    return 'Este é um link do redirecionador interno. Ele pode mudar de destino após a aprovação, o que a Meta trata como cloaking e pune com bloqueio da conta. Use a URL final da página.';
  }
  return null;
}
