// Wave 7 PR3 (docs/vault-hub/wave7/03-data-hierarchy.md S6, A3, A10; 05-markup.md W7-AC14): the asset hierarchy is
// real. A basin, block, reservoir or well is created under a parent; a run names a well; `asset=` filters runs and
// items; GET /api/assets/:id/file lists what the asset and everything under it carries, scope-checked row by row;
// the GEM import links a unit to the basin the tracker names, creating the basin when it is absent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-hier-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureGazetteers } = await import('../src/api/assets.routes.ts');
const { assetLineage, assetDescendants, linkGemBasins } = await import('../src/assets/hierarchy.ts');
const { buildCatalog } = await import('../src/catalog.ts');
const { runInputHash } = await import('../src/hash.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOMAIN = 'alpha-technical-centre.com';
const catalog = buildCatalog(ROOT);
const nodal = JSON.parse(readFileSync(path.join(ROOT, 'test/e2e/fixtures/nodal-analysis.json'), 'utf8'));
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>, ben: typeof partner;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const sha = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const GEM_DETAIL = { unit_id: 'G100', status: 'operating', unit_type: 'oil field', onshore: 'onshore', operator: 'PDVSA', basin: 'Barinas-Apure', discovery_year: 1984, wiki_url: 'https://www.gem.wiki/Guafita_Oil_Field', release: 'March 2026' };

/** A nodal run the way js/vault-client.js posts it from the tool page opened with ?project=&asset=. */
function nodalRun(project: string, tag: string, assets: string[]): any {
  const m = catalog.tools.find(t => t.id === 'nodal-analysis')!;
  const v = m.versions.find(x => x.version === m.aliases.current)!;
  const rec: any = {
    id: randomUUID(), job: 'nodal-analysis', tool_version: v.version, tool_commit: v.commit, author: 'chris', created_at: '2026-09-20T10:00:00Z',
    project_id: project, asset_ids: assets, legal_tag: tag, title: `Guafita-1 nodal ${randomUUID().slice(0, 6)}`,
    inputs: [{ ref: 'tool:nodal-analysis', kind: 'manual' }], assumptions: {}, params: { ...nodal.params, salt: randomUUID() }, outputs: nodal.expected, status: 'draft',
  };
  rec.input_hash = runInputHash(rec);
  return rec;
}

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','CO')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('ven-barinas',NULL,'Barinas–Apure Cluster','prospect','lt-firm','VE','{chris}')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('ven-private','frontera','Private Venezuela work','active','lt-frontera-nda-2026','VE','{chris}')");
  configureGazetteers({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });
  partner = await appFor(`chris@${DOMAIN}`); ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('W7-AC14: a GEM field lands under the basin the tracker names; reservoir and well are created under a parent; lineage walks up', async () => {
  const f = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Guafita', kind: 'field', lat: 7.6, lon: -70.9, location_source: 'gem', source_id: 'G100', detail: GEM_DETAIL } });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  assert.equal(f.body.asset.id, 'field:ve:guafita');
  assert.equal(f.body.asset.parent_id, 'basin:barinas-apure', 'the basin the tracker names becomes the parent: master data already has it, so it is reused by name');
  assert.equal((await db.query<any>("SELECT count(*)::int AS n FROM assets WHERE kind = 'basin' AND lower(name) = 'barinas-apure'")).rows[0].n, 1, 'no second basin of the same name');

  const r = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Escandalosa', kind: 'reservoir', parent_id: 'field:ve:guafita' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.asset.id, 'reservoir:ve:escandalosa'); assert.equal(r.body.asset.parent_id, 'field:ve:guafita'); assert.equal(r.body.asset.country, 'VE', 'the country comes from the parent');
  const w = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Guafita-1', kind: 'well', parent_id: 'reservoir:ve:escandalosa' } });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.equal(w.body.asset.id, 'well:ve:guafita-1'); assert.equal(w.body.asset.parent_id, 'reservoir:ve:escandalosa');
  const p = (await db.query<any>("SELECT asset_ids FROM projects WHERE id = 'ven-barinas'")).rows[0];
  assert.deepEqual(p.asset_ids, ['field:ve:guafita', 'reservoir:ve:escandalosa', 'well:ve:guafita-1'], 'each child is attached to the project too');

  const lineage = await assetLineage(db, 'well:ve:guafita-1');
  assert.deepEqual(lineage.map(a => [a.id, a.kind, a.depth]), [['well:ve:guafita-1', 'well', 0], ['reservoir:ve:escandalosa', 'reservoir', 1], ['field:ve:guafita', 'field', 2], ['basin:barinas-apure', 'basin', 3]]);
  const below = await assetDescendants(db, 'field:ve:guafita');
  assert.deepEqual(below.map(a => a.id).sort(), ['reservoir:ve:escandalosa', 'well:ve:guafita-1']);
  assert.deepEqual(await assetLineage(db, 'no:such:asset'), []);

  // A parent that does not exist, or one below the child in the hierarchy, is refused with the path.
  const bad = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Orphan-2', kind: 'well', parent_id: 'field:ve:nowhere' } });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'unknown_asset'); assert.equal(bad.body.error.path, '/create/parent_id');
  const upside = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Upside Down', kind: 'basin', parent_id: 'well:ve:guafita-1' } });
  assert.equal(upside.status, 400); assert.equal(upside.body.error.path, '/create/parent_id');
  const block = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Apure Norte', kind: 'block', parent_id: 'basin:barinas-apure' } });
  assert.equal(block.status, 201); assert.equal(block.body.asset.id, 'block:ve:apure-norte');
});

test('W7-AC14: a nodal run names the well; asset= filters runs and items; the asset file lists them for the well and for the field above it', async () => {
  const rec = nodalRun('ven-barinas', 'lt-firm', ['well:ve:guafita-1']);
  const saved = await call(partner, 'POST', '/api/runs', rec);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const got = await call(partner, 'GET', `/api/runs/${rec.id}`);
  assert.deepEqual(got.body.asset_ids, ['well:ve:guafita-1']);
  const item = await call(partner, 'POST', '/api/items', { type: 'report', title: 'Guafita-1 well test', project_id: 'ven-barinas', origin: { source: 'upload' }, content_hash: sha('welltest'), asset_ids: ['well:ve:guafita-1'] });
  assert.equal(item.status, 201, JSON.stringify(item.body));

  const byWell = await call(partner, 'GET', '/api/runs?asset=well:ve:guafita-1');
  assert.deepEqual(byWell.body.runs.map((r: any) => r.id), [rec.id]);
  const byOther = await call(partner, 'GET', '/api/runs?asset=well:ve:somewhere-else');
  assert.deepEqual(byOther.body.runs, []);
  const itemsByWell = await call(partner, 'GET', '/api/items?asset=well:ve:guafita-1');
  assert.deepEqual(itemsByWell.body.items.map((i: any) => i.id), [item.body.id]);
  const onField = (await call(partner, 'GET', '/api/items?asset=field:ve:guafita&project=ven-barinas')).body.items;
  assert.ok(onField.length >= 1 && onField.every((i: any) => i.extracted.kind === 'dossier'), 'the filter is exact: the field carries its dossier, not the well test');

  const file = await call(partner, 'GET', '/api/assets/well:ve:guafita-1/file');
  assert.equal(file.status, 200, JSON.stringify(file.body));
  assert.equal(file.body.asset.id, 'well:ve:guafita-1');
  assert.deepEqual(file.body.lineage.map((a: any) => a.id), ['reservoir:ve:escandalosa', 'field:ve:guafita', 'basin:barinas-apure']);
  assert.deepEqual(file.body.runs.map((r: any) => r.id), [rec.id]);
  assert.equal(file.body.runs[0].status, 'draft'); assert.equal(file.body.runs[0].job, 'nodal-analysis'); assert.ok(file.body.runs[0].outputs.operating_point_rate.unit);
  assert.deepEqual(file.body.items.map((i: any) => i.id), [item.body.id]);
  assert.deepEqual(file.body.projects, ['ven-barinas']);

  const field = await call(partner, 'GET', '/api/assets/field:ve:guafita/file');
  assert.equal(field.status, 200);
  assert.deepEqual(field.body.children.map((a: any) => a.id), ['reservoir:ve:escandalosa']);
  assert.deepEqual(field.body.descendants.map((a: any) => a.id).sort(), ['reservoir:ve:escandalosa', 'well:ve:guafita-1']);
  assert.deepEqual(field.body.runs.map((r: any) => r.id), [rec.id], 'the field file lists the run on its well');
  assert.deepEqual(field.body.runs[0].asset_ids, ['well:ve:guafita-1']);
  assert.equal(field.body.dossier.length, 1, 'the GEM dossier filed on attach'); assert.equal(field.body.dossier[0].extracted.kind, 'dossier');
  assert.ok(field.body.items.some((i: any) => i.id === item.body.id));
  assert.equal((await call(partner, 'GET', '/api/assets/no:such:asset/file')).status, 404);

  // Scope: a run on the same well inside a client project is in the partner's file and not in a non-member's.
  const priv = nodalRun('ven-private', 'lt-frontera-nda-2026', ['well:ve:guafita-1']);
  assert.equal((await call(partner, 'POST', '/api/runs', priv)).status, 201);
  const all = await call(partner, 'GET', '/api/assets/field:ve:guafita/file');
  assert.deepEqual(all.body.runs.map((r: any) => r.id).sort(), [rec.id, priv.id].sort());
  assert.deepEqual(all.body.projects.sort(), ['ven-barinas', 'ven-private']);
  const theirs = await call(ben, 'GET', '/api/assets/field:ve:guafita/file');
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.body.runs.map((r: any) => r.id), [rec.id], 'the client project run is outside the associate\'s scope');
  assert.deepEqual(theirs.body.projects, ['ven-barinas']);
  const audit = (await db.query<any>("SELECT scope, refs FROM audit_events WHERE action = 'asset.file' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audit.scope, 'firm'); assert.ok(audit.refs.includes('asset:field:ve:guafita'));
});

test('W7-AC14: the GEM import links every unit to the basin the tracker names, creating the basin once, and leaves a parent a person set alone', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gem-parent-'));
  const unit = (u: Record<string, unknown>) => ({ unit_type: 'oil field', production_type: 'conventional', status: 'operating', lat: 7.6, lon: -70.9, ...u });
  writeFileSync(path.join(dir, 'gem-fields.json'), JSON.stringify({ release: 'March 2026', units: [
    unit({ unit_id: 'G100', name: 'Guafita Oil Field', short_name: 'Guafita', country: 'VE', basin: 'Barinas-Apure' }),
    unit({ unit_id: 'G101', name: 'Cumarebo Oil Field', short_name: 'Cumarebo', country: 'VE', basin: 'Falcón Oriental', lat: 11.5, lon: -69.4 }),
    unit({ unit_id: 'G102', name: 'Tiguaje Oil Field', short_name: 'Tiguaje', country: 'VE', basin: 'Falcón Oriental', lat: 11.4, lon: -69.5 }),
    unit({ unit_id: 'G200', name: 'Rubiales Oil Field', short_name: 'Rubiales', country: 'CO', basin: 'Llanos Orientales', lat: 3.85, lon: -71.3 }),
    unit({ unit_id: 'G300', name: 'Nameless Oil Field', short_name: 'Nameless', country: 'VE', basin: null }),
  ] }));
  const fresh = await openDb(undefined); await migrate(fresh);
  await seedMaster(fresh, { gemFile: path.join(dir, 'gem-fields.json') });
  const first = await linkGemBasins(fresh);
  assert.equal(first.linked, 3, 'Guafita onto the master basin, the two Falcón units onto a new one; Rubiales keeps the parent master data gave it; Nameless names no basin');
  assert.equal(first.basins_created, 1, 'Falcón Oriental once; Barinas-Apure is master data');
  const rows = Object.fromEntries((await fresh.query<any>("SELECT id, parent_id FROM assets WHERE props ? 'gem' OR id = 'field:llanos:rubiales'")).rows.map((r: any) => [r.id, r.parent_id]));
  assert.equal(rows['field:ve:guafita'], 'basin:barinas-apure');
  assert.equal(rows['field:ve:cumarebo'], 'basin:ve:falcon-oriental'); assert.equal(rows['field:ve:tiguaje'], 'basin:ve:falcon-oriental');
  assert.equal(rows['field:llanos:rubiales'], 'basin:llanos', 'a parent that was already set is never overwritten');
  assert.equal(rows['field:ve:nameless'], null);
  const basin = (await fresh.query<any>("SELECT kind, name, country, props FROM assets WHERE id = 'basin:ve:falcon-oriental'")).rows[0];
  assert.equal(basin.kind, 'basin'); assert.equal(basin.name, 'Falcón Oriental'); assert.equal(basin.country, 'VE'); assert.equal(basin.props.source, 'gem');
  const second = await linkGemBasins(fresh);
  assert.deepEqual(second, { linked: 0, basins_created: 0 }, 'a second pass finds nothing to do');
  await fresh.close();
});
