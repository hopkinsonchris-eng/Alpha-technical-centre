/**
 * Wave 7 PR4 (K): the country pack's generic adapters (ArcGIS FeatureServer with DCAT resolution, CKAN, dated CSV)
 * against recorded fixtures only (test/fixtures/country/README.md). No test here reaches the network: every fetch is
 * the routed fake from miners.helpers, every clock is the mock clock, and an unrouted URL fails the test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, adapterFor, runAdapter, type AdapterResult } from '../src/country/adapters/index.ts';
import { arcgisAdapter, resolveDcatLayer } from '../src/country/adapters/arcgis.ts';
import { ckanAdapter } from '../src/country/adapters/ckan.ts';
import { csvAdapter } from '../src/country/adapters/csv.ts';
import { isAllowedUrl } from '../src/country/adapters/shared.ts';
import type { CountrySource } from '../src/country/types.ts';
import { assertRateLimited, fakeFetch, mockClock, text } from './miners.helpers.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'country');
const fxBytes = (name: string) => readFileSync(path.join(FIX, name));
const fx = (name: string) => fxBytes(name).toString('utf8');
const fxJson = (name: string) => JSON.parse(fx(name));

const NSTA_CATALOGUE = 'https://open-data-ukcs-transition.hub.arcgis.com/data.json';
const NSTA_LAYER = 'https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS%20offshore%20petroleum%20licences%20WGS84/FeatureServer/0';
const ANH_LAYER = 'https://geovisor.anh.gov.co/server/rest/services/Vista_Tierras_Version_Vigente_Geovisor/FeatureServer/0';
const AR_API = 'http://datos.energia.gob.ar/api/3/action/package_show?id=exploracion-hidrocarburos-permisos-de-exploracion';
const AR_CSV = 'http://datos.energia.gob.ar/dataset/66044d22-6657-47d1-b0bb-ecc7c1d37a44/resource/c33b6176-6025-41ee-b174-d4d7653735c3/download/exploracin-hidrocarburos-permisos-de-exploracin.csv';
const ANP_CSV = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/rlpgn/blocos-ofertados-rodadas.csv';
const SODIR_CSV = 'https://factpages.sodir.no/public?/Factpages/external/tableview/licence&rs:Command=Render&rc:Toolbar=false&rc:Parameters=f&IpAddress=not_used&CultureCode=en&rs:Format=CSV&Top100=false';

const source = (over: Partial<CountrySource>): CountrySource => ({
  id: 'test-source', section: 'licensing', url: 'https://example.invalid/', access: 'adapter',
  licence: 'Test licence as the publisher states it', attribution: 'Contains test information', allowed_domains: ['example.invalid'],
  ...over,
});

const nsta = (over: Partial<CountrySource> = {}) => source({
  id: 'nsta-licences', url: NSTA_CATALOGUE, access: 'arcgis',
  licence: 'NSTA Open User Licence', attribution: 'Contains information provided by the North Sea Transition Authority and/or other third parties',
  allowed_domains: ['open-data-ukcs-transition.hub.arcgis.com', 'services-eu1.arcgis.com'],
  options: { catalogue: NSTA_CATALOGUE, dataset: 'UKCS-transition::ukcs-offshore-petroleum-licences-wgs84' },
  ...over,
});

/** A fake FeatureServer with `total` features, honouring resultOffset/resultRecordCount and the layer's maxRecordCount. */
function featureServer(layerMeta: any, total: number) {
  const seed = fxJson('anh-query.json');
  const page = (url: string) => {
    const u = new URL(url);
    const offset = Number(u.searchParams.get('resultOffset') ?? 0);
    const want = Math.min(Number(u.searchParams.get('resultRecordCount') ?? layerMeta.maxRecordCount), layerMeta.maxRecordCount);
    const features = [];
    for (let i = offset; i < Math.min(total, offset + want); i++) features.push({ attributes: { ...seed.features[i % seed.features.length].attributes, OBJECTID: i + 1 } });
    const { exceededTransferLimit: _recorded, ...envelope } = seed;   // the recorded page carries the flag; the fake decides it
    const body: any = { ...envelope, features };
    if (offset + features.length < total) body.exceededTransferLimit = true;
    return body;
  };
  return { meta: () => layerMeta, page };
}

/* ── ArcGIS ─────────────────────────────────────────────────────────── */

test('arcgis: NSTA dataset id resolves through the DCAT catalogue to the GeoService layer; one page is stored verbatim', async () => {
  const clock = mockClock(Date.UTC(2026, 9, 5, 12));
  const f = fakeFetch([
    [/\/data\.json$/, () => fx('nsta-data.json')],
    [/FeatureServer\/0\?f=json$/, () => fx('nsta-layer.json')],
    [/FeatureServer\/0\/query\?/, () => fx('nsta-query.json')],
  ], clock);
  const r = await arcgisAdapter(nsta(), { fetch: f.fetch, clock });
  assert.equal(r.unreachable, undefined, r.unreachable ?? "reachable");
  assert.equal(r.title, 'UKCS offshore petroleum licences (WGS84)');
  assert.match(r.description, /licen/i);
  assert.equal(r.rows, 3);
  assert.ok(r.bytes.equals(fxBytes('nsta-query.json')), 'a single page is stored exactly as fetched');
  assert.equal(r.mime, 'application/json');
  assert.equal(r.fetched_at, '2026-10-05T12:00:00.000Z');
  assert.equal(r.attribution, 'Contains information provided by the North Sea Transition Authority and/or other third parties');
  assert.equal(r.licence, 'NSTA Open User Licence');
  assert.equal(r.url, NSTA_LAYER, 'the fetched URL is the resolved layer, so the stored original points at the service');
  assert.equal(r.meta.max_record_count, 2000);
  assert.equal(r.meta.pages, 1);
  assert.equal(r.meta.capped, false);
  assert.equal(r.meta.source_modified, '2026-10-05T10:09:58.165Z', 'the catalogue modified date is the freshness');
  assert.deepEqual((r.meta.fields as string[]).slice(0, 3), ['OBJECTID', 'SUBAREAID', 'SUBSHORTNM']);
  assert.equal(f.calls.length, 3);
  const q = new URL(f.calls[2].url);
  assert.equal(q.searchParams.get('where'), '1=1');
  assert.equal(q.searchParams.get('outFields'), '*');
  assert.equal(q.searchParams.get('returnGeometry'), 'false', 'geometry is off unless asked for');
  assert.equal(q.searchParams.get('resultRecordCount'), '2000', 'page size is the server maxRecordCount');
  assert.equal(q.searchParams.get('resultOffset'), '0');
  assert.equal(q.searchParams.get('f'), 'json');
});

test('arcgis: resolveDcatLayer finds a dataset by landing-page slug, title or identifier and skips datasets without a GeoService', () => {
  const cat = fxJson('nsta-data.json');
  const a = resolveDcatLayer(cat, 'UKCS-transition::ukcs-offshore-petroleum-licences-wgs84');
  assert.equal(a?.layer, NSTA_LAYER);
  assert.equal(a?.title, 'UKCS offshore petroleum licences (WGS84)');
  const b = resolveDcatLayer(cat, 'UKCS 33rd offshore petroleum licencing rounds blocks on offer (WGS84)');
  assert.match(b?.layer ?? '', /blocks%20on%20offer%20WGS84\/FeatureServer\/0$/);
  assert.equal(resolveDcatLayer(cat, 'UKCS-transition::q-170'), undefined, 'a PDF map has no GeoService distribution');
  assert.equal(resolveDcatLayer(cat, 'no-such-dataset'), undefined);
});

test('arcgis: the ANH cap of 2,000 is honoured by paging, the registry cap bounds the total, and pages merge into one feature set', async () => {
  const clock = mockClock();
  const meta = { ...fxJson('anh-layer0.json'), maxRecordCount: 2 };
  const server = featureServer(meta, 5);
  const f = fakeFetch([
    [/FeatureServer\/0\?f=json$/, () => server.meta()],
    [/FeatureServer\/0\/query\?/, (u) => server.page(u)],
  ], clock);
  const src = source({ id: 'anh-tierras', url: ANH_LAYER, access: 'arcgis', allowed_domains: ['geovisor.anh.gov.co'], options: { layer: ANH_LAYER, max_records: 5 } });
  const r = await arcgisAdapter(src, { fetch: f.fetch, clock });
  assert.equal(r.unreachable, undefined, r.unreachable ?? "reachable");
  assert.equal(r.rows, 5);
  assert.equal(r.meta.pages, 3, 'five records at two a page take three requests');
  assert.equal(r.meta.capped, false);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.calls.slice(1).map(c => new URL(c.url).searchParams.get('resultOffset')), ['0', '2', '4']);
  assert.deepEqual(f.calls.slice(1).map(c => new URL(c.url).searchParams.get('resultRecordCount')), ['2', '2', '1'], 'never asks for more than the server allows, and the last page asks only for the remainder');
  const merged = JSON.parse(r.bytes.toString());
  assert.equal(merged.features.length, 5);
  assert.deepEqual(merged.features.map((x: any) => x.attributes.OBJECTID), [1, 2, 3, 4, 5]);
  assert.equal(merged.objectIdFieldName, 'OBJECTID');
  assert.ok(Array.isArray(merged.fields), 'the fields array travels with the merged pages');
  assert.equal(merged.exceededTransferLimit, undefined, 'the merged set is complete');
  assert.equal(r.title, 'GDB.Tierras_Version_Vigente_Geovisor_Vista', 'without a catalogue the layer name is the title');
  assert.equal(r.meta.max_record_count, 2);
  assertRateLimited(f.calls, 2, clock);

  // a smaller registry cap stops the paging early and says so
  const g = fakeFetch([[/FeatureServer\/0\?f=json$/, () => server.meta()], [/query\?/, (u) => server.page(u)]], mockClock());
  const capped = await arcgisAdapter({ ...src, options: { layer: ANH_LAYER, max_records: 3 } }, { fetch: g.fetch, clock: mockClock() });
  assert.equal(capped.rows, 3);
  assert.equal(capped.meta.capped, true);
  assert.equal(g.calls.length, 3);
  assert.equal(new URL(g.calls[2].url).searchParams.get('resultRecordCount'), '1', 'the last page asks only for what the cap leaves');
});

test('arcgis: a layer outside allowed_domains is refused before any request; a catalogue that resolves outside it is refused too', async () => {
  const f = fakeFetch([[/.*/, () => fx('nsta-data.json')]], mockClock());
  const r = await arcgisAdapter(source({ url: ANH_LAYER, access: 'arcgis', allowed_domains: ['nstauthority.co.uk'], options: { layer: ANH_LAYER } }), { fetch: f.fetch });
  assert.match(r.unreachable ?? '', /geovisor\.anh\.gov\.co.*not in allowed_domains/);
  assert.equal(f.calls.length, 0, 'nothing was fetched');
  assert.equal(r.rows, 0); assert.equal(r.bytes.length, 0);
  // the catalogue host is allowed but the GeoService host it names is not
  const r2 = await arcgisAdapter(nsta({ allowed_domains: ['open-data-ukcs-transition.hub.arcgis.com'] }), { fetch: f.fetch });
  assert.match(r2.unreachable ?? '', /services-eu1\.arcgis\.com.*not in allowed_domains/);
  assert.equal(f.calls.length, 1, 'only the catalogue was read');
});

test('arcgis: a 500, a network error, an ArcGIS error envelope and a missing dataset are reported as unreachable, never thrown', async () => {
  const clock = mockClock();
  const f = fakeFetch([[/data\.json$/, () => text('Internal Server Error', 500)]], clock);
  const r = await arcgisAdapter(nsta(), { fetch: f.fetch, clock });
  assert.match(r.unreachable ?? '', /HTTP 500/);
  const g = fakeFetch([[/data\.json$/, () => { throw new TypeError('fetch failed'); }]], clock);
  const r2 = await arcgisAdapter(nsta(), { fetch: g.fetch, clock });
  assert.match(r2.unreachable ?? '', /fetch failed/);
  const h = fakeFetch([
    [/data\.json$/, () => fx('nsta-data.json')],
    [/\?f=json$/, () => fx('nsta-layer.json')],
    [/query\?/, () => ({ error: { code: 400, message: 'Invalid query parameters', details: [] } })],
  ], clock);
  const r3 = await arcgisAdapter(nsta(), { fetch: h.fetch, clock });
  assert.match(r3.unreachable ?? '', /Invalid query parameters/);
  const r4 = await arcgisAdapter(nsta({ options: { catalogue: NSTA_CATALOGUE, dataset: 'UKCS-transition::no-such-layer' } }), { fetch: h.fetch, clock });
  assert.match(r4.unreachable ?? '', /no-such-layer.*not in the catalogue/);
  const r5 = await arcgisAdapter(nsta({ options: {} }), { fetch: h.fetch, clock });
  assert.match(r5.unreachable ?? '', /options\.layer or options\.dataset/);
});

/* ── CKAN ───────────────────────────────────────────────────────────── */

const ar = (over: Partial<CountrySource> = {}) => source({
  id: 'ar-permisos-exploracion', url: AR_API, access: 'ckan',
  licence: 'CC-BY-4.0', attribution: 'Secretaría de Energía de la Nación Argentina, datos.energia.gob.ar',
  allowed_domains: ['http://datos.energia.gob.ar'],
  options: { package: 'exploracion-hidrocarburos-permisos-de-exploracion', resource_format: 'CSV' },
  ...over,
});

test('ckan: package_show then the CSV resource over plain HTTP (allowed explicitly); the download is stored verbatim with the package dates', async () => {
  const clock = mockClock(Date.UTC(2026, 9, 5, 12));
  const f = fakeFetch([
    [/package_show\?id=exploracion-hidrocarburos-permisos-de-exploracion$/, () => fx('ar-package-show.json')],
    [/\/download\/exploracin-hidrocarburos-permisos-de-exploracin\.csv$/, () => new Response(new Uint8Array(fxBytes('ar-permisos-head.csv')), { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } })],
  ], clock);
  const r = await ckanAdapter(ar(), { fetch: f.fetch, clock });
  assert.equal(r.unreachable, undefined, r.unreachable ?? "reachable");
  assert.equal(r.title, 'Exploración de hidrocarburos - Permisos de Exploración: Exploración Hidrocarburos Permisos de Exploración (CSV)', 'package title, resource name, format');
  assert.match(r.description, /polígonos de permisos de exploración/);
  assert.equal(r.rows, 2);
  assert.ok(r.bytes.equals(fxBytes('ar-permisos-head.csv')), 'the resource bytes are the original');
  assert.equal(r.mime, 'text/csv');
  assert.equal(r.url, AR_CSV, 'the stored original points at the resource download');
  assert.equal(r.fetched_at, '2026-10-05T12:00:00.000Z');
  assert.equal(r.meta.source_modified, '2026-09-30T17:06:25.835Z', 'the resource last_modified is the freshness');
  assert.equal(r.meta.package_modified, '2026-10-01T07:00:57.104Z');
  assert.equal(r.meta.licence_stated, 'CC-BY-4.0');
  assert.equal(r.meta.resource_id, 'c33b6176-6025-41ee-b174-d4d7653735c3');
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(c => c.url.startsWith('http://datos.energia.gob.ar/')), 'both requests went over the plain-HTTP host the registry allows');
});

test('ckan: an allow-list without the explicit http:// entry refuses the plain-HTTP host; a foreign resource host is refused after package_show', async () => {
  const f = fakeFetch([[/package_show/, () => fx('ar-package-show.json')]], mockClock());
  const r = await ckanAdapter(ar({ allowed_domains: ['datos.energia.gob.ar'] }), { fetch: f.fetch });
  assert.match(r.unreachable ?? '', /plain http.*datos\.energia\.gob\.ar.*not in allowed_domains/i);
  assert.equal(f.calls.length, 0);
  const pkg = fxJson('ar-package-show.json');
  pkg.result.resources[0].url = 'https://elsewhere.example/permisos.csv';
  const g = fakeFetch([[/package_show/, () => pkg]], mockClock());
  const r2 = await ckanAdapter(ar(), { fetch: g.fetch });
  assert.match(r2.unreachable ?? '', /elsewhere\.example.*not in allowed_domains/);
  assert.equal(g.calls.length, 1);
});

test('ckan: a 500, success:false, a missing resource format and a failed download are reported as unreachable', async () => {
  const clock = mockClock();
  const r = await ckanAdapter(ar(), { fetch: fakeFetch([[/package_show/, () => text('boom', 500)]], clock).fetch, clock });
  assert.match(r.unreachable ?? '', /HTTP 500/);
  const r2 = await ckanAdapter(ar(), { fetch: fakeFetch([[/package_show/, () => ({ success: false, error: { message: 'Not found', __type: 'Not Found Error' } })]], clock).fetch, clock });
  assert.match(r2.unreachable ?? '', /Not found/);
  const r3 = await ckanAdapter(ar({ options: { package: 'exploracion-hidrocarburos-permisos-de-exploracion', resource_format: 'GeoJSON' } }), { fetch: fakeFetch([[/package_show/, () => fx('ar-package-show.json')]], clock).fetch, clock });
  assert.match(r3.unreachable ?? '', /no resource.*GeoJSON/i);
  const r4 = await ckanAdapter(ar(), { fetch: fakeFetch([[/package_show/, () => fx('ar-package-show.json')], [/download/, () => text('gone', 404)]], clock).fetch, clock });
  assert.match(r4.unreachable ?? '', /HTTP 404/);
  const r5 = await ckanAdapter(ar({ options: {} }), { fetch: fakeFetch([], clock).fetch, clock });
  assert.match(r5.unreachable ?? '', /options\.package/);
});

test('ckan: a resource can be chosen by id or by a name pattern', async () => {
  const clock = mockClock();
  const routes = (): Parameters<typeof fakeFetch>[0] => [[/package_show/, () => fx('ar-package-show.json')], [/\.zip$/, () => Buffer.from('PK\u0003\u0004zip')], [/\.csv$/, () => fxBytes('ar-permisos-head.csv')]];
  const byId = await ckanAdapter(ar({ options: { package: 'exploracion-hidrocarburos-permisos-de-exploracion', resource: 'f1d7f442-fcd1-450d-b392-7faf1156df89' } }), { fetch: fakeFetch(routes(), clock).fetch, clock });
  assert.equal(byId.unreachable, undefined, byId.unreachable ?? "reachable");
  assert.match(byId.url, /\.zip$/);
  assert.equal(byId.mime, 'application/zip');
  assert.equal(byId.rows, 0, 'rows are counted for CSV only');
  const byName = await ckanAdapter(ar({ options: { package: 'exploracion-hidrocarburos-permisos-de-exploracion', resource_match: 'permisos de exploraci', resource_format: 'CSV' } }), { fetch: fakeFetch(routes(), clock).fetch, clock });
  assert.equal(byName.unreachable, undefined, byName.unreachable ?? "reachable");
  assert.match(byName.url, /\.csv$/);
});

/* ── CSV ────────────────────────────────────────────────────────────── */

test('csv: ANP blocks on offer (Windows-1252, semicolon) is read with its header checked, counted, and stored byte for byte', async () => {
  const clock = mockClock(Date.UTC(2026, 9, 5, 12));
  const f = fakeFetch([[/blocos-ofertados-rodadas\.csv$/, () => new Response(new Uint8Array(fxBytes('anp-blocos-ofertados-head.csv')), { status: 200, headers: { 'content-type': 'text/csv', 'last-modified': 'Fri, 06 Mar 2026 10:00:00 GMT' } })]], clock);
  const src = source({ id: 'anp-blocos-ofertados', url: ANP_CSV, access: 'csv', allowed_domains: ['www.gov.br'], options: { expect_header: ['Rodada de Licitações', 'Bacia', 'Bloco'] } });
  const r = await csvAdapter(src, { fetch: f.fetch, clock });
  assert.equal(r.unreachable, undefined, r.unreachable ?? "reachable");
  assert.equal(r.rows, 5);
  assert.ok(r.bytes.equals(fxBytes('anp-blocos-ofertados-head.csv')), 'the original bytes, not a re-encoding');
  assert.equal(r.mime, 'text/csv');
  assert.equal(r.meta.delimiter, ';');
  assert.equal(r.meta.encoding, 'latin1');
  assert.deepEqual((r.meta.header as string[]).slice(0, 4), ['Rodada de Licitações', 'Bacia', 'Setor', 'Bloco']);
  assert.equal(r.meta.source_modified, '2026-03-06T10:00:00.000Z', 'Last-Modified is the freshness when the file carries no date');
  assert.equal(r.title, 'anp-blocos-ofertados', 'a CSV has no title of its own; the registry id stands in until the registry names it');
  assert.equal(r.fetched_at, '2026-10-05T12:00:00.000Z');
});

test('csv: Sodir licences carry the synchronisation date in a column, which becomes the freshness; the BOM stays in the bytes and leaves the header', async () => {
  const clock = mockClock();
  const f = fakeFetch([[/rs:Format=CSV/, () => new Response(new Uint8Array(fxBytes('sodir-licence-head.csv')), { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } })]], clock);
  const src = source({ id: 'sodir-licences', url: SODIR_CSV, access: 'csv', allowed_domains: ['factpages.sodir.no'], options: { expect_header: ['prlName', 'prlStatus', 'prlDateGranted'], freshness_column: 'DatesyncNPD', title: 'Sodir FactPages: production licences' } });
  const r = await csvAdapter(src, { fetch: f.fetch, clock });
  assert.equal(r.unreachable, undefined, r.unreachable ?? "reachable");
  assert.equal(r.rows, 3);
  assert.equal(r.meta.delimiter, ',');
  assert.equal(r.meta.encoding, 'utf8');
  assert.equal((r.meta.header as string[])[0], 'prlName', 'no BOM on the first column name');
  assert.equal(r.bytes[0], 0xef, 'the stored original keeps its BOM');
  assert.equal(r.meta.source_modified, '2026-10-05T00:00:00.000Z', 'DatesyncNPD 05.10.2026 read as the freshness');
  assert.equal(r.title, 'Sodir FactPages: production licences');
});

test('csv: a changed header is reported as unreachable with the bytes still attached; a 500, an empty body and a foreign host are refused', async () => {
  const clock = mockClock();
  const anp = () => new Response(new Uint8Array(fxBytes('anp-blocos-ofertados-head.csv')), { status: 200 });
  const src = source({ id: 'anp-blocos-ofertados', url: ANP_CSV, access: 'csv', allowed_domains: ['www.gov.br'], options: { expect_header: ['Rodada', 'Operadora'] } });
  const r = await csvAdapter(src, { fetch: fakeFetch([[/\.csv$/, anp]], clock).fetch, clock });
  assert.match(r.unreachable ?? '', /header.*Operadora/i);
  assert.ok(r.bytes.length > 0, 'the fetched bytes are returned so the job can still file what changed');
  const r2 = await csvAdapter(src, { fetch: fakeFetch([[/\.csv$/, () => text('nope', 500)]], clock).fetch, clock });
  assert.match(r2.unreachable ?? '', /HTTP 500/);
  const r3 = await csvAdapter(src, { fetch: fakeFetch([[/\.csv$/, () => text('', 200)]], clock).fetch, clock });
  assert.match(r3.unreachable ?? '', /empty/i);
  const f = fakeFetch([[/.*/, anp]], clock);
  const r4 = await csvAdapter({ ...src, allowed_domains: ['anp.gov.br'] }, { fetch: f.fetch, clock });
  assert.match(r4.unreachable ?? '', /www\.gov\.br.*not in allowed_domains/);
  assert.equal(f.calls.length, 0);
});

/* ── the allow-list and the index ───────────────────────────────────── */

test('isAllowedUrl: exact host or subdomain, https by default, plain http only when the entry says so, nothing else', () => {
  assert.equal(isAllowedUrl('https://services-eu1.arcgis.com/x', ['arcgis.com']), null);
  assert.equal(isAllowedUrl('https://services-eu1.arcgis.com/x', ['services-eu1.arcgis.com']), null);
  assert.match(isAllowedUrl('https://notarcgis.com/x', ['arcgis.com']) ?? '', /not in allowed_domains/);
  assert.match(isAllowedUrl('https://evil.example/arcgis.com', ['arcgis.com']) ?? '', /not in allowed_domains/);
  assert.match(isAllowedUrl('http://datos.energia.gob.ar/api', ['datos.energia.gob.ar']) ?? '', /plain http/i);
  assert.equal(isAllowedUrl('http://datos.energia.gob.ar/api', ['http://datos.energia.gob.ar']), null);
  assert.equal(isAllowedUrl('https://datos.energia.gob.ar/api', ['http://datos.energia.gob.ar']), null, 'an http entry allows https too');
  assert.match(isAllowedUrl('ftp://datos.energia.gob.ar/x', ['http://datos.energia.gob.ar']) ?? '', /scheme/);
  assert.match(isAllowedUrl('not a url', ['x']) ?? '', /not a url/i);
  assert.match(isAllowedUrl('https://x.example/', []) ?? '', /allowed_domains is empty/);
  assert.match(isAllowedUrl('https://www.onepetro.org/x', ['onepetro.org']) ?? '', /refus/i);
});

test('index: ADAPTERS maps the three access kinds, adapterFor answers for them only, runAdapter dispatches by access and never throws', async () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ['arcgis', 'ckan', 'csv']);
  assert.equal(adapterFor('arcgis'), ADAPTERS.arcgis);
  assert.equal(adapterFor('html'), undefined);
  assert.equal(adapterFor('adapter'), undefined);
  const clock = mockClock();
  const f = fakeFetch([[/rs:Format=CSV/, () => fxBytes('sodir-licence-head.csv')]], clock);
  const r: AdapterResult = await runAdapter(source({ id: 'sodir-licences', url: SODIR_CSV, access: 'csv', allowed_domains: ['factpages.sodir.no'] }), { fetch: f.fetch, clock });
  assert.equal(r.rows, 3);
  assert.equal(r.source_id, 'sodir-licences');
  const none = await runAdapter(source({ access: 'html', url: 'https://example.invalid/page' }), { fetch: f.fetch, clock });
  assert.match(none.unreachable ?? '', /no adapter for access 'html'/);
  assert.equal(none.rows, 0);
  const broken = await runAdapter(source({ access: 'csv', url: 'https://example.invalid/x.csv', options: 'oops' as any }), { fetch: fakeFetch([[/.*/, () => { throw new Error('should not be called'); }]], clock).fetch, clock });
  assert.ok(broken.unreachable, 'bad options are reported, not thrown');
});
