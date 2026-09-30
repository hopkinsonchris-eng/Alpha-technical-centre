import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { FakeEmbedder, vectorLiteral } from '../src/ingest/embed.ts';
import { configureSearch } from '../src/gateway/index.ts';
import type { Reranker, SearchHit } from '../src/gateway/search.ts';

const DOMAIN = 'alpha-technical-centre.com';
const as = (id: string) => ({ allowedEmailDomain: DOMAIN, devUserEmail: `${id}@${DOMAIN}` });
const CLIENTS = ['a', 'b', 'c'];
const fake = new FakeEmbedder();
const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 864e5;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

interface Seed { db: Db; get(person: string, url: string): Promise<{ status: number; body: any }> }

/** Three clients, each with a project, NDA-tagged records that all mention "waterflood", plus firm and public records. */
async function seed(url?: string): Promise<Seed> {
  const db = await openDb(url); await migrate(db);
  for (const [id, role] of [['chris', 'partner'], ['ana', 'associate'], ['ben', 'associate'], ['grace', 'associate']]) await db.query('INSERT INTO people (id,email,name,role) VALUES ($1,$2,$3,$4)', [id, `${id}@${DOMAIN}`, id[0].toUpperCase() + id.slice(1), role]);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('mail-capture','mail-capture@x','Mail capture','service')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','ANH'),('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','Firm','lt-firm')");
  for (const c of CLIENTS) {
    await db.query('INSERT INTO organisations (id,name,kind) VALUES ($1,$2,$3)', [c, `Client ${c.toUpperCase()}`, 'client']);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ($1,'client-nda','second-party',$2,$3)", [`lt-${c}-nda`, c, c]);
    await db.query('INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,$2,$3,$4,$5::text[])', [`p-${c}-1`, c, `Project ${c} one`, `lt-${c}-nda`, c === 'a' ? ['ana', 'grace'] : c === 'b' ? ['ben'] : []]);
  }
  const chunk = async (o: { item?: string; run?: string; text: string; tag: string; client: string | null; project: string }) => {
    const [emb] = await fake.embed([o.text]);
    await db.query('INSERT INTO chunks (item_id, run_id, item_version, ordinal, text, legal_tag, client_id, project_id, embedding) VALUES ($1,$2,1,0,$3,$4,$5,$6,$7::vector)',
      [o.item ?? null, o.run ?? null, o.text, o.tag, o.client, o.project, vectorLiteral(emb)]);
  };
  const item = async (o: { type: string; title: string; text: string; tag: string; client: string | null; project: string; authors: string[]; ageDays: number; hidden?: boolean }) => {
    const id = randomUUID();
    await db.query(`INSERT INTO items (id,type,title,created_at,authors,client_id,project_id,legal_tag,origin,content_hash,version,hidden) VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,'{"source":"test"}'::jsonb,$9,1,$10)`,
      [id, o.type, o.title, daysAgo(o.ageDays), o.authors, o.client, o.project, o.tag, 'sha256:' + hex(id), !!o.hidden]);
    await chunk({ item: id, ...o });
    return id;
  };
  const run = async (o: { job: string; title: string; text: string; tag: string; client: string; project: string; author: string; ageDays: number }) => {
    const id = randomUUID();
    await db.query(`INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,client_id,project_id,legal_tag,title,record,input_hash,status) VALUES ($1,$2,'1.0.0','abc1234',$3,$4,$5,$6,$7,$8,'{"outputs":{"npv10":{"value":12}}}'::jsonb,$9,'final')`,
      [id, o.job, o.author, daysAgo(o.ageDays), o.client, o.project, o.tag, o.title, 'sha256:' + hex(id)]);
    await chunk({ run: id, ...o });
    return id;
  };
  for (const c of CLIENTS) {
    const p = `p-${c}-1`, tag = `lt-${c}-nda`;
    await item({ type: 'report', title: `Waterflood evaluation for client ${c}`, text: `Waterflood voidage replacement study for client ${c} field${c}`, tag, client: c, project: p, authors: [c === 'a' ? 'ana' : 'ben'], ageDays: 40 });
    await run({ job: 'nodal', title: `Waterflood base case ${c}`, text: `Waterflood base case run for client ${c}`, tag, client: c, project: p, author: c === 'a' ? 'grace' : 'ben', ageDays: 10 });
  }
  // Project A: grace worked the topic most recently, ana earlier, chris longest ago; a service account and a hidden note never count.
  await item({ type: 'note', title: 'Waterflood basis note', text: 'Waterflood basis note voidage assumptions', tag: 'lt-a-nda', client: 'a', project: 'p-a-1', authors: ['chris'], ageDays: 200 });
  await item({ type: 'email', title: 'Waterflood injection data request', text: 'Waterflood injection data request thread', tag: 'lt-a-nda', client: 'a', project: 'p-a-1', authors: ['mail-capture'], ageDays: 1 });
  await item({ type: 'note', title: 'Hidden waterflood note', text: 'Waterflood hidden note', tag: 'lt-a-nda', client: 'a', project: 'p-a-1', authors: ['grace'], ageDays: 0, hidden: true });
  await item({ type: 'lesson', title: 'Waterflood lesson: derive voidage from injector capacity', text: 'Waterflood lesson voidage from injector capacity', tag: 'lt-firm', client: null, project: 'firm', authors: ['chris'], ageDays: 60 });
  await item({ type: 'paper', title: 'Waterflood synthesis of mature fields', text: 'Waterflood synthesis paper mature fields', tag: 'lt-public', client: null, project: 'firm', authors: ['chris'], ageDays: 90 });

  const apps = new Map<string, Awaited<ReturnType<typeof createApp>>>();
  return {
    db,
    async get(person, url) {
      if (!apps.has(person)) apps.set(person, await createApp({ db, auth: as(person), version: 'test' }));
      const r = await apps.get(person)!.request(url);
      return { status: r.status, body: await r.json() };
    },
  };
}

const NDA_OF = (tag: string) => /^lt-([abc])-nda$/.exec(tag)?.[1];

test('400 without scope or q, 403 outside the caller\'s scope, 400 for a malformed scope', async () => {
  const { db, get } = await seed();
  assert.equal((await get('chris', '/api/search?q=waterflood')).status, 400);
  const noScope = await get('chris', '/api/search?q=waterflood');
  assert.equal(noScope.body.error.code, 'scope_required');
  assert.equal((await get('chris', '/api/search?scope=firm')).status, 400);
  assert.equal((await get('chris', '/api/search?scope=firm&q=')).body.error.code, 'query_required');
  assert.equal((await get('chris', '/api/search?scope=galaxy:1&q=x')).status, 400);
  assert.equal((await get('chris', '/api/search?scope=project:&q=x')).status, 400);
  // associate not on the project / not on any project of the client
  assert.equal((await get('ana', '/api/search?scope=project:p-b-1&q=waterflood')).status, 403);
  assert.equal((await get('ana', '/api/search?scope=client:b&q=waterflood')).status, 403);
  assert.equal((await get('ana', '/api/search?scope=project:nope&q=waterflood')).status, 403);
  assert.equal((await get('ana', '/api/search?scope=project:p-a-1&q=waterflood')).status, 200);
  assert.equal((await get('chris', '/api/search?scope=client:b&q=waterflood')).status, 200);
  assert.equal((await get('chris', '/api/search?scope=project:p-a-1&q=waterflood&k=abc')).status, 400);
  assert.equal((await get('chris', '/api/search?scope=firm&q=waterflood&types=a%20b')).status, 400);
  // the other two routes hold the same line
  assert.equal((await get('chris', '/api/search/people?q=waterflood')).status, 400);
  assert.equal((await get('ana', '/api/search/people?q=waterflood&scope=project:p-b-1')).status, 403);
  assert.equal((await get('chris', '/api/search/runs')).status, 400);
  assert.equal((await get('ana', '/api/search/runs?scope=client:c')).status, 403);
  await db.close();
});

test('hits come only from the scope: no other client\'s NDA chunk in any scope, any caller', async () => {
  const { db, get } = await seed();
  const cases: [string, string, string[]][] = [
    ['ana', 'project:p-a-1', ['a']], ['grace', 'client:a', ['a']], ['chris', 'project:p-a-1', ['a']], ['chris', 'client:a', ['a']],
    ['ben', 'project:p-b-1', ['b']], ['chris', 'client:b', ['b']], ['chris', 'client:c', ['c']], ['chris', 'firm', []], ['ana', 'public', []],
  ];
  for (const [who, scope, allowed] of cases) {
    const r = await get(who, `/api/search?q=${encodeURIComponent('waterflood voidage study')}&scope=${scope}&k=50`);
    assert.equal(r.status, 200, `${who} ${scope}`);
    assert.equal(r.body.scope, scope);
    assert.equal(typeof r.body.took_ms, 'number');
    assert.ok(r.body.hits.length > 0 || scope === 'public' || scope === 'firm', `${who} ${scope} found nothing`);
    for (const h of r.body.hits) {
      const c = NDA_OF(h.legal_tag);
      if (c) assert.ok(allowed.includes(c), `${who} ${scope} leaked ${h.legal_tag}`);
      assert.ok(!scope.startsWith('public') || h.legal_tag === 'lt-public', `${scope} returned ${h.legal_tag}`);
    }
  }
  // Project scope reaches firm and public records, and the partner sees exactly client A's records plus those.
  const p = await get('ana', '/api/search?q=waterflood&scope=project:p-a-1&k=50');
  const tags = new Set(p.body.hits.map((h: any) => h.legal_tag));
  assert.deepEqual([...tags].sort(), ['lt-a-nda', 'lt-firm', 'lt-public']);
  assert.ok(!p.body.hits.some((h: any) => /Hidden/.test(h.title)), 'hidden records never come back');
  // Hit shape: type, date, authors, ref, snippet.
  const rep = p.body.hits.find((h: any) => h.title === 'Waterflood evaluation for client a');
  assert.equal(rep.type, 'report'); assert.deepEqual(rep.authors, ['ana']); assert.match(rep.ref, /^doc:[0-9a-f-]{36}$/); assert.match(rep.snippet, /Waterflood/); assert.ok(rep.date);
  const runHit = p.body.hits.find((h: any) => h.type === 'run');
  assert.match(runHit.ref, /^run:/); assert.equal(runHit.title, 'Waterflood base case a'); assert.deepEqual(runHit.authors, ['grace']);
  // The type filter narrows after ranking; k caps the list.
  const runs = await get('ana', '/api/search?q=waterflood&scope=project:p-a-1&types=run');
  assert.deepEqual(runs.body.hits.map((h: any) => h.type), ['run']);
  const two = await get('ana', '/api/search?q=waterflood&scope=project:p-a-1&k=2');
  assert.equal(two.body.hits.length, 2);
  await db.close();
});

test('every call is audited with the scope, the query hash (not the query) and the returned refs', async () => {
  const { db, get } = await seed();
  const q = '  Waterflood   VOIDAGE ';
  const r = await get('ana', `/api/search?q=${encodeURIComponent(q)}&scope=project:p-a-1`);
  assert.equal(r.status, 200);
  const ev = (await db.query<any>("SELECT * FROM audit_events WHERE action = 'search.query' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(ev.person_id, 'ana'); assert.equal(ev.scope, 'project:p-a-1');
  assert.deepEqual([...ev.refs].sort(), [...new Set(r.body.hits.map((h: any) => h.ref))].sort());
  assert.ok(ev.refs.length > 0);
  assert.equal(ev.detail.query_hash, 'sha256:' + hex('waterflood voidage'), 'the hash is over the trimmed, lower-cased, single-spaced query');
  assert.equal(ev.detail.status, 200);
  assert.ok(!JSON.stringify(ev).toLowerCase().includes('voidage'), 'the query text is never stored');
  // Refused calls are audited too, with the attempted scope.
  await get('ana', '/api/search?q=waterflood&scope=client:b');
  const denied = (await db.query<any>("SELECT * FROM audit_events WHERE action = 'search.query' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(denied.scope, 'client:b'); assert.equal(denied.detail.status, 403); assert.deepEqual(denied.refs, []);
  await get('ana', '/api/search?q=waterflood');
  const missing = (await db.query<any>("SELECT * FROM audit_events WHERE action = 'search.query' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(missing.detail.status, 400); assert.equal(missing.scope, null);
  await get('ana', '/api/search/people?q=waterflood&scope=project:p-a-1');
  assert.equal((await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action = 'search.people'")).rows[0].n, 1);
  await db.close();
});

test('the configured reranker decides the final order, and only over in-scope candidates', async () => {
  const { db, get } = await seed();
  const seen: string[][] = [];
  const reverse: Reranker = { async rerank(_q: string, hits: SearchHit[], k: number) { seen.push(hits.map(h => h.legal_tag)); return [...hits].reverse().slice(0, k); } };
  const base = await get('ana', '/api/search?q=waterflood&scope=project:p-a-1&k=50');
  configureSearch({ reranker: reverse });
  try {
    const flipped = await get('ana', '/api/search?q=waterflood&scope=project:p-a-1&k=50');
    assert.deepEqual(flipped.body.hits.map((h: any) => h.ref), base.body.hits.map((h: any) => h.ref).reverse());
    assert.ok(seen.length === 1 && seen[0].every(t => ['lt-a-nda', 'lt-firm', 'lt-public'].includes(t)), 'the reranker never saw an out-of-scope candidate');
  } finally { configureSearch({}); }
  await db.close();
});

test('people who worked the topic: most recent author first, colleagues only, in scope only', async () => {
  const { db, get } = await seed();
  const r = await get('ana', '/api/search/people?q=waterflood&scope=project:p-a-1');
  assert.equal(r.status, 200);
  const ids = r.body.people.map((p: any) => p.person_id);
  // grace: run 10 days ago; ana: report 40 days ago; chris: lesson 60 days ago, paper, note 200 days ago.
  assert.deepEqual(ids, ['grace', 'ana', 'chris']);
  assert.ok(r.body.people[0].last_at > r.body.people[1].last_at && r.body.people[1].last_at > r.body.people[2].last_at);
  assert.equal(r.body.people[0].name, 'Grace');
  assert.ok(!ids.includes('mail-capture') && !ids.includes('ben'));
  assert.ok(r.body.people[2].count >= 3 && r.body.people[2].refs.every((x: string) => /^(doc|run):/.test(x)));
  const b = await get('chris', '/api/search/people?q=waterflood&scope=client:b');
  assert.deepEqual(b.body.people.map((p: any) => p.person_id), ['ben', 'chris']);
  await db.close();
});

test('runs helper: scoped, filtered by job and since, newest first', async () => {
  const { db, get } = await seed();
  await db.query(`INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,client_id,project_id,legal_tag,title,record,input_hash,status) VALUES ($1,'financial','2.0.0','abc1234','ana',$2,'a','p-a-1','lt-a-nda','Old financial','{}'::jsonb,$3,'final')`, [randomUUID(), daysAgo(100), 'sha256:' + hex('old')]);
  const all = await get('ana', '/api/search/runs?scope=project:p-a-1');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.runs.map((r: any) => r.job), ['nodal', 'financial']);
  assert.ok(all.body.runs.every((r: any) => r.project_id === 'p-a-1' && /^run:/.test(r.ref)) && all.body.runs[0].outputs.npv10.value === 12);
  assert.deepEqual((await get('ana', '/api/search/runs?scope=project:p-a-1&job=financial')).body.runs.map((r: any) => r.title), ['Old financial']);
  assert.deepEqual((await get('ana', `/api/search/runs?scope=project:p-a-1&since=${encodeURIComponent(daysAgo(30))}`)).body.runs.map((r: any) => r.job), ['nodal']);
  assert.equal((await get('ana', '/api/search/runs?scope=project:p-a-1&since=yesterdayish')).status, 400);
  // Client B's runs are invisible from client A's scope and from firm scope, whoever asks.
  assert.equal((await get('chris', '/api/search/runs?scope=client:a')).body.runs.every((r: any) => r.project_id === 'p-a-1'), true);
  assert.deepEqual((await get('chris', '/api/search/runs?scope=firm')).body.runs, []);
  const ev = (await db.query<any>("SELECT refs, detail FROM audit_events WHERE action = 'search.runs' ORDER BY id LIMIT 1")).rows[0];
  assert.equal(ev.refs.length, 2); assert.equal(ev.detail.count, 2);
  await db.close();
});

// The schema has no vector index and the gateway's filtered kNN is an exact scan (the planner joins legal_tags first, so an
// HNSW index is never chosen: measured). Native pgvector does that scan well inside 800 ms; the embedded WASM Postgres used by the
// routine suite is several times slower per distance, so it gets a wider budget. Point SEARCH_PERF_DATABASE_URL at a real
// Postgres (with the vector extension and the vault schema applied by migrate) to hold the 800 ms line.
test('SEARCH_PERF: p95 < 800 ms on a 100k-chunk corpus with the fake embedder and passthrough reranker', { skip: process.env.SEARCH_PERF !== '1', timeout: 30 * 60_000 }, async () => {
  const { db, get } = await seed(process.env.SEARCH_PERF_DATABASE_URL);
  const WORDS = ['cubiro', 'waterflood', 'boscan', 'polymer', 'npv10', 'royalty', 'carabobo', 'injector', 'viscosity', 'vintage', 'voidage', 'sweep', 'aquifer', 'gaslift', 'nodal', 'tubing'];
  const words = `(ARRAY[${WORDS.map(w => `'${w}'`).join(",")}])`;
  const items = (await db.query<any>("SELECT id::text FROM items WHERE legal_tag = 'lt-a-nda' LIMIT 1")).rows[0].id;
  const N = 100_000, BATCH = 1000;
  const t0 = Date.now();
  for (let s = 0; s < N; s += BATCH) {
    // One multi-row INSERT per 1,000 rows. Text and a one-hot 1024-dim embedding are generated server-side.
    await db.query(`INSERT INTO chunks (item_id, item_version, ordinal, text, legal_tag, client_id, project_id, embedding)
      SELECT $1::uuid, 1, g, ${words}[1 + g % 16] || ' ' || ${words}[1 + (g * 7) % 16] || ' ' || ${words}[1 + (g * 13) % 16] || ' chunk ' || g,
             (ARRAY['lt-a-nda','lt-b-nda','lt-c-nda','lt-firm','lt-public'])[1 + g % 5], (ARRAY['a','b','c',NULL,NULL])[1 + g % 5], (ARRAY['p-a-1','p-b-1','p-c-1','firm','firm'])[1 + g % 5],
             ('[' || repeat('0,', g % 1024) || '1' || repeat(',0', 1023 - g % 1024) || ']')::vector
      FROM generate_series($2::int, $3::int) g`, [items, s, s + BATCH - 1]);
  }
  console.log(`  seeded ${N} chunks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await db.query('ANALYZE chunks');
  const times: number[] = [];
  const queries = ['waterflood voidage', 'boscan polymer', 'injector viscosity sweep', 'chunk 4242', 'npv10 royalty', 'carabobo', 'gaslift nodal tubing', 'aquifer'];
  for (let i = 0; i < 40; i++) {
    const q = queries[i % queries.length];
    const t = performance.now();
    const r = await get(i % 2 ? 'chris' : 'ana', `/api/search?q=${encodeURIComponent(q)}&scope=project:p-a-1`);
    times.push(performance.now() - t);
    assert.equal(r.status, 200);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  console.log(`  ${db.backend}: p50 ${times[20].toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${times.at(-1)!.toFixed(0)} ms`);
  const budget = db.backend === 'pg' ? 800 : 1200;
  assert.ok(p95 < budget, `p95 ${p95.toFixed(0)} ms exceeds ${budget} ms on ${db.backend}`);
  await db.close();
});
