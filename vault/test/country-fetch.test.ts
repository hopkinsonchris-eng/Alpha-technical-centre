// Wave 7 PR4 (W7-AC17): fetching a registry source on recorded fixtures (a Chambers chapter, a ResourceContracts
// search, an EITI page, a JODI CSV header) files each as an immutable original under project 'firm' with its sha256
// and fetched_at; an unchanged payload writes nothing; a changed one becomes a new version; the text is chunked by
// the existing ingest so Find reaches it; a 403, a timeout or a thrown fetch reports unreachable and never throws.
// No model call anywhere in these files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip, fakeFetch, mockClock, sha, testDb, text, type Route } from './miners.helpers.ts';
import { fetchSource, hostAllowed, summarise, type FetchOk } from '../src/country/fetch.ts';
import { storeOriginal, itemTypeFor } from '../src/country/store.ts';
import { loadRegistry } from '../src/country/registry.ts';
import { FakeEmbedder } from '../src/ingest/embed.ts';
import { PACK_ITEM_KIND, PACK_LEGAL_TAG, PACK_ORIGIN, PACK_PROJECT, type CountrySource } from '../src/country/types.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'country');
const fx = (name: string) => readFileSync(path.join(FIX, name));
const NOW = new Date('2026-10-05T09:00:00Z');
const reg = loadRegistry();
const generic = (id: string): CountrySource => { const s = reg.generic.find(x => x.id === id); if (!s) throw new Error(`no generic source ${id}`); return s; };

let dbh: Awaited<ReturnType<typeof testDb>>;
before(async () => { dbh = await testDb(); });
after(async () => { await dbh.db.close(); });

const ctx = (routes: Route[], over: Record<string, unknown> = {}) => {
  const clock = mockClock(NOW.getTime());
  const ff = fakeFetch(routes, clock);
  return { calls: ff.calls, ctx: { country: 'NA', fetch: ff.fetch, clock, now: () => NOW, ...over } };
};

test('a Chambers chapter: the series resolves to the current edition, the html is stored as fetched, the title is read from the page', async () => {
  const { calls, ctx: c } = ctx([[/oil-gas-2026\/namibia$/, () => text(fx('chambers-namibia-2026.html').toString(), 200, { 'content-type': 'text/html; charset=utf-8' })]]);
  const r = await fetchSource(generic('chambers-oil-gas'), c);
  assert.equal(r.unreachable, false);
  const ok = r as FetchOk;
  assert.equal(ok.url, 'https://practiceguides.chambers.com/practice-guides/oil-gas-2026/namibia');
  assert.equal(ok.url_final, ok.url);
  assert.equal(ok.status, 200);
  assert.equal(ok.mime, 'text/html');
  assert.equal(ok.fetched_at, NOW.toISOString());
  assert.equal(ok.title, 'Oil & Gas 2026 - Namibia | Global Practice Guides | Chambers and Partners');
  assert.match(ok.description, /SNC Inc/);
  assert.equal(sha(ok.bytes), sha(fx('chambers-namibia-2026.html')), 'stored as fetched, byte for byte');
  assert.equal(calls.length, 1);
  assert.equal(ok.edition, 2026);
});

test('a series whose current edition answers 404 falls back to the previous year; two misses report unreachable', async () => {
  const { calls, ctx: c } = ctx([[/oil-gas-2026\//, () => text('gone', 404)], [/oil-gas-2025\//, () => text(fx('chambers-namibia-2026.html').toString(), 200, { 'content-type': 'text/html' })]]);
  const r = await fetchSource(generic('chambers-oil-gas'), c) as FetchOk;
  assert.equal(r.unreachable, false);
  assert.match(r.url, /oil-gas-2025\/namibia$/);
  assert.equal(r.edition, 2025);
  assert.equal(calls.length, 2);
  const { ctx: c2, calls: calls2 } = ctx([[/oil-gas-/, () => text('gone', 404)]]);
  const miss = await fetchSource(generic('chambers-oil-gas'), c2);
  assert.equal(miss.unreachable, true);
  assert.match((miss as any).reason, /no edition/i);
  assert.equal(calls2.length, 2);
});

test('a ResourceContracts search and the EITI page: json and html are parsed only enough for a title and a one-line description', async () => {
  const { ctx: c } = ctx([
    [/api\.resourcecontracts\.org\/contracts\/search\?country_code=gy/, () => text(fx('resourcecontracts-search-gy.json').toString(), 200, { 'content-type': 'application/json' })],
    [/eiti\.org\/countries\/guyana$/, () => text(fx('eiti-colombia.html').toString(), 200, { 'content-type': 'text/html' })],
  ], { country: 'GY' });
  const rc = await fetchSource(generic('resourcecontracts-search'), c) as FetchOk;
  assert.equal(rc.unreachable, false);
  assert.equal(rc.url, 'https://api.resourcecontracts.org/contracts/search?country_code=gy&resource=Hydrocarbons');
  assert.equal(rc.mime, 'application/json');
  assert.match(rc.title, /ResourceContracts/);
  assert.match(rc.description, /3 (records|contracts)/);
  assert.match(rc.description, /Stabroek/);
  assert.equal(sha(rc.bytes), sha(fx('resourcecontracts-search-gy.json')));
  const e = await fetchSource(generic('eiti-country-page'), c) as FetchOk;
  assert.equal(e.unreachable, false);
  assert.equal(e.title, 'Colombia | EITI');
  assert.match(e.description, /joined the EITI in 2014/);
});

test('the JODI CSV arrives zipped: the first CSV entry is the original; a plain CSV reads its header', async () => {
  const zip = buildZip([{ name: 'world_primary.csv', data: fx('jodi-oil-header.csv') }]);
  const { calls, ctx: c } = ctx([[/jodidata\.org/, () => new Response(new Uint8Array(zip), { status: 200, headers: { 'content-type': 'application/zip' } })]]);
  const r = await fetchSource(generic('jodi-oil-monthly'), c) as FetchOk;
  assert.equal(r.unreachable, false);
  // jodidata.org answers 406 to any Accept that does not admit */* (6 Oct 2026, from the live build): the csv request must carry it.
  assert.match(new Headers((calls[0].init?.headers as any) ?? {}).get('accept') ?? '', /\*\/\*/, 'a CSV request accepts */* as well');
  assert.equal(r.mime, 'text/csv');
  assert.equal(sha(r.bytes), sha(fx('jodi-oil-header.csv')));
  assert.match(r.description, /7 columns/);
  assert.match(r.description, /REF_AREA/);
  assert.match(r.description, /7 rows/);
  const plain = summarise(fx('jodi-oil-header.csv'), 'text/csv', 'csv');
  assert.match(plain.description, /7 columns/);
});

test('EIA: not configured without EIA_API_KEY; with it the key travels in the request and never in the recorded url', async () => {
  const { ctx: c, calls } = ctx([[/api\.eia\.gov/, () => ({ response: { total: 1, data: [{ period: '2024', countryRegionId: 'NA', value: 0, unit: 'TBPD' }] } })]], { country: 'NA', env: {} });
  const off = await fetchSource(generic('eia-international'), c);
  assert.equal(off.unreachable, true);
  assert.equal((off as any).not_configured, true);
  assert.match((off as any).reason, /not configured.*EIA_API_KEY/);
  assert.equal(calls.length, 0);
  const { ctx: c2, calls: calls2 } = ctx([[/api\.eia\.gov/, () => ({ response: { total: 1, data: [{ period: '2024', countryRegionId: 'NA', value: 0, unit: 'TBPD' }] } })]], { country: 'NA', env: { EIA_API_KEY: 'k-secret' } });
  const on = await fetchSource(generic('eia-international'), c2) as FetchOk;
  assert.equal(on.unreachable, false);
  assert.match(calls2[0].url, /api_key=k-secret/);
  assert.ok(!on.url.includes('k-secret') && !on.url_final.includes('k-secret'), 'the recorded url carries no secret');
  assert.match(on.url, /countryRegionId%5D%5B%5D=NA|countryRegionId\]\[\]=NA/);
  assert.match(on.description, /1 record/);
});

test('GEM is read from the imported master file, filtered to the country, with no request', async () => {
  const { ctx: c, calls } = ctx([], { country: 'GY' });
  const r = await fetchSource(generic('gem-extraction-tracker'), c) as FetchOk;
  assert.equal(r.unreachable, false, (r as any).reason);
  assert.equal(calls.length, 0);
  assert.equal(r.mime, 'application/json');
  const body = JSON.parse(r.bytes.toString());
  assert.equal(body.release, 'March 2026');
  assert.ok(Array.isArray(body.units) && body.units.length > 0, 'Guyana has extraction areas in the release');
  assert.ok(body.units.every((u: any) => u.country === 'GY'));
  assert.match(r.description, /\d+ extraction areas?/);
  assert.match(r.url, /^gem-fields/);
});

test('ResourceContracts text: the newest contracts are followed into their first pages, bundled as one original', async () => {
  const { ctx: c, calls } = ctx([
    [/contracts\/search\?country_code=gy/, () => text(fx('resourcecontracts-search-gy.json').toString(), 200, { 'content-type': 'application/json' })],
    [/contract\/8814\/text\?page=1/, () => text(fx('resourcecontracts-text-8814-p1.json').toString(), 200, { 'content-type': 'application/json' })],
    [/contract\/\d+\/text\?page=/, () => text('{"text":"(page)","page":2}', 200, { 'content-type': 'application/json' })],
  ], { country: 'GY' });
  const r = await fetchSource(generic('resourcecontracts-text'), c) as FetchOk;
  assert.equal(r.unreachable, false, (r as any).reason);
  const body = JSON.parse(r.bytes.toString());
  assert.equal(body.contracts.length, 3);
  assert.equal(body.contracts[0].contract_id, 8814, 'newest first');
  assert.match(body.contracts[0].pages[0].text, /royalty of ten percent/);
  assert.ok(calls.length <= 1 + 3 * 2, 'at most max_contracts × max_pages text requests after the search');
  assert.match(r.description, /3 contracts/);
});

test('a 403, a timeout, a thrown fetch and a payload over the byte cap report unreachable and never throw', async () => {
  const s = generic('eiti-country-page');
  const forbidden = await fetchSource(s, ctx([[/eiti\.org/, () => text('nope', 403)]]).ctx);
  assert.equal(forbidden.unreachable, true);
  assert.match((forbidden as any).reason, /403/);
  assert.equal((forbidden as any).status, 403);
  const hang = (async (_u: any, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason ?? new Error('aborted'))))) as unknown as typeof fetch;
  const timeout = await fetchSource(s, { country: 'NA', fetch: hang, now: () => NOW, timeoutMs: 15 });
  assert.equal(timeout.unreachable, true);
  assert.match((timeout as any).reason, /timed out|timeout|abort/i);
  const thrown = await fetchSource(s, { country: 'NA', fetch: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch, now: () => NOW });
  assert.equal(thrown.unreachable, true);
  assert.match((thrown as any).reason, /ECONNRESET/);
  const big = await fetchSource(s, ctx([[/eiti\.org/, () => text('x', 200, { 'content-length': String(20 * 1024 * 1024) })]]).ctx);
  assert.equal(big.unreachable, true);
  assert.match((big as any).reason, /byte cap|exceeds/i);
  const bigBody = await fetchSource(s, { ...ctx([[/eiti\.org/, () => text('y'.repeat(2048), 200)]]).ctx, maxBytes: 1024 });
  assert.equal(bigBody.unreachable, true);
  assert.match((bigBody as any).reason, /byte cap|exceeds/i);
  // A redirect that lands outside the allow-list is refused after the fact and nothing is kept.
  const redirected = await fetchSource(s, ctx([[/eiti\.org/, () => { const r = new Response('<html><title>t</title></html>', { status: 200 }); Object.defineProperty(r, 'url', { value: 'https://elsewhere.example.com/x' }); return r; }]]).ctx);
  assert.equal(redirected.unreachable, true);
  assert.match((redirected as any).reason, /outside .*allowed/i);
});

test('storeOriginal files the payload as an immutable original with sha256 and fetched_at; unchanged writes nothing; changed makes a version; chunks exist', async () => {
  const { db, storage } = dbh;
  const s = generic('chambers-oil-gas');
  const { ctx: c } = ctx([[/oil-gas-2026\/namibia$/, () => text(fx('chambers-namibia-2026.html').toString(), 200, { 'content-type': 'text/html' })]]);
  const fetched = await fetchSource(s, c) as FetchOk;
  const ingest = { provider: null, embedder: new FakeEmbedder() };
  const first = await storeOriginal(db, storage, s, fetched, 'NA', { now: NOW, ingest });
  assert.equal(first.status, 'created');
  assert.equal(first.version, 1);
  assert.equal(first.sha256, sha(fx('chambers-namibia-2026.html')));
  const row = (await db.query<any>('SELECT * FROM items WHERE id = $1', [first.id])).rows[0];
  assert.equal(row.project_id, PACK_PROJECT);
  assert.equal(row.legal_tag, PACK_LEGAL_TAG);
  assert.equal(row.type, 'feed-snapshot');
  assert.equal(row.origin.source, PACK_ORIGIN);
  assert.equal(row.origin.external_id, fetched.url);
  assert.equal(row.external_id, fetched.url);
  assert.equal(row.origin.fetched_at, NOW.toISOString());
  assert.equal(row.content_hash, `sha256:${first.sha256}`);
  assert.equal(row.extracted.kind, PACK_ITEM_KIND);
  assert.deepEqual(row.extracted.pack, { country: 'NA', section: 'legal', source_id: 'chambers-oil-gas' });
  assert.equal(row.extracted.manifest.sha256, first.sha256);
  assert.equal(row.extracted.manifest.url, fetched.url);
  assert.equal(row.extracted.manifest.fetched_at, NOW.toISOString());
  assert.equal(row.extracted.licence, s.licence);
  assert.equal(row.extracted.attribution, s.attribution.replace('{year}', '2026'));
  assert.ok(await storage.exists(row.storage_key), 'the bytes are in storage under the content hash');
  assert.equal(row.mime, 'text/html');
  const chunks = Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND current', [first.id])).rows[0].n);
  assert.ok(chunks > 0, 'the text was extracted and chunked so Find reaches the law');
  assert.ok((first.chunks ?? 0) > 0);
  const hit = (await db.query<any>("SELECT text FROM chunks WHERE item_id = $1 AND text ILIKE '%Petroleum (Exploration and Production) Act%'", [first.id])).rows;
  assert.ok(hit.length > 0, 'the Act is in a chunk');

  // The same bytes again: nothing written.
  const again = await storeOriginal(db, storage, s, { ...fetched, fetched_at: '2026-10-12T09:00:00Z' }, 'NA', { now: new Date('2026-10-12T09:00:00Z'), ingest });
  assert.equal(again.status, 'unchanged');
  assert.equal(again.id, first.id);
  assert.equal(again.version, 1);
  const versions = (await db.query<any>('SELECT version FROM item_versions WHERE item_id = $1 ORDER BY version', [first.id])).rows.map(r => r.version);
  assert.deepEqual(versions, [1]);
  const items = Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE origin->>'source' = $1", [PACK_ORIGIN])).rows[0].n);
  assert.equal(items, 1, 'one item for the url');

  // Changed bytes: a new version of the same item; the old chunks are retired, new ones current.
  const changed = Buffer.from(fx('chambers-namibia-2026.html').toString().replace('Last updated: 06 August 2026', 'Last updated: 11 October 2026'));
  const v2 = await storeOriginal(db, storage, s, { ...fetched, bytes: changed, fetched_at: '2026-10-19T09:00:00Z' }, 'NA', { now: new Date('2026-10-19T09:00:00Z'), ingest });
  assert.equal(v2.status, 'updated');
  assert.equal(v2.id, first.id);
  assert.equal(v2.version, 2);
  assert.equal(v2.sha256, sha(changed));
  const row2 = (await db.query<any>('SELECT version, content_hash, origin, extracted FROM items WHERE id = $1', [first.id])).rows[0];
  assert.equal(row2.version, 2);
  assert.equal(row2.content_hash, `sha256:${sha(changed)}`);
  assert.equal(row2.origin.fetched_at, '2026-10-19T09:00:00Z');
  assert.equal(row2.extracted.manifest.sha256, sha(changed));
  assert.deepEqual((await db.query<any>('SELECT version FROM item_versions WHERE item_id = $1 ORDER BY version', [first.id])).rows.map(r => r.version), [1, 2]);
  const cur = (await db.query<any>('SELECT item_version, count(*)::int AS n FROM chunks WHERE item_id = $1 AND current GROUP BY item_version', [first.id])).rows;
  assert.deepEqual(cur.map(r => r.item_version), [2], 'only the new version is current');
});

test('regulator open data goes through K’s adapters: a csv with its header checked; a reshaped header is unreachable with the bytes attached and still filed; arcgis never throws', async () => {
  const regulatorCsv: CountrySource = { id: 'reg-licences', section: 'licensing', url: 'https://factpages.sodir.no/public/licence.csv', access: 'csv', licence: 'NLOD 1.0', attribution: 'Sokkeldirektoratet', allowed_domains: ['factpages.sodir.no'], options: { expect_header: ['REF_AREA', 'TIME_PERIOD'], title: 'Licences (CSV)' } };
  const { ctx: c, calls } = ctx([[/factpages\.sodir\.no\/public\/licence\.csv$/, () => text(fx('jodi-oil-header.csv').toString(), 200, { 'content-type': 'text/csv', 'last-modified': 'Sun, 04 Oct 2026 01:39:00 GMT' })]], { country: 'NO' });
  const ok = await fetchSource(regulatorCsv, c) as FetchOk;
  assert.equal(ok.unreachable, false, (ok as any).reason);
  assert.equal(calls.length, 1);
  assert.equal(ok.url, regulatorCsv.url);
  assert.equal(ok.title, 'Licences (CSV)');
  assert.equal(ok.rows, 7, 'K’s adapter counted the data rows');
  assert.equal(ok.source_modified, '2026-10-04T01:39:00.000Z', 'the publisher’s own date travels to the manifest');
  assert.equal(sha(ok.bytes), sha(fx('jodi-oil-header.csv')), 'stored byte for byte');
  const reshaped = await fetchSource({ ...regulatorCsv, options: { expect_header: ['LICENCE_NAME'] } }, ctx([[/licence\.csv$/, () => text(fx('jodi-oil-header.csv').toString(), 200, { 'content-type': 'text/csv' })]], { country: 'NO' }).ctx);
  assert.equal(reshaped.unreachable, true);
  assert.match((reshaped as any).reason, /header check failed/);
  assert.ok((reshaped as any).partial?.bytes?.length > 0, 'what arrived is attached');
  const { db, storage } = dbh;
  const filed = await storeOriginal(db, storage, regulatorCsv, (reshaped as any).partial, 'NO', { now: NOW, ingest: null });
  assert.equal(filed.status, 'created', 'the reshaped file is on record');
  assert.equal((await db.query<any>("SELECT extracted->'manifest'->>'rows' AS rows FROM items WHERE id = $1", [filed.id])).rows[0].rows, '7');
  const arcgis: CountrySource = { id: 'reg-layer', section: 'licensing', url: 'https://services.arcgis.com/x/arcgis/rest/services/Licences/FeatureServer/0', access: 'arcgis', licence: 'NSTA User Agreement', attribution: 'Contains information provided by the North Sea Transition Authority', allowed_domains: ['arcgis.com'] };
  const gone = await fetchSource(arcgis, ctx([], { country: 'GB' }).ctx);
  assert.equal(gone.unreachable, true);
  assert.equal(typeof (gone as any).reason, 'string', 'K’s adapter names the reason (here: the layer options it needs)');
  const outside = await fetchSource({ ...arcgis, url: 'https://elsewhere.example.com/FeatureServer/0' }, ctx([], { country: 'GB' }).ctx);
  assert.equal(outside.unreachable, true);
  assert.match((outside as any).reason, /outside .*allowed/i);
  // Plain http is permitted only where the registry says so (Argentina's CKAN), K's one rule.
  assert.equal(hostAllowed('http://datos.energia.gob.ar/api/3/action/package_show', ['datos.energia.gob.ar']), false);
  assert.equal(hostAllowed('http://datos.energia.gob.ar/api/3/action/package_show', ['http://datos.energia.gob.ar']), true);
});

test('a pdf source is a regulatory filing; a page or dataset is a feed snapshot; a json original is chunked too', async () => {
  assert.equal(itemTypeFor({ ...generic('eiti-country-page'), access: 'pdf' }), 'regulatory-filing');
  assert.equal(itemTypeFor(generic('eiti-country-page')), 'feed-snapshot');
  assert.equal(itemTypeFor(generic('jodi-oil-monthly')), 'feed-snapshot');
  assert.equal(itemTypeFor({ ...generic('eiti-country-page'), options: { kind: 'filing' } }), 'regulatory-filing');
  const { db, storage } = dbh;
  const s = generic('resourcecontracts-search');
  const { ctx: c } = ctx([[/contracts\/search/, () => text(fx('resourcecontracts-search-gy.json').toString(), 200, { 'content-type': 'application/json' })]], { country: 'GY' });
  const fetched = await fetchSource(s, c) as FetchOk;
  const r = await storeOriginal(db, storage, s, fetched, 'GY', { now: NOW, ingest: { provider: null, embedder: new FakeEmbedder() } });
  assert.equal(r.status, 'created');
  assert.ok((r.chunks ?? 0) > 0);
  const row = (await db.query<any>('SELECT type, title, tags FROM items WHERE id = $1', [r.id])).rows[0];
  assert.equal(row.type, 'feed-snapshot');
  assert.ok(row.tags.includes('country-pack') && row.tags.includes('country:GY') && row.tags.includes('section:fiscal'));
});

test('an embedder that refuses (a rate limit, a key) does not un-file the original: the bytes and the row are saved, chunks stay for the ingest-sync cron, and the result carries the warning', async () => {
  const { db, storage } = dbh;
  const s = generic('pwc-tax-summaries');
  const { ctx: c } = ctx([[/taxsummaries\.pwc\.com\/namibia\/corporate\/taxes-on-corporate-income$/, () => text('<!doctype html><html><head><title>Namibia - Corporate | PwC</title></head><body><p>Petroleum income tax is levied at 35 percent on taxable income from a licence area.</p></body></html>', 200, { 'content-type': 'text/html' })]]);
  const fetched = await fetchSource(s, c) as FetchOk;
  const refusing = { name: 'voyage', dims: 1024, maxDistance: 0.6, embed: async () => { throw new Error('voyage 429: {"detail":"You have not yet added your payment method in the billing page and will have reduced rate limits of 3 RPM and 10K TPM."}'); } };
  const r = await storeOriginal(db, storage, s, fetched, 'NA', { now: NOW, ingest: { provider: null, embedder: refusing as any } });
  assert.equal(r.status, 'created');
  assert.equal(r.chunks, null);
  assert.match(r.warning ?? '', /^filed, not indexed yet \(the ingest-sync cron will chunk it\): voyage 429/);
  const row = (await db.query<any>('SELECT id, storage_key FROM items WHERE id = $1', [r.id])).rows[0];
  assert.ok(row, 'the item row exists');
  assert.equal(await storage.exists(row.storage_key), true, 'the bytes are in the store');
  const chunks = (await db.query<any>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1', [r.id])).rows[0].n;
  assert.equal(chunks, 0, 'nothing indexed yet: exactly what the ingest-sync cron looks for');
});
