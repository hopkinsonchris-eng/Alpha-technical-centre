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
import { findChromium } from '../src/rerun/runner.ts';

const AUTH = { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' };
const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const json = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

async function setup(provider: FakeProvider | null) {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'orinoco-partnership'");
  configureDraft({ provider, search: {} });
  return { db, app: await createApp({ db, auth: AUTH, version: 'test' }) };
}

test('POST /api/draft validates, drafts a letter with citations, saves it as a note that cites its sources', async () => {
  const provider = new FakeProvider((req) => {
    const nda = /nda "[^"]+" [^\[]*\[doc:([0-9a-f-]{36})\]/.exec(req.messages[0].content)![1];
    return `Further to our clarification letter of 8 July 2026 (ATC-2026-0131) [doc:00000000-0000-4000-8000-000000000056], we propose a joint evaluation under the NDA in force until 13 February 2028 [doc:${nda}].\n\nWe would welcome a call in October.`;
  });
  const { db, app } = await setup(provider);
  assert.equal((await app.request('/api/draft', json({ kind: 'memo', project_id: 'orinoco-partnership', brief: 'x' }))).status, 400);
  assert.equal((await app.request('/api/draft', json({ kind: 'letter', project_id: 'nope', brief: 'Propose the scope.' }))).status, 400);
  const r = await app.request('/api/draft', json({ kind: 'letter', project_id: 'orinoco-partnership', organisation_id: 'petrolera-del-orinoco', brief: 'Propose the scope of a joint technical evaluation.' }));
  const b: any = await r.json();
  assert.equal(r.status, 201, JSON.stringify(b));
  assert.ok(b.id && b.draft.includes('[doc:'));
  assert.equal(b.citations.length, 2);
  assert.equal(b.context.dispatches.length, 6);
  assert.equal(b.context.contracts[0].expiry, '2028-02-13');
  const cites = (await db.query('SELECT ref FROM item_cites WHERE item_id = $1 ORDER BY ref', [b.id])).rows.map((x: any) => x.ref);
  assert.deepEqual(cites, [...b.citations].sort());
  const note = (await db.query("SELECT type, extracted->>'kind' AS kind FROM items WHERE id = $1", [b.id])).rows[0];
  assert.equal(note.type, 'note'); assert.equal(note.kind, 'draft');
  const usage = (await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'llm.draft'")).rows[0].n;
  assert.equal(usage, 1);

  // Render the saved draft: HTML, then DOCX; a reference number is reserved once and reused.
  const h = await app.request('/api/render', json({ draft_id: b.id, subject: 'Proposed scope' }));
  assert.equal(h.status, 200);
  const hj: any = await h.json();
  assert.match(hj.reference_no, /^ATC-\d{4}-\d{4}$/);
  assert.ok(hj.html.includes('Petrolera del Orinoco S.A.') && hj.html.includes('ATC-2026-0131') && !hj.html.includes('[doc:'));
  const d = await app.request('/api/render?format=docx', json({ draft_id: b.id }));
  assert.equal(d.status, 200); assert.equal(d.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const bytes = Buffer.from(await d.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK'); assert.ok(bytes.length > 20_000);
  const again: any = await (await app.request('/api/render', json({ draft_id: b.id }))).json();
  assert.equal(again.reference_no, hj.reference_no, 'reference reserved once');
  if (findChromium()) {
    const p = await app.request('/api/render?format=pdf', json({ draft_id: b.id }));
    assert.equal(p.status, 200); assert.equal(Buffer.from(await p.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  }
  await db.close();
});

test('POST /api/llm is 501 without a provider, scoped and audited with one', async () => {
  let { db, app } = await setup(null);
  assert.equal((await app.request('/api/llm', json({ purpose: 'simulator-advice', scope: 'project:orinoco-partnership', messages: [{ role: 'user', content: 'hi' }] }))).status, 501);
  await db.close();
  ({ db, app } = await setup(new FakeProvider(() => 'Advice.')));
  assert.equal((await app.request('/api/llm', json({ purpose: 'x', scope: 'galaxy:1', messages: [{ role: 'user', content: 'hi' }] }))).status, 400);
  assert.equal((await app.request('/api/llm', json({ purpose: 'x', scope: 'project:orinoco-partnership', messages: [] }))).status, 400);
  const r = await app.request('/api/llm', json({ purpose: 'simulator-advice', scope: 'project:orinoco-partnership', messages: [{ role: 'user', content: 'Explain the ensemble.' }] }));
  assert.equal(r.status, 200);
  const j: any = await r.json(); assert.equal(j.text, 'Advice.'); assert.ok(j.usage.output > 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'llm.tool'")).rows[0].n, 1);
  await db.close();
});

test('an associate outside the project gets 403 from /api/draft', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  configureDraft({ provider: null, search: {} });
  const app = await createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'ana@alpha-technical-centre.com' }, version: 'test' });
  const r = await app.request('/api/draft', json({ kind: 'email', project_id: 'orinoco-partnership', brief: 'Chase the data room.' }));
  assert.equal(r.status, 403);
  await db.close();
});
