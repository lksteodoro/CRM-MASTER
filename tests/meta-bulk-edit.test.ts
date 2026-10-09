import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adsManagerLink,
  changesFor,
  isAggressiveBudgetChange,
  leadsFromActions,
  nextBudgetCents,
  ownBudget,
  parseReais,
  renameWith,
  reviewIssues,
  statusFiltering,
  undoChanges,
} from '../src/lib/metaBulkEdit.ts';

test('filtro de status respeita o que cada nível aceita', () => {
  assert.deepEqual(JSON.parse(statusFiltering('campaign', 'paused'))[0].value, ['PAUSED']);
  assert.deepEqual(JSON.parse(statusFiltering('ad', 'paused'))[0].value, ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']);
  assert.ok(JSON.parse(statusFiltering('ad', 'issues'))[0].value.includes('DISAPPROVED'));
  assert.ok(!JSON.parse(statusFiltering('campaign', 'issues'))[0].value.includes('DISAPPROVED'));
  assert.ok(!JSON.parse(statusFiltering('adset', 'all'))[0].value.includes('ARCHIVED'));
});

test('leads: primeira ação de lead que aparecer', () => {
  assert.equal(leadsFromActions([{ action_type: 'link_click', value: '9' }, { action_type: 'onsite_conversion.lead_grouped', value: '4' }]), 4);
  assert.equal(leadsFromActions([{ action_type: 'lead', value: '7' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' }]), 7);
  assert.equal(leadsFromActions(undefined), 0);
});

test('orçamento: valor fixo, aumento e redução em percentual', () => {
  assert.deepEqual(ownBudget({ daily_budget: '5000' }), { field: 'daily_budget', cents: 5000 });
  assert.deepEqual(ownBudget({ lifetime_budget: 100000 }), { field: 'lifetime_budget', cents: 100000 });
  assert.equal(ownBudget({ daily_budget: '0' }), null);
  assert.equal(nextBudgetCents(5000, { mode: 'set', value: 80 }), 8000);
  assert.equal(nextBudgetCents(5000, { mode: 'increase', value: 20 }), 6000);
  assert.equal(nextBudgetCents(3333, { mode: 'decrease', value: 10 }), 3000);
  assert.equal(nextBudgetCents(5000, { mode: 'decrease', value: 100 }), null);
  assert.equal(nextBudgetCents(5000, { mode: 'set', value: 0 }), null);
  assert.equal(isAggressiveBudgetChange(5000, 6000), false);
  assert.equal(isAggressiveBudgetChange(5000, 6500), true);
  assert.equal(parseReais('1.234,56'), 1234.56);
  assert.equal(parseReais('R$ 50'), 50);
  assert.equal(parseReais('49.9'), 49.9);
});

test('renomear com localizar, substituir, prefixo e sufixo', () => {
  assert.equal(renameWith('[MBA] AD01_0810', { find: '0810', replace: '0910', prefix: '', suffix: '' }), '[MBA] AD01_0910');
  assert.equal(renameWith('AD01', { find: '', replace: '', prefix: '[BF] ', suffix: ' - v2' }), '[BF] AD01 - v2');
});

test('só manda o que muda e sabe desfazer', () => {
  const rows = [
    { id: '1', status: 'ACTIVE' },
    { id: '2', status: 'PAUSED' },
  ];
  const changes = changesFor(rows, (row) => ({ params: { status: 'PAUSED' }, previous: { status: row.status } }));
  assert.deepEqual(changes, [{ id: '1', params: { status: 'PAUSED' }, previous: { status: 'ACTIVE' } }]);
  assert.deepEqual(undoChanges(changes), [{ id: '1', params: { status: 'ACTIVE' }, previous: { status: 'PAUSED' } }]);
});

test('motivos de reprovação e link do gerenciador', () => {
  assert.deepEqual(reviewIssues({ global: { LANDING_PAGE_FAIL: 'A página de destino não carrega.' } }), ['A página de destino não carrega.']);
  assert.deepEqual(reviewIssues({ placement_specific: { instagram: { X: 'y' } } }).length, 1);
  assert.deepEqual(reviewIssues(null), []);
  assert.equal(adsManagerLink('adset', 'act_123', '456'), 'https://adsmanager.facebook.com/adsmanager/manage/adsets?act=123&selected_adsets_ids=456');
});
