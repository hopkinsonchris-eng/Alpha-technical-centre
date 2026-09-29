import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoyageReranker, openReranker, RERANK_MODEL } from '../src/gateway/rerank.ts';
import { searchDeps, configureSearch } from '../src/gateway/index.ts';
import { passthroughReranker, type SearchHit } from '../src/gateway/search.ts';

const hit = (n: number, title: string, snippet: string): SearchHit => ({ ref: `doc:0000000${n}-0000-4000-8000-000000000000`, item_id: `0000000${n}-0000-4000-8000-000000000000`, run_id: null, version: 1, ordinal: 0, score: 1 / (60 + n), snippet, anchor: null, legal_tag: 'lt-firm', project_id: 'firm', title });
const HITS = [
  hit(1, 'Basis note BN-LLA-02', 'Voidage replacement of 1.0 is an assumption.'),
  hit(2, 'Cubiro waterflood base run', 'Voidage replacement capped at injector capacity of 8,500 bwpd.'),
  hit(3, 'ANH production by field', 'CUBIRO: oil 9,420 bopd, water cut 88%.'),
  hit(4, 'Unrelated invoice', 'Payment terms 30 days.'),
];

/** A Voyage /v1/rerank response as recorded from the API (rerank-2.5), abridged. */
const RECORDED = { object: 'list', data: [{ index: 1, relevance_score: 0.8828125 }, { index: 0, relevance_score: 0.5234375 }, { index: 2, relevance_score: 0.2158203125 }], model: 'rerank-2.5', usage: { total_tokens: 118 } };

function recorder(responses: Array<{ status: number; body: unknown }>) {
  const calls: { url: string; init: any; body: any }[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('VoyageReranker sends the query and candidates, and reorders by the recorded relevance scores', async () => {
  const { fn, calls } = recorder([{ status: 200, body: RECORDED }]);
  const out = await new VoyageReranker('key-123', undefined, fn, 1).rerank('cubiro voidage', HITS, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.voyageai.com/v1/rerank');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer key-123');
  assert.equal(calls[0].body.model, RERANK_MODEL); assert.equal(RERANK_MODEL, 'rerank-2.5');
  assert.equal(calls[0].body.query, 'cubiro voidage');
  assert.equal(calls[0].body.top_k, 3);
  assert.equal(calls[0].body.documents.length, 4);
  assert.match(calls[0].body.documents[1], /^Cubiro waterflood base run\nVoidage replacement capped/);
  assert.deepEqual(out.map(h => h.title), ['Cubiro waterflood base run', 'Basis note BN-LLA-02', 'ANH production by field']);
  assert.deepEqual(out.map(h => h.score), [0.8828125, 0.5234375, 0.2158203125]);
  assert.equal(out[0].ref, HITS[1].ref, 'the hit keeps its ref and legal tag');
  assert.equal(out[0].legal_tag, 'lt-firm');
});

test('VoyageReranker ignores indices the provider invents, caps at topK, and honours VOYAGE_RERANK_MODEL', async () => {
  const { fn, calls } = recorder([{ status: 200, body: { data: [{ index: 9, relevance_score: 0.99 }, { index: 2, relevance_score: 0.7 }, { index: 2, relevance_score: 0.6 }, { index: 3, relevance_score: 0.5 }] } }]);
  const r = openReranker({ VOYAGE_API_KEY: 'k', VOYAGE_RERANK_MODEL: 'rerank-3' } as any, fn);
  assert.ok(r instanceof VoyageReranker);
  const out = await r.rerank('q', HITS, 1);
  assert.deepEqual(out.map(h => h.title), ['ANH production by field']);
  assert.equal(calls[0].body.model, 'rerank-3');
});

test('VoyageReranker retries a 429, keeps the fused order when the provider keeps failing, and does not retry a 400', async () => {
  const ok = recorder([{ status: 429, body: 'slow down' }, { status: 200, body: RECORDED }]);
  assert.equal((await new VoyageReranker('k', undefined, ok.fn, 1).rerank('q', HITS, 4))[0].title, 'Cubiro waterflood base run');
  assert.equal(ok.calls.length, 2);
  const down = recorder([{ status: 503, body: 'unavailable' }]);
  const fused = await new VoyageReranker('k', undefined, down.fn, 1).rerank('q', HITS, 2);
  assert.deepEqual(fused.map(h => h.ref), [HITS[0].ref, HITS[1].ref]);
  assert.equal(down.calls.length, 3);
  const bad = recorder([{ status: 400, body: 'bad request' }]);
  assert.deepEqual((await new VoyageReranker('k', undefined, bad.fn, 1).rerank('q', HITS, 2)).map(h => h.ref), [HITS[0].ref, HITS[1].ref]);
  assert.equal(bad.calls.length, 1);
  const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal((await new VoyageReranker('k', undefined, boom, 1).rerank('q', HITS, 2)).length, 2);
});

test('a single candidate is returned without calling the provider', async () => {
  const { fn, calls } = recorder([{ status: 200, body: RECORDED }]);
  assert.equal((await new VoyageReranker('k', undefined, fn).rerank('q', HITS.slice(0, 1), 5)).length, 1);
  assert.equal(calls.length, 0);
});

test('openReranker is the passthrough without a key; searchDeps embeds a query and delegates to configureSearch', async () => {
  assert.equal(openReranker({} as any), passthroughReranker);
  assert.equal(openReranker({ VOYAGE_API_KEY: '' } as any), passthroughReranker);
  assert.deepEqual(await passthroughReranker.rerank('q', HITS, 2), HITS.slice(0, 2));
  const saved = process.env.VOYAGE_API_KEY; delete process.env.VOYAGE_API_KEY;
  try {
    configureSearch({});
    const deps = searchDeps();
    const v = await deps.embed('waterflood voidage');
    assert.equal(v.length, 1024);
    assert.deepEqual(await deps.reranker.rerank('q', HITS, 2), HITS.slice(0, 2));
    // an override made after searchDeps() was handed out (as the draft routes hold it) still applies
    configureSearch({ embed: async () => [1, 2, 3] });
    assert.deepEqual(await deps.embed('x'), [1, 2, 3]);
  } finally { configureSearch({}); if (saved !== undefined) process.env.VOYAGE_API_KEY = saved; }
});
