import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySendResponse } from '../supabase/functions/cs-run-scheduled/send-policy.ts';

test('only positive provider acknowledgement marks a delivery sent', () => {
  assert.deepEqual(classifySendResponse(201, { key: { id: 'provider-id' } }), { status: 'sent', messageId: 'provider-id' });
  for (const payload of [null, {}, { key: {} }, { key: { id: '' } }, { key: { id: 23 } }]) {
    assert.equal(classifySendResponse(200, payload).status, 'uncertain');
  }
});
test('ambiguous server and proxy failures never enter automatic retries', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(classifySendResponse(status, {}).status, 'uncertain');
});
test('explicit input/auth rejections are terminal failures', () => {
  for (const status of [400, 401, 403, 404, 405, 422]) assert.equal(classifySendResponse(status, {}).status, 'failed');
});
