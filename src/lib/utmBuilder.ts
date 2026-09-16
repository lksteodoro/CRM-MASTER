/**
 * Montagem de URLs com UTM.
 *
 * Existem dois links para a mesma campanha, e eles não são intercambiáveis:
 *
 *   Link do anúncio — leva as macros `{{campaign.name}}` e companhia. Quem
 *   substitui essas macros é a Meta, na hora da entrega. Se você abrir esse
 *   link no navegador, as chaves chegam literais e o relatório fica sujo.
 *
 *   Link de teste — leva valores concretos no lugar das macros. É o que se
 *   clica para conferir se o rastreamento está chegando no analytics antes de
 *   subir a campanha.
 */

/** Ordem e macros do padrão de UTM usado nos anúncios da agência. */
export const META_UTM_MACROS = {
  utm_campaign: '{{campaign.name}}',
  utm_source: '{{placement}}',
  utm_medium: '{{adset.name}}',
  utm_content: '{{ad.name}}',
} as const;

export type UtmKey = keyof typeof META_UTM_MACROS;

export const UTM_KEYS = Object.keys(META_UTM_MACROS) as UtmKey[];

/**
 * Query string com as macros, no formato que vai no campo de UTM do anúncio.
 * É o valor padrão do criador de anúncios — mantido aqui para que o padrão
 * exista num lugar só.
 */
export const META_UTM_TEMPLATE = `?${UTM_KEYS.map((key) => `${key}=${META_UTM_MACROS[key]}`).join('&')}`;

/** O que cada parâmetro significa, para explicar na tela sem abrir a documentação. */
export const UTM_DESCRIPTIONS: Record<UtmKey, { label: string; meaning: string }> = {
  utm_campaign: { label: 'Campanha', meaning: 'Nome da campanha na Meta' },
  utm_source: { label: 'Origem', meaning: 'Posicionamento onde o anúncio apareceu' },
  utm_medium: { label: 'Mídia', meaning: 'Nome do conjunto de anúncios' },
  utm_content: { label: 'Conteúdo', meaning: 'Nome do anúncio' },
};

export type UtmValues = Record<UtmKey, string>;

function twoDigits(value: number) {
  return String(value).padStart(2, '0');
}

/**
 * Valores padrão do teste.
 *
 * O carimbo de data e hora entra no nome da campanha de propósito: é o que
 * permite achar exatamente este clique no relatório depois, sem confundir com
 * um teste feito ontem.
 */
export function defaultTestValues(now = new Date()): UtmValues {
  const stamp = `${twoDigits(now.getDate())}${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}`;
  return {
    utm_campaign: `teste-${stamp}`,
    utm_source: 'teste-interno',
    utm_medium: 'teste',
    utm_content: 'link-de-teste',
  };
}

export type UrlCheck = { url: URL } | { error: string };

/**
 * Normaliza e valida o endereço digitado.
 *
 * Aceita a URL sem protocolo, porque é assim que a maioria das pessoas copia e
 * cola, e assume https — que é o que a Meta exige no destino do anúncio.
 */
export function normalizeUrl(input: string): UrlCheck {
  const raw = (input ?? '').trim();
  if (!raw) return { error: 'Cole o endereço da página de destino.' };

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { error: 'Endereço inválido. Confira se não ficou um espaço ou caractere sobrando.' };
  }

  if (!url.hostname.includes('.')) {
    return { error: 'Endereço incompleto: falta o domínio (exemplo: institutosoftskills.com.br).' };
  }

  return { url };
}

/**
 * Acrescenta os parâmetros ao endereço.
 *
 * Parâmetros que já existem na URL são preservados — só os `utm_*` informados
 * são sobrescritos. A âncora (`#secao`) continua no fim, onde precisa estar.
 */
export function applyParams(url: URL, params: Record<string, string>, { encode = true } = {}) {
  const result = new URL(url.toString());

  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      result.searchParams.delete(key);
      continue;
    }
    result.searchParams.set(key, value);
  }

  const output = result.toString();
  if (encode) return output;

  // As macros da Meta não podem ser percent-encoded: `%7B%7Bcampaign.name%7D%7D`
  // não é reconhecido e chega literal no destino.
  return output.replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}');
}

/** Link com valores reais, para clicar e conferir no analytics. */
export function buildTestUrl(url: URL, values: UtmValues) {
  return applyParams(url, values);
}

/** Link com as macros, para colar no campo de destino do anúncio. */
export function buildAdUrl(url: URL) {
  return applyParams(url, { ...META_UTM_MACROS }, { encode: false });
}
