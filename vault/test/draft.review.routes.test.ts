// Wave 5, PR 3 (docs/vault-hub/wave5/05-markup.md §1.3, W5-AC4, AC5, AC7): the project's contacts for the
// recipient picker, the review record on a draft, the dispatch that marks it sent, and a render that leaves
// dropped paragraphs out. The drafting itself is covered in draft.routes.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureDraft } from '../src/api/draft.routes.ts';
import { FakeProvider } from '../src/llm/provider.ts';

const DOMAIN = 'alpha-technical-centre.com';
const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const json = (b: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

async function setup() {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("UPDATE projects SET members = '{chris}', register = '{\"holder\":\"Petrolera del Orinoco\",\"government\":\"MinPetróleo\",\"partners\":[\"Chevron Venezuela\"]}'::jsonb WHERE id = 'orinoco-partnership'");
  const provider = new FakeProvider(() => 'First paragraph, no figures.\n\nSecond paragraph names the Apure field and nothing numeric.\n\nThird paragraph, a closing line.');
  configureDraft({ provider, search: {} });
  const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` }, version: 'test' });
  const ana = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` }, version: 'test' });
  return { db, app, ana };
}

test('W5-AC4: the project contacts carry role, organisation, last contact and whether the organisation is a counterparty; the register names without a contact are offered', async () => {
  const { db, app, ana } = await setup();
  const r = await app.request('/api/projects/orinoco-partnership/contacts');
  assert.equal(r.status, 200);
  const b: any = await r.json();
  const maria = b.contacts.find((c: any) => c.id === 'maria-fernandez');
  assert.ok(maria, JSON.stringify(b.contacts.map((c: any) => c.id)));
  assert.equal(maria.organisation.id, 'petrolera-del-orinoco'); assert.equal(maria.organisation.counterparty, 'holder', 'the client is also the register holder');
  assert.match(maria.last_contact ?? '', /^2026-/);
  assert.deepEqual(b.counterparties.map((c: any) => [c.kind, c.name, c.organisation_id]), [['holder', 'Petrolera del Orinoco', 'petrolera-del-orinoco'], ['government', 'MinPetróleo', null], ['partner', 'Chevron Venezuela', null]]);
  assert.equal((await ana.request('/api/projects/orinoco-partnership/contacts')).status, 404, 'an outsider sees no contacts: the project is invisible to her, as everywhere in the Hub');
  await db.close();
});

test('W5-AC5/AC7: review decisions are recorded on the draft, a dropped paragraph leaves the render, mark as sent files one dispatch and freezes the note', async () => {
  const { db, app, ana } = await setup();
  const d: any = await (await app.request('/api/draft', json({ kind: 'email', project_id: 'orinoco-partnership', organisation_id: 'petrolera-del-orinoco', brief: 'Send the screening result and ask for the data room index.' }))).json();
  assert.equal(d.paragraphs.length, 3, JSON.stringify(d));
  // Review: keep, keep with a note, drop.
  const rv = await app.request(`/api/items/${d.id}/review`, json({ decisions: ['keep', 'keep-note', 'drop'], notes: { 1: 'check the unit' }, citations_opened: 1, review_seconds: 42 }, 'PATCH'));
  assert.equal(rv.status, 200, await rv.text());
  const stored = (await db.query<any>("SELECT extracted->'review' AS review FROM items WHERE id = $1", [d.id])).rows[0].review;
  assert.deepEqual(stored.decisions, ['keep', 'keep-note', 'drop']); assert.equal(stored.notes['1'], 'check the unit'); assert.equal(stored.by, 'chris'); assert.equal(stored.citations_opened, 1);
  assert.equal((await app.request(`/api/items/${d.id}/review`, json({ decisions: ['keep', 'maybe', 'drop'] }, 'PATCH'))).status, 400);
  assert.equal((await app.request(`/api/items/${d.id}/review`, json({ decisions: ['keep'] }, 'PATCH'))).status, 400, 'one decision per paragraph');
  assert.equal((await ana.request(`/api/items/${d.id}/review`, json({ decisions: ['keep', 'keep', 'keep'] }, 'PATCH'))).status, 403);
  // Render leaves the dropped paragraph out.
  const h: any = await (await app.request('/api/render', json({ draft_id: d.id }))).json();
  assert.ok(h.html.includes('First paragraph') && h.html.includes('Apure field') && !h.html.includes('closing line'), h.html.slice(0, 400));
  // Mark as sent.
  const s = await app.request(`/api/items/${d.id}/sent`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'], channel: 'email' }));
  assert.equal(s.status, 201);
  const sb: any = await s.json();
  assert.equal(sb.direction, 'out'); assert.equal(sb.signed_by, 'chris'); assert.deepEqual(sb.contact_ids, ['maria-fernandez']);
  const note = (await db.query<any>("SELECT extracted->'sent' AS sent FROM items WHERE id = $1", [d.id])).rows[0].sent;
  assert.equal(note.dispatch_id, sb.id); assert.equal(note.to[0], 'maria-fernandez');
  assert.equal((await app.request(`/api/items/${d.id}/sent`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: [], channel: 'email' }))).status, 409, 'sent once');
  assert.equal((await app.request(`/api/items/${d.id}/review`, json({ decisions: ['keep', 'keep', 'keep'] }, 'PATCH'))).status, 409, 'a sent draft is frozen');
  assert.equal((await app.request(`/api/items/${d.id}/sent`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['nobody'], channel: 'email' }))).status, 409);
  assert.equal((await app.request('/api/items/00000000-0000-4000-8000-000000000056/sent', json({ organisation_id: 'petrolera-del-orinoco', contact_ids: [], channel: 'carrier-pigeon' }))).status, 400);
  const tl: any = await (await app.request('/api/projects/orinoco-partnership/timeline')).json();
  const e = tl.entries.find((x: any) => x.id === d.id);
  assert.ok(e && e.sent && e.sent.organisation === 'Petrolera del Orinoco S.A.', 'the timeline entry says it was sent: ' + JSON.stringify(e));
  await db.close();
});
