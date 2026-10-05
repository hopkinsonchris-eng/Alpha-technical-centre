// Wave 7, PR 1 (docs/vault-hub/wave7/05-markup.md §1.6, S17): the literature query is built from the
// project's basin and field names and the country, never from an organisation or counterparty name;
// the papers filed per run are capped, and the ones that name the basin or field are kept first; the
// abstract travels into the finding's `extracted` so the record panel can show it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-research-queries-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { filesystemStorage } = await import('../src/storage.ts');
const { configureLocate } = await import('../src/assets/gazetteers.ts');
const { configureWorldMonitor } = await import('../src/intel/worldmonitor.ts');
const { buildQueries, geologyNames, LITERATURE_CAP } = await import('../src/research/queries.ts');
const { runResearch, researchView } = await import('../src/research/run.ts');
import type { FeedAdapter, FeedRecord } from '../src/miners/types.ts';
type Db = Awaited<ReturnType<typeof openDb>>;

const ORGS = /Ecopetrol|Frontera|Hocol|MinEnergía|ANH|Petroperú/;
const project = { id: 'llanos-screen', name: 'Llanos screen', country: 'CO', client_name: 'Frontera Energy',
  register: { holder: 'Ecopetrol', government: 'MinEnergía / ANH', partners: ['Frontera Energy [50%]', 'Hocol'], thesis: 'ZEBRAWORD never searched', basin: 'Llanos Orientales' } };
const cubiro = { id: 'field:llanos:cubiro', name: 'Cubiro', kind: 'field', country: 'CO', operator: 'Ecopetrol', basin: 'Llanos', props: { gem: { name: 'Cubiro', operator: 'Ecopetrol [100%]', owners: 'Ecopetrol (100%)', basin: 'Llanos Basin' } } };
const llanos = { id: 'basin:llanos', name: 'Llanos', kind: 'basin', country: 'CO', operator: null, basin: null, props: {} };

test('S17: the literature topics name the basin, the field and the country; no organisation or counterparty is ever a literature query', () => {
  const q = buildQueries(project, [cubiro, llanos], 'Colombia');
  const lit = JSON.stringify(q.literature);
  assert.ok(!ORGS.test(lit), 'no organisation name in any literature query, keyword or context: ' + lit);
  assert.ok(!/ZEBRAWORD/.test(lit));
  assert.ok(!q.literature.some(t => t.id.includes(':co:')), 'no per-company literature topic');
  const field = q.literature.find(t => t.id === 'research:llanos-screen:field:llanos:cubiro')!;
  assert.equal(field.query, 'Cubiro field Colombia reservoir');
  assert.ok(field.context!.includes('Colombia') && field.context!.includes('Llanos'), 'the basin is context for a field paper: ' + JSON.stringify(field.context));
  const basin = q.literature.find(t => t.id === 'research:llanos-screen:basin:llanos')!;
  assert.equal(basin.query, 'Llanos basin Colombia petroleum geology');
  assert.ok(basin.keywords.includes('Llanos') && basin.strict === true);
  assert.deepEqual(geologyNames([cubiro, llanos], project.register), ['Llanos', 'Llanos Basin', 'Llanos Orientales']);
  // World Monitor still looks the companies up: that is a company search, not the literature.
  assert.ok(q.companies.includes('Ecopetrol') && q.companies.includes('Frontera Energy'));
  // A project with no field and no basin searches no literature at all.
  assert.deepEqual(buildQueries({ ...project, register: null }, [], 'Colombia').literature, []);
});

test('S17: a register basin name alone is enough for one literature topic', () => {
  const q = buildQueries({ ...project, register: { basin: 'Putumayo' } }, [], 'Colombia');
  assert.equal(q.literature.length, 1);
  assert.equal(q.literature[0].query, 'Putumayo basin Colombia petroleum geology');
  assert.ok(!ORGS.test(JSON.stringify(q.literature)));
});

/* ── the cap: a run that is offered thirty papers files a handful, the ones naming the basin or field first ── */

let db: Db;
const storage = filesystemStorage(mkdtempSync(path.join(os.tmpdir(), 'vault-research-queries-store-')));
before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO assets (id,kind,name,country,props,created_by) VALUES ('basin:llanos-t','basin','Llanos','CO','{}'::jsonb,'chris') ON CONFLICT (id) DO NOTHING");
  await db.query("INSERT INTO assets (id,kind,name,parent_id,country,operator,props,lat,lon,location_source,created_by) VALUES ('field:llanos:cubiro-t','field','Cubiro','basin:llanos-t','CO','Ecopetrol',$1::jsonb,4.9,-72.4,'gem','chris')", [JSON.stringify({ gem: { name: 'Cubiro', operator: 'Ecopetrol [100%]' } })]);
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members,asset_ids,register) VALUES ('llanos-cap',NULL,'Llanos cap','prospect','lt-firm','CO','{chris}','{field:llanos:cubiro-t}',$1::jsonb)", [JSON.stringify({ holder: 'Ecopetrol', partners: ['Frontera Energy'] })]);
  configureLocate({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });
  configureWorldMonitor({ fetch: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch, apiKey: null, now: () => new Date() });
});
after(async () => { await db.close(); });

const asked: string[] = [];
const paper = (i: number, title: string, text: string, topic: string): FeedRecord => ({ external_id: `W${i}`, url: `https://openalex.org/W${i}`, title, authored_at: '2015-03-01T00:00:00Z', authors: ['A. Pérez'], text, meta: { topic_id: topic } });
/** Thirty papers that all pass the screen (each names the field and is about oil): only a few also name the basin. */
const flood: FeedAdapter = { id: 'openalex', schedule: 'weekly', rateLimit: { perSecond: 10 }, async *fetch(_s, topics) {
  for (const t of topics) asked.push(t.query);
  const topic = topics.find(t => t.id.endsWith(':field:llanos:cubiro-t'))!;
  // Distinct titles: the miners drop near-duplicate titles, which is not what this test is about.
  const subjects = ['corrosion liner', 'ESP run life', 'sand control', 'water cut forecast', 'polymer injection', 'PVT sampling', 'casing wear', 'scale inhibitor', 'gas lift design', 'flow assurance',
    'well spacing', 'infill drilling', 'history match', 'pressure transient', 'tracer survey', 'emulsion treatment', 'heavy crude viscosity', 'artificial lift', 'produced water', 'wax deposition',
    'perforation design', 'sucker rod pumping', 'core analysis', 'log interpretation', 'fault seal', 'seismic attributes', 'aquifer support', 'bubble point', 'decline curve', 'surface facilities'];
  for (let i = 1; i <= 30; i++) {
    const basin = i % 10 === 0;
    yield paper(i, basin ? `Llanos basin reservoir geology at the Cubiro field: ${subjects[i - 1]} in the foreland` : `${subjects[i - 1]} study for the Cubiro oil field`, `Abstract ${i}: ${basin ? 'the Cubiro field in the Llanos basin' : 'the Cubiro oil field'} is discussed.`, topic.id);
  }
} };

test('S17: at most LITERATURE_CAP papers are filed per run, basin-naming ones first, and each carries its abstract', async () => {
  assert.ok(LITERATURE_CAP >= 5 && LITERATURE_CAP <= 12, 'a sensible cap: ' + LITERATURE_CAP);
  const r = await runResearch(db, 'llanos-cap', { storage, provider: null, minerAdapters: [flood], skipWorldMonitor: true, skipGemWiki: true, skipWeb: true, skipLocate: true, budgetMs: 15 * 60_000, budgetGbp: 1, log: () => {}, progressEveryMs: 0 });
  assert.equal(r.status, 'ok', JSON.stringify(r.warnings));
  assert.ok(!asked.some(q => ORGS.test(q)), 'the adapter was never asked about an organisation: ' + JSON.stringify(asked));
  assert.equal(r.sources.literature.findings, 30, 'what the sources answered is still counted');
  assert.equal(r.sources.literature.created, LITERATURE_CAP, 'what was filed is capped');
  assert.match(r.sources.literature.skipped ?? '', /20 more/);
  const filed = (await db.query<any>("SELECT title, extracted FROM items WHERE project_id = 'llanos-cap' AND type = 'paper' ORDER BY title")).rows;
  assert.equal(filed.length, LITERATURE_CAP);
  assert.equal(filed.filter(f => /Llanos basin/.test(f.title)).length, 3, 'the three papers that name the basin are all kept');
  for (const f of filed) assert.match(f.extracted.abstract, /^Abstract \d+:/, 'the abstract is in extracted for the record panel');
  const view = await researchView(db, 'llanos-cap');
  assert.equal(view.findings.length, LITERATURE_CAP);
  assert.ok(view.findings.every(f => /^Abstract/.test(f.quote ?? '')), 'the Research tab quotes the abstract');
});
