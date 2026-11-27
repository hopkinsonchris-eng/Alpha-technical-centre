// 27 Nov 2026: search answers or fails clearly in about 20 seconds, and leaves nothing running.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { configureSearch, hybridSearch, loadProjects, resolveScope, searchWithStatus, SearchAbortedError, SearchTimeoutError } from '../src/gateway/index.ts';
import { FakeEmbedder, VoyageEmbedder } from '../src/ingest/embed.ts';
import { VoyageReranker, RERANK_MS } from '../src/gateway/rerank.ts';
import { recentSearchTimings, resetSearchTimings } from '../src/gateway/timings.ts';
import { paragraphs } from './fixtures/ingest/build.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import type { Person } from '../src/auth.ts';
import type { Db } from '../src/db/client.ts';

let h: Harness;
let partner: Person;
const P = 'orinoco-partnership';
const fake = new FakeEmbedder();
const embed = async (t: string) => (await fake.embed([t]))[0];
/** What statement_timeout raises in Postgres. */
const pgTimeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
let word = 'reservoir';

/** Make the database "time out" the statements that match, as Db.bounded would on the real backend; count what ran. */
function timeOut(match: RegExp | null) {
  const ran: string[] = [];
  h.db.bounded = async (_ms, fn) => fn(async (sql: string, params?: unknown[]) => {
    ran.push(sql);
    if (match?.test(sql)) throw pgTimeout();
    return h.db.query(sql, params);
  }) as any;
  return ran;
}

before(async () => {
  h = await setup('vault-searchlimits-');
  const body = paragraphs(30).join('\n\n');
  assert.equal((await h.upload([{ name: 'limits.md', bytes: body, type: 'text/markdown' }])).status, 201);
  const { runIngestSync } = await import('../src/jobs/ingest-sync.ts');
  await runIngestSync(h.db, { embedder: fake } as any).catch(() => undefined);
  partner = (await h.db.query<any>("SELECT id, email, name, role FROM people WHERE role = 'partner' ORDER BY id LIMIT 1")).rows[0];
  const t = (await h.db.query<any>('SELECT text FROM chunks WHERE project_id = $1 LIMIT 1', [P])).rows[0]?.text as string;
  assert.ok(t, 'the fixture file was chunked');
  word = (t.match(/[A-Za-z]{6,}/) ?? ['reservoir'])[0];
});
after(async () => { configureSearch({}); await h.db.close(); });

const scopeOf = async () => { const projects = await loadProjects(h.db); return { projects, scope: resolveScope(`project:${P}`, partner, projects) }; };

test('both statements run under a time limit; a healthy search is not partial', async () => {
  const ran = timeOut(null);
  const { projects, scope } = await scopeOf();
  const r = await searchWithStatus(h.db, word, scope, partner, projects, { embed, maxDistance: fake.maxDistance });
  assert.equal(r.partial, null);
  assert.ok(r.hits.length >= 1);
  assert.equal(ran.length, 2, 'the lexical and the vector statement both went through Db.bounded');
});

test('when the meaning-based statement runs out of time the word matches come back, marked partial', async () => {
  timeOut(/<=>/);
  resetSearchTimings();
  const { projects, scope } = await scopeOf();
  const r = await searchWithStatus(h.db, word, scope, partner, projects, { embed, maxDistance: fake.maxDistance });
  assert.ok(r.hits.length >= 1);
  assert.match(r.partial?.reason ?? '', /word matches only: the meaning-based match passed 7 s and was stopped/);
  const [t] = recentSearchTimings();
  assert.equal(t.stage, 'done');
  assert.match(t.error ?? '', /word matches only/);

  configureSearch({ embed, maxDistance: fake.maxDistance });
  const res = await h.app.request(`/api/search?q=${encodeURIComponent(word)}&scope=project:${P}`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.partial, true);
  assert.match(body.note, /word matches only/);
  assert.ok(body.hits.length >= 1);
});

test('when the embedding call hangs or fails the word matches come back, marked partial, within the limit', async () => {
  const ran = timeOut(null);
  const { projects, scope } = await scopeOf();
  const t0 = Date.now();
  const hung = await searchWithStatus(h.db, word, scope, partner, projects, { embed: () => new Promise<number[]>(() => undefined) }, { limits: { embedMs: 80 } });
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(hung.hits.length >= 1);
  assert.match(hung.partial?.reason ?? '', /embedding: no answer/);
  assert.equal(ran.length, 1, 'no vector statement without a query vector');
  const failed = await searchWithStatus(h.db, word, scope, partner, projects, { embed: async () => { throw new Error('voyage 503: overloaded'); } });
  assert.match(failed.partial?.reason ?? '', /voyage 503/);
  const none = await searchWithStatus(h.db, word, scope, partner, projects, { embed: async () => [] });
  assert.match(none.partial?.reason ?? '', /none returned/);
});

test('when the word match itself runs out of time the caller gets a clear 504, from the route and from the MCP tool', async () => {
  timeOut(/plainto_tsquery/);
  const { projects, scope } = await scopeOf();
  await assert.rejects(hybridSearch(h.db, word, scope, partner, projects, { embed }), (e: any) => e instanceof SearchTimeoutError && /passed 6 s and was stopped/.test(e.message));
  const res = await h.app.request(`/api/search?q=${encodeURIComponent(word)}&scope=project:${P}`);
  assert.equal(res.status, 504);
  assert.equal(((await res.json()) as any).error.code, 'search_timeout');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { createApp } = await import('../src/app.ts');
  const app = await createApp({ db: h.db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', get devUserEmail() { return process.env.DEV_USER_EMAIL; } }, version: 'test' });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: ((url: any, init: any) => { process.env.DEV_USER_EMAIL = 'chris@alpha-technical-centre.com'; return app.request(url, init); }) as any }));
  const bad = (await client.callTool({ name: 'search_vault', arguments: { q: word, scope: `project:${P}` } })) as any;
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.error.code, 'search_timeout');
  timeOut(/<=>/);
  const part = (await client.callTool({ name: 'search_vault', arguments: { q: word, scope: `project:${P}` } })) as any;
  assert.equal(part.structuredContent.partial, true);
  assert.ok(part.structuredContent.hits.length >= 1);
  assert.equal(typeof part.structuredContent.took_ms, 'number');
  timeOut(null);
  const ok = (await client.callTool({ name: 'search_vault', arguments: { q: word, scope: `project:${P}` } })) as any;
  assert.equal(ok.structuredContent.partial, undefined);
  await client.close();
});

test('once the caller has gone no further statement starts', async () => {
  const ran = timeOut(null);
  const { projects, scope } = await scopeOf();
  const gone = new AbortController(); gone.abort();
  await assert.rejects(searchWithStatus(h.db, word, scope, partner, projects, { embed }, { signal: gone.signal }), SearchAbortedError);
  assert.equal(ran.length, 0);
  const mid = new AbortController();
  await assert.rejects(searchWithStatus(h.db, word, scope, partner, projects, { embed: async (t) => { mid.abort(); return embed(t); } }, { signal: mid.signal }), SearchAbortedError);
  assert.equal(ran.length, 1, 'the lexical statement ran; the vector statement did not');
});

test('the Voyage embedding call gives up at its time limit instead of waiting for ever', async () => {
  let calls = 0;
  const never = ((_url: any, init: any) => new Promise((_res, rej) => { calls++; init.signal.addEventListener('abort', () => rej(init.signal.reason)); })) as unknown as typeof fetch;
  const v = new VoyageEmbedder('k', 'voyage-3.5', never);
  const t0 = Date.now();
  const alive = setInterval(() => undefined, 50);                       // AbortSignal.timeout does not hold the event loop open; a server does
  try { await assert.rejects(v.embed(['q'], 'query', { timeoutMs: 120 }), /no answer/); } finally { clearInterval(alive); }
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(calls >= 1);
});

test('the rerank call gives up at its time limit and the fused order is kept', async () => {
  const never = ((_url: any, init: any) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(init.signal.reason)); })) as unknown as typeof fetch;
  const r = new VoyageReranker('k', 'rerank-2.5', never, 1);
  const hits = [1, 2, 3].map(i => ({ ref: `doc:${i}`, item_id: String(i), run_id: null, version: 1, ordinal: 0, score: 1 / i, snippet: `s${i}`, anchor: null, legal_tag: 'lt', project_id: P }));
  const t0 = Date.now();
  const alive = setInterval(() => undefined, 50);
  let out; try { out = await r.rerank('q', hits, 2); } finally { clearInterval(alive); }
  assert.ok(Date.now() - t0 < RERANK_MS + 1500);
  assert.deepEqual(out.map(x => x.ref), ['doc:1', 'doc:2']);
});
