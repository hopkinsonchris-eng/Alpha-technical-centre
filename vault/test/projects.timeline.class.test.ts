// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.7, W7-AC13; data review 03 §4 and §5.2 A4): timeline entries
// carry `record_kind` (items.kind, lifted from extracted->>'kind', or the run's job) and `class` ∈ foreground |
// background computed server-side: superseded runs, draft runs older than a newer run on the same tool, research
// findings, dossiers, GEM and gazetteer notes, history mail and reviewed-and-sent drafts are background; `?class=`
// filters. Written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-timeline-class-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

let db: Db;
let app: Awaited<ReturnType<typeof createApp>>;
const call = async (method: string, url: string, body?: unknown) => {
  const r = await app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const base = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown> = {}) => ({ ...base, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], asset_ids: [], project_id: 'tc-p', client_id: 'frontera', legal_tag: 'lt-frontera-nda-2026', ...o });
const P = 'tc-p', TAG = 'lt-frontera-nda-2026';
const item = (id: string, type: string, title: string, at: string, extracted: Record<string, unknown> = {}, source = 'upload', tags: string[] = []) =>
  db.query("INSERT INTO items (id,type,title,created_at,project_id,client_id,legal_tag,origin,content_hash,version,extracted,tags) VALUES ($1,$2,$3,$4,$5,'frontera',$6,$7::jsonb,$8,1,$9::jsonb,$10::text[])",
    [id, type, title, at, P, TAG, JSON.stringify({ source }), hashOf(id), JSON.stringify(extracted), tags]);

const ids = { note: randomUUID(), research: randomUUID(), dossier: randomUUID(), gem: randomUUID(), history: randomUUID(), historyTag: randomUUID(), mail: randomUUID(), sentDraft: randomUUID(), draft: randomUUID(), letterV1: randomUUID(), letterV2: randomUUID() };
let oldRun: string, newRun: string, draftOld: string, draftNew: string, finalOld: string, draftNewer: string;

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ($1,'client-nda','second-party','frontera','Frontera Energy')", [TAG]);
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,'frontera','Timeline classes','lt-frontera-nda-2026','{chris}')", [P]);
  app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  // Runs: a superseded pair; two drafts of one job (the older is background); a final older than a newer draft (stays foreground).
  const a = run({ created_at: '2026-06-01T00:00:00Z', title: 'Screen v1' }), b = run({ created_at: '2026-06-02T00:00:00Z', title: 'Screen v2' });
  assert.equal((await call('POST', '/api/runs', a)).status, 201); assert.equal((await call('POST', `/api/runs/${a.id}/supersede`, b)).status, 201);
  oldRun = a.id; newRun = b.id;
  const c = run({ job: 'nodal-analysis', created_at: '2026-07-01T00:00:00Z', title: 'Nodal draft 1', status: 'draft' }), d = run({ job: 'nodal-analysis', created_at: '2026-07-02T00:00:00Z', title: 'Nodal draft 2', status: 'draft' });
  assert.equal((await call('POST', '/api/runs', c)).status, 201); assert.equal((await call('POST', '/api/runs', d)).status, 201);
  draftOld = c.id; draftNew = d.id;
  const e = run({ job: 'financial-model', created_at: '2026-07-01T00:00:00Z', title: 'NPV final', status: 'final' }), f = run({ job: 'financial-model', created_at: '2026-07-03T00:00:00Z', title: 'NPV draft', status: 'draft' });
  assert.equal((await call('POST', '/api/runs', e)).status, 201); assert.equal((await call('POST', '/api/runs', f)).status, 201);
  finalOld = e.id; draftNewer = f.id;
  // Items of every background kind, and the foreground ones beside them.
  await item(ids.note, 'note', 'Kick-off note', '2026-08-01T00:00:00Z');
  await item(ids.research, 'note', 'Research: operator and licence', '2026-08-02T00:00:00Z', { kind: 'research' }, 'research');
  await item(ids.dossier, 'note', 'Cubiro dossier', '2026-08-03T00:00:00Z', { kind: 'dossier' }, 'research');
  await item(ids.gem, 'note', 'GEM: Llanos basin', '2026-08-04T00:00:00Z', {}, 'gem');
  await item(ids.history, 'email', 'Old thread (backfill)', '2026-08-05T00:00:00Z', { history: true, direction: 'in' }, 'zoho-mail');
  await item(ids.historyTag, 'email', 'Old thread (tagged)', '2026-08-06T00:00:00Z', { direction: 'in' }, 'zoho-mail', ['history']);
  await item(ids.mail, 'email', 'RE: data room', '2026-08-07T00:00:00Z', { direction: 'in', status: 'filed' }, 'zoho-mail');
  await item(ids.sentDraft, 'note', 'Draft letter (sent)', '2026-08-08T00:00:00Z', { kind: 'draft', draft_kind: 'letter', sent: { at: '2026-08-09T00:00:00Z', by: 'chris' } });
  await item(ids.draft, 'note', 'Draft letter (open)', '2026-08-09T00:00:00Z', { kind: 'draft', draft_kind: 'letter' });
  await item(ids.letterV1, 'letter', 'Proposal v1', '2026-08-10T00:00:00Z');
  await item(ids.letterV2, 'letter', 'Proposal v2', '2026-08-11T00:00:00Z');
  await db.query('UPDATE items SET supersedes = $2 WHERE id = $1', [ids.letterV2, ids.letterV1]);
});
after(async () => { await db.close(); });

test('A4 / W7-AC13: every entry carries record_kind and class; the background rules of 03 §4 are applied server-side', async () => {
  const r = await call('GET', `/api/projects/${P}/timeline`);
  assert.equal(r.status, 200);
  const by = new Map<string, any>(r.body.entries.map((e: any) => [e.id, e]));
  for (const e of r.body.entries) { assert.ok(['foreground', 'background'].includes(e.class), e.title); assert.ok(typeof e.record_kind === 'string', e.title); assert.ok(['run', 'item'].includes(e.kind)); }
  const cls = (id: string) => by.get(id)?.class;
  assert.equal(cls(oldRun), 'background', 'superseded run'); assert.equal(cls(newRun), 'foreground');
  assert.equal(cls(draftOld), 'background', 'draft older than a newer run on the same tool'); assert.equal(cls(draftNew), 'foreground');
  assert.equal(cls(finalOld), 'foreground', 'a final run is not demoted by a later draft'); assert.equal(cls(draftNewer), 'foreground');
  assert.equal(by.get(newRun).record_kind, 'opportunity-register'); assert.equal(by.get(draftNew).record_kind, 'nodal-analysis');
  assert.equal(cls(ids.note), 'foreground'); assert.equal(by.get(ids.note).record_kind, 'note', 'an item without extracted.kind reads its type');
  assert.equal(cls(ids.research), 'background'); assert.equal(by.get(ids.research).record_kind, 'research');
  assert.equal(cls(ids.dossier), 'background'); assert.equal(by.get(ids.dossier).record_kind, 'dossier');
  assert.equal(cls(ids.gem), 'background', 'GEM note');
  assert.equal(cls(ids.history), 'background', 'history mail (flag)'); assert.equal(cls(ids.historyTag), 'background', 'history mail (tag)');
  assert.equal(cls(ids.mail), 'foreground', 'human mail');
  assert.equal(cls(ids.sentDraft), 'background', 'a reviewed and sent draft'); assert.equal(cls(ids.draft), 'foreground', 'an open draft');
  assert.equal(cls(ids.letterV1), 'background', 'a superseded document'); assert.equal(cls(ids.letterV2), 'foreground');
  assert.equal(r.body.count, 17);
  assert.deepEqual(r.body.classes, { foreground: 8, background: 9 });
});

test('A4: ?class= filters; a bad class is 400; the count follows the filter', async () => {
  const bg = await call('GET', `/api/projects/${P}/timeline?class=background`);
  assert.equal(bg.status, 200);
  assert.equal(bg.body.count, 9); assert.ok(bg.body.entries.every((e: any) => e.class === 'background'));
  assert.deepEqual(bg.body.classes, { foreground: 8, background: 9 }, 'the totals are still reported so the Hub can label the collapsed group');
  const fg = await call('GET', `/api/projects/${P}/timeline?class=foreground`);
  assert.equal(fg.body.count, 8); assert.ok(fg.body.entries.every((e: any) => e.class === 'foreground'));
  assert.equal((await call('GET', `/api/projects/${P}/timeline?class=archive`)).status, 400);
});
