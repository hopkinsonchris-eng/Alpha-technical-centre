// Wave 7 PR1 (docs/vault-hub/wave7/05-markup.md §1.7, S2): GET /api/projects?mine=1 honours `mine`
// (the caller is a member, or authored a run or document in the last 90 days) and every row carries
// last_activity_at, run_count, item_count and stale_count, counting only what the caller may see.
// Today's "My projects" section is gone, but the fields are specified for the register rows (PR3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-mine-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

let db: Db;
let chris: Awaited<ReturnType<typeof createApp>>;
let ana: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof chris, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

const baseRun = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown>) => ({ ...baseRun, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], ...o });
const runIds: string[] = [];

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,members,created_at) VALUES ('mine-llanos',NULL,'Llanos screening','active','lt-firm','{chris}', now() - interval '40 days')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,members,created_at) VALUES ('mine-talara',NULL,'Talara redevelopment','active','lt-firm','{ana}', now() - interval '30 days')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,members,created_at) VALUES ('mine-empty',NULL,'Empty sandbox','prospect','lt-firm','{ana}', now() - interval '20 days')");
  chris = await appFor(`chris@${DOMAIN}`);
  ana = await appFor(`ana@${DOMAIN}`);
  // Two runs in Llanos (one stale), one document (stale) and one document in Talara authored by chris.
  for (const title of ['Cubiro nodal', 'Cubiro screen']) {
    const rr = run({ project_id: 'mine-llanos', client_id: null, legal_tag: 'lt-firm', status: 'final', title });
    assert.equal((await call(chris, 'POST', '/api/runs', rr)).status, 201);
    runIds.push(rr.id);
  }
  await db.query("UPDATE runs SET stale = true, stale_reasons = '[{\"rule\":\"R1\",\"detail\":\"tool moved on\"}]'::jsonb WHERE id = $1", [runIds[0]]);
  const doc = randomUUID();
  await db.query("INSERT INTO items (id,type,title,created_at,authors,project_id,legal_tag,origin,content_hash,version,stale) VALUES ($1,'report','Well list',now() - interval '3 days','{chris}','mine-llanos','lt-firm','{\"source\":\"upload\"}'::jsonb,$2,1,true)", [doc, hashOf(doc)]);
  const doc2 = randomUUID();
  await db.query("INSERT INTO items (id,type,title,created_at,authors,project_id,legal_tag,origin,content_hash,version) VALUES ($1,'letter','Talara letter',now() - interval '2 days','{chris}','mine-talara','lt-firm','{\"source\":\"upload\"}'::jsonb,$2,1)", [doc2, hashOf(doc2)]);
});
after(async () => { await db.close(); });

test('S2: every project row carries run_count, item_count, stale_count and last_activity_at', async () => {
  const r = await json(await call(chris, 'GET', '/api/projects'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const llanos = r.body.projects.find((p: any) => p.id === 'mine-llanos');
  assert.equal(llanos.run_count, 2);
  assert.equal(llanos.item_count, 1);
  assert.equal(llanos.stale_count, 2);                       // one stale run, one stale document
  assert.ok(llanos.last_activity_at, 'last_activity_at is set');
  const age = Date.now() - Date.parse(llanos.last_activity_at);
  assert.ok(age > 2 * 864e5 && age < 4 * 864e5, 'the newest record (the document filed three days ago) sets it, not created_at 40 days ago');
  const empty = r.body.projects.find((p: any) => p.id === 'mine-empty');
  assert.deepEqual([empty.run_count, empty.item_count, empty.stale_count], [0, 0, 0]);
  assert.equal(empty.last_activity_at.slice(0, 10), new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10));   // falls back to created_at
});

test('S2: ?mine=1 keeps the projects the caller is a member of or wrote in during the last 90 days', async () => {
  const mine = await json(await call(chris, 'GET', '/api/projects?mine=1'));
  assert.equal(mine.status, 200);
  const ids = mine.body.projects.map((p: any) => p.id).filter((id: string) => id.startsWith('mine-')).sort();
  assert.deepEqual(ids, ['mine-llanos', 'mine-talara']);     // member of Llanos; authored a letter in Talara; nothing in the sandbox
  const all = await json(await call(chris, 'GET', '/api/projects'));
  assert.ok(all.body.projects.some((p: any) => p.id === 'mine-empty'), 'without mine the full list is unchanged');
});

test('S2: an associate asking for mine=1 sees only the visible projects she is on', async () => {
  const r = await json(await call(ana, 'GET', '/api/projects?mine=1'));
  assert.equal(r.status, 200);
  const ids = r.body.projects.map((p: any) => p.id).filter((id: string) => id.startsWith('mine-')).sort();
  assert.deepEqual(ids, ['mine-empty', 'mine-talara']);
  const talara = r.body.projects.find((p: any) => p.id === 'mine-talara');
  assert.equal(talara.item_count, 1);
});
