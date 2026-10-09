import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTextEdit,
  describeCreative,
  pixelOf,
  pixelTrackingSpecs,
  planCreativeEdit,
  stripUtmParams,
} from '../src/lib/metaBulkEdit.ts';

const imageAd = {
  id: '1',
  name: 'Creative - AD01',
  url_tags: '',
  object_story_spec: {
    page_id: '10',
    instagram_actor_id: '20',
    link_data: {
      link: 'https://site.com/mba?utm_source={{placement}}&utm_campaign=x&ref=7',
      message: 'Texto antigo de BLACK FRIDAY',
      name: 'Título antigo',
      image_hash: 'h1',
      picture: 'https://scontent/x.jpg',
      call_to_action: { type: 'LEARN_MORE', value: { link: 'https://site.com/mba?utm_source={{placement}}&utm_campaign=x&ref=7' } },
    },
  },
  degrees_of_freedom_spec: { creative_features_spec: { image_uncrop: { enroll_status: 'OPT_OUT' } }, degrees_of_freedom_type: 'USER_ENROLLED' },
};

test('troca de texto e localizar/substituir', () => {
  assert.equal(applyTextEdit('abc BF abc', { mode: 'replace', find: 'abc', replace: 'x' }), 'x BF x');
  assert.equal(applyTextEdit(' antigo ', { mode: 'set', value: ' novo ' }), 'novo');
  assert.equal(applyTextEdit('igual', { mode: 'keep' }), 'igual');
});

test('tira só os utm_ da URL', () => {
  assert.equal(stripUtmParams('https://a.com/p?utm_source=x&ref=1&utm_medium={{adset.name}}#topo'), 'https://a.com/p?ref=1#topo');
  assert.equal(stripUtmParams('https://a.com/p?utm_source=x'), 'https://a.com/p');
  assert.equal(stripUtmParams('https://a.com/p'), 'https://a.com/p');
});

test('anúncio de imagem: novo texto, título e URL viram um criativo novo', () => {
  const plan = planCreativeEdit(imageAd, {
    primaryText: { mode: 'replace', find: 'BLACK FRIDAY', replace: 'CYBER MONDAY' },
    title: { mode: 'set', value: 'Título novo' },
    url: { mode: 'replace', find: 'site.com/mba', replace: 'site.com/mba-2' },
  }, 'AD01');
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const story = JSON.parse(plan.params.object_story_spec);
  assert.equal(story.link_data.message, 'Texto antigo de CYBER MONDAY');
  assert.equal(story.link_data.name, 'Título novo');
  assert.ok(story.link_data.link.startsWith('https://site.com/mba-2?'));
  assert.ok(story.link_data.call_to_action.value.link.startsWith('https://site.com/mba-2?'));
  assert.equal(story.link_data.picture, undefined, 'picture sai quando há image_hash');
  assert.equal(story.instagram_user_id, '20');
  assert.equal(story.instagram_actor_id, undefined);
  assert.deepEqual(JSON.parse(plan.params.degrees_of_freedom_spec), { creative_features_spec: { image_uncrop: { enroll_status: 'OPT_OUT' } } });
  assert.equal(plan.params.name, 'AD01 · editado');
  assert.equal(plan.after.title, 'Título novo');
  // O original não é alterado.
  assert.equal(imageAd.object_story_spec.link_data.name, 'Título antigo');
});

test('rastreamento: parâmetros de URL no criativo e utm_ fora do link', () => {
  const plan = planCreativeEdit(imageAd, { urlTags: { mode: 'set', value: '?utm_source=facebook&utm_content={{ad.name}}' }, stripUtmFromUrl: true });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.params.url_tags, 'utm_source=facebook&utm_content={{ad.name}}');
  assert.equal(JSON.parse(plan.params.object_story_spec).link_data.link, 'https://site.com/mba?ref=7');
});

test('vídeo e criativo dinâmico', () => {
  const video = { object_story_spec: { page_id: '1', video_data: { video_id: 'v', image_hash: 'h', image_url: 'https://x', message: 'M', title: 'T', call_to_action: { type: 'LEARN_MORE', value: { link: 'https://a.com/' } } } } };
  const plan = planCreativeEdit(video, { description: { mode: 'set', value: 'Desc' }, url: { mode: 'set', value: 'https://b.com/' } });
  assert.equal(plan.ok, true);
  if (plan.ok) {
    const data = JSON.parse(plan.params.object_story_spec).video_data;
    assert.equal(data.link_description, 'Desc');
    assert.equal(data.call_to_action.value.link, 'https://b.com/');
    assert.equal(data.image_url, undefined);
  }

  const dynamic = { object_story_spec: { page_id: '1' }, asset_feed_spec: { bodies: [{ text: 'A promo' }, { text: 'B promo' }], titles: [{ text: 'T' }], link_urls: [{ website_url: 'https://a.com/' }], videos: [{ video_id: 'v' }] } };
  const replaced = planCreativeEdit(dynamic, { primaryText: { mode: 'replace', find: 'promo', replace: 'oferta' } });
  assert.equal(replaced.ok, true);
  if (replaced.ok) assert.deepEqual(JSON.parse(replaced.params.asset_feed_spec).bodies, [{ text: 'A oferta' }, { text: 'B oferta' }]);
  const single = planCreativeEdit(dynamic, { primaryText: { mode: 'set', value: 'Único' } });
  if (single.ok) assert.deepEqual(JSON.parse(single.params.asset_feed_spec).bodies, [{ text: 'Único' }]);

  const labeled = { object_story_spec: { page_id: '1' }, asset_feed_spec: { titles: [{ text: 'X', adlabels: [{ name: 'a' }] }, { text: 'Y', adlabels: [{ name: 'b' }] }], link_urls: [{ website_url: 'https://a.com/' }] } };
  const kept = planCreativeEdit(labeled, { title: { mode: 'set', value: 'Z' } });
  if (kept.ok) assert.equal(JSON.parse(kept.params.asset_feed_spec).titles.length, 2);
});

test('não mexe no que não dá ou não muda', () => {
  assert.deepEqual(planCreativeEdit({ object_story_id: '1_2' }, { title: { mode: 'set', value: 'x' } }), { ok: false, reason: 'usa uma publicação existente — edite a publicação na página' });
  const whatsapp = { object_story_spec: { page_id: '1', link_data: { link: 'https://www.facebook.com/1', message: 'oi', call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } } } } };
  const blocked = planCreativeEdit(whatsapp, { url: { mode: 'set', value: 'https://a.com' } });
  assert.equal(blocked.ok, false);
  assert.equal(describeCreative(whatsapp).urlLockedReason, 'é de mensagem (WhatsApp/Messenger)');
  // Texto de anúncio de WhatsApp pode mudar.
  assert.equal(planCreativeEdit(whatsapp, { primaryText: { mode: 'set', value: 'novo' } }).ok, true);
  const leadForm = { object_story_spec: { page_id: '1', link_data: { link: 'https://www.facebook.com/1', call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: '9' } } } } };
  assert.equal(describeCreative(leadForm).urlLockedReason, 'é de formulário de lead');
  assert.deepEqual(planCreativeEdit(imageAd, { title: { mode: 'set', value: 'Título antigo' } }), { ok: false, reason: 'nada muda neste anúncio' });
});

test('pixel do anúncio', () => {
  assert.equal(pixelOf(JSON.parse(pixelTrackingSpecs('555'))), '555');
  assert.equal(pixelOf([{ 'action.type': ['post_engagement'], page: ['1'] }]), '');
  assert.equal(pixelOf(undefined), '');
});
