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
  assert.deepEqual({ ...tracer, created_at: undefined, authored_at: undefined }, {
    id: a.id, name: '06_8_2021_tracer.MAIN.pdf', title: '06_8_2021_tracer.MAIN.pdf', path: `${root}/Reserves VDR/Logs`, source: 'zoho-workdrive',
    type: 'report', mime: 'application/pdf', size: 1234, version: 1, created_at: undefined, authored_at: undefined,
  });
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
