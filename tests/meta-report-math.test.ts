import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountDays, totalsOf } from '../src/lib/metaReportMath.ts';

// Valores da planilha de acompanhamento (meta diária 10).
const sheet = [
  { date: '2026-09-30', spend: 275.33, metaLeads: 13, crmLeads: 12 },
  { date: '2026-10-01', spend: 361.8, metaLeads: 24, crmLeads: 22 },
  { date: '2026-10-02', spend: 450.47, metaLeads: 26, crmLeads: 26 },
  { date: '2026-10-03', spend: 394.94, metaLeads: 21, crmLeads: 22 },
  { date: '2026-10-04', spend: 290.6, metaLeads: 9, crmLeads: 12 },
  { date: '2026-10-05', spend: 279.31, metaLeads: 10, crmLeads: 12 },
  { date: '2026-10-06', spend: 257.64, metaLeads: 14, crmLeads: 11 },
];

test('diferença e GAP acumulado batem com a planilha', () => {
  const rows = buildAccountDays(sheet, 10);
  assert.deepEqual(rows.map((row) => row.diff), [1, 2, 0, -1, -3, -2, 3]);
  assert.deepEqual(rows.map((row) => row.gap), [2, 14, 30, 42, 44, 46, 47]);
});

test('CPL do gerenciador bate com a planilha', () => {
  const rows = buildAccountDays(sheet, 10);
  assert.deepEqual(rows.map((row) => Math.round((row.cplMeta as number) * 100) / 100), [21.18, 15.08, 17.33, 18.81, 32.29, 27.93, 18.4]);
});

test('CPL de 3 dias usa custo e leads dos últimos 3 dias', () => {
  const rows = buildAccountDays(sheet, 10);
  assert.equal(Math.round((rows[0].cpl3d as number) * 100) / 100, 21.18);
  // (275,33 + 361,80) / (13 + 24)
  assert.equal(Math.round((rows[1].cpl3d as number) * 100) / 100, 17.22);
  // (361,80 + 450,47 + 394,94) / (24 + 26 + 21)
  assert.equal(Math.round((rows[3].cpl3d as number) * 100) / 100, 17.0);
});

test('dia sem CRM não tem diferença nem GAP e não conta no acumulado', () => {
  const rows = buildAccountDays(
    [
      { date: '2026-10-01', spend: 100, metaLeads: 10, crmLeads: 12 },
      { date: '2026-10-02', spend: 100, metaLeads: 10, crmLeads: null },
      { date: '2026-10-03', spend: 100, metaLeads: 10, crmLeads: 15 },
    ],
    10,
  );
  assert.deepEqual(rows.map((row) => row.diff), [-2, null, -5]);
  assert.deepEqual(rows.map((row) => row.gap), [2, null, 7]);
  assert.equal(rows[1].cplCrm, null);
});

test('sem meta diária não há GAP; sem leads não há CPL', () => {
  const rows = buildAccountDays([{ date: '2026-10-01', spend: 50, metaLeads: 0, crmLeads: 3 }], null);
  assert.equal(rows[0].gap, null);
  assert.equal(rows[0].cplMeta, null);
  assert.equal(rows[0].cplCrm, 50 / 3);
});

test('totais comparam o CPL do CRM só nos dias com CRM', () => {
  const rows = buildAccountDays(
    [
      { date: '2026-10-01', spend: 100, metaLeads: 10, crmLeads: 10 },
      { date: '2026-10-02', spend: 300, metaLeads: 10, crmLeads: null },
    ],
    10,
  );
  const totals = totalsOf(rows);
  assert.equal(totals.spend, 400);
  assert.equal(totals.metaLeads, 20);
  assert.equal(totals.crmLeads, 10);
  assert.equal(totals.cplMeta, 20);
  assert.equal(totals.cplCrm, 10);
  assert.equal(totals.daysWithCrm, 1);
});
