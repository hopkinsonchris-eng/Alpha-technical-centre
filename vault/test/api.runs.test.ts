import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { validate } from '../src/schemas.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';

let db: Db;
let app: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof app, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const base = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown> = {}) => ({ ...base, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], ...o });

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client'), ('ecopetrol','Ecopetrol','client')");
  await db.query(`INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES
    ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy','2027-03-31'),
    ('lt-ecopetrol-nda','client-nda','second-party','ecopetrol','Ecopetrol', NULL),
    ('lt-expired','client-nda','second-party','ecopetrol','Ecopetrol','2026-01-01')`);
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('llanos-screen','frontera','Llanos screen','lt-frontera-nda-2026','{chris,ana.perez}')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('ecopetrol-work','ecopetrol','Ecopetrol work','lt-ecopetrol-nda','{chris}')");
  app = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('AC1: a RunRecord that fails schema validation is rejected 400 with the JSON path', async () => {
  const noVersion: any = run(); delete noVersion.tool_version;
  let r = await call(app, 'POST', '/api/runs', noVersion);
  assert.equal(r.status, 400);
  let j = await r.json();
  assert.equal(j.error.code, 'invalid');
  assert.equal(j.error.path, '/tool_version');

  r = await call(app, 'POST', '/api/runs', run({ input_hash: 'not-a-hash' }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.path, '/input_hash');

  r = await call(app, 'POST', '/api/runs', run({ inputs: [{ ref: 'run:x', kind: 'nonsense' }] }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.path, '/inputs/0/kind');

  r = await call(app, 'POST', '/api/runs', run({ surprise: true }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.path, '/surprise');

  r = await app.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'invalid_json');
});

test('unauthenticated callers get 401 with the error envelope', async () => {
  const anon = await createApp({ db, auth: { allowedEmailDomain: DOMAIN } });
  const r = await call(anon, 'POST', '/api/runs', run());
  assert.equal(r.status, 401);
  assert.ok((await r.json()).error.code);
});

test('a valid run is stored, returned exactly as a RunRecord, and unknown projects or authors are 400', async () => {
  const rec = run({ title: 'Stored run' });
  const r = await call(app, 'POST', '/api/runs', rec);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { id: rec.id, deduplicated: false });
  const got = await (await call(app, 'GET', `/api/runs/${rec.id}`)).json();
  assert.deepEqual(validate('run-record', got), []);
  assert.equal(got.title, 'Stored run');
  assert.equal(got.legal_tag, 'lt-frontera-nda-2026');

  const noProject = await call(app, 'POST', '/api/runs', run({ project_id: 'nope' }));
  assert.equal(noProject.status, 400);
  assert.equal((await noProject.json()).error.path, '/project_id');
  const noAuthor = await call(app, 'POST', '/api/runs', run({ author: 'ghost' }));
  assert.equal(noAuthor.status, 400);
  assert.equal((await noAuthor.json()).error.path, '/author');
  assert.equal((await call(app, 'GET', `/api/runs/${randomUUID()}`)).status, 404);
  assert.equal((await call(app, 'GET', '/api/runs/not-a-uuid')).status, 404);
});

test('AC2/AC3: identical job + tool_version + input_hash returns the same id, second time deduplicated', async () => {
  const a = run({ input_hash: hashOf('same-inputs') });
  const b = run({ input_hash: hashOf('same-inputs') });
  const r1 = await call(app, 'POST', '/api/runs', a);
  const r2 = await call(app, 'POST', '/api/runs', b);
  assert.equal(r1.status, 201); assert.equal(r2.status, 200);
  const j1 = await r1.json(), j2 = await r2.json();
  assert.equal(j1.deduplicated, false); assert.equal(j2.deduplicated, true);
  assert.equal(j2.id, j1.id); assert.equal(j1.id, a.id);
  // a different tool version is a different run
  const c = await call(app, 'POST', '/api/runs', run({ input_hash: hashOf('same-inputs'), tool_version: '2.2.0' }));
  assert.equal((await c.json()).deduplicated, false);
  // concurrent identical saves collapse to one row
  const hash = hashOf('race');
  const results = await Promise.all([1, 2, 3, 4].map(() => call(app, 'POST', '/api/runs', run({ input_hash: hash })).then(r => r.json())));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal(results.filter(r => !r.deduplicated).length, 1);
});

test('AC3: PUT, PATCH and DELETE on a run are 409; supersede creates the new run and marks the old one', async () => {
  const old = run({ status: 'final' });
  await call(app, 'POST', '/api/runs', old);
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const r = await call(app, method, `/api/runs/${old.id}`, { title: 'edited' });
    assert.equal(r.status, 409, method);
    assert.equal((await r.json()).error.code, 'immutable');
  }
  assert.equal((await (await call(app, 'GET', `/api/runs/${old.id}`)).json()).title, 'Cubiro waterflood screen');

  const next = run({ status: 'final', outputs: { technical_potential_bopd: { value: 4600, unit: 'bopd' } } });
  const r = await call(app, 'POST', `/api/runs/${old.id}/supersede`, next);
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { id: next.id, deduplicated: false });
  const oldNow = await (await call(app, 'GET', `/api/runs/${old.id}`)).json();
  const newNow = await (await call(app, 'GET', `/api/runs/${next.id}`)).json();
  assert.equal(oldNow.status, 'superseded');
  assert.equal(newNow.supersedes, old.id);
  assert.deepEqual(validate('run-record', newNow), []);

  // an already superseded run cannot be superseded twice; a mismatching body is refused
  assert.equal((await call(app, 'POST', `/api/runs/${old.id}/supersede`, run())).status, 409);
  const other = run(); await call(app, 'POST', '/api/runs', other);
  assert.equal((await call(app, 'POST', `/api/runs/${other.id}/supersede`, run({ supersedes: old.id }))).status, 400);
  assert.equal((await call(app, 'POST', `/api/runs/${randomUUID()}/supersede`, run())).status, 404);
});

test('AC4: a run posted with a lower tag gets the project default; inputs raise it; nobody can lower it', async () => {
  // project default wins over a posted firm tag
  const low = run({ legal_tag: 'lt-firm' });
  await call(app, 'POST', '/api/runs', low);
  assert.equal((await (await call(app, 'GET', `/api/runs/${low.id}`)).json()).legal_tag, 'lt-frontera-nda-2026');
  const pub = run({ legal_tag: 'lt-public' });
  await call(app, 'POST', '/api/runs', pub);
  assert.equal((await (await call(app, 'GET', `/api/runs/${pub.id}`)).json()).legal_tag, 'lt-frontera-nda-2026');

  // a firm-project run whose input is a client-nda item becomes client-nda, even though it was posted with firm
  const nda = '00000000-0000-4000-8000-000000000051';   // AC15 item under lt-orinoco-nda-2026
  const derived = run({ project_id: 'firm', client_id: null, legal_tag: 'lt-firm', inputs: [{ ref: `doc:${nda}`, kind: 'document', version: 1 }] });
  const r = await call(app, 'POST', '/api/runs', derived);
  assert.equal(r.status, 201);
  const got = await (await call(app, 'GET', `/api/runs/${derived.id}`)).json();
  assert.equal(got.legal_tag, 'lt-orinoco-nda-2026');
  assert.deepEqual(validate('run-record', got), []);
  const { rows } = await db.query("SELECT classification, client_id FROM legal_tags WHERE id = $1", [got.legal_tag]);
  assert.deepEqual(rows[0], { classification: 'client-nda', client_id: 'petrolera-del-orinoco' });

  // a run input that is itself a run carries that run's tag forward
  const chained = run({ project_id: 'firm', client_id: null, legal_tag: 'lt-public', inputs: [{ ref: `run:${low.id}`, kind: 'run' }] });
  await call(app, 'POST', '/api/runs', chained);
  assert.equal((await (await call(app, 'GET', `/api/runs/${chained.id}`)).json()).legal_tag, 'lt-frontera-nda-2026');
  // and so does a parent
  const child = run({ project_id: 'firm', client_id: null, legal_tag: 'lt-firm', parents: [low.id] });
  await call(app, 'POST', '/api/runs', child);
  assert.equal((await (await call(app, 'GET', `/api/runs/${child.id}`)).json()).legal_tag, 'lt-frontera-nda-2026');

  // mixing two clients' confidential inputs is refused
  const mixed = run({ project_id: 'firm', client_id: null, legal_tag: 'lt-firm', inputs: [{ ref: `run:${low.id}`, kind: 'run' }, { ref: `doc:${nda}`, kind: 'document' }] });
  const m = await call(app, 'POST', '/api/runs', mixed);
  assert.equal(m.status, 409);
  assert.equal((await m.json()).error.code, 'legal_tag_conflict');

  // unknown and expired tags are 400
  const unk = await call(app, 'POST', '/api/runs', run({ project_id: 'firm', client_id: null, legal_tag: 'lt-nope-nope' }));
  assert.equal(unk.status, 400); assert.equal((await unk.json()).error.path, '/legal_tag');
  const exp = await call(app, 'POST', '/api/runs', run({ project_id: 'firm', client_id: null, legal_tag: 'lt-expired' }));
  assert.equal(exp.status, 400); assert.equal((await exp.json()).error.code, 'expired_legal_tag');
});

test('reads apply scope: partners see everything unexpired, associates only firm/public and their projects, expiry hides', async () => {
  const mine = run(); await call(app, 'POST', '/api/runs', mine);                                             // llanos-screen, ana is a member
  const theirs = run({ project_id: 'ecopetrol-work', client_id: 'ecopetrol', legal_tag: 'lt-ecopetrol-nda' }); await call(app, 'POST', '/api/runs', theirs);   // ana is not
  const firm = run({ project_id: 'firm', client_id: null, legal_tag: 'lt-firm' }); await call(app, 'POST', '/api/runs', firm);

  const ana = await appFor(`ana.perez@${DOMAIN}`);
  assert.equal((await call(ana, 'GET', `/api/runs/${mine.id}`)).status, 200);
  assert.equal((await call(ana, 'GET', `/api/runs/${firm.id}`)).status, 200);
  const denied = await call(ana, 'GET', `/api/runs/${theirs.id}`);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'forbidden');
  const list = (await (await call(ana, 'GET', '/api/runs')).json()).runs.map((r: any) => r.id);
  assert.ok(list.includes(mine.id) && list.includes(firm.id) && !list.includes(theirs.id));
  const partnerList = (await (await call(app, 'GET', '/api/runs')).json()).runs.map((r: any) => r.id);
  assert.ok(partnerList.includes(theirs.id));

  // an associate cannot write into a client project they are not a member of, nor sign for someone else
  assert.equal((await call(ana, 'POST', '/api/runs', run({ project_id: 'ecopetrol-work', client_id: 'ecopetrol', legal_tag: 'lt-ecopetrol-nda', author: 'ana.perez' }))).status, 403);
  assert.equal((await call(ana, 'POST', '/api/runs', run({ author: 'chris' }))).status, 403);
  assert.equal((await call(ana, 'POST', '/api/runs', run({ author: 'ana.perez' }))).status, 201);

  // expiry: the tag's date passes and the record disappears from every read
  await db.query("UPDATE legal_tags SET expires_at = '2026-01-01' WHERE id = 'lt-ecopetrol-nda'");
  assert.equal((await call(app, 'GET', `/api/runs/${theirs.id}`)).status, 404);
  assert.ok(!(await (await call(app, 'GET', '/api/runs')).json()).runs.some((r: any) => r.id === theirs.id));
  await db.query("UPDATE legal_tags SET expires_at = NULL WHERE id = 'lt-ecopetrol-nda'");
});

test('list filters: project, job, status, since; hidden runs disappear', async () => {
  const a = run({ job: 'reservoir-simulator', status: 'reviewed', created_at: '2026-09-27T10:00:00Z' });
  const b = run({ job: 'reservoir-simulator', status: 'draft', created_at: '2026-09-20T10:00:00Z' });
  await call(app, 'POST', '/api/runs', a); await call(app, 'POST', '/api/runs', b);
  const ids = async (qs: string) => (await (await call(app, 'GET', `/api/runs?${qs}`)).json()).runs.map((r: any) => r.id);
  assert.deepEqual((await ids('job=reservoir-simulator&project=llanos-screen')).sort(), [a.id, b.id].sort());
  assert.deepEqual(await ids('job=reservoir-simulator&status=reviewed'), [a.id]);
  assert.deepEqual(await ids('job=reservoir-simulator&since=2026-09-25'), [a.id]);
  assert.equal((await call(app, 'GET', '/api/runs?since=yesterday')).status, 400);
  assert.equal((await call(app, 'GET', '/api/runs?status=bogus')).status, 400);
  // newest first
  assert.deepEqual(await ids('job=reservoir-simulator'), [a.id, b.id]);
  const h = await call(app, 'POST', `/api/runs/${a.id}/hide`, { reason: 'test' });
  assert.equal(h.status, 200);
  assert.deepEqual(await ids('job=reservoir-simulator'), [b.id]);
  assert.equal((await call(app, 'GET', `/api/runs/${a.id}`)).status, 404);
});
