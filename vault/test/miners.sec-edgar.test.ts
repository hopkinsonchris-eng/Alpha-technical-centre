import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecEdgarAdapter, extractReserves } from '../src/miners/sec-edgar.ts';
import { assertRateLimited, collect, fakeFetch, fx, fxJson, mockClock, text } from './miners.helpers.ts';

test('sec-edgar: company facts for configured issuers, only us-gaap reserves concepts, declared User-Agent (recorded response, trimmed)', async () => {
  const clock = mockClock();
  const f = fakeFetch([
    [/CIK0001090012\.json/, () => fx('sec-companyfacts-devon.json')],
    [/CIK0000821189\.json/, () => fx('sec-companyfacts-devon.json')],
    [/CIK0000000001\.json/, () => text('{}', 404)],
  ], clock);
  const warnings: string[] = [];
  const adapter = createSecEdgarAdapter({
    fetch: f.fetch, clock, onWarn: m => warnings.push(m), userAgent: 'Alpha Technical Centre chris@alpha-technical-centre.com',
    issuers: [{ cik: '1090012', name: 'Devon Energy' }, { cik: '0000821189', name: 'EOG' }, { cik: '1', name: 'Nobody' }],
  });
  assert.equal(adapter.rateLimit.perSecond, 5);
  const recs = await collect(adapter.fetch(new Date('2000-01-01T00:00:00Z'), []));
  assert.equal(recs.length, 2);
  const r = recs[0];
  assert.equal(r.external_id, 'sec-edgar:CIK0001090012:reserves');
  assert.equal(r.url, 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001090012.json');
  const facts = JSON.parse(r.file!.toString());
  assert.ok(facts.length > 0);
  assert.ok(facts.every((x: any) => /Proved|Standardized/.test(x.concept)), 'only reserves concepts');
  assert.ok(!facts.some((x: any) => x.concept === 'Revenues'));
  assert.ok(facts.some((x: any) => x.concept === 'ProvedDevelopedReservesBOE1' && x.unit === 'MMBoe'));
  assert.equal(r.meta.rows, facts.length);
  assert.match(warnings.join('|'), /no company facts/);
  assert.equal((f.calls[0].init!.headers as any)['user-agent'], 'Alpha Technical Centre chris@alpha-technical-centre.com');
  assert.equal(f.calls.length, 3);
  assertRateLimited(f.calls, 5, clock);
});

test('sec-edgar: an issuer with nothing filed since the window opened yields no record', async () => {
  const clock = mockClock();
  const f = fakeFetch([[/CIK/, () => fxJson('sec-companyfacts-devon.json')]], clock);
  const adapter = createSecEdgarAdapter({ fetch: f.fetch, clock, issuers: [{ cik: '1090012', name: 'Devon' }] });
  assert.equal((await collect(adapter.fetch(new Date('2099-01-01T00:00:00Z'), []))).length, 0);
});

test('sec-edgar: extractReserves ignores unrelated us-gaap concepts', () => {
  const facts = { facts: { 'us-gaap': {
    ProvedDevelopedAndUndevelopedReservesNet: { label: 'Reserves', units: { MMBoe: [{ end: '2025-12-31', val: 100, filed: '2026-02-20', fy: 2025, fp: 'FY', form: '10-K', accn: 'a' }] } },
    RestructuringReserve: { label: 'x', units: { USD: [{ end: '2025-12-31', val: 5, filed: '2026-02-20' }] } },
    InventoryPartsAndComponentsNetOfReserves: { label: 'x', units: { USD: [{ end: '2025-12-31', val: 5, filed: '2026-02-20' }] } },
  } } };
  assert.deepEqual(extractReserves(facts).map(f => f.concept), ['ProvedDevelopedAndUndevelopedReservesNet']);
});
