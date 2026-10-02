/**
 * Regras puras do criador de anúncios da Meta (sem React, sem rede):
 *
 * - Feed x Stories: detecta o formato pela proporção, pareia a versão 9:16 com
 *   a versão de feed e monta o asset_feed_spec com personalização por
 *   posicionamento (a Meta mostra cada arquivo no lugar certo).
 * - Herança por conjunto: lê a copy e a URL dos anúncios que já rodam num
 *   conjunto, para que o anúncio novo siga o mesmo destino.
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
 * (inclusive os escolhidos à mão); depois casa por nome; por fim, se sobrarem
 * quantidades iguais, casa na ordem de upload.
 *
 * Retorna { [feedId]: storyId }.
 */
export function autoPairMedia(items: PairableMedia[], existing: Record<string, string> = {}): Record<string, string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const pairs: Record<string, string> = {};
  for (const [feedId, storyId] of Object.entries(existing)) {
    const feed = byId.get(feedId);
    const story = byId.get(storyId);
    if (feed && story && feed.type === story.type && feed.id !== story.id) pairs[feedId] = storyId;
  }

  const pairedStories = () => new Set(Object.values(pairs));
  const freeFeeds = () => items.filter((item) => item.placement === 'feed' && !pairs[item.id] && !pairedStories().has(item.id));
  const freeStories = () => items.filter((item) => item.placement === 'story' && !pairedStories().has(item.id));

  for (const story of freeStories()) {
    const key = normalizeMediaName(story.name);
    if (!key) continue;
    const match = freeFeeds().find((feed) => feed.type === story.type && normalizeMediaName(feed.name) === key);
    if (match) pairs[match.id] = story.id;
  }

  for (const type of ['IMAGE', 'VIDEO'] as const) {
    const feeds = freeFeeds().filter((item) => item.type === type);
    const stories = freeStories().filter((item) => item.type === type);
    if (feeds.length > 0 && feeds.length === stories.length) {
      feeds.forEach((feed, index) => {
        pairs[feed.id] = stories[index].id;
      });
    }
  }
  return pairs;
}

// ─── Criativo com Feed + Stories ────────────────────────────────────────────

export type PlacementAsset = { videoId?: string; hash?: string; thumbHash?: string | null };

export type PlacementCopy = {
  primaryText?: string;
  title?: string;
  description?: string;
  cta?: string;
};

const FEED_LABEL = 'venza_feed';
const STORY_LABEL = 'venza_story';

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
  const asset = (item: PlacementAsset, label: string) =>
    mediaType === 'VIDEO'
      ? { video_id: item.videoId, ...(item.thumbHash ? { thumbnail_hash: item.thumbHash } : {}), adlabels: [{ name: label }] }
      : { hash: item.hash, adlabels: [{ name: label }] };

  const text = (value?: string) => (value && value.trim() ? [{ text: value.trim() }] : undefined);

  return {
    [mediaType === 'VIDEO' ? 'videos' : 'images']: [asset(feed, FEED_LABEL), asset(story, STORY_LABEL)],
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

export type InheritedCopy = AdCopy & {
  adCount: number;
  distinctLinks: string[];
  sourceAdName: string;
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
  };
}
