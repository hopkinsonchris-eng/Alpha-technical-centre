// Wave 3, PR 3 and PR 4 (docs/vault-hub/wave3/05-markup.md §1.5): the World Monitor adapter. Server-side
// only, cached an hour, a 429 honoured for its Retry-After and never retried in a loop, 401 reported as not
// connected, 403 as Pro-gated. Fixtures follow the published OpenAPI shapes (epoch-millisecond timestamps,
// enum names, the headline bucket keyed by country). Smoke tests for W3-AC9 (adapter part) and W3-AC10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acledEvents, advisories, configureWorldMonitor, countryFacts, countryRisk, coverage, energyProfile, enumWord, headlines, humanitarian, intelBrief, intelTimeline,
  outages, portActivity, resetWorldMonitorCache, resilience, sanctions, ucdpEvents, whenIso, worldMonitorConfigured, NEEDS_PRO, NOT_CONNECTED,
  companyEnrichment, companySignals, gdeltDocuments, secFilings,
} from '../src/intel/worldmonitor.ts';

const KEY = 'wm_' + 'a'.repeat(40);
let t = Date.parse('2026-10-01T09:00:00Z');
const now = () => new Date(t);
const calls: { url: string; key: string | null }[] = [];
const T0 = Date.parse('2026-10-01T08:00:00Z');
const FIX: Record<string, unknown> = {
  'get-country-risk': { countryCode: 'VE', countryName: 'Venezuela', cii: { region: 'South America', staticBaseline: 58, dynamicScore: 46, combinedScore: 50.4, trend: 'TREND_DIRECTION_RISING', components: { newsActivity: 12.5, ciiContribution: 30, geoConvergence: 4, militaryActivity: 3.9 }, computedAt: T0, methodologyVersion: 'cii-3', eventMultiplier: 1.1, advisoryLevel: 'reconsider', advisoryProvenance: 'state-dept' }, advisoryLevel: 'reconsider', sanctionsActive: true, sanctionsCount: 212, fetchedAt: T0 + 60_000, upstreamUnavailable: false },
  'list-acled-events': { events: [{ id: 'VEN12345', eventType: 'Protests', country: 'Venezuela', location: { latitude: 7.24, longitude: -70.73 }, occurredAt: Date.parse('2026-09-28T00:00:00Z'), fatalities: 0, actors: ['Protesters (Venezuela)', 'Police Forces of Venezuela'], source: 'ACLED', admin1: 'Apure' }], pagination: { nextCursor: '', totalCount: 1 } },
  'list-ucdp-events': { events: [{ id: 'u1', dateStart: Date.parse('2026-08-02T00:00:00Z'), dateEnd: Date.parse('2026-08-02T00:00:00Z'), location: { latitude: 10.5, longitude: -66.9 }, country: 'Venezuela', sideA: 'Government of Venezuela', sideB: 'FARC dissidents', deathsBest: 3, deathsLow: 2, deathsHigh: 5, violenceType: 'UCDP_VIOLENCE_TYPE_STATE_BASED', sourceOriginal: 'press' }] },
  'list-country-headlines': { countries: { VE: { items: [{ source: 'Reuters', title: 'PDVSA restarts Apure field', link: 'https://example.com/a', publishedAt: Date.parse('2026-09-30T10:00:00Z') }] } }, state: 'ok', feedTotal: 40, feedCached: 40, readAt: '2026-10-01T08:55:00Z' },
  'get-country-intel-brief': { countryCode: 'VE', countryName: 'Venezuela', brief: 'Venezuela remains under sanctions pressure while output recovers slowly.', model: 'wm-brief-1', generatedAt: T0, sources: [{ title: 'OFAC update', source: 'Treasury', url: 'https://example.com/ofac', publishedAt: '2026-09-29T12:00:00Z' }], evidence: [{ id: 'ev-1', kind: 'production', label: 'Crude output', value: '0.9 mb/d', factText: 'Crude output averaged 0.9 mb/d in August', asOf: '2026-08-31', url: 'https://example.com/opec' }] },
  'get-country-coverage': { countryCode: 'VE', countryName: 'Venezuela', windowHours: 72, generatedAt: '2026-10-01T08:50:00Z', headlines: [{ title: 'Oil workers strike in Monagas', url: 'https://example.com/b', source: 'AP', publishedAt: '2026-09-30', publishedAtMs: Date.parse('2026-09-30T06:00:00Z') }], events: [{ timestampMs: Date.parse('2026-09-30T06:00:00Z'), occurredAt: '2026-09-30T06:00:00Z', lane: 'unrest', label: 'Strike at Monagas fields', severity: 'medium', origin: 'news', source: 'AP' }], sources: [{ source: 'acled', state: 'fresh', detail: '', fetchedAt: '2026-10-01T08:00:00Z', ageSeconds: 3000, contributed: 1 }], degraded: false, containment: 'none' },
  'get-country-energy-profile': { mixAvailable: true, mixYear: 2023, coalShare: 0, gasShare: 0.21, oilShare: 0.08, nuclearShare: 0, renewShare: 0.71, windShare: 0, solarShare: 0, hydroShare: 0.71, importShare: 0.02, jodiOilAvailable: true, jodiOilDataMonth: '2026-07', crudeImportsKbd: 0, gasolineDemandKbd: 110, gasolineImportsKbd: 35, dieselDemandKbd: 90, dieselImportsKbd: 10, jodiGasAvailable: false, ieaStocksAvailable: false, gasStorageAvailable: false, electricityAvailable: false },
  'get-country-port-activity': { ports: [{ portId: 'VEPLC', portName: 'Puerto La Cruz', lat: 10.2, lon: -64.6, tankerCalls30d: 18, trendDeltaPct: -12.5, importTankerDwt: 100000, exportTankerDwt: 950000, anomalySignal: false }], fetchedAt: '2026-10-01T08:30:00Z', available: true },
  'get-country-facts': { headOfState: 'N. Maduro', headOfStateTitle: 'President', wikipediaSummary: 'Venezuela is a country…', population: 28000000, capital: 'Caracas', languages: ['Spanish'], currencies: ['VES'], areaSqKm: 916445, countryName: 'Venezuela' },
  'get-humanitarian-summary': { summary: { countryCode: 'VE', countryName: 'Venezuela', conflictEventsTotal: 420, conflictPoliticalViolenceEvents: 120, conflictFatalities: 35, referencePeriod: '2026-07/2026-09', conflictDemonstrations: 300, updatedAt: T0 } },
  'list-security-advisories': { advisories: [{ title: 'Venezuela: reconsider travel', link: 'https://example.com/adv', pubDate: '2026-09-01T00:00:00Z', source: 'US State Department', sourceCountry: 'US', level: '3', country: 'VE' }, { title: 'Colombia: exercise caution', link: '', pubDate: '', source: 'FCDO', sourceCountry: 'GB', level: '2', country: 'CO' }], byCountry: { VE: 'Level 3' } },
  'list-sanctions-pressure': { entries: [{ id: 's1', name: 'Some Shipping Co', entityType: 'SANCTIONS_ENTITY_TYPE_ENTITY', countryCodes: ['VE'], countryNames: ['Venezuela'], programs: ['VENEZUELA'], sourceLists: ['SDN'], effectiveAt: '2026-09-15', isNew: true, note: '' }], countries: [{ countryCode: 'VE', countryName: 'Venezuela', entryCount: 212, newEntryCount: 4, vesselCount: 30, aircraftCount: 2 }], programs: [], fetchedAt: '2026-10-01', datasetDate: '2026-09-30', totalCount: 9000 },
  'get-resilience-score': { countryCode: 'VE', overallScore: 31.2, level: 'low', trend: 'stable', change30d: -0.4, lowConfidence: false, domains: [{ id: 'energy', score: 44, weight: 0.2 }] },
  'list-internet-outages': { outages: [{ id: 'o1', title: 'Partial outage in Zulia', link: 'https://example.com/o', detectedAt: Date.parse('2026-09-27T03:00:00Z'), country: 'VE', region: 'Zulia', severity: 'OUTAGE_SEVERITY_PARTIAL', cause: 'power', endedAt: 0 }] },
  'search-gdelt-documents': { articles: [{ url: 'https://news.example.com/a1', title: 'PDVSA restarts Guafita', source: 'Reuters', seendate: '20260930T100000Z', language: 'English', tone: 1.5 }, { url: '', title: '' }], total: 1 },
  'get-company-enrichment': { company: { name: 'Petróleos de Venezuela', domain: 'pdvsa.com', description: 'State oil company.', location: 'Caracas', website: 'https://www.pdvsa.com', founded: 1976, cik: '0000001', ticker: null }, market: { industry: 'Oil & Gas', country: 'VE', marketCapMusd: 12.5 }, secFilings: { recentFilings: [{ form: '20-F', filedAt: T0, url: 'https://sec.example.com/f1' }] }, sources: ['wikipedia', 'sec'] },
  'list-company-signals': { signals: [{ type: '8-K', title: 'Item 8.01 Other events', url: 'https://sec.example.com/8k', source: 'SEC', sourceTier: 1, timestampMs: T0, strength: 'high' }] },
  'search-sec-filings': { results: [{ company: 'Chevron Corp', cik: '93410', form: '10-K', fileDate: '2026-02-20', items: ['Item 1A', 'Item 7'], url: 'https://sec.example.com/10k', accession: '0000093410-26-000012' }] },
  'get-intel-timeline': { records: [{ id: 'r1', domain: 'energy', resource: 'x', country: 'VE', category: 'production', title: 'Output recovers in Orinoco belt', summary: 'Chevron ramps Petropiar.', sourceUrl: 'https://example.com/r', occurredAt: Date.parse('2026-09-20T00:00:00Z'), ingestedAt: T0, score: 0.8 }], partial: false },
};
let mode: 'ok' | '429' | '401' | '403' | '500' = 'ok';
const proGated = new Set<string>();
const fakeFetch = (async (url: string, init: any) => {
  calls.push({ url, key: init?.headers?.['X-WorldMonitor-Key'] ?? null });
  const u = new URL(url);
  const ep = u.pathname.split('/').pop()!;
  if (mode === '429') return new Response('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': '120' } });
  if (mode === '401') return new Response('{"error":"unauthorized"}', { status: 401 });
  if (mode === '403' || proGated.has(ep)) return new Response('{"code":"pro_required","message":"PRO entitlement access denied."}', { status: 403 });
  if (mode === '500') return new Response('boom', { status: 500 });
  return new Response(JSON.stringify(FIX[ep] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

test('helpers: epoch milliseconds, seconds and ISO strings become ISO; enum names lose their prefix', () => {
  assert.equal(whenIso(T0), '2026-10-01T08:00:00.000Z');
  assert.equal(whenIso(String(T0)), '2026-10-01T08:00:00.000Z');
  assert.equal(whenIso(Math.floor(T0 / 1000)), '2026-10-01T08:00:00.000Z');
  assert.equal(whenIso('2026-09-30T10:00:00Z'), '2026-09-30T10:00:00.000Z');
  assert.equal(whenIso(0), null); assert.equal(whenIso(''), null); assert.equal(whenIso('soon'), null);
  assert.equal(enumWord('TREND_DIRECTION_RISING'), 'rising'); assert.equal(enumWord('SEVERITY_LEVEL_UNSPECIFIED'), null); assert.equal(enumWord('UCDP_VIOLENCE_TYPE_STATE_BASED'), 'based');
});

test('without a key every reader says not connected and nothing is fetched', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: null, now });
  assert.equal(worldMonitorConfigured(), false);
  assert.deepEqual(await countryRisk('VE'), { ok: false, reason: NOT_CONNECTED });
  assert.deepEqual(await intelBrief('VE'), { ok: false, reason: NOT_CONNECTED });
  assert.equal(calls.length, 0);
});

test('W3-AC9: the risk reading follows the published shape (score, trend, components, sanctions, epoch timestamps) with the key in the header, cached an hour per country', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
  calls.length = 0;
  const r = await countryRisk('VE');
  assert.ok(r.ok);
  assert.deepEqual(r.data, { score: 50.4, level: 'reconsider', trend: 'rising', static_baseline: 58, dynamic_score: 46, components: { newsActivity: 12.5, ciiContribution: 30, geoConvergence: 4, militaryActivity: 3.9 }, computed_at: '2026-10-01T08:00:00.000Z', methodology: 'cii-3', advisory_provenance: 'state-dept', sanctions_active: true, sanctions_count: 212, region: 'South America' });
  assert.equal(r.fetched_at, '2026-10-01T09:00:00.000Z');
  assert.equal(calls[0].key, KEY);
  assert.match(calls[0].url, /^https:\/\/api\.worldmonitor\.app\/api\/intelligence\/v1\/get-country-risk\?country_code=VE$/);
  const again = await countryRisk('VE');
  assert.ok(again.ok && again.cached);
  assert.equal(calls.length, 1);
  await countryRisk('KZ');
  assert.equal(calls.length, 2);
  t += 3_600_001;
  const fresh = await countryRisk('VE');
  assert.ok(fresh.ok && !fresh.cached);
  assert.equal(calls.length, 3);
});

test('W3-AC9: events, headlines and the rest read the real field names and parameters', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
  calls.length = 0;
  const e = await acledEvents('VE');
  assert.ok(e.ok);
  assert.deepEqual(e.data[0], { id: 'VEN12345', type: 'Protests', sub_type: null, admin1: 'Apure', location: null, lat: 7.24, lon: -70.73, actors: 'Protesters (Venezuela) vs Police Forces of Venezuela', fatalities: 0, date: '2026-09-28T00:00:00.000Z', notes: null, source: 'ACLED' });
  assert.match(calls.at(-1)!.url, /list-acled-events\?country=VE&start=\d+&end=\d+$/);
  const h = await headlines('VE');
  assert.ok(h.ok);
  assert.match(calls.at(-1)!.url, /list-country-headlines\?country_codes=VE$/);
  assert.deepEqual(h.data, [{ n: 1, title: 'PDVSA restarts Apure field', source: 'Reuters', url: 'https://example.com/a', published_at: '2026-09-30T10:00:00.000Z' }]);
  const u = await ucdpEvents('VE'); assert.ok(u.ok); assert.equal(u.data[0].deaths, 3); assert.equal(u.data[0].date, '2026-08-02T00:00:00.000Z');
  const b = await intelBrief('VE'); assert.ok(b.ok); assert.equal(b.data.model, 'wm-brief-1'); assert.equal(b.data.evidence[0].fact, 'Crude output averaged 0.9 mb/d in August'); assert.equal(b.data.generated_at, '2026-10-01T08:00:00.000Z');
  const c = await coverage('VE'); assert.ok(c.ok); assert.equal(c.data.window_hours, 72); assert.equal(c.data.events[0].label, 'Strike at Monagas fields'); assert.equal(c.data.headlines[0].published_at, '2026-09-30T06:00:00.000Z');
  assert.match(calls.at(-1)!.url, /get-country-coverage\?country_code=VE&window_hours=72&limit=40$/);
  const en = await energyProfile('VE'); assert.ok(en.ok); assert.equal(en.data.mix!.hydro, 0.71); assert.equal(en.data.oil!.gasoline_demand_kbd, 110); assert.equal(en.data.gas, null);
  const p = await portActivity('VE'); assert.ok(p.ok); assert.equal(p.data[0].name, 'Puerto La Cruz'); assert.equal(p.data[0].tanker_calls_30d, 18);
  const f = await countryFacts('VE'); assert.ok(f.ok); assert.equal(f.data.capital, 'Caracas'); assert.deepEqual(f.data.languages, ['Spanish']);
  const hu = await humanitarian('VE'); assert.ok(hu.ok); assert.equal(hu.data.fatalities, 35); assert.equal(hu.data.updated_at, '2026-10-01T08:00:00.000Z');
  const a = await advisories('VE'); assert.ok(a.ok); assert.equal(a.data.length, 1); assert.equal(a.data[0].source, 'US State Department');
  const s = await sanctions('VE'); assert.ok(s.ok); assert.equal(s.data.entries, 212); assert.equal(s.data.recent[0].type, 'entity'); assert.equal(s.data.recent[0].is_new, true);
  assert.match(calls.at(-1)!.url, /list-sanctions-pressure\?max_items=200$/);
  const rs = await resilience('VE'); assert.ok(rs.ok); assert.equal(rs.data.score, 31.2); assert.equal(rs.data.domains[0].id, 'energy');
  assert.match(calls.at(-1)!.url, /get-resilience-score\?countryCode=VE$/);
  const o = await outages('VE'); assert.ok(o.ok); assert.equal(o.data[0].severity, 'partial'); assert.equal(o.data[0].ended_at, null);
  const tl = await intelTimeline('VE'); assert.ok(tl.ok); assert.equal(tl.data[0].title, 'Output recovers in Orinoco belt'); assert.equal(tl.data[0].occurred_at, '2026-09-20T00:00:00.000Z');
  assert.ok(calls.every(c => c.key === KEY && c.url.startsWith('https://api.worldmonitor.app/')));
});

test('W3-AC9: a 429 is honoured for its Retry-After and reported, never retried in a loop; 401 is not connected; 403 is Pro-gated per endpoint; a 500 is reported', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
  calls.length = 0; mode = '429';
  const r = await countryRisk('VE');
  assert.ok(!r.ok);
  assert.match(r.reason, /rate limited by World Monitor; retry after 120 s/);
  assert.equal(r.retry_after_s, 120);
  const e = await acledEvents('VE');
  assert.ok(!e.ok && /rate limited/.test(e.reason));
  assert.equal(calls.length, 1, 'no further call while the limit holds');
  t += 121_000; mode = 'ok';
  resetWorldMonitorCache();
  assert.ok((await countryRisk('VE')).ok);
  mode = '401'; resetWorldMonitorCache();
  const no = await countryRisk('KZ');
  assert.ok(!no.ok);
  assert.match(no.reason, /not connected: World Monitor answered HTTP 401/);
  mode = 'ok'; proGated.add('get-country-intel-brief'); resetWorldMonitorCache();
  const ib = await intelBrief('VE');
  assert.ok(!ib.ok && ib.pro === true);
  assert.equal(ib.reason, NEEDS_PRO);
  assert.ok((await countryRisk('VE')).ok, 'a Pro-gated section never hides the others');
  proGated.clear();
  mode = '500'; resetWorldMonitorCache();
  const bad = await headlines('KZ');
  assert.ok(!bad.ok && /HTTP 500/.test(bad.reason));
  mode = 'ok';
});

test('wave 4 research readers: GDELT articles, company enrichment and signals, SEC filings on their OpenAPI shapes', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now }); calls.length = 0;
  const g = await gdeltDocuments('"Guafita" Venezuela', { maxRecords: 5 });
  assert.ok(g.ok);
  assert.deepEqual(g.data, [{ title: 'PDVSA restarts Guafita', url: 'https://news.example.com/a1', source: 'Reuters', date: '2026-09-30T10:00:00.000Z', language: 'English', tone: 1.5 }], 'the compact GDELT date becomes ISO; an empty row is dropped');
  const gu = new URL(calls.at(-1)!.url);
  assert.equal(gu.searchParams.get('query'), '"Guafita" Venezuela'); assert.equal(gu.searchParams.get('max_records'), '5'); assert.equal(gu.searchParams.get('timespan'), '1y');
  const e = await companyEnrichment('Petróleos de Venezuela');
  assert.ok(e.ok);
  assert.equal(e.data.name, 'Petróleos de Venezuela'); assert.equal(e.data.industry, 'Oil & Gas'); assert.equal(e.data.market_cap_musd, 12.5); assert.equal(e.data.cik, '0000001');
  assert.deepEqual(e.data.recent_filings, [{ form: '20-F', date: '2026-10-01T08:00:00.000Z', url: 'https://sec.example.com/f1' }]); assert.deepEqual(e.data.sources, ['wikipedia', 'sec']);
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get('name'), 'Petróleos de Venezuela');
  const sg = await companySignals('PDVSA');
  assert.ok(sg.ok);
  assert.deepEqual(sg.data, [{ type: '8-K', title: 'Item 8.01 Other events', url: 'https://sec.example.com/8k', source: 'SEC', tier: 1, at: '2026-10-01T08:00:00.000Z', strength: 'high' }]);
  const sf = await secFilings('Chevron', { limit: 3 });
  assert.ok(sf.ok);
  assert.deepEqual(sf.data, [{ company: 'Chevron Corp', cik: '93410', form: '10-K', file_date: '2026-02-20', items: ['Item 1A', 'Item 7'], url: 'https://sec.example.com/10k', accession: '0000093410-26-000012' }]);
  const su = new URL(calls.at(-1)!.url);
  assert.equal(su.searchParams.get('limit'), '3'); assert.equal(su.searchParams.get('end_date'), '2026-10-01'); assert.match(su.searchParams.get('forms')!, /10-K/);
  // Each is cached like the rest, and a Pro gate on one never fails the others.
  calls.length = 0; await gdeltDocuments('"Guafita" Venezuela', { maxRecords: 5 }); assert.equal(calls.length, 0, 'served from the hourly cache');
  proGated.add('search-sec-filings'); resetWorldMonitorCache();
  const gated = await secFilings('Chevron');
  assert.ok(!gated.ok && gated.pro === true);
  assert.ok((await companySignals('PDVSA')).ok);
  proGated.clear();
  configureWorldMonitor({ fetch: fakeFetch, apiKey: null, now });
  assert.deepEqual(await gdeltDocuments('x'), { ok: false, reason: NOT_CONNECTED });
});

test('7 Oct 2026, first live reading: the energy mix arrives as percentages (hydro 91.102, gas 4.493, oil 4.368, wind 0.025, solar 0.012) and is normalised to shares; a fraction mix stays as it is; the sanctions dataset date arrives as epoch milliseconds and becomes a day', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
  const energy = FIX['get-country-energy-profile'] as Record<string, unknown>, sanc = FIX['list-sanctions-pressure'] as Record<string, unknown>;
  FIX['get-country-energy-profile'] = { ...energy, hydroShare: 91.102, gasShare: 4.493, oilShare: 4.368, windShare: 0.025, solarShare: 0.012, renewShare: 91.139, coalShare: 0, nuclearShare: 0, importShare: 0 };
  FIX['list-sanctions-pressure'] = { ...sanc, datasetDate: Date.parse('2026-10-05T00:00:00Z') };
  try {
    const en = await energyProfile('VE'); assert.ok(en.ok);
    assert.equal(en.data.mix!.hydro, 0.91102); assert.equal(en.data.mix!.gas, 0.04493); assert.equal(en.data.mix!.oil, 0.04368);
    assert.equal(en.data.mix!.wind, 0.00025); assert.equal(en.data.mix!.solar, 0.00012);
    assert.equal(en.data.import_share, 0);
    const s = await sanctions('VE'); assert.ok(s.ok); assert.equal(s.data.dataset_date, '2026-10-05');
  } finally { FIX['get-country-energy-profile'] = energy; FIX['list-sanctions-pressure'] = sanc; configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now }); }
  // The recorded fraction shape (sum about 1) is left alone.
  const fr = await energyProfile('VE'); assert.ok(fr.ok); assert.equal(fr.data.mix!.hydro, 0.71); assert.equal(fr.data.import_share, 0.02);
  const sd = await sanctions('VE'); assert.ok(sd.ok); assert.equal(sd.data.dataset_date, sanc.datasetDate ? String(sanc.datasetDate).slice(0, 10) : null);
});

