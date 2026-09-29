import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureRerun } from '../src/api/rerun.routes.ts';
import { adapterFor, AdapterError } from '../src/adapters/index.ts';
import { createAdapter as createAI, mapState } from '../src/adapters/apex-asset-intelligence.ts';
import { createAdapter as create3D } from '../src/adapters/apex-3d-model.ts';
import { runSnapshotJob } from '../src/jobs/apex-snapshot.ts';
import { validate } from '../src/schemas.ts';
import { runInputHash } from '../src/hash.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = JSON.parse(readFileSync(path.join(HERE, 'fixtures/apex/state.json'), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';

interface Call { url: string; method: string; headers: Record<string, string>; body: any }
function stubFetch(answer: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: any = {}) => {
    const c: Call = { url, method: init.method, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const r = answer(c); const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
  return { fetch, calls };
}

let db: Db;
before(async () => { db = await openDb(undefined); await migrate(db); await seedMaster(db); });
after(async () => { await db.close(); });

test('adapterFor answers only when the app base URL is configured', () => {
  assert.equal(adapterFor('apex-asset-intelligence', { env: {} }), undefined);
  assert.equal(adapterFor('apex-3d-model', { env: { APEX_AI_BASE_URL: 'x' } }), undefined);
  assert.equal(adapterFor('opportunity-register', { env: { APEX_AI_BASE_URL: 'x' } }), undefined);
  assert.equal(adapterFor('apex-asset-intelligence', { env: { APEX_AI_BASE_URL: 'https://a.example' } })?.id, 'apex-asset-intelligence');
  assert.equal(adapterFor('apex-3d-model', { env: { APEX_3D_BASE_URL: 'https://b.example' } })?.id, 'apex-3d-model');
});

test('rerun POSTs {params} to <base>/rerun with the bearer token and returns outputs, inputs, assumptions', async () => {
  const s = stubFetch(() => ({ body: { outputs: { stoiip: { value: 1, unit: 'm3' } }, inputs: [{ ref: 'tool:x', kind: 'manual' }], assumptions: { a: { value: 1, source: 'assumed' } } } }));
  const env = { APEX_AI_BASE_URL: 'https://apex-app2.example/', APEX_AI_TOKEN: 'tok-ai', APEX_3D_BASE_URL: 'https://3d.example', APEX_3D_TOKEN: 'tok-3d' };
  const r = await createAI({ env, fetch: s.fetch }).rerun({ formation: { id: 2 } });
  assert.deepEqual(s.calls[0].url, 'https://apex-app2.example/rerun');
  assert.equal(s.calls[0].method, 'POST');
  assert.equal(s.calls[0].headers.authorization, 'Bearer tok-ai');
  assert.deepEqual(s.calls[0].body, { params: { formation: { id: 2 } } });
  assert.equal((r.outputs.stoiip as any).value, 1); assert.equal(r.inputs?.length, 1); assert.ok(r.assumptions?.a);

  await create3D({ env, fetch: s.fetch }).rerun({ k: 1 });
  assert.equal(s.calls[1].url, 'https://3d.example/rerun');
  assert.equal(s.calls[1].headers.authorization, 'Bearer tok-3d');
});

test('rerun failures become AdapterError: HTTP error, non-JSON, no outputs, network error, unset base URL', async () => {
  const env = { APEX_AI_BASE_URL: 'https://a.example' };
  await assert.rejects(createAI({ env, fetch: stubFetch(() => ({ status: 500, body: 'boom' })).fetch }).rerun({}), (e: any) => e instanceof AdapterError && /500/.test(e.message) && e.status === 502);
  await assert.rejects(createAI({ env, fetch: stubFetch(() => ({ body: 'not json' })).fetch }).rerun({}), /did not return JSON/);
  await assert.rejects(createAI({ env, fetch: stubFetch(() => ({ body: { result: 1 } })).fetch }).rerun({}), /must answer \{outputs/);
  await assert.rejects(createAI({ env, fetch: async () => { throw new Error('ECONNREFUSED'); } }).rerun({}), /ECONNREFUSED/);
  await assert.rejects(createAI({ env: {}, fetch: stubFetch(() => ({ body: {} })).fetch }).rerun({}), /APEX_AI_BASE_URL is not set/);
});

test('snapshot mapping from the recorded state: three assets mapped, one malformed skipped and counted', () => {
  const { drafts, stats } = mapState(STATE, new Date(0), { version: '4.0.0', commit: '7bf455e' });
  assert.deepEqual(stats, { assets_seen: 4, mapped: 3, skipped_unknown_shape: 1, skipped_no_outputs: 0, skipped_before_since: 0 });
  assert.equal(drafts.length, 3);
  const [gas, oil, carb] = drafts;
  for (const d of drafts) {
    assert.equal(d.job, 'apex-asset-intelligence'); assert.equal(d.author, 'app:apex-asset-intelligence');
    assert.equal(d.facets.capture, 'snapshot'); assert.equal(d.status, 'draft');
    assert.equal(d.tool_version, '4.0.0'); assert.equal(d.input_hash, runInputHash(d));
  }
  assert.equal(gas.title, 'Bozoi Dry Gas / Cenomanian Gas');
  // only numbers present in the state, zeros ("not computed") left out, nothing invented
  assert.deepEqual(gas.outputs, { giip: { value: 1850000000 }, recovery_factor: { value: 0.7 }, reserves: { value: 1295000000 } });
  assert.deepEqual(oil.outputs, { stoiip: { value: 48200000 }, recovery_factor: { value: 0.32 }, reserves: { value: 15424000 }, mbal_n: { value: 47600000, unit: 'm3' } });
  assert.deepEqual(carb.outputs, { stoiip: { value: 21900000 } });
  assert.equal((gas.params as any).field.name, 'Bozoi Dry Gas');
  assert.equal((oil.params as any).formation.id, 2);
  assert.notEqual(gas.input_hash, oil.input_hash);
});

test('snapshot honours since, skips assets with nothing saved, and refuses a state of the wrong shape', () => {
  const r = mapState(STATE, new Date('2026-09-15T00:00:00Z'));
  assert.equal(r.stats.skipped_before_since, 1);        // the gas formation was saved on 12 Sep
  assert.deepEqual(r.drafts.map(d => (d.params as any).formation.id), [2, 3]);   // 3 has no timestamp: kept, dedupe handles repeats
  const empty = mapState({ state: { arr: { fields: [], formations: [{ id: 9, name: 'Blank', geometry: { STOIIP: 0 } }] } } }, new Date(0));
  assert.equal(empty.stats.skipped_no_outputs, 1); assert.equal(empty.drafts.length, 0);
  assert.throws(() => mapState({ hello: 'world' }, new Date(0)), AdapterError);
  assert.equal(mapState({ arr: { fields: [], formations: [] } }, new Date(0)).drafts.length, 0);   // bare {arr} accepted
});

test('snapshot job: runs land in firm, validate, and an identical snapshot twice creates no new runs', async () => {
  const s = stubFetch(() => ({ body: STATE }));
  const env = { APEX_AI_BASE_URL: 'https://apex-app2.example', APEX_AI_TOKEN: 'tok' };
  const first = await runSnapshotJob(db, { env, fetch: s.fetch });
  assert.equal(s.calls[0].url, 'https://apex-app2.example/api/state'); assert.equal(s.calls[0].method, 'GET');
  assert.equal(s.calls[0].headers.authorization, 'Bearer tok');
  assert.deepEqual([first.created, first.deduplicated, first.failed, first.mapped, first.skipped_unknown_shape, first.project], [3, 0, 0, 3, 1, 'firm']);
  const count = async () => (await db.query<any>("SELECT count(*)::int AS n FROM runs WHERE job = 'apex-asset-intelligence'")).rows[0].n;
  assert.equal(await count(), 3);
  const rows = (await db.query<any>("SELECT project_id, legal_tag, author, record FROM runs WHERE job = 'apex-asset-intelligence'")).rows;
  for (const r of rows) {
    assert.equal(r.project_id, 'firm'); assert.equal(r.author, 'app:apex-asset-intelligence'); assert.equal(r.record.facets.capture, 'snapshot');
    assert.deepEqual(validate('run-record', r.record), []);
  }
  const second = await runSnapshotJob(db, { env, fetch: s.fetch });
  assert.deepEqual([second.created, second.deduplicated], [0, 3]);
  assert.equal(await count(), 3);
  // a changed asset is a new run; the unchanged two still collapse
  const changed = structuredClone(STATE); changed.state.arr.formations[1].geometry.STOIIP = 50000000;
  const third = await runSnapshotJob(db, { env, fetch: stubFetch(() => ({ body: changed })).fetch });
  assert.deepEqual([third.created, third.deduplicated], [1, 2]);
  assert.equal(await count(), 4);
  const j = (await db.query<any>("SELECT status, summary FROM jobs WHERE name = 'apex-snapshot' ORDER BY id")).rows;
  assert.deepEqual(j.map((x: any) => x.status), ['ok', 'ok', 'ok']);
  await assert.rejects(runSnapshotJob(db, { env, fetch: s.fetch, project: 'no-such-project' }), /does not exist/);
});

test('re-run route: 501 naming the env vars until configured, then the adapter answers and a child run is filed', async () => {
  const saved = { fetch: globalThis.fetch, base: process.env.APEX_AI_BASE_URL, tok: process.env.APEX_AI_TOKEN };
  try {
    configureRerun({ provider: null });
    const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` }, version: 'test' });
    const snap = mapState(STATE, new Date(0)).drafts[1];
    const rec: any = { ...snap, id: '00000000-0000-4000-8000-00000000ae01', created_at: '2026-09-25T10:00:00Z', project_id: 'firm', legal_tag: 'lt-firm', status: 'final', tags: ['seed'], params: { ...snap.params, saved_by: 'test' } };
    rec.input_hash = 'sha256:' + 'ab'.repeat(32);
    const post = await app.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) });
    assert.equal(post.status, 201, await post.clone().text());

    delete process.env.APEX_AI_BASE_URL;
    let r = await app.request(`/api/runs/${rec.id}/rerun`, { method: 'POST' });
    assert.equal(r.status, 501);
    const msg = ((await r.json()) as any).error.message;
    assert.match(msg, /APEX_AI_BASE_URL/); assert.match(msg, /APEX_AI_TOKEN/);

    process.env.APEX_AI_BASE_URL = 'https://apex-app2.example'; process.env.APEX_AI_TOKEN = 'tok';
    const seen: any[] = [];
    globalThis.fetch = (async (url: string, init: any) => {
      seen.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
      return new Response(JSON.stringify({ outputs: { stoiip: { value: 49000000 }, mbal_n: { value: 47600000, unit: 'm3' } } }), { status: 200 });
    }) as any;
    r = await app.request(`/api/runs/${rec.id}/rerun`, { method: 'POST' });
    const j: any = await r.json();
    assert.equal(r.status, 201, JSON.stringify(j));
    assert.equal(seen[0].url, 'https://apex-app2.example/rerun'); assert.equal(seen[0].auth, 'Bearer tok');
    assert.deepEqual(seen[0].body.params, rec.params);
    const child: any = await (await app.request(`/api/runs/${j.id}`)).json();
    assert.deepEqual(child.parents, [rec.id]);
    assert.equal(child.outputs.stoiip.value, 49000000);
    assert.ok(j.delta.changes.some((c: any) => c.output === 'stoiip'));

    globalThis.fetch = (async () => new Response('down', { status: 503 })) as any;
    const other: any = { ...rec, id: '00000000-0000-4000-8000-00000000ae02', input_hash: 'sha256:' + 'cd'.repeat(32), params: { changed: true } };
    assert.equal((await app.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(other) })).status, 201);
    r = await app.request(`/api/runs/${other.id}/rerun`, { method: 'POST' });
    assert.equal(r.status, 502);
    assert.equal(((await r.json()) as any).error.code, 'adapter_failed');
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [['APEX_AI_BASE_URL', saved.base], ['APEX_AI_TOKEN', saved.tok]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
