// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.7; data review 03 §5.1 S3): project_organisations.
// The counterparties the register names as links to the organisations mail capture already creates: members
// read and replace the list with a role from the enum; the register text fields stay; a register PATCH that
// names a holder, government or partner matching an organisation by name (case-insensitive) writes the join.
// Smoke tests written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-porgs-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ana: Awaited<ReturnType<typeof createApp>>;
let ben: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const roles = async () => (await db.query<any>("SELECT organisation_id, role, to_char(since,'YYYY-MM-DD') AS since, note FROM project_organisations WHERE project_id = 'po-p' ORDER BY organisation_id, role")).rows;

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'), ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','CO'), ('anh','ANH','regulator','CO'), ('ecopetrol','Ecopetrol S.A.','operator','CO'), ('gran-tierra','Gran Tierra Energy','partner','CO')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('po-p','frontera','Counterparties project','lt-frontera-nda-2026','{chris,ana}')");
  partner = await appFor(`chris@${DOMAIN}`); ana = await appFor(`ana@${DOMAIN}`); ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('S3: a member replaces the counterparty list with roles from the enum; bad roles and unknown organisations are refused; outsiders too', async () => {
  const r = await call(ana, 'PUT', '/api/projects/po-p/organisations', { organisations: [{ organisation_id: 'anh', role: 'government' }, { organisation_id: 'ecopetrol', role: 'holder', since: '2024-01-15', note: 'Licence holder since the 2024 round' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.project_id, 'po-p');
  assert.deepEqual(r.body.organisations.map((o: any) => [o.organisation_id, o.name, o.kind, o.role, o.since, o.note]), [
    ['anh', 'ANH', 'regulator', 'government', null, null],
    ['ecopetrol', 'Ecopetrol S.A.', 'operator', 'holder', '2024-01-15', 'Licence holder since the 2024 round'],
  ]);
  assert.equal((await call(ana, 'PUT', '/api/projects/po-p/organisations', { organisations: [{ organisation_id: 'anh', role: 'sponsor' }] })).status, 400);
  assert.equal((await call(ana, 'PUT', '/api/projects/po-p/organisations', { organisations: [{ organisation_id: 'nobody', role: 'vendor' }] })).status, 400);
  assert.equal((await call(ana, 'PUT', '/api/projects/po-p/organisations', { organisations: 'anh' })).status, 400);
  assert.equal((await call(ben, 'PUT', '/api/projects/po-p/organisations', { organisations: [] })).status, 403);
  assert.equal((await call(partner, 'PUT', '/api/projects/nope/organisations', { organisations: [] })).status, 404);
  assert.deepEqual((await roles()).map((o: any) => o.organisation_id + ':' + o.role), ['anh:government', 'ecopetrol:holder']);
  const ev = (await db.query<any>("SELECT scope, refs FROM audit_events WHERE action = 'project.organisations.replace' AND detail->>'status' = '200' ORDER BY id ASC LIMIT 1")).rows[0];
  assert.equal(ev.scope, 'project:po-p'); assert.ok(ev.refs.includes('org:anh'));
});

test('S3: the list is read with names, scope-checked like the timeline', async () => {
  const r = await call(ana, 'GET', '/api/projects/po-p/organisations');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.organisations.map((o: any) => [o.organisation_id, o.name, o.role]), [['anh', 'ANH', 'government'], ['ecopetrol', 'Ecopetrol S.A.', 'holder']]);
  assert.equal((await call(ben, 'GET', '/api/projects/po-p/organisations')).status, 403);
  assert.equal((await call(partner, 'GET', '/api/projects/nope/organisations')).status, 404);
});

test('S3: the register PATCH that names counterparties writes the join rows for the organisations it matches by name, keeps the text and ignores the rest', async () => {
  const r = await call(ana, 'PATCH', '/api/projects/po-p', { register: { holder: 'ecopetrol s.a.', government: 'anh', partners: ['Gran Tierra Energy', 'Unknown Partner Ltd'] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.register.holder, 'ecopetrol s.a.'); assert.deepEqual(r.body.register.partners, ['Gran Tierra Energy', 'Unknown Partner Ltd']);
  assert.deepEqual((await roles()).map((o: any) => o.organisation_id + ':' + o.role), ['anh:government', 'ecopetrol:holder', 'gran-tierra:partner']);
  // Naming the same holder again writes nothing new; an operator's organisation can also be the holder.
  await call(ana, 'PATCH', '/api/projects/po-p', { register: { holder: 'Ecopetrol' } });
  assert.deepEqual((await roles()).map((o: any) => o.organisation_id + ':' + o.role), ['anh:government', 'ecopetrol:holder', 'gran-tierra:partner'], 'the legal form is ignored when matching');
});

test('S3: PUT with a subset removes the rest; an organisation may hold two roles', async () => {
  const r = await call(partner, 'PUT', '/api/projects/po-p/organisations', { organisations: [{ organisation_id: 'ecopetrol', role: 'holder' }, { organisation_id: 'ecopetrol', role: 'operator' }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await roles()).map((o: any) => o.organisation_id + ':' + o.role), ['ecopetrol:holder', 'ecopetrol:operator']);
  assert.equal((await call(partner, 'PUT', '/api/projects/po-p/organisations', { organisations: [{ organisation_id: 'ecopetrol', role: 'holder' }, { organisation_id: 'ecopetrol', role: 'holder' }] })).status, 400, 'a duplicate pair is refused');
});
