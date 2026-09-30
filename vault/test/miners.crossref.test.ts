import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCrossrefAdapter } from '../src/miners/crossref.ts';
import { assertRateLimited, collect, fakeFetch, fx, mockClock } from './miners.helpers.ts';

const topics = [
  { id: 'polymer-eor', query: 'polymer flooding heavy oil', keywords: [], negative: [] },
  { id: 'orinoco', query: 'Orinoco extra-heavy', keywords: [], negative: [] },
];

test('crossref: from-index-date window, polite mailto, cursor paging, JATS abstract stripped (page 1 is a recorded response)', async () => {
  const clock = mockClock();
  const f = fakeFetch([
    [/cursor=AoJ2NEXTCURSOR/, () => fx('crossref-page2.json')],
    [/cursor=\*/, () => fx('crossref-page1.json')],
  ], clock);
  const adapter = createCrossrefAdapter({ fetch: f.fetch, clock, mailto: 'chris@alpha-technical-centre.com', rows: 2 });
  assert.equal(adapter.rateLimit.perSecond, 5);
  const recs = await collect(adapter.fetch(new Date('2026-06-01T00:00:00Z'), topics));
  // topic 1: 2 + 1 records over two pages; topic 2: the same two pages again
  assert.equal(recs.length, 6);
  const r = recs[0];
  assert.equal(r.external_id, '10.9734/jerr/2021/v21i1017497');
  assert.match(r.title, /^Critical Review of Polymer Flooding in Daqing Field/);
  assert.equal(r.authors[0], 'Okechukwu Ezeh');
  assert.equal(r.authored_at, '2021-12-25T00:00:00.000Z');
  assert.match(r.text!, /^Aim: Polymer flooding is a promising chemical enhanced oil recovery/);
  assert.ok(!/<jats/.test(r.text!));
  assert.equal(r.meta.topic_id, 'polymer-eor');
  assert.equal(recs[2].authored_at, '2026-08-01T00:00:00.000Z', 'a year-month date defaults to the first of the month');

  assert.match(f.calls[0].url, /filter=from-index-date:2026-06-01/);
  assert.match(f.calls[0].url, /mailto=chris%40alpha-technical-centre\.com/);
  assert.match((f.calls[0].init!.headers as any)['user-agent'], /mailto:chris@alpha-technical-centre\.com/);
  assertRateLimited(f.calls, 5, clock);
});
