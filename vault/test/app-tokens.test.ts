import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { parseAppTokens, verifyAppToken } from '../src/app-tokens.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const base = JSON.parse(readFileSync(path.join(FIX, 'run-record/valid-1.json'), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const AI_SECRET = 'ai-secret-0123456789abcdef', M3D_SECRET = 'm3d-secret-0123456789abcdef';

let db: Db;
let app: Awaited<ReturnType<typeof createApp>>;
const saved = process.env.APP_TOKENS;
before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  // The Access middleware in app.ts still runs first; DEV auth lets the request reach the route, which then checks the token itself.
  app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
});
after(async () => { await db.close(); });
beforeEach(() => { process.env.APP_TOKENS = `apex-asset-intelligence:${AI_SECRET},apex-3d-model:${M3D_SECRET}`; });
afterEach(() => { if (saved === undefined) delete process.env.APP_TOKENS; else process.env.APP_TOKENS = saved; });

const body = (o: Record<string, unknown> = {}) => ({
  ...base, id: randomUUID(), input_hash: 'sha256:' + createHash('sha256').update(randomUUID()).digest('hex'),
  project_id: 'firm', legal_tag: 'lt-firm', client_id: undefined, asset_ids: [], inputs: [], ...o,
});
const post = (token: string | null, b: unknown) => app.request('/api/app/runs', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(b),
});
const row = async (id: string) => (await db.query<any>('SELECT job, author, record FROM runs WHERE id = $1', [id])).rows[0];

test('a valid token posts a run: job forced to the token tool, author app:<tool>, capture push', async () => {
  const b = body({ job: 'apex-asset-intelligence', author: 'chris' });
  const r = await post(AI_SECRET, b);
  const j: any = await r.json();
  assert.equal(r.status, 201, JSON.stringify(j));
  assert.equal(j.id, b.id);
  const stored = await row(b.id);
  assert.equal(stored.job, 'apex-asset-intelligence');
  assert.equal(stored.author, 'app:apex-asset-intelligence');
  assert.equal(stored.record.facets.capture, 'push');
  const p = (await db.query<any>("SELECT role FROM people WHERE id = 'app:apex-asset-intelligence'")).rows[0];
  assert.equal(p.role, 'service');
  const ev = (await db.query<any>("SELECT person_id FROM audit_events WHERE action = 'run.create' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(ev.person_id, 'app:apex-asset-intelligence');
});

test('a wrong tool in the body is overridden, not trusted', async () => {
  const b = body({ job: 'opportunity-register', author: 'ana.perez', facets: { capture: 'snapshot', note: 'kept' } });
  const r = await post(M3D_SECRET, b);
  assert.equal(r.status, 201, await r.text());
  const stored = await row(b.id);
  assert.equal(stored.job, 'apex-3d-model');
  assert.equal(stored.author, 'app:apex-3d-model');
  assert.deepEqual(stored.record.facets, { capture: 'push', note: 'kept' });
});

test('missing or invalid token answers 401; staff access does not substitute for a token', async () => {
  for (const [token, msg] of [[null, /missing app token/], ['nope-nope-nope-nope-nope', /invalid app token/], [AI_SECRET.slice(0, -1), /invalid/]] as const) {
    const r = await post(token, body());
    assert.equal(r.status, 401);
    const j: any = await r.json();
    assert.equal(j.error.code, 'unauthenticated'); assert.match(j.error.message, msg);
  }
  const r = await app.request('/api/app/runs', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic abc' }, body: JSON.stringify(body()) });
  assert.equal(r.status, 401);
  delete process.env.APP_TOKENS;                       // nothing configured: every token fails closed
  assert.equal((await post(AI_SECRET, body())).status, 401);
  const n = (await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE person_id = 'app:unauthenticated'")).rows[0].n;
  assert.ok(n >= 4, 'refused calls are audited');
});

test('a token for tool A cannot post job B, and cannot reach any other route', async () => {
  const b = body({ job: 'apex-3d-model' });
  const r = await post(AI_SECRET, b);            // AI token, body claims the 3D model
  assert.equal(r.status, 201);
  assert.equal((await row(b.id)).job, 'apex-asset-intelligence');
  assert.equal((await db.query('SELECT 1 FROM runs WHERE job = $1 AND id = $2', ['apex-3d-model', b.id])).rows.length, 0);
  // The token is only checked by /api/app/runs; on other routes it is just an unknown header.
  const anon = await createApp({ db, auth: { allowedEmailDomain: DOMAIN } });
  const other = await anon.request('/api/runs', { method: 'GET', headers: { authorization: `Bearer ${AI_SECRET}` } });
  assert.equal(other.status, 401);
});

test('an invalid record is refused with the same 400 as staff get', async () => {
  const b: any = body(); delete b.tool_version;
  const r = await post(AI_SECRET, b);
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as any).error.path, '/tool_version');
});

test('identical pushes collapse onto one run', async () => {
  const b = body({ job: 'apex-3d-model' });
  assert.equal((await post(M3D_SECRET, b)).status, 201);
  const again = await post(M3D_SECRET, { ...b, id: randomUUID() });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as any).deduplicated, true);
});

test('parseAppTokens and verifyAppToken: format, short secrets ignored, secret may contain a colon', () => {
  assert.deepEqual(parseAppTokens(`a-tool:${'x'.repeat(16)}, b-tool:short ,:${'y'.repeat(16)},c-tool:p:${'z'.repeat(16)}`), [['a-tool', 'x'.repeat(16)], ['c-tool', `p:${'z'.repeat(16)}`]]);
  const h = (v?: string) => ({ get: (n: string) => (n === 'authorization' ? v : null) });
  const env = { APP_TOKENS: `c-tool:p:${'z'.repeat(16)}` };
  const p = verifyAppToken(h(`Bearer p:${'z'.repeat(16)}`), env);
  assert.equal(p.id, 'app:c-tool'); assert.equal(p.role, 'service');
  assert.throws(() => verifyAppToken(h(`bearer ${'z'.repeat(16)}`), env), /invalid app token/);
  assert.throws(() => verifyAppToken(h(), env), /missing app token/);
});
