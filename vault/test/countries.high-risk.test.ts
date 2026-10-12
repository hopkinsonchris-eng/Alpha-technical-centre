// 11 Oct 2026: the countries summary names every country World Monitor scores High (70 and over), with or without a
// project there, from the all-country risk table in one call, so the globe can pulse a red ring on each.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureWorldMonitor, riskScores, sanctionsOn } from '../src/intel/worldmonitor.ts';

const DOMAIN = 'alpha-technical-centre.com';
const KEY = 'wm-test-key';
const T0 = Date.parse('2026-10-11T08:00:00Z');
const SCORES = { ciiScores: [
  { region: 'VE', combinedScore: 82, trend: 'TREND_DIRECTION_RISING', computedAt: T0 },
  { region: 'sy', combinedScore: 91.4, trend: 'TREND_DIRECTION_STABLE', computedAt: T0 },
  { region: 'KZ', combinedScore: 64, trend: 'TREND_DIRECTION_STABLE', computedAt: T0 },
  { region: 'MX', combinedScore: 70, trend: 'TREND_DIRECTION_UNSPECIFIED', computedAt: T0 },
  { region: 'global', combinedScore: 99 },
  { region: 'Middle East', combinedScore: 88 },
  { region: 'IQ' },
], strategicRisks: [] };

// The advisory index: the most severe travel level per country (US, UK, Australian registers).
const ADVISORY = { CD: 'do-not-travel', LY: 'do-not-travel', SY: 'do-not-travel', KZ: 'caution', ML: 'reconsider', XX1: 'do-not-travel', NG: 'info' };

let db: Db;
let calls: string[] = [];
const fetchWith = (scores: (() => Response) | null) => (async (url: string) => {
  calls.push(url);
  const ep = new URL(url).pathname.split('/').pop();
  if (ep === 'get-risk-scores' && scores) return scores();
  const body = ep === 'get-risk-scores' ? SCORES : ep === 'list-sanctions-pressure' ? { entries: [], countries: [], programs: [] }
    : ep === 'list-security-advisories' ? { advisories: [], byCountry: ADVISORY }
    : ep === 'get-country-risk' ? { cii: { combinedScore: 64, trend: 'TREND_DIRECTION_STABLE', computedAt: T0 } } : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;
const summary = async () => (await (await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } })).request('/api/countries')).json() as Promise<any>;

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('kaz-brownfield',NULL,'Western Kazakhstan Brownfield','prospect','lt-firm','KZ','{chris}')");
});
after(async () => { configureWorldMonitor({ apiKey: null }); await db.close(); });

test('the all-country table is read in one call; only ISO2 lines with a score are kept', async () => {
  configureWorldMonitor({ apiKey: KEY, fetch: fetchWith(null) });
  const r = await riskScores();
  assert.ok(r.ok);
  assert.deepEqual(r.data.map(c => c.code), ['KZ', 'MX', 'SY', 'VE']);
  assert.deepEqual(r.data.find(c => c.code === 'VE'), { code: 'VE', score: 82, trend: 'rising', computed_at: '2026-10-11T08:00:00.000Z' });
  assert.equal(r.data.find(c => c.code === 'MX')!.trend, null);
});

test('the summary lists every High country, held or not, at 70 and over, with its name, trend and sanctions; one table call per hour', async () => {
  configureWorldMonitor({ apiKey: KEY, fetch: fetchWith(null) });
  calls = [];
  const s = await summary();
  const byCode = (c: string) => s.high_risk.find((h: any) => h.code === c);
  assert.deepEqual(s.high_risk.map((h: any) => h.code), ['CD', 'LY', 'MX', 'SY', 'VE']);
  assert.deepEqual(byCode('MX'), { code: 'MX', name: { en: 'Mexico', es: 'México' }, score: 70, trend: null, sanctions_on: [], basis: 'cii', advisory: null });
  assert.deepEqual(byCode('SY'), { code: 'SY', name: byCode('SY').name, score: 91.4, trend: 'stable', sanctions_on: sanctionsOn('SY'), basis: 'cii', advisory: 'do-not-travel' });
  assert.deepEqual(byCode('VE'), { code: 'VE', name: { en: 'Venezuela', es: 'Venezuela' }, score: 82, trend: 'rising', sanctions_on: sanctionsOn('VE'), basis: 'cii', advisory: null });
  assert.ok(byCode('VE').sanctions_on.length > 0, 'Venezuela carries its sanctions, project or not');
  assert.equal(byCode('SY').name.en, 'Syria');
  // No World Monitor score: the travel advisory stands in, and says so.
  assert.deepEqual(byCode('CD'), { code: 'CD', name: byCode('CD').name, score: null, trend: null, sanctions_on: sanctionsOn('CD'), basis: 'advisory', advisory: 'do-not-travel' });
  assert.equal(byCode('LY').basis, 'advisory');
  assert.ok(!s.high_risk.some((c: any) => c.code === 'KZ'), 'Elevated is not High, and a score outranks the advisory');
  assert.ok(!s.high_risk.some((c: any) => c.code === 'ML'), 'reconsider is not High');
  assert.equal(s.world.ML.advisory, 'reconsider');
  assert.equal(s.world.NG, undefined, 'an info line is no travel level');
  assert.equal(s.world.XX1, undefined, 'only ISO2 codes');
  assert.match(s.advisory_sources, /US State Department/);
  assert.equal(s.countries.find((c: any) => c.code === 'KZ').advisory, 'caution', 'a held country carries its advisory beside its risk');
  assert.equal(calls.filter(u => u.includes('get-risk-scores')).length, 1);
  await summary();
  assert.equal(calls.filter(u => u.includes('get-risk-scores')).length, 1, 'cached for the hour');
  assert.ok(!JSON.stringify(s).includes(KEY));
  // Every scored country reads its score and sanctions, High or not, project or not; sanctioned countries without a score too.
  assert.deepEqual(s.world.KZ, { score: 64, trend: 'stable', sanctions_on: [], advisory: 'caution' });
  assert.equal(s.world.VE.score, 82);
  assert.deepEqual(s.world.RU, { score: null, trend: null, sanctions_on: sanctionsOn('RU'), advisory: null });
  assert.ok(s.world.RU.sanctions_on.length > 0);
  assert.equal(s.world.IQ.score, null, 'a line without a score adds none');
});

test('without a key the list is empty; a refused table is named in the notes and the held readings still arrive', async () => {
  configureWorldMonitor({ apiKey: null, fetch: fetchWith(null) });
  const off = await summary();
  assert.deepEqual(off.high_risk, []);
  assert.ok(off.world.RU.sanctions_on.length > 0 && off.world.RU.score === null, 'sanctions are known without World Monitor');
  assert.equal(off.world_monitor.status, 'not_connected');
  configureWorldMonitor({ apiKey: KEY, fetch: fetchWith(() => new Response('{"code":"pro_required"}', { status: 403 })) });
  const gated = await summary();
  assert.deepEqual(gated.high_risk.map((h: any) => [h.code, h.basis]), [['CD', 'advisory'], ['LY', 'advisory'], ['SY', 'advisory']], 'without the score table, the advisory still marks the do-not-travel countries');
  assert.ok(gated.world_monitor.notes.some((n: string) => /Pro/.test(n)));
  assert.equal(gated.countries.find((c: any) => c.code === 'KZ').risk.score, 64);
});
