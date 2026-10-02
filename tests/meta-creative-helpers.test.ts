import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aspectLabel,
  autoPairMedia,
  buildPlacementAssetFeedSpec,
  detectPlacementFormat,
  extractAdCopy,
  normalizeMediaName,
  pickInheritedCopy,
} from '../src/lib/metaCreativeHelpers.ts';

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
  assert.deepEqual(autoPairMedia([...items], { f1: 's2' }), { f1: 's2', f2: 's1' });
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
