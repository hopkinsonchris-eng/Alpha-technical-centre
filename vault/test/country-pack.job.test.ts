// Wave 7 PR4 (W7-AC17 and the job half of W7-AC20): the country-pack job queues one open build per country, runs
// with an injected fetch, resolves and files every registry source, writes the ten section rows (status 'empty'
// with the sources when no drafting hook is given), records the summary, and the routes return the PackView the
// Hub reads; a stuck build is reaped on read like a research run; creating a project with a country queues a pack.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-country-pack-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureResearch } = await import('../src/api/research.routes.ts');
const { configurePack } = await import('../src/api/country-pack.routes.ts');
const { enqueuePack, runQueuedPacks, runPack, reapStalePacks, packView, writePackSection, JOB_NAME } = await import('../src/jobs/country-pack.ts');
const { buildZip, fakeFetch, mockClock, text } = await import('./miners.helpers.ts');
const { FakeEmbedder } = await import('../src/ingest/embed.ts');
const { SECTIONS, SECTION_IDS } = await import('../src/country/types.ts');
type Db = Awaited<ReturnType<typeof openDb>>;
type DraftContext = import('../src/jobs/country-pack.ts').DraftContext;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'country');
const fx = (name: string) => readFileSync(path.join(FIX, name));
const NOW = new Date('2026-10-05T09:00:00Z');
const DOMAIN = 'alpha-technical-centre.com';
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let associate: Awaited<ReturnType<typeof createApp>>;
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const html = (title: string, body: string) => text(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`, 200, { 'content-type': 'text/html' });

/** Every generic source answered from a recorded page, except EIA (no key: not configured). */
function gyFetch() {
  const clock = mockClock(NOW.getTime());
  const zip = buildZip([{ name: 'world_primary.csv', data: fx('jodi-oil-header.csv') }]);
  const ff = fakeFetch([
    [/practiceguides\.chambers\.com\/practice-guides\/oil-gas-2026\/suriname$/, () => text(fx('chambers-namibia-2026.html').toString().replace(/Namibia/g, 'Suriname'), 200, { 'content-type': 'text/html' })],
    [/legal500\.com\/guides\/chapter\/suriname-energy-oil-gas\/$/, () => html('Suriname: Energy – Oil & Gas | The Legal 500', 'The Petroleum Activities Act No. 17 of 2023 governs upstream activity. Current to January 2026.')],
    [/eiti\.org\/countries\/suriname$/, () => text(fx('eiti-colombia.html').toString().replace(/Colombia/g, 'Suriname'), 200, { 'content-type': 'text/html' })],
    [/eiti\.org\/api\/v1\.0\/summary_data\?country=SR$/, () => ({ data: [{ country: 'Suriname', year: 2022, government_revenue_usd: 1_240_000_000 }] })],
    [/api\.resourcecontracts\.org\/contracts\/search\?country_code=sr/, () => text(fx('resourcecontracts-search-gy.json').toString(), 200, { 'content-type': 'application/json' })],
    [/api\.resourcecontracts\.org\/contract\/8814\/text\?page=1$/, () => text(fx('resourcecontracts-text-8814-p1.json').toString(), 200, { 'content-type': 'application/json' })],
    [/api\.resourcecontracts\.org\/contract\/\d+\/text\?page=\d+$/, (u) => ({ contract_id: Number(/contract\/(\d+)/.exec(u)![1]), page: Number(/page=(\d+)/.exec(u)![1]), text: 'ARTICLE (page text)' })],
    [/taxsummaries\.pwc\.com\/suriname$/, () => html('Suriname - Corporate - Taxes on corporate income | PwC', 'Petroleum operations are taxed at 25 percent under the Petroleum Activities Act.')],
    [/jodidata\.org\/.*world_primary_csv\.zip$/, () => new Response(new Uint8Array(zip), { status: 200, headers: { 'content-type': 'application/zip' } })],
  ], clock);
  return { fetch: ff.fetch, calls: ff.calls, clock };
}
/** `draft: null`: the fetch-and-file half on its own (the drafter, PR5, has its own tests); the last test runs the default drafter. */
const runOpts = (f = gyFetch()) => ({ fetch: f.fetch, clock: f.clock, now: () => NOW, env: {} as NodeJS.ProcessEnv, ingest: { provider: null, embedder: new FakeEmbedder() }, log: () => undefined, draft: null });
const jobs = async (country: string) => (await db.query<any>(`SELECT id, status, started_at, finished_at, summary FROM jobs WHERE name = '${JOB_NAME}' AND summary->>'country' = $1 ORDER BY id`, [country])).rows;
const rows = async (country: string) => (await db.query<any>('SELECT * FROM country_packs WHERE country = $1 ORDER BY section, version', [country])).rows;

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  configureResearch({ autorun: false, skipWorldMonitor: true, skipMiners: true, provider: null });
  configurePack({ autorun: false, ...runOpts() });
  partner = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  associate = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
});
after(async () => { await db.close(); });

test('enqueuePack: one open job per country; queuing again returns the same job; a running one says so', async () => {
  const a = await enqueuePack(db, 'SR', 'chris');
  assert.equal(a.state, 'queued');
  const b = await enqueuePack(db, 'SR', 'ana');
  assert.equal(b.state, 'queued');
  assert.equal(b.job_id, a.job_id, 'the queued job is reused, not duplicated');
  const other = await enqueuePack(db, 'NA', 'chris');
  assert.notEqual(other.job_id, a.job_id);
  await db.query("UPDATE jobs SET summary = summary || '{\"queued\": false}'::jsonb WHERE id = $1", [other.job_id]);
  const running = await enqueuePack(db, 'NA', 'chris');
  assert.equal(running.state, 'running');
  assert.equal(running.job_id, other.job_id);
  await db.query('DELETE FROM jobs WHERE id = $1', [other.job_id]); // test housekeeping only: the job never ran
  await assert.rejects(() => enqueuePack(db, 'xx', 'chris'), /country code/);
});

test('runQueuedPacks: every source is resolved, fetched and filed; ten section rows are written with their sources; the summary counts', async () => {
  const f = gyFetch();
  const out = await runQueuedPacks(db, runOpts(f));
  assert.equal(out.length, 1);
  const s = out[0];
  assert.equal(s.country, 'SR');
  assert.equal(s.status, 'ok');
  assert.equal(s.fetched, 10, `ten sources answered (EIA is not configured): ${JSON.stringify(s.sections)}`);
  assert.equal(s.unreachable, 1);
  assert.equal(s.stored + s.unchanged, 10, 'everything fetched was filed or found unchanged');
  assert.ok(s.stored >= 9);
  assert.equal(s.spend_gbp, 0, 'no model call in the fetch-and-file skeleton');
  assert.deepEqual(Object.keys(s.sections).sort(), [...SECTION_IDS].sort(), 'a count per section');
  assert.equal(s.sections.legal.sources, 3);
  assert.equal(s.sections.production.unreachable, 1);
  assert.equal(s.sections.risk.sources, 0);
  assert.ok(f.calls.every(c => !/api\.eia\.gov/.test(c.url)), 'EIA was not called without its key');
  assert.ok(f.calls.every(c => !/iea\.org|onepetro|opencorporates|linkedin/i.test(c.url)));

  const j = (await jobs('SR'))[0];
  assert.equal(j.status, 'ok');
  assert.ok(j.finished_at);
  assert.equal(j.summary.queued, false);
  assert.equal(j.summary.fetched, 10);

  const r = await rows('SR');
  assert.equal(r.length, 10, 'ten section rows');
  assert.deepEqual(r.map(x => x.section).sort(), [...SECTION_IDS].sort());
  for (const row of r) {
    assert.equal(row.version, 1);
    assert.equal(row.status, 'empty', 'no drafting hook: the section is honest about being empty');
    assert.equal(row.ttl_days, SECTIONS.find(x => x.id === row.section)!.ttl_days);
    assert.equal(row.built_by, `job:${j.id}`);
    assert.deepEqual(row.body, { headline: null, sentences: [], questions: [], changed_since: [] });
    assert.ok(Array.isArray(row.sources));
  }
  const legal = r.find(x => x.section === 'legal')!;
  assert.equal(legal.sources.length, 3);
  const ch = legal.sources.find((x: any) => x.id === 'chambers-oil-gas');
  assert.ok(ch, 'chambers is recorded on the legal section');
  assert.equal(ch.url, 'https://practiceguides.chambers.com/practice-guides/oil-gas-2026/suriname');
  assert.equal(ch.reachable, true);
  assert.match(ch.licence, /Chambers/);
  assert.equal(ch.attribution, 'Chambers Global Practice Guides, Oil & Gas 2026, Law and Practice chapter (Chambers and Partners)');
  assert.equal(ch.fetched_at, NOW.toISOString());
  assert.match(ch.item_id, /^[0-9a-f-]{36}$/);
  assert.match(ch.sha256, /^[0-9a-f]{64}$/);
  assert.ok(legal.source_items.includes(ch.item_id), 'the stored original is in source_items');
  const prod = r.find(x => x.section === 'production')!;
  const eia = prod.sources.find((x: any) => x.id === 'eia-international');
  assert.equal(eia.reachable, false);
  assert.equal(eia.item_id, null);
  assert.match(eia.note, /not configured/);
  const jodi = prod.sources.find((x: any) => x.id === 'jodi-oil-monthly');
  assert.equal(jodi.reachable, true);
  const comp = r.find(x => x.section === 'companies')!;
  const gem = comp.sources.find((x: any) => x.id === 'gem-extraction-tracker');
  assert.equal(gem.reachable, true);
  assert.ok(gem.item_id);
  // The originals are public items under 'firm', and chunked.
  const items = (await db.query<any>("SELECT id, legal_tag, project_id FROM items WHERE origin->>'source' = 'country-pack' AND extracted->'pack'->>'country' = 'SR'")).rows;
  assert.ok(items.length >= 9);
  assert.ok(items.every(i => i.legal_tag === 'lt-public' && i.project_id === 'firm'));
  const chunked = Number((await db.query<{ n: number }>("SELECT count(DISTINCT item_id)::int AS n FROM chunks WHERE item_id = ANY($1::uuid[]) AND current", [items.map(i => i.id)])).rows[0].n);
  assert.ok(chunked >= 8, `most originals have chunks (${chunked})`);
});

test('a second build with the same pages files nothing new and writes version 2 of each section, superseding version 1', async () => {
  const s = await runPack(db, 'SR', runOpts());
  assert.equal(s.stored, 0);
  assert.equal(s.unchanged, 10);
  const r = await rows('SR');
  assert.equal(r.length, 20);
  const legal = r.filter(x => x.section === 'legal');
  assert.deepEqual(legal.map(x => x.version), [1, 2]);
  assert.equal(legal[0].superseded_by, legal[1].id, 'version 1 is superseded, never overwritten');
  assert.equal(legal[1].superseded_by, null);
});

test('the draft hook receives the fetched sources and items per section and writes sections itself; what it leaves out is recorded empty', async () => {
  let seen: DraftContext | null = null;
  const draft = async (ctx: DraftContext) => {
    seen = ctx;
    const legal = ctx.sections.find(x => x.section === 'legal')!;
    assert.ok(legal.items.length >= 3, 'the legal originals are at hand');
    const cite = `[doc:${legal.items[0]}]`;
    await ctx.writeSection('legal', {
      status: 'fresh', model: 'test-model', spend_gbp: 0.12,
      body: { headline: { en: 'The State owns the petroleum.', es: 'El Estado es dueño del petróleo.' }, sentences: [{ en: `The Act vests all rights in petroleum in the State ${cite}`, es: `La Ley confiere al Estado todos los derechos sobre el petróleo ${cite}`, cites: [legal.items[0]] }], questions: [], changed_since: [] },
    });
  };
  const s = await runPack(db, 'SR', { ...runOpts(), draft, budgetGbp: 1.5 });
  assert.ok(seen, 'the hook ran');
  const ctx = seen! as DraftContext;
  // L's DraftCtx, exactly: db, storage, provider, country, jobId, by, now (a Date), budgetGbp, sections[] with sources and ttl_days, refresh.
  assert.equal(ctx.db, db);
  assert.equal(ctx.provider, null, 'no key: the drafter gets a null provider and writes honest rows');
  assert.equal(ctx.country, 'SR');
  assert.equal(ctx.name, 'Suriname');
  assert.equal(typeof ctx.jobId, 'number');
  assert.equal(ctx.by, 'country-pack');
  assert.ok(ctx.now instanceof Date);
  assert.equal(ctx.budgetGbp, 1.5);
  assert.equal(ctx.refresh, false);
  assert.ok(Array.isArray(ctx.sections));
  assert.deepEqual(ctx.sections.map(x => x.section), SECTION_IDS, 'ten section entries in order');
  const legalCtx = ctx.sections.find(x => x.section === 'legal')!;
  assert.equal(legalCtx.sources.length, 3);
  assert.equal(legalCtx.ttl_days, 180);
  assert.equal(ctx.sections.find(x => x.section === 'companies')!.ttl_days, 30, 'the registry override (GEM) reaches the drafter');
  assert.ok(legalCtx.sources.every(x => 'id' in x && 'url' in x && 'licence' in x && 'attribution' in x && 'fetched_at' in x && 'item_id' in x && 'sha256' in x && 'reachable' in x));
  assert.equal(s.spend_gbp, 0.12, 'the hook’s spend reaches the summary');
  assert.equal(s.drafted, true);
  const r = await rows('SR');
  const legal = r.filter(x => x.section === 'legal').at(-1)!;
  assert.equal(legal.version, 3);
  assert.equal(legal.status, 'fresh');
  assert.equal(legal.model, 'test-model');
  assert.equal(Number(legal.spend_gbp), 0.12);
  assert.equal(legal.body.sentences.length, 1);
  assert.equal(legal.built_by, `job:${ctx.jobId}`);
  const fiscal = r.filter(x => x.section === 'fiscal').at(-1)!;
  assert.equal(fiscal.version, 3);
  assert.equal(fiscal.status, 'empty', 'a section the hook did not write is recorded empty with its sources');
  assert.ok(fiscal.sources.length >= 3);
  const j = (await jobs('SR')).at(-1)!;
  assert.equal(j.summary.spend_gbp, 0.12);
  // A hook that throws fails the job honestly and still leaves the fetched originals and the empty rows.
  const bad = await runPack(db, 'SR', { ...runOpts(), draft: async () => { throw new Error('provider down'); } });
  assert.equal(bad.status, 'failed');
  assert.match(bad.error!, /provider down/);
  assert.equal((await jobs('SR')).at(-1)!.status, 'failed');
  assert.equal((await rows('SR')).filter(x => x.section === 'legal').length, 4, 'the failed build still recorded its sections');
  // L's drafter writes its own rows and returns a DraftSummary: the job records it, takes its spend, and fills in the rest as empty.
  const lLike = async (ctx: DraftContext) => {
    const fiscal = ctx.sections.find(x => x.section === 'fiscal')!;
    const w = await writePackSection(ctx.db, { country: ctx.country, section: 'fiscal', status: 'due', stale_reason: 'no_provider', spend_gbp: 0.05, body: { headline: null, sentences: [], questions: [{ en: 'No provider: not drafted.', es: 'Sin proveedor: no redactado.' }], changed_since: [] }, sources: fiscal.sources, source_items: [], built_by: `job:${ctx.jobId}`, now: ctx.now });
    return { country: ctx.country, sections: [{ section: 'fiscal' as const, id: w.id, version: w.version, status: 'due' as const, stale_reason: 'no_provider', called: false, spend_gbp: 0.05, changed: 1 }], spend_gbp: 0.05, calls: 0, stopped_by: null };
  };
  const ls = await runPack(db, 'SR', { ...runOpts(), draft: lLike });
  assert.equal(ls.status, 'ok');
  assert.equal(ls.spend_gbp, 0.05, 'the DraftSummary’s spend is the job’s spend');
  assert.equal(ls.draft?.calls, 0);
  assert.equal(ls.draft?.sections[0].section, 'fiscal');
  const r5 = await rows('SR');
  const fiscal5 = r5.filter(x => x.section === 'fiscal').at(-1)!;
  assert.equal(fiscal5.version, 5); assert.equal(fiscal5.status, 'due'); assert.equal(fiscal5.stale_reason, 'no_provider');
  const legal5 = r5.filter(x => x.section === 'legal').at(-1)!;
  assert.equal(legal5.version, 5); assert.equal(legal5.status, 'empty', 'what the drafter left out is recorded empty by the job');
  assert.equal(r5.filter(x => x.version === 5).length, 10);
});

test('GET /api/countries/:code/pack returns the PackView: ten sections in order, the latest job, the spend; every signed-in person may read it', async () => {
  const g = await call(associate, 'GET', '/api/countries/SR/pack');
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const v = g.body;
  assert.equal(v.country, 'SR');
  assert.deepEqual(v.sections.map((s: any) => s.section), SECTION_IDS);
  assert.equal(typeof v.assembled_at, 'string');
  assert.equal(v.job.status, 'ok', 'the latest build');
  assert.equal(typeof v.job.id, 'number');
  assert.ok(v.job.started_at);
  assert.equal(v.spend_gbp, 0.17, 'the sum of every version built for the country');
  const legal = v.sections[0];
  assert.equal(legal.section, 'legal');
  assert.deepEqual(legal.title, { en: 'Legal framework', es: 'Marco legal' });
  assert.equal(legal.version, 5);
  assert.equal(legal.status, 'empty');
  assert.equal(legal.ttl_days, 180);
  assert.equal(legal.built_at, NOW.toISOString());
  assert.equal(legal.due_at, '2027-04-03');
  assert.deepEqual(legal.body, { headline: null, sentences: [], questions: [], changed_since: [] });
  assert.equal(legal.sources.length, 3);
  for (const s of legal.sources) for (const k of ['id', 'url', 'licence', 'attribution', 'fetched_at', 'item_id', 'reachable']) assert.ok(k in s, `${k} on the chip`);
  assert.ok(!('sha256' in legal.sources[0]), 'the view carries what the chip shows, not the manifest');
  assert.deepEqual(v.counts, { built: 10, fresh: 0, due: 1, stale: 0, unreachable: 0, empty: 9 });
  assert.equal(v.sections.find((s: any) => s.section === 'fiscal').status, 'due');
  // The pack is public scope: the audit row says so.
  const au = (await db.query<any>("SELECT scope, action FROM audit_events WHERE action = 'country.pack.read' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(au.scope, 'public');

  const one = await call(associate, 'GET', '/api/countries/SR/pack/companies');
  assert.equal(one.status, 200);
  assert.equal(one.body.section, 'companies');
  assert.equal(one.body.title.en, 'Who works there');
  assert.ok(one.body.sources.some((s: any) => s.id === 'gem-extraction-tracker' && s.reachable === true));
  assert.equal((await call(associate, 'GET', '/api/countries/SR/pack/weather')).status, 404);
  assert.equal((await call(associate, 'GET', '/api/countries/xx/pack')).status, 400);
  assert.equal((await call(associate, 'GET', '/api/countries/GUY/pack')).status, 400);
});

test('a never-built country answers ten empty sections at version 0 with no job and nothing assembled', async () => {
  const g = await call(partner, 'GET', '/api/countries/NA/pack');
  assert.equal(g.status, 200);
  assert.equal(g.body.assembled_at, null);
  assert.equal(g.body.job, null);
  assert.equal(g.body.spend_gbp, 0);
  assert.equal(g.body.sections.length, 10);
  for (const s of g.body.sections) { assert.equal(s.version, 0); assert.equal(s.status, 'empty'); assert.deepEqual(s.sources, []); assert.equal(s.stale_reason, null); }
  assert.deepEqual(g.body.counts, { built: 0, fresh: 0, due: 0, stale: 0, unreachable: 0, empty: 10 });
  const direct = await packView(db, 'NA', NOW);
  assert.equal(direct.sections[9].section, 'questions');
});

test('GET …/pack/sources lists what the build will read for the country, with licences and attribution; a country without an entry says so', async () => {
  const g = await call(associate, 'GET', '/api/countries/SR/pack/sources');
  assert.equal(g.status, 200);
  assert.equal(g.body.country, 'SR');
  assert.equal(g.body.name, 'Suriname');
  assert.match(g.body.note, /not yet registered/);
  assert.ok(g.body.sources.length >= 10);
  for (const s of g.body.sources) { assert.ok(s.licence && s.attribution && s.section && s.url && s.id); assert.ok(SECTION_IDS.includes(s.section)); }
  const ch = g.body.sources.find((s: any) => s.id === 'chambers-oil-gas');
  assert.match(ch.url, /oil-gas-\{year\}\/suriname$/, 'placeholders for the country are filled; the series stays a series until the build');
  // A registered country (K's entries): its regulator sources come first, the generic set after, and no note.
  const na = await call(associate, 'GET', '/api/countries/NA/pack/sources');
  assert.equal(na.status, 200);
  assert.equal(na.body.note, null);
  assert.ok(typeof na.body.regulator === 'string' && na.body.regulator.length > 0, 'the regulator is named');
  assert.ok(na.body.sources.length > g.body.sources.length);
  assert.ok(na.body.sources.findIndex((s: any) => s.id === 'chambers-oil-gas') > 0, 'the country entries come first');
});

test('POST /api/countries/:code/pack queues a build (202) for any member; a queued one is reused; a stuck build is reaped on read and a new one can be queued', async () => {
  const p = await call(associate, 'POST', '/api/countries/BR/pack');
  assert.equal(p.status, 202, JSON.stringify(p.body));
  assert.equal(p.body.country, 'BR');
  assert.equal(p.body.state, 'queued');
  assert.equal(typeof p.body.job_id, 'number');
  const again = await call(partner, 'POST', '/api/countries/BR/pack');
  assert.equal(again.status, 202);
  assert.equal(again.body.job_id, p.body.job_id);
  const g = await call(associate, 'GET', '/api/countries/BR/pack');
  assert.equal(g.body.job.id, p.body.job_id);
  assert.equal(g.body.job.status, 'running');
  assert.equal((await call(associate, 'POST', '/api/countries/xx/pack')).status, 400);

  // A build that started 40 minutes ago and never wrote its summary: reaped by the read, then the button works again.
  await db.query(`UPDATE jobs SET summary = summary || '{"queued": false}'::jsonb, started_at = now() - interval '40 minutes' WHERE id = $1`, [p.body.job_id]);
  const r = await call(associate, 'GET', '/api/countries/BR/pack');
  assert.equal(r.body.job.id, p.body.job_id);
  assert.equal(r.body.job.status, 'failed', 'reaped on read');
  const row = (await db.query<any>('SELECT status, finished_at, summary FROM jobs WHERE id = $1', [p.body.job_id])).rows[0];
  assert.equal(row.status, 'failed'); assert.ok(row.finished_at); assert.equal(row.summary.reaped, true);
  assert.match(row.summary.error, /did not finish/);
  const fresh = await call(associate, 'POST', '/api/countries/BR/pack');
  assert.equal(fresh.status, 202);
  assert.equal(fresh.body.state, 'queued');
  assert.notEqual(fresh.body.job_id, p.body.job_id);
  // runQueuedPacks re-queues a reaped build once and never twice.
  await db.query(`UPDATE jobs SET summary = summary || '{"queued": false}'::jsonb, started_at = now() - interval '40 minutes' WHERE id = $1`, [fresh.body.job_id]);
  const reaped = await reapStalePacks(db, { country: 'BR' });
  assert.deepEqual(reaped, [fresh.body.job_id]);
  await db.query(`DELETE FROM jobs WHERE name = '${JOB_NAME}' AND summary->>'country' = 'BR'`); // test housekeeping: nothing ran for BR
});

test('the default drafter is L’s: with no provider it writes honest due rows (no_provider) from the sources the job fetched, and the job records its summary', async () => {
  const { draft: _omit, ...opts } = runOpts();
  const s = await runPack(db, 'SR', { ...opts, provider: null });
  assert.equal(s.status, 'ok', s.error ?? '');
  assert.equal(s.drafted, true);
  assert.ok(s.draft, 'the DraftSummary is on the job');
  assert.equal(s.draft!.country, 'SR');
  assert.equal(s.draft!.calls, 0, 'no provider: no model call');
  assert.equal(s.spend_gbp, 0);
  const r = await rows('SR');
  const latest = SECTION_IDS.map(id => r.filter(x => x.section === id).at(-1)!);
  assert.ok(latest.every(x => x.version === 6), `every section moved to the next version in this build: ${latest.map(x => `${x.section}:${x.version}`).join(' ')}`);
  const legal = latest.find(x => x.section === 'legal')!;
  assert.equal(legal.status, 'due');
  assert.equal(legal.stale_reason, 'no_provider');
  assert.equal(legal.sources.length, 3, 'the drafter kept the sources the job fetched');
  assert.ok(legal.sources.some((x: any) => x.id === 'chambers-oil-gas' && x.reachable && x.item_id));
});

test('creating a project with a country queues a pack for it, and the create never fails because of it', async () => {
  const c = await call(partner, 'POST', '/api/projects', { id: 'namibia-pel-farm-in', name: 'Namibia PEL farm-in', country: 'NA' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const j = await jobs('NA');
  assert.equal(j.length, 1, 'one pack queued for Namibia');
  assert.equal(j[0].summary.queued, true);
  assert.equal(j[0].summary.requested_by, 'chris');
  const before = (await db.query<any>(`SELECT count(*)::int AS n FROM jobs WHERE name = '${JOB_NAME}'`)).rows[0].n;
  const none = await call(partner, 'POST', '/api/projects', { id: 'no-country-yet', name: 'No country yet' });
  assert.equal(none.status, 201);
  assert.equal((await db.query<any>(`SELECT count(*)::int AS n FROM jobs WHERE name = '${JOB_NAME}'`)).rows[0].n, before, 'a project without a country queues no pack');
  assert.equal((await jobs('NA')).length, 1, 'still one build for Namibia');
});
