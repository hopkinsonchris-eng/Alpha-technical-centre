// Wave 9 (docs/vault-hub/wave9/01-project-folders.md, W9-AC1–AC10): every project's records filed into one numbered
// skeleton. Rules first; the model only from this project's own folders, with a verbatim quote, filing itself at 0.8 or
// more and asking below; people's moves supersede and teach; Legal and Financial are partners-only; the checklists say
// what is missing; the backlog is paced and capped.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-folders-'));

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { FakeProvider } = await import('../src/llm/provider.ts');
const { fileItem, fileBacklog, ruleFiling, modelFiling, examplesFor, AUTO_FILE_CONFIDENCE } = await import('../src/folders/classify.ts');
const { folderLabels, SKELETON } = await import('../src/folders/skeleton.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const DOMAIN = 'alpha-technical-centre.com';
const PID = 'pc-demo';
let db: Db;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
let partner: Awaited<ReturnType<typeof appFor>>, ana: Awaited<ReturnType<typeof appFor>>;
const get = async (a: typeof partner, url: string) => { const r = await a.request(url); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };
const post = async (a: typeof partner, url: string, body?: unknown) => { const r = await a.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }; };

async function item(m: { type?: string; title: string; origin?: any; extracted?: any; asset_ids?: string[]; project?: string; client?: string | null }): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO items (id, type, title, created_at, project_id, client_id, asset_ids, legal_tag, origin, content_hash, version, extracted)
     VALUES ($1,$2,$3,now(),$4,$5,$6::text[],'lt-firm',$7::jsonb,$8,1,$9::jsonb)`,
    [id, m.type ?? 'report', m.title, m.project ?? PID, m.client ?? null, m.asset_ids ?? [], JSON.stringify(m.origin ?? { source: 'upload' }), 'sha256:' + id.replace(/-/g, '').padEnd(64, '0'), JSON.stringify(m.extracted ?? {})]);
  return id;
}
const wd = (name: string, folder: string) => ({ origin: { source: 'zoho-workdrive', external_id: `wd:${name}` }, extracted: { filename: name, workdrive: { path: folder } } });
const folders = async (a = partner, pid = PID) => { const r = await get(a, `/api/projects/${pid}/folders`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const fileOf = (body: any, id: string) => body.files.find((f: any) => f.id === id);
const nodeOf = (body: any, key: string): any => { let hit: any = null; const walk = (ns: any[]) => { for (const n of ns) { if (n.key === key) hit = n; walk(n.children); } }; walk(body.folders); return hit; };
const current = async (id: string) => (await db.query<any>('SELECT * FROM folder_filings WHERE item_id = $1 AND superseded_by IS NULL', [id])).rows[0];

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await db.query(`INSERT INTO people (id, email, name, role) VALUES ('ana', 'ana@${DOMAIN}', 'Ana', 'associate'), ('ben', 'ben@${DOMAIN}', 'Ben', 'associate') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO assets (id, kind, name, country) VALUES ('t-pc', 'field', 'Parker Creek', 'US'), ('t-frost2', 'well', 'Frost 2', 'US'), ('t-a1', 'well', 'Smith A-1', 'US'), ('t-res', 'reservoir', 'Upper Hawaz', 'US'), ('t-basin', 'basin', 'Permian', 'US')`);
  await db.query(`UPDATE assets SET parent_id = 't-pc' WHERE id IN ('t-frost2', 't-a1')`);
  await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag, members, country, asset_ids) VALUES ($1, NULL, 'Parker Creek demo', 'prospect', 'lt-firm', '{ana}', 'US', '{t-pc,t-frost2,t-a1,t-res,t-basin}'), ('empty-demo', NULL, 'Empty', 'prospect', 'lt-firm', '{ana}', 'US', '{}')`, [PID]);
  partner = await appFor(`chris@${DOMAIN}`);
  ana = await appFor(`ana@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('W9-AC1: every project, even an empty one, has the twelve numbered top folders in order', async () => {
  const b = await folders(partner, 'empty-demo');
  assert.deepEqual(b.folders.map((f: any) => `${f.n} ${f.en}`), [
    '00 Unsorted', '01 Legal', '02 Government & regulatory', '03 Commercial & contracts', '04 Financial', '05 Subsurface',
    '06 Facilities & infrastructure', '07 HSE', '08 APEX apps', '09 Papers & research', '10 Correspondence', '11 Deliverables']);
  assert.equal(b.files.length, 0);
  assert.deepEqual(nodeOf(b, 'subsurface').children.map((c: any) => c.en), ['Basin & regional', 'Fields', 'Reservoirs', 'Wells', 'Seismic & geophysics']);
  assert.ok(nodeOf(b, 'apex').children.some((c: any) => c.en === 'APEX 3D Model'), 'every APEX app has its folder before it has a run');
  assert.equal(SKELETON.length, 12);
});

test('W9-AC2: the rules file by type, source, words and the attached assets, each marked as a rule', async () => {
  const inv = await item({ type: 'invoice', title: 'Invoice 0042' });
  const gd = await item({ type: 'note', title: 'Oil output rises', origin: { source: 'research', adapter: 'gdelt' } });
  const co = await item({ type: 'note', title: 'Acme: company profile', origin: { source: 'research', adapter: 'company-enrichment' } });
  const mail = await item({ type: 'email', title: 'Re: data room', origin: { source: 'zoho-mail' } });
  const logs = await item({ title: 'Frost 2 Openhole Logs.zip', ...wd('Frost 2 Openhole Logs.zip', 'Alpha technical / Parker Creek/Extracted_Petra') });
  const tiff = await item({ title: 'SHOW #124-8.tiff', ...wd('SHOW #124-8.tiff', 'Alpha technical / Parker Creek/Reserves VDR/Logs') });
  const joa = await item({ type: 'contract', title: 'Parker Creek Joint Operating Agreement' });
  const psc = await item({ title: 'Production Sharing Contract — Block 7' });
  const cpr = await item({ title: 'Parker Creek CPR 2025', asset_ids: ['t-pc'] });
  const own = await item({ title: 'Scanned page', asset_ids: ['t-a1'] });
  const dossier = await item({ type: 'note', title: 'Field dossier: Parker Creek', origin: { source: 'gem' }, extracted: { kind: 'dossier', asset_id: 't-pc', asset_name: 'Parker Creek' } });
  for (const id of [inv, gd, co, mail, logs, tiff, joa, psc, cpr, own, dossier]) assert.equal((await fileItem(db, id, { provider: null })).status, 'filed', id);
  const b = await folders();
  const at = (id: string) => fileOf(b, id).folder;
  assert.equal(at(inv), 'financial');
  assert.equal(at(gd), 'research/news');
  assert.equal(at(co), 'research/companies');
  assert.equal(at(mail), 'correspondence');
  assert.equal(at(logs), 'subsurface/wells/t-frost2', 'a log file named after one attached well is that well\'s');
  assert.equal(at(tiff), 'subsurface/wells', 'a file in a Logs folder is a well log; no well named, so Wells itself');
  assert.equal(at(joa), 'legal');
  assert.equal(at(psc), 'government');
  assert.equal(at(cpr), 'subsurface/fields/t-pc');
  assert.equal(at(own), 'subsurface/wells/t-a1');
  assert.equal(at(dossier), 'subsurface/fields/t-pc');
  assert.deepEqual({ m: fileOf(b, joa).filing.method, k: fileOf(b, joa).filing.doc_kind }, { m: 'rule', k: 'joa' });
  assert.equal(fileOf(b, logs).filing.doc_kind, 'well-log');
  assert.equal(fileOf(b, joa).filing.kind_en, 'Joint operating agreement', 'the kind in words for the Hub');
});

test('W9-AC3: the model files only into a real folder with a verbatim quote, by itself at 0.8 or more, asking below', async () => {
  const assets = [{ id: 't-a1', name: 'Smith A-1', kind: 'well' }];
  const labels = folderLabels(assets, [], true);
  const t = { id: randomUUID(), type: 'report', title: 'Untitled scan', client_id: null, project_id: PID, origin: {}, extracted: {}, asset_ids: [] };
  const text = 'The Smith A-1 was drilled to 9,850 ft and completed in the Wolfcamp.';
  const answer = (o: object) => new FakeProvider(() => JSON.stringify(o));
  const good = await modelFiling(t, text, labels, [], answer({ folder: 'subsurface/wells/t-a1', doc_kind: 'end-of-well-report', confidence: 0.9, quote: 'drilled to 9,850 ft', reason: 'Completion of A-1' }));
  assert.deepEqual({ f: good.filing?.folder, k: good.filing?.doc_kind, m: good.filing?.method }, { f: 'subsurface/wells/t-a1', k: 'end-of-well-report', m: 'model' });
  const made = await modelFiling(t, text, labels, [], answer({ folder: 'subsurface/wells/t-zz9', doc_kind: 'well-log', confidence: 0.99, quote: 'drilled to 9,850 ft' }));
  assert.equal(made.filing, null); assert.match(made.refused!, /not in this project/);
  const invented = await modelFiling(t, text, labels, [], answer({ folder: 'subsurface/wells/t-a1', doc_kind: 'well-log', confidence: 0.99, quote: 'perforated at 9,700 ft' }));
  assert.equal(invented.filing, null); assert.match(invented.refused!, /does not contain/);
  const oddKind = await modelFiling(t, text, labels, [], answer({ folder: 'hse', doc_kind: 'banana', confidence: 0.85, quote: 'Wolfcamp' }));
  assert.equal(oddKind.filing?.doc_kind, 'other');

  // Through fileItem: confident files itself; doubtful stays in Unsorted with one queue card; refused stays in Unsorted.
  const sure = await item({ title: 'Scan 1' }), unsure = await item({ title: 'Scan 2' }), bad = await item({ title: 'Scan 3' });
  const r1 = await fileItem(db, sure, { provider: answer({ folder: 'hse', doc_kind: 'hse-plan', confidence: AUTO_FILE_CONFIDENCE, quote: 'Scan 1' }), text: 'x' });
  assert.deepEqual({ s: r1.status, f: r1.folder }, { s: 'filed', f: 'hse' });
  const r2 = await fileItem(db, unsure, { provider: answer({ folder: 'facilities', doc_kind: 'facilities-description', confidence: 0.6, quote: 'Scan 2', reason: 'Mentions a flow station' }), text: 'x' });
  assert.equal(r2.status, 'proposed');
  assert.equal((await current(unsure)).folder, 'unsorted');
  const q = (await db.query<any>("SELECT payload FROM review_queue WHERE kind = 'folder' AND status = 'open' AND payload->>'item_id' = $1", [unsure])).rows;
  assert.equal(q.length, 1); assert.equal(q[0].payload.folder, 'facilities'); assert.equal(q[0].payload.title, undefined, 'the card carries no record text');
  const r3 = await fileItem(db, bad, { provider: answer({ folder: 'nowhere', confidence: 1, quote: 'Scan 3' }), text: 'x' });
  assert.equal(r3.status, 'unsorted');
  assert.match((await current(bad)).reason, /Not filed: the model chose a folder/);
  const b = await folders();
  assert.equal(fileOf(b, unsure).suggestion.folder, 'facilities');
  assert.equal(fileOf(b, unsure).filing.quote, 'Scan 2');
  assert.ok(b.unsorted >= 2);

  // The proposals route shows it with the quote and the folder choices; accepting files it as the person.
  const pr = await get(ana, '/api/folders/proposals');
  const card = pr.body.proposals.find((p: any) => p.item_id === unsure);
  assert.equal(card.folder_label, '06 Facilities & infrastructure');
  assert.equal(card.quote, 'Scan 2');
  assert.ok(pr.body.options[PID].some((o: any) => o.key === 'subsurface/wells/t-a1'));
  assert.ok(!pr.body.options[PID].some((o: any) => o.key === 'legal'), 'an associate is offered no partners-only folder');
  const acc = await post(ana, `/api/folders/proposals/${card.id}/accept`);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const now = await current(unsure);
  assert.deepEqual({ f: now.folder, m: now.method, k: now.doc_kind, by: now.filed_by }, { f: 'facilities', m: 'manual', k: 'facilities-description', by: 'ana' });
  assert.equal((await post(ana, `/api/folders/proposals/${card.id}/accept`)).status, 409);
});

test('W9-AC4: a move writes a new filing and supersedes the old one; the history keeps both', async () => {
  const id = await item({ title: 'Invoice 0099', type: 'invoice' });
  await fileItem(db, id, { provider: null });
  const r = await post(partner, `/api/projects/${PID}/folders/file`, { item_id: id, folder: 'commercial' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const all = (await db.query<any>('SELECT folder, method, superseded_by FROM folder_filings WHERE item_id = $1 ORDER BY filed_at, folder', [id])).rows;
  assert.equal(all.length, 2);
  assert.deepEqual(all.map(x => [x.folder, x.method, x.superseded_by === null]), [['financial', 'rule', false], ['commercial', 'manual', true]]);
  assert.equal((await current(id)).doc_kind, 'invoice', 'the kind the rule found stays with the record');
  // A person's filing is never refiled by the machine.
  assert.equal((await fileItem(db, id, { provider: null })).status, 'kept');
  assert.equal((await post(partner, `/api/projects/${PID}/folders/file`, { item_id: id, folder: 'nowhere' })).status, 400);
});

test('W9-AC5: Legal and Financial are partners-only: an associate cannot see them or file into them, and a record filed there is hidden from them everywhere', async () => {
  const id = await item({ title: 'Site photos.zip' });
  await db.query(`INSERT INTO chunks (item_id, item_version, ordinal, anchor, context, text, legal_tag, project_id, partners_only, current) VALUES ($1, 1, 0, 'p1', '', 'photos', 'lt-firm', $2, false, true)`, [id, PID]);
  assert.equal((await get(ana, `/api/items/${id}`)).status, 200);
  assert.equal((await post(ana, `/api/projects/${PID}/folders/file`, { item_id: id, folder: 'legal' })).status, 403);
  const asAna = await folders(ana);
  assert.equal(nodeOf(asAna, 'legal'), null); assert.equal(nodeOf(asAna, 'financial'), null);
  assert.equal(asAna.partner, false);
  assert.equal((await post(partner, `/api/projects/${PID}/folders/file`, { item_id: id, folder: 'legal' })).status, 200);
  assert.ok(!(await folders(ana)).files.some((f: any) => f.id === id), 'gone from the associate\'s folders');
  assert.equal((await get(ana, `/api/items/${id}`)).status, 403, 'and from the record panel');
  const tl = await get(ana, `/api/projects/${PID}/timeline`);
  assert.ok(!JSON.stringify(tl.body).includes(id), 'and from the timeline');
  // Before wave 9 the timeline and lineage checked only the tag: a partners-only type (an NDA) showed to associates there.
  const nda = await item({ type: 'nda', title: 'Mutual NDA — counterparty' });
  assert.ok(!JSON.stringify((await get(ana, `/api/projects/${PID}/timeline`)).body).includes(nda), 'an NDA is not on an associate\'s timeline');
  assert.ok(!JSON.stringify((await get(ana, `/api/projects/${PID}/lineage`)).body).includes(nda), 'nor in the lineage');
  assert.ok(JSON.stringify((await get(partner, `/api/projects/${PID}/timeline`)).body).includes(nda), 'a partner sees it');
  assert.equal((await db.query<any>('SELECT partners_only FROM chunks WHERE item_id = $1', [id])).rows[0].partners_only, true, 'and from search');
  assert.ok(fileOf(await folders(partner), id), 'the partner still sees it');
  // Moving it out does not lift it: that stays a partner's explicit decision.
  await post(partner, `/api/projects/${PID}/folders/file`, { item_id: id, folder: 'hse' });
  assert.equal((await get(ana, `/api/items/${id}`)).status, 403);
});

test('W9-AC6: attaching a well under the field gives it its own folder under Wells, empty until something is filed', async () => {
  await db.query(`INSERT INTO assets (id, kind, name, country, parent_id) VALUES ('t-new', 'well', 'Jones 3H', 'US', 't-pc')`);
  await db.query(`UPDATE projects SET asset_ids = array_append(asset_ids, 't-new') WHERE id = $1`, [PID]);
  const w = nodeOf(await folders(), 'subsurface/wells/t-new');
  assert.deepEqual({ en: w.en, count: w.count, asset: w.asset_id }, { en: 'Jones 3H', count: 0, asset: 't-new' });
  assert.deepEqual(w.expects.map((e: any) => e.kind), ['well-log', 'end-of-well-report']);
});

test('W9-AC7: runs sit in their app\'s folder; superseded and hidden runs do not count; a run outside scope never appears', async () => {
  const run = async (status: string, opts: { hidden?: boolean; tag?: string; job?: string } = {}) => {
    const id = randomUUID();
    await db.query(`INSERT INTO runs (id, job, tool_version, tool_commit, author, created_at, project_id, legal_tag, title, record, input_hash, status, hidden)
      VALUES ($1,$2,'1.0.0','abcdef1','chris',now(),$3,$4,$5,'{}'::jsonb,$6,$7,$8)`, [id, opts.job ?? 'apex-3d-model', PID, opts.tag ?? 'lt-firm', `Run ${status}`, id, status, !!opts.hidden]);
    return id;
  };
  const final = await run('final'); await run('superseded'); await run('final', { hidden: true }); await run('draft', { job: 'ela-studio' });
  await db.query(`INSERT INTO legal_tags (id, classification, data_type, originator, partners_only) VALUES ('lt-po-test', 'firm', 'first-party', 'Alpha Technical Centre', true) ON CONFLICT (id) DO NOTHING`);
  const secret = await run('final', { tag: 'lt-po-test' });
  const b = await folders(ana);
  const app = nodeOf(b, 'apex/apex-3d-model');
  assert.equal(app.count, 1);
  assert.ok(b.runs.some((r: any) => r.id === final && r.current && r.folder === 'apex/apex-3d-model'));
  assert.ok(!b.runs.some((r: any) => r.id === secret), 'a partners-only run is absent for an associate');
  assert.equal(nodeOf(b, 'apex/ela-studio').en, 'ELA Phase 1 Scenario Studio', 'a non-APEX tool with runs gets its folder too');
  assert.ok((await folders(partner)).runs.some((r: any) => r.id === secret));
});

test('W9-AC8: the checklists tick what is filed and a partner may mark a gap not applicable', async () => {
  let legal = nodeOf(await folders(), 'legal');
  const ex = (n: any, k: string) => n.expects.find((e: any) => e.kind === k);
  assert.equal(ex(legal, 'joa').met, true, 'the JOA filed by rule in AC2');
  assert.equal(ex(legal, 'nda').met, false);
  assert.equal((await post(ana, `/api/projects/${PID}/folders/waive`, { folder: 'legal', expect: 'nda' })).status, 403);
  assert.equal((await post(partner, `/api/projects/${PID}/folders/waive`, { folder: 'legal', expect: 'nda' })).status, 200);
  legal = nodeOf(await folders(), 'legal');
  assert.equal(ex(legal, 'nda').waived, true);
  assert.equal((await post(partner, `/api/projects/${PID}/folders/waive`, { folder: 'legal', expect: 'nda', waived: false })).status, 200);
  assert.equal(ex(nodeOf(await folders(), 'legal'), 'nda').waived, false, 'the latest row wins');
  assert.equal((await post(partner, `/api/projects/${PID}/folders/waive`, { folder: 'legal', expect: 'seismic-survey' })).status, 400);
  const frost = nodeOf(await folders(), 'subsurface/wells/t-frost2');
  assert.equal(ex(frost, 'well-log').met, true);
  assert.equal(ex(frost, 'end-of-well-report').met, false);
});

test('W9-AC9: people\'s moves become the model\'s examples, only from records of the same client', async () => {
  await db.query(`INSERT INTO organisations (id, name, kind) VALUES ('cli-a', 'Client A', 'client'), ('cli-b', 'Client B', 'client') ON CONFLICT (id) DO NOTHING`);
  const mine = await item({ title: 'Mud log Smith A-1', client: 'cli-a' });
  const theirs = await item({ title: 'Secret B prospect', client: 'cli-b' });
  await post(partner, `/api/projects/${PID}/folders/file`, { item_id: mine, folder: 'subsurface/wells/t-a1' });
  await post(partner, `/api/projects/${PID}/folders/file`, { item_id: theirs, folder: 'commercial' });
  const target = { id: randomUUID(), type: 'report', title: 'x', client_id: 'cli-a', project_id: PID, origin: {}, extracted: {}, asset_ids: [] };
  const ex = await examplesFor(db, target);
  assert.ok(ex.some(e => e.title === 'Mud log Smith A-1' && e.folder === 'subsurface/wells/t-a1'));
  assert.ok(!ex.some(e => e.title === 'Secret B prospect'), 'another client\'s titles never reach the prompt');
  let prompt = '';
  await modelFiling(target, 'text', folderLabels([], [], true), ex, new FakeProvider(req => { prompt = req.messages[0].content; return '{}'; }));
  assert.match(prompt, /Mud log Smith A-1 \| - → subsurface\/wells\/t-a1/);
  // From another project, an asset folder teaches the level only.
  const elsewhere = { ...target, project_id: 'empty-demo' };
  assert.ok((await examplesFor(db, elsewhere)).some(e => e.title === 'Mud log Smith A-1' && e.folder === 'subsurface/wells'));
});

test('W9-AC10: the backlog files only records never filed, at most N a run, and resumes where it stopped', async () => {
  await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag, members, country) VALUES ('bl-demo', NULL, 'Backlog', 'prospect', 'lt-firm', '{}', 'US')`);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push(await item({ type: 'invoice', title: `Invoice ${i}`, project: 'bl-demo' }));
  // Everything filed by the earlier tests is out of the way; these five are the oldest unfiled records.
  await fileBacklog(db, null, { limit: 500 });
  await db.query("DELETE FROM folder_filings WHERE item_id IN (SELECT id FROM items WHERE project_id = 'bl-demo')");
  await db.query("UPDATE items SET created_at = '2001-01-01' WHERE project_id = 'bl-demo'");
  const s1 = await fileBacklog(db, null, { limit: 3, rulesLimit: 0 });
  assert.equal(s1.filed, 3, 'three this run');
  const done1 = (await db.query<any>("SELECT count(*)::int AS n FROM folder_filings f JOIN items i ON i.id = f.item_id WHERE i.project_id = 'bl-demo'")).rows[0].n;
  assert.equal(done1, 3);
  await fileBacklog(db, null, { limit: 500 });
  const done2 = (await db.query<any>("SELECT count(*)::int AS n FROM folder_filings f JOIN items i ON i.id = f.item_id WHERE i.project_id = 'bl-demo' AND f.superseded_by IS NULL")).rows[0].n;
  assert.equal(done2, 5);
  const again = await fileBacklog(db, null, { limit: 500 });
  assert.equal(again.filed + again.proposed + again.unsorted, 0, 'nothing is filed twice');
  // Without a model a record no rule fits is placed in Unsorted, saying why.
  const odd = await item({ title: 'zz', project: 'bl-demo' });
  await fileBacklog(db, null, { limit: 500 });
  assert.match((await current(odd)).reason, /no model is configured/i);
});

test('the rules never guess an asset when the record names two', () => {
  const assets = [{ id: 'a', name: 'Smith A-1', kind: 'well' }, { id: 'b', name: 'Frost 2', kind: 'well' }];
  const f = ruleFiling({ id: 'x', type: 'report', title: 'Smith A-1 and Frost 2 logs.pdf', client_id: null, project_id: PID, origin: {}, extracted: {}, asset_ids: [] }, assets);
  assert.equal(f?.folder, 'subsurface/wells');
});

test('W9-AC6: a file sorted under Wells before its well was attached moves into the well\'s folder on the next backlog run', async () => {
  const id = await item({ title: 'Brown 7 cased hole logs.pdf' });
  await fileItem(db, id, { provider: null });
  assert.equal((await current(id)).folder, 'subsurface/wells', 'no well named Brown 7 yet');
  await db.query(`INSERT INTO assets (id, kind, name, country, parent_id) VALUES ('t-brown7', 'well', 'Brown 7', 'US', 't-pc')`);
  await db.query(`UPDATE projects SET asset_ids = array_append(asset_ids, 't-brown7') WHERE id = $1`, [PID]);
  const s = await fileBacklog(db, null, { limit: 500 });
  assert.ok((s.narrowed ?? 0) >= 1);
  assert.equal((await current(id)).folder, 'subsurface/wells/t-brown7');
  // A person's choice of the general folder stays.
  const kept = await item({ title: 'Brown 7 sketch.pdf' });
  await post(partner, `/api/projects/${PID}/folders/file`, { item_id: kept, folder: 'subsurface/wells' });
  await fileBacklog(db, null, { limit: 500 });
  assert.equal((await current(kept)).folder, 'subsurface/wells');
});

test('the rules file every record they can place in one run, whatever the model limit; the rest wait for the model', async () => {
  await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag, members, country) VALUES ('sweep-demo', NULL, 'Sweep', 'prospect', 'lt-firm', '{}', 'US')`);
  const placeable: string[] = [];
  for (let i = 0; i < 30; i++) placeable.push(await item({ type: 'invoice', title: `Sweep invoice ${i}`, project: 'sweep-demo' }));
  const odd = await item({ title: 'qqq', project: 'sweep-demo' });
  let asked = 0;
  const provider = new FakeProvider(() => { asked++; return '{}'; });
  const s = await fileBacklog(db, provider, { limit: 1 });
  assert.ok(s.filed >= 30, `filed ${s.filed}`);
  for (const id of placeable) assert.equal((await current(id)).folder, 'financial');
  assert.equal(asked, 1, 'only the record the rules could not place went to the model');
  assert.equal((await current(odd)).folder, 'unsorted');
});

test('the project\'s own WorkDrive folder names place a file, below the mapped root and never into Legal or Financial', () => {
  const assets = [{ id: 'w1', name: 'Frost 2', kind: 'well' }];
  const at = (path: string, name = 'x.pdf') => ruleFiling({ id: 'x', type: 'report', title: name, client_id: null, project_id: PID, origin: { source: 'zoho-workdrive' }, extracted: { filename: name, workdrive: { path } }, asset_ids: [] }, assets)?.folder ?? null;
  assert.equal(at('Alpha technical / Parker Creek/Geology/Maps'), 'subsurface');
  assert.equal(at('Alpha technical / Parker Creek/Production'), 'subsurface/fields');
  assert.equal(at('Alpha technical / Parker Creek/Well Files/Frost 2', 'Frost 2 deviation.pdf'), 'subsurface/wells/w1');
  assert.equal(at('Alpha technical / Parker Creek/Facilities'), 'facilities');
  assert.equal(at('Alpha technical / Parker Creek/Permits'), 'government');
  assert.equal(at('Alpha technical / Parker Creek/Land and Title'), null, 'a land folder is not filed into Legal by its name');
  assert.equal(at('Production Team / Parker Creek'), null, 'the mapped root\'s own name is not read');
  assert.equal(at('Alpha technical / Production/Misc'), null, 'not even when it holds a slash');
});
