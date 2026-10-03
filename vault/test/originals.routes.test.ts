// Wave 5, PR 2 (docs/vault-hub/wave5/05-markup.md §1.2, W5-AC2): the stored original is served only through a
// scope-checked route, inline or as a download, never cached, every view audited; earlier versions by number.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORAGE = mkdtempSync(path.join(os.tmpdir(), 'vault-originals-'));
process.env.VAULT_STORAGE_DIR = STORAGE;

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DOMAIN = 'alpha-technical-centre.com';
let db: Db;
let app: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
async function upload(a: typeof app, m: Record<string, unknown>, bytes: Uint8Array, mime: string) {
  const fd = new FormData();
  fd.append('item', JSON.stringify({ type: 'report', title: 'Guafita field report.pdf', project_id: 'orinoco-partnership', origin: { source: 'upload', external_id: 'upload:report' }, ...m }));
  fd.append('original', new Blob([bytes as any], { type: mime }), 'file.bin');
  return (await a.request('/api/items', { method: 'POST', body: fd })).json() as Promise<{ id: string; version: number }>;
}

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, JSON.parse(readFileSync(path.join(FIX, 'ac15/seed.json'), 'utf8')));
  app = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('W5-AC2: the original streams inline with its mime, as an attachment on request, never cached, and the view is audited', async () => {
  const v1 = new TextEncoder().encode('%PDF-1.4 first'), v2 = new TextEncoder().encode('%PDF-1.4 second');
  const { id } = await upload(app, {}, v1, 'application/pdf');
  const { version } = await upload(app, {}, v2, 'application/pdf');
  assert.equal(version, 2);
  const res = await app.request(`/api/items/${id}/original`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') ?? '', /^inline; filename\*=UTF-8''Guafita%20field%20report\.pdf$/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), v2);
  const dl = await app.request(`/api/items/${id}/original?download=1`);
  assert.match(dl.headers.get('content-disposition') ?? '', /^attachment; filename\*=UTF-8''/);
  const old = await app.request(`/api/items/${id}/original?version=1`);
  assert.equal(old.status, 200); assert.deepEqual(new Uint8Array(await old.arrayBuffer()), v1);
  assert.equal((await app.request(`/api/items/${id}/original?version=9`)).status, 404);
  const views = (await db.query<any>("SELECT refs, detail FROM audit_events WHERE action = 'item.view' ORDER BY id")).rows;
  assert.equal(views.length, 4, 'every attempt is audited, the missing version too');
  assert.deepEqual(views[0].refs, [`doc:${id}`]); assert.equal(views[0].detail.mode, 'inline'); assert.equal(views[0].detail.version, 2);
  assert.equal(views[1].detail.mode, 'download'); assert.equal(views[2].detail.version, 1);
});

test('W5-AC2: a hidden record, a record outside the caller\'s scope and a missing object answer as the record itself would', async () => {
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  const nda = '00000000-0000-4000-8000-000000000051';                       // a client-NDA item ana is not cleared for
  assert.equal((await ana.request(`/api/items/${nda}/original`)).status, 403);
  const { id } = await upload(app, { title: 'Gone.pdf', origin: { source: 'upload', external_id: 'upload:gone' } }, new TextEncoder().encode('bytes'), 'application/pdf');
  await db.query("UPDATE items SET storage_key = 'originals/zz/' || repeat('0', 64) WHERE id = $1", [id]);   // the store never had it (a pre-wave-5 upload)
  const missing = await app.request(`/api/items/${id}/original`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'no_original');
  await db.query('UPDATE items SET hidden = true WHERE id = $1', [id]);
  assert.equal((await app.request(`/api/items/${id}/original`)).status, 404);
  assert.equal((await app.request('/api/items/not-a-uuid/original')).status, 404);
});
