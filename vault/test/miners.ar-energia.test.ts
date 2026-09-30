import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArEnergiaAdapter } from '../src/miners/ar-energia.ts';
import { assertRateLimited, collect, fakeFetch, fx, mockClock } from './miners.helpers.ts';

test('ar-energia: CKAN datastore_search paged newest first at 4 req/s, grouped by month, stops at since', async () => {
  const clock = mockClock();
  const f = fakeFetch([
    [/offset=2/, () => fx('ar-page2.json')],
    [/offset=0/, () => fx('ar-page1.json')],
    [/offset=4/, () => ({ success: true, result: { records: [] } })],
  ], clock);
  const adapter = createArEnergiaAdapter({ fetch: f.fetch, clock, pageSize: 2 });
  assert.equal(adapter.rateLimit.perSecond, 4);
  const recs = await collect(adapter.fetch(new Date('2025-12-01T00:00:00Z'), []));
  assert.deepEqual(recs.map(r => r.external_id.split(':').pop()), ['2025-12', '2026-01', '2026-02']);
  const rows = JSON.parse(recs[1].file!.toString());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].produccion_petroleo_crudo_ypf_sa, 21113765.46);
  assert.equal(rows[0]._id, undefined, 'CKAN row ids are not part of the data');
  assert.match(f.calls[0].url, /sort=indice_tiempo%20desc/);
  assert.match(f.calls[0].url, /resource_id=c730496f/);
  // page 2 already reached a month before `since`, so there is no third page
  assert.equal(f.calls.length, 2);
});

test('ar-energia: many pages stay under 4 requests per second under a mock clock', async () => {
  const clock = mockClock();
  const f = fakeFetch([[/offset=(\d+)/, (u) => {
    const off = Number(/offset=(\d+)/.exec(u)![1]);
    return { success: true, result: { records: [{ _id: off, indice_tiempo: `2026-03-01T00:00:00`, v: off }, { _id: off + 1, indice_tiempo: '2026-03-01T00:00:00', v: off + 1 }] } };
  }]], clock);
  const adapter = createArEnergiaAdapter({ fetch: f.fetch, clock, pageSize: 2, maxPages: 6 });
  const recs = await collect(adapter.fetch(new Date('2026-03-01T00:00:00Z'), []));
  assert.equal(f.calls.length, 6);
  assert.equal(recs.length, 1);
  assert.equal(JSON.parse(recs[0].file!.toString()).length, 12);
  assertRateLimited(f.calls, 4, clock);
  assert.ok(f.calls[5].at - f.calls[0].at >= 1250 - 1, 'six requests need at least 1.25 s at 4 per second');
});
