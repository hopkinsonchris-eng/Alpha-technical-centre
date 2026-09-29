import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEiaAdapter } from '../src/miners/eia.ts';
import { assertRateLimited, collect, fakeFetch, fx, mockClock } from './miners.helpers.ts';

test('eia: API v2 series read newest-first from start, grouped by month; key required', async () => {
  const clock = mockClock();
  const f = fakeFetch([[/\/v2\/petroleum\/crd\/crpdn\/data\//, () => fx('eia-crude.json')], [/\/v2\/petroleum\/pri\/spt\/data\//, () => ({ response: { data: [] } })]], clock);
  const adapter = createEiaAdapter({ fetch: f.fetch, clock, apiKey: 'k123' });
  assert.equal(adapter.id, 'eia');
  assert.equal(adapter.rateLimit.perSecond, 5);
  const recs = await collect(adapter.fetch(new Date('2026-01-01T00:00:00Z'), []));
  assert.deepEqual(recs.map(r => r.external_id), ['eia:us-crude-production:2026-02', 'eia:us-crude-production:2026-03']);
  const rows = JSON.parse(recs[1].file!.toString());
  assert.equal(rows[0].value, '13520');
  assert.equal(recs[1].meta.rows, 1);
  assert.match(f.calls[0].url, /start=2026-01/);
  assert.match(f.calls[0].url, /api_key=k123/);
  assert.match(f.calls[1].url, /facets\[series\]\[\]=RWTC/);
});

test('eia: many pages honour the rate limit under a mock clock, and a missing key fails clearly', async () => {
  const clock = mockClock();
  const f = fakeFetch([[/offset=(\d+)/, (u) => ({ response: { data: [{ period: '2026-03', value: u.length }, { period: '2026-03', value: 1 }] } })]], clock);
  const adapter = createEiaAdapter({ fetch: f.fetch, clock, apiKey: 'k', pageSize: 2, maxPages: 4, series: [{ id: 's', label: 'S', route: 'petroleum/x/y' }] });
  const recs = await collect(adapter.fetch(new Date('2026-03-01T00:00:00Z'), []));
  assert.equal(f.calls.length, 4);
  assert.equal(recs[0].meta.rows, 8);
  assertRateLimited(f.calls, 5, clock);

  const saved = process.env.EIA_API_KEY; delete process.env.EIA_API_KEY;
  try { await assert.rejects(collect(createEiaAdapter({ fetch: f.fetch, clock }).fetch(new Date(), [])), /EIA_API_KEY/); }
  finally { if (saved !== undefined) process.env.EIA_API_KEY = saved; }
});
