import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PaperIndex, jaccard, parseConfig, runMiners, screenPaper, titleTokens, type MinersConfig } from '../src/miners/run.ts';
import type { FeedAdapter, FeedRecord } from '../src/miners/types.ts';
import { fakeFetch, fx, mockClock, testDb } from './miners.helpers.ts';

let db: Awaited<ReturnType<typeof testDb>>['db'];
let storage: Awaited<ReturnType<typeof testDb>>['storage'];
before(async () => { ({ db, storage } = await testDb()); });
after(async () => { await db.close(); });

const cfg = (over: Partial<MinersConfig> = {}): MinersConfig => parseConfig({
  topics: [{ id: 'polymer-eor', query: 'polymer flooding heavy oil', keywords: ['polymer', 'heavy oil'], negative: ['hydrogel wound'] }],
  sec_issuers: [], negative: ['retracted'],
  sources: { 'semantic-scholar': { enabled: true, page_size: 2 }, crossref: { enabled: true, page_size: 2 }, openalex: { enabled: true, page_size: 2 } },
  ...over,
});
const NOW = new Date('2026-09-29T06:00:00Z');
const routes = () => {
  const clock = mockClock();
  const f = fakeFetch([
    [/api\.semanticscholar\.org\/recommendations/, () => ({ recommendedPapers: [] })],
    [/search\/bulk\?.*token=NEXTTOKEN/, () => fx('s2-bulk-page2.json')],
    [/search\/bulk\?/, () => fx('s2-bulk-page1.json')],
    [/api\.crossref\.org.*cursor=AoJ2NEXTCURSOR/, () => fx('crossref-page2.json')],
    [/api\.crossref\.org/, () => fx('crossref-page1.json')],
    [/api\.openalex\.org.*cursor=CUR2/, () => fx('openalex-page2.json')],
    [/api\.openalex\.org/, () => fx('openalex-page1.json')],
  ], clock);
  return { clock, f };
};
const scalar = async (sql: string, p: unknown[] = []) => Number((await db.query<any>(sql, p)).rows[0].n);
const papers = () => scalar("SELECT count(*)::int AS n FROM items WHERE type = 'paper'");

test('titles: normalisation ignores case, accents, punctuation; Jaccard over tokens', () => {
  const a = titleTokens('Polymer Flooding Pilot in a Heavy-Oil Reservoir.');
  const b = titleTokens('polymer flooding pilot in a heavy oil reservoir');
  assert.equal(jaccard(a, b), 1);
  assert.equal(jaccard(titleTokens('Inyección de polímeros'), titleTokens('Inyeccion de polimeros')), 1);
  assert.equal(jaccard(new Set(['a']), new Set()), 0);
  const ten = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
  assert.ok(jaccard(titleTokens(ten), titleTokens(`${ten} lambda`)) >= 0.9, '10 of 11 tokens is 0.909');
  assert.ok(jaccard(titleTokens(ten), titleTokens(`${ten} lambda mu`)) < 0.9, '10 of 12 tokens is 0.833');
});

test('index: DOI, external id and fuzzy title each catch a duplicate from another source; the same source and id is a version, not a duplicate', () => {
  const idx = new PaperIndex();
  idx.add({ id: '1', source: 'crossref', external_id: '10.1000/abc.1', title: 'Water Alternating Gas Injection in Heavy Oil Sands of the Llanos Basin' });
  idx.add({ id: '2', source: 'openalex', external_id: 'W99', title: 'Short' });
  assert.equal(idx.find('openalex', { external_id: 'W5', title: 'Unrelated', doi: 'https://doi.org/10.1000/ABC.1' })?.reason, 'doi');
  assert.equal(idx.find('semantic-scholar', { external_id: 'W99', title: 'Other words entirely here' })?.reason, 'external_id');
  assert.equal(idx.find('semantic-scholar', { external_id: 'x', title: 'Water-alternating gas injection in heavy oil sands of the Llanos basin!' })?.reason, 'title');
  assert.equal(idx.find('crossref', { external_id: '10.1000/abc.1', title: 'Water Alternating Gas Injection in Heavy Oil Sands of the Llanos Basin' }), null);
  assert.equal(idx.find('openalex', { external_id: 'y', title: 'Short' }), null, 'titles under three tokens are never fuzzy-matched');
  assert.equal(idx.find('openalex', { external_id: 'z', title: 'Water alternating gas injection in a different basin altogether now' }), null);
});

test('screen: negative keywords (topic and global) drop a record, keywords keep on-topic text, records without text are kept', () => {
  const c = cfg();
  const rec = (title: string, text?: string, topic_id = 'polymer-eor'): FeedRecord => ({ external_id: title, url: 'u', title, authored_at: null, authors: [], text, meta: { topic_id } });
  assert.equal(screenPaper(rec('Hydrogel wound dressing', 'A polymer network'), c), 'negative');
  assert.equal(screenPaper(rec('Polymer flooding', 'This paper is RETRACTED by the authors'), c), 'negative');
  assert.equal(screenPaper(rec('Cold production', 'Sand production recovers bitumen in the Orinoco'), c), 'off-topic');
  assert.equal(screenPaper(rec('Polymers for mobility control', 'Polymers are injected'), c), 'keep', 'keyword matches inside longer words');
  assert.equal(screenPaper(rec('Something with no abstract'), c), 'keep');
  assert.equal(screenPaper(rec('Recommendation without topic', 'hydrogel wound', undefined as any), c), 'negative');
  // A research run's topics are strict: a record that names no topic (a Semantic Scholar recommendation) is kept only when a strict topic would keep it.
  const strict: MinersConfig = { ...cfg(), topics: [{ id: 'r:guafita', query: 'Guafita field', keywords: ['guafita'], negative: [], strict: true, context: ['oil', 'venezuela'] }] };
  assert.equal(screenPaper(rec('Leptin and obesity: a review', 'Serum leptin in adults', undefined as any), strict), 'off-topic');
  assert.equal(screenPaper(rec('Waterflood performance of the Guafita field, Venezuela', undefined, undefined as any), strict), 'keep');
});

test('run: three literature sources, one paper found by DOI in all three becomes one item; negative and off-topic records are dropped', async () => {
  const { clock, f } = routes();
  const s = await runMiners(db, { config: cfg(), fetch: f.fetch, clock, storage, now: NOW, since: new Date('2026-08-01T00:00:00Z'), env: {} });
  // S2: pilot(kept), hydrogel(negative), conformance(no abstract, kept)   Crossref: Daqing review, Effect of initial water flooding, pilot (duplicate DOI)
  // OpenAlex: Orinoco cold production (kept: mentions heavy oil), pilot (duplicate DOI), steam (off-topic)
  assert.equal(s.adapters['semantic-scholar'].created, 2);
  assert.equal(s.adapters['semantic-scholar'].negative, 1);
  assert.equal(s.adapters.crossref.fetched, 3);
  assert.equal(s.adapters.crossref.duplicates, 1);
  assert.equal(s.adapters.crossref.created, 2);
  assert.equal(s.adapters.openalex.duplicates, 1);
  assert.equal(s.adapters.openalex.off_topic, 1, 'the steam paper has no polymer or heavy-oil keyword');
  assert.equal(s.adapters.openalex.created, 1, 'the Orinoco paper mentions heavy oil and is new');
  assert.equal(await papers(), 5);
  assert.equal(await scalar(`SELECT count(*)::int AS n FROM items WHERE extracted->>'doi' = '10.2118/999001-ms'`), 1);
  const stored = (await db.query<any>(`SELECT origin, legal_tag, project_id, type FROM items WHERE extracted->>'doi' = '10.2118/999001-ms'`)).rows[0];
  assert.equal(stored.origin.source, 'semantic-scholar', 'the first source to see a paper owns it');
  assert.equal(stored.legal_tag, 'lt-public');
  assert.equal(stored.project_id, 'firm');
});

test('run: fuzzy title duplicates across sources are dropped even without a DOI', async () => {
  const before = await papers();
  const fake: FeedAdapter = {
    id: 'openalex', schedule: 'weekly', rateLimit: { perSecond: 5 },
    async *fetch() {
      yield { external_id: 'W777', url: 'https://example.org/W777', title: 'Effect of initial waterflooding on the performance of polymer flooding for heavy oil production', authored_at: null, authors: [], text: 'Polymer flooding heavy oil study.', meta: {} };
      yield { external_id: 'W778', url: 'https://example.org/W778', title: 'A wholly new heavy oil polymer study of the Chichimene field', authored_at: null, authors: [], text: 'Polymer for heavy oil.', meta: {} };
    },
  };
  // 'waterflooding' vs 'water flooding' differ as tokens, so the first title is a near miss (kept); the second is new.
  const s = await runMiners(db, { config: cfg(), adapters: [fake], storage, now: NOW, force: true });
  assert.equal(s.adapters.openalex.duplicates + s.adapters.openalex.created, 2);
  const fake2: FeedAdapter = { ...fake, async *fetch() {
    yield { external_id: 'W900', url: 'https://example.org/W900', title: 'Effect of initial water flooding on the performance of polymer flooding for heavy oil production.', authored_at: null, authors: [], text: 'Polymer flooding heavy oil.', meta: {} };
  } };
  const s2 = await runMiners(db, { config: cfg(), adapters: [fake2], storage, now: NOW, force: true });
  assert.equal(s2.adapters.openalex.duplicates, 1, 'punctuation and case do not defeat the title match');
  assert.equal(await papers(), before + s.adapters.openalex.created);
});

test('acceptance 2: re-running with no upstream change creates and updates nothing', async () => {
  const items = await scalar('SELECT count(*)::int AS n FROM items');
  const versions = await scalar('SELECT count(*)::int AS n FROM item_versions');
  const { clock, f } = routes();
  const s = await runMiners(db, { config: cfg(), fetch: f.fetch, clock, storage, now: new Date(NOW.getTime() + 7 * 86400_000), since: new Date('2026-08-01T00:00:00Z'), env: {} });
  assert.equal(s.created, 0);
  assert.equal(s.updated, 0);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM items'), items);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM item_versions'), versions);
});

test('run: a research run (project set) searches by topic only and never asks for recommendations seeded from the whole Vault', async () => {
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('hte','High Tech Electronica','client','VE') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('p-research','hte','P','active','lt-firm','VE','{chris}') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO items (id, type, title, created_at, authors, project_id, legal_tag, origin, external_id, content_hash, version, extracted, tags) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','paper','Seed paper','2026-09-01T00:00:00Z','{}','p-research','lt-public','{\"source\":\"semantic-scholar\",\"external_id\":\"s2seed\"}'::jsonb,'s2seed','sha256:seed',1,'{}'::jsonb,'{}')");
  const { clock, f } = routes();
  await runMiners(db, { config: cfg(), fetch: f.fetch, clock, storage, now: NOW, since: new Date('2026-08-01T00:00:00Z'), env: {}, only: ['semantic-scholar'], force: true, projectId: 'p-research', queryOf: () => 'polymer flooding heavy oil' });
  assert.ok(f.calls.length >= 1 && f.calls.every(c => !/recommendations/.test(c.url)), 'no recommendation call: ' + f.calls.map(c => c.url).join(' '));
  const { clock: c2, f: f2 } = routes();
  await runMiners(db, { config: cfg(), fetch: f2.fetch, clock: c2, storage, now: NOW, since: new Date('2026-08-01T00:00:00Z'), env: {}, only: ['semantic-scholar'], force: true });
  assert.ok(f2.calls.some(c => /recommendations/.test(c.url)), 'the firm-wide weekly run still asks for recommendations');
});
