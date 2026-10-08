// Wave 3, PR 1 (docs/vault-hub/wave3/05-markup.md §1.2, §1.7): locating a field. Candidates come
// from the Vault's assets first, then the imported Global Energy Monitor units, then GeoNames
// and Wikidata, each with its source; a source that cannot answer is reported, never silent.
// Smoke tests for W3-AC1, written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { locate, slugAssetId, parseWikidataCoord } from '../src/assets/gazetteers.ts';

type Db = Awaited<ReturnType<typeof openDb>>;
let db: Db;
before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query(`INSERT INTO assets (id, kind, name, country, operator, source_url, props, lat, lon, location_source) VALUES
    ('field:ve:guafita','field','Guafita','VE','PDVSA','https://www.gem.wiki/Guafita_Oil_Field','{"gem":{"unit_id":"G100","status":"operating"}}'::jsonb, 7.6, -70.9, 'gem'),
    ('field:ve:la-victoria','field','La Victoria','VE',NULL,NULL,'{}'::jsonb, NULL, NULL, NULL)`);
});
after(async () => { await db.close(); });

const calls: string[] = [];
function fakeFetch(handlers: Record<string, (u: URL) => Response | Promise<Response>>) {
  return (async (url: string, _init?: RequestInit) => {
    calls.push(url);
    const u = new URL(url);
    const h = handlers[u.hostname];
    if (!h) return new Response('not found', { status: 404 });
    return h(u);
  }) as unknown as typeof fetch;
}
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

test('W3-AC1: Vault assets first (exact match before contains), GEM-imported ones say so, then GeoNames and Wikidata with their sources', async () => {
  calls.length = 0;
  const f = fakeFetch({
    'secure.geonames.org': (u) => {
      assert.equal(u.searchParams.get('country'), 'VE');
      assert.equal(u.searchParams.get('username'), 'atc-test');
      assert.deepEqual(u.searchParams.getAll('featureCode'), ['OILF', 'GASF']);
      return json({ totalResultsCount: 1, geonames: [{ geonameId: 3640000, name: 'Guafita', lat: '7.65', lng: '-70.95', countryCode: 'VE', fcode: 'OILF', adminName1: 'Apure' }] });
    },
    // Wave 8 (8 Oct 2026): Wikidata is asked by text search first, then the found items are read by id.
    'www.wikidata.org': (u) => {
      assert.equal(u.searchParams.get('action'), 'wbsearchentities'); assert.equal(u.searchParams.get('search'), 'Guafita');
      return json({ search: [{ id: 'Q98765', label: 'Guafita oil field', description: 'oil field in Venezuela' }] });
    },
    'query.wikidata.org': (u) => {
      assert.match(u.searchParams.get('query') ?? '', /wd:Q98765/);
      return json({ results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q98765' }, itemLabel: { value: 'Guafita oil field' }, classLabel: { value: 'oil field' }, coord: { value: 'Point(-70.9 7.6)' }, countryCode: { value: 'VE' } }] } });
    },
  });
  const r = await locate(db, 'Guafita', 'VE', { fetch: f, geonamesUser: 'atc-test' });
  assert.deepEqual(r.unavailable, []);
  assert.deepEqual(r.candidates.map(c => c.source), ['gem', 'geonames', 'wikidata']);
  const gem = r.candidates[0];
  assert.equal(gem.asset_id, 'field:ve:guafita');
  assert.equal(gem.lat, 7.6); assert.equal(gem.lon, -70.9);
  assert.equal(gem.source_url, 'https://www.gem.wiki/Guafita_Oil_Field');
  assert.equal(gem.confidence, 1);
  const gn = r.candidates[1];
  assert.equal(gn.source_id, '3640000'); assert.equal(gn.lat, 7.65); assert.equal(gn.lon, -70.95);
  assert.equal(gn.source_url, 'https://www.geonames.org/3640000');
  assert.equal(gn.kind, 'field');
  const wd = r.candidates[2];
  assert.equal(wd.source_id, 'Q98765'); assert.equal(wd.lat, 7.6); assert.equal(wd.lon, -70.9);
  assert.equal(wd.source_url, 'https://www.wikidata.org/wiki/Q98765');
  assert.equal(wd.confidence, 0.8, 'an oil field for kind field'); assert.equal((wd.detail as any).class, 'oil field');
  // A plain Vault asset without GEM data reports source 'vault' and keeps null coordinates.
  const v = await locate(db, 'victoria', 'VE', { fetch: fakeFetch({}), geonamesUser: 'atc-test' });
  assert.equal(v.candidates[0].source, 'vault');
  assert.equal(v.candidates[0].asset_id, 'field:ve:la-victoria');
  assert.equal(v.candidates[0].lat, null);
  assert.ok(v.candidates[0].confidence < 1, 'a contains match is less confident than an exact one');
});

test('W3-AC1: without a GeoNames username, or when a gazetteer fails or times out, the response says which source was unavailable', async () => {
  const slow = (async (_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
  const r = await locate(db, 'Nowhere', 'BR', { fetch: slow, timeoutMs: 100 });
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.unavailable.map(u => u.source).sort(), ['geonames', 'wikidata']);
  assert.match(r.unavailable.find(u => u.source === 'geonames')!.reason, /GEONAMES_USERNAME/);
  assert.match(r.unavailable.find(u => u.source === 'wikidata')!.reason, /timed out|aborted/);
  const bad = fakeFetch({ 'secure.geonames.org': () => new Response('{"status":{"message":"user account not enabled","value":10}}', { status: 401 }), 'query.wikidata.org': () => new Response('<html>', { status: 500 }) });
  const r2 = await locate(db, 'Nowhere', 'BR', { fetch: bad, geonamesUser: 'x' });
  assert.deepEqual(r2.unavailable.map(u => u.source).sort(), ['geonames', 'wikidata']);
  assert.match(r2.unavailable.find(u => u.source === 'geonames')!.reason, /401/);
});

test('W8 (8 Oct 2026, "Fezzan"): the kind drives the gazetteers: a basin asks GeoNames for basins and regions and Wikidata by text search, so a region with coordinates in the country is a candidate; a kind that matches ranks higher; things without a place are left out', async () => {
  calls.length = 0;
  const f = fakeFetch({
    'secure.geonames.org': (u) => {
      assert.equal(u.searchParams.get('country'), 'LY');
      assert.deepEqual(u.searchParams.getAll('featureCode'), ['BSNP', 'BSND', 'RGN', 'AREA', 'DSRT', 'PLAT']);
      return json({ totalResultsCount: 1, geonames: [{ geonameId: 2209937, name: 'Fezzan', lat: '26.5', lng: '13.0', countryCode: 'LY', fcode: 'RGN', adminName1: 'Sabha' }] });
    },
    'www.wikidata.org': (u) => {
      assert.equal(u.searchParams.get('search'), 'Fezzan');
      return json({ search: [{ id: 'Q188258', label: 'Fezzan', description: 'historical region of Libya' }, { id: 'Q107030550', label: 'Fezzan', description: 'boat' }, { id: 'Q94750163', label: 'Fezzan', description: 'ward of Nigeria' }] });
    },
    'query.wikidata.org': (u) => {
      const q = u.searchParams.get('query') ?? '';
      assert.match(q, /wd:Q188258/); assert.match(q, /wd:Q107030550/);
      return json({ results: { bindings: [
        { item: { value: 'http://www.wikidata.org/entity/Q188258' }, itemLabel: { value: 'Fezzan' }, classLabel: { value: 'historical region' }, coord: { value: 'Point(13.4253 26.3328)' }, countryCode: { value: 'LY' } },
        { item: { value: 'http://www.wikidata.org/entity/Q188258' }, itemLabel: { value: 'Fezzan' }, classLabel: { value: 'landscape' }, coord: { value: 'Point(13.4253 26.3328)' }, countryCode: { value: 'LY' } },
        { item: { value: 'http://www.wikidata.org/entity/Q107030550' }, itemLabel: { value: 'Fezzan' }, classLabel: { value: 'boat' } },
        { item: { value: 'http://www.wikidata.org/entity/Q94750163' }, itemLabel: { value: 'Fezzan' }, classLabel: { value: 'ward of Nigeria' }, coord: { value: 'Point(13.155 11.843)' }, countryCode: { value: 'NG' } },
      ] } });
    },
  });
  const r = await locate(db, 'Fezzan', 'LY', { fetch: f, geonamesUser: 'atc-test', kind: 'basin' });
  assert.deepEqual(r.unavailable, []);
  assert.deepEqual(r.candidates.map(c => [c.source, c.source_id, c.kind]), [['geonames', '2209937', 'basin'], ['wikidata', 'Q188258', 'basin']], 'the boat (no place) and the Nigerian ward (other country) are out');
  const wd = r.candidates[1];
  assert.equal(wd.lat, 26.3328); assert.equal(wd.lon, 13.4253); assert.equal(wd.country, 'LY');
  assert.equal((wd.detail as any).class, 'historical region', 'the first class names what the record is');
  assert.equal(wd.confidence, 0.8, 'a region is a basin-like place');
  assert.equal(r.candidates[0].confidence, 0.8, 'an exact GeoNames name');
  // Without a country the ward comes too, marked by its own country; and the default kind is still field.
  const all = await locate(db, 'Fezzan', null, { fetch: f, geonamesUser: 'atc-test', kind: 'basin' });
  assert.ok(all.candidates.some(c => c.source_id === 'Q94750163' && c.country === 'NG'));
  calls.length = 0;
  const fld = fakeFetch({
    'secure.geonames.org': (u) => { assert.deepEqual(u.searchParams.getAll('featureCode'), ['OILF', 'GASF']); return json({ geonames: [] }); },
    'www.wikidata.org': () => json({ search: [{ id: 'Q188258', label: 'Fezzan' }] }),
    'query.wikidata.org': () => json({ results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q188258' }, itemLabel: { value: 'Fezzan' }, classLabel: { value: 'historical region' }, coord: { value: 'Point(13.4253 26.3328)' }, countryCode: { value: 'LY' } }] } }),
  });
  const asField = await locate(db, 'Fezzan', 'LY', { fetch: fld, geonamesUser: 'atc-test' });
  assert.equal(asField.candidates[0].kind, 'field'); assert.equal(asField.candidates[0].confidence, 0.5, 'a region offered for a field is a weaker match, still offered');
});

test('ids and coordinates helpers', () => {
  assert.equal(slugAssetId('field', 'VE', 'La Victoria (Apure)'), 'field:ve:la-victoria-apure');
  assert.deepEqual(parseWikidataCoord('Point(-70.9 7.6)'), { lon: -70.9, lat: 7.6 });
  assert.equal(parseWikidataCoord('nonsense'), null);
});
