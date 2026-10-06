// Wave 2, PR 4 (docs/vault-hub/wave2/05-markup.md §1.6, Option A): the country brief.
// POST /api/countries/:code/brief writes a cited brief from what the Vault holds for the
// country, within the caller's scope, cached per legal scope and regenerated when a
// source changes. Smoke tests for AC16, written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-brief-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureBrief } = await import('../src/api/countries.routes.ts');
const { FakeProvider } = await import('../src/llm/provider.ts');
const { configureWorldMonitor } = await import('../src/intel/worldmonitor.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const baseRun = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown>) => ({ ...baseRun, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], ...o });

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ben: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const post = async (a: typeof partner, url: string, body: unknown = {}) => {
  const r = await a.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const DOC = randomUUID();
let calls = 0;
/** Cites the first run and the first document it is given, adds an uncited figure and an out-of-scope citation. */
const provider = new FakeProvider((req) => {
  calls++;
  const u = req.messages[0].content;
  const runRef = /\[run:([0-9a-f-]{36})\]/.exec(u)?.[1];
  const docRef = /\[doc:([0-9a-f-]{36})\]/.exec(u)?.[1];
  return [
    `Situation. Alpha holds one opportunity in this country at the Commercial review stage [run:${runRef}].`,
    `The waterflood screen gives 12,400 bopd of technical potential [run:${runRef}] and the data room index lists 60 producers [doc:${docRef}].`,
    'An unsupported figure of 99 MMbbl appears here with no record behind it.',
    'A claim with a foreign citation [doc:00000000-0000-4000-8000-000000009999].',
  ].join('\n\n');
});

before(async () => {
  configureWorldMonitor({ apiKey: null });                  // wave 3: no World Monitor unless a test connects one
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','CO')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,lat,lon,stage,members) VALUES ('kaz-brownfield',NULL,'Western Kazakhstan Brownfield','prospect','lt-firm','KZ',47.1,51.9,'Commercial review','{chris}')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('egy-onshore','frontera','Egypt Onshore Gas Hub','prospect','lt-frontera-nda-2026','EG','{chris}')");
  partner = await appFor(`chris@${DOMAIN}`);
  ben = await appFor(`ben@${DOMAIN}`);
  const r = run({ project_id: 'kaz-brownfield', client_id: null, legal_tag: 'lt-firm', status: 'final', title: 'Waterflood screen', outputs: { technical_potential_bopd: { value: 12400, unit: 'bopd' } } });
  assert.equal((await partner.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) })).status, 201);
  await db.query("INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version) VALUES ($1,'spreadsheet','Data room index',now(),'kaz-brownfield','lt-firm','{\"source\":\"upload\"}'::jsonb,$2,1)", [DOC, hashOf(DOC)]);
  const e = run({ project_id: 'egy-onshore', client_id: 'frontera', legal_tag: 'lt-frontera-nda-2026', status: 'final', title: 'Gas hub screen', outputs: { npv10: { value: 58.3, unit: 'USD MM' } } });
  assert.equal((await partner.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) })).status, 201);
});
after(async () => { await db.close(); });

test('AC16 (wave 7): without a provider the brief answers 503 not_configured with a plain sentence, the same refusal Write to… gives', async () => {
  configureBrief({ provider: null });
  const r = await post(partner, '/api/countries/KZ/brief');
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'not_configured');
  assert.match(r.body.error.message, /not connected/);
  assert.doesNotMatch(r.body.error.message, /_KEY|provider configured/);
});

test('AC16: a bad code is 400; a country with nothing in scope is 404', async () => {
  configureBrief({ provider });
  assert.equal((await post(partner, '/api/countries/kz/brief')).status, 400);
  assert.equal((await post(partner, '/api/countries/XX/brief')).status, 400);
  const r = await post(partner, '/api/countries/BR/brief');
  assert.equal(r.status, 404);
  assert.match(r.body.error.message, /no projects in Brazil/);
});

test('AC16: the brief cites only records in scope, turns uncited figures into questions, and is cached until a source changes', async () => {
  configureBrief({ provider });
  calls = 0;
  const r = await post(partner, '/api/countries/KZ/brief');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.country, 'KZ');
  assert.deepEqual(b.name, { en: 'Kazakhstan', es: 'Kazajistán' });
  assert.equal(b.cached, false);
  assert.equal(b.model, 'fake-1');
  assert.equal(b.paragraphs.length, 4);
  assert.match(b.paragraphs[1], /12,400 bopd of technical potential \[run:/);
  assert.match(b.paragraphs[2], /^\[QUESTION FOR YOU:/);
  assert.ok(!b.paragraphs[3].includes('[doc:00000000-0000-4000-8000-000000009999]'), 'the foreign citation is stripped');
  assert.equal(b.citations.length, 2);
  assert.ok(b.citations.some((c: string) => c.startsWith('run:')) && b.citations.some((c: string) => c === `doc:${DOC}`));
  assert.ok(b.sources.some((s: any) => s.ref === `doc:${DOC}` && s.title === 'Data room index'));
  assert.ok(b.sources.some((s: any) => s.ref.startsWith('run:') && s.project_id === 'kaz-brownfield'));
  assert.ok(b.warnings.some((w: string) => /outside scope/.test(w)));
  assert.equal(b.questions.length, 1);
  assert.deepEqual(b.projects.map((p: any) => p.id), ['kaz-brownfield']);
  assert.match(b.generated_at, /^\d{4}-/);
  assert.equal(calls, 1);
  const audit = (await db.query<any>("SELECT scope, detail FROM audit_events WHERE action = 'country.brief' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audit.scope, 'firm');
  assert.equal(audit.detail.country, 'KZ');
  assert.equal(audit.detail.cached, false);
  const spend = (await db.query<any>("SELECT tokens_in, detail FROM audit_events WHERE action = 'llm.brief' ORDER BY id DESC LIMIT 1")).rows[0];   // token spend, like llm.draft
  assert.ok(spend.tokens_in > 0);
  assert.equal(spend.detail.country, 'KZ');

  // Same sources: served from the cache, the provider is not asked again.
  const again = await post(partner, '/api/countries/KZ/brief');
  assert.equal(again.status, 200);
  assert.equal(again.body.cached, true);
  assert.equal(again.body.paragraphs[1], b.paragraphs[1]);
  assert.equal(calls, 1);

  // A new run in the country changes the source set: regenerated.
  const r2 = run({ project_id: 'kaz-brownfield', client_id: null, legal_tag: 'lt-firm', status: 'reviewed', title: 'Sensitivity', outputs: { npv10: { value: 40, unit: 'USD MM' } } });
  assert.equal((await partner.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r2) })).status, 201);
  const fresh = await post(partner, '/api/countries/KZ/brief');
  assert.equal(fresh.body.cached, false);
  assert.equal(calls, 2);
  // Spanish is a separate brief.
  const es = await post(partner, '/api/countries/KZ/brief', { language: 'es' });
  assert.equal(es.body.cached, false);
  assert.equal(calls, 3);
});

test('AC16: a cached brief is served only to a caller whose scope covers every tag it was built from', async () => {
  configureBrief({ provider });
  calls = 0;
  const r = await post(partner, '/api/countries/EG/brief');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(calls, 1);
  const row = (await db.query<any>("SELECT tags FROM country_briefs WHERE country = 'EG' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.ok(row.tags.includes('lt-frontera-nda-2026'));
  // Ben sees no project in Egypt: nothing is served, cached or not.
  const b = await post(ben, '/api/countries/EG/brief');
  assert.equal(b.status, 404);
  assert.equal(calls, 1);
  // Nothing was written to items: a brief never widens a scope.
  const notes = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE origin->>'source' = 'assistant'")).rows[0].n;
  assert.equal(notes, 0);
});

/* ── wave 3, PR 3: World Monitor in the countries summary and the brief (W3-AC9, W3-AC10) ── */

const WM_KEY = 'wm_' + 'b'.repeat(40);
const WM_RISK = { countryCode: 'KZ', cii: { combinedScore: 64, trend: 'TREND_DIRECTION_STABLE', components: { newsActivity: 20, ciiContribution: 30, geoConvergence: 10, militaryActivity: 4 }, computedAt: Date.parse('2026-10-01T08:00:00Z') }, advisoryLevel: 'exercise increased caution', sanctionsActive: false, sanctionsCount: 0 };
const WM_EVENTS = { events: [{ id: 'KAZ777', eventType: 'Protests', admin1: 'Mangystau', actors: ['Oil workers (Kazakhstan)'], fatalities: 0, occurredAt: Date.parse('2026-09-25T00:00:00Z'), source: 'ACLED' }] };
const WM_NEWS = { countries: { KZ: { items: [{ title: 'Kazakhstan raises output target', source: 'Reuters', link: 'https://example.com/kz', publishedAt: Date.parse('2026-09-29T07:00:00Z') }] } } };
const WM_ENERGY = { mixAvailable: false, jodiOilAvailable: true, jodiOilDataMonth: '2026-07', crudeImportsKbd: 0, gasolineDemandKbd: 95, dieselDemandKbd: 120, jodiGasAvailable: false };
let wmCalls: string[] = [];
const wmFetch = (async (url: string) => {
  wmCalls.push(url);
  const u = new URL(url);
  const ep = u.pathname.split('/').pop();
  if (ep === 'get-country-intel-brief') return new Response('{"code":"pro_required"}', { status: 403 });
  const body = ep === 'get-country-risk' ? WM_RISK : ep === 'list-acled-events' ? WM_EVENTS : ep === 'get-country-energy-profile' ? WM_ENERGY : WM_NEWS;
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;
/** Cites the live risk and the ACLED event it is given, plus one run. */
const wmProvider = new FakeProvider((req) => {
  calls++;
  const u = req.messages[0].content;
  const runRef = /\[run:([0-9a-f-]{36})\]/.exec(u)?.[1];
  const acled = /\[wm:acled:([^\]]+)\]/.exec(u)?.[1];
  return [
    `Situation. Alpha holds one opportunity in this country [run:${runRef}].`,
    `Live risk. World Monitor scores the country 64 of 100, exercise increased caution [wm:risk:KZ]. Oil workers protested in Mangystau on 2026-09-25 [wm:acled:${acled}]. The press reports a higher output target [wm:news:1]. Diesel demand runs at 120 kb/d [wm:energy:KZ].`,
  ].join('\n\n');
});

test('W3-AC9: without a key the countries summary carries risk: null and the brief says the feed is not connected', async () => {
  configureWorldMonitor({ apiKey: null, fetch: wmFetch });
  configureBrief({ provider });
  const r = await (await partner.request('/api/countries')).json() as any;
  assert.ok(r.countries.length >= 1);
  assert.ok(r.countries.every((c: any) => c.risk === null));
  assert.equal(r.world_monitor.status, 'not_connected');
  assert.match(r.world_monitor.reason, /WORLD_MONITOR_API_KEY/);
  const b = await post(partner, '/api/countries/KZ/brief');
  assert.equal(b.status, 200);
  assert.equal(b.body.world_monitor.status, 'not_connected');
  assert.match(b.body.world_monitor.reason, /WORLD_MONITOR_API_KEY/);
  assert.ok(!b.body.sources.some((s: any) => s.kind === 'wm'));
});

test('W3-AC9 and W3-AC10: with World Monitor connected the summary shows the score and level, the brief cites [wm:risk:KZ] and [wm:acled:…] records that appear in its sources, the cache follows the feed, and the key never leaves the server', async () => {
  configureWorldMonitor({ apiKey: WM_KEY, fetch: wmFetch });
  configureBrief({ provider: wmProvider });
  wmCalls = []; calls = 0;
  const r = await (await partner.request('/api/countries')).json() as any;
  const kz = r.countries.find((c: any) => c.code === 'KZ');
  // Wave 8: the line also carries the band and the change against the daily snapshots (none yet on a fresh database).
  assert.deepEqual(kz.risk, { score: 64, level: 'exercise increased caution', trend: 'stable', band: 'amber', computed_at: '2026-10-01T08:00:00.000Z', fetched_at: kz.risk.fetched_at, sanctions_active: false, sanctions_count: 0, delta_7d: null, delta_30d: null, since: null });
  assert.match(kz.risk.fetched_at, /^\d{4}-/);
  assert.equal(r.world_monitor.status, 'live');
  assert.ok(!JSON.stringify(r).includes(WM_KEY), 'the key is never in a response');
  assert.ok(wmCalls.every(u => u.startsWith('https://api.worldmonitor.app/')));

  const b = await post(partner, '/api/countries/KZ/brief');
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.cached, false);
  assert.equal(b.body.world_monitor.status, 'live');
  assert.match(b.body.world_monitor.fetched_at, /^\d{4}-/);
  assert.match(b.body.paragraphs[1], /^Live risk\. .*\[wm:risk:KZ\]/);
  assert.ok(b.body.citations.includes('wm:risk:KZ'));
  assert.ok(b.body.citations.includes('wm:acled:KAZ777'));
  assert.ok(b.body.citations.includes('wm:news:1'));
  assert.ok(b.body.citations.includes('wm:energy:KZ'));
  const wmSources = b.body.sources.filter((s: any) => s.kind === 'wm');
  assert.deepEqual(wmSources.map((s: any) => s.ref).sort(), ['wm:acled:KAZ777', 'wm:energy:KZ', 'wm:news:1', 'wm:risk:KZ']);
  assert.ok(b.body.world_monitor.notes.includes('World Monitor intel brief: needs Pro'), 'a Pro-gated section is named, never silent');
  assert.equal(wmSources.find((s: any) => s.ref === 'wm:news:1').url, 'https://example.com/kz');
  assert.equal(wmSources.find((s: any) => s.ref === 'wm:risk:KZ').legal_tag, 'lt-public');
  assert.ok(!JSON.stringify(b.body).includes(WM_KEY));
  assert.equal(calls, 1);
  // The same live picture (cached an hour) serves the cached brief; a changed score regenerates it.
  const again = await post(partner, '/api/countries/KZ/brief');
  assert.equal(again.body.cached, true);
  assert.equal(calls, 1);
  WM_RISK.cii.combinedScore = 80; WM_RISK.cii.computedAt = Date.parse('2026-10-01T10:00:00Z');
  configureWorldMonitor({ apiKey: WM_KEY, fetch: wmFetch });          // clears the adapter cache, as an hour passing would
  const fresh = await post(partner, '/api/countries/KZ/brief');
  assert.equal(fresh.body.cached, false);
  assert.equal(calls, 2);
  // A 429 is reported in the brief's meta and the summary, never retried in a loop.
  let hits = 0;
  configureWorldMonitor({ apiKey: WM_KEY, fetch: (async () => { hits++; return new Response('{}', { status: 429, headers: { 'retry-after': '30' } }); }) as unknown as typeof fetch });
  const limited = await (await partner.request('/api/countries')).json() as any;
  assert.equal(limited.countries.find((c: any) => c.code === 'KZ').risk, null);
  assert.ok(limited.world_monitor.notes.some((n: string) => /rate limited .* 30 s/.test(n)));
  assert.ok(hits <= limited.countries.length, 'at most one call per country went out before the limit landed');
  const before = hits;
  const lb = await post(partner, '/api/countries/KZ/brief');
  assert.equal(lb.body.world_monitor.status, 'not_connected');
  assert.match(lb.body.world_monitor.reason, /rate limited/);
  assert.equal(hits, before, 'the brief made no further call while the limit holds');
  configureWorldMonitor({ apiKey: null });
});

/* ── wave 7 PR3 (S8, W7-AC15): a brief ages ── */

test('S8: the brief carries generated_at, max_age_days and due; past max_age_days it is due and GET reads the cache without the provider', async () => {
  configureWorldMonitor({ apiKey: null });
  configureBrief({ provider });
  calls = 0;
  const r = await post(partner, '/api/countries/KZ/brief');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.max_age_days, 90);
  assert.equal(r.body.due, false);
  assert.match(r.body.generated_at, /^\d{4}-/);
  const g = await partner.request('/api/countries/KZ/brief', { headers: { accept: 'application/json' } });
  assert.equal(g.status, 200);
  const gb: any = await g.json();
  assert.equal(gb.cached, true); assert.equal(gb.due, false); assert.equal(gb.max_age_days, 90);
  assert.equal(gb.paragraphs.length, r.body.paragraphs.length);
  await db.query("UPDATE country_briefs SET created_at = now() - interval '100 days' WHERE country = 'KZ' AND language = 'en'");
  const before = calls;
  const again = await post(partner, '/api/countries/KZ/brief');
  assert.equal(again.status, 200);
  assert.equal(again.body.cached, true, 'the sources are unchanged: still served from the cache');
  assert.equal(again.body.due, true, 'but the Hub is told it is due so it can show the date and offer Regenerate');
  assert.equal(calls, before, 'ageing alone never spends on the provider');
  const g2: any = await (await partner.request('/api/countries/KZ/brief', { headers: { accept: 'application/json' } })).json();
  assert.equal(g2.due, true);
  // No cached brief: GET is 404 and spends nothing; a bad code is 400; outside scope is 404.
  assert.equal((await partner.request('/api/countries/PE/brief')).status, 404);
  assert.equal((await partner.request('/api/countries/kz/brief')).status, 400);
  assert.equal((await ben.request('/api/countries/EG/brief')).status, 404, 'Ben sees no project in Egypt');
  assert.equal(calls, before);
});
