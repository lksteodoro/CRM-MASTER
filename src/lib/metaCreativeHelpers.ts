/**
 * Regras puras do criador de anúncios da Meta (sem React, sem rede):
 *
 * - Feed x Stories: detecta o formato pela proporção, pareia a versão 9:16 com
 *   a versão de feed e monta o asset_feed_spec com personalização por
 *   posicionamento (a Meta mostra cada arquivo no lugar certo).
 * - Variações de texto: até 5 textos, títulos e descrições no mesmo anúncio.
 * - Herança por conjunto: lê a copy e a URL dos anúncios que já rodam num
 *   conjunto, para que o anúncio novo siga o mesmo destino.
 * - Beneficiário e pagador (Brasil): reaproveita o par já usado na conta.
 */

// ─── Formato ────────────────────────────────────────────────────────────────

export type PlacementFormat = 'feed' | 'story';

/** 9:16 (0,5625) e qualquer coisa bem vertical vira Stories/Reels; o resto é Feed. */
export function detectPlacementFormat(width?: number | null, height?: number | null): PlacementFormat {
  if (!width || !height) return 'feed';
  return width / height < 0.7 ? 'story' : 'feed';
}

/** Rótulo curto da proporção (9:16, 4:5, 1:1, 16:9...). */
export function aspectLabel(width?: number | null, height?: number | null): string {
  if (!width || !height) return '';
  const ratio = width / height;
  const known: Array<[number, string]> = [
    [9 / 16, '9:16'],
    [4 / 5, '4:5'],
    [1, '1:1'],
    [16 / 9, '16:9'],
    [2 / 3, '2:3'],
    [1.91, '1.91:1'],
  ];
  const match = known.find(([value]) => Math.abs(ratio - value) < 0.03);
  return match ? match[1] : `${width}×${height}`;
}

// ─── Destino do conjunto ────────────────────────────────────────────────────

const KNOWN_DESTINATION_TYPES = ['WEBSITE', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'ON_AD', 'APP', 'FACEBOOK'];
const WEBSITE_GOALS = ['OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'VALUE'];
const MESSAGING_GOALS = ['CONVERSATIONS', 'REPLIES', 'MESSAGING_PURCHASE_CONVERSION', 'MESSAGING_APPOINTMENT_CONVERSION'];

export type AdSetDestination = { destType: string; isMultiDest: boolean };

/**
 * Destino efetivo de um conjunto. A Meta passou a devolver destination_type
 * "UNDEFINED" também para conjuntos de conversão no site (pixel), não só para
 * os de mensagens com vários destinos — por isso o objetivo de otimização
 * decide quando o tipo não vem declarado.
 */
export function classifyAdSetDestination(destinationType?: string | null, optimizationGoal?: string | null): AdSetDestination {
  if (destinationType && KNOWN_DESTINATION_TYPES.includes(destinationType)) return { destType: destinationType, isMultiDest: false };
  if (optimizationGoal && WEBSITE_GOALS.includes(optimizationGoal)) return { destType: 'WEBSITE', isMultiDest: false };
  if (optimizationGoal && MESSAGING_GOALS.includes(optimizationGoal)) return { destType: 'WHATSAPP', isMultiDest: true };
  return { destType: 'WEBSITE', isMultiDest: true };
}

/** Nome de arquivo seguro para a biblioteca de mídia da Meta. */
export function mediaLibraryName(name: string, fallback = 'imagem'): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/_\./g, '.')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

// ─── Pareamento Feed ↔ Stories ──────────────────────────────────────────────

export type PairableMedia = { id: string; name: string; type: 'IMAGE' | 'VIDEO'; placement: PlacementFormat };

const FORMAT_TOKENS =
  /(?:^|[^a-z0-9])(feed|stories|story|storie|reels?|vertical|horizontal|quadrado|square|9x16|916|4x5|45|1x1|11|16x9|169|1080x1920|1080x1350|1080x1080)(?=$|[^a-z0-9])/g;

/** Nome do arquivo sem extensão, acentos e marcadores de formato. */
export function normalizeMediaName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[:]/g, 'x')
    .replace(/[\s_.-]+/g, ' ')
    .replace(FORMAT_TOKENS, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Pareia cada Stories com um Feed do mesmo tipo. Mantém pares já feitos
 * (inclusive os escolhidos à mão); depois casa por nome. Na ordem de upload
 * só casa quando nenhum nome bateu e não há par anterior: se algum nome bateu,
 * o que sobrou são criativos diferentes, e juntá-los publicaria um vídeo no
 * Feed e outro nos Stories. Mídias em `locked` (separadas à mão) não entram
 * em par novo.
 *
 * Retorna { [feedId]: storyId }.
 */
export function autoPairMedia(
  items: PairableMedia[],
  existing: Record<string, string> = {},
  locked: ReadonlyArray<string> = []
): Record<string, string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const pairs: Record<string, string> = {};
  for (const [feedId, storyId] of Object.entries(existing)) {
    const feed = byId.get(feedId);
    const story = byId.get(storyId);
    if (feed && story && feed.type === story.type && feed.id !== story.id) pairs[feedId] = storyId;
  }
  const hadPairs = Object.keys(pairs).length > 0;

  const pairedStories = () => new Set(Object.values(pairs));
  const free = (item: PairableMedia) => !locked.includes(item.id) && !pairs[item.id] && !pairedStories().has(item.id);
  const freeFeeds = () => items.filter((item) => item.placement === 'feed' && free(item));
  const freeStories = () => items.filter((item) => item.placement === 'story' && free(item));

  let pairedByName = 0;
  for (const story of freeStories()) {
    const key = normalizeMediaName(story.name);
    if (!key) continue;
    const match = freeFeeds().find((feed) => feed.type === story.type && normalizeMediaName(feed.name) === key);
    if (match) {
      pairs[match.id] = story.id;
      pairedByName += 1;
    }
  }

  if (pairedByName === 0 && !hadPairs) {
    for (const type of ['IMAGE', 'VIDEO'] as const) {
      const feeds = freeFeeds().filter((item) => item.type === type);
      const stories = freeStories().filter((item) => item.type === type);
      if (feeds.length > 0 && feeds.length === stories.length) {
        feeds.forEach((feed, index) => {
          pairs[feed.id] = stories[index].id;
        });
      }
    }
  }
  return pairs;
}

// ─── Variações de texto ─────────────────────────────────────────────────────

/** A Meta aceita até 5 opções de texto principal, de título e de descrição por anúncio. */
export const MAX_TEXT_OPTIONS = 5;

export type CopyOptions = { primaryTexts: string[]; titles: string[]; descriptions: string[] };

/** Opções de um campo: sem espaços nas pontas, sem vazias, sem repetidas, no máximo 5. */
export function textOptions(values: ReadonlyArray<unknown>): string[] {
  const options: string[] = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text && !options.includes(text)) options.push(text);
    if (options.length === MAX_TEXT_OPTIONS) break;
  }
  return options;
}

export const hasTextVariations = (options: CopyOptions) =>
  options.primaryTexts.length > 1 || options.titles.length > 1 || options.descriptions.length > 1;

// ─── Criativo com Feed + Stories ────────────────────────────────────────────

export type PlacementAsset = { videoId?: string; hash?: string; thumbHash?: string | null; thumbUrl?: string | null };

export type PlacementCopy = {
  primaryText?: string;
  title?: string;
  description?: string;
  cta?: string;
};

const FEED_LABEL = 'venza_feed';
const STORY_LABEL = 'venza_story';

function feedAsset(mediaType: 'IMAGE' | 'VIDEO', item: PlacementAsset, label?: string) {
  const adlabels = label ? { adlabels: [{ name: label }] } : {};
  return mediaType === 'VIDEO'
    ? {
        video_id: item.videoId,
        ...(item.thumbHash ? { thumbnail_hash: item.thumbHash } : item.thumbUrl ? { thumbnail_url: item.thumbUrl } : {}),
        ...adlabels,
      }
    : { hash: item.hash, ...adlabels };
}

const textAssets = (values: string[]) => (values.length > 0 ? values.map((text) => ({ text })) : undefined);

/**
 * Anúncio de uma mídia com até 5 textos, 5 títulos e 5 descrições: a Meta
 * combina as opções e entrega a melhor para cada pessoa. Só para destino site:
 * em campanhas de mensagem ou formulário esse formato vira criativo dinâmico,
 * que a Meta recusa nesses objetivos.
 */
export function buildTextOptionsAssetFeedSpec(params: {
  mediaType: 'IMAGE' | 'VIDEO';
  asset: PlacementAsset;
  options: CopyOptions;
  cta?: string;
  link: string;
}) {
  const { mediaType, asset, options, cta, link } = params;
  const bodies = textAssets(options.primaryTexts);
  const titles = textAssets(options.titles);
  const descriptions = textAssets(options.descriptions);
  return {
    [mediaType === 'VIDEO' ? 'videos' : 'images']: [feedAsset(mediaType, asset)],
    ...(bodies ? { bodies } : {}),
    ...(titles ? { titles } : {}),
    ...(descriptions ? { descriptions } : {}),
    link_urls: [{ website_url: link }],
    call_to_action_types: [cta || 'LEARN_MORE'],
    ad_formats: [mediaType === 'VIDEO' ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE'],
  };
}

/**
 * asset_feed_spec com personalização por posicionamento: a versão 9:16 vai
 * para Stories e Reels; a de feed fica como padrão para o resto (feed,
 * explorar, marketplace, busca e qualquer posicionamento não listado).
 * Só serve para destino site (a Meta aceita um único link_urls).
 */
export function buildPlacementAssetFeedSpec(params: {
  mediaType: 'IMAGE' | 'VIDEO';
  feed: PlacementAsset;
  story: PlacementAsset;
  copy: PlacementCopy;
  link: string;
}) {
  const { mediaType, feed, story, copy, link } = params;
  const labelKey = mediaType === 'VIDEO' ? 'video_label' : 'image_label';
  // Com mídia por posicionamento a Meta aceita uma opção de cada texto
  // (várias sem rótulo dão o erro 1885878).
  const text = (value?: string) => (value && value.trim() ? [{ text: value.trim() }] : undefined);

  return {
    [mediaType === 'VIDEO' ? 'videos' : 'images']: [feedAsset(mediaType, feed, FEED_LABEL), feedAsset(mediaType, story, STORY_LABEL)],
    ...(text(copy.primaryText) ? { bodies: text(copy.primaryText) } : {}),
    ...(text(copy.title) ? { titles: text(copy.title) } : {}),
    ...(text(copy.description) ? { descriptions: text(copy.description) } : {}),
    link_urls: [{ website_url: link }],
    call_to_action_types: [copy.cta || 'LEARN_MORE'],
    ad_formats: [mediaType === 'VIDEO' ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE'],
    optimization_type: 'PLACEMENT',
    asset_customization_rules: [
      {
        customization_spec: {
          publisher_platforms: ['facebook', 'instagram', 'messenger'],
          facebook_positions: ['story', 'facebook_reels'],
          instagram_positions: ['story', 'reels'],
          messenger_positions: ['story'],
        },
        [labelKey]: { name: STORY_LABEL },
        priority: 1,
      },
      {
        customization_spec: {
          publisher_platforms: ['facebook', 'instagram'],
          facebook_positions: ['feed', 'marketplace', 'video_feeds', 'search'],
          instagram_positions: mediaType === 'VIDEO' ? ['stream', 'explore', 'profile_feed'] : ['stream', 'explore', 'explore_home', 'profile_feed'],
        },
        [labelKey]: { name: FEED_LABEL },
        priority: 2,
        is_default: true,
      },
    ],
  };
}

// ─── Herança de copy e URL por conjunto ─────────────────────────────────────

type AnyRecord = Record<string, any>;

export type GraphAdWithCreative = {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: AnyRecord;
};

export type AdCopy = {
  link: string;
  primaryText: string;
  title: string;
  description: string;
  cta: string;
  urlTags: string;
};

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const first = (...values: unknown[]) => values.map(clean).find(Boolean) ?? '';

/** Copy, título, descrição, CTA e URL de um anúncio, em qualquer formato de criativo. */
export function extractAdCopy(creative?: AnyRecord | null): AdCopy {
  const spec = creative?.object_story_spec ?? {};
  const link = spec.link_data ?? {};
  const video = spec.video_data ?? {};
  const feed = creative?.asset_feed_spec ?? {};
  const feedText = (items: unknown) => (Array.isArray(items) ? items.map((item) => item?.text) : []);
  const children: AnyRecord[] = Array.isArray(link.child_attachments) ? link.child_attachments : [];

  return {
    link: first(
      link.link,
      link.call_to_action?.value?.link,
      video.call_to_action?.value?.link,
      ...(Array.isArray(feed.link_urls) ? feed.link_urls.map((item: AnyRecord) => item?.website_url) : []),
      ...children.map((child) => child?.link),
      creative?.link_url,
      creative?.object_url
    ),
    primaryText: first(link.message, video.message, ...feedText(feed.bodies), creative?.body),
    title: first(link.name, video.title, ...feedText(feed.titles), ...children.map((child) => child?.name), creative?.title),
    description: first(link.description, video.link_description, ...feedText(feed.descriptions)),
    cta: first(
      link.call_to_action?.type,
      video.call_to_action?.type,
      ...(Array.isArray(feed.call_to_action_types) ? feed.call_to_action_types : []),
      creative?.call_to_action_type
    ),
    urlTags: clean(creative?.url_tags),
  };
}

/** Todas as opções de texto do anúncio (o dinâmico pode ter até 5 de cada). */
export function extractAdTextOptions(creative?: AnyRecord | null): CopyOptions {
  const spec = creative?.object_story_spec ?? {};
  const link = spec.link_data ?? {};
  const video = spec.video_data ?? {};
  const feed = creative?.asset_feed_spec ?? {};
  const feedText = (items: unknown) => (Array.isArray(items) ? items.map((item) => item?.text) : []);
  return {
    primaryTexts: textOptions([link.message, video.message, ...feedText(feed.bodies), creative?.body]),
    titles: textOptions([link.name, video.title, ...feedText(feed.titles), creative?.title]),
    descriptions: textOptions([link.description, video.link_description, ...feedText(feed.descriptions)]),
  };
}

export type InheritedCopy = AdCopy & {
  adCount: number;
  distinctLinks: string[];
  sourceAdName: string;
  options: CopyOptions;
};

/**
 * Escolhe a copy e a URL que o conjunto já usa: considera só anúncios ativos
 * (ou todos, se nenhum estiver ativo), pega a URL mais usada e a copy de um
 * anúncio com essa URL. Retorna null se o conjunto não tem anúncio.
 */
export function pickInheritedCopy(ads: GraphAdWithCreative[]): InheritedCopy | null {
  const usable = ads.filter((ad) => !['DELETED', 'ARCHIVED'].includes(ad.effective_status ?? ''));
  const active = usable.filter((ad) => ad.effective_status === 'ACTIVE');
  const pool = (active.length > 0 ? active : usable).map((ad) => ({ ad, copy: extractAdCopy(ad.creative) }));
  if (pool.length === 0) return null;

  const counts = new Map<string, number>();
  for (const { copy } of pool) if (copy.link) counts.set(copy.link, (counts.get(copy.link) ?? 0) + 1);
  const distinctLinks = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([link]) => link);
  const topLink = distinctLinks[0] ?? '';

  const withLink = pool.filter(({ copy }) => copy.link === topLink);
  const source = withLink.find(({ copy }) => copy.primaryText) ?? withLink[0] ?? pool[0];

  return {
    ...source.copy,
    link: topLink || source.copy.link,
    adCount: pool.length,
    distinctLinks,
    sourceAdName: source.ad.name || source.ad.id,
    options: extractAdTextOptions(source.ad.creative),
  };
}

// ─── Beneficiário e pagador (Brasil) ────────────────────────────────────────

/**
 * Conjunto que entrega no Brasil declara quem se beneficia e quem paga pelos
 * anúncios: regional_regulated_categories = BRAZIL_REGULATION e
 * regional_regulation_identities com universal_beneficiary e universal_payer
 * (Marketing API, mudança de 8/12/2025). Não há endpoint público que liste
 * essas identidades, mas os conjuntos que já existem na conta devolvem as que
 * foram usadas — é de lá que o sistema tira o par, sem pedir nada a ninguém.
 */
export type RegulationIdentities = { beneficiaryId: string; payerId: string };

export type AdSetWithRegulation = {
  id: string;
  name?: string;
  campaign_id?: string;
  created_time?: string;
  regional_regulated_categories?: unknown;
  regional_regulation_identities?: unknown;
};

export type DetectedIdentities = RegulationIdentities & { sourceAdSetName: string; adSetCount: number };

const identityId = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object' && 'id' in value) return identityId((value as AnyRecord).id);
  return '';
};

/** Par beneficiário/pagador de um conjunto (null se ele não declara). */
export function readBrazilIdentities(adSet: AdSetWithRegulation): RegulationIdentities | null {
  const categories = Array.isArray(adSet.regional_regulated_categories) ? adSet.regional_regulated_categories : [];
  // As mesmas chaves universal_* servem à Tailândia; conjunto só da Tailândia não vale aqui.
  if (categories.includes('THAILAND_UNIVERSAL') && !categories.includes('BRAZIL_REGULATION')) return null;
  const identities = (adSet.regional_regulation_identities ?? {}) as AnyRecord;
  const beneficiaryId = identityId(identities.universal_beneficiary);
  const payerId = identityId(identities.universal_payer);
  if (!beneficiaryId && !payerId) return null;
  return { beneficiaryId: beneficiaryId || payerId, payerId: payerId || beneficiaryId };
}

/**
 * Escolhe o par já usado na conta: o que aparece em mais conjuntos; no empate,
 * o das campanhas escolhidas; depois o mais recente.
 */
export function pickBrazilIdentities(adSets: AdSetWithRegulation[], preferCampaignIds: string[] = []): DetectedIdentities | null {
  const groups = new Map<string, { ids: RegulationIdentities; adSets: AdSetWithRegulation[] }>();
  for (const adSet of adSets) {
    const ids = readBrazilIdentities(adSet);
    if (!ids) continue;
    const key = `${ids.beneficiaryId}|${ids.payerId}`;
    const group = groups.get(key) ?? { ids, adSets: [] };
    group.adSets.push(adSet);
    groups.set(key, group);
  }
  const preferred = (group: { adSets: AdSetWithRegulation[] }) =>
    group.adSets.some((adSet) => adSet.campaign_id && preferCampaignIds.includes(adSet.campaign_id)) ? 1 : 0;
  const newest = (group: { adSets: AdSetWithRegulation[] }) =>
    Math.max(0, ...group.adSets.map((adSet) => Date.parse(adSet.created_time ?? '') || 0));
  const best = [...groups.values()].sort(
    (a, b) => b.adSets.length - a.adSets.length || preferred(b) - preferred(a) || newest(b) - newest(a)
  )[0];
  if (!best) return null;
  const source = [...best.adSets].sort((a, b) => (Date.parse(b.created_time ?? '') || 0) - (Date.parse(a.created_time ?? '') || 0))[0];
  return { ...best.ids, sourceAdSetName: source.name || source.id, adSetCount: best.adSets.length };
}

/** Parâmetros do conjunto novo que entrega no Brasil (valores já em JSON, como a Graph espera). */
export function brazilRegulationParams(ids: RegulationIdentities) {
  const beneficiary = ids.beneficiaryId.trim() || ids.payerId.trim();
  const payer = ids.payerId.trim() || beneficiary;
  return {
    regional_regulated_categories: JSON.stringify(['BRAZIL_REGULATION']),
    regional_regulation_identities: JSON.stringify({ universal_beneficiary: beneficiary, universal_payer: payer }),
  };
}
