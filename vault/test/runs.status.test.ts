// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.7, 03-data-hierarchy.md A5 and S7): a run becomes reviewed or
// final through POST /api/runs/:id/status. The row's status, reviewed_by and reviewed_at move; the record JSON does
// not. Members may mark reviewed, partners final, associates outside the project nothing; a superseded run refuses.
// W7-AC11: the promoted run reaches the analogue table.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { buildCatalog } from '../src/catalog.ts';
import { runInputHash } from '../src/hash.ts';
import { validate } from '../src/schemas.ts';
import { rowIdForRun } from '../src/analogues/emit.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOMAIN = 'alpha-technical-centre.com';
const catalog = buildCatalog(ROOT);
const fixture = (tool: string) => JSON.parse(readFileSync(path.join(ROOT, `test/e2e/fixtures/${tool}.json`), 'utf8'));

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>, ana: typeof partner, ben: typeof partner;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const recordHash = async (id: string) => createHash('sha256').update(JSON.stringify((await db.query<any>('SELECT record FROM runs WHERE id = $1', [id])).rows[0].record)).digest('hex');

async function saveRun(tool: string, over: Record<string, any> = {}): Promise<any> {
  const fx = fixture(tool);
  const manifest = catalog.tools.find(t => t.id === tool)!;
  const v = manifest.versions.find(x => x.version === manifest.aliases.current)!;
  const rec: any = {
    id: randomUUID(), job: tool, tool_version: v.version, tool_commit: v.commit, author: 'chris', created_at: '2026-09-20T10:00:00Z',
    project_id: 'llanos-screen', client_id: 'frontera', asset_ids: [], legal_tag: 'lt-frontera-nda-2026', title: `${tool} ${randomUUID().slice(0, 8)}`,
    inputs: [{ ref: `tool:${tool}`, kind: 'manual' }], assumptions: {}, params: { ...fx.params, salt: randomUUID() }, outputs: fx.expected, status: 'draft', ...over,
  };
  rec.input_hash = runInputHash(rec);
  const r = await call(partner, 'POST', '/api/runs', rec);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return rec;
}

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'), ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('llanos-screen','frontera','Llanos screen','lt-frontera-nda-2026','{chris,ana}')");
  partner = await appFor(`chris@${DOMAIN}`); ana = await appFor(`ana@${DOMAIN}`); ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('W7-AC11: a member marks a run reviewed; the row moves, the record JSON does not, the read shows it', async () => {
  const rec = await saveRun('nodal-analysis');
  const before = await recordHash(rec.id);
  const r = await call(ana, 'POST', `/api/runs/${rec.id}/status`, { status: 'reviewed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, rec.id); assert.equal(r.body.status, 'reviewed'); assert.equal(r.body.previous_status, 'draft');
  assert.equal(r.body.reviewed_by, 'ana'); assert.ok(Date.parse(r.body.reviewed_at));
  assert.equal(r.body.record_hash, `sha256:${before}`, 'the route reports the hash of the record it left alone');
  assert.equal(await recordHash(rec.id), before, 'the record JSON is byte for byte what was saved');
  const row = (await db.query<any>('SELECT status, reviewed_by, reviewed_at, record->>\'status\' AS rec_status FROM runs WHERE id = $1', [rec.id])).rows[0];
  assert.equal(row.status, 'reviewed'); assert.equal(row.reviewed_by, 'ana'); assert.ok(row.reviewed_at); assert.equal(row.rec_status, 'draft');
  const got = await call(ana, 'GET', `/api/runs/${rec.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.status, 'reviewed'); assert.equal(got.body.reviewed_by, 'ana');
  assert.deepEqual(validate('run-record', got.body), [], 'the read is still a valid RunRecord');
  assert.equal(got.body.facets.vault.stale, false); assert.deepEqual(got.body.facets.vault.age_flags, []);
  const audit = (await db.query<any>("SELECT person_id, scope, refs, detail FROM audit_events WHERE action = 'run.status' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audit.person_id, 'ana'); assert.equal(audit.scope, 'project:llanos-screen'); assert.deepEqual(audit.refs, [`run:${rec.id}`]);
  assert.equal(audit.detail.from, 'draft'); assert.equal(audit.detail.to, 'reviewed');
  // The list reads the row's status too.
  const list = await call(ana, 'GET', '/api/runs?project=llanos-screen&status=reviewed');
  assert.ok(list.body.runs.some((x: any) => x.id === rec.id));
});

test('W7-AC11: a partner marks a run final and the own-evaluation analogue row appears', async () => {
  const rec = await saveRun('opportunity-register');
  assert.equal((await db.query('SELECT 1 FROM analogue_rows WHERE id = $1', [rowIdForRun(rec.id)])).rows.length, 0, 'a draft is not an analogue');
  const before = await recordHash(rec.id);
  const r = await call(partner, 'POST', `/api/runs/${rec.id}/status`, { status: 'final' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'final'); assert.equal(r.body.reviewed_by, 'chris');
  assert.equal(r.body.analogue.status, 'emitted', JSON.stringify(r.body.analogue));
  assert.equal(await recordHash(rec.id), before);
  const row = (await db.query<any>('SELECT source_ref, provenance, row FROM analogue_rows WHERE id = $1', [rowIdForRun(rec.id)])).rows[0];
  assert.ok(row, 'the analogue row exists'); assert.equal(row.source_ref, `run:${rec.id}`); assert.equal(row.provenance, 'own-evaluation');
  assert.equal((await db.query<any>('SELECT status FROM runs WHERE id = $1', [rec.id])).rows[0].status, 'final');
  // Promoting again changes nothing and says so; demoting is refused (supersede instead).
  const again = await call(partner, 'POST', `/api/runs/${rec.id}/status`, { status: 'final' });
  assert.equal(again.status, 200); assert.equal(again.body.changed, false);
  const down = await call(partner, 'POST', `/api/runs/${rec.id}/status`, { status: 'reviewed' });
  assert.equal(down.status, 409);
});

test('W7-AC11: an associate cannot finalise, and one outside the project cannot even mark reviewed', async () => {
  const rec = await saveRun('nodal-analysis');
  const f = await call(ana, 'POST', `/api/runs/${rec.id}/status`, { status: 'final' });
  assert.equal(f.status, 403); assert.equal(f.body.error.code, 'forbidden');
  const b = await call(ben, 'POST', `/api/runs/${rec.id}/status`, { status: 'reviewed' });
  assert.equal(b.status, 403);
  assert.equal((await db.query<any>('SELECT status FROM runs WHERE id = $1', [rec.id])).rows[0].status, 'draft');
  const bad = await call(partner, 'POST', `/api/runs/${rec.id}/status`, { status: 'superseded' });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.path, '/status');
  const draft = await call(partner, 'POST', `/api/runs/${rec.id}/status`, { status: 'draft' });
  assert.equal(draft.status, 400);
  assert.equal((await call(partner, 'POST', `/api/runs/${randomUUID()}/status`, { status: 'final' })).status, 404);
});

test('W7-AC11: a superseded run refuses promotion; the superseding run can be promoted', async () => {
  const old = await saveRun('nodal-analysis');
  const next = { ...old, id: randomUUID(), params: { ...old.params, salt: randomUUID() } };
  next.input_hash = runInputHash(next);
  const s = await call(partner, 'POST', `/api/runs/${old.id}/supersede`, next);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const r = await call(partner, 'POST', `/api/runs/${old.id}/status`, { status: 'final' });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'superseded');
  assert.equal((await db.query<any>('SELECT status FROM runs WHERE id = $1', [old.id])).rows[0].status, 'superseded');
  const ok = await call(partner, 'POST', `/api/runs/${next.id}/status`, { status: 'final' });
  assert.equal(ok.status, 200);
});
