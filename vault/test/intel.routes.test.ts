// Wave 3 PR 4: GET /api/countries/:code/intel gathers every World Monitor section for a country,
// each answering on its own, so a Pro-gated or failed section never hides the others, and the key
// never leaves the server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-intel-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureWorldMonitor } = await import('../src/intel/worldmonitor.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DOMAIN = 'alpha-technical-centre.com';
const KEY = 'wm_' + 'c'.repeat(40);
let db: Db; let app: Awaited<ReturnType<typeof createApp>>;
const hits: string[] = [];
const fakeFetch = (async (url: string) => {
  hits.push(url);
  const ep = new URL(url).pathname.split('/').pop()!;
  if (ep === 'get-country-intel-brief' || ep === 'get-resilience-score' || ep === 'list-sanctions-pressure' || ep === 'get-intel-timeline' || ep === 'get-country-coverage') return new Response('{"code":"pro_required"}', { status: 403 });
  if (ep === 'get-country-port-activity') return new Response('nope', { status: 500 });
  const bodies: Record<string, unknown> = {
    'get-country-risk': { cii: { combinedScore: 50.4, trend: 'TREND_DIRECTION_RISING', components: { newsActivity: 12.5 }, computedAt: Date.parse('2026-10-01T08:00:00Z') }, advisoryLevel: 'reconsider', sanctionsActive: true, sanctionsCount: 212 },
    'list-acled-events': { events: [{ id: 'VEN1', eventType: 'Protests', admin1: 'Apure', actors: ['Protesters (Venezuela)'], fatalities: 0, occurredAt: Date.parse('2026-09-28T00:00:00Z') }] },
    'list-ucdp-events': { events: [] },
    'list-country-headlines': { countries: { VE: { items: [{ title: 'PDVSA restarts Apure field', source: 'Reuters', link: 'https://example.com/a', publishedAt: Date.parse('2026-09-30T10:00:00Z') }] } } },
    'get-country-energy-profile': { mixAvailable: true, mixYear: 2023, hydroShare: 0.71, gasShare: 0.21, oilShare: 0.08, jodiOilAvailable: true, jodiOilDataMonth: '2026-07', gasolineDemandKbd: 110, dieselDemandKbd: 90 },
    'get-country-facts': { countryName: 'Venezuela', capital: 'Caracas', population: 28000000 },
    'get-humanitarian-summary': { summary: { conflictEventsTotal: 420, conflictFatalities: 35, conflictDemonstrations: 300, referencePeriod: '2026-07/2026-09' } },
    'list-security-advisories': { advisories: [{ title: 'Venezuela: reconsider travel', link: 'https://example.com/adv', pubDate: '2026-09-01', source: 'US State Department', level: '3', country: 'VE' }] },
    'list-internet-outages': { outages: [] },
  };
  return new Response(JSON.stringify(bodies[ep] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, JSON.parse(readFileSync(path.join(FIX, 'ac15/seed.json'), 'utf8')));
  app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
});
after(async () => { configureWorldMonitor({ apiKey: null }); await db.close(); });

test('without a key every section says not connected and nothing is fetched', async () => {
  configureWorldMonitor({ apiKey: null, fetch: fakeFetch });
  const r = await app.request('/api/countries/VE/intel');
  assert.equal(r.status, 200);
  const b: any = await r.json();
  assert.equal(b.world_monitor.status, 'not_connected');
  assert.match(b.world_monitor.reason, /WORLD_MONITOR_API_KEY/);
  assert.ok(Object.values(b.sections).every((s: any) => s.ok === false));
  assert.equal(hits.length, 0);
  assert.equal((await app.request('/api/countries/ve/intel')).status, 400);
  assert.equal((await app.request('/api/countries/VE/intel?sections=risk,nothing')).status, 400);
});

test('with a key the sections answer on their own: live ones carry data, Pro-gated ones say so, a failed one is named, and the key never appears', async () => {
  configureWorldMonitor({ apiKey: KEY, fetch: fakeFetch });
  hits.length = 0;
  const r = await app.request('/api/countries/VE/intel');
  assert.equal(r.status, 200);
  const b: any = await r.json();
  assert.equal(b.country, 'VE');
  assert.deepEqual(b.name, { en: 'Venezuela', es: 'Venezuela' });
  assert.equal(b.world_monitor.status, 'live');
  assert.match(b.world_monitor.fetched_at, /^\d{4}-/);
  assert.deepEqual(b.world_monitor.pro_gated.sort(), ['brief', 'coverage', 'resilience', 'sanctions', 'timeline']);
  assert.deepEqual(b.world_monitor.failed, ['ports: World Monitor answered HTTP 500']);
  assert.equal(b.sections.risk.ok, true);
  assert.equal(b.sections.risk.data.score, 50.4);
  assert.equal(b.sections.risk.data.trend, 'rising');
  assert.equal(b.sections.risk.data.sanctions_count, 212);
  assert.equal(b.sections.events.data[0].admin1, 'Apure');
  assert.equal(b.sections.headlines.data[0].title, 'PDVSA restarts Apure field');
  assert.equal(b.sections.energy.data.oil.gasoline_demand_kbd, 110);
  assert.equal(b.sections.facts.data.capital, 'Caracas');
  assert.equal(b.sections.humanitarian.data.fatalities, 35);
  assert.equal(b.sections.advisories.data[0].level, '3');
  assert.equal(b.sections.brief.ok, false);
  assert.equal(b.sections.brief.pro, true);
  assert.match(b.sections.brief.reason, /needs World Monitor Pro/);
  assert.ok(!JSON.stringify(b).includes(KEY));
  assert.ok(hits.every(u => u.startsWith('https://api.worldmonitor.app/')));
  // The audit row names what answered; a narrowed request reads only what it asked for.
  const audit = (await db.query<any>("SELECT scope, detail FROM audit_events WHERE action = 'country.intel' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audit.scope, 'public');
  assert.ok(audit.detail.answered.includes('risk'));
  hits.length = 0;
  const narrow: any = await (await app.request('/api/countries/VE/intel?sections=risk,headlines')).json();
  assert.deepEqual(Object.keys(narrow.sections).sort(), ['headlines', 'risk']);
  assert.equal(hits.length, 0, 'served from the adapter cache');
});
