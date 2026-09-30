import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-audit-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { audit } = await import('../src/audit.ts');
const { purge } = await import('../src/api/settings.routes.ts');
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
const run = (o: Record<string, unknown> = {}) => ({ ...base, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], project_id: 'orinoco-partnership', client_id: 'petrolera-del-orinoco', legal_tag: 'lt-orinoco-nda-2026', ...o });
const count = async () => Number((await db.query('SELECT count(*) AS n FROM audit_events')).rows[0].n);
const last = async () => (await db.query<any>('SELECT * FROM audit_events ORDER BY id DESC LIMIT 1')).rows[0];

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  app = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('audit() appends one row with person, action, scope, refs and detail', async () => {
  const before = await count();
  await audit(db, 'chris', 'unit.test', 'project:x', ['run:1', 'doc:2'], { a: 1 });
  await audit(db, 'chris', 'unit.bare', null, []);
  assert.equal(await count(), before + 2);
  const rows = (await db.query<any>('SELECT * FROM audit_events ORDER BY id DESC LIMIT 2')).rows.reverse();
  assert.deepEqual([rows[0].person_id, rows[0].action, rows[0].scope, rows[0].refs, rows[0].detail], ['chris', 'unit.test', 'project:x', ['run:1', 'doc:2'], { a: 1 }]);
  assert.deepEqual([rows[1].scope, rows[1].refs, rows[1].detail], [null, [], {}]);
  await assert.rejects(db.query("UPDATE audit_events SET action = 'x'"), /append-only/);
  await assert.rejects(db.query('DELETE FROM audit_events'), /append-only/);
});

test('AC5: every handler writes exactly one audit event, on success and on refusal', async () => {
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  const a = run(), b = run();
  const itemMeta = { type: 'note', title: 'Audited', project_id: 'orinoco-partnership', origin: { source: 'upload' }, content_hash: hashOf('audited') };
  const state: Record<string, any> = {};
  const seedJson = fixture('ac15/seed.json');
  const nda = seedJson.nda_item.id;
  const disp = seedJson.dispatches[0].id;

  type Step = [label: string, action: string, who: typeof app, req: () => Promise<Response>, status: number];
  const steps: Step[] = [
    ['run create', 'run.create', app, () => call(app, 'POST', '/api/runs', a), 201],
    ['run dedupe', 'run.create', app, () => call(app, 'POST', '/api/runs', run({ input_hash: a.input_hash })), 200],
    ['run invalid', 'run.create', app, () => call(app, 'POST', '/api/runs', { nope: 1 }), 400],
    ['run bad json', 'run.create', app, async () => await app.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), 400],
    ['run read', 'run.read', app, () => call(app, 'GET', `/api/runs/${a.id}`), 200],
    ['run read 404', 'run.read', app, () => call(app, 'GET', `/api/runs/${randomUUID()}`), 404],
    ['run read 403', 'run.read', ana, () => call(ana, 'GET', `/api/runs/${a.id}`), 403],
    ['run list', 'run.list', app, () => call(app, 'GET', '/api/runs?project=orinoco-partnership'), 200],
    ['run supersede', 'run.supersede', app, () => call(app, 'POST', `/api/runs/${a.id}/supersede`, b), 201],
    ['run supersede twice', 'run.supersede', app, () => call(app, 'POST', `/api/runs/${a.id}/supersede`, run()), 409],
    ['run PUT', 'run.mutate_refused', app, () => call(app, 'PUT', `/api/runs/${a.id}`, {}), 409],
    ['run PATCH', 'run.mutate_refused', app, () => call(app, 'PATCH', `/api/runs/${a.id}`, {}), 409],
    ['item create', 'item.create', app, async () => { const r = await call(app, 'POST', '/api/items', itemMeta); state.item = (await r.clone().json()).id; return r; }, 201],
    ['item dedupe', 'item.create', app, () => call(app, 'POST', '/api/items', { ...itemMeta, id: state.item }), 200],
    ['item invalid', 'item.create', app, () => call(app, 'POST', '/api/items', { type: 'nope' }), 400],
    ['item read', 'item.read', app, () => call(app, 'GET', `/api/items/${state.item}`), 200],
    ['item read 403', 'item.read', ana, () => call(ana, 'GET', `/api/items/${state.item}`), 403],
    ['item versions', 'item.versions', app, () => call(app, 'GET', `/api/items/${state.item}/versions`), 200],
    ['item list', 'item.list', app, () => call(app, 'GET', '/api/items?project=orinoco-partnership'), 200],
    ['item PUT', 'item.mutate_refused', app, () => call(app, 'PUT', `/api/items/${state.item}`, {}), 409],
    ['item version PATCH', 'item.mutate_refused', app, () => call(app, 'PATCH', `/api/items/${state.item}/versions/1`, {}), 409],
    ['project create', 'project.create', app, () => call(app, 'POST', '/api/projects', { id: 'audit-p', name: 'Audit project' }), 201],
    ['project create 403', 'project.create', ana, () => call(ana, 'POST', '/api/projects', { id: 'audit-q', name: 'x' }), 403],
    ['project list', 'project.list', app, () => call(app, 'GET', '/api/projects'), 200],
    ['project read', 'project.read', app, () => call(app, 'GET', '/api/projects/audit-p'), 200],
    ['project timeline', 'project.timeline', app, () => call(app, 'GET', '/api/projects/orinoco-partnership/timeline'), 200],
    ['project timeline 403', 'project.timeline', ana, () => call(ana, 'GET', '/api/projects/orinoco-partnership/timeline'), 403],
    ['project lineage', 'project.lineage', app, () => call(app, 'GET', '/api/projects/orinoco-partnership/lineage'), 200],
    ['project vintages', 'project.vintages', app, () => call(app, 'GET', '/api/projects/orinoco-partnership/vintages'), 200],
    ['clients', 'client.list', app, () => call(app, 'GET', '/api/clients'), 200],
    ['assets', 'asset.search', app, () => call(app, 'GET', '/api/assets?q=llanos'), 200],
    ['org create', 'organisation.create', app, () => call(app, 'POST', '/api/organisations', { name: 'Audit Oil Ltd', kind: 'vendor', id: 'audit-oil' }), 201],
    ['org duplicate', 'organisation.create', app, () => call(app, 'POST', '/api/organisations', { name: 'Audit Oil Limited', kind: 'vendor' }), 409],
    ['org list', 'organisation.list', app, () => call(app, 'GET', '/api/organisations?q=audit'), 200],
    ['org read', 'organisation.read', app, () => call(app, 'GET', '/api/organisations/audit-oil'), 200],
    ['org update', 'organisation.update', app, () => call(app, 'PATCH', '/api/organisations/audit-oil', { notes: 'n' }), 200],
    ['org file', 'organisation.file', app, () => call(app, 'GET', '/api/organisations/petrolera-del-orinoco/file'), 200],
    ['org file 404', 'organisation.file', app, () => call(app, 'GET', '/api/organisations/nobody/file'), 404],
    ['contact create', 'contact.create', app, () => call(app, 'POST', '/api/contacts', { organisation_id: 'audit-oil', name: 'Audit Person', emails: ['p@audit-oil.example'] }), 201],
    ['contact duplicate', 'contact.create', app, () => call(app, 'POST', '/api/contacts', { organisation_id: 'audit-oil', name: 'Other', emails: ['p@audit-oil.example'] }), 409],
    ['org delete refused', 'organisation.delete', app, () => call(app, 'DELETE', '/api/organisations/audit-oil'), 409],
    ['dispatch list', 'dispatch.list', app, () => call(app, 'GET', '/api/dispatches?organisation=petrolera-del-orinoco'), 200],
    ['dispatch create', 'dispatch.create', app, async () => { const r = await call(app, 'POST', '/api/dispatches', { item_id: nda, direction: 'in', organisation_id: 'petrolera-del-orinoco', channel: 'hand', occurred_at: '2026-09-01T00:00:00Z' }); state.d = (await r.clone().json()).id; return r; }, 201],
    ['dispatch invalid', 'dispatch.create', app, () => call(app, 'POST', '/api/dispatches', { channel: 'pigeon' }), 400],
    ['dispatch ack', 'dispatch.acknowledge', app, () => call(app, 'POST', `/api/dispatches/${state.d}/acknowledge`), 200],
    ['dispatch ack twice', 'dispatch.acknowledge', app, () => call(app, 'POST', `/api/dispatches/${disp}/acknowledge`), 409],
    ['reserve', 'reference.reserve', app, () => call(app, 'POST', '/api/references/reserve'), 201],
    ['reserve bad year', 'reference.reserve', app, () => call(app, 'POST', '/api/references/reserve', { year: 1 }), 400],
    ['settings put', 'settings.write', app, () => call(app, 'PUT', '/api/settings/audit-key', { value: 1 }), 200],
    ['settings put 403', 'settings.write', ana, () => call(ana, 'PUT', '/api/settings/audit-key', { value: 2 }), 403],
    ['settings read', 'settings.read', app, () => call(app, 'GET', '/api/settings/audit-key'), 200],
    ['settings list', 'settings.list', app, () => call(app, 'GET', '/api/settings'), 200],
    ['settings delete', 'settings.delete', app, () => call(app, 'DELETE', '/api/settings/audit-key'), 200],
    ['firm assets', 'firm-asset.list', app, () => call(app, 'GET', '/api/firm-assets'), 200],
    ['firm asset current', 'firm-asset.current', app, () => call(app, 'GET', '/api/firm-assets/letterhead/current'), 200],
    ['firm asset current 404', 'firm-asset.current', app, () => call(app, 'GET', '/api/firm-assets/letterhead/current?language=zz'), 404],
    ['hide 403', 'record.hide', ana, () => call(ana, 'POST', `/api/items/${state.item}/hide`), 403],
    ['hide', 'record.hide', app, () => call(app, 'POST', `/api/items/${state.item}/hide`), 200],
    ['hide unknown kind', 'record.hide', app, () => call(app, 'POST', `/api/organisations/x/hide`), 404],
  ];

  for (const [label, action, who, req, status] of steps) {
    const n0 = await count();
    const res = await req();
    assert.equal(res.status, status, `${label}: status`);
    assert.equal(await count(), n0 + 1, `${label}: exactly one audit event`);
    const row = await last();
    assert.equal(row.action, action, `${label}: action`);
    assert.equal(row.detail.status, status, `${label}: detail.status`);
    assert.equal(row.person_id, who === ana ? 'ana.perez' : 'chris', `${label}: person`);
  }
  // scope and refs are meaningful, not empty
  const { rows } = await db.query<any>("SELECT scope, refs FROM audit_events WHERE action = 'run.create' AND detail->>'status' = '201' ORDER BY id DESC LIMIT 1");
  assert.equal(rows[0].scope, 'project:orinoco-partnership');
  assert.deepEqual(rows[0].refs, [`run:${a.id}`]);
});

test('purge refuses when anything cites the record and audits once either way; only partners may purge', async () => {
  const lone = run(); await call(app, 'POST', '/api/runs', lone);
  const cited = run(); await call(app, 'POST', '/api/runs', cited);
  const citer = run({ inputs: [{ ref: `run:${cited.id}`, kind: 'run' }] }); await call(app, 'POST', '/api/runs', citer);
  const partner = { id: 'chris', email: `chris@${DOMAIN}`, name: 'Chris', role: 'partner' as const };
  const associate = { id: 'ana.perez', email: `ana.perez@${DOMAIN}`, name: 'Ana', role: 'associate' as const };

  let n = await count();
  await assert.rejects(purge(db, partner, 'run', cited.id), (e: any) => e.status === 409 && e.code === 'cited' && e.extra.cited_by.includes(`run:${citer.id}`));
  assert.equal(await count(), n + 1);
  assert.equal((await last()).detail.refused, 'cited');
  assert.equal((await db.query('SELECT 1 FROM runs WHERE id = $1', [cited.id])).rows.length, 1, 'still there');

  n = await count();
  await assert.rejects(purge(db, associate, 'run', lone.id), (e: any) => e.status === 403);
  assert.equal(await count(), n + 1);
  await assert.rejects(purge(db, partner, 'run', randomUUID()), (e: any) => e.status === 404);

  n = await count();
  assert.deepEqual(await purge(db, partner, 'run', lone.id), { purged: `run:${lone.id}` });
  assert.equal(await count(), n + 1);
  assert.equal((await db.query('SELECT 1 FROM runs WHERE id = $1', [lone.id])).rows.length, 0);
  assert.equal((await db.query('SELECT 1 FROM run_inputs WHERE run_id = $1', [lone.id])).rows.length, 0);
  // once the citer is gone, the cited run can go too
  await purge(db, partner, 'run', citer.id);
  await purge(db, partner, 'run', cited.id);

  // items: a dispatch, a citation or a supersede link each block a purge; a loose item can be purged with its versions
  const nda = fixture('ac15/seed.json').nda_item.id;
  await assert.rejects(purge(db, partner, 'item', nda), (e: any) => e.code === 'cited' && e.extra.cited_by.some((r: string) => r.startsWith('dispatch:')));
  const meta = (t: string, o: object = {}) => ({ type: 'note', title: t, project_id: 'orinoco-partnership', origin: { source: 'upload' }, content_hash: hashOf(t), ...o });
  const base1 = await (await call(app, 'POST', '/api/items', meta('base'))).json();
  const cites = await (await call(app, 'POST', '/api/items', meta('cites', { cites: [`doc:${base1.id}`] }))).json();
  await assert.rejects(purge(db, partner, 'item', base1.id), (e: any) => e.code === 'cited');
  assert.deepEqual(await purge(db, partner, 'item', cites.id), { purged: `doc:${cites.id}` });
  assert.deepEqual(await purge(db, partner, 'item', base1.id), { purged: `doc:${base1.id}` });
  assert.equal((await db.query('SELECT 1 FROM item_versions WHERE item_id = $1', [base1.id])).rows.length, 0);
  // a run that lists an item as an artifact cites it
  const art = await (await call(app, 'POST', '/api/items', meta('artifact'))).json();
  await call(app, 'POST', '/api/runs', run({ artifacts: [`doc:${art.id}`] }));
  await assert.rejects(purge(db, partner, 'item', art.id), (e: any) => e.code === 'cited');
});
