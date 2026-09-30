import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnpAdapter, summariseAnpZip } from '../src/miners/anp-br.ts';
import { assertRateLimited, buildZip, collect, fakeFetch, fx, mockClock, text } from './miners.helpers.ts';

const zipFor = () => buildZip([{ name: 'producao-mensal-por-poco-2026-03.csv', data: fx('anp-2026-03.csv') }, { name: 'LEIAME.txt', data: 'ignore me' }]);

test('anp-br: streams the CSV inside the monthly zip (semicolons, decimal commas, accents) into a roll-up', async () => {
  const s = await summariseAnpZip(zipFor());
  assert.equal(s.rows, 4);
  assert.equal(s.wells, 4);
  assert.equal(s.oil_total, 17035.25);
  assert.equal(s.gas_total, 315.75);
  assert.deepEqual(s.by_field.JUBARTE, { oil: 15000.75, gas: 300.5, wells: 2 });
  assert.deepEqual(s.entries, ['producao-mensal-por-poco-2026-03.csv']);
});

test('anp-br: one snapshot per available month from since to now; missing months warn; zip kept as the original', async () => {
  const clock = mockClock(Date.UTC(2026, 3, 10)); // 10 April 2026
  const zip = zipFor();
  const f = fakeFetch([
    [/2026-03\.zip$/, () => zip],
    [/2026-02\.zip$/, () => zip],
    [/2026-04\.zip$/, () => text('not found', 404)],
  ], clock);
  const warnings: string[] = [];
  const adapter = createAnpAdapter({ fetch: f.fetch, clock, onWarn: m => warnings.push(m), urlTemplate: 'https://example.test/anp/{month}.zip' });
  assert.equal(adapter.rateLimit.perSecond, 1);
  const recs = await collect(adapter.fetch(new Date('2026-02-15T00:00:00Z'), []));
  assert.deepEqual(recs.map(r => r.external_id), ['anp-br:producao-mensal-por-poco:2026-02', 'anp-br:producao-mensal-por-poco:2026-03']);
  const r = recs[1];
  assert.equal(r.mime, 'application/zip');
  assert.deepEqual(r.file, zip);
  assert.equal(r.meta.rows, 4);
  assert.equal(r.meta.wells, 4);
  assert.equal(r.url, 'https://example.test/anp/2026-03.zip');
  assert.match(warnings[0], /2026-04 not available/);
  assertRateLimited(f.calls, 1, clock);
});
