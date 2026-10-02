import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSemanticScholarAdapter } from '../src/miners/semantic-scholar.ts';
import { assertRateLimited, collect, fakeFetch, fx, mockClock } from './miners.helpers.ts';

const topic = { id: 'polymer-eor', query: 'polymer flooding heavy oil', keywords: [], negative: [] };
const since = new Date('2026-08-01T00:00:00Z');

function setup(extra: object = {}) {
  const clock = mockClock();
  const f = fakeFetch([
    [/recommendations\/v1\/papers/, () => fx('s2-recs.json')],
    [/search\/bulk\?.*token=NEXTTOKEN/, () => fx('s2-bulk-page2.json')],
    [/search\/bulk\?/, () => fx('s2-bulk-page1.json')],
  ], clock);
  const adapter = createSemanticScholarAdapter({ fetch: f.fetch, clock, ...extra });
  return { clock, f, adapter };
}

test('semantic-scholar: bulk search pages by token and recommendations come from vault seeds', async () => {
  const { clock, f, adapter } = setup({ apiKey: 'test-key', seedIds: () => ['s2aaa111'] });
  assert.equal(adapter.id, 'semantic-scholar');
  assert.equal(adapter.rateLimit.perSecond, 1);
  const recs = await collect(adapter.fetch(since, [topic]));
  assert.deepEqual(recs.map(r => r.external_id), ['s2aaa111', 's2bbb222', 's2ccc333', 's2rec444']);
  const first = recs[0];
  assert.equal(first.title, 'Polymer Flooding Pilot in a Heavy Oil Reservoir');
  assert.equal(first.authored_at, '2026-08-20T00:00:00.000Z');
  assert.deepEqual(first.authors, ['A. Rivera', 'J. Okafor']);
  assert.match(first.text!, /1,200 cP heavy oil/);
  assert.equal(first.meta.doi, '10.2118/999001-ms');
  assert.equal(first.meta.topic_id, 'polymer-eor');
  assert.equal(recs[2].text, undefined, 'a paper without an abstract has no text');
  assert.equal(recs[3].meta.via, 'recommendation');
  assert.equal(recs[3].meta.topic_id, undefined);

  const bulk = f.calls[0];
  assert.match(bulk.url, /publicationDateOrYear=2026-08-01:/);
  assert.match(bulk.url, /query=polymer%20flooding%20heavy%20oil/);
  assert.equal((bulk.init!.headers as any)['x-api-key'], 'test-key');
  const post = f.calls.at(-1)!;
  assert.equal(post.init!.method, 'POST');
  assert.deepEqual(JSON.parse(String(post.init!.body)), { positivePaperIds: ['s2aaa111'] });
  assertRateLimited(f.calls, 1, clock);
});

test('semantic-scholar: a 429 is retried four times with a growing back-off before the source gives up', async () => {
  const clock = mockClock();
  let n = 0;
  const f = fakeFetch([[/search\/bulk\?/, () => { n++; return n <= 4 ? new Response('rate limited', { status: 429 }) : fx('s2-bulk-page1.json'); }]], clock);
  const adapter = createSemanticScholarAdapter({ fetch: f.fetch, clock, maxPagesPerTopic: 1 });
  const recs = await collect(adapter.fetch(since, [topic]));
  assert.ok(recs.length >= 1, 'the fifth attempt answers');
  assert.equal(n, 5);
});

test('semantic-scholar: without a key no header is sent, and with no seeds no recommendation call is made', async () => {
  const saved = process.env.S2_API_KEY; delete process.env.S2_API_KEY;
  try {
    const { f, adapter } = setup();
    const recs = await collect(adapter.fetch(since, [topic]));
    assert.equal(recs.length, 3);
    assert.equal(f.calls.length, 2);
    assert.equal((f.calls[0].init!.headers as any)['x-api-key'], undefined);
  } finally { if (saved !== undefined) process.env.S2_API_KEY = saved; }
});
