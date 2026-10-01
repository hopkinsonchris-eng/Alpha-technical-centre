// Wave 3, PR 1 (docs/vault-hub/wave3/05-markup.md §1.7): attaching fields to projects, the
// dossier filed on attach, and who may do it. Smoke tests for W3-AC2 and W3-AC3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-assets-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureGazetteers } = await import('../src/api/assets.routes.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>, ana: typeof partner, ben: typeof partner;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const GEM_DETAIL = { unit_id: 'G100', status: 'operating', unit_type: 'field', onshore: 'onshore', operator: 'PDVSA', owners: 'PDVSA (100%)', discovery_year: 1984, production_start_year: 1986, production: { value: 12.4, unit: 'thousand bbl/d', year: 2024 }, reserves: null, wiki_url: 'https://www.gem.wiki/Guafita_Oil_Field', release: 'March 2026' };

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'), ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','CO')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('ven-barinas',NULL,'Barinas–Apure Cluster','prospect','lt-firm','VE','{chris}')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('llanos-waterflood','frontera','Llanos waterflood','active','lt-frontera-nda-2026','CO','{chris,ana}')");
  configureGazetteers({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });   // no network in tests
  partner = await appFor(`chris@${DOMAIN}`); ana = await appFor(`ana@${DOMAIN}`); ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('W3-AC2: attaching a new field creates it with its location source, links it to the project and files the dossier once', async () => {
  const r = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Guafita', kind: 'field', lat: 7.6, lon: -70.9, location_source: 'gem', source_id: 'G100', source_url: 'https://www.gem.wiki/Guafita_Oil_Field', detail: GEM_DETAIL } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.asset.id, 'field:ve:guafita');
  assert.equal(r.body.asset.country, 'VE');
  assert.equal(r.body.asset.location_source, 'gem');
  assert.equal(r.body.asset.lat, 7.6);
  assert.equal(r.body.attached, true);
  assert.equal(r.body.dossier.length, 1);
  const p = (await db.query<any>("SELECT asset_ids FROM projects WHERE id = 'ven-barinas'")).rows[0];
  assert.deepEqual(p.asset_ids, ['field:ve:guafita']);
  const item = (await db.query<any>('SELECT type, title, legal_tag, project_id, origin, external_id, extracted, asset_ids FROM items WHERE id = $1', [r.body.dossier[0]])).rows[0];
  assert.equal(item.type, 'note');
  assert.equal(item.title, 'Field dossier: Guafita');
  assert.equal(item.legal_tag, 'lt-public');
  assert.equal(item.project_id, 'ven-barinas');
  assert.equal(item.origin.source, 'gem');
  assert.equal(item.external_id, 'gem:G100');
  assert.equal(item.extracted.kind, 'dossier');
  assert.equal(item.extracted.operator, 'PDVSA');
  assert.match(item.extracted.attribution, /Global Energy Monitor.*CC BY 4\.0/);
  assert.deepEqual(item.asset_ids, ['field:ve:guafita']);
  const audit = (await db.query<any>("SELECT scope, refs, detail FROM audit_events WHERE action = 'project.asset.attach' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audit.scope, 'project:ven-barinas');
  assert.ok(audit.refs.includes('asset:field:ve:guafita'));

  // Attaching the same field again (by id) changes nothing and files nothing new.
  const again = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { asset_id: 'field:ve:guafita' });
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
  assert.equal(again.body.dossier.length, 0);
  assert.equal(Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE external_id = 'gem:G100'")).rows[0].n), 1);

  // Listing shows the asset with its dossier item.
  const list = await call(partner, 'GET', '/api/projects/ven-barinas/assets');
  assert.equal(list.status, 200);
  assert.equal(list.body.assets.length, 1);
  assert.equal(list.body.assets[0].id, 'field:ve:guafita');
  assert.deepEqual(list.body.assets[0].dossier, [r.body.dossier[0]]);

  // A field without any gazetteer detail attaches with no dossier and no location.
  const bare = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'La Victoria', kind: 'field' } });
  assert.equal(bare.status, 201, JSON.stringify(bare.body));
  assert.equal(bare.body.asset.id, 'field:ve:la-victoria');
  assert.equal(bare.body.asset.lat, null);
  assert.equal(bare.body.asset.location_source, null);
  assert.deepEqual(bare.body.dossier, []);

  // Detach removes the link; the asset and the dossier stay.
  const del = await call(partner, 'DELETE', '/api/projects/ven-barinas/assets/field:ve:la-victoria');
  assert.equal(del.status, 200);
  assert.deepEqual((await db.query<any>("SELECT asset_ids FROM projects WHERE id = 'ven-barinas'")).rows[0].asset_ids, ['field:ve:guafita']);
  assert.equal((await db.query("SELECT 1 FROM assets WHERE id = 'field:ve:la-victoria'")).rows.length, 1);
});

test('W3-AC2: validation: kind, name, coordinates, an unknown asset id, and a duplicate name gets a distinct id', async () => {
  const bad = async (body: unknown, where: string) => {
    const r = await call(partner, 'POST', '/api/projects/ven-barinas/assets', body);
    assert.equal(r.status, 400, JSON.stringify(r.body)); assert.equal(r.body.error.path, where);
  };
  await bad({}, '/');
  await bad({ create: { name: '', kind: 'field' } }, '/create/name');
  await bad({ create: { name: 'X', kind: 'planet' } }, '/create/kind');
  await bad({ create: { name: 'X', kind: 'field', lat: 95 } }, '/create/lat');
  await bad({ create: { name: 'X', kind: 'field', lat: 1 } }, '/create/lon');
  const unknown = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { asset_id: 'field:ve:nope' });
  assert.equal(unknown.status, 400); assert.equal(unknown.body.error.path, '/asset_id');
  // Same name in the same country twice: the second gets a suffixed id rather than clobbering the first.
  await db.query("INSERT INTO assets (id, kind, name, country) VALUES ('field:co:cubiro','field','Cubiro','CO')");
  const r = await call(partner, 'POST', '/api/projects/llanos-waterflood/assets', { create: { name: 'Cubiro', kind: 'field', lat: 4.6, lon: -72.1, location_source: 'geonames', source_id: '123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.asset.id, 'field:co:cubiro-2');
});

test('W3-AC3: a member may attach to a client project; an associate who cannot see it gets 404; one who can see but is not a member gets 403', async () => {
  const ok = await call(ana, 'POST', '/api/projects/llanos-waterflood/assets', { asset_id: 'field:co:cubiro' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const hidden = await call(ben, 'POST', '/api/projects/llanos-waterflood/assets', { asset_id: 'field:co:cubiro' });
  assert.equal(hidden.status, 404);
  assert.equal((await call(ben, 'GET', '/api/projects/llanos-waterflood/assets')).status, 404);
  // ben can see the internal Venezuela project (lt-firm) and, as an internal project, may attach to it.
  const internal = await call(ben, 'POST', '/api/projects/ven-barinas/assets', { asset_id: 'field:ve:la-victoria' });
  assert.equal(internal.status, 200, JSON.stringify(internal.body));
  // A client project where ben is visible but not a member: make him able to see it through the firm tag, then refuse the write.
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('frontera-open','frontera','Frontera open file','active','lt-firm','CO','{chris}')");
  const notMember = await call(ben, 'POST', '/api/projects/frontera-open/assets', { asset_id: 'field:co:cubiro' });
  assert.equal(notMember.status, 403);
});

test('W3-AC1: GET /api/assets/locate validates and reports unavailable sources; GET /api/countries carries the attached fields', async () => {
  assert.equal((await call(partner, 'GET', '/api/assets/locate?name=&country=VE')).status, 400);
  assert.equal((await call(partner, 'GET', '/api/assets/locate?name=Guafita&country=venezuela')).status, 400);
  const r = await call(partner, 'GET', '/api/assets/locate?name=Guafita&country=VE');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.candidates[0].asset_id, 'field:ve:guafita');
  assert.equal(r.body.candidates[0].source, 'gem');
  assert.ok(r.body.unavailable.some((u: any) => u.source === 'geonames'));
  const c = await call(partner, 'GET', '/api/countries');
  const ve = c.body.countries.find((x: any) => x.code === 'VE');
  const proj = ve.projects.find((p: any) => p.id === 'ven-barinas');
  assert.deepEqual(proj.assets.map((a: any) => a.id), ['field:ve:guafita', 'field:ve:la-victoria']);
  assert.equal(proj.assets[0].lat, 7.6);
  assert.equal(proj.assets[0].location_source, 'gem');
});

/* ── wave 3 PR 4: a field outside the project's country is flagged and needs confirming; archived projects leave the globe ── */

test('W3-PR4: a record whose coordinates fall outside the project country is refused with 409 outside_country until confirmed, then carries location_check; the countries summary flags it', async () => {
  const trico = { create: { name: 'Trico Gas Field', kind: 'field', lat: 35.85, lon: -119.52, location_source: 'wikidata', source_id: 'Q7840', detail: { operator: 'Chevron' } } };
  const no = await call(partner, 'POST', '/api/projects/ven-barinas/assets', trico);
  assert.equal(no.status, 409, JSON.stringify(no.body));
  assert.equal(no.body.error.code, 'outside_country');
  assert.deepEqual(no.body.error.location_check, { expected: 'VE', found: 'US', method: 'polygon', outside: true });
  assert.equal((await db.query<any>("SELECT count(*)::int AS n FROM assets WHERE lower(name) = 'trico gas field'")).rows[0].n, 0, 'nothing was created');
  const yes = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { ...trico, confirm_outside: true });
  assert.equal(yes.status, 201, JSON.stringify(yes.body));
  assert.deepEqual(yes.body.asset.location_check, { expected: 'VE', found: 'US', method: 'polygon', outside: true });
  const list = await call(partner, 'GET', '/api/projects/ven-barinas/assets');
  const t = list.body.assets.find((a: any) => a.name === 'Trico Gas Field');
  assert.equal(t.location_check.outside, true);
  const ok = list.body.assets.find((a: any) => a.name === 'Guafita');
  assert.ok(!ok || ok.location_check === null || ok.location_check.outside === false);
  // A gazetteer record without coordinates but from another country is flagged by its code.
  const named = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { create: { name: 'Elsewhere Block', kind: 'block', country: 'CO' } });
  assert.equal(named.status, 409);
  assert.equal(named.body.error.location_check.method, 'gazetteer');
  // The countries summary says which country the stray point is in.
  const c = await call(partner, 'GET', '/api/countries');
  const ve = c.body.countries.find((x: any) => x.code === 'VE');
  const pr = ve.projects.find((p: any) => p.id === 'ven-barinas');
  assert.equal(pr.assets.find((a: any) => a.name === 'Trico Gas Field').outside, 'US');
  assert.ok(pr.assets.filter((a: any) => a.name !== 'Trico Gas Field').every((a: any) => a.outside === null));
  // Re-attaching an already attached stray field needs no second confirmation.
  const again = await call(partner, 'POST', '/api/projects/ven-barinas/assets', { asset_id: yes.body.asset.id });
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
});

test('W3-PR4: an archived project is hidden from the countries summary (never deleted: its file still answers)', async () => {
  const before = await call(partner, 'GET', '/api/countries');
  assert.ok(before.body.countries.find((c: any) => c.code === 'VE').projects.some((p: any) => p.id === 'ven-barinas'));
  const arch = await call(partner, 'PATCH', '/api/projects/ven-barinas', { status: 'archived' });
  assert.equal(arch.status, 200, JSON.stringify(arch.body));
  const after = await call(partner, 'GET', '/api/countries');
  const ve = after.body.countries.find((c: any) => c.code === 'VE');
  assert.ok(!ve || !ve.projects.some((p: any) => p.id === 'ven-barinas'));
  assert.equal((await call(partner, 'GET', '/api/projects/ven-barinas')).status, 200);
  assert.equal((await call(partner, 'GET', '/api/projects/ven-barinas')).body.status, 'archived');
  const restored = await call(partner, 'PATCH', '/api/projects/ven-barinas', { status: 'prospect' });
  assert.equal(restored.status, 200);
  const back = await call(partner, 'GET', '/api/countries');
  assert.ok(back.body.countries.find((c: any) => c.code === 'VE').projects.some((p: any) => p.id === 'ven-barinas'));
});
