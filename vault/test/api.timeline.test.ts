import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-timeline-'));
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
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof app, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const base = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown> = {}) => ({ ...base, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], project_id: 'timeline-p', client_id: 'frontera', legal_tag: 'lt-frontera-nda-2026', ...o });
const item = (o: Record<string, unknown> = {}) => ({ type: 'note', title: 'Note', project_id: 'timeline-p', origin: { source: 'upload' }, content_hash: hashOf(randomUUID()), ...o });

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('timeline-p','frontera','Timeline project','lt-frontera-nda-2026','{chris}')");
  app = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('AC6: timeline of a project with 50 seeded records is newest first and returns in under 300 ms', async () => {
  const ids: { ref: string; at: string }[] = [];
  for (let i = 0; i < 25; i++) {
    const at = new Date(Date.UTC(2026, 0, 1 + i * 2, 9)).toISOString();
    const r = run({ created_at: at, title: `Run ${i}`, inputs: i ? [{ ref: `run:${ids[i - 1].ref.slice(4)}`, kind: 'run' }] : [] });
    assert.equal((await call(app, 'POST', '/api/runs', r)).status, 201);
    ids.push({ ref: `run:${r.id}`, at });
  }
  for (let i = 0; i < 25; i++) {
    const at = new Date(Date.UTC(2026, 0, 2 + i * 2, 9)).toISOString();
    const r = await call(app, 'POST', '/api/items', item({ title: `Item ${i}`, created_at: at, cites: [ids[i].ref] }));
    assert.equal(r.status, 201);
  }
  const t0 = performance.now();
  const r = await call(app, 'GET', '/api/projects/timeline-p/timeline');
  const ms = performance.now() - t0;
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.entries.length, 50);
  assert.equal(body.count, 50);
  assert.ok(ms < 300, `timeline took ${ms.toFixed(0)} ms`);
  const times = body.entries.map((e: any) => e.at);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.equal(body.entries[0].title, 'Item 24');
  assert.deepEqual(new Set(body.entries.map((e: any) => e.kind)), new Set(['run', 'item']));
  for (const e of body.entries) assert.equal(e.stale, false);
});

test('AC3: after supersede the timeline shows both runs with the link, and stale flags come through', async () => {
  const old = run({ project_id: 'timeline-p', created_at: '2026-06-01T00:00:00Z', title: 'Old base', status: 'final' });
  const next = run({ project_id: 'timeline-p', created_at: '2026-06-02T00:00:00Z', title: 'New base', status: 'final' });
  await call(app, 'POST', '/api/runs', old);
  await call(app, 'POST', `/api/runs/${old.id}/supersede`, next);
  await db.query(`UPDATE runs SET stale = true, stale_reasons = '[{"rule":"R1","ref":"tool:x","detail":"newer breaking version"}]'::jsonb WHERE id = $1`, [next.id]);
  const body = await (await call(app, 'GET', '/api/projects/timeline-p/timeline')).json();
  const o = body.entries.find((e: any) => e.id === old.id), n = body.entries.find((e: any) => e.id === next.id);
  assert.equal(o.status, 'superseded'); assert.equal(o.superseded_by, next.id);
  assert.equal(n.supersedes, old.id); assert.equal(n.superseded_by, null);
  assert.equal(n.stale, true); assert.equal(n.stale_reasons[0].rule, 'R1');
  assert.ok(body.entries.indexOf(n) < body.entries.indexOf(o), 'newer first');
});

test('timeline respects scope, hidden records and unknown projects', async () => {
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  assert.equal((await call(ana, 'GET', '/api/projects/timeline-p/timeline')).status, 403);
  assert.equal((await call(app, 'GET', '/api/projects/nope/timeline')).status, 404);
  const r = run({ title: 'Hide me' }); await call(app, 'POST', '/api/runs', r);
  await call(app, 'POST', `/api/runs/${r.id}/hide`);
  const body = await (await call(app, 'GET', '/api/projects/timeline-p/timeline')).json();
  assert.ok(!body.entries.some((e: any) => e.id === r.id));
  // member associate: sees it
  await db.query("UPDATE projects SET members = '{chris,ana.perez}' WHERE id = 'timeline-p'");
  assert.equal((await call(ana, 'GET', '/api/projects/timeline-p/timeline')).status, 200);
  // expired tag: records vanish from the timeline
  await db.query("UPDATE legal_tags SET expires_at = '2026-01-01' WHERE id = 'lt-frontera-nda-2026'");
  assert.equal((await call(app, 'GET', '/api/projects/timeline-p/timeline')).status, 404);
  await db.query("UPDATE legal_tags SET expires_at = NULL WHERE id = 'lt-frontera-nda-2026'");
});

test('lineage: nodes and edges from run_inputs, item_cites, supersedes and parents; foreign nodes stay described only when visible', async () => {
  const a = run({ title: 'A' }), b = run({ title: 'B', inputs: [{ ref: `run:${a.id}`, kind: 'run', role: 'seed_model' }, { ref: 'ref:price_decks/brent-2026-09', kind: 'reference', role: 'price_deck' }], parents: [a.id] });
  await call(app, 'POST', '/api/runs', a); await call(app, 'POST', '/api/runs', b);
  const it = await (await call(app, 'POST', '/api/items', item({ title: 'Letter', type: 'letter', cites: [`run:${b.id}`, `doc:00000000-0000-4000-8000-000000000053`] }))).json();
  const g = await (await call(app, 'GET', '/api/projects/timeline-p/lineage')).json();
  const node = (id: string) => g.nodes.find((n: any) => n.id === id);
  assert.equal(node(`run:${a.id}`).label, 'A');
  assert.equal(node(`doc:${it.id}`).kind, 'item');
  assert.equal(node('ref:price_decks/brent-2026-09').kind, 'reference');
  const has = (from: string, to: string, type: string) => g.edges.some((e: any) => e.from === from && e.to === to && e.type === type);
  assert.ok(has(`run:${a.id}`, `run:${b.id}`, 'input'));
  assert.ok(has('ref:price_decks/brent-2026-09', `run:${b.id}`, 'input'));
  assert.ok(has(`run:${a.id}`, `run:${b.id}`, 'parent'));
  assert.ok(has(`run:${b.id}`, `doc:${it.id}`, 'cites'));
  assert.equal(g.edges.find((e: any) => e.to === `run:${b.id}` && e.type === 'input' && e.from === `run:${a.id}`).role, 'seed_model');
  // the NDA (firm tag) is cited from another project and is described; every edge endpoint has a node
  assert.equal(node('doc:00000000-0000-4000-8000-000000000053').label, 'Mutual NDA ATC / Petrolera del Orinoco');
  for (const e of g.edges) { assert.ok(node(e.from), e.from); assert.ok(node(e.to), e.to); }
  // an item mixing two clients' confidential citations is refused rather than stored
  assert.equal((await call(app, 'POST', '/api/items', item({ title: 'cites foreign', cites: ['doc:00000000-0000-4000-8000-000000000051'] }))).status, 409);
});

test('lineage describes a node in another project only to callers who may see it', async () => {
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('frontera-other','frontera','Other Frontera job','lt-frontera-nda-2026','{chris}')");
  const hidden = run({ project_id: 'frontera-other', title: 'Secret upstream' });
  await call(app, 'POST', '/api/runs', hidden);
  const user = run({ title: 'Downstream', inputs: [{ ref: `run:${hidden.id}`, kind: 'run' }] });
  await call(app, 'POST', '/api/runs', user);
  await db.query("UPDATE projects SET members = '{chris,ana.perez}' WHERE id = 'timeline-p'");
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  const forAna = await (await call(ana, 'GET', '/api/projects/timeline-p/lineage')).json();
  const forChris = await (await call(app, 'GET', '/api/projects/timeline-p/lineage')).json();
  assert.deepEqual(forAna.nodes.find((n: any) => n.id === `run:${hidden.id}`), { id: `run:${hidden.id}`, kind: 'run', restricted: true });
  assert.equal(forChris.nodes.find((n: any) => n.id === `run:${hidden.id}`).label, 'Secret upstream');
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'timeline-p'");
});

test('vintages: final runs per project with headline outputs and deltas against the previous vintage of the same job', async () => {
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('vintage-p',NULL,'Vintages','lt-firm','{}')");
  const mk = (day: number, npv: number, extra: Record<string, unknown> = {}) => run({ project_id: 'vintage-p', client_id: null, legal_tag: 'lt-firm', status: 'final', created_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`,
    outputs: { npv10_musd: { value: npv, unit: 'MMUSD' }, method: { value: 'decline' }, ...(extra.outputs as object ?? {}) }, ...extra });
  const v1 = mk(1, 100), v2 = mk(5, 110), v3 = mk(9, 99, { outputs: { npv10_musd: { value: 99 }, method: { value: 'material-balance' }, rf: { value: 0.3 } } });
  const draft = run({ project_id: 'vintage-p', client_id: null, legal_tag: 'lt-firm', status: 'draft', created_at: '2026-08-10T00:00:00Z' });
  const otherJob = run({ project_id: 'vintage-p', client_id: null, legal_tag: 'lt-firm', status: 'final', job: 'financial-model', created_at: '2026-08-11T00:00:00Z' });
  for (const r of [v1, v2, draft, otherJob]) assert.equal((await call(app, 'POST', '/api/runs', r)).status, 201);
  assert.equal((await call(app, 'POST', `/api/runs/${v2.id}/supersede`, v3)).status, 201);
  const body = await (await call(app, 'GET', '/api/projects/vintage-p/vintages')).json();
  assert.equal(body.project_id, 'vintage-p');
  const ids = body.vintages.map((v: any) => v.run_id);
  assert.deepEqual(ids, [otherJob.id, v3.id, v2.id, v1.id], 'final runs only (superseded ones included), newest first');
  const byId = (id: string) => body.vintages.find((v: any) => v.run_id === id);
  assert.equal(byId(v1.id).previous_run_id, null);
  assert.deepEqual(byId(v1.id).deltas, {});
  assert.equal(byId(v2.id).previous_run_id, v1.id);
  assert.deepEqual(byId(v2.id).deltas, { npv10_musd: { previous: 100, current: 110, delta: 10, delta_pct: 10 } });
  assert.equal(byId(v2.id).superseded, true);
  assert.equal(byId(v3.id).previous_run_id, v2.id);
  assert.deepEqual(byId(v3.id).deltas.npv10_musd, { previous: 110, current: 99, delta: -11, delta_pct: -10 });
  assert.deepEqual(byId(v3.id).deltas.method, { previous: 'decline', current: 'material-balance', delta: null, delta_pct: null });
  assert.deepEqual(byId(v3.id).deltas.rf, { previous: null, current: 0.3, delta: null, delta_pct: null });
  assert.equal(byId(v3.id).outputs.npv10_musd.value, 99);
  assert.equal(byId(otherJob.id).previous_run_id, null);
});

test('projects: create (partners only), list scoped, get; clients; assets search', async () => {
  const create = (a: typeof app, b: unknown) => call(a, 'POST', '/api/projects', b);
  let r = await create(app, { id: 'new-client-job', client_id: 'frontera', name: 'New job', default_legal_tag: 'lt-frontera-nda-2026', contacts: [] });
  assert.equal(r.status, 201);
  const p = await r.json();
  assert.deepEqual([p.id, p.client_id, p.default_legal_tag, p.status, p.members], ['new-client-job', 'frontera', 'lt-frontera-nda-2026', 'active', ['chris']]);
  assert.equal((await create(app, { id: 'new-client-job', client_id: 'frontera', name: 'again', default_legal_tag: 'lt-frontera-nda-2026' })).status, 409);
  assert.equal((await create(app, { id: 'x', name: 'bad id' })).status, 400);
  assert.equal((await (await create(app, { id: 'no-tag', client_id: 'frontera', name: 'n' })).json()).error.path, '/default_legal_tag');
  assert.equal((await (await create(app, { id: 'wrong-tag', client_id: 'frontera', name: 'n', default_legal_tag: 'lt-orinoco-nda-2026' })).json()).error.path, '/default_legal_tag');
  assert.equal((await (await create(app, { id: 'no-org', client_id: 'ghost', name: 'n', default_legal_tag: 'lt-firm' })).json()).error.path, '/client_id');
  const internal = await (await create(app, { id: 'internal-work', name: 'Internal' })).json();
  assert.equal(internal.default_legal_tag, 'lt-firm');
  const withContacts = await create(app, { id: 'with-contacts', client_id: 'petrolera-del-orinoco', name: 'With contacts', default_legal_tag: 'lt-orinoco-nda-2026', contacts: ['maria-fernandez'] });
  assert.deepEqual((await withContacts.json()).contacts, ['maria-fernandez']);

  const ana = await appFor(`ana.perez@${DOMAIN}`);
  assert.equal((await create(ana, { id: 'ana-job', name: 'n' })).status, 403);
  const partnerIds = (await (await call(app, 'GET', '/api/projects')).json()).projects.map((x: any) => x.id);
  assert.ok(partnerIds.includes('new-client-job') && partnerIds.includes('orinoco-partnership') && partnerIds.includes('firm'));
  const anaIds = (await (await call(ana, 'GET', '/api/projects')).json()).projects.map((x: any) => x.id);
  assert.ok(anaIds.includes('firm') && anaIds.includes('internal-work') && !anaIds.includes('new-client-job'));
  assert.equal((await call(ana, 'GET', '/api/projects/new-client-job')).status, 403);
  assert.equal((await call(app, 'GET', '/api/projects/new-client-job')).status, 200);

  const clients = (await (await call(app, 'GET', '/api/clients')).json()).clients;
  const fr = clients.find((c: any) => c.id === 'frontera');
  assert.ok(fr.project_ids.includes('new-client-job') && fr.project_count >= 2);
  assert.ok(clients.some((c: any) => c.id === 'petrolera-del-orinoco'));
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'timeline-p'");
  const anaClients = (await (await call(ana, 'GET', '/api/clients')).json()).clients;
  assert.ok(!anaClients.some((c: any) => c.id === 'frontera'));

  const assets = async (qs: string) => (await (await call(app, 'GET', `/api/assets${qs}`)).json()).assets;
  assert.ok((await assets('?q=rubiales')).some((a: any) => a.id === 'field:llanos:rubiales'));
  assert.ok((await assets('?q=LLANOS&kind=basin')).every((a: any) => a.kind === 'basin'));
  assert.deepEqual(await assets('?q=zzzz-nothing'), []);
  assert.ok((await assets('')).length > 5);
  assert.equal((await assets('?q=%25')).length, 0, 'LIKE wildcards are escaped');
});
