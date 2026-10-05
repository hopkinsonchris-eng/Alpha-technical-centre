// Wave 7 PR1 (docs/vault-hub/wave7/05-markup.md §1.3, S14): archiving a project remembers the status it
// had in register.status_before_archive; restoring it puts that status back and clears the note. An
// Active project that is archived and restored comes back Active, never Prospect.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-archive-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const DOMAIN = 'alpha-technical-centre.com';
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,members,register) VALUES ('arc-active',NULL,'Active one','active','lt-firm','{chris}','{\"source\":\"Alpha\"}'::jsonb)");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,members,closed_at) VALUES ('arc-closed',NULL,'Closed one','closed','lt-firm','{chris}', now())");
  partner = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('S14: archive writes register.status_before_archive; restore returns the status it had and clears the note', async () => {
  const a = await json(await call(partner, 'PATCH', '/api/projects/arc-active', { status: 'archived' }));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.status, 'archived');
  assert.equal(a.body.register.status_before_archive, 'active');
  assert.equal(a.body.register.source, 'Alpha');                    // the rest of the register survives
  const restoreTo = a.body.register.status_before_archive;
  const r = await json(await call(partner, 'PATCH', '/api/projects/arc-active', { status: restoreTo }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.register.status_before_archive, undefined);
  assert.equal(r.body.register.source, 'Alpha');
});

test('S14: a closed project archived and restored comes back closed; archiving twice keeps the first status', async () => {
  const a = await json(await call(partner, 'PATCH', '/api/projects/arc-closed', { status: 'archived' }));
  assert.equal(a.body.register.status_before_archive, 'closed');
  const again = await json(await call(partner, 'PATCH', '/api/projects/arc-closed', { status: 'archived', register: { owner: 'Tom' } }));
  assert.equal(again.body.register.status_before_archive, 'closed');
  assert.equal(again.body.register.owner, 'Tom');
  const r = await json(await call(partner, 'PATCH', '/api/projects/arc-closed', { status: 'closed' }));
  assert.equal(r.body.status, 'closed');
  assert.equal(r.body.register.status_before_archive, undefined);
});
