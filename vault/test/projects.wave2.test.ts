// Wave 2, PR 1 (docs/vault-hub/wave2/05-markup.md): projects carry country,
// coordinates, stage, stage history and the register fields; PATCH changes
// them with an audit trail; GET /api/countries groups what the caller may see.
// Smoke tests for AC11 and AC12, written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-wave2-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ana: Awaited<ReturnType<typeof createApp>>;      // associate, member of the Frontera project only
let ben: Awaited<ReturnType<typeof createApp>>;      // associate, member of nothing
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

const baseRun = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown>) => ({ ...baseRun, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], ...o });

const KAZ = {
  id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', status: 'prospect', country: 'KZ', lat: 47.1, lon: 51.9, stage: 'Qualified',
  register: { source: 'Intermediary', current: 16, plan: 22, risk: 'amber', risk_score: 54, attractiveness: 76, owner: 'Tom', thesis: 'Producing onshore asset.', next: 'Validate ownership and sale status' },
};

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));            // petrolera-del-orinoco (VE) with an NDA tag and the orinoco-partnership project
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'), ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','CO')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy', (now() + interval '12 days')::date)");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,members) VALUES ('llanos-waterflood','frontera','Llanos Basin waterflood screening','active','lt-frontera-nda-2026','{chris,ana}')");
  partner = await appFor(`chris@${DOMAIN}`);
  ana = await appFor(`ana@${DOMAIN}`);
  ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { await db.close(); });

/* ── migration ───────────────────────────────────────────────────────── */

test('002: existing projects get the new columns with safe defaults', async () => {
  const r = (await db.query<any>("SELECT country, lat, lon, stage, stage_history, register FROM projects WHERE id = 'orinoco-partnership'")).rows[0];
  assert.equal(r.country, null);
  assert.equal(r.lat, null);
  assert.equal(r.stage, 'Initial screen');
  assert.deepEqual(r.stage_history, []);
  assert.deepEqual(r.register, {});
});

/* ── create with the new fields ──────────────────────────────────────── */

test('AC11: a partner creates an opportunity with country, coordinates, stage and register fields; the first stage is in the history', async () => {
  const r = await json(await call(partner, 'POST', '/api/projects', KAZ));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.country, 'KZ');
  assert.equal(r.body.lat, 47.1);
  assert.equal(r.body.lon, 51.9);
  assert.equal(r.body.stage, 'Qualified');
  assert.equal(r.body.status, 'prospect');
  assert.deepEqual(r.body.register, KAZ.register);
  assert.equal(r.body.stage_history.length, 1);
  assert.equal(r.body.stage_history[0].stage, 'Qualified');
  assert.equal(r.body.stage_history[0].by, 'chris');
  assert.match(r.body.stage_history[0].at, /^\d{4}-\d{2}-\d{2}T/);

  const list = await json(await call(partner, 'GET', '/api/projects'));
  const kaz = list.body.projects.find((p: any) => p.id === 'kaz-brownfield');
  assert.equal(kaz.country, 'KZ');
  assert.equal(kaz.stage, 'Qualified');
  assert.equal(kaz.register.owner, 'Tom');
});

test('AC11: country must be ISO alpha-2, coordinates in range, stage one of the known stages, register an object', async () => {
  const bad = async (patch: Record<string, unknown>, where: string) => {
    const r = await json(await call(partner, 'POST', '/api/projects', { ...KAZ, id: 'bad-' + randomUUID().slice(0, 8), ...patch }));
    assert.equal(r.status, 400, where + ': ' + JSON.stringify(r.body));
    assert.equal(r.body.error.path, where);
  };
  await bad({ country: 'Kaz' }, '/country');
  await bad({ country: 'kz' }, '/country');
  await bad({ lat: 91 }, '/lat');
  await bad({ lon: -181 }, '/lon');
  await bad({ lat: 'north' }, '/lat');
  await bad({ stage: 'Dreaming' }, '/stage');
  await bad({ register: 'x' }, '/register');
  // Without the new fields a project still creates as before (defaults).
  const r = await json(await call(partner, 'POST', '/api/projects', { id: 'plain-project', name: 'Plain' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.country, null);
  assert.equal(r.body.stage, 'Initial screen');
  assert.equal(r.body.stage_history.length, 1);
  assert.deepEqual(r.body.register, {});
});

/* ── PATCH ───────────────────────────────────────────────────────────── */

test('AC11: PATCH changes the stage, appends to stage_history, writes one audit event naming the change', async () => {
  const before = Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events WHERE action = 'project.update'")).rows[0].n);
  const r = await json(await call(partner, 'PATCH', '/api/projects/kaz-brownfield', { stage: 'Technical review', register: { owner: 'Tom / Chris' } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stage, 'Technical review');
  assert.equal(r.body.stage_history.length, 2);
  assert.deepEqual(r.body.stage_history.map((h: any) => h.stage), ['Qualified', 'Technical review']);
  assert.equal(r.body.stage_history[1].by, 'chris');
  // register merges: the other fields survive, owner changes.
  assert.equal(r.body.register.owner, 'Tom / Chris');
  assert.equal(r.body.register.plan, 22);
  const audit = (await db.query<any>("SELECT scope, refs, detail FROM audit_events WHERE action = 'project.update' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events WHERE action = 'project.update'")).rows[0].n), before + 1);
  assert.equal(audit.scope, 'project:kaz-brownfield');
  assert.deepEqual(audit.refs, ['project:kaz-brownfield']);
  assert.equal(audit.detail.status, 200);
  assert.deepEqual(audit.detail.stage, { from: 'Qualified', to: 'Technical review' });
  assert.deepEqual(audit.detail.fields.sort(), ['register', 'stage']);

  // Same stage again: no new history entry.
  const again = await json(await call(partner, 'PATCH', '/api/projects/kaz-brownfield', { stage: 'Technical review' }));
  assert.equal(again.status, 200);
  assert.equal(again.body.stage_history.length, 2);

  // Status, country and coordinates also change; GET shows the result.
  const s = await json(await call(partner, 'PATCH', '/api/projects/kaz-brownfield', { status: 'active', country: 'KZ', lat: 47.2, lon: 52 }));
  assert.equal(s.status, 200);
  assert.equal(s.body.status, 'active');
  const g = await json(await call(partner, 'GET', '/api/projects/kaz-brownfield'));
  assert.equal(g.body.lat, 47.2);
  assert.equal(g.body.stage, 'Technical review');
});

test('AC11: PATCH refuses unknown stages, unknown fields, bad values and an empty body', async () => {
  for (const [body, where] of [[{ stage: 'Won!' }, '/stage'], [{ name: 'Renamed' }, '/name'], [{ lat: 100 }, '/lat'], [{ status: 'done' }, '/status'], [{}, '/']] as const) {
    const r = await json(await call(partner, 'PATCH', '/api/projects/kaz-brownfield', body));
    assert.equal(r.status, 400, JSON.stringify(body) + ' → ' + JSON.stringify(r.body));
    assert.equal(r.body.error.path, where);
  }
});

test('AC11: a member may PATCH a client project; a non-member who cannot see it gets 404, not 403; an internal project is open', async () => {
  const ok = await json(await call(ana, 'PATCH', '/api/projects/llanos-waterflood', { stage: 'Qualified' }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.stage_history.at(-1).by, 'ana');
  const hidden = await json(await call(ben, 'PATCH', '/api/projects/llanos-waterflood', { stage: 'Qualified' }));
  assert.equal(hidden.status, 404, JSON.stringify(hidden.body));
  const missing = await json(await call(partner, 'PATCH', '/api/projects/no-such-project', { stage: 'Qualified' }));
  assert.equal(missing.status, 404);
  // kaz-brownfield is internal (no client): any signed-in person may move it.
  const open = await json(await call(ben, 'PATCH', '/api/projects/kaz-brownfield', { stage: 'Commercial review' }));
  assert.equal(open.status, 200, JSON.stringify(open.body));
});

/* ── countries summary ───────────────────────────────────────────────── */

test('AC12: GET /api/countries groups the projects the caller may see, with names in both languages and attention flags', async () => {
  // Egypt: an opportunity whose default tag expires in 12 days (the Frontera tag reused on purpose), seen by a partner.
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,lat,lon,members) VALUES ('egy-onshore','frontera','Egypt Onshore Gas Hub','prospect','lt-frontera-nda-2026','EG',30.5,30.2,'{chris}')");
  await db.query("UPDATE projects SET country = 'VE', lat = 8.1, lon = -69.3 WHERE id = 'orinoco-partnership'");
  // Kazakhstan: a stale final run.
  const stale = run({ project_id: 'kaz-brownfield', client_id: null, legal_tag: 'lt-firm', status: 'final', title: 'Waterflood screen' });
  assert.equal((await call(partner, 'POST', '/api/runs', stale)).status, 201);
  await db.query("UPDATE runs SET stale = true, stale_reasons = '[{\"rule\":\"R1\",\"detail\":\"tool moved on\"}]'::jsonb WHERE id = $1", [stale.id]);
  // A document waiting to be filed, suggested for the Kazakhstan project.
  const itemId = randomUUID();
  await db.query("INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version) VALUES ($1,'email','Data room index',now(),'firm','lt-firm','{\"source\":\"upload\"}'::jsonb,$2,1)", [itemId, hashOf(itemId)]);
  await db.query("INSERT INTO filing_queue (id,item_id,suggestions) VALUES ($1,$2,'[{\"project_id\":\"kaz-brownfield\",\"confidence\":0.8}]'::jsonb)", [randomUUID(), itemId]);

  const r = await json(await call(partner, 'GET', '/api/countries'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const codes = r.body.countries.map((c: any) => c.code);
  assert.deepEqual([...codes].sort(), ['EG', 'KZ', 'VE']);
  const kz = r.body.countries.find((c: any) => c.code === 'KZ');
  assert.deepEqual(kz.name, { en: 'Kazakhstan', es: 'Kazajistán' });
  assert.equal(kz.projects.length, 1);
  const kp = kz.projects[0];
  assert.equal(kp.id, 'kaz-brownfield');
  assert.equal(kp.stage, 'Commercial review');
  assert.equal(kp.status, 'active');
  assert.equal(kp.lat, 47.2);
  assert.equal(kp.attention.stale, 1);
  assert.equal(kp.attention.filing, 1);
  assert.equal(kp.attention.expiring_days, null);
  assert.equal(kp.last_run_at.slice(0, 4), '2026');
  assert.deepEqual(kz.counts, { projects: 1, stale: 1, filing: 1, expiring: 0 });
  const eg = r.body.countries.find((c: any) => c.code === 'EG');
  assert.equal(eg.projects[0].attention.expiring_days, 12);
  assert.equal(eg.counts.expiring, 1);
  assert.equal(eg.projects[0].client_id, 'frontera');
  assert.equal(eg.projects[0].client_name, 'Frontera Energy');
  // Projects without a country are listed separately, never silently dropped.
  assert.ok(r.body.unplaced.some((p: any) => p.id === 'plain-project'));
  assert.ok(r.body.unplaced.some((p: any) => p.id === 'firm'));
  assert.equal(r.body.generated_at.slice(0, 4), new Date().toISOString().slice(0, 4));
});

test('AC12: an associate outside the NDA sees only the countries of projects visible to them; counts never include hidden projects', async () => {
  const r = await json(await call(ben, 'GET', '/api/countries'));
  assert.equal(r.status, 200);
  const codes = r.body.countries.map((c: any) => c.code).sort();
  assert.deepEqual(codes, ['KZ']);                        // VE and EG are client-NDA projects Ben is not on
  assert.equal(r.body.countries[0].counts.projects, 1);
  assert.ok(!r.body.unplaced.some((p: any) => p.id === 'llanos-waterflood'));
  // Ana is a member of the Frontera project (CO is not set, so it is unplaced) but not of Egypt.
  const a = await json(await call(ana, 'GET', '/api/countries'));
  assert.deepEqual(a.body.countries.map((c: any) => c.code).sort(), ['KZ']);
  assert.ok(a.body.unplaced.some((p: any) => p.id === 'llanos-waterflood'));
  assert.ok(!a.body.unplaced.some((p: any) => p.id === 'egy-onshore'));
});
