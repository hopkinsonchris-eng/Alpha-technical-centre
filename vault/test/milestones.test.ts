// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.7; data review 03 §5.1 S2): project_milestones.
// Dated obligations on a project: members create them, change due_at, title and done_at; the kind is one of
// the table's five; a dispatch stays as the schema describes it (Tier A) and the milestone carries ref
// 'dispatch:<id>'. Setting register.next through the existing PATCH writes an open next_action milestone
// when none exists, so the Hub's Next token gains a date. Smoke tests written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-milestones-'));
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
let ana: Awaited<ReturnType<typeof createApp>>;   // associate, member
let ben: Awaited<ReturnType<typeof createApp>>;   // associate, not a member, no tag
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const DISPATCH = randomUUID();

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'), ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('ms-p','frontera','Milestones project','lt-frontera-nda-2026','{chris,ana}')");
  partner = await appFor(`chris@${DOMAIN}`); ana = await appFor(`ana@${DOMAIN}`); ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { await db.close(); });

let mid: string;

test('S2: a member creates a reply_due milestone that points at a dispatch; the kind is checked; an outsider is refused', async () => {
  const r = await call(ana, 'POST', '/api/projects/ms-p/milestones', { kind: 'reply_due', title: 'Reply from Frontera on the data room', due_at: '2026-10-20', ref: `dispatch:${DISPATCH}` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  mid = r.body.id;
  assert.match(mid, /^[0-9a-f-]{36}$/);
  assert.equal(r.body.project_id, 'ms-p'); assert.equal(r.body.kind, 'reply_due'); assert.equal(r.body.due_at, '2026-10-20');
  assert.equal(r.body.ref, `dispatch:${DISPATCH}`); assert.equal(r.body.done_at, null); assert.equal(r.body.created_by, 'ana'); assert.equal(r.body.owner, null);
  assert.equal((await call(ana, 'POST', '/api/projects/ms-p/milestones', { kind: 'birthday', title: 'x' })).status, 400);
  assert.equal((await call(ana, 'POST', '/api/projects/ms-p/milestones', { kind: 'deadline' })).status, 400, 'a title is required');
  assert.equal((await call(ana, 'POST', '/api/projects/ms-p/milestones', { kind: 'deadline', title: 'x', due_at: 'soon' })).status, 400);
  assert.equal((await call(ana, 'POST', '/api/projects/ms-p/milestones', { kind: 'deadline', title: 'x', owner: 'nobody' })).status, 400);
  assert.equal((await call(ben, 'POST', '/api/projects/ms-p/milestones', { kind: 'deadline', title: 'x' })).status, 403);
  assert.equal((await call(partner, 'POST', '/api/projects/nope/milestones', { kind: 'deadline', title: 'x' })).status, 404);
  const ev = (await db.query<any>("SELECT scope, refs FROM audit_events WHERE action = 'milestone.create' AND $1 = ANY(refs)", [`milestone:${mid}`])).rows[0];
  assert.equal(ev.scope, 'project:ms-p'); assert.ok(ev.refs.includes(`dispatch:${DISPATCH}`));
});

test('S2: the list is scope-checked like the timeline, open first then by due date', async () => {
  const later = await call(partner, 'POST', '/api/projects/ms-p/milestones', { kind: 'expiry', title: 'NDA expires', due_at: '2027-03-31', owner: 'chris' });
  assert.equal(later.status, 201);
  assert.equal(later.body.owner, 'chris');
  const r = await call(ana, 'GET', '/api/projects/ms-p/milestones');
  assert.equal(r.status, 200);
  assert.equal(r.body.project_id, 'ms-p');
  assert.deepEqual(r.body.milestones.map((m: any) => m.due_at), ['2026-10-20', '2027-03-31']);
  assert.equal((await call(ben, 'GET', '/api/projects/ms-p/milestones')).status, 403);
  assert.equal((await call(partner, 'GET', '/api/projects/nope/milestones')).status, 404);
});

test('S2: PATCH changes due_at, title and done_at; a done milestone leaves the open list; nothing else can be changed', async () => {
  let r = await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${mid}`, { due_at: '2026-10-27', title: 'Reply from Frontera (extended)' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.due_at, '2026-10-27'); assert.equal(r.body.title, 'Reply from Frontera (extended)');
  assert.equal((await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${mid}`, { kind: 'deadline' })).status, 400, 'the kind is fixed');
  assert.equal((await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${mid}`, {})).status, 400);
  assert.equal((await call(ben, 'PATCH', `/api/projects/ms-p/milestones/${mid}`, { title: 'x' })).status, 403);
  assert.equal((await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${randomUUID()}`, { title: 'x' })).status, 404);
  r = await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${mid}`, { done_at: '2026-10-21T09:00:00Z' });
  assert.equal(r.status, 200); assert.equal(r.body.done_at, '2026-10-21T09:00:00.000Z');
  const open = await call(ana, 'GET', '/api/projects/ms-p/milestones?open=1');
  assert.deepEqual(open.body.milestones.map((m: any) => m.kind), ['expiry']);
  const all = await call(ana, 'GET', '/api/projects/ms-p/milestones');
  assert.equal(all.body.milestones.length, 2);
  assert.equal(all.body.milestones[0].kind, 'expiry', 'open first');
  // done_at: null reopens it; done_at: true closes it now.
  r = await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${mid}`, { done_at: null });
  assert.equal(r.body.done_at, null);
  r = await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${mid}`, { done_at: true });
  assert.match(r.body.done_at, /^\d{4}-/);
});

test('S2: setting register.next through the project PATCH writes one open next_action milestone and keeps it in step', async () => {
  let r = await call(ana, 'PATCH', '/api/projects/ms-p', { register: { next: 'Validate ownership and sale status', next_due: '2026-11-01' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.register.next, 'Validate ownership and sale status', 'the register text stays until a milestone replaces it');
  assert.equal(r.body.register.next_due, undefined, 'the date lives on the milestone, not in the register');
  let open = (await call(ana, 'GET', '/api/projects/ms-p/milestones?open=1')).body.milestones.filter((m: any) => m.kind === 'next_action');
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'Validate ownership and sale status'); assert.equal(open[0].due_at, '2026-11-01'); assert.equal(open[0].created_by, 'ana');
  // A new next while one is open: the open milestone is updated, not duplicated.
  r = await call(ana, 'PATCH', '/api/projects/ms-p', { register: { next: 'Send the proposal' } });
  open = (await call(ana, 'GET', '/api/projects/ms-p/milestones?open=1')).body.milestones.filter((m: any) => m.kind === 'next_action');
  assert.equal(open.length, 1); assert.equal(open[0].title, 'Send the proposal'); assert.equal(open[0].due_at, '2026-11-01', 'the date survives a text-only change');
  // Done, then a new next: a new milestone.
  await call(ana, 'PATCH', `/api/projects/ms-p/milestones/${open[0].id}`, { done_at: true });
  r = await call(ana, 'PATCH', '/api/projects/ms-p', { register: { next: 'Kick-off with the operator', next_due: '2026-12-01' } });
  const all = (await call(ana, 'GET', '/api/projects/ms-p/milestones')).body.milestones.filter((m: any) => m.kind === 'next_action');
  assert.equal(all.length, 2);
  open = all.filter((m: any) => !m.done_at);
  assert.equal(open.length, 1); assert.equal(open[0].title, 'Kick-off with the operator'); assert.equal(open[0].due_at, '2026-12-01');
  // Clearing next closes nothing (the milestone is the record); a register patch without next writes nothing.
  r = await call(ana, 'PATCH', '/api/projects/ms-p', { register: { owner: 'Tom' } });
  assert.equal((await call(ana, 'GET', '/api/projects/ms-p/milestones')).body.milestones.length, 4);
  assert.equal((await call(ana, 'PATCH', '/api/projects/ms-p', { register: { next: 'x', next_due: 'tomorrow' } })).status, 400);
});
