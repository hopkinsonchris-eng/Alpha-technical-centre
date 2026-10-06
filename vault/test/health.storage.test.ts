// The file store is checked at boot and on GET /api/health: a bucket that does not exist used to show up only as
// "unreachable" sources at the first pack build. `ok` stays the platform's probe; `storage` is the owner's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import type { StorageCheck } from '../src/storage.ts';

const auth = { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' };

test('GET /api/health carries the store check, stays ok for the platform probe when the store is down, and omits it when no check is wired', async () => {
  const db = await openDb(undefined); await migrate(db);
  const down: StorageCheck = { ok: false, kind: 'supabase', bucket: 'vault', error: 'bucket "vault" does not exist in the Supabase project: create it under Storage, private, with that exact name, or set VAULT_STORAGE_BUCKET to the bucket that exists (vault/SETUP.md §1.5)', checked_at: '2026-10-06T12:00:00.000Z' };
  const app = await createApp({ db, auth, storageCheck: async () => down });
  const r = await app.request('/api/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true, 'the probe stays green: the database is up and reads work');
  assert.deepEqual(j.storage, down);
  const plain = await createApp({ db, auth });
  assert.equal((await (await plain.request('/api/health')).json()).storage, undefined);
  const throwing = await createApp({ db, auth, storageCheck: async () => { throw new Error('boom'); } });
  const t = await (await throwing.request('/api/health')).json();
  assert.equal(t.ok, true); assert.equal(t.storage.ok, false); assert.match(t.storage.error, /boom/);
  await db.close();
});
