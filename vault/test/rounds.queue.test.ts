// Wave 7 PR6 (docs/vault-hub/wave7/05-markup.md §1.9, W7-AC21): a round proposal reaches the review queue as kind
// 'round' the way asset, organisation and research proposals do; the queue page lists it; accepting confirms the
// event (a member may), rejecting dismisses it; both go through the same functions as POST /api/rounds/:id/confirm
// and /dismiss. Written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-rounds-queue-'));
delete process.env.CF_ACCESS_TEAM_DOMAIN;
process.env.NODE_ENV = 'test';

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { proposeRounds } = await import('../src/rounds/store.ts');
type Db = Awaited<ReturnType<typeof openDb>>;
type RoundProposal = import('../src/rounds/types.ts').RoundProposal;

const DOMAIN = 'alpha-technical-centre.com';
const URL = 'https://www.nstauthority.co.uk/licensing-consents/licensing-rounds/';
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let associate: Awaited<ReturnType<typeof createApp>>;
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const proposal = (stage: RoundProposal['stage'], event_date: string | null, title: string, quote: string): RoundProposal =>
  ({ country: 'GB', round: '34th Offshore Licensing Round', stage, event_date, title, quote, source_item: null, source_url: URL, read_at: '2026-10-05T04:30:00.000Z' });

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('ana','ana@${DOMAIN}','Ana','associate') ON CONFLICT (id) DO NOTHING`);
  await db.query("INSERT INTO projects (id,name,default_legal_tag,members,country,status) VALUES ('p-gb','UKCS screen','lt-firm','{chris,ana}','GB','prospect')");
  partner = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  associate = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
});
after(async () => { await db.close(); });

test('W7-AC21 proposeRounds: one round_events row and one review-queue row of kind round per proposal; the same country, round, stage and date is never proposed twice while one is open or confirmed', async () => {
  const r = await proposeRounds(db, [
    proposal('announced', '2026-09-02', '34th Round announced', 'The 34th Offshore Licensing Round was announced on 2 September 2026.'),
    proposal('bid_deadline', '2027-01-14', 'Applications due', 'Applications must be submitted by 13:00 on 14 January 2027.'),
    proposal('bid_deadline', '2027-01-14', 'Applications due (again)', 'Applications must be submitted by 13:00 on 14 January 2027.'),
  ], new Date('2026-10-05T04:30:00Z'));
  assert.equal(r.inserted.length, 2); assert.equal(r.duplicates, 1);
  const again = await proposeRounds(db, [proposal('announced', '2026-09-02', '34th Round announced', 'The 34th Offshore Licensing Round was announced on 2 September 2026.')], new Date('2026-10-12T04:30:00Z'));
  assert.deepEqual({ inserted: again.inserted, duplicates: again.duplicates }, { inserted: [], duplicates: 1 });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM round_events WHERE status = 'proposed'")).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM review_queue WHERE kind = 'round' AND status = 'open'")).rows[0].n, 2);
});

test('W7-AC21 the queue lists kind round (with and without ?kind=) in the shape the queue page needs; nothing in it names a project, so every member sees it', async () => {
  const byKind = await call(associate, 'GET', '/api/queue/review?kind=round');
  assert.equal(byKind.status, 200);
  assert.equal(byKind.body.items.length, 2);
  const all = await call(associate, 'GET', '/api/queue/review');
  assert.equal(all.body.items.filter((i: any) => i.kind === 'round').length, 2);
  const row = byKind.body.items.find((i: any) => i.payload.stage === 'bid_deadline');
  assert.equal(row.kind, 'round'); assert.equal(row.status, 'open');
  assert.deepEqual(Object.keys(row.payload).sort(), ['country', 'country_name', 'event_date', 'proposal', 'quote', 'read_at', 'round', 'round_event_id', 'source_item', 'source_url', 'stage', 'stage_label', 'title']);
  assert.deepEqual({ ...row.payload, round_event_id: 'id' }, {
    round_event_id: 'id', country: 'GB', country_name: { en: 'United Kingdom', es: 'Reino Unido' }, round: '34th Offshore Licensing Round', stage: 'bid_deadline', stage_label: { en: 'Bid deadline', es: 'Plazo de ofertas' },
    event_date: '2027-01-14', title: 'Applications due', quote: 'Applications must be submitted by 13:00 on 14 January 2027.', source_item: null, source_url: URL, read_at: '2026-10-05T04:30:00.000Z',
    proposal: '34th Offshore Licensing Round · Bid deadline · 2027-01-14',
  });
  assert.equal((await db.query('SELECT status FROM round_events WHERE id = $1', [row.payload.round_event_id])).rows[0].status, 'proposed');
});

test('W7-AC21 accept confirms the event (a member may), reject dismisses it; the event row and the queue row agree; a decided row is a conflict', async () => {
  const items = (await call(partner, 'GET', '/api/queue/review?kind=round')).body.items;
  const dl = items.find((i: any) => i.payload.stage === 'bid_deadline'), an = items.find((i: any) => i.payload.stage === 'announced');
  const ok = await call(associate, 'POST', `/api/queue/review/${dl.id}/accept`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'accepted');
  assert.equal(ok.body.event.status, 'confirmed'); assert.equal(ok.body.event.confirmed_by, 'ana'); assert.equal(ok.body.event.id, dl.payload.round_event_id);
  const ev = (await db.query('SELECT status, confirmed_by, confirmed_at FROM round_events WHERE id = $1', [dl.payload.round_event_id])).rows[0];
  assert.equal(ev.status, 'confirmed'); assert.equal(ev.confirmed_by, 'ana'); assert.ok(ev.confirmed_at);
  assert.equal((await db.query('SELECT status FROM review_queue WHERE id = $1', [dl.id])).rows[0].status, 'accepted');

  const no = await call(partner, 'POST', `/api/queue/review/${an.id}/reject`);
  assert.equal(no.status, 200); assert.equal(no.body.status, 'rejected'); assert.equal(no.body.event.status, 'dismissed');
  assert.equal((await db.query('SELECT status FROM round_events WHERE id = $1', [an.payload.round_event_id])).rows[0].status, 'dismissed');
  assert.equal((await db.query('SELECT status FROM review_queue WHERE id = $1', [an.id])).rows[0].status, 'rejected');

  assert.equal((await call(partner, 'POST', `/api/queue/review/${dl.id}/accept`)).status, 409);
  assert.equal((await call(partner, 'GET', '/api/queue/review?kind=round')).body.items.length, 0);
  // The direct form agrees: the confirmed event is on the view, the dismissed one is not.
  const v = await call(associate, 'GET', '/api/rounds?country=GB&within=3650');
  assert.deepEqual(v.body.deadlines.map((e: any) => e.id), [dl.payload.round_event_id]);
  assert.equal(v.body.proposed, 0);
});

test('W7-AC21 a direct confirm resolves the open queue row too, so the queue never shows a decided proposal', async () => {
  const r = await proposeRounds(db, [proposal('data_package', '2026-09-16', 'Data package available', 'The data package is available from 16 September 2026.')], new Date('2026-10-19T04:30:00Z'));
  const id = r.inserted[0];
  const c = await call(partner, 'POST', `/api/rounds/${id}/confirm`);
  assert.equal(c.status, 200);
  const q = (await db.query("SELECT status, resolved_by FROM review_queue WHERE kind = 'round' AND payload->>'round_event_id' = $1", [id])).rows[0];
  assert.deepEqual(q, { status: 'accepted', resolved_by: 'chris' });
  assert.equal((await call(partner, 'GET', '/api/queue/review?kind=round')).body.items.length, 0);
});
