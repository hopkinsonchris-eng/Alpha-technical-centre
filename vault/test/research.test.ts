// Wave 4, PR 1 (docs/vault-hub/wave4/05-markup.md §1.4, §3): a research run for one project. The
// queries come from the project's own names (W4-AC1); World Monitor and the miners answer from
// fixtures and every finding is filed as a cited public note, deduplicated on re-run (W4-AC2);
// the run stops at the wall-clock or spend cap and says what it did not reach (W4-AC3); findings
// open field and fact proposals with verbatim quotes, and accepting them writes the operator and
// the production figure (W4-AC4). No network: fetch, adapters, the provider and the clock are injected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-research-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { filesystemStorage } = await import('../src/storage.ts');
const { createApp } = await import('../src/app.ts');
const { FakeProvider } = await import('../src/llm/provider.ts');
const { configureLocate } = await import('../src/assets/gazetteers.ts');
const { configureWorldMonitor, resetWorldMonitorCache } = await import('../src/intel/worldmonitor.ts');
const { buildQueries, operatorNames, nameKeywords } = await import('../src/research/queries.ts');
const { costGbp, runResearch: runResearchRaw, researchView } = await import('../src/research/run.ts');
const logLines: string[] = [];
const runResearch: typeof runResearchRaw = (db, pid, opts = {}, jobId) => runResearchRaw(db, pid, { log: (l) => logLines.push(l), progressEveryMs: 0, skipGemWiki: true, skipWeb: true, skipLocate: true, ...opts }, jobId);
const { toKboed } = await import('../src/research/findings.ts');
const { configureResearch } = await import('../src/api/research.routes.ts');
import type { FeedAdapter } from '../src/miners/types.ts';
type Db = Awaited<ReturnType<typeof openDb>>;

const DOMAIN = 'alpha-technical-centre.com';
const KEY = 'wm_' + 'b'.repeat(40);
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
const storage = filesystemStorage(mkdtempSync(path.join(os.tmpdir(), 'vault-research-store-')));
let t = Date.parse('2026-10-01T09:00:00Z');
let step = 0;                                       // how far the clock moves per read
const now = () => { const d = new Date(t); t += step; return d; };
const call = async (method: string, url: string, body?: unknown) => {
  const r = await partner.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const scalar = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0].n);

const wmCalls: string[] = [];
const T0 = Date.parse('2026-09-30T10:00:00Z');
const WM: Record<string, (p: URLSearchParams) => unknown> = {
  'search-gdelt-documents': p => p.get('query')!.includes('Guafita')
    ? { articles: [{ url: 'https://news.example.com/guafita-restart', title: 'PDVSA restarts the Guafita field with Chinese partner', source: 'Reuters', date: '20260930T100000Z', language: 'English', tone: 1.2 }, { url: 'https://news.example.com/apure', title: 'Apure output: the La Victoria field returns to production', source: 'El Nacional', date: '20260928T120000Z', language: 'Spanish', tone: 0 }] }
    : { articles: [] },
  'get-company-enrichment': () => ({ company: { name: 'Petróleos de Venezuela', domain: 'pdvsa.com', description: 'Venezuela\'s state oil company.', location: 'Caracas', website: 'https://www.pdvsa.com', founded: 1976, cik: null, ticker: null }, market: { industry: 'Oil & Gas', country: 'VE', marketCapMusd: null }, secFilings: { recentFilings: [] }, sources: ['wikipedia'] }),
  'list-company-signals': () => ({ signals: [{ type: 'news', title: 'PDVSA signs service contract for Guafita', url: 'https://news.example.com/signal-1', source: 'Argus', sourceTier: 2, timestampMs: T0, strength: 'medium' }] }),
  'search-sec-filings': () => ({ results: [] }),
  'get-intel-timeline': () => ({ records: [{ id: 'r9', domain: 'energy', country: 'VE', category: 'production', title: 'Output recovers in Orinoco belt', summary: 'Chevron ramps Petropiar.', sourceUrl: 'https://example.com/r9', occurredAt: T0, score: 0.8 }], partial: false }),
};
const wmFetch = (async (url: string, init: any) => {
  const u = new URL(url); const ep = u.pathname.split('/').pop()!;
  wmCalls.push(`${ep}?${u.searchParams.get('query') ?? u.searchParams.get('name') ?? u.searchParams.get('company') ?? u.searchParams.get('country') ?? ''}`);
  assert.equal(init?.headers?.['X-WorldMonitor-Key'], KEY, 'the key travels in the header');
  const h = WM[ep];
  return new Response(JSON.stringify(h ? h(u.searchParams) : {}), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

/** The miners' literature answer: one paper on topic, one off-topic (dropped by the keyword screen). */
const paperTitle = { v: 'Waterflood performance of the Guafita reservoir, Apure basin' };
const openalex: FeedAdapter = {
  id: 'openalex', schedule: 'weekly', rateLimit: { perSecond: 10 },
  async *fetch(_since, topics) {
    const topic = topics.find(x => x.id.endsWith(':field:ve:guafita'))!;
    yield { external_id: 'W1', url: 'https://openalex.org/W1', title: paperTitle.v, authored_at: '2025-03-01T00:00:00Z', authors: ['A. Pérez'], text: 'Guafita field waterflood history match.', meta: { topic_id: topic.id } };
    yield { external_id: 'W2', url: 'https://openalex.org/W2', title: 'Unrelated tight gas paper', authored_at: '2025-03-01T00:00:00Z', authors: [], text: 'Nothing about the field.', meta: { topic_id: topic.id } };
  },
};

/** The model's reading of a finding: a verbatim operator quote, a verbatim production quote, and one invented quote (dropped). */
const provider = new FakeProvider(req => {
  const text = req.messages.at(-1)?.content ?? '';
  if (/restarts the Guafita field/.test(text)) return JSON.stringify({ facts: [
    { kind: 'operator', value: 'PDVSA', quote: 'PDVSA restarts the Guafita field with Chinese partner', unit: null, year: null, asset_name: 'Guafita' },
    { kind: 'production', value: '12,400', quote: 'The field now produces 12,400 bopd according to the ministry.', unit: 'bopd', year: 2026, asset_name: 'Guafita' },
  ] });
  if (/signs service contract/.test(text)) return JSON.stringify({ facts: [{ kind: 'production', value: '20,000', quote: 'PDVSA signs service contract for Guafita', unit: 'bopd', year: 2026, asset_name: 'Guafita' }] });
  return '{"facts":[]}';
});

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('hte','High Tech Electronica','client','VE')");
  await db.query("INSERT INTO assets (id,kind,name,country,operator,props,lat,lon,location_source,created_by) VALUES ('field:ve:guafita','field','Guafita','VE','PDVSA',$1::jsonb,7.6,-70.9,'gem','chris')", [JSON.stringify({ gem: { name: 'Guafita', name_other: 'Guafita Oil Field', operator: 'Petróleos de Venezuela (PDVSA) [100%]', owners: 'PDVSA (100%)' } })]);
  await db.query("INSERT INTO assets (id,kind,name,country,operator,props,created_by) VALUES ('field:ve:bare','field','Bare','VE',NULL,'{}'::jsonb,'chris')");
  await db.query("INSERT INTO assets (id,kind,name,country,operator,props,lat,lon,location_source,created_by) VALUES ('field:ve:la-victoria','field','La Victoria','VE','PDVSA','{}'::jsonb,7.2,-70.5,'gem','chris')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids,register) VALUES ('hte-apure','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:guafita,field:ve:bare}',$1::jsonb)", [JSON.stringify({ thesis: 'ZEBRAWORD never searched', next: 'call the ministry' })]);
  configureLocate({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });   // no gazetteer network in tests
  configureWorldMonitor({ fetch: wmFetch, apiKey: KEY, now: () => new Date(t) });
  configureResearch({ autorun: false });
  partner = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
});
after(async () => { await db.close(); });

test('W4-AC1: the queries come from the project, its fields and their operators; short names are anchored; register text is never a search term', async () => {
  const p = { id: 'hte-apure', name: 'High Tech Electronica', country: 'VE', client_name: 'High Tech Electronica', register: { thesis: 'ZEBRAWORD never searched' } };
  const fields = (await db.query<any>("SELECT id, name, kind, country, operator, props FROM assets WHERE id IN ('field:ve:guafita','field:ve:bare') ORDER BY id")).rows;
  const q = buildQueries(p, fields, 'Venezuela');
  const gdelt = q.gdelt.map(g => g.query);
  assert.ok(gdelt.includes('"Guafita" Venezuela'), JSON.stringify(gdelt));
  assert.ok(gdelt.includes('"Guafita Oil Field" Venezuela'), 'the GEM "name other" is searched too');
  assert.ok(gdelt.includes('"Bare" oil field Venezuela'), 'a short name is anchored with the country and "oil field"');
  assert.ok(gdelt.includes('"High Tech Electronica" Venezuela'), 'the project name is searched');
  assert.equal(q.gdelt.find(g => g.label === 'Guafita')!.field_id, 'field:ve:guafita');
  assert.deepEqual(q.companies, ['PDVSA', 'Petróleos de Venezuela', 'High Tech Electronica']);
  assert.deepEqual(operatorNames('Ecopetrol [50%]; Frontera Energy [50%]'), ['Ecopetrol', 'Frontera Energy']);
  const lit = q.literature.find(x => x.id === 'research:hte-apure:field:ve:guafita')!;
  assert.equal(lit.query, 'Guafita field Venezuela reservoir');
  assert.equal(lit.strict, true, 'research literature topics are strict: the name as a phrase and an oil and gas word');
  assert.ok(lit.context!.includes('Venezuela') && lit.context!.includes('reservoir') && lit.context!.includes('PDVSA'));
  assert.deepEqual(lit.keywords, ['Guafita', 'Guafita Oil Field']);
  assert.deepEqual(nameKeywords(['Trico — Oficina', 'OFICINA NORTE —TRICO', 'B-3']), ['Trico — Oficina', 'Trico', 'Oficina', 'OFICINA NORTE —TRICO', 'OFICINA NORTE', 'TRICO', 'B-3'].filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i));
  assert.ok(q.literature.some(x => x.id === 'research:hte-apure:co:pdvsa'));
  const all = JSON.stringify(q);
  assert.ok(!/ZEBRAWORD|call the ministry/.test(all), 'the register free text is never a query');
  // A placeholder project name is not searched; a project without fields still searches its own name.
  const bare = buildQueries({ id: 'x', name: 'New project', country: 'CO', client_name: null, register: null }, [], 'Colombia');
  assert.deepEqual(bare.gdelt, []); assert.deepEqual(bare.literature, []); assert.equal(bare.country, 'CO');
});

test('costGbp and toKboed: Sonnet prices by default; barrels per day become thousand barrels per day', () => {
  assert.equal(costGbp('claude-sonnet-4-5', { input: 1_000_000, cached: 0, output: 0 }), Math.round((2 / 1.28) * 10000) / 10000);
  assert.ok(costGbp('fake-1', { input: 1000, cached: 0, output: 200 }) > 0);
  assert.equal(toKboed('12,400', 'bopd'), 12.4);
  assert.equal(toKboed('12.4', 'kboe/d'), 12.4);
  assert.equal(toKboed('900', 'mcf/d'), null);
});

let firstRun: Awaited<ReturnType<typeof runResearch>>;
test('W4-AC2: a run files every World Monitor and literature finding as a cited public note under the project and opens proposals', async () => {
  step = 0; resetWorldMonitorCache(); wmCalls.length = 0;
  firstRun = await runResearch(db, 'hte-apure', { now, storage, provider, minerAdapters: [openalex], budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(firstRun.status, 'ok', JSON.stringify(firstRun));
  assert.equal(firstRun.stopped_by, null);
  assert.deepEqual(firstRun.not_reached, []);
  // World Monitor: one GDELT query per name, enrichment + signals + filings per company, the country timeline.
  assert.equal(firstRun.sources.gdelt.queries, 4);
  assert.equal(firstRun.sources.gdelt.created, 2);
  assert.equal(firstRun.sources.company.queries, 3);
  assert.equal(firstRun.sources['company-enrichment'].created, 3);
  assert.equal(firstRun.sources['company-signals'].created, 1);
  assert.equal(firstRun.sources['intel-timeline'].created, 1);
  assert.equal(firstRun.sources.literature.created, 1, 'the off-topic paper is screened out');
  assert.ok(wmCalls.some(c => c === 'search-gdelt-documents?"Bare" oil field Venezuela'));
  assert.ok(!wmCalls.some(c => /ZEBRAWORD/.test(c)));
  // Findings: public notes with the source, URL, query and a verbatim excerpt.
  const g = (await db.query<any>("SELECT * FROM items WHERE project_id = 'hte-apure' AND external_id = 'gdelt:https://news.example.com/guafita-restart'")).rows[0];
  assert.ok(g, 'the GDELT article is filed');
  assert.equal(g.type, 'note'); assert.equal(g.legal_tag, 'lt-public'); assert.equal(g.version, 1);
  assert.equal(g.origin.source, 'research'); assert.equal(g.origin.adapter, 'gdelt'); assert.equal(g.origin.url, 'https://news.example.com/guafita-restart');
  assert.equal(g.extracted.kind, 'research'); assert.equal(g.extracted.query, '"Guafita" Venezuela'); assert.match(g.extracted.quote, /PDVSA restarts the Guafita field/);
  assert.equal(g.authored_at.toISOString(), '2026-09-30T10:00:00.000Z');
  assert.deepEqual(g.asset_ids, ['field:ve:guafita']);
  assert.ok(g.tags.includes('research'));
  const paper = (await db.query<any>("SELECT * FROM items WHERE project_id = 'hte-apure' AND type = 'paper'")).rows;
  assert.equal(paper.length, 1, 'the literature paper is filed under the project, not the firm');
  assert.equal(paper[0].origin.query, 'Guafita field Venezuela reservoir');
  assert.equal(paper[0].legal_tag, 'lt-public');
  // Proposals: a field the finding names and is not attached; the facts with verbatim quotes; the invented quote dropped.
  const rows = (await db.query<any>("SELECT kind, payload FROM review_queue WHERE status = 'open' AND payload->>'project_id' = 'hte-apure' ORDER BY kind, payload->>'fact_kind'")).rows;
  const assetRows = rows.filter(r => r.kind === 'asset'), facts = rows.filter(r => r.kind === 'research');
  assert.deepEqual(assetRows.map(r => r.payload.name), ['La Victoria']);
  assert.equal(assetRows[0].payload.candidates[0]?.asset_id, 'field:ve:la-victoria');
  assert.deepEqual(facts.map(r => [r.payload.fact_kind, r.payload.value]), [['operator', 'PDVSA'], ['production', '20,000']]);
  assert.equal(facts[0].payload.quote, 'PDVSA restarts the Guafita field with Chinese partner');
  assert.equal(facts[0].payload.asset_id, 'field:ve:guafita');
  assert.equal(facts[0].payload.proposal, 'Operator: PDVSA');
  assert.equal(facts[1].payload.proposal, 'Production: 20,000 bopd (2026)');
  assert.equal(firstRun.proposals.asset, 1); assert.equal(firstRun.proposals.research, 2);
  assert.ok(firstRun.fact_reads >= 2 && firstRun.spend_gbp > 0 && firstRun.spend_gbp < 0.01, JSON.stringify({ reads: firstRun.fact_reads, spend: firstRun.spend_gbp }));
  // The run is a job row with its summary, and an audit event names the notes it filed.
  const job = (await db.query<any>("SELECT status, finished_at, summary FROM jobs WHERE name = 'research' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(job.status, 'ok'); assert.ok(job.finished_at); assert.equal(job.summary.project_id, 'hte-apure'); assert.equal(job.summary.findings, firstRun.findings);
  assert.equal(job.summary.phase, 'done');
  assert.match(logLines.at(-1)!, /^research run \d+ hte-apure: ok, \d+ findings, 3 proposals, £[0-9.]+, \d+ s; gdelt 4q\/4f, company 3q\/0f, company-enrichment 0q\/3f, company-signals 0q\/\d+f, intel-timeline 1q\/1f, literature \d+q\/2f$/, logLines.at(-1) ?? '');
  const audit = (await db.query<any>("SELECT refs, detail FROM audit_events WHERE action = 'research.run' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.ok(audit.refs.includes('project:hte-apure') && audit.refs.some((r: string) => r.startsWith('doc:')));
  assert.equal(audit.detail.findings, firstRun.findings);
  // The view the Hub reads.
  const view = await researchView(db, 'hte-apure');
  assert.equal(view.runs[0].status, 'ok');
  assert.ok(view.findings.length >= 7, String(view.findings.length));
  assert.ok(view.findings.every(f => f.source && f.quote !== undefined));
  assert.ok(view.findings.some(f => f.source === 'gdelt' && f.url === 'https://news.example.com/guafita-restart'));
  assert.ok(view.findings.some(f => f.source === 'openalex' || f.source === 'literature'));
});

test('W4-AC2: a re-run updates what changed and leaves the rest alone; proposals are not duplicated', async () => {
  const items = await scalar("SELECT count(*)::int AS n FROM items WHERE project_id = 'hte-apure'");
  const open = await scalar("SELECT count(*)::int AS n FROM review_queue WHERE status = 'open' AND payload->>'project_id' = 'hte-apure'");
  resetWorldMonitorCache();
  WM['search-gdelt-documents'] = p => p.get('query')!.includes('Guafita')
    ? { articles: [{ url: 'https://news.example.com/guafita-restart', title: 'PDVSA restarts the Guafita field with Chinese partner (updated)', source: 'Reuters', date: '20260930T100000Z' }, { url: 'https://news.example.com/apure', title: 'Apure output: the La Victoria field returns to production', source: 'El Nacional', date: '20260928T120000Z' }] }
    : { articles: [] };
  const again = await runResearch(db, 'hte-apure', { now, storage, provider, minerAdapters: [openalex], budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(again.status, 'ok');
  assert.equal(again.sources.gdelt.updated, 1); assert.equal(again.sources.gdelt.unchanged, 3, 'both Guafita queries answer the same two articles'); assert.equal(again.sources.gdelt.created, 0);
  assert.equal(again.sources['company-enrichment'].unchanged, 3);
  assert.equal(again.sources.literature.unchanged, 1);
  assert.equal(await scalar("SELECT count(*)::int AS n FROM items WHERE project_id = 'hte-apure'"), items, 'nothing filed twice');
  const g = (await db.query<any>("SELECT version, title FROM items WHERE external_id = 'gdelt:https://news.example.com/guafita-restart'")).rows[0];
  assert.equal(g.version, 2); assert.match(g.title, /\(updated\)$/);
  assert.equal(await scalar("SELECT count(*)::int AS n FROM review_queue WHERE status = 'open' AND payload->>'project_id' = 'hte-apure'"), open, 'open proposals are deduplicated');
});

test('W4-AC3: the run stops at the wall-clock budget and says what it did not reach; the spend cap stops the model reads', async () => {
  resetWorldMonitorCache();
  step = 6 * 60_000;                                 // every look at the clock costs six minutes
  const stopped = await runResearch(db, 'hte-apure', { now, storage, provider, minerAdapters: [openalex], budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  step = 0;
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stopped_by, 'time');
  assert.ok(stopped.not_reached.length > 0);
  assert.ok(stopped.not_reached.some(n => n.source === 'literature' || n.source === 'intel-timeline' || n.source === 'company'), JSON.stringify(stopped.not_reached));
  assert.ok(stopped.not_reached.every(n => n.reason === 'time'));
  assert.ok(stopped.duration_ms >= 15 * 60_000);
  const job = (await db.query<any>("SELECT status, summary FROM jobs WHERE name = 'research' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(job.status, 'ok'); assert.equal(job.summary.status, 'stopped'); assert.equal(job.summary.stopped_by, 'time');

  // Spend: a cap below one model read stops the fact reads after the first and names the queries not reached.
  resetWorldMonitorCache();
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids) VALUES ('hte-spend','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:guafita}')");
  const tight = await runResearch(db, 'hte-spend', { now, storage, provider, minerAdapters: [openalex], budgetMs: 15 * 60_000, budgetGbp: 0.00001, by: 'chris' });
  assert.equal(tight.stopped_by, 'spend');
  assert.equal(tight.fact_reads, 1);
  assert.ok(tight.not_reached.some(n => n.reason === 'spend'));
});

test('W4-AC4: accepting an operator proposal sets the field operator; a production fact lands on the register; rejecting resolves', async () => {
  const op = (await db.query<any>("SELECT id FROM review_queue WHERE kind = 'research' AND status = 'open' AND payload->>'fact_kind' = 'operator' AND payload->>'project_id' = 'hte-apure'")).rows[0];
  const prod = (await db.query<any>("SELECT id, payload FROM review_queue WHERE kind = 'research' AND status = 'open' AND payload->>'fact_kind' = 'production' AND payload->>'project_id' = 'hte-apure'")).rows[0];
  assert.ok(op && prod);
  await db.query("UPDATE assets SET operator = NULL WHERE id = 'field:ve:guafita'");
  const a = await call('POST', `/api/queue/review/${op.id}/accept`, {});
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.status, 'accepted');
  assert.equal((await db.query<any>("SELECT operator FROM assets WHERE id = 'field:ve:guafita'")).rows[0].operator, 'PDVSA');
  const b = await call('POST', `/api/queue/review/${prod.id}/accept`, { apply: true });
  assert.equal(b.status, 200);
  const reg = (await db.query<any>("SELECT register FROM projects WHERE id = 'hte-apure'")).rows[0].register;
  assert.equal(reg.current, '20,000 bopd (2026)'); assert.equal(reg.current_kboed, 20); assert.equal(reg.current_source.item_id, prod.payload.item_id); assert.equal(reg.thesis, 'ZEBRAWORD never searched', 'the rest of the register is untouched');
  const note = (await db.query<any>('SELECT extracted FROM items WHERE id = $1', [prod.payload.item_id])).rows[0];
  assert.equal(note.extracted.accepted_facts[0].kind, 'production'); assert.equal(note.extracted.accepted_facts[0].accepted_by, 'chris');
  assert.equal((await db.query<any>("SELECT status, resolved_by FROM review_queue WHERE id = $1", [op.id])).rows[0].status, 'accepted');
  // Rejecting a field proposal resolves it and changes nothing else.
  const fieldRow = (await db.query<any>("SELECT id FROM review_queue WHERE kind = 'asset' AND status = 'open' AND payload->>'project_id' = 'hte-apure'")).rows[0];
  const r = await call('POST', `/api/queue/review/${fieldRow.id}/reject`, {});
  assert.equal(r.status, 200); assert.equal(r.body.status, 'rejected');
  assert.deepEqual((await db.query<any>("SELECT asset_ids FROM projects WHERE id = 'hte-apure'")).rows[0].asset_ids, ['field:ve:guafita', 'field:ve:bare']);
});

test('a run on a project the caller cannot write is refused at the queue; an associate member of a firm project may decide', async () => {
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('hte-private','hte','HTE private','active','lt-firm','VE','{chris}')");
  const ana = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
  await db.query("INSERT INTO review_queue (id, kind, payload) VALUES ('11111111-1111-4111-8111-111111111111', 'research', $1::jsonb)", [JSON.stringify({ project_id: 'hte-private', fact_kind: 'operator', value: 'X', quote: 'q', asset_id: null })]);
  const no = await ana.request('/api/queue/review/11111111-1111-4111-8111-111111111111/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(no.status, 403, await no.text());
  assert.equal((await db.query<any>("SELECT status FROM review_queue WHERE id = '11111111-1111-4111-8111-111111111111'")).rows[0].status, 'open');
});

test('the literature screen keeps only papers that name the field and are about oil and gas, abstract or not; a re-run hides what an earlier run filed wrongly', async () => {
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids) VALUES ('hte-screen','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:guafita}')");
  // What the first live run did: title-only Crossref answers with "field" or "block" in them, nothing to do with the field.
  const junkId = randomUUID();
  await db.query(
    `INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, external_id, content_hash, version, extracted, tags)
     VALUES ($1,'paper','A field study in dairy farms: thermal condition of feet','2026-10-01T10:00:00Z','2001-06-01T00:00:00Z','{}','hte-screen','lt-public',$2::jsonb,'10.1/junk','sha256:junk',1,'{}'::jsonb,'{}')`,
    [junkId, JSON.stringify({ source: 'crossref', external_id: '10.1/junk', query: 'Guafita field Venezuela reservoir' })]);
  const titlesOnly: FeedAdapter = { id: 'crossref', schedule: 'weekly', rateLimit: { perSecond: 10 }, async *fetch(_s, topics) {
    const topic = topics.find(x => x.id.endsWith(':field:ve:guafita'))!;
    yield { external_id: '10.2/dairy', url: 'https://doi.org/10.2/dairy', title: 'A field study in dairy farms: thermal condition of feet', authored_at: '2001-06-01T00:00:00Z', authors: [], meta: { topic_id: topic.id } };
    yield { external_id: '10.2/capsular', url: 'https://doi.org/10.2/capsular', title: 'Early postoperative capsular block syndrome', authored_at: '2001-04-01T00:00:00Z', authors: [], meta: { topic_id: topic.id } };
    yield { external_id: '10.2/magnet', url: 'https://doi.org/10.2/magnet', title: 'Numerical study of plasma-wall transition in an oblique magnetic field', authored_at: '2001-03-01T00:00:00Z', authors: [], meta: { topic_id: topic.id } };
    yield { external_id: '10.2/guafita-1995', url: 'https://doi.org/10.2/guafita-1995', title: 'Waterflood performance of the Guafita field, Apure, Venezuela', authored_at: '1995-03-01T00:00:00Z', authors: ['J. Pérez'], meta: { topic_id: topic.id } };
    yield { external_id: '10.2/guafita-street', url: 'https://doi.org/10.2/guafita-street', title: 'Urban growth along Calle Guafita: a planning study', authored_at: '2010-03-01T00:00:00Z', authors: [], meta: { topic_id: topic.id } };
  } };
  configureWorldMonitor({ fetch: wmFetch, apiKey: null, now: () => new Date(t) });
  const r = await runResearch(db, 'hte-screen', { now, storage, provider: null, minerAdapters: [titlesOnly], budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(r.status, 'ok');
  assert.equal(r.sources.literature.findings, 5); assert.equal(r.sources.literature.created, 1, 'one of five title-only answers names the field and is about oil');
  const filed = (await db.query<any>("SELECT title, hidden FROM items WHERE project_id = 'hte-screen' AND type = 'paper' ORDER BY title")).rows;
  assert.deepEqual(filed, [{ title: 'Waterflood performance of the Guafita field, Apure, Venezuela', hidden: false }], 'the junk an earlier run filed is gone: nothing cited it');
  assert.equal(r.pruned, 1); assert.equal(r.purged, 1);
  const audit = (await db.query<any>("SELECT refs, detail FROM audit_events WHERE action = 'research.run' AND scope = 'project:hte-screen' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audit.detail.pruned, 1); assert.ok(audit.refs.includes('doc:' + junkId));
  const pruneAudit = (await db.query<any>("SELECT refs, detail FROM audit_events WHERE action = 'research.prune' AND scope = 'project:hte-screen' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.deepEqual(pruneAudit.detail, { purged: 1, hidden: 0, reason: 'failed the literature screen' }); assert.ok(pruneAudit.refs.includes('doc:' + junkId));
  assert.match(logLines.at(-1) ?? '', /pruned 1 \(1 purged\)/);
  // A junk paper that something cites is hidden, not purged; one already hidden by an earlier build is purged too.
  const citedId = randomUUID(), oldHiddenId = randomUUID();
  for (const [id, title, hid] of [[citedId, 'Early postoperative capsular block syndrome', false], [oldHiddenId, 'Glaucoma surgery: visual field progression', true]] as const) {
    await db.query(
      `INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, external_id, content_hash, version, extracted, tags, hidden)
       VALUES ($1,'paper',$2,'2026-10-01T10:00:00Z','2001-06-01T00:00:00Z','{}','hte-screen','lt-public',$3::jsonb,$4,'sha256:junk2',1,'{}'::jsonb,'{}',$5)`,
      [id, title, JSON.stringify({ source: 'crossref', external_id: 'x:' + id, query: 'Guafita field Venezuela reservoir' }), 'x:' + id, hid]);
  }
  const citing = (await db.query<any>("SELECT id FROM items WHERE project_id = 'hte-screen' AND type = 'paper'")).rows[0].id;
  await db.query("INSERT INTO item_cites (item_id, ref) VALUES ($1, $2)", [citing, 'doc:' + citedId]);
  const r2 = await runResearch(db, 'hte-screen', { now, storage, provider: null, minerAdapters: [titlesOnly], budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(r2.purged, 1); assert.equal(r2.pruned, 2);
  const left = (await db.query<any>("SELECT id, hidden FROM items WHERE project_id = 'hte-screen' AND type = 'paper' AND id = ANY($1::uuid[])", [[citedId, oldHiddenId]])).rows;
  assert.deepEqual(left, [{ id: citedId, hidden: true }], 'the cited one is hidden; the old hidden one is purged');
  const view = await researchView(db, 'hte-screen');
  assert.deepEqual(view.findings.map(f => f.title), ['Waterflood performance of the Guafita field, Apure, Venezuela']);
  configureWorldMonitor({ fetch: wmFetch, apiKey: KEY, now: () => new Date(t) });
});

/* ── W4-D1 revised: Global Energy Monitor wiki pages and web search ── */

const GEM_HTML = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'research', 'gem-guafita.html'), 'utf8');
const WIKI = 'https://www.gem.wiki/Guafita_Oil_Field_(Venezuela)';
const wikiFetch = (async (url: string) => (String(url) === WIKI ? new Response(GEM_HTML, { status: 200 }) : new Response('nope', { status: 404 }))) as unknown as typeof fetch;

test('W4-AC9: the run files the GEM wiki page of a field that has one, and each source it cites, with no model; nothing for a field without a record; a re-run leaves them unchanged', async () => {
  await db.query("UPDATE assets SET props = jsonb_set(props, '{gem,wiki_url}', to_jsonb($2::text)) WHERE id = $1", ['field:ve:guafita', WIKI]);
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids) VALUES ('hte-gem','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:guafita,field:ve:bare}')");
  const noModel = new FakeProvider(() => { throw new Error('the GEM pass must not call the model'); });
  const r = await runResearch(db, 'hte-gem', { now, storage, provider: noModel, fetch: wikiFetch, skipGemWiki: false, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris', maxFactReads: 0 });
  assert.equal(r.status, 'ok', JSON.stringify(r.warnings));
  assert.equal(r.sources['gem-wiki'].queries, 1); assert.equal(r.sources['gem-wiki'].created, 1); assert.equal(r.sources['gem-wiki'].skipped, '1 field without a Global Energy Monitor record');
  assert.equal(r.sources['gem-wiki-ref'].created, 3);
  assert.equal(r.findings, 4); assert.equal(r.fact_reads, 0); assert.equal(r.spend_gbp, 0);
  const page = (await db.query<any>("SELECT title, extracted, origin, asset_ids FROM items WHERE project_id = 'hte-gem' AND external_id = $1", [WIKI])).rows[0];
  assert.equal(page.title, 'Global Energy Monitor: Guafita'); assert.equal(page.extracted.source, 'gem-wiki'); assert.match(page.extracted.quote, /^Guafita Oil Field is an operating oil field in Venezuela\./);
  assert.match(page.extracted.attribution, /Global Energy Monitor.*CC BY 4\.0/); assert.equal(page.extracted.references.length, 3); assert.deepEqual(page.asset_ids, ['field:ve:guafita']);
  const refs = (await db.query<any>("SELECT title, origin FROM items WHERE project_id = 'hte-gem' AND extracted->>'source' = 'gem-wiki-ref' ORDER BY title")).rows;
  assert.deepEqual(refs.map(x => x.title), ['PDVSA restarts Guafita field with Chinese partner. Reuters. 30 September 2026', 'Source cited by Global Energy Monitor for Guafita (eprinc.org)', 'Source cited by Global Energy Monitor for Guafita (web.archive.org)']);
  assert.equal(refs[1].origin.url, 'https://eprinc.org/wp-content/uploads/2021/09/The-Future-of-Venezuela%E2%80%99s-Oil-Industry.pdf');
  const again = await runResearch(db, 'hte-gem', { now, storage, provider: noModel, fetch: wikiFetch, skipGemWiki: false, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(again.sources['gem-wiki'].unchanged, 1); assert.equal(again.sources['gem-wiki-ref'].unchanged, 3); assert.equal(again.findings, 0);
  // A page that cannot be read is an error on the source, not a failed run.
  const dead = await runResearch(db, 'hte-gem', { now, storage, provider: null, fetch: (async () => new Response('x', { status: 503 })) as unknown as typeof fetch, skipGemWiki: false, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(dead.status, 'ok'); assert.equal(dead.sources['gem-wiki'].error, 'gem.wiki answered HTTP 503'); assert.ok(dead.not_reached.some(n => n.source === 'gem-wiki'));
});

test('W4-AC10: web search files one finding per cited page with the verbatim cited text, counts searches into spend, reports a switched-off organisation and stops asking, and is off with RESEARCH_WEB=false', async () => {
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids) VALUES ('hte-web','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:guafita}')");
  const asked: string[] = [];
  const searcher = new FakeProvider(() => '{"facts":[]}', (req) => {
    asked.push(req.prompt);
    if (/Guafita/.test(req.prompt)) return { searches: 2, results: [{ url: 'https://eprinc.org/future.pdf', title: 'The Future of Venezuela\'s Oil Industry', page_age: 'September 2021' }, { url: 'https://example.org/uncited', title: 'Uncited', page_age: null }],
      citations: [{ url: 'https://eprinc.org/future.pdf', title: 'The Future of Venezuela\'s Oil Industry', cited_text: 'the Guafita field in Apure produced 12,400 barrels per day in 2024', sentence: 'Guafita produced about 12,400 bopd in 2024.' }] };
    return { searches: 1, citations: [], results: [] };
  });
  const r = await runResearch(db, 'hte-web', { now, storage, provider: searcher, skipWeb: false, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris', webMaxUses: 3 });
  assert.equal(r.status, 'ok', JSON.stringify(r.warnings));
  assert.equal(r.sources.web.queries, 3, 'one call per name: Guafita, Guafita Oil Field, the project name'); assert.equal(r.sources.web.created, 1);
  assert.ok(asked[0].includes('Research "Guafita" in Venezuela') && asked[0].includes('"Guafita" Venezuela'), asked[0]);
  const f = (await db.query<any>("SELECT title, extracted, origin, asset_ids FROM items WHERE project_id = 'hte-web' AND extracted->>'source' = 'web'")).rows;
  assert.equal(f.length, 1, 'the uncited result files nothing');
  assert.equal(f[0].title, 'The Future of Venezuela\'s Oil Industry'); assert.equal(f[0].origin.url, 'https://eprinc.org/future.pdf'); assert.equal(f[0].extracted.quote, 'the Guafita field in Apure produced 12,400 barrels per day in 2024');
  assert.equal(f[0].extracted.summary, 'Guafita produced about 12,400 bopd in 2024.'); assert.equal(f[0].extracted.page_age, 'September 2021'); assert.deepEqual(f[0].asset_ids, ['field:ve:guafita']);
  // Spend: tokens plus 4 searches at $0.01 → about £0.03 over the token cost.
  assert.ok(r.spend_gbp >= 4 * 0.01 / 1.28 && r.spend_gbp < 0.1, String(r.spend_gbp));
  // The organisation has web search switched off: the source says so once and the run goes on.
  const off = new FakeProvider(() => '{"facts":[]}', () => new Error('anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"Web search is not enabled for this organization."}}'));
  const r2 = await runResearch(db, 'hte-web', { now, storage, provider: off, skipWeb: false, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(r2.status, 'ok'); assert.equal(r2.sources.web.queries, 1, 'the same 400 every time: asked once, then stopped');
  assert.match(r2.sources.web.error!, /web search is not enabled for this organisation/);
  process.env.RESEARCH_WEB = 'false';
  const r3 = await runResearch(db, 'hte-web', { now, storage, provider: searcher, skipWeb: false, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  delete process.env.RESEARCH_WEB;
  assert.equal(r3.sources.web.queries, 0); assert.match(r3.sources.web.skipped!, /RESEARCH_WEB=false/);
  const r4 = await runResearch(db, 'hte-web', { now, storage, provider: null, skipWeb: false, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.match(r4.sources.web.skipped!, /no assistant configured/);
});

/* ── fields attached by name get their locations from the gazetteers ── */

test('the run locates fields attached by name: an exact gazetteer match sets the location and files the dossier, an area match is a proposal a person decides, an unknown field is named', async () => {
  await db.query("INSERT INTO assets (id,kind,name,country,operator,props,lat,lon,location_source,created_by) VALUES ('field:ve:oficina','field','Oficina','VE','Petrolera Vencupet',$1::jsonb,8.8778,-64.3669,'gem','chris')", [JSON.stringify({ gem: { unit_id: 'L100000305199', name: 'Oficina Oil Field', release: 'March 2026', wiki_url: 'https://www.gem.wiki/Oficina_Oil_Field_(Venezuela)' } })]);
  await db.query("INSERT INTO assets (id,kind,name,country,props,created_by) VALUES ('field:ve:yopales-central','field','Yopales Central','VE','{}'::jsonb,'chris'), ('field:ve:oficina-norte','field','OFICINA NORTE','VE','{}'::jsonb,'chris'), ('field:ve:esquina-r','field','ESQUINA R','VE','{}'::jsonb,'chris')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids) VALUES ('hte-loc','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:yopales-central,field:ve:oficina-norte,field:ve:esquina-r}')");
  const asked: string[] = [];
  const gaz = (async (url: string) => {
    const u = new URL(String(url)); asked.push(u.hostname + ' ' + (u.searchParams.get('name') ?? ''));
    if (u.hostname === 'secure.geonames.org' && u.searchParams.get('name') === 'Yopales Central') return Response.json({ geonames: [{ geonameId: 3625000, name: 'Yopales Central', countryCode: 'VE', lat: '8.6400', lng: '-64.5200', fcode: 'OILF', adminName1: 'Anzoátegui' }] });
    if (u.hostname === 'secure.geonames.org') return Response.json({ geonames: [] });
    return new Response('{}', { status: 404 });                               // wikidata: nothing
  }) as unknown as typeof fetch;
  const r = await runResearch(db, 'hte-loc', { now, storage, provider: null, skipLocate: false, locate: { fetch: gaz, geonamesUser: 'test' }, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(r.status, 'ok', JSON.stringify(r.warnings));
  assert.equal(r.sources.locate.queries, 3); assert.equal(r.sources.locate.created, 1, 'Yopales Central: exact GeoNames match, set'); assert.equal(r.sources.locate.findings, 1, 'Oficina Norte: area match on the GEM field Oficina, proposed');
  assert.deepEqual(r.unlocated, ['ESQUINA R']); assert.match(r.sources.locate.skipped!, /no gazetteer record for ESQUINA R/);
  const yop = (await db.query<any>("SELECT lat, lon, location_source, props FROM assets WHERE id = 'field:ve:yopales-central'")).rows[0];
  assert.equal(yop.lat, 8.64); assert.equal(yop.lon, -64.52); assert.equal(yop.location_source, 'geonames'); assert.equal(yop.props.geonames.id, '3625000');
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE project_id = 'hte-loc' AND external_id = 'geonames:3625000'")).rows[0].n, 1, 'the GeoNames dossier is filed');
  const on = (await db.query<any>("SELECT lat FROM assets WHERE id = 'field:ve:oficina-norte'")).rows[0];
  assert.equal(on.lat, null, 'an area match never sets a location by itself');
  const prop = (await db.query<any>("SELECT id, payload FROM review_queue WHERE kind = 'research' AND status = 'open' AND payload->>'fact_kind' = 'location' AND payload->>'project_id' = 'hte-loc'")).rows;
  assert.equal(prop.length, 1); assert.equal(prop[0].payload.asset_id, 'field:ve:oficina-norte'); assert.equal(prop[0].payload.candidate.source, 'gem'); assert.equal(prop[0].payload.candidate.lat, 8.8778);
  assert.match(prop[0].payload.proposal, /Location for OFICINA NORTE: Oficina \(gem\) at 8\.8778, -64\.3669, an area match/);
  const audit = (await db.query<any>("SELECT refs FROM audit_events WHERE action = 'research.run' AND scope = 'project:hte-loc' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.ok(audit.refs.includes('asset:field:ve:yopales-central'));
  // A re-run asks only for what is still unlocated and does not duplicate the open proposal.
  const again = await runResearch(db, 'hte-loc', { now, storage, provider: null, skipLocate: false, locate: { fetch: gaz, geonamesUser: 'test' }, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(again.sources.locate.queries, 2); assert.equal(again.sources.locate.created, 0);
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM review_queue WHERE kind = 'research' AND status = 'open' AND payload->>'fact_kind' = 'location' AND payload->>'project_id' = 'hte-loc'")).rows[0].n, 1);
  // Set location: the person accepts the area match; the field gets the coordinates and the GEM dossier.
  const ok = await call('POST', `/api/queue/review/${prop[0].id}/accept`, { apply: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.asset.id, 'field:ve:oficina-norte'); assert.equal(ok.body.asset.lat, 8.8778); assert.equal(ok.body.asset.location_source, 'gem'); assert.equal(ok.body.dossier.length, 1);
  const after = (await db.query<any>("SELECT lat, lon, location_source, props FROM assets WHERE id = 'field:ve:oficina-norte'")).rows[0];
  assert.equal(after.lon, -64.3669); assert.equal(after.props.gem.unit_id, 'L100000305199');
  const last = await runResearch(db, 'hte-loc', { now, storage, provider: null, skipLocate: false, locate: { fetch: gaz, geonamesUser: 'test' }, skipWorldMonitor: true, skipMiners: true, budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(last.sources.locate.queries, 1, 'only Esquina R is left');
});

test('while the literature pass runs, the job row carries the phase and the running count so the Hub can show progress', async () => {
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids) VALUES ('hte-live','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:guafita}')");
  const seen: { phase: string | undefined; findings: number }[] = [];
  const spy: FeedAdapter = { ...openalex, async *fetch(since, topics) {
    const row = (await db.query<any>("SELECT summary FROM jobs WHERE name = 'research' AND summary->>'project_id' = 'hte-live' ORDER BY id DESC LIMIT 1")).rows[0];
    seen.push({ phase: row.summary.phase, findings: row.summary.findings });
    yield* openalex.fetch(since, topics);
  } };
  configureWorldMonitor({ fetch: wmFetch, apiKey: null, now: () => new Date(t) });
  const r = await runResearch(db, 'hte-live', { now, storage, provider: null, minerAdapters: [spy], budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(r.status, 'ok');
  assert.deepEqual(seen, [{ phase: 'literature', findings: 0 }], 'the row said "literature" before the first paper was fetched');
  const row = (await db.query<any>("SELECT summary FROM jobs WHERE name = 'research' AND summary->>'project_id' = 'hte-live' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(row.summary.phase, 'done'); assert.equal(row.summary.findings, 1); assert.equal(row.summary.sources.literature.created, 1);
  configureWorldMonitor({ fetch: wmFetch, apiKey: KEY, now: () => new Date(t) });
});

test('without World Monitor the run says so and the literature still files', async () => {
  configureWorldMonitor({ fetch: wmFetch, apiKey: null, now: () => new Date(t) });
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids) VALUES ('hte-nowm','hte','High Tech Electronica','prospect','lt-firm','VE','{chris}','{field:ve:guafita}')");
  const r = await runResearch(db, 'hte-nowm', { now, storage, provider: null, minerAdapters: [openalex], budgetMs: 15 * 60_000, budgetGbp: 3, by: 'chris' });
  assert.equal(r.status, 'ok');
  assert.ok(r.warnings.some(w => /World Monitor not connected/.test(w)));
  assert.equal(r.sources.gdelt, undefined);
  assert.equal(r.sources.literature.created, 1);
  assert.equal(r.fact_reads, 0);
  configureWorldMonitor({ fetch: wmFetch, apiKey: KEY, now: () => new Date(t) });
});
