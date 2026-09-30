import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abstractFromInverted, createOpenAlexAdapter } from '../src/miners/openalex.ts';
import { assertRateLimited, collect, fakeFetch, fx, mockClock } from './miners.helpers.ts';

const topic = { id: 'orinoco', query: 'Orinoco extra-heavy oil recovery', keywords: [], negative: [] };

test('openalex: from_publication_date, cursor paging, inverted abstract rebuilt', async () => {
  const clock = mockClock();
  const f = fakeFetch([
    [/cursor=CUR2/, () => fx('openalex-page2.json')],
    [/cursor=\*/, () => fx('openalex-page1.json')],
  ], clock);
  const adapter = createOpenAlexAdapter({ fetch: f.fetch, clock, mailto: 'chris@alpha-technical-centre.com', perPage: 2 });
  assert.equal(adapter.rateLimit.perSecond, 5);
  // three topics so that there are enough requests to see the spacing
  const recs = await collect(adapter.fetch(new Date('2026-08-15T00:00:00Z'), [topic]));
  assert.deepEqual(recs.map(r => r.external_id), ['W1001', 'W1002', 'W1003']);
  assert.equal(recs[0].url, 'https://doi.org/10.1016/j.petrol.2026.111');
  assert.equal(recs[0].meta.doi, '10.1016/j.petrol.2026.111');
  assert.equal(recs[0].authored_at, '2026-09-02T00:00:00.000Z');
  assert.deepEqual(recs[0].authors, ['M. Lopez', 'K. Tanaka']);
  assert.match(recs[0].text!, /^Cold production with sand recovers extra-heavy oil in the production Orinoco$/);
  assert.equal(recs[2].url, 'https://example.org/W1003', 'no DOI: landing page');
  assert.match(f.calls[0].url, /filter=from_publication_date:2026-08-15/);

  // more topics: the limiter spaces every call
  const clock2 = mockClock();
  const f2 = fakeFetch([[/cursor=CUR2/, () => fx('openalex-page2.json')], [/cursor=\*/, () => fx('openalex-page1.json')]], clock2);
  const a2 = createOpenAlexAdapter({ fetch: f2.fetch, clock: clock2, perPage: 2 });
  await collect(a2.fetch(new Date('2026-08-15T00:00:00Z'), [topic, { ...topic, id: 't2' }]));
  assert.equal(f2.calls.length, 4);
  assertRateLimited(f2.calls, 5, clock2);
});

test('openalex: abstractFromInverted orders words by position', () => {
  assert.equal(abstractFromInverted({ world: [1], hello: [0, 2] }), 'hello world hello');
  assert.equal(abstractFromInverted(null), undefined);
});
