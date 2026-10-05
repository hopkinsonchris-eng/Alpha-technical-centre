// Wave 7 PR3 (W7-AC16, 03-data-hierarchy.md A8 and H7): "Create a project from this" on a filing-queue row creates the
// project with the sender's country and organisation, origin_ref the message, a holder row, status prospect, and files the
// row through the assign route; an associate cannot; a second call finds the row already assigned; an unknown sender refuses
// until an organisation is named.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serviceSink } from '../src/ingest/items-client.ts';
import { captureMessage, type CaptureDeps } from '../src/ingest/mail/capture.ts';
import type { RawMessage } from '../src/ingest/mail/types.ts';
import { setup, type Harness, DOMAIN } from './fixtures/ingest/harness.ts';
import { seedMailProjects } from './fixtures/mail/seed.ts';
import { createApp } from '../src/app.ts';
import { subjectToName, slugOf } from '../src/api/queue.create-project.routes.ts';

let h: Harness; let deps: CaptureDeps;
before(async () => {
  h = await setup('vault-qcreate-'); await seedMailProjects(h.db);
  deps = { sink: await serviceSink(h.db), ingest: null, origin: 'zoho-mail' };
  await h.db.query(`INSERT INTO organisations (id, name, kind, country, identifiers) VALUES ('andino-labs', 'Andino Labs S.A.S.', 'operator', 'CO', '{"domains":["andinolabs.co"]}'::jsonb) ON CONFLICT DO NOTHING`);
  await h.db.query(`INSERT INTO people (id, email, name, role) VALUES ('ana', 'ana@${DOMAIN}', 'Ana', 'associate') ON CONFLICT DO NOTHING`);
});
after(async () => { await h.db.close(); });
const CHRIS = `chris@${DOMAIN}`;
let seq = 0;
const mk = (from: string, subject: string, name?: string): RawMessage => { const id = `c${++seq}@create.fixture`; return { mailbox: CHRIS, external_id: id, thread_id: id, in_reply_to: null, references: [], from: { address: from, ...(name ? { name } : {}) }, to: [{ address: CHRIS }], cc: [], subject, date: new Date(Date.UTC(2026, 9, 1, 9, 0, seq)).toISOString(), text: 'Please see the attached request.', attachments: [], labels: [], folder: 'inbox' }; };
const api = async (method: string, url: string, body?: unknown, app = h.app) => { const res = await app.request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }); return { status: res.status, body: (await res.json()) as any }; };
const queueRowFor = async (itemId: string) => (await h.db.query<any>('SELECT id, status FROM filing_queue WHERE item_id = $1', [itemId])).rows[0];

test('the name and id come from the subject', () => {
  assert.equal(subjectToName('RE: Fwd: Cubiro water injection data request'), 'Cubiro water injection data request');
  assert.equal(subjectToName('[EXT] Re: Lote X farm-in'), 'Lote X farm-in');
  assert.equal(slugOf('Cubiro water injection data request'), 'cubiro-water-injection-data-request');
  assert.equal(slugOf('Señal · Apuré 2026'), 'senal-apure-2026');
});

test('W7-AC16: a partner creates the project from the row: sender country and organisation, origin_ref the message, holder row, prospect, and the row is filed', async () => {
  const cap = await captureMessage(h.db, h.storage, mk('jorge.salazar@andinolabs.co', 'RE: Cubiro water injection data request', 'Jorge Salazar'), deps);
  assert.ok(cap.item_id);
  const row = await queueRowFor(cap.item_id!);
  assert.ok(row && row.status === 'open', 'the message waits in the filing queue');

  const r = await api('POST', `/api/queue/filing/${row.id}/create-project`, {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = r.body.project;
  assert.equal(p.id, 'cubiro-water-injection-data-request');
  assert.equal(p.name, 'Cubiro water injection data request');
  assert.equal(p.status, 'prospect');
  assert.equal(p.country, 'CO');
  assert.equal(p.origin_ref, `doc:${cap.item_id}`);
  assert.equal(p.register.holder, 'Andino Labs S.A.S.');
  assert.equal(p.default_legal_tag, 'lt-firm');
  assert.ok(p.stage_changed_at, 'the stage age starts now');
  assert.deepEqual(p.organisations, [{ organisation_id: 'andino-labs', name: 'Andino Labs S.A.S.', role: 'holder' }]);
  assert.equal(r.body.assigned.status, 'assigned');
  assert.equal(r.body.assigned.project_id, p.id);
  // The database agrees: the row is assigned, the item moved, the holder row exists, the sender is a contact of the project.
  assert.equal((await queueRowFor(cap.item_id!)).status, 'assigned');
  const item = (await h.db.query<any>('SELECT project_id, extracted FROM items WHERE id = $1', [cap.item_id])).rows[0];
  assert.equal(item.project_id, p.id); assert.equal(item.extracted.status, 'filed');
  const orgs = (await h.db.query<any>('SELECT organisation_id, role FROM project_organisations WHERE project_id = $1', [p.id])).rows;
  assert.deepEqual(orgs, [{ organisation_id: 'andino-labs', role: 'holder' }]);
  assert.ok(p.contacts.length >= 1, 'the sender joined the project contacts through the assign route');
  // One audit event for the creation, one for the assign it delegated to.
  const audits = (await h.db.query<any>(`SELECT action, detail FROM audit_events WHERE action IN ('queue.filing.create_project', 'queue.filing.assign') ORDER BY id`)).rows;
  assert.deepEqual(audits.map(a => a.action), ['queue.filing.assign', 'queue.filing.create_project']);
  assert.equal(audits[1].detail.project, p.id);
  // The project reads back through the normal route, with its origin.
  const got = await api('GET', `/api/projects/${p.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.status, 'prospect');
  // A second call: the row is no longer open.
  const again = await api('POST', `/api/queue/filing/${row.id}/create-project`, { id: 'another-id' });
  assert.equal(again.status, 409);
});

test('W7-AC16: an associate cannot; an unknown sender refuses until an organisation is named; the body overrides name, id and country', async () => {
  const ana = await createApp({ db: h.db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
  const cap = await captureMessage(h.db, h.storage, mk('someone@unknown-domain.example', 'Farm-in offer, Lote X'), deps);
  const row = await queueRowFor(cap.item_id!);
  assert.ok(row && row.status === 'open');
  const denied = await api('POST', `/api/queue/filing/${row.id}/create-project`, {}, ana);
  assert.equal(denied.status, 403);
  const unknown = await api('POST', `/api/queue/filing/${row.id}/create-project`, {});
  assert.equal(unknown.status, 409);
  assert.equal(unknown.body.error.code, 'unknown_organisation');
  assert.equal((await queueRowFor(cap.item_id!)).status, 'open', 'nothing was created or filed');
  assert.equal((await h.db.query('SELECT 1 FROM projects WHERE id = $1', ['farm-in-offer-lote-x'])).rows.length, 0);
  const made = await api('POST', `/api/queue/filing/${row.id}/create-project`, { organisation_id: 'andino-labs', name: 'Lote X farm-in', id: 'lote-x-farm-in', country: 'PE' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.project.id, 'lote-x-farm-in');
  assert.equal(made.body.project.name, 'Lote X farm-in');
  assert.equal(made.body.project.country, 'PE');
  assert.equal(made.body.project.register.holder, 'Andino Labs S.A.S.');
  assert.equal((await queueRowFor(cap.item_id!)).status, 'assigned');
  const bogus = await api('POST', `/api/queue/filing/${row.id}/create-project`, { organisation_id: 'nobody' });
  assert.equal(bogus.status, 409, 'the row is assigned now, so the second call conflicts before anything else');
  const missing = await api('POST', '/api/queue/filing/00000000-0000-4000-8000-000000000000/create-project', {});
  assert.equal(missing.status, 404);
});
