import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { itemRecord } from '../src/api/items.routes.ts';
import { runMiners, parseConfig, loadConfig, buildAdapters, ADAPTER_IDS, TOPICS_PATH } from '../src/miners/run.ts';
import { runWeeklyMiners } from '../src/jobs/miners.ts';
import { validate } from '../src/schemas.ts';
import { FakeProvider } from '../src/llm/provider.ts';
import { buildZip, fakeFetch, fx, mockClock, sha, testDb, text } from './miners.helpers.ts';

let db: Awaited<ReturnType<typeof testDb>>['db'];
let storage: Awaited<ReturnType<typeof testDb>>['storage'];
before(async () => { ({ db, storage } = await testDb()); });
after(async () => { await db.close(); });

const xlsx = (() => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Lote', 'Operador', 'bbl'], ['Lote 192', 'Altamesa', 100]]), 'Petroleo');
  return Buffer.from(new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
})();
const zip = buildZip([{ name: 'anp.csv', data: fx('anp-2026-03.csv') }]);

const cfg = () => parseConfig({
  topics: [], negative: [],
  sec_issuers: [{ cik: '1090012', name: 'Devon' }],
  sources: {
    'anh-co': { enabled: true }, 'ar-energia': { enabled: true }, 'sec-edgar': { enabled: true }, eia: { enabled: true },
    'anp-br': { enabled: true, url_template: 'https://example.test/anp/{month}.zip' },
    perupetro: { enabled: true, downloads: [{ id: 'oil', url: 'https://example.test/oil.xlsx', label: 'Perupetro oil' }] },
    'semantic-scholar': { enabled: false },
  },
});
let anhRows = JSON.parse(fx('anh-fdvb-hsrf.json'));
const world = () => {
  const clock = mockClock(Date.UTC(2026, 3, 10));
  return { clock, f: fakeFetch([
    [/datos\.gov\.co\/resource\/fdvb-hsrf/, () => anhRows],
    [/datos\.gov\.co\/resource\/5dux-bfvx/, () => fx('anh-5dux-bfvx.json')],
    [/datos\.gov\.co\/resource\/4dai-7crq/, () => text('{"error":true}', 403)],
    [/datos\.gob\.ar/, () => fx('ar-page1.json')],
    [/data\.sec\.gov/, () => fx('sec-companyfacts-devon.json')],
    [/api\.eia\.gov\/v2\/petroleum\/crd/, () => fx('eia-crude.json')],
    [/api\.eia\.gov/, () => ({ response: { data: [] } })],
    [/example\.test\/anp\/2026-03\.zip/, () => zip],
    [/example\.test\/anp\//, () => text('missing', 404)],
    [/example\.test\/oil\.xlsx/, () => xlsx],
  ], clock) };
};
const NOW = new Date('2026-04-10T06:00:00Z');
const run = (w = world(), extra = {}) => runMiners(db, { config: cfg(), fetch: w.f.fetch, clock: w.clock, storage, now: NOW, since: new Date('2025-07-01T00:00:00Z'), schedules: ['weekly', 'monthly'], env: { EIA_API_KEY: 'k' }, ...extra });
const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];

test('topics.json: three example topics, two SEC issuers, every adapter has an on/off flag', () => {
  const c = loadConfig(TOPICS_PATH);
  assert.equal(c.topics.length, 3);
  assert.deepEqual(c.topics.map(t => t.id), ['polymer-eor-heavy-oil', 'waterflood-conformance-llanos', 'orinoco-extra-heavy-recovery']);
  assert.ok(c.topics.every(t => t.query && t.keywords.length && t.negative.length));
  assert.equal(c.sec_issuers.length, 2);
  for (const id of ADAPTER_IDS) assert.equal(typeof c.sources[id]?.enabled, 'boolean', `sources.${id}.enabled`);
  assert.equal(buildAdapters(c).size, ADAPTER_IDS.length);
});

test('run: every regulator and agency record becomes a valid feed-snapshot item with a manifest', async () => {
  const s = await run();
  assert.deepEqual(s.warnings.filter(w => !/not available|skipped/.test(w)), []);
  assert.equal(s.created, 11);
  assert.deepEqual(Object.fromEntries(Object.entries(s.adapters).map(([k, v]) => [k, v.created])), { 'anh-co': 4, 'anp-br': 1, 'ar-energia': 2, perupetro: 1, 'sec-edgar': 1, eia: 2 });

  const rows = (await db.query<any>(`SELECT * FROM items WHERE type = 'feed-snapshot' ORDER BY external_id`)).rows;
  assert.equal(rows.length, 11);
  for (const row of rows) {
    const item = itemRecord(row);
    assert.deepEqual(validate('vault-item', item), [], row.external_id);
    assert.equal(row.legal_tag, 'lt-firm-public');
    assert.equal(row.project_id, 'firm');
    assert.equal(row.origin.source, 'regulator-feed');
    assert.ok(row.origin.url && row.origin.external_id && row.origin.fetched_at);
    const m = row.extracted.manifest;
    assert.deepEqual(Object.keys(m).sort(), ['fetched_at', 'rows', 'sha256', 'url']);
    assert.equal(m.fetched_at, NOW.toISOString());
    assert.equal(row.content_hash, `sha256:${m.sha256}`);
    const bytes = await storage.get(row.storage_key);
    assert.ok(bytes, 'the fetched payload is stored');
    assert.equal(sha(bytes!), m.sha256, 'manifest sha256 is the hash of the stored bytes');
    assert.equal(row.version, 1);
  }
  const anp = rows.find((r: any) => r.external_id === 'anp-br:producao-mensal-por-poco:2026-03');
  assert.equal(anp.mime, 'application/zip');
  assert.equal(anp.extracted.manifest.rows, 4);
  const anh = rows.find((r: any) => r.external_id === 'anh-co:fdvb-hsrf:2026-01');
  assert.equal(anh.extracted.manifest.rows, 3);
  assert.equal(anh.authored_at.toISOString(), '2026-01-01T00:00:00.000Z');
  const audit = await one(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'miners.run' AND person_id = 'miners'`);
  assert.equal(audit.n, 1);
  const job = await one(`SELECT status, summary FROM jobs WHERE name = 'miners'`);
  assert.equal(job.status, 'ok');
});

test('acceptance 2: re-running with no upstream change creates zero new items and zero new versions', async () => {
  const items = (await one('SELECT count(*)::int AS n FROM items')).n, versions = (await one('SELECT count(*)::int AS n FROM item_versions')).n;
  const s = await run(world(), { now: new Date('2026-04-17T06:00:00Z') });
  assert.equal(s.created, 0);
  assert.equal(s.updated, 0);
  assert.equal(s.unchanged, 11);
  assert.equal((await one('SELECT count(*)::int AS n FROM items')).n, items);
  assert.equal((await one('SELECT count(*)::int AS n FROM item_versions')).n, versions);
  const anh = await one(`SELECT extracted->'manifest'->>'fetched_at' AS at FROM items WHERE external_id = 'anh-co:fdvb-hsrf:2026-01'`);
  assert.equal(anh.at, NOW.toISOString(), 'an unchanged snapshot keeps its original manifest');
});

test('a revised upstream month becomes version 2 of the same item, never a second item and never an overwrite', async () => {
  const before = await one(`SELECT id, content_hash FROM items WHERE external_id = 'anh-co:fdvb-hsrf:2026-01'`);
  anhRows = anhRows.map((r: any) => (r.vigencia === '2026' ? { ...r, produccion_bls: '1.00' } : r));
  const s = await run(world(), { now: new Date('2026-05-01T06:00:00Z') });
  assert.equal(s.created, 0);
  assert.equal(s.updated, 1);
  const after = await one(`SELECT id, version, content_hash, extracted->'manifest'->>'fetched_at' AS at FROM items WHERE external_id = 'anh-co:fdvb-hsrf:2026-01'`);
  assert.equal(after.id, before.id);
  assert.equal(after.version, 2);
  assert.notEqual(after.content_hash, before.content_hash);
  assert.equal(after.at, '2026-05-01T06:00:00.000Z');
  const versions = (await db.query<any>('SELECT version, content_hash FROM item_versions WHERE item_id = $1 ORDER BY version', [before.id])).rows;
  assert.deepEqual(versions.map((v: any) => v.version), [1, 2]);
  assert.equal(versions[0].content_hash, before.content_hash, 'version 1 bytes are still addressable');
});

test('run: a source without its key is skipped with a reason, and one failing adapter does not stop the others', async () => {
  const w = world();
  const s = await run(w, { env: {}, only: ['eia', 'sec-edgar'] });
  assert.equal(s.adapters.eia.skipped, 'EIA_API_KEY not set');
  assert.equal(s.adapters['sec-edgar'].unchanged, 1);

  const clock = mockClock();
  const f = fakeFetch([[/datos\.gov\.co/, () => text('down', 500)], [/datos\.gob\.ar/, () => fx('ar-page1.json')]], clock);
  const bad = await runMiners(db, { config: cfg(), fetch: f.fetch, clock, storage, now: NOW, since: new Date('2025-07-01T00:00:00Z'), schedules: ['monthly'], only: ['anh-co', 'ar-energia'] });
  assert.match(bad.adapters['anh-co'].error!, /HTTP 500/);
  assert.equal(bad.adapters['ar-energia'].unchanged, 2);
  assert.equal((await one(`SELECT status FROM jobs ORDER BY id DESC LIMIT 1`)).status, 'failed');
});

test('run: disabled sources are not fetched, monthly sources wait for their schedule', async () => {
  const w = world();
  const s = await runMiners(db, { config: cfg(), fetch: w.f.fetch, clock: w.clock, storage, now: NOW, since: new Date('2025-07-01T00:00:00Z'), env: { EIA_API_KEY: 'k' } });
  assert.deepEqual(Object.keys(s.adapters).sort(), ['eia', 'sec-edgar']);
  assert.ok(!w.f.calls.some(c => /semanticscholar/.test(c.url)));
});

test('job: weekly entry runs the orchestrator, imports the radar ledger and extracts paper facts when a provider is given', async () => {
  const w = world();
  const r = await runWeeklyMiners(db, {
    config: cfg(), fetch: w.f.fetch, clock: w.clock, storage, now: NOW, since: new Date('2025-07-01T00:00:00Z'), env: { EIA_API_KEY: 'k' },
    provider: new FakeProvider(() => '{}'), includeMonthly: true,
  });
  assert.equal(r.miners.unchanged, 11 - 0, 'monthly feeds included and unchanged');
  assert.ok(r.radar.editions >= 1);
  assert.ok(r.radar.created >= 1, 'the checked-in ledger is imported');
  assert.equal(r.paper_facts?.extracted, 0, 'radar leads have no abstract to extract from');
  const again = await runWeeklyMiners(db, { config: cfg(), fetch: world().f.fetch, clock: world().clock, storage, now: NOW, since: new Date('2025-07-01T00:00:00Z'), env: { EIA_API_KEY: 'k' }, provider: null, includeMonthly: true });
  assert.equal(again.radar.created, 0);
  assert.equal(again.paper_facts, null);
});
