/**
 * Regras puras do editor em massa da Meta (sem React, sem rede): orçamento,
 * renomeação, status, resultados e o pacote de alterações que vai para a Graph.
 */

export type BulkLevel = 'campaign' | 'adset' | 'ad';

export const LEVEL_EDGE: Record<BulkLevel, string> = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' };

// ─── Status ─────────────────────────────────────────────────────────────────

export type StatusFilter = 'all' | 'active' | 'paused' | 'issues';

/** Valores de effective_status que cada nível aceita no filtro da Graph. */
const LEVEL_STATUSES: Record<BulkLevel, string[]> = {
  campaign: ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'],
  adset: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'],
  ad: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO'],
};

const FILTER_STATUSES: Record<StatusFilter, string[] | null> = {
  all: null,
  active: ['ACTIVE'],
  paused: ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'],
  issues: ['IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PENDING_BILLING_INFO'],
};

/** Filtro de status pronto para o parâmetro `filtering` (sem arquivados nem excluídos). */
export function statusFiltering(level: BulkLevel, filter: StatusFilter): string {
  const valid = LEVEL_STATUSES[level];
  const wanted = FILTER_STATUSES[filter];
  const value = wanted ? valid.filter((status) => wanted.includes(status)) : valid;
  return JSON.stringify([{ field: 'effective_status', operator: 'IN', value }]);
}

export type StatusTone = 'active' | 'paused' | 'review' | 'problem';

export const STATUS_INFO: Record<string, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: 'Ativo', tone: 'active' },
  PAUSED: { label: 'Pausado', tone: 'paused' },
  CAMPAIGN_PAUSED: { label: 'Campanha pausada', tone: 'paused' },
  ADSET_PAUSED: { label: 'Conjunto pausado', tone: 'paused' },
  IN_PROCESS: { label: 'Processando', tone: 'review' },
  PENDING_REVIEW: { label: 'Em análise', tone: 'review' },
  PREAPPROVED: { label: 'Pré-aprovado', tone: 'review' },
  WITH_ISSUES: { label: 'Com problemas', tone: 'problem' },
  DISAPPROVED: { label: 'Reprovado', tone: 'problem' },
  PENDING_BILLING_INFO: { label: 'Falta pagamento', tone: 'problem' },
  ARCHIVED: { label: 'Arquivado', tone: 'paused' },
  DELETED: { label: 'Excluído', tone: 'paused' },
};

export const statusInfo = (status?: string) => STATUS_INFO[status ?? ''] ?? { label: status || '—', tone: 'paused' as StatusTone };

/** Motivos de reprovação que a Meta devolve em ad_review_feedback. */
export function reviewIssues(feedback: unknown): string[] {
  if (!feedback || typeof feedback !== 'object') return [];
  const out: string[] = [];
  for (const group of Object.values(feedback as Record<string, unknown>)) {
    if (group && typeof group === 'object') {
      for (const [reason, text] of Object.entries(group as Record<string, unknown>)) {
        out.push(typeof text === 'string' && text.trim() ? text.trim() : reason.replace(/_/g, ' ').toLowerCase());
      }
    }
  }
  return [...new Set(out)];
}

// ─── Resultados ─────────────────────────────────────────────────────────────

/** Mesma ordem do resumo diário: a primeira ação de lead que aparecer conta. */
export const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];

export function leadsFromActions(actions?: Array<{ action_type?: string; value?: string | number }> | null): number {
  for (const type of LEAD_ACTION_TYPES) {
    const hit = actions?.find((action) => action.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

// ─── Orçamento ──────────────────────────────────────────────────────────────

export type BudgetField = 'daily_budget' | 'lifetime_budget';
export type BudgetChange = { mode: 'set' | 'increase' | 'decrease'; value: number };

/** Orçamento próprio do objeto (null quando ele usa o da campanha ou não tem). */
export function ownBudget(row: { daily_budget?: string | number | null; lifetime_budget?: string | number | null }): { field: BudgetField; cents: number } | null {
  const daily = Number(row.daily_budget);
  if (daily > 0) return { field: 'daily_budget', cents: daily };
  const lifetime = Number(row.lifetime_budget);
  if (lifetime > 0) return { field: 'lifetime_budget', cents: lifetime };
  return null;
}

/** Novo orçamento em centavos: valor em reais, ou percentual sobre o atual. */
export function nextBudgetCents(currentCents: number, change: BudgetChange): number | null {
  if (!Number.isFinite(change.value) || change.value <= 0) return null;
  if (change.mode === 'set') return Math.round(change.value * 100);
  if (change.mode === 'decrease' && change.value >= 100) return null;
  const factor = change.mode === 'increase' ? 1 + change.value / 100 : 1 - change.value / 100;
  return Math.max(1, Math.round(currentCents * factor));
}

/** Mais de 20% de uma vez costuma reiniciar o aprendizado do conjunto. */
export const isAggressiveBudgetChange = (beforeCents: number, afterCents: number) =>
  beforeCents > 0 && Math.abs(afterCents - beforeCents) / beforeCents > 0.2;

export const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "1.234,56" ou "50" → 50 (reais). */
export function parseReais(text: string): number {
  const cleaned = text.replace(/[^\d,.-]/g, '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

// ─── Nome ───────────────────────────────────────────────────────────────────

export type RenameRule = { find: string; replace: string; prefix: string; suffix: string };

export function renameWith(name: string, rule: RenameRule): string {
  const replaced = rule.find ? name.split(rule.find).join(rule.replace) : name;
  return `${rule.prefix}${replaced}${rule.suffix}`.trim();
}

// ─── Pacote de alterações ───────────────────────────────────────────────────

export type BulkChange = { id: string; params: Record<string, string>; previous: Record<string, string> };

/** Só o que muda de verdade vai para a Meta (e guarda o valor de antes para desfazer). */
export function changesFor<T extends { id: string }>(
  rows: T[],
  planner: (row: T) => { params: Record<string, string>; previous: Record<string, string> } | null
): BulkChange[] {
  const out: BulkChange[] = [];
  for (const row of rows) {
    const planned = planner(row);
    if (!planned) continue;
    const params = Object.fromEntries(Object.entries(planned.params).filter(([key, value]) => planned.previous[key] !== value));
    if (Object.keys(params).length === 0) continue;
    out.push({ id: row.id, params, previous: Object.fromEntries(Object.keys(params).map((key) => [key, planned.previous[key]])) });
  }
  return out;
}

/** Desfazer = aplicar de novo os valores de antes. */
export const undoChanges = (changes: BulkChange[]): BulkChange[] =>
  changes.map((change) => ({ id: change.id, params: change.previous, previous: change.params }));

export function adsManagerLink(level: BulkLevel, accountId: string, id: string): string {
  const account = accountId.replace(/^act_/i, '');
  const edge = LEVEL_EDGE[level];
  return `https://adsmanager.facebook.com/adsmanager/manage/${edge}?act=${encodeURIComponent(account)}&selected_${edge}_ids=${encodeURIComponent(id)}`;
}

// ─── Criativo: texto, URL e rastreamento ────────────────────────────────────
//
// Texto, URL e parâmetros de URL ficam no criativo, que a Meta não deixa
// alterar. Editar = montar um criativo novo a partir do atual, com a mudança,
// e trocar o criativo do anúncio (é o que o Gerenciador faz por baixo).

type AnyRecord = Record<string, any>;

export type TextEdit = { mode: 'keep' } | { mode: 'set'; value: string } | { mode: 'replace'; find: string; replace: string };
export type UrlTagsEdit = { mode: 'keep' } | { mode: 'set'; value: string } | { mode: 'remove' };

export type CreativeEdit = {
  primaryText?: TextEdit;
  title?: TextEdit;
  description?: TextEdit;
  url?: TextEdit;
  urlTags?: UrlTagsEdit;
  /** Tira os parâmetros utm_ de dentro da URL (evita duplicar com os parâmetros de URL). */
  stripUtmFromUrl?: boolean;
};

const isChanging = (edit?: TextEdit) => Boolean(edit && edit.mode !== 'keep');

export function applyTextEdit(value: string, edit?: TextEdit): string {
  if (!edit || edit.mode === 'keep') return value;
  if (edit.mode === 'set') return edit.value.trim();
  return edit.find ? value.split(edit.find).join(edit.replace) : value;
}

/** Tira utm_* da query da URL e mantém o resto (inclusive macros como {{ad.id}}). */
export function stripUtmParams(url: string): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = base.indexOf('?');
  if (queryAt < 0) return url;
  const kept = base
    .slice(queryAt + 1)
    .split('&')
    .filter((part) => part && !/^utm_[^=&]*(=|$)/i.test(part));
  return `${base.slice(0, queryAt)}${kept.length ? `?${kept.join('&')}` : ''}${hash}`;
}

const MESSAGE_CTAS = ['WHATSAPP_MESSAGE', 'MESSAGE_PAGE', 'SEND_MESSAGE', 'MESSAGE_US', 'CALL_NOW', 'INSTAGRAM_MESSAGE'];
const isSiteUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^https?:\/\//i.test(value) &&
  !/^https?:\/\/(www\.|m\.)?(facebook\.com|fb\.me|wa\.me|api\.whatsapp\.com|instagram\.com)\b/i.test(value);

export type CreativeInfo = {
  kind: 'link' | 'video' | 'feed' | 'post';
  primaryText: string;
  title: string;
  description: string;
  url: string;
  urlTags: string;
  /** Motivo de a URL não poder ser trocada (mensagem, formulário, publicação existente). */
  urlLockedReason: string | null;
};

const firstText = (items: unknown) =>
  Array.isArray(items) ? String(items.find((item) => item?.text)?.text ?? '') : '';

/** Resumo do criativo para a tela: primeiro texto, título, descrição e URL. */
export function describeCreative(creative?: AnyRecord | null): CreativeInfo {
  const story = creative?.object_story_spec ?? null;
  const feed = creative?.asset_feed_spec ?? null;
  const link = story?.link_data ?? null;
  const video = story?.video_data ?? null;
  const children: AnyRecord[] = Array.isArray(link?.child_attachments) ? link.child_attachments : [];
  const ctas: AnyRecord[] = [link?.call_to_action, video?.call_to_action, ...children.map((child) => child?.call_to_action)].filter(Boolean);
  const feedCtas: string[] = Array.isArray(feed?.call_to_action_types) ? feed.call_to_action_types : [];
  const feedCtaObjects: AnyRecord[] = Array.isArray(feed?.call_to_actions) ? feed.call_to_actions : [];
  const urls = [
    link?.link,
    link?.call_to_action?.value?.link,
    video?.call_to_action?.value?.link,
    ...(Array.isArray(feed?.link_urls) ? feed.link_urls.map((item: AnyRecord) => item?.website_url) : []),
  ].filter(isSiteUrl);

  const kind: CreativeInfo['kind'] = feed ? 'feed' : video ? 'video' : link ? 'link' : 'post';
  let urlLockedReason: string | null = null;
  if (kind === 'post') urlLockedReason = 'usa uma publicação existente';
  else if ([...ctas, ...feedCtaObjects].some((cta) => cta?.value?.lead_gen_form_id)) urlLockedReason = 'é de formulário de lead';
  else if (ctas.some((cta) => MESSAGE_CTAS.includes(cta?.type)) || feedCtas.some((type) => MESSAGE_CTAS.includes(type))) urlLockedReason = 'é de mensagem (WhatsApp/Messenger)';
  else if (urls.length === 0) urlLockedReason = 'não tem URL de site';

  return {
    kind,
    primaryText: String(link?.message ?? video?.message ?? firstText(feed?.bodies)),
    title: String(link?.name ?? video?.title ?? firstText(feed?.titles)),
    description: String(link?.description ?? video?.link_description ?? firstText(feed?.descriptions)),
    url: urls[0] ?? '',
    urlTags: String(creative?.url_tags ?? ''),
    urlLockedReason,
  };
}

function editKey(target: AnyRecord, key: string, edit?: TextEdit) {
  if (!isChanging(edit)) return;
  const next = applyTextEdit(String(target[key] ?? ''), edit);
  if (next) target[key] = next;
  else delete target[key];
}

/** Opções de texto do criativo dinâmico: "localizar" troca em todas; "trocar por" deixa uma só. */
function editTextList(list: unknown, edit?: TextEdit): AnyRecord[] | undefined {
  const items: AnyRecord[] = Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  if (!edit || edit.mode === 'keep') return Array.isArray(list) ? items : undefined;
  if (edit.mode === 'set') {
    const value = edit.value.trim();
    if (!value) return undefined;
    // Com rótulo (regra por posicionamento) cada item continua existindo.
    if (items.some((item) => item.adlabels)) return items.map((item) => ({ ...item, text: value }));
    return [{ text: value }];
  }
  const seen = new Set<string>();
  const out: AnyRecord[] = [];
  for (const item of items) {
    const text = applyTextEdit(String(item.text ?? ''), edit);
    if (!text || (!item.adlabels && seen.has(text))) continue;
    seen.add(text);
    out.push({ ...item, text });
  }
  return out.length ? out : undefined;
}

/**
 * Cópia do object_story_spec que a Meta aceita de volta na criação: a leitura
 * traz campos que a criação recusa juntos ou que foram descontinuados.
 */
function sanitizeStorySpec(spec: unknown): AnyRecord {
  const story: AnyRecord = JSON.parse(JSON.stringify(spec ?? {}));
  // A Meta descontinuou instagram_actor_id na criação de criativos.
  if (story.instagram_actor_id && !story.instagram_user_id) story.instagram_user_id = story.instagram_actor_id;
  delete story.instagram_actor_id;
  // Na leitura vêm a imagem por hash e por URL; na criação a Meta aceita só uma.
  if (story.link_data?.image_hash && story.link_data.picture) delete story.link_data.picture;
  if (story.video_data?.image_hash && story.video_data.image_url) delete story.video_data.image_url;
  return story;
}

export type CreativeEditPlan =
  | { ok: true; params: Record<string, string>; before: CreativeInfo; after: CreativeInfo; creative: AnyRecord }
  | { ok: false; reason: string };

/**
 * Criativo novo com a edição aplicada, pronto para POST act_X/adcreatives.
 * Devolve o motivo quando não dá (publicação existente, URL de mensagem...) ou
 * quando nada mudaria.
 */
export function planCreativeEdit(creative: AnyRecord | null | undefined, edit: CreativeEdit, name?: string): CreativeEditPlan {
  if (!creative) return { ok: false, reason: 'criativo não encontrado' };
  const before = describeCreative(creative);
  if (before.kind === 'post') return { ok: false, reason: 'usa uma publicação existente — edite a publicação na página' };
  const touchesUrl = isChanging(edit.url) || Boolean(edit.stripUtmFromUrl);
  if (touchesUrl && before.urlLockedReason) return { ok: false, reason: `a URL não muda: o anúncio ${before.urlLockedReason}` };

  const baseline = sanitizeStorySpec(creative.object_story_spec);
  const story: AnyRecord = sanitizeStorySpec(creative.object_story_spec);
  const feed: AnyRecord | null = creative.asset_feed_spec ? JSON.parse(JSON.stringify(creative.asset_feed_spec)) : null;
  const editUrl = (value: unknown) => {
    if (!isSiteUrl(value)) return value;
    let next = applyTextEdit(value, edit.url);
    if (edit.stripUtmFromUrl) next = stripUtmParams(next);
    return next;
  };

  const link: AnyRecord | undefined = story.link_data;
  if (link) {
    editKey(link, 'message', edit.primaryText);
    editKey(link, 'name', edit.title);
    editKey(link, 'description', edit.description);
    if (touchesUrl) {
      link.link = editUrl(link.link);
      if (link.call_to_action?.value?.link) link.call_to_action.value.link = editUrl(link.call_to_action.value.link);
    }
    if (Array.isArray(link.child_attachments)) {
      for (const child of link.child_attachments) {
        // "Trocar por" vale para o anúncio, não para o título de cada cartão do carrossel.
        if (edit.title?.mode === 'replace') editKey(child, 'name', edit.title);
        if (edit.description?.mode === 'replace') editKey(child, 'description', edit.description);
        if (touchesUrl) {
          child.link = editUrl(child.link);
          if (child.call_to_action?.value?.link) child.call_to_action.value.link = editUrl(child.call_to_action.value.link);
        }
      }
    }
  }

  const video: AnyRecord | undefined = story.video_data;
  if (video) {
    editKey(video, 'message', edit.primaryText);
    editKey(video, 'title', edit.title);
    editKey(video, 'link_description', edit.description);
    if (touchesUrl && video.call_to_action?.value?.link) video.call_to_action.value.link = editUrl(video.call_to_action.value.link);
  }

  if (feed) {
    for (const [key, field] of [['bodies', 'primaryText'], ['titles', 'title'], ['descriptions', 'description']] as const) {
      const next = editTextList(feed[key], edit[field]);
      if (next) feed[key] = next;
      else delete feed[key];
    }
    if (touchesUrl && Array.isArray(feed.link_urls)) {
      feed.link_urls = feed.link_urls.map((item: AnyRecord) => ({ ...item, website_url: editUrl(item.website_url) }));
    }
  }

  let urlTags = String(creative.url_tags ?? '');
  if (edit.urlTags?.mode === 'set') urlTags = edit.urlTags.value.trim().replace(/^\?/, '');
  if (edit.urlTags?.mode === 'remove') urlTags = '';

  const unchanged =
    JSON.stringify(story) === JSON.stringify(baseline) &&
    JSON.stringify(feed) === JSON.stringify(creative.asset_feed_spec ?? null) &&
    urlTags === String(creative.url_tags ?? '');
  if (unchanged) return { ok: false, reason: 'nada muda neste anúncio' };

  const edited: AnyRecord = { ...creative, object_story_spec: story, ...(feed ? { asset_feed_spec: feed } : {}), url_tags: urlTags };
  const params: Record<string, string> = {
    name: `${name || creative.name || 'Criativo'} · editado`.slice(0, 250),
    object_story_spec: JSON.stringify(story),
  };
  if (feed) params.asset_feed_spec = JSON.stringify(feed);
  if (urlTags) params.url_tags = urlTags;
  // Mantém os ajustes de enquadramento (ex.: "original, sem corte") do criativo anterior.
  const features = creative.degrees_of_freedom_spec?.creative_features_spec;
  if (features && typeof features === 'object') params.degrees_of_freedom_spec = JSON.stringify({ creative_features_spec: features });
  return { ok: true, params, before, after: describeCreative(edited), creative: edited };
}

/** tracking_specs que liga o anúncio ao pixel (eventos do site). */
export const pixelTrackingSpecs = (pixelId: string) => JSON.stringify([{ 'action.type': ['offsite_conversion'], fb_pixel: [pixelId] }]);

/** Pixel que o anúncio usa hoje, lido do tracking_specs. */
export function pixelOf(trackingSpecs: unknown): string {
  if (!Array.isArray(trackingSpecs)) return '';
  for (const spec of trackingSpecs) {
    const pixel = spec?.fb_pixel?.[0];
    if (pixel) return String(pixel);
  }
  return '';
}
