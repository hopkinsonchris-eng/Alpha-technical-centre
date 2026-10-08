// Wave 8 PR 2 (docs/vault-hub/wave8/02-files-and-picker.md, W8-AC9, W8-AC14): GET /api/projects/:id/files lists a
// project's documents with the folder each came from, for the Files tab and the tools' picker. Every row passed
// canSee; hidden rows are absent; a project outside the caller's scope is 404; no storage key reaches the client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-files-'));

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const PID = 'files-demo';

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let member: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const get = (a: typeof partner, url: string) => a.request(url, { headers: { accept: 'application/json' } });

async function file(a: typeof partner, m: Record<string, unknown>, bytes: string, mime = 'application/pdf') {
  const fd = new FormData();
  fd.append('item', JSON.stringify({ project_id: PID, ...m }));
  fd.append('original', new Blob([bytes], { type: mime }), String(m.title));
  const r = await a.request('/api/items', { method: 'POST', body: fd });
  const text = await r.text();
  assert.ok(r.status === 201 || r.status === 200, `${m.title}: ${r.status} ${text}`);
  return JSON.parse(text) as { id: string; version: number };
}
const wd = (name: string, folder: string, extra: Record<string, unknown> = {}) => ({
  type: 'report', title: name, origin: { source: 'zoho-workdrive', external_id: `wd:${name}` },
  filing: { method: 'path', confidence: 1, confirmed_by: null },
  extracted: { filename: name, workdrive: { path: folder, size: 1234, modified_ms: 1791371482525 } }, ...extra,
});

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag, members, country) VALUES ($1, NULL, 'Files demo', 'prospect', 'lt-firm', '{ana.perez}', 'US')`, [PID]);
  partner = await appFor(`chris@${DOMAIN}`);
  member = await appFor(`ana.perez@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('W8-AC9: the files of a project carry their folder, source, kind and version; partners-only rows are absent for a member; hidden rows for everyone; no storage key', async () => {
  const root = 'Alpha technical / Parker Creek';
  const a = await file(partner, wd('06_8_2021_tracer.MAIN.pdf', `${root}/Reserves VDR/Logs`), '%PDF-1.7 tracer');
  await file(partner, wd('SHOW #124-8.tiff', `${root}/Reserves VDR/Logs`, { mime: 'image/tiff' }), 'II*tiff', 'image/tiff');
  const petra = await file(partner, wd('Frost 2 Openhole Logs.zip', `${root}/Extracted_Petra`), 'PK-zip-v1', 'application/zip');
  await file(partner, wd('Frost 2 Openhole Logs.zip', `${root}/Extracted_Petra`), 'PK-zip-v2', 'application/zip');   // a new version, one row
  const up = await file(partner, { type: 'spreadsheet', title: 'production.xlsx', origin: { source: 'upload', external_id: 'upload:production.xlsx' }, extracted: { filename: 'production.xlsx', uploaded_by: 'chris' } }, 'xlsx-bytes', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const nda = await file(partner, { type: 'nda', title: 'Mutual NDA.pdf', origin: { source: 'upload', external_id: 'upload:nda' } }, '%PDF nda');
  const gone = await file(partner, wd('old scan.pdf', `${root}/Reserves VDR`), '%PDF old');
  assert.equal((await partner.request(`/api/items/${gone.id}/hide`, { method: 'POST' })).status, 200);

  const r = await get(partner, `/api/projects/${PID}/files`);
  const rtext = await r.text();
  assert.equal(r.status, 200, rtext);
  const body = JSON.parse(rtext);
  assert.equal(body.project_id, PID);
  assert.equal(body.count, 5);
  assert.ok(body.generated_at);
  const rows = body.files as any[];
  assert.deepEqual(rows.map(f => f.name), ['Frost 2 Openhole Logs.zip', '06_8_2021_tracer.MAIN.pdf', 'SHOW #124-8.tiff', 'Mutual NDA.pdf', 'production.xlsx'], 'sorted by folder then name, uploads (no folder) last');
  const tracer = rows.find(f => f.id === a.id);
  assert.deepEqual({ ...tracer, created_at: undefined, authored_at: undefined, index: undefined }, {
    id: a.id, name: '06_8_2021_tracer.MAIN.pdf', title: '06_8_2021_tracer.MAIN.pdf', path: `${root}/Reserves VDR/Logs`, source: 'zoho-workdrive',
    type: 'report', mime: 'application/pdf', size: 1234, version: 1, created_at: undefined, authored_at: undefined, index: undefined,
  });
  assert.equal(tracer.index.state, 'waiting', 'nothing indexed in this test: every file waits');
  assert.ok(tracer.created_at);
  assert.equal(rows.find(f => f.id === petra.id).version, 2, 'the second upload of the same external id is version 2 of one row');
  assert.equal(rows.find(f => f.id === up.id).path, null, 'a hand upload has no folder');
  assert.equal(rows.find(f => f.id === up.id).source, 'upload');
  assert.equal(rows.find(f => f.id === nda.id).type, 'nda');
  assert.ok(!rows.some(f => f.id === gone.id), 'the hidden row is absent');
  for (const f of rows) assert.ok(!('storage_key' in f) && !('content_hash' in f) && !('extracted' in f), `no storage detail reaches the client: ${Object.keys(f)}`);

  // A member of the project sees the folder but not the partners-only NDA.
  const m = await get(member, `/api/projects/${PID}/files`);
  assert.equal(m.status, 200);
  const mb = await m.json();
  assert.equal(mb.count, 4);
  assert.ok(!mb.files.some((f: any) => f.id === nda.id), 'the NDA is partners-only');

  // Outside the caller's scope the project does not exist; unknown projects neither.
  assert.equal((await get(member, '/api/projects/orinoco-partnership/files')).status, 404);
  assert.equal((await get(partner, '/api/projects/no-such-project/files')).status, 404);

  // The audit row names the project scope and the count.
  const audits = (await db.query<any>(`SELECT scope, detail FROM audit_events WHERE action = 'project.files' ORDER BY at DESC`)).rows;
  assert.deepEqual(audits.slice(0, 2).map(a => a.detail.status), [404, 404], 'the refused reads are audited too');
  const last = audits.find(a => a.scope === `project:${PID}`);
  assert.ok(last, 'a project.files audit row with the project scope');
  assert.equal(last.detail.count, 4);
});

test('W8-AC15: each file carries its indexing state, the waiting ones their place in the sync job\'s order and an expected run; the summary counts them; the item route answers for one record', async () => {
  const P2 = 'index-demo';
  await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag, members, country) VALUES ($1, NULL, 'Index demo', 'prospect', 'lt-firm', '{ana.perez}', 'US')`, [P2]);
  const mk = async (name: string, bytes: string, mime = 'application/pdf') => {
    const fd = new FormData();
    fd.append('item', JSON.stringify({ project_id: P2, type: 'report', title: name, origin: { source: 'zoho-workdrive', external_id: `wd:${name}` }, extracted: { filename: name, workdrive: { path: 'Alpha technical / Index demo/Logs', size: 10, modified_ms: 1 } } }));
    fd.append('original', new Blob([bytes], { type: mime }), name);
    const r = await partner.request('/api/items', { method: 'POST', body: fd });
    const t = await r.text(); assert.equal(r.status, 201, t);
    return JSON.parse(t).id as string;
  };
  const indexed = await mk('indexed.pdf', '%PDF indexed');
  const unsupported = await mk('scan.tiff', 'II*', 'image/tiff');
  const needsOcr = await mk('scan.pdf', '%PDF scan');
  const waitD = await mk('wait-d.pdf', '%PDF d');
  const waitE = await mk('wait-e.pdf', '%PDF e');
  const waitF = await mk('wait-f.pdf', '%PDF f');
  await db.query(`INSERT INTO chunks (item_id, item_version, ordinal, text, legal_tag, project_id, current) VALUES ($1, 1, 0, 'indexed text', 'lt-firm', $2, true)`, [indexed, P2]);
  await db.query(`UPDATE items SET extracted = extracted || '{"ingest":{"status":"ok","version":1,"at":"2026-10-08T07:00:00.000Z"},"chunks":1,"text_chars":12}'::jsonb WHERE id = $1`, [indexed]);
  await db.query(`UPDATE items SET extracted = extracted || '{"ingest":{"status":"unsupported","version":1,"at":"2026-10-08T07:00:00.000Z"}}'::jsonb WHERE id = $1`, [unsupported]);
  await db.query(`UPDATE items SET extracted = extracted || '{"ingest":{"status":"needs_ocr","version":1,"at":"2026-10-08T07:00:00.000Z"},"needs_ocr":true}'::jsonb WHERE id = $1`, [needsOcr]);
  // The sync job takes the oldest filed first, across the Vault: E, then D, then F.
  await db.query(`UPDATE items SET created_at = '2020-01-01T00:00:00Z' WHERE id = $1`, [waitE]);
  await db.query(`UPDATE items SET created_at = '2020-01-02T00:00:00Z' WHERE id = $1`, [waitD]);
  await db.query(`UPDATE items SET created_at = '2020-01-03T00:00:00Z' WHERE id = $1`, [waitF]);

  const r = await get(partner, `/api/projects/${P2}/files`);
  const t = await r.text(); assert.equal(r.status, 200, t);
  const body = JSON.parse(t);
  const by = Object.fromEntries(body.files.map((f: any) => [f.id, f.index]));
  assert.deepEqual(by[indexed], { state: 'indexed', chunks: 1 });
  assert.deepEqual(by[unsupported], { state: 'unsupported', chunks: 0 });
  assert.deepEqual(by[needsOcr], { state: 'needs_ocr', chunks: 0 });
  assert.equal(by[waitE].state, 'waiting'); assert.equal(by[waitE].queue_position, 1);
  assert.equal(by[waitD].queue_position, 2); assert.equal(by[waitF].queue_position, 3);
  assert.deepEqual({ ...body.index, queue_total: undefined, next_run_at: undefined }, { indexed: 1, waiting: 3, unsupported: 1, needs_ocr: 1, empty: 0, no_original: 0, per_run: 200, queue_total: undefined, next_run_at: undefined });
  assert.ok(body.index.queue_total >= 3, `queue_total ${body.index.queue_total}`);
  // The expected run: the next quarter hour for the first 200 in the queue, and the same for all three.
  const next = new Date(body.index.next_run_at);
  assert.ok(next.getTime() > Date.now() - 1000 && next.getTime() <= Date.now() + 15 * 60000 + 1000, body.index.next_run_at);
  assert.equal(next.getUTCMinutes() % 15, 0); assert.equal(next.getUTCSeconds(), 0);
  assert.equal(by[waitE].expected_at, body.index.next_run_at);
  assert.equal(by[waitF].expected_at, body.index.next_run_at);

  // One record.
  const one = await get(partner, `/api/items/${waitD}/index`);
  const ob = await one.json();
  assert.equal(one.status, 200, JSON.stringify(ob));
  assert.equal(ob.state, 'waiting'); assert.equal(ob.queue_position, 2); assert.ok(ob.queue_total >= 3); assert.equal(ob.expected_at, body.index.next_run_at);
  assert.equal(ob.item_id, waitD);
  const idx = await get(partner, `/api/items/${indexed}/index`);
  assert.deepEqual(await idx.json(), { item_id: indexed, version: 1, state: 'indexed', chunks: 1 });
  assert.equal((await partner.request(`/api/items/${waitF}/hide`, { method: 'POST' })).status, 200);
  assert.equal((await get(partner, `/api/items/${waitF}/index`)).status, 404);
  assert.equal((await get(member, '/api/items/00000000-0000-4000-8000-000000000051/index')).status, 403, 'a client-NDA record outside the associate\'s scope');
});
