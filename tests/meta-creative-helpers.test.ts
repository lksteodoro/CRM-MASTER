import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aspectLabel,
  autoPairMedia,
  brazilRegulationParams,
  buildPlacementAssetFeedSpec,
  buildTextOptionsAssetFeedSpec,
  classifyAdSetDestination,
  detectPlacementFormat,
  extractAdTextOptions,
  hasTextVariations,
  mediaLibraryName,
  extractAdCopy,
  normalizeMediaName,
  pickBrazilIdentities,
  pickInheritedCopy,
  readBrazilIdentities,
  textOptions,
} from '../src/lib/metaCreativeHelpers.ts';

test('UNDEFINED com conversão no site é destino site, não multi-destino', () => {
  assert.deepEqual(classifyAdSetDestination('UNDEFINED', 'OFFSITE_CONVERSIONS'), { destType: 'WEBSITE', isMultiDest: false });
  assert.deepEqual(classifyAdSetDestination('WEBSITE', 'LINK_CLICKS'), { destType: 'WEBSITE', isMultiDest: false });
  assert.deepEqual(classifyAdSetDestination('UNDEFINED', 'CONVERSATIONS'), { destType: 'WHATSAPP', isMultiDest: true });
  assert.deepEqual(classifyAdSetDestination('WHATSAPP', 'CONVERSATIONS'), { destType: 'WHATSAPP', isMultiDest: false });
  assert.deepEqual(classifyAdSetDestination(undefined, undefined), { destType: 'WEBSITE', isMultiDest: true });
});

test('nome seguro para a biblioteca de mídia', () => {
  assert.equal(mediaLibraryName('Pós Graduação Feed (1).png'), 'Pos_Graduacao_Feed_1.png');
  assert.equal(mediaLibraryName('***'), 'imagem');
});

test('detecta Stories pela proporção', () => {
  assert.equal(detectPlacementFormat(1080, 1920), 'story');
  assert.equal(detectPlacementFormat(1080, 1350), 'feed');
  assert.equal(detectPlacementFormat(1080, 1080), 'feed');
  assert.equal(detectPlacementFormat(0, 0), 'feed');
  assert.equal(aspectLabel(1080, 1920), '9:16');
  assert.equal(aspectLabel(1080, 1350), '4:5');
});

test('normaliza o nome tirando marcadores de formato', () => {
  assert.equal(normalizeMediaName('Criativo01_FEED.mp4'), normalizeMediaName('criativo01-stories.mp4'));
  assert.equal(normalizeMediaName('AD 3 - 9x16.mov'), normalizeMediaName('AD 3 - 4x5.mov'));
  assert.notEqual(normalizeMediaName('AD1_feed.mp4'), normalizeMediaName('AD2_story.mp4'));
});

test('pareia por nome e mantém o par manual', () => {
  const items = [
    { id: 'f1', name: 'oferta_feed.mp4', type: 'VIDEO', placement: 'feed' },
    { id: 'f2', name: 'depoimento_feed.mp4', type: 'VIDEO', placement: 'feed' },
    { id: 's2', name: 'depoimento_stories.mp4', type: 'VIDEO', placement: 'story' },
    { id: 's1', name: 'oferta_stories.mp4', type: 'VIDEO', placement: 'story' },
  ] as const;
  assert.deepEqual(autoPairMedia([...items]), { f1: 's1', f2: 's2' });
  // O par manual fica; o que sobrou tem nomes diferentes e não é juntado na ordem.
  assert.deepEqual(autoPairMedia([...items], { f1: 's2' }), { f1: 's2' });
});

test('na ordem só quando nenhum nome bate, e nunca o que foi separado à mão', () => {
  const items = [
    { id: 'f1', name: 'mba_feed.mp4', type: 'VIDEO', placement: 'feed' },
    { id: 's1', name: 'mba_stories.mp4', type: 'VIDEO', placement: 'story' },
    { id: 'f2', name: 'convite_professor.mp4', type: 'VIDEO', placement: 'feed' },
    { id: 's2', name: 'ultima_chamada_stories.mp4', type: 'VIDEO', placement: 'story' },
  ] as const;
  assert.deepEqual(autoPairMedia([...items]), { f1: 's1' });
  assert.deepEqual(autoPairMedia([...items], {}, ['f1']), {});
  assert.deepEqual(
    autoPairMedia([
      { id: 'a', name: 'IMG_1.mov', type: 'VIDEO', placement: 'feed' },
      { id: 'b', name: 'IMG_7.mov', type: 'VIDEO', placement: 'story' },
    ]),
    { a: 'b' }
  );
});

test('não pareia tipos diferentes e cai para a ordem quando os nomes não batem', () => {
  const pairs = autoPairMedia([
    { id: 'f1', name: 'a.jpg', type: 'IMAGE', placement: 'feed' },
    { id: 's1', name: 'x.mp4', type: 'VIDEO', placement: 'story' },
    { id: 'f2', name: 'b.mp4', type: 'VIDEO', placement: 'feed' },
  ]);
  assert.deepEqual(pairs, { f2: 's1' });
});

test('monta o asset_feed_spec de Feed + Stories', () => {
  const spec: any = buildPlacementAssetFeedSpec({
    mediaType: 'VIDEO',
    feed: { videoId: 'v1', thumbHash: 't1' },
    story: { videoId: 'v2', thumbHash: 't2' },
    copy: { primaryText: 'Texto', title: 'Título', cta: 'LEARN_MORE' },
    link: 'https://site.com/?utm_source=x',
  });
  assert.equal(spec.videos.length, 2);
  assert.deepEqual(spec.videos[1], { video_id: 'v2', thumbnail_hash: 't2', adlabels: [{ name: 'venza_story' }] });
  assert.equal(spec.optimization_type, 'PLACEMENT');
  assert.equal(spec.asset_customization_rules.length, 2);
  assert.deepEqual(spec.asset_customization_rules[0].video_label, { name: 'venza_story' });
  assert.equal(spec.asset_customization_rules[1].is_default, true);
  assert.deepEqual(spec.link_urls, [{ website_url: 'https://site.com/?utm_source=x' }]);
  assert.equal(spec.descriptions, undefined);
});

test('extrai copy e URL de imagem, vídeo e dinâmico', () => {
  assert.deepEqual(
    extractAdCopy({ object_story_spec: { link_data: { link: 'https://a.com', message: 'M', name: 'T', description: 'D', call_to_action: { type: 'SIGN_UP' } } } }),
    { link: 'https://a.com', primaryText: 'M', title: 'T', description: 'D', cta: 'SIGN_UP', urlTags: '' }
  );
  assert.equal(extractAdCopy({ object_story_spec: { video_data: { message: 'V', call_to_action: { value: { link: 'https://v.com' } } } } }).link, 'https://v.com');
  const dyn = extractAdCopy({ asset_feed_spec: { bodies: [{ text: 'B' }], titles: [{ text: 'TT' }], link_urls: [{ website_url: 'https://d.com' }], call_to_action_types: ['SHOP_NOW'] }, url_tags: 'utm_source=fb' });
  assert.equal(dyn.link, 'https://d.com');
  assert.equal(dyn.primaryText, 'B');
  assert.equal(dyn.cta, 'SHOP_NOW');
  assert.equal(dyn.urlTags, 'utm_source=fb');
});

test('herda a URL mais usada entre os anúncios ativos do conjunto', () => {
  const ad = (id: string, status: string, link: string, message = 'copy ' + id) => ({
    id,
    name: `AD ${id}`,
    effective_status: status,
    creative: { object_story_spec: { link_data: { link, message } } },
  });
  const inherited = pickInheritedCopy([
    ad('1', 'ACTIVE', 'https://a.com'),
    ad('2', 'ACTIVE', 'https://b.com'),
    ad('3', 'ACTIVE', 'https://b.com'),
    ad('4', 'PAUSED', 'https://c.com'),
  ]);
  assert.equal(inherited?.link, 'https://b.com');
  assert.deepEqual(inherited?.distinctLinks, ['https://b.com', 'https://a.com']);
  assert.equal(inherited?.adCount, 3);
  assert.equal(inherited?.primaryText, 'copy 2');
  assert.equal(pickInheritedCopy([]), null);
  assert.equal(pickInheritedCopy([ad('9', 'PAUSED', 'https://p.com')])?.link, 'https://p.com');
});

test('opções de texto: limpa, tira repetidas e para em 5', () => {
  assert.deepEqual(textOptions([' A ', '', 'B', 'A', null, 'C', 'D', 'E', 'F']), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(hasTextVariations({ primaryTexts: ['A'], titles: ['T'], descriptions: [] }), false);
  assert.equal(hasTextVariations({ primaryTexts: ['A'], titles: ['T1', 'T2'], descriptions: [] }), true);
});

test('monta o anúncio com várias opções de texto', () => {
  const spec: any = buildTextOptionsAssetFeedSpec({
    mediaType: 'VIDEO',
    asset: { videoId: 'v1', thumbUrl: 'https://thumb' },
    options: { primaryTexts: ['B1', 'B2'], titles: ['T1', 'T2', 'T3'], descriptions: [] },
    cta: 'SIGN_UP',
    link: 'https://site.com/?utm_source=x',
  });
  assert.deepEqual(spec.videos, [{ video_id: 'v1', thumbnail_url: 'https://thumb' }]);
  assert.deepEqual(spec.bodies, [{ text: 'B1' }, { text: 'B2' }]);
  assert.equal(spec.titles.length, 3);
  assert.equal(spec.descriptions, undefined);
  assert.deepEqual(spec.ad_formats, ['SINGLE_VIDEO']);
  assert.deepEqual(spec.call_to_action_types, ['SIGN_UP']);
  assert.equal(spec.optimization_type, undefined);
  assert.equal(spec.asset_customization_rules, undefined);
});

test('lê todas as opções de texto de um anúncio dinâmico', () => {
  assert.deepEqual(
    extractAdTextOptions({ asset_feed_spec: { bodies: [{ text: 'B1' }, { text: 'B2' }], titles: [{ text: 'T1' }], descriptions: [{ text: 'D1' }, { text: 'D1' }] } }),
    { primaryTexts: ['B1', 'B2'], titles: ['T1'], descriptions: ['D1'] }
  );
  const inherited = pickInheritedCopy([
    { id: '1', effective_status: 'ACTIVE', creative: { asset_feed_spec: { bodies: [{ text: 'X' }, { text: 'Y' }], link_urls: [{ website_url: 'https://a.com' }] } } },
  ]);
  assert.deepEqual(inherited?.options.primaryTexts, ['X', 'Y']);
});

test('beneficiário e pagador: lê do conjunto e escolhe o par mais usado', () => {
  assert.deepEqual(
    readBrazilIdentities({ id: '1', regional_regulated_categories: ['BRAZIL_REGULATION'], regional_regulation_identities: { universal_beneficiary: '111', universal_payer: '222' } }),
    { beneficiaryId: '111', payerId: '222' }
  );
  assert.deepEqual(readBrazilIdentities({ id: '2', regional_regulation_identities: { universal_payer: 333 } }), { beneficiaryId: '333', payerId: '333' });
  assert.equal(readBrazilIdentities({ id: '3' }), null);
  assert.equal(
    readBrazilIdentities({ id: '4', regional_regulated_categories: ['THAILAND_UNIVERSAL'], regional_regulation_identities: { universal_beneficiary: '9', universal_payer: '9' } }),
    null
  );

  const ids = (b: string, p: string) => ({ universal_beneficiary: b, universal_payer: p });
  const picked = pickBrazilIdentities([
    { id: 'a', name: 'Antigo', campaign_id: 'c1', created_time: '2026-01-01T00:00:00+0000', regional_regulation_identities: ids('1', '1') },
    { id: 'b', name: 'Novo', campaign_id: 'c2', created_time: '2026-09-01T00:00:00+0000', regional_regulation_identities: ids('2', '3') },
    { id: 'c', name: 'Novo 2', campaign_id: 'c2', created_time: '2026-09-02T00:00:00+0000', regional_regulation_identities: ids('2', '3') },
    { id: 'd', name: 'Sem declaração' },
  ]);
  assert.deepEqual(picked, { beneficiaryId: '2', payerId: '3', sourceAdSetName: 'Novo 2', adSetCount: 2 });
  // Empate: vale o par da campanha escolhida.
  const tie = pickBrazilIdentities(
    [
      { id: 'a', campaign_id: 'c1', created_time: '2026-09-09T00:00:00+0000', regional_regulation_identities: ids('1', '1') },
      { id: 'b', name: 'Da campanha', campaign_id: 'c2', created_time: '2026-01-01T00:00:00+0000', regional_regulation_identities: ids('2', '2') },
    ],
    ['c2']
  );
  assert.equal(tie?.beneficiaryId, '2');
  assert.equal(pickBrazilIdentities([{ id: 'x' }]), null);
});

test('parâmetros de regulação do Brasil no conjunto novo', () => {
  assert.deepEqual(brazilRegulationParams({ beneficiaryId: ' 111 ', payerId: '' }), {
    regional_regulated_categories: '["BRAZIL_REGULATION"]',
    regional_regulation_identities: '{"universal_beneficiary":"111","universal_payer":"111"}',
  });
});
