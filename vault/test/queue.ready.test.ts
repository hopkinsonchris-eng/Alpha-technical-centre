// Wave 6, PR 3 (W6-AC5 ready and decisions): the filing queue groups rows by status and files every ready row in one call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serviceSink } from '../src/ingest/items-client.ts';
import { captureMessage, type CaptureDeps } from '../src/ingest/mail/capture.ts';
import type { RawMessage } from '../src/ingest/mail/types.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import { seedMailProjects } from './fixtures/mail/seed.ts';

let h: Harness; let deps: CaptureDeps;
before(async () => { h = await setup('vault-qready-'); await seedMailProjects(h.db); deps = { sink: await serviceSink(h.db), ingest: null, origin: 'zoho-mail' }; });
after(async () => { await h.db.close(); });
const CHRIS = 'chris@alpha-technical-centre.com';
let seq = 0;
const mk = (from: string, subject: string, text = 'Hello.'): RawMessage => { const id = `q${++seq}@ready.fixture`; return { mailbox: CHRIS, external_id: id, thread_id: id, in_reply_to: null, references: [], from: { address: from }, to: [{ address: CHRIS }], cc: [], subject, date: new Date(Date.UTC(2026, 3, 1, 9, 0, seq)).toISOString(), text, attachments: [], labels: [], folder: 'inbox' }; };
const api = async (method: string, url: string, body?: unknown) => { const res = await h.app.request(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }); return { status: res.status, body: (await res.json()) as any }; };

test('W6-AC5: rows carry their group; Accept all files only the ready rows to their suggestion, writes a decision per row and leaves the rest', async () => {
  await h.db.query(`INSERT INTO contacts (id, organisation_id, name, emails) VALUES ('ana-frontera', 'frontera-energy', 'Ana F.', '{afront@fronteraenergy.com}') ON CONFLICT DO NOTHING`);
  const ready1 = await captureMessage(h.db, h.storage, mk('afront@fronteraenergy.com', 'Cubiro pressures', 'Monthly pressures for Cubiro.'), deps);
  const ready2 = await captureMessage(h.db, h.storage, mk('afront@fronteraenergy.com', 'Castilla injection', 'Injection at Castilla.'), deps);
  const review = await captureMessage(h.db, h.storage, mk('tech@vendor-x.example', 'Service offer'), deps);
  assert.deepEqual([ready1.outcome, ready2.outcome, review.outcome], ['ready', 'ready', 'review']);
  const list = await api('GET', '/api/queue/filing');
  assert.equal(list.status, 200);
  const groups = Object.fromEntries(list.body.items.map((i: any) => [i.item_id, i.group]));
  assert.equal(groups[ready1.item_id!], 'ready'); assert.equal(groups[ready2.item_id!], 'ready'); assert.equal(groups[review.item_id!], 'review');
  const r = await api('POST', '/api/queue/filing/accept-ready', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.filed.map((f: any) => f.item_id).sort(), [ready1.item_id, ready2.item_id].sort());
  assert.ok(r.body.filed.every((f: any) => f.project_id === 'llanos-waterflood'));
  assert.deepEqual(r.body.skipped, []);
  const after = await api('GET', '/api/queue/filing');
  assert.deepEqual(after.body.items.map((i: any) => i.item_id), [review.item_id]);
  const items = (await h.db.query<any>('SELECT id, project_id, extracted FROM items WHERE id = ANY($1::uuid[])', [[ready1.item_id, ready2.item_id]])).rows;
  assert.ok(items.every(i => i.project_id === 'llanos-waterflood' && i.extracted.status === 'filed'));
  const decisions = (await h.db.query<any>(`SELECT key_kind, project_id FROM filing_decisions ORDER BY decided_at`)).rows;
  assert.ok(decisions.length >= 2 && decisions.every(d => d.project_id === 'llanos-waterflood'));
  assert.ok(decisions.some(d => d.key_kind === 'thread') && decisions.some(d => d.key_kind === 'domain'));
  const audits = (await h.db.query<any>(`SELECT detail FROM audit_events WHERE action = 'queue.filing.accept_ready' ORDER BY id`)).rows.map(r => r.detail);
  assert.deepEqual(audits.map(a => a.filed), [2], JSON.stringify(audits));
  // A second call has nothing to do; ids restrict the call.
  const again = await api('POST', '/api/queue/filing/accept-ready', { ids: [] });
  assert.deepEqual(again.body, { filed: [], skipped: [] });
  // A dismissal teaches the memory too.
  const row = after.body.items[0];
  const d = await api('POST', `/api/queue/filing/${row.id}/dismiss`, {});
  assert.equal(d.status, 200);
  assert.deepEqual((await h.db.query<any>(`SELECT key_kind FROM filing_decisions WHERE project_id IS NULL AND item_id = $1 ORDER BY key_kind`, [review.item_id])).rows.map(r => r.key_kind), ['domain', 'thread']);
  assert.equal((await h.db.query<any>(`SELECT extracted->>'status' AS s FROM items WHERE id = $1`, [review.item_id])).rows[0].s, 'dismissed');
});
