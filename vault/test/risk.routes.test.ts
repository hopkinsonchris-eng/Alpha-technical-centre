// Wave 8 (docs/vault-hub/wave8/01-risk-lens.md): the risk lens. Smoke tests written before the code.
//   §1 GET /api/countries carries, per held country, the World Monitor band and trend, the export ports, the primary
//      chokepoint, and per project the ACLED events within 200 km in 30 days; plus `world_risk`, every tracked country's
//      band from the one all-country call, so the globe can tint the whole map from one cached reading.
//   §2 GET /api/risk/table: one row per opportunity the caller may see, five columns (three live, two entered), the
//      register's overall rule, the formula in words on every live cell, the project's own execution risk apart.
//   §3 risk_snapshots: one row a day per held country, never overwritten; deltas over 7 and 30 days read back from it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-risk-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureWorldMonitor, resetWorldMonitorCache } = await import('../src/intel/worldmonitor.ts');
const { sanctionsScore, securityScore, nearby, distanceKm, overallScore, enteredCell } = await import('../src/intel/risk-table.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const KEY = 'wm_' + 'b'.repeat(40);
const T0 = Date.parse('2026-10-01T08:00:00Z');
let clock = Date.parse('2026-10-06T09:00:00Z');
const now = () => new Date(clock);

/** World Monitor, answered per country so the counts in the table are the ones asserted below. */
const RISK: Record<string, unknown> = {
  VE: { countryCode: 'VE', cii: { region: 'VE', combinedScore: 50.4, trend: 'TREND_DIRECTION_RISING', components: { newsActivity: 12.5, ciiContribution: 30, geoConvergence: 4, militaryActivity: 3.9 }, computedAt: T0, advisoryLevel: 'reconsider' }, advisoryLevel: 'reconsider', sanctionsActive: true, sanctionsCount: 212 },
  KZ: { countryCode: 'KZ', cii: { region: 'KZ', combinedScore: 31, trend: 'TREND_DIRECTION_STABLE', computedAt: T0, advisoryLevel: 'caution' }, advisoryLevel: 'caution', sanctionsActive: false, sanctionsCount: 0 },
  EG: { countryCode: 'EG', cii: { region: 'EG', combinedScore: 66.2, trend: 'TREND_DIRECTION_FALLING', computedAt: T0 }, sanctionsActive: false, sanctionsCount: 0 },
};
const ACLED: Record<string, unknown[]> = {
  VE: [
    { id: 'VEN1', eventType: 'Protests', location: { latitude: 7.24, longitude: -70.73 }, occurredAt: Date.parse('2026-09-28T00:00:00Z'), fatalities: 0, actors: ['Protesters'], source: 'ACLED', admin1: 'Apure' },   // 184 km from Barinas
    { id: 'VEN2', eventType: 'Violence against civilians', location: { latitude: 10.5, longitude: -66.9 }, occurredAt: Date.parse('2026-09-20T00:00:00Z'), fatalities: 2, actors: ['Unknown'], source: 'ACLED', admin1: 'Distrito Capital' },   // 400 km away
  ],
  KZ: [], EG: [{ id: 'EGY1', eventType: 'Riots', location: { latitude: 30.0, longitude: 31.2 }, occurredAt: Date.parse('2026-09-25T00:00:00Z'), fatalities: 1, actors: ['Rioters'], source: 'ACLED' }],
};
const calls: string[] = [];
const fakeFetch = (async (url: string, init: any) => {
  calls.push(url);
  assert.equal(init?.headers?.['X-WorldMonitor-Key'], KEY);
  const u = new URL(url); const ep = u.pathname.split('/').pop()!; const cc = (u.searchParams.get('country_code') ?? u.searchParams.get('country') ?? u.searchParams.get('iso2') ?? '').toUpperCase();
  const body = (() => {
    switch (ep) {
      case 'get-country-risk': return RISK[cc] ?? { countryCode: cc, cii: {}, sanctionsActive: null };
      case 'list-acled-events': return { events: ACLED[cc] ?? [] };
      case 'get-risk-scores': return { ciiScores: [
        { region: 'VE', combinedScore: 50.4, trend: 'TREND_DIRECTION_RISING', computedAt: T0 }, { region: 'KZ', combinedScore: 31, trend: 'TREND_DIRECTION_STABLE', computedAt: T0 },
        { region: 'EG', combinedScore: 66.2, trend: 'TREND_DIRECTION_FALLING', computedAt: T0 }, { region: 'BR', combinedScore: 22.3, trend: 'TREND_DIRECTION_STABLE', computedAt: T0 },
        { region: 'IR', combinedScore: 81, trend: 'TREND_DIRECTION_RISING', computedAt: T0 }, { region: 'Middle East', combinedScore: 70, trend: 'TREND_DIRECTION_RISING', computedAt: T0 }] };
      case 'get-country-port-activity': return cc === 'VE' ? { ports: [{ portId: 'VEPLC', portName: 'Puerto La Cruz', lat: 10.2, lon: -64.6, tankerCalls30d: 18, trendDeltaPct: -12.5, importTankerDwt: 100000, exportTankerDwt: 950000, anomalySignal: false }, { portId: 'VEJOT', portName: 'José Terminal', lat: 10.07, lon: -64.73, tankerCalls30d: 41, trendDeltaPct: 8.1, importTankerDwt: 0, exportTankerDwt: 2500000, anomalySignal: true }], available: true } : { ports: [], available: false };
      case 'get-country-chokepoint-index': return cc === 'VE' ? { iso2: 'VE', hs2: '27', exposures: [{ chokepointId: 'panama', chokepointName: 'Panama Canal', exposureScore: 0.62, coastSide: 'atlantic', shockSupported: true }], primaryChokepointId: 'panama', vulnerabilityIndex: 0.41, fetchedAt: '2026-10-01T08:20:00Z' } : { iso2: cc, exposures: [], vulnerabilityIndex: null };
      case 'compute-energy-shock': return { countryCode: cc, chokepointId: u.searchParams.get('chokepoint_id'), disruptionPct: 50, crudeLossKbd: 12.5, effectiveCoverDays: 21, assessment: 'manageable', dataAvailable: true, products: [], limitations: [] };
      default: return {};
    }
  })();
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ben: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const dayAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const get = async (a: typeof partner, url: string) => { const r = await a.request(url); return { status: r.status, body: await r.json() }; };

before(async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','EG')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,lat,lon,stage,members,register) VALUES ('ven-barinas',NULL,'Barinas–Apure Cluster','active','lt-firm','VE',8.1,-69.3,'Technical review','{chris}',$1::jsonb)", [JSON.stringify({ source: 'Tennor', risk: 'red', risk_score: 78, risks: { Geopolitical: 88, Sanctions: 82, Security: 61, Technical: 38, Commercial: 66 } })]);
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,lat,lon,stage,members,register) VALUES ('kaz-brownfield',NULL,'Western Kazakhstan Brownfield','prospect','lt-firm','KZ',47.1,51.9,'Qualified','{chris}',$1::jsonb)", [JSON.stringify({ source: 'Intermediary', risk: 'amber', risk_score: 54 })]);
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,stage,members,register) VALUES ('egy-onshore','frontera','Egypt Onshore Gas Hub','prospect','lt-frontera-nda-2026','EG','Negotiation','{chris}','{}'::jsonb)");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,stage,members,register) VALUES ('old-one',NULL,'Archived thing','archived','lt-firm','VE','Closed','{chris}','{}'::jsonb)");
  partner = await appFor(`chris@${DOMAIN}`);
  ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { configureWorldMonitor({ apiKey: null }); await db.close(); });

test('arithmetic: distance, nearby events, the sanctions and security formulas, the register overall rule, entered cells', () => {
  assert.ok(Math.abs(distanceKm(8.1, -69.3, 7.24, -70.73) - 184) < 3);
  assert.deepEqual(nearby([{ lat: 7.24, lon: -70.73, fatalities: 0 }, { lat: 10.5, lon: -66.9, fatalities: 2 }, { lat: null, lon: null, fatalities: 9 }], 8.1, -69.3), { events: 1, fatalities: 0, nearest_km: 184 });
  assert.equal(sanctionsScore(null, null), null); assert.equal(sanctionsScore(false, 0), 5); assert.equal(sanctionsScore(true, 1), 40); assert.equal(sanctionsScore(true, 10), 60); assert.equal(sanctionsScore(true, 212), 87); assert.equal(sanctionsScore(true, 100000), 100);
  assert.equal(securityScore(null, null), null); assert.equal(securityScore(0, 0), 10); assert.equal(securityScore(1, 0), 18); assert.equal(securityScore(3, 4), 46); assert.equal(securityScore(50, 50), 100);
  const cell = (score: number | null) => ({ score, status: 'live' as const, source: '', as_of: null, evidence: '' });
  assert.equal(overallScore({ geopolitical: cell(50.4), sanctions: cell(87), security: cell(18), technical: cell(38), commercial: cell(66) }), 68);
  assert.equal(overallScore({ geopolitical: cell(31), sanctions: cell(5), security: cell(10), technical: cell(null), commercial: cell(null) }), 15);
  assert.equal(overallScore({ geopolitical: cell(null), sanctions: cell(null), security: cell(null), technical: cell(null), commercial: cell(null) }), null);
  assert.equal(enteredCell({ risks: { Technical: 38 } }, 'technical').score, 38);
  assert.equal(enteredCell({ risks: { technical: '42' } }, 'technical').score, 42);
  assert.equal(enteredCell({ risks: { Technical: 38 } }, 'commercial').status, 'missing');
  assert.equal(enteredCell({}, 'commercial').status, 'missing');
});

test('§1 the countries summary carries band, trend, ports, chokepoint, near-asset events and the all-country tint', async () => {
  resetWorldMonitorCache(); calls.length = 0;
  const r = await get(partner, '/api/countries');
  assert.equal(r.status, 200);
  const ve = r.body.countries.find((c: any) => c.code === 'VE');
  assert.equal(ve.risk.score, 50.4); assert.equal(ve.risk.band, 'amber'); assert.equal(ve.risk.trend, 'rising'); assert.equal(ve.risk.sanctions_active, true);
  assert.deepEqual(ve.ports.map((p: any) => p.name), ['José Terminal', 'Puerto La Cruz']);   // busiest first
  assert.equal(ve.ports[0].anomaly, true); assert.equal(ve.ports[1].trend_pct, -12.5); assert.equal(ve.ports[1].lat, 10.2);
  assert.deepEqual(ve.chokepoint, { primary: { id: 'panama', name: 'Panama Canal', score: 0.62 }, vulnerability_index: 0.41, fetched_at: '2026-10-01T08:20:00.000Z' });
  const bar = ve.projects.find((p: any) => p.id === 'ven-barinas');
  assert.match(bar.near.as_of, ISO);
  assert.deepEqual({ ...bar.near, as_of: null }, { events: 1, fatalities: 0, nearest_km: 184, radius_km: 200, window_days: 30, as_of: null });
  const kz = r.body.countries.find((c: any) => c.code === 'KZ');
  assert.equal(kz.risk.band, 'green'); assert.deepEqual(kz.ports, []); assert.equal(kz.chokepoint, null);
  assert.deepEqual({ ...kz.projects[0].near, as_of: null }, { events: 0, fatalities: 0, nearest_km: null, radius_km: 200, window_days: 30, as_of: null });
  const eg = r.body.countries.find((c: any) => c.code === 'EG');
  assert.equal(eg.projects[0].near, null, 'a project without a point has no near-asset count');
  // The tint: every ISO-keyed entry of the one all-country call, held countries carrying their own reading.
  const tint = Object.fromEntries(r.body.world_risk.map((w: any) => [w.code, w]));
  assert.deepEqual(Object.keys(tint).sort(), ['BR', 'EG', 'IR', 'KZ', 'VE']);
  assert.deepEqual(tint.IR, { code: 'IR', score: 81, band: 'red', trend: 'rising', held: false });
  assert.deepEqual(tint.VE, { code: 'VE', score: 50.4, band: 'amber', trend: 'rising', held: true });
  assert.equal(calls.filter(u => /get-risk-scores/.test(u)).length, 1, 'one all-country call');
  assert.equal(r.body.world_monitor.status, 'live');
});

test('§3 one snapshot a day per held country, never overwritten; deltas over 7 and 30 days come back on the risk line', async () => {
  const rows = async () => (await db.query<any>('SELECT country, day::text AS day, score::float AS score FROM risk_snapshots ORDER BY country, day')).rows;
  const first = await rows();
  assert.deepEqual(first.map((x: any) => [x.country, x.day, x.score]), [['EG', dayAgo(0), 66.2], ['KZ', dayAgo(0), 31], ['VE', dayAgo(0), 50.4]]);
  await get(partner, '/api/countries');
  assert.equal((await rows()).length, 3, 'a second read the same day writes nothing');
  await db.query("INSERT INTO risk_snapshots (country, day, score, fetched_at) VALUES ('VE',$1,45.4,now()), ('VE',$2,60.4,now()), ('KZ',$3,33,now())", [dayAgo(7), dayAgo(31), dayAgo(4)]);
  const r = await get(partner, '/api/countries');
  const ve = r.body.countries.find((c: any) => c.code === 'VE');
  assert.equal(ve.risk.delta_7d, 5); assert.equal(ve.risk.delta_30d, -10); assert.equal(ve.risk.since, dayAgo(31));
  const kz = r.body.countries.find((c: any) => c.code === 'KZ');
  assert.equal(kz.risk.delta_7d, null, 'the KZ snapshot is 4 days old: not yet a 7-day delta'); assert.equal(kz.risk.delta_30d, null);
  // Without a key the line is absent and nothing is written.
  configureWorldMonitor({ apiKey: null });
  const off = await get(partner, '/api/countries');
  assert.equal(off.body.countries.find((c: any) => c.code === 'VE').risk, null);
  assert.deepEqual(off.body.world_risk, []);
  assert.equal(off.body.world_monitor.status, 'not_connected');
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
});

test('§2 the risk table: one row per opportunity in scope, three live columns with their formulas, two entered, the overall rule, the execution risk apart', async () => {
  resetWorldMonitorCache();
  const r = await get(partner, '/api/risk/table');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.columns, ['geopolitical', 'sanctions', 'security', 'technical', 'commercial']);
  assert.deepEqual(r.body.rows.map((x: any) => x.project_id), ['ven-barinas', 'egy-onshore', 'kaz-brownfield'], 'highest overall first, archived never');
  const ve = r.body.rows[0];
  assert.equal(ve.country, 'VE'); assert.equal(ve.name, 'Barinas–Apure Cluster'); assert.equal(ve.stage, 'Technical review');
  assert.equal(ve.cells.geopolitical.score, 50.4); assert.equal(ve.cells.geopolitical.status, 'live'); assert.equal(ve.cells.geopolitical.source, 'World Monitor instability index'); assert.equal(ve.cells.geopolitical.as_of, '2026-10-01T08:00:00.000Z');
  assert.match(ve.cells.geopolitical.evidence, /50\.4.*rising/);
  assert.equal(ve.cells.sanctions.score, 87); assert.match(ve.cells.sanctions.evidence, /212 designated/);
  assert.equal(ve.cells.security.score, 18); assert.match(ve.cells.security.evidence, /1 event.*200 km.*30 days/);
  assert.equal(ve.cells.technical.score, 38); assert.equal(ve.cells.technical.status, 'entered');
  assert.equal(ve.cells.commercial.score, 66);
  assert.equal(ve.overall, 68);
  assert.deepEqual(ve.execution, { risk: 'red', risk_score: 78 });
  assert.equal(ve.delta_7d, 5); assert.equal(ve.delta_30d, -10);
  assert.equal(ve.band, 'amber');
  const kz = r.body.rows[2];
  assert.equal(kz.cells.sanctions.score, 5); assert.equal(kz.cells.security.score, 10); assert.equal(kz.cells.technical.status, 'missing'); assert.equal(kz.cells.technical.score, null);
  assert.equal(kz.overall, 15); assert.deepEqual(kz.execution, { risk: 'amber', risk_score: 54 });
  const eg = r.body.rows[1];
  assert.equal(eg.cells.security.score, 21, 'no project point: the country-wide count, 1 event and 1 fatality');
  assert.match(eg.cells.security.evidence, /country-wide/);
  assert.equal(eg.execution, null);
  assert.equal(r.body.world_monitor.status, 'live');
  assert.equal(r.body.radius_km, 200); assert.equal(r.body.window_days, 30);
  // Scope: Ben cannot see the Frontera NDA project.
  const b = await get(ben, '/api/risk/table');
  assert.equal(b.status, 200);
  assert.deepEqual(b.body.rows.map((x: any) => x.project_id), ['ven-barinas', 'kaz-brownfield']);
  // Without a key the live cells say so and the entered ones stand.
  configureWorldMonitor({ apiKey: null });
  const off = await get(partner, '/api/risk/table');
  assert.equal(off.body.rows[0].cells.geopolitical.status, 'unavailable'); assert.equal(off.body.rows[0].cells.geopolitical.score, null);
  assert.equal(off.body.rows[0].cells.technical.score, 38);
  assert.equal(off.body.world_monitor.status, 'not_connected');
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
});

test('§1 the shock line: the primary chokepoint and World Monitor\'s half-closure scenario for a country the caller holds; 404 outside the scope; 400 for a bad code', async () => {
  resetWorldMonitorCache();
  const r = await get(partner, '/api/risk/shock?country=VE');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chokepoint, { id: 'panama', name: 'Panama Canal', score: 0.62 });
  assert.equal(r.body.disruption_pct, 50);
  assert.equal(r.body.shock.crude_loss_kbd, 12.5); assert.equal(r.body.shock.cover_days, 21); assert.equal(r.body.shock.assessment, 'manageable');
  assert.match(calls.at(-1)!, /compute-energy-shock\?country_code=VE&chokepoint_id=panama&disruption_pct=50&fuel_mode=oil$/);
  const kz = await get(partner, '/api/risk/shock?country=KZ');
  assert.equal(kz.status, 200); assert.equal(kz.body.chokepoint, null); assert.equal(kz.body.shock, null);
  assert.equal((await get(ben, '/api/risk/shock?country=EG')).status, 404);
  assert.equal((await get(partner, '/api/risk/shock?country=XX')).status, 400);
  assert.equal((await get(partner, '/api/risk/shock?country=BR')).status, 404);
});
