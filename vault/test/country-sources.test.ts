// Wave 7 PR4 (W7-AC17, docs/vault-hub/wave7/05-markup.md §1.8): the source registry validates; every generic source
// carries the licence and the attribution line the research recorded; a URL outside its allowed domains is refused
// before any request; a {year} series resolves to the current edition, then the previous; a country with no entry
// gets the generic set and a note. Public licensed sources only (Choice Sheet D67): never IEA datasets, OnePetro,
// OpenCorporates or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadRegistry, parseRegistry, registryProblems, resolveSeries, sourcesFor, fillPlaceholders, ttlFor, REGISTRY_PATH, isBlockedHost } from '../src/country/registry.ts';
import { fetchSource, hostAllowed } from '../src/country/fetch.ts';
import { SECTION_IDS, type CountrySource } from '../src/country/types.ts';

const NOW = new Date('2026-10-05T09:00:00Z');
const src = (over: Partial<CountrySource> = {}): CountrySource => ({
  id: 'x', section: 'legal', url: 'https://eiti.org/countries/colombia', access: 'html', licence: 'CC BY 4.0', attribution: 'EITI', allowed_domains: ['eiti.org'], ...over,
});

test('the registry file validates and names the generic sources the proposal verified', () => {
  const reg = loadRegistry();
  assert.deepEqual(registryProblems(reg), []);
  const ids = reg.generic.map(s => s.id);
  for (const id of ['chambers-oil-gas', 'legal500-energy-oil-gas', 'eiti-country-page', 'eiti-summary-data', 'resourcecontracts-search', 'resourcecontracts-text', 'gem-extraction-tracker', 'eia-international', 'jodi-oil-monthly', 'pwc-tax-summaries', 'pwc-tax-summaries-other-taxes']) {
    assert.ok(ids.includes(id), `generic source ${id} is registered`);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const s of reg.generic) {
    assert.ok(SECTION_IDS.includes(s.section), `${s.id}: section ${s.section} is one of the ten`);
    assert.ok(s.licence.trim().length > 8, `${s.id} carries its licence`);
    assert.ok(s.attribution.trim().length > 8, `${s.id} carries its attribution line`);
    assert.ok(s.allowed_domains.length > 0, `${s.id} names the domains the fetch may touch`);
  }
  const by = Object.fromEntries(reg.generic.map(s => [s.id, s]));
  assert.match(by['resourcecontracts-search'].licence, /CC BY-SA 4\.0/);
  assert.match(by['gem-extraction-tracker'].licence, /CC BY 4\.0/);
  assert.match(by['eia-international'].url, /facets\[countryRegionId\]\[\]=\{cc3\}/, 'the EIA country facet is the alpha-3 code');
  assert.match(by['pwc-tax-summaries'].url, /\{country\}\/corporate\/taxes-on-corporate-income$/);
  assert.equal(by['pwc-tax-summaries-other-taxes'].section, 'fiscal');
  assert.match(by['eia-international'].licence, /public domain/i);
  assert.match(by['eia-international'].attribution, /U\.S\. Energy Information Administration/);
  assert.equal(by['gem-extraction-tracker'].access, 'adapter', 'GEM is read from the imported master file, never fetched');
  assert.match(by['chambers-oil-gas'].url, /\{year\}/, 'Chambers is a series');
  assert.equal(by['chambers-oil-gas'].section, 'legal');
  assert.equal(by['jodi-oil-monthly'].section, 'production');
  assert.equal(by['pwc-tax-summaries'].section, 'fiscal');
});

test('D67 and the hard constraints: no source touches IEA data, OnePetro, OpenCorporates or LinkedIn', () => {
  const raw = readFileSync(REGISTRY_PATH, 'utf8').toLowerCase();
  for (const host of ['iea.org', 'onepetro.org', 'opencorporates.com', 'linkedin.com']) assert.ok(!raw.includes(host), `the registry never names ${host} as a source`);
  for (const host of ['www.iea.org', 'onepetro.org', 'api.opencorporates.com', 'www.linkedin.com']) assert.equal(isBlockedHost(host), true, `${host} is refused by code`);
  assert.equal(isBlockedHost('eiti.org'), false);
});

test('registryProblems names what is wrong: a missing licence, an unknown section, an empty allow-list, a host outside it, a bad access', () => {
  const bad = {
    generic: [
      src({ id: 'no-licence', licence: '' }),
      src({ id: 'no-attribution', attribution: '   ' }),
      src({ id: 'odd-section', section: 'weather' as any }),
      src({ id: 'no-domains', allowed_domains: [] }),
      src({ id: 'outside', url: 'https://evil.example.com/page', allowed_domains: ['eiti.org'] }),
      src({ id: 'bad-access', access: 'ftp' as any }),
      src({ id: 'dup' }), src({ id: 'dup' }),
    ],
    countries: { co: { name: 'Colombia', sources: [src({ id: 'anh', url: 'not a url' })] } },
  };
  const problems = registryProblems(bad);
  const has = (re: RegExp) => assert.ok(problems.some(p => re.test(p)), `expected a problem matching ${re}; got:\n${problems.join('\n')}`);
  has(/no-licence.*licence/); has(/no-attribution.*attribution/); has(/odd-section.*section/); has(/no-domains.*allowed_domains/);
  has(/outside.*evil\.example\.com/); has(/bad-access.*access/); has(/dup.*duplicate/i); has(/"co".*upper case|co.*ISO/i); has(/anh.*url/);
  assert.throws(() => parseRegistry(bad), /registry/);
  assert.deepEqual(registryProblems({ generic: [src()], countries: {} }), []);
  // The subdomain of an allowed domain is inside it; a look-alike is not.
  assert.equal(hostAllowed('https://api.eiti.org/x', ['eiti.org']), true);
  assert.equal(hostAllowed('https://eiti.org.evil.com/x', ['eiti.org']), false);
  assert.equal(hostAllowed('https://noteiti.org/x', ['eiti.org']), false);
});

test('sourcesFor: the country entries come first, then the generic set; a country with no entry gets the generic set and a note', () => {
  const reg = parseRegistry({
    generic: [src({ id: 'g1' }), src({ id: 'g2', section: 'fiscal' })],
    countries: { GY: { name: 'Guyana', regulator: 'Ministry of Natural Resources', sources: [src({ id: 'gy-act', url: 'https://petroleum.gov.gy/act', allowed_domains: ['petroleum.gov.gy'] })] } },
  });
  const gy = sourcesFor(reg, 'GY');
  assert.deepEqual(gy.sources.map(s => s.id), ['gy-act', 'g1', 'g2']);
  assert.equal(gy.note, null);
  assert.equal(gy.name, 'Guyana');
  assert.equal(gy.regulator, 'Ministry of Natural Resources');
  const na = sourcesFor(reg, 'NA');
  assert.deepEqual(na.sources.map(s => s.id), ['g1', 'g2']);
  assert.match(na.note!, /regulator is not yet registered/i);
  assert.equal(na.name, 'Namibia', 'the name comes from the ISO table when there is no entry');
  assert.throws(() => sourcesFor(reg, 'xx'), /country code/);
  assert.equal(ttlFor(src({ section: 'licensing' })), 7);
  assert.equal(ttlFor(src({ section: 'licensing', ttl_days: 3 })), 3);
});

test('placeholders: {cc}, {cc_lower} and {country} are filled from the country; the slug is the name in lower case with hyphens', () => {
  assert.equal(fillPlaceholders('https://eiti.org/api?country={cc}&c={cc_lower}', { code: 'GY', name: 'Guyana' }), 'https://eiti.org/api?country=GY&c=gy');
  assert.equal(fillPlaceholders('https://api.eia.gov/v2/international/data/?facets[countryRegionId][]={cc3}', { code: 'VE', name: 'Venezuela' }), 'https://api.eia.gov/v2/international/data/?facets[countryRegionId][]=VEN', 'the EIA keys countries by ISO alpha-3');
  assert.equal(fillPlaceholders('{cc3}', { code: 'GB', name: 'United Kingdom' }), 'GBR');
  assert.equal(fillPlaceholders('{cc3}', { code: 'XX', name: 'Nowhere' }), 'XX', 'an unassigned code stays as it is');
  assert.equal(fillPlaceholders('https://x.org/{country}', { code: 'GB', name: 'United Kingdom' }), 'https://x.org/united-kingdom');
  assert.equal(fillPlaceholders('https://x.org/{country}', { code: 'CI', name: "Côte d'Ivoire" }), 'https://x.org/cote-divoire');
  assert.equal(fillPlaceholders('https://x.org/{country}', { code: 'TT', name: 'Trinidad & Tobago' }), 'https://x.org/trinidad-tobago');
  assert.equal(fillPlaceholders('https://x.org/{country}', { code: 'US', name: 'United States (offshore)', slug: 'united-states' }), 'https://x.org/united-states', 'an entry may name the slug the sites use instead of its display name');
});

test('slug overrides: the United States entry names the slugs the law and tax sites use, per site where they differ; registryProblems rejects a slug that is not one or names no source', () => {
  // 6 Oct 2026: "United States (offshore)" became "united-states-offshore-", so Chambers, Legal 500 and PwC all missed.
  const reg = loadRegistry();
  const us = sourcesFor(reg, 'US');
  const url = (id: string) => us.sources.find(s => s.id === id)!.url;
  assert.equal(url('chambers-oil-gas'), 'https://practiceguides.chambers.com/practice-guides/oil-gas-{year}/usa');
  assert.equal(url('pwc-tax-summaries'), 'https://taxsummaries.pwc.com/united-states/corporate/taxes-on-corporate-income');
  assert.equal(url('legal500-energy-oil-gas'), 'https://www.legal500.com/guides/chapter/united-states-energy-oil-gas/');
  assert.equal(sourcesFor(reg, 'VE').sources.find(s => s.id === 'pwc-tax-summaries')!.url, 'https://taxsummaries.pwc.com/venezuela/corporate/taxes-on-corporate-income', 'a country without overrides keeps the name slug');
  const bad = JSON.parse(JSON.stringify(reg));
  bad.countries.US.slug = 'United States'; bad.countries.US.slugs = { 'no-such-source': 'usa' };
  const problems = registryProblems(bad);
  assert.ok(problems.some(p => /countries\.US: slug/.test(p)), problems.join('; '));
  assert.ok(problems.some(p => /countries\.US: slugs "no-such-source"/.test(p)), problems.join('; '));
});

test('resolveSeries: {year} tries the current year, then the previous, and gives up after that', async () => {
  const tried: string[] = [];
  const answer = (ok: (u: string) => boolean) => async (u: string) => { tried.push(u); return ok(u); };
  assert.equal(await resolveSeries('https://p.chambers.com/oil-gas-{year}/namibia', NOW, answer(u => u.includes('2026'))), 'https://p.chambers.com/oil-gas-2026/namibia');
  assert.deepEqual(tried, ['https://p.chambers.com/oil-gas-2026/namibia']);
  tried.length = 0;
  assert.equal(await resolveSeries('https://p.chambers.com/oil-gas-{year}/namibia', NOW, answer(u => u.includes('2025'))), 'https://p.chambers.com/oil-gas-2025/namibia');
  assert.deepEqual(tried, ['https://p.chambers.com/oil-gas-2026/namibia', 'https://p.chambers.com/oil-gas-2025/namibia']);
  tried.length = 0;
  assert.equal(await resolveSeries('https://p.chambers.com/oil-gas-{year}/namibia', NOW, answer(() => false)), null);
  assert.equal(tried.length, 2, 'two editions at most');
  tried.length = 0;
  assert.equal(await resolveSeries('https://p.chambers.com/fixed', NOW, answer(() => true)), 'https://p.chambers.com/fixed', 'no series: the url as given, nothing tried');
  assert.equal(tried.length, 0);
});

test('a url outside allowed_domains is refused before any request is made', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response('<html><title>x</title></html>', { status: 200 }); }) as unknown as typeof fetch;
  const r = await fetchSource(src({ url: 'https://evil.example.com/page', allowed_domains: ['eiti.org'] }), { country: 'CO', fetch: fetchImpl, now: () => NOW });
  assert.equal(r.unreachable, true);
  assert.match((r as any).reason, /outside .*allowed/i);
  assert.equal(calls, 0, 'no request was made');
  const blocked = await fetchSource(src({ url: 'https://www.iea.org/data', allowed_domains: ['iea.org'] }), { country: 'CO', fetch: fetchImpl, now: () => NOW });
  assert.equal(blocked.unreachable, true);
  assert.match((blocked as any).reason, /refus/i);
  assert.equal(calls, 0);
});
