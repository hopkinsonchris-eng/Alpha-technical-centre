// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.7, W7-AC12; data review 03 §5.2 A1, A7, A9 and §5.1 S4):
// where a project stands in one call. GET /api/projects/:id/standing returns the agreed shape, scope-checked
// like the timeline; `since` is relative to the caller's last project.read; GET /api/projects/:id/activity?since=
// reuses the activity gatherer; the project carries legal_tag_expiry, stage_changed_at and origin_ref.
// Smoke tests written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-standing-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { refreshFigures } = await import('../src/jobs/figures.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ana: Awaited<ReturnType<typeof createApp>>;   // associate, member
let ben: Awaited<ReturnType<typeof createApp>>;   // associate without the tag
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const base = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown> = {}) => ({ ...base, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], asset_ids: [], project_id: 'standing-p', client_id: 'frontera', legal_tag: 'lt-frontera-nda-2026', ...o });
const P = 'standing-p', TAG = 'lt-frontera-nda-2026';
const ids = { run: '', note: randomUUID(), email: randomUUID(), draft: randomUUID(), letter: randomUUID(), theirs: randomUUID(), invoice: randomUUID(), filing: randomUUID(), dOut: randomUUID(), dIn: randomUUID() };
const item = (id: string, type: string, title: string, at: string, extracted: Record<string, unknown> = {}, project = P, tag = TAG) =>
  db.query("INSERT INTO items (id,type,title,created_at,project_id,client_id,legal_tag,origin,content_hash,version,extracted) VALUES ($1,$2,$3,$4,$5,$6,$7,'{\"source\":\"upload\"}'::jsonb,$8,1,$9::jsonb)",
    [id, type, title, at, project, project === P ? 'frontera' : null, tag, hashOf(id), JSON.stringify(extracted)]);

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'), ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','CO'), ('anh','ANH','regulator','CO'), ('ecopetrol','Ecopetrol S.A.','operator','CO')");
  await db.query(`INSERT INTO contacts (id,organisation_id,name,emails,relationship) VALUES ('juan','ecopetrol','Juan Pérez','{juan@ecopetrol.example}', '{"last_contact_at":"2026-09-20T10:00:00Z","last_contact_by":"chris","last_direction":"out","exchanges":4}'::jsonb)`);
  await db.query(`INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ($1,'client-nda','second-party','frontera','Frontera Energy','2027-03-31')`, [TAG]);
  await db.query(`INSERT INTO projects (id,client_id,name,status,default_legal_tag,members,country,stage,stage_history,register,created_at) VALUES ($1,'frontera','Llanos waterflood','active',$2,'{chris,ana}','CO','Qualified',
    '[{"stage":"Initial screen","at":"2026-08-01T09:00:00Z","by":"chris"},{"stage":"Qualified","at":"2026-08-20T09:00:00Z","by":"chris"}]'::jsonb,
    '{"next":"Validate ownership","owner":"Tom","current":16,"plan":22,"holder":"Ecopetrol S.A.","government":"ANH"}'::jsonb, '2026-08-01T09:00:00Z')`, [P, TAG]);
  await db.query("INSERT INTO project_organisations (project_id,organisation_id,role) VALUES ($1,'ecopetrol','holder'), ($1,'anh','government')", [P]);
  partner = await appFor(`chris@${DOMAIN}`); ana = await appFor(`ana@${DOMAIN}`); ben = await appFor(`ben@${DOMAIN}`);

  const r = run({ created_at: '2026-09-01T10:00:00Z', title: 'Cubiro waterflood screen', outputs: { technical_potential_bopd: { value: 4200, unit: 'bopd' } } });
  assert.equal((await call(partner, 'POST', '/api/runs', r)).status, 201);
  ids.run = r.id;
  await item(ids.note, 'note', 'Kick-off note', '2026-09-05T09:00:00Z');
  await item(ids.letter, 'letter', 'Proposal letter', '2026-09-10T09:00:00Z');
  await item(ids.theirs, 'letter', 'Their letter on the data room', '2026-09-12T09:00:00Z');
  await item(ids.email, 'email', 'RE: data room access', '2026-09-18T09:00:00Z', { direction: 'in', status: 'filed', contacts: [{ role: 'from', name: 'Juan Pérez', email: 'juan@ecopetrol.example' }] });
  await item(ids.draft, 'note', 'Draft letter to Ecopetrol', '2026-09-19T09:00:00Z', { kind: 'draft', draft_kind: 'letter', questions: ['What is the current rate?', 'Which licence?'] });
  await item(ids.invoice, 'invoice', 'Invoice 2026-031', '2026-09-15T09:00:00Z', { number: '2026-031', amount: 12000, currency: 'USD', due_date: '2026-10-15', status: 'open' });
  await db.query("INSERT INTO dispatches (id,item_id,direction,organisation_id,channel,occurred_at,recorded_by) VALUES ($1,$2,'out','ecopetrol','email','2026-09-10T10:00:00Z','chris'), ($3,$4,'in','anh','post','2026-09-12T10:00:00Z','chris')", [ids.dOut, ids.letter, ids.dIn, ids.theirs]);
  await db.query("INSERT INTO review_queue (id,kind,payload) VALUES ($1,'asset',$4::jsonb), ($2,'research',$4::jsonb), ($3,'organisation',$4::jsonb)", [randomUUID(), randomUUID(), randomUUID(), JSON.stringify({ project_id: P })]);
  await db.query("INSERT INTO review_queue (id,kind,payload,status) VALUES ($1,'asset',$2::jsonb,'accepted')", [randomUUID(), JSON.stringify({ project_id: P })]);
  await item(ids.filing, 'email', 'Unfiled message', '2026-09-21T09:00:00Z', {}, 'firm', 'lt-firm');
  await db.query("INSERT INTO filing_queue (id,item_id,suggestions) VALUES ($1,$2,$3::jsonb)", [randomUUID(), ids.filing, JSON.stringify([{ project_id: P, confidence: 0.8 }])]);
  assert.equal((await call(partner, 'POST', `/api/projects/${P}/milestones`, { kind: 'data_room_closes', title: 'Data room closes', due_at: '2026-09-30' })).status, 201);
  assert.equal((await call(partner, 'POST', `/api/projects/${P}/milestones`, { kind: 'next_action', title: 'Validate ownership', due_at: '2026-10-20', owner: 'chris' })).status, 201);
});
after(async () => { await db.close(); });

const KEYS = ['project', 'next', 'figures', 'open', 'counterparties', 'deadlines', 'since', 'stale_counts', 'last_activity'];

test('A1 / W7-AC12: the standing has exactly the agreed shape, from the register, the runs, the queues, the milestones and the counterparties', async () => {
  const r = await call(partner, 'GET', `/api/projects/${P}/standing`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body;
  assert.deepEqual(Object.keys(s), KEYS);
  assert.deepEqual(s.project, { id: P, name: 'Llanos waterflood', status: 'active', stage: 'Qualified', stage_since: '2026-08-20T09:00:00.000Z', country: 'CO', client_id: 'frontera' });
  assert.deepEqual(s.next, { title: 'Validate ownership', due_at: '2026-10-20', owner: 'chris', ref: null });
  // Figures: derived live from the runs and the register by the nightly job's rule, with unit, date and source on every row.
  assert.deepEqual(Object.keys(s.figures[0]), ['job', 'name', 'value', 'unit', 'as_of', 'source_ref', 'provenance', 'run_status', 'stale', 'asset_id']);
  assert.deepEqual(s.figures, [
    { job: 'opportunity-register', name: 'technical_potential_bopd', value: 4200, unit: 'bopd', as_of: '2026-09-01', source_ref: `run:${ids.run}`, provenance: 'run', run_status: 'draft', stale: false, asset_id: null },
    { job: 'register', name: 'current', value: 16, unit: 'kboe/d', as_of: '2026-08-20', source_ref: 'register', provenance: 'register', run_status: null, stale: false, asset_id: null },
    { job: 'register', name: 'plan', value: 22, unit: 'kboe/d', as_of: '2026-08-20', source_ref: 'register', provenance: 'register', run_status: null, stale: false, asset_id: null },
  ]);
  assert.deepEqual(s.open, { proposals: { asset: 1, organisation: 1, research: 1, round: 0 }, filing: 1, questions_in_drafts: 2, unanswered_inbound: 1, unacknowledged_dispatches: 1 });
  assert.deepEqual(s.counterparties, [
    { organisation_id: 'ecopetrol', name: 'Ecopetrol S.A.', role: 'holder', last_contact_at: '2026-09-20T10:00:00.000Z', last_contact_by: 'chris' },
    { organisation_id: 'anh', name: 'ANH', role: 'government', last_contact_at: '2026-09-12T10:00:00.000Z', last_contact_by: 'chris' },
  ]);
  assert.deepEqual(s.deadlines, [
    { kind: 'data_room_closes', title: 'Data room closes', due_at: '2026-09-30', ref: null, overdue: true },
    { kind: 'deadline', title: 'Invoice 2026-031 due', due_at: '2026-10-15', ref: `doc:${ids.invoice}`, overdue: false },
    { kind: 'next_action', title: 'Validate ownership', due_at: '2026-10-20', ref: null, overdue: false },
    { kind: 'expiry', title: `NDA ${TAG} expires`, due_at: '2027-03-31', ref: `tag:${TAG}`, overdue: false },
  ]);
  assert.deepEqual(s.since, { opened_at: null, runs: 1, items: 6, mail: 1 }, 'never opened: everything is new to the caller');
  assert.deepEqual(s.stale_counts, { runs: 0, items: 0 });
  assert.deepEqual(s.last_activity, { title: 'Draft letter to Ecopetrol', at: '2026-09-19T09:00:00.000Z', ref: `doc:${ids.draft}` });
  const ev = (await db.query<any>("SELECT scope, refs FROM audit_events WHERE action = 'project.standing' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(ev.scope, `project:${P}`); assert.deepEqual(ev.refs, [`project:${P}`]);
  console.log('STANDING_JSON ' + JSON.stringify(s));
  // The nightly job writes the same rows to project_figures; the standing is unchanged by it.
  await refreshFigures(db, { projectId: P });
  const again = (await call(partner, 'GET', `/api/projects/${P}/standing`)).body;
  assert.deepEqual(again.figures, s.figures);
});

test('A1: scope-checked like the timeline: a member sees it without the partners-only invoice, an associate without the tag is refused, an unknown project is 404', async () => {
  const r = await call(ana, 'GET', `/api/projects/${P}/standing`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.deadlines.map((d: any) => d.kind), ['data_room_closes', 'next_action', 'expiry']);
  assert.equal(r.body.since.items, 5);
  assert.equal(r.body.figures.length, 3);
  const b = await call(ben, 'GET', `/api/projects/${P}/standing`);
  assert.equal(b.status, 403);
  assert.equal((await call(partner, 'GET', '/api/projects/nope/standing')).status, 404);
});

test('A7: since is relative to the caller\'s last project.read on this project; the per-project activity route takes ?since=', async () => {
  assert.equal((await call(partner, 'GET', `/api/projects/${P}`)).status, 200);
  const opened = (await db.query<any>("SELECT at FROM audit_events WHERE action = 'project.read' AND person_id = 'chris' AND $1 = ANY(refs) ORDER BY id DESC LIMIT 1", [`project:${P}`])).rows[0].at;
  const later = new Date(Date.now() + 2000).toISOString();
  const r2 = run({ created_at: new Date(Date.now() + 3000).toISOString(), title: 'Sensitivity', outputs: { technical_potential_bopd: { value: 4400, unit: 'bopd' } } });
  assert.equal((await call(partner, 'POST', '/api/runs', r2)).status, 201);
  const newNote = randomUUID(), newMail = randomUUID();
  await item(newNote, 'note', 'Site visit note', later);
  await item(newMail, 'email', 'FW: licence map', later, { direction: 'in', status: 'filed' });
  const s = (await call(partner, 'GET', `/api/projects/${P}/standing`)).body;
  assert.equal(s.since.opened_at, new Date(opened).toISOString());
  assert.deepEqual({ runs: s.since.runs, items: s.since.items, mail: s.since.mail }, { runs: 1, items: 2, mail: 1 });
  assert.equal(s.last_activity.title, 'Sensitivity');
  assert.equal(s.figures.find((f: any) => f.name === 'technical_potential_bopd').value, 4400, 'the newest run per job');
  // Ana never opened it: nothing is "since" for her yet everything is new.
  assert.equal((await call(ana, 'GET', `/api/projects/${P}/standing`)).body.since.opened_at, null);
  // The activity route: the same gatherer as Today, for one project, from an explicit since or the caller's last read.
  const a = await call(partner, 'GET', `/api/projects/${P}/activity?since=2026-09-17T00:00:00Z`);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.project_id, P); assert.equal(a.body.since, '2026-09-17T00:00:00.000Z');
  const refs = a.body.records.map((x: any) => x.ref);
  assert.ok(refs.includes(`doc:${ids.email}`) && refs.includes(`doc:${newMail}`) && refs.includes(`doc:${newNote}`), JSON.stringify(refs));
  assert.ok(!refs.includes(`doc:${ids.draft}`), 'drafts never "came in"'); assert.ok(!refs.includes(`doc:${ids.note}`), 'before since');
  assert.ok(!refs.includes(`doc:${ids.filing}`), 'another project');
  assert.equal(a.body.counts.messages_filed, 2);
  const d = await call(partner, 'GET', `/api/projects/${P}/activity`);
  assert.equal(d.body.since, new Date(opened).toISOString());
  assert.deepEqual(d.body.records.map((x: any) => x.ref).sort(), [`doc:${newMail}`, `doc:${newNote}`].sort());
  assert.equal((await call(partner, 'GET', `/api/projects/${P}/activity?since=yesterday`)).status, 400);
  assert.equal((await call(ben, 'GET', `/api/projects/${P}/activity`)).status, 403);
});

test('S4 / A9: the project carries legal_tag_expiry, stage_changed_at (backfilled from the stage history) and origin_ref; the stage PATCH maintains it', async () => {
  let r = await call(partner, 'GET', `/api/projects/${P}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.legal_tag_expiry, '2027-03-31');
  assert.equal(r.body.stage_changed_at, '2026-08-20T09:00:00.000Z');
  assert.equal(r.body.origin_ref, null);
  const before = Date.now();
  r = await call(partner, 'PATCH', `/api/projects/${P}`, { stage: 'Technical review' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Date.parse(r.body.stage_changed_at) >= before - 1000, 'the PATCH stamps the change');
  const stored = (await db.query<any>('SELECT stage_changed_at FROM projects WHERE id = $1', [P])).rows[0].stage_changed_at;
  assert.ok(stored, 'stored on the row, not only derived');
  const s = (await call(partner, 'GET', `/api/projects/${P}/standing`)).body;
  assert.equal(s.project.stage, 'Technical review'); assert.equal(s.project.stage_since, r.body.stage_changed_at);
  // A register-only patch leaves the stamp alone.
  const same = await call(partner, 'PATCH', `/api/projects/${P}`, { register: { thesis: 'A producing onshore asset.' } });
  assert.equal(same.body.stage_changed_at, r.body.stage_changed_at);
  // origin_ref on create: the email or document that started the project.
  const doc = `doc:${randomUUID()}`;
  const c = await call(partner, 'POST', '/api/projects', { id: 'from-mail', name: 'test', client_id: 'frontera', default_legal_tag: TAG, origin_ref: doc, country: 'CO' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.origin_ref, doc);
  assert.equal((await call(partner, 'GET', '/api/projects/from-mail')).body.origin_ref, doc);
  assert.ok(c.body.stage_changed_at, 'a new project knows when its first stage opened');
  assert.equal((await call(partner, 'POST', '/api/projects', { id: 'bad-origin', name: 'test', default_legal_tag: 'lt-firm', origin_ref: 42 })).status, 400);
  assert.equal((await call(partner, 'GET', '/api/projects/firm')).body.legal_tag_expiry, null);
});
