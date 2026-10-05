// Wave 7, PR 1 (docs/vault-hub/wave7/05-markup.md §1.6, S19): without a drafting provider POST /api/draft
// refuses with the same clear shape Brief this country uses, saves nothing and names no server variable;
// with one it drafts and says which model did. The drafter itself refuses too, so no caller gets a
// silent template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureDraft } from '../src/api/draft.routes.ts';
import { draft, NoProviderError } from '../src/llm/draft.ts';
import { FakeProvider } from '../src/llm/provider.ts';
import type { Person } from '../src/auth.ts';

const AUTH = { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' };
const PARTNER: Person = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris', role: 'partner' };
const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const json = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const BODY = { kind: 'letter', project_id: 'orinoco-partnership', organisation_id: 'petrolera-del-orinoco', brief: 'Propose the scope of a joint technical evaluation.' };

async function setup(provider: FakeProvider | null) {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'orinoco-partnership'");
  configureDraft({ provider, search: {} });
  return { db, app: await createApp({ db, auth: AUTH, version: 'test' }) };
}

test('S19: POST /api/draft without a provider is 503 not_configured, saves no note and names no server variable', async () => {
  const { db, app } = await setup(null);
  const r = await app.request('/api/draft', json(BODY));
  const b: any = await r.json();
  assert.equal(r.status, 503, JSON.stringify(b));
  assert.equal(b.error.code, 'not_configured');
  assert.match(b.error.message, /drafting assistant is not connected/);
  assert.ok(!/[A-Z]{3,}_[A-Z_]+|SETUP\.md|\.ts\b/.test(b.error.message), 'no variable, file or module names: ' + b.error.message);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM items WHERE extracted->>'kind' = 'draft'")).rows[0].n, 0, 'no template was filed');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'llm.draft'")).rows[0].n, 0);
  // Validation still comes first: a bad request is 400 whether or not the provider is there.
  assert.equal((await app.request('/api/draft', json({ ...BODY, kind: 'memo' }))).status, 400);
  await db.close();
});

test('S19: the drafter refuses without a provider; with one the result says which model drafted', async () => {
  const { db } = await setup(null);
  await assert.rejects(draft(db, PARTNER, { kind: 'email', project_id: 'orinoco-partnership', brief: 'Chase the data room index.', organisation_id: 'petrolera-del-orinoco' }, null, {}),
    (e: any) => e instanceof NoProviderError && e.status === 503 && e.code === 'not_configured');
  const r = await draft(db, PARTNER, { kind: 'email', project_id: 'orinoco-partnership', brief: 'Chase the data room index.', organisation_id: 'petrolera-del-orinoco' }, new FakeProvider(() => 'Thank you for the index.'), {});
  assert.ok(r.model, 'the model that drafted is named so the Hub knows a provider drafted');
  assert.equal(r.draft, 'Thank you for the index.');
  await db.close();
});

test('S19: with a provider POST /api/draft is 201 and the saved note records the model', async () => {
  const { db, app } = await setup(new FakeProvider(() => 'We propose a joint evaluation.\n\nWe would welcome a call.'));
  const r = await app.request('/api/draft', json(BODY));
  const b: any = await r.json();
  assert.equal(r.status, 201, JSON.stringify(b));
  assert.ok(b.model);
  const note = (await db.query<any>("SELECT extracted FROM items WHERE id = $1", [b.id])).rows[0];
  assert.equal(note.extracted.explanation_source, 'llm'); assert.equal(note.extracted.model, b.model);
  await db.close();
});
