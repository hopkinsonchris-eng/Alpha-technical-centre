/**
 * Wave 7 PR4 (K): the per-country entries of vault/master/country-sources.json. Every entry validates against
 * CountryRegistry (vault/src/country/types.ts), every source carries licence, attribution and allowed_domains that
 * cover its URL, the six regulator-feed countries have an adapter source for licensing, and the four countries with
 * no open feed are seeded by hand with their regulator pages (Venezuela added after the first live pack build). W7-AC17's registry half; J's test covers `generic`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTION_IDS, type CountryRegistry, type CountrySource, type SourceAccess } from '../src/country/types.ts';
import { ADAPTERS } from '../src/country/adapters/index.ts';
import { isAllowedUrl } from '../src/country/adapters/shared.ts';

const REG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../master/country-sources.json');
const registry: CountryRegistry = JSON.parse(readFileSync(REG, 'utf8'));
const ACCESS: SourceAccess[] = ['html', 'pdf', 'json', 'csv', 'rss', 'arcgis', 'ckan', 'adapter'];
const ADAPTER_ACCESS = Object.keys(ADAPTERS);
const FEED = ['GB', 'NO', 'CO', 'AR', 'BR', 'US'];
const HAND = ['MX', 'NA', 'GY', 'VE'];
const FORBIDDEN = [/(^|\.)iea\.org$/i, /(^|\.)onepetro\.org$/i, /(^|\.)opencorporates\.com$/i, /(^|\.)linkedin\.com$/i];

const all = (): [string, CountrySource][] => Object.entries(registry.countries).flatMap(([cc, c]) => c.sources.map(s => [cc, s] as [string, CountrySource]));
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

test('registry: the countries object holds the ten countries, keyed by ISO alpha-2, each named with its regulator and a data-room note', () => {
  assert.deepEqual(Object.keys(registry.countries).sort(), [...FEED, ...HAND].sort());
  for (const [cc, c] of Object.entries(registry.countries)) {
    assert.match(cc, /^[A-Z]{2}$/, `${cc} is ISO 3166-1 alpha-2 upper case`);
    assert.ok(typeof c.name === 'string' && c.name.length > 1, `${cc} has a name`);
    assert.ok(typeof c.regulator === 'string' && c.regulator.length > 3, `${cc} names its regulator`);
    assert.ok(typeof c.accounts_note === 'string' && c.accounts_note.length > 20, `${cc} carries a data-room note (accounts_note)`);
    assert.ok(Array.isArray(c.sources) && c.sources.length >= 2, `${cc} has sources`);
    if (c.seeded_by_hand !== undefined) assert.equal(typeof c.seeded_by_hand, 'boolean');
  }
});

test('registry: every source validates against CountrySource: id, section, url, access, licence, attribution, allowed_domains covering the url', () => {
  const ids = new Set<string>();
  for (const [cc, s] of all()) {
    const where = `${cc}/${s.id}`;
    assert.match(s.id, /^[a-z0-9][a-z0-9-]+$/, `${where}: id is a slug`);
    assert.ok(!ids.has(s.id), `${where}: id is unique across the registry`); ids.add(s.id);
    assert.ok(SECTION_IDS.includes(s.section), `${where}: section ${s.section} is one of the ten`);
    assert.ok(ACCESS.includes(s.access), `${where}: access ${s.access} is a SourceAccess`);
    assert.ok(typeof s.url === 'string' && /^https?:\/\//.test(s.url), `${where}: url is absolute`);
    assert.ok(typeof s.licence === 'string' && s.licence.trim().length >= 5, `${where}: licence as the publisher states it (an identifier such as CC-BY-4.0 is enough)`);
    assert.ok(typeof s.attribution === 'string' && s.attribution.trim().length >= 10, `${where}: attribution line`);
    assert.ok(Array.isArray(s.allowed_domains) && s.allowed_domains.length > 0 && s.allowed_domains.every(d => typeof d === 'string' && d.length > 3), `${where}: allowed_domains`);
    assert.equal(isAllowedUrl(s.url, s.allowed_domains), null, `${where}: ${s.url} is covered by ${s.allowed_domains.join(', ')}`);
    if (s.ttl_days !== undefined) assert.ok(Number.isInteger(s.ttl_days) && s.ttl_days > 0, `${where}: ttl_days`);
    if (s.options !== undefined) assert.ok(s.options && typeof s.options === 'object' && !Array.isArray(s.options), `${where}: options is an object`);
    if (s.note !== undefined) assert.ok(typeof s.note === 'string' && s.note.length > 0, `${where}: note`);
    const extra = Object.keys(s).filter(k => !['id', 'section', 'url', 'access', 'licence', 'attribution', 'allowed_domains', 'ttl_days', 'options', 'note'].includes(k));
    assert.deepEqual(extra, [], `${where}: no keys outside CountrySource`);
    for (const d of s.allowed_domains) assert.ok(!FORBIDDEN.some(re => re.test(d.replace(/^https?:\/\//, ''))), `${where}: ${d} is a forbidden host (IEA datasets, OnePetro, OpenCorporates, LinkedIn)`);
    assert.ok(!FORBIDDEN.some(re => re.test(hostOf(s.url))), `${where}: url host is permitted`);
  }
});

test('registry: adapter sources carry the options their adapter needs, and only https hosts unless the entry allows plain http explicitly', () => {
  for (const [cc, s] of all()) {
    const where = `${cc}/${s.id}`;
    const o = (s.options ?? {}) as Record<string, unknown>;
    if (s.access === 'arcgis') assert.ok(typeof o.layer === 'string' || (typeof o.dataset === 'string' && typeof o.catalogue === 'string'), `${where}: arcgis needs options.layer or options.dataset + options.catalogue`);
    if (s.access === 'ckan') assert.ok(typeof o.package === 'string' && (typeof o.resource === 'string' || typeof o.resource_format === 'string' || typeof o.resource_match === 'string'), `${where}: ckan needs options.package and a resource selector`);
    if (s.access === 'csv') assert.ok(Array.isArray(o.expect_header) && o.expect_header.length > 0, `${where}: csv names the header columns it expects`);
    if (s.url.startsWith('http://')) assert.ok(s.allowed_domains.some(d => d === `http://${hostOf(s.url)}`), `${where}: a plain-http url names its http host in allowed_domains`);
  }
});

test('registry: GB, NO, CO, AR, BR and US each have at least one adapter source for licensing and a regulator-section source', () => {
  for (const cc of FEED) {
    const c = registry.countries[cc];
    assert.ok(c.sources.some(s => s.section === 'licensing' && ADAPTER_ACCESS.includes(s.access)), `${cc}: an adapter source (arcgis, ckan or csv) for licensing`);
    assert.ok(c.sources.some(s => s.section === 'regulator'), `${cc}: a regulator and data-room source`);
    assert.notEqual(c.seeded_by_hand, true, `${cc} has an open feed`);
  }
});

test('registry: MX, NA, GY and VE are seeded by hand with their regulator pages and no adapter source', () => {
  for (const cc of HAND) {
    const c = registry.countries[cc];
    assert.equal(c.seeded_by_hand, true, `${cc} is seeded_by_hand`);
    assert.ok(c.sources.every(s => !ADAPTER_ACCESS.includes(s.access)), `${cc}: no adapter claims an open feed`);
    assert.ok(c.sources.some(s => s.section === 'licensing'), `${cc}: the regulator's round or licensing page`);
    assert.ok(c.sources.some(s => s.section === 'regulator'), `${cc}: the regulator page`);
    assert.ok(c.sources.some(s => s.note && /no open/i.test(s.note)), `${cc}: a source note says there is no open regulator feed`);
  }
  const mx = registry.countries.MX.sources.map(s => hostOf(s.url));
  assert.ok(mx.some(h => /rondasmexico\.energia\.gob\.mx$/.test(h)) && mx.some(h => /gob\.mx$/.test(h)), 'MX: CNH and Rondas México pages');
  const na = registry.countries.NA.sources;
  assert.ok(na.every(s => /mme\.gov\.na$/.test(hostOf(s.url))), 'NA: every source is the MME itself');
  assert.ok(na.some(s => s.section === 'licensing' && /until further notice/.test(s.note ?? '') && /quote/.test(s.note ?? '')), 'NA: the licensing note says the closure notice must be quoted from mme.gov.na itself');
  const gy = registry.countries.GY.sources;
  assert.ok(gy.some(s => s.section === 'legal' && s.access === 'pdf' && /Petroleum-Activities-Act/.test(s.url)), 'GY: the Petroleum Activities Act 2023 PDF');
  assert.ok(gy.some(s => s.section === 'fiscal' && s.access === 'pdf' && /PSA/.test(s.url)), 'GY: the 2023 model PSA');
  assert.ok(gy.some(s => s.section === 'service' && /lcregister\.petroleum\.gov\.gy|localcontent\.gov\.gy/.test(s.url)), 'GY: the Local Content Register');
  const ve = registry.countries.VE.sources;
  assert.ok(ve.filter(s => /minhidrocarburos\.gob\.ve$/.test(hostOf(s.url))).length >= 6, 'VE: the Ministry of Hydrocarbons is the regulator and most sources are its own pages');
  assert.ok(ve.some(s => s.section === 'legal' && s.access === 'pdf' && /LEY_DE_HIDROCARBUROS\.pdf$/.test(s.url)), 'VE: the Ley Orgánica de Hidrocarburos PDF from the Ministry');
  assert.ok(ve.some(s => s.section === 'legal' && /asambleanacional\.gob\.ve$/.test(hostOf(s.url)) && /2026/.test(s.note ?? '')), 'VE: the National Assembly notice of the January 2026 reform');
  assert.ok(ve.some(s => s.section === 'legal' && /ofac\.treasury\.gov$/.test(hostOf(s.url)) && /public domain/i.test(s.licence)), 'VE: the OFAC Venezuela programme page, public domain');
  assert.ok(ve.some(s => s.section === 'licensing' && s.access === 'rss' && /minhidrocarburos\.gob\.ve$/.test(hostOf(s.url))), 'VE: the Ministry RSS feed is the dated record the round watch reads');
  assert.ok(ve.some(s => s.section === 'licensing' && /no licence rounds/i.test(s.note ?? '')), 'VE: the licensing note says there are no licence rounds, only awards');
  assert.ok(ve.some(s => s.section === 'legal' && s.access === 'pdf' && /faolex\.fao\.org\/docs\/pdf\/ven69660\.pdf$/.test(s.url)), 'VE: the FAOLEX text copy of the 2006 law (the Ministry\'s own is a scan)');
  assert.ok(ve.some(s => s.section === 'service' && /faolex\.fao\.org\/docs\/pdf\/ven88234\.pdf$/.test(s.url)), 'VE: the 2009 law reserving oilfield services to the state');
  assert.ok(ve.some(s => s.id === 've-ley-organica-hidrocarburos-2006' && /scan/.test(s.note ?? '') && /OCR/.test(s.note ?? '')), 'VE: the Ministry\'s scanned copy says it needs OCR');
  assert.ok(!ve.some(s => /eia\.gov\/international\/analysis/.test(s.url)), 'VE: the script-rendered EIA analysis page is not registered');
  assert.match(registry.countries.VE.accounts_note ?? '', /6\.978/, 'VE: the data-room note names the reform gazette');
});

test('registry: licence and attribution lines are the ones the research recorded', () => {
  const gb = registry.countries.GB.sources.filter(s => /nstauthority|arcgis/.test(hostOf(s.url)));
  assert.ok(gb.length >= 4);
  for (const s of gb) {
    assert.equal(s.attribution, 'Contains information provided by the North Sea Transition Authority and/or other third parties', `${s.id}: the NSTA User Agreement's mandatory line`);
    assert.match(s.licence, /NSTA Open User Licence|NSTA User Agreement/);
  }
  const ndr = registry.countries.GB.sources.find(s => s.section === 'regulator' && /national-data-repository|ndr\./.test(s.url));
  assert.ok(ndr && /not open data|separate portal/i.test(ndr.note ?? ''), 'GB: the NDR is a separate portal, not open data');
  for (const s of registry.countries.NO.sources) {
    assert.match(s.licence, /NLOD/, `${s.id}: Norwegian Licence for Open Government Data`);
    assert.match(s.licence, /third.party/i, `${s.id}: the third-party caveat on reports, core images and logs`);
    assert.match(s.attribution, /Norwegian Offshore Directorate|Sokkeldirektoratet/);
  }
  const sodir = registry.countries.NO.sources.find(s => s.access === 'csv' && s.section === 'licensing');
  assert.equal((sodir?.options as any)?.freshness_column, 'DatesyncNPD', 'NO: the sync timestamp is the freshness');
  const anh = registry.countries.CO.sources.find(s => s.access === 'arcgis');
  assert.ok(anh && /2,000|2000/.test(anh.note ?? '') && /unverified|not been read/i.test(anh.licence), 'CO: the 2,000 record cap and the unverified reuse terms are on the entry');
  assert.ok((anh?.options as any)?.max_records >= 2000, 'CO: the registry cap is at least one server page');
  for (const s of registry.countries.AR.sources.filter(s => s.access === 'ckan')) {
    assert.equal(s.licence, 'CC-BY-4.0', `${s.id}: as package_show states it`);
    assert.ok(s.allowed_domains.includes('http://datos.energia.gob.ar'), `${s.id}: plain HTTP allowed explicitly`);
    assert.ok(s.url.startsWith('http://datos.energia.gob.ar/'), `${s.id}: the CKAN answers only over plain HTTP`);
  }
  for (const s of registry.countries.BR.sources) assert.match(s.attribution, /ANP/, `${s.id}: ANP attribution`);
  assert.ok(registry.countries.BR.sources.some(s => s.access === 'csv' && /blocos-ofertados/.test(s.url)), 'BR: blocks offered CSV');
  assert.ok(registry.countries.BR.sources.some(s => /oferta-permanente/.test(s.url) && s.section === 'licensing'), 'BR: the Oferta Permanente pages');
  assert.ok(registry.countries.BR.sources.some(s => s.section === 'regulator' && /dados-tecnicos/.test(s.url)), 'BR: BDEP and the technical data package');
  for (const s of registry.countries.US.sources) assert.match(s.attribution, /BOEM|Bureau of Ocean Energy Management/, `${s.id}`);
  assert.ok(registry.countries.US.sources.some(s => s.section === 'licensing' && /lease-sale/.test(s.url)), 'US: BOEM lease sale pages');
  assert.ok(registry.countries.US.sources.some(s => s.section === 'regulator' && /data\.boem\.gov/.test(s.url)), 'US: BOEM Data Center downloads');
});

test('registry: sections per source follow the P1 table (licensing, regulator, companies, production, legal, fiscal, service only; risk, literature and questions are derived)', () => {
  for (const [cc, s] of all()) assert.ok(!['risk', 'literature', 'questions'].includes(s.section), `${cc}/${s.id}: ${s.section} is derived, not sourced`);
  for (const cc of FEED) assert.ok(registry.countries[cc].sources.some(s => s.section === 'companies'), `${cc}: a who-works-there source from the regulator`);
});
