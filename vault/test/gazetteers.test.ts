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
    'query.wikidata.org': (u) => {
      assert.match(u.searchParams.get('query') ?? '', /Q211748/);
      return json({ results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q98765' }, itemLabel: { value: 'Guafita oil field' }, coord: { value: 'Point(-70.9 7.6)' }, countryCode: { value: 'VE' } }] } });
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

test('ids and coordinates helpers', () => {
  assert.equal(slugAssetId('field', 'VE', 'La Victoria (Apure)'), 'field:ve:la-victoria-apure');
  assert.deepEqual(parseWikidataCoord('Point(-70.9 7.6)'), { lon: -70.9, lat: 7.6 });
  assert.equal(parseWikidataCoord('nonsense'), null);
});
