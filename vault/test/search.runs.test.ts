// Wave 7 PR1 (S31, W7-AC2): runs are found by Find. POST /api/runs chunks the run's title, assumptions and outputs
// through the ingest module under the run's own legal tag, so "Cubiro" finds "Cubiro-1 ESP nodal" in the project's
// scope and nowhere else; superseding a run retires its chunks; runs saved before this change are indexed by the
// partner-only backfill route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';

const DOMAIN = 'alpha-technical-centre.com';
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const BASE = JSON.parse(readFileSync(path.join(FIX, 'run-record/valid-1.json'), 'utf8'));
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const TAG = 'lt-frontera-nda-2026';

const record = (o: Record<string, unknown> = {}) => ({
  ...BASE, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], asset_ids: [], project_id: 'llanos-screen', client_id: 'frontera', legal_tag: TAG,
  title: 'Cubiro-1 ESP nodal',
  assumptions: { oil_viscosity_cp: { value: 3, unit: 'cP', source: 'analogue', provenance: 'analogue' }, pump_depth_ft: { value: 5200, unit: 'ft', source: 'client-stated' } },
  outputs: { liquid_rate_bpd: { value: 1840, unit: 'bpd', low: 1500, high: 2100 }, operating_frequency_hz: { value: 56, unit: 'Hz' } },
  status: 'draft', ...o,
});

interface Seed { db: Db; call(person: string, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> }

async function seed(): Promise<Seed> {
  const db = await openDb(undefined); await migrate(db);
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('chris','chris@${DOMAIN}','Chris','partner'),('ana','ana@${DOMAIN}','Ana','associate')`);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','ANH'),('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','ATC internal','lt-firm')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client'),('petroperu','Petroperú','client')");
  await db.query(`INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ('${TAG}','client-nda','second-party','frontera','Frontera Energy','2027-03-31')`);
  await db.query(`INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('llanos-screen','frontera','Llanos screen','${TAG}','{chris,ana}'),('talara','petroperu','Talara','lt-firm','{chris}')`);
  const apps = new Map<string, Awaited<ReturnType<typeof createApp>>>();
  return {
    db,
    async call(person, method, url, body) {
      if (!apps.has(person)) apps.set(person, await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `${person}@${DOMAIN}` }, version: 'test' }));
      const r = await apps.get(person)!.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    },
  };
}

test('S31: a run saved through POST /api/runs is found by its title, its assumptions and its outputs, in its project\'s scope only', async () => {
  const { db, call } = await seed();
  const rec = record();
  const saved = await call('chris', 'POST', '/api/runs', rec);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const chunks = (await db.query<any>('SELECT run_id::text AS run_id, item_id, legal_tag, client_id, project_id, current, text, context, embedding IS NOT NULL AS embedded FROM chunks WHERE run_id = $1 ORDER BY ordinal', [rec.id])).rows;
  assert.ok(chunks.length >= 1, 'the run is chunked');
  for (const c of chunks) {
    assert.equal(c.item_id, null); assert.equal(c.legal_tag, TAG); assert.equal(c.client_id, 'frontera'); assert.equal(c.project_id, 'llanos-screen');
    assert.equal(c.current, true); assert.equal(c.embedded, true);
  }
  const all = chunks.map((c: any) => `${c.context}\n${c.text}`).join('\n');
  assert.match(all, /Cubiro-1 ESP nodal/); assert.match(all, /viscosity/i); assert.match(all, /1840/); assert.match(all, /bpd/);

  for (const q of ['Cubiro', 'cubiro-1', 'viscosity', 'liquid rate', 'ESP nodal']) {
    const r = await call('ana', `GET`, `/api/search?q=${encodeURIComponent(q)}&scope=project:llanos-screen`);
    assert.equal(r.status, 200);
    const hit = r.body.hits.find((h: any) => h.run_id === rec.id);
    assert.ok(hit, `"${q}" finds the run: ${JSON.stringify(r.body.hits.map((h: any) => h.title))}`);
    assert.equal(hit.ref, `run:${rec.id}`); assert.equal(hit.type, 'run'); assert.equal(hit.title, 'Cubiro-1 ESP nodal'); assert.deepEqual(hit.authors, ['chris']);
  }
  assert.deepEqual((await call('ana', 'GET', '/api/search?q=Cubiro&scope=project:llanos-screen&types=run')).body.hits.map((h: any) => h.ref), [`run:${rec.id}`]);
  // Not in firm scope, not in another client's project.
  assert.deepEqual((await call('chris', 'GET', '/api/search?q=Cubiro&scope=firm')).body.hits, []);
  assert.deepEqual((await call('chris', 'GET', '/api/search?q=Cubiro&scope=project:talara')).body.hits, []);
  // Saving the identical record again dedupes and does not double the chunks.
  assert.equal((await call('chris', 'POST', '/api/runs', rec)).body.deduplicated, true);
  assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM chunks WHERE run_id = $1', [rec.id])).rows[0].n, chunks.length);
  await db.close();
});

test('superseding a run retires its chunks: Find returns the new run only', async () => {
  const { db, call } = await seed();
  const v1 = record();
  assert.equal((await call('chris', 'POST', '/api/runs', v1)).status, 201);
  const v2 = record({ title: 'Cubiro-1 ESP nodal, revised', supersedes: v1.id });
  const r = await call('chris', 'POST', `/api/runs/${v1.id}/supersede`, v2);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const old = (await db.query<any>('SELECT bool_and(NOT current) AS retired FROM chunks WHERE run_id = $1', [v1.id])).rows[0];
  assert.equal(old.retired, true, 'the superseded run\'s chunks are no longer current');
  const hits = (await call('chris', 'GET', '/api/search?q=Cubiro&scope=project:llanos-screen')).body.hits;
  assert.deepEqual(hits.map((h: any) => h.run_id), [v2.id]);
  assert.equal(hits[0].title, 'Cubiro-1 ESP nodal, revised');
  await db.close();
});

test('runs saved before this change are indexed by the partner-only backfill; a hidden run is not', async () => {
  const { db, call } = await seed();
  const old = randomUUID(), hidden = randomUUID();
  const ins = (id: string, title: string, hide: boolean) => db.query(
    `INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,client_id,project_id,legal_tag,title,record,input_hash,status,hidden) VALUES ($1,'nodal','1.0.0','abc1234','chris',now(),'frontera','llanos-screen','${TAG}',$2,$3::jsonb,$4,'final',$5)`,
    [id, title, JSON.stringify({ id, title, outputs: { liquid_rate_bpd: { value: 900, unit: 'bpd' } } }), hashOf(id), hide]);
  await ins(old, 'Cubiro-2 gas lift nodal', false);
  await ins(hidden, 'Cubiro-3 withdrawn nodal', true);
  assert.deepEqual((await call('chris', 'GET', '/api/search?q=Cubiro&scope=project:llanos-screen')).body.hits, [], 'not indexed yet');
  assert.equal((await call('ana', 'POST', '/api/search/reindex-runs')).status, 403);
  const r = await call('chris', 'POST', '/api/search/reindex-runs');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.indexed, 1);
  assert.deepEqual((await call('chris', 'GET', '/api/search?q=Cubiro&scope=project:llanos-screen')).body.hits.map((h: any) => h.run_id), [old]);
  assert.equal((await call('chris', 'POST', '/api/search/reindex-runs')).body.indexed, 0, 'idempotent');
  const ev = (await db.query<any>("SELECT person_id, detail FROM audit_events WHERE action = 'search.reindex_runs' ORDER BY id")).rows;
  assert.ok(ev.length >= 2 && ev.some((e: any) => e.detail.status === 403) && ev.some((e: any) => e.detail.status === 200 && e.detail.indexed === 1));
  await db.close();
});
