import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORAGE = mkdtempSync(path.join(os.tmpdir(), 'vault-items-'));
process.env.VAULT_STORAGE_DIR = STORAGE;

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { validate } = await import('../src/schemas.ts');
const { openStorage, filesystemStorage, supabaseStorage } = await import('../src/storage.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

let db: Db;
let app: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof app, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Minimal metadata; server-owned fields (id, created_at, content_hash, version, legal_tag) may be omitted. */
const meta = (o: Record<string, unknown> = {}) => ({ type: 'report', title: 'Report', project_id: 'orinoco-partnership', origin: { source: 'upload' }, ...o });
async function upload(a: typeof app, m: unknown, bytes?: Uint8Array | string, mime = 'application/pdf') {
  const fd = new FormData();
  fd.append('item', JSON.stringify(m));
  if (bytes !== undefined) fd.append('original', new Blob([bytes as any], { type: mime }), 'file.bin');
  return await a.request('/api/items', { method: 'POST', body: fd });
}

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('other-firm-work',NULL,'Internal work','lt-firm','{}')");
  app = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('storage: filesystem round trip, path traversal refused, supabase stub not configured, env picks the backend', async () => {
  const s = filesystemStorage(path.join(STORAGE, 'unit'));
  assert.equal(await s.exists('originals/ab/abc'), false);
  assert.equal(await s.get('originals/ab/abc'), null);
  await s.put('originals/ab/abc', new Uint8Array([1, 2, 3]), 'application/octet-stream');
  assert.equal(await s.exists('originals/ab/abc'), true);
  assert.deepEqual([...(await s.get('originals/ab/abc'))!], [1, 2, 3]);
  await assert.rejects(s.put('../escape', new Uint8Array(), 'x'), /invalid storage key/);
  await assert.rejects(s.get('/etc/passwd'), /invalid storage key/);
  await assert.rejects(supabaseStorage().put('k', new Uint8Array(), 'x'), /storage not configured/);
  await assert.rejects(openStorage({ VAULT_STORAGE: 'supabase' } as any).exists('k'), /storage not configured/);
  assert.ok(openStorage({ VAULT_STORAGE_DIR: STORAGE } as any));
});

test('POST /api/items hashes the bytes, stores them under originals/<prefix>/<hash>, and returns a valid VaultItem', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 first draft');
  const r = await upload(app, meta({ title: 'Screening report', cites: [] }), bytes);
  assert.equal(r.status, 201);
  const { id, version, deduplicated } = await r.json();
  assert.equal(version, 1); assert.equal(deduplicated, false);
  const hex = sha(bytes);
  const key = `originals/${hex.slice(0, 2)}/${hex}`;
  assert.ok(existsSync(path.join(STORAGE, key)), 'original is on disk');
  assert.deepEqual(new Uint8Array(readFileSync(path.join(STORAGE, key))), bytes);

  const item = await (await call(app, 'GET', `/api/items/${id}`)).json();
  assert.deepEqual(validate('vault-item', item), []);
  assert.equal(item.content_hash, `sha256:${hex}`);
  assert.equal(item.storage_key, key);
  assert.equal(item.mime, 'application/pdf');
  assert.equal(item.version, 1);
  assert.equal(item.client_id, 'petrolera-del-orinoco');
});

test('AC4: an item for a client project without a tag gets the project default; an explicit tag is kept; cites raise it', async () => {
  const noTag = await (await upload(app, meta({ title: 'No tag' }), 'a')).json();
  assert.equal((await (await call(app, 'GET', `/api/items/${noTag.id}`)).json()).legal_tag, 'lt-orinoco-nda-2026');

  // an explicit tag in the same project is honoured (the firm's own contract with a client is firm-tagged)
  const explicit = await (await upload(app, meta({ title: 'Firm-tagged', legal_tag: 'lt-firm' }), 'b')).json();
  assert.equal((await (await call(app, 'GET', `/api/items/${explicit.id}`)).json()).legal_tag, 'lt-firm');

  // a firm-project item that cites a client-nda document is raised to that client's tag
  const derived = await (await upload(app, meta({ title: 'Note', project_id: 'firm', legal_tag: 'lt-firm', type: 'note', cites: ['doc:00000000-0000-4000-8000-000000000054'] }), 'c')).json();
  assert.equal((await (await call(app, 'GET', `/api/items/${derived.id}`)).json()).legal_tag, 'lt-orinoco-nda-2026');

  // and never lowered on a new version
  const ext = { source: 'zoho-workdrive', external_id: 'wd-lower-1' };
  const first = await (await upload(app, meta({ project_id: 'firm', legal_tag: 'lt-firm', origin: ext, cites: ['doc:00000000-0000-4000-8000-000000000054'] }), 'v1')).json();
  await upload(app, meta({ project_id: 'firm', legal_tag: 'lt-public', origin: ext }), 'v2');
  assert.equal((await (await call(app, 'GET', `/api/items/${first.id}`)).json()).legal_tag, 'lt-orinoco-nda-2026');
});

test('version 1, then 2 when the bytes differ for the same origin.external_id; identical bytes do not add a version', async () => {
  const origin = { source: 'zoho-workdrive', external_id: 'wd-file-42' };
  const v1 = await (await upload(app, meta({ title: 'Model v1', origin, type: 'spreadsheet' }), 'bytes one')).json();
  assert.equal(v1.version, 1);
  const same = await upload(app, meta({ title: 'Model v1', origin, type: 'spreadsheet' }), 'bytes one');
  assert.equal(same.status, 200);
  assert.deepEqual(await same.json(), { id: v1.id, version: 1, deduplicated: true });
  const v2r = await upload(app, meta({ title: 'Model v2', origin, type: 'spreadsheet' }), 'bytes two');
  assert.equal(v2r.status, 201);
  const v2 = await v2r.json();
  assert.deepEqual(v2, { id: v1.id, version: 2, deduplicated: false });

  const item = await (await call(app, 'GET', `/api/items/${v1.id}`)).json();
  assert.equal(item.version, 2); assert.equal(item.title, 'Model v2');
  assert.equal(item.content_hash, `sha256:${sha('bytes two')}`);
  const versions = await (await call(app, 'GET', `/api/items/${v1.id}/versions`)).json();
  assert.equal(versions.item_id, v1.id);
  assert.deepEqual(versions.versions.map((v: any) => [v.version, v.content_hash]), [[2, `sha256:${sha('bytes two')}`], [1, `sha256:${sha('bytes one')}`]]);
  // both originals are still in storage
  for (const t of ['bytes one', 'bytes two']) assert.ok(existsSync(path.join(STORAGE, 'originals', sha(t).slice(0, 2), sha(t))));
  // the same external id in another project is a separate item
  const other = await (await upload(app, meta({ project_id: 'firm', origin, type: 'spreadsheet' }), 'bytes one')).json();
  assert.notEqual(other.id, v1.id);
});

test('AC1 for items: schema failures are 400 with a JSON path; hash mismatch and malformed bodies too', async () => {
  let r = await upload(app, meta({ type: 'not-a-type' }), 'x');
  assert.equal(r.status, 400); assert.equal((await r.json()).error.path, '/type');
  const noTitle: any = meta(); delete noTitle.title;
  r = await upload(app, noTitle, 'x');
  assert.equal(r.status, 400); assert.equal((await r.json()).error.path, '/title');
  r = await upload(app, meta({ content_hash: 'sha256:' + '0'.repeat(64) }), 'x');
  assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'hash_mismatch');
  r = await upload(app, meta({ project_id: 'no-such-project' }), 'x');
  assert.equal(r.status, 400); assert.equal((await r.json()).error.path, '/project_id');
  r = await upload(app, meta({ client_id: 'someone-else' }), 'x');
  assert.equal(r.status, 400); assert.equal((await r.json()).error.path, '/client_id');
  r = await app.request('/api/items', { method: 'POST', body: new FormData() });
  assert.equal(r.status, 400);
  r = await app.request('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'nope' });
  assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'invalid_json');
});

test('metadata-only JSON items (bytes held elsewhere) are accepted when they carry a content_hash', async () => {
  const h = 'sha256:' + sha('held elsewhere');
  const r = await call(app, 'POST', '/api/items', meta({ content_hash: h, type: 'email', origin: { source: 'gmail', external_id: '<msg-1@example>' } }));
  assert.equal(r.status, 201);
  const item = await (await call(app, 'GET', `/api/items/${(await r.json()).id}`)).json();
  assert.equal(item.storage_key, null);
  assert.deepEqual(validate('vault-item', item), []);
  assert.equal((await call(app, 'POST', '/api/items', meta())).status, 400);   // no bytes and no hash
});

test('AC3: PUT, PATCH and DELETE on an item or a version are 409', async () => {
  const { id } = await (await upload(app, meta({ title: 'Immutable' }), 'imm')).json();
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    for (const url of [`/api/items/${id}`, `/api/items/${id}/versions/1`]) {
      const r = await call(app, method, url, { title: 'x' });
      assert.equal(r.status, 409, `${method} ${url}`);
      assert.equal((await r.json()).error.code, 'immutable');
    }
  }
  assert.equal((await (await call(app, 'GET', `/api/items/${id}`)).json()).title, 'Immutable');
});

test('list filters (project, type, organisation, since), 404s, hide', async () => {
  const ids = async (qs: string) => (await (await call(app, 'GET', `/api/items?${qs}`)).json()).items.map((i: any) => i.id);
  const inv = await (await upload(app, meta({ type: 'invoice', title: 'Invoice 7', project_id: 'other-firm-work', organisation_ids: ['acme'], created_at: '2026-09-01T00:00:00Z' }), 'inv')).json();
  assert.deepEqual(await ids('project=other-firm-work'), [inv.id]);
  assert.deepEqual(await ids('project=other-firm-work&type=invoice'), [inv.id]);
  assert.deepEqual(await ids('project=other-firm-work&type=letter'), []);
  assert.deepEqual(await ids('organisation=acme'), [inv.id]);
  assert.deepEqual(await ids('project=other-firm-work&since=2026-09-02'), []);
  const fixtureItems = await ids('project=orinoco-partnership&type=nda');
  assert.deepEqual(fixtureItems, ['00000000-0000-4000-8000-000000000053']);
  assert.equal((await call(app, 'GET', `/api/items/${randomUUID()}`)).status, 404);
  assert.equal((await call(app, 'GET', '/api/items/abc')).status, 404);
  assert.equal((await call(app, 'POST', `/api/items/${inv.id}/hide`)).status, 200);
  assert.deepEqual(await ids('project=other-firm-work'), []);
  assert.equal((await call(app, 'GET', `/api/items/${inv.id}`)).status, 404);
});

test('scope on items: an associate outside the project gets 403 on client-nda items and cannot list them', async () => {
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  const nda = '00000000-0000-4000-8000-000000000051';
  const denied = await call(ana, 'GET', `/api/items/${nda}`);
  assert.equal(denied.status, 403);
  assert.equal((await call(ana, 'GET', `/api/items/${nda}/versions`)).status, 403);
  assert.deepEqual((await (await call(ana, 'GET', '/api/items?project=orinoco-partnership')).json()).items.map((i: any) => i.id).filter((id: string) => id === nda), []);
  assert.equal((await upload(ana, meta({ title: 'Sneaky' }), 'x')).status, 403);
  // the NDA itself carries lt-firm, so any associate can read it
  assert.equal((await call(ana, 'GET', '/api/items/00000000-0000-4000-8000-000000000053')).status, 200);
  // membership opens the project
  await db.query("UPDATE projects SET members = '{ana.perez}' WHERE id = 'orinoco-partnership'");
  assert.equal((await call(ana, 'GET', `/api/items/${nda}`)).status, 200);
  assert.equal((await upload(ana, meta({ title: 'Now allowed' }), 'y')).status, 201);
  await db.query("UPDATE projects SET members = '{}' WHERE id = 'orinoco-partnership'");
  // an expired tag hides the item from everyone
  await db.query("UPDATE legal_tags SET expires_at = '2026-01-01' WHERE id = 'lt-orinoco-nda-2026'");
  assert.equal((await call(app, 'GET', `/api/items/${nda}`)).status, 404);
  await db.query("UPDATE legal_tags SET expires_at = '2028-02-13' WHERE id = 'lt-orinoco-nda-2026'");
});
