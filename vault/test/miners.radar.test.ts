import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { itemRecord } from '../src/api/items.routes.ts';
import { importRadarLedger, LEDGER_PATH, normUrl, readingList } from '../src/miners/radar-bridge.ts';
import { ensureMinerBase, itemFromRecord, upsertItem } from '../src/miners/run.ts';
import { validate } from '../src/schemas.ts';
import { testDb, tmpDir } from './miners.helpers.ts';

let db: Awaited<ReturnType<typeof testDb>>['db'];
let storage: Awaited<ReturnType<typeof testDb>>['storage'];
before(async () => { ({ db, storage } = await testDb()); await ensureMinerBase(db); });
after(async () => { await db.close(); });

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const distinctUrls = () => {
  const u = new Set<string>();
  for (const e of ledger.editions) { for (const d of e.developments) for (const x of d.urls) u.add(normUrl(x)); for (const s of e.sources ?? []) u.add(normUrl(s.url)); }
  return u;
};
const n = async (sql: string, p: unknown[] = []) => Number((await db.query<any>(sql, p)).rows[0].n);
const NOW = new Date('2026-09-29T08:00:00Z');
const IMPORTED = new Date('2026-07-31T08:00:00Z'); // earlier than the seeded week, so old imports do not crowd the reading list

test('the checked-in ledger imports as paper items: one per distinct URL, valid, tagged, deduplicated on re-import', async () => {
  const s = await importRadarLedger(db, { storage, now: IMPORTED });
  assert.equal(s.editions, ledger.editions.length);
  assert.equal(s.created, distinctUrls().size);
  assert.equal(await n(`SELECT count(*)::int AS n FROM items WHERE type = 'paper'`), distinctUrls().size);
  const rows = (await db.query<any>(`SELECT * FROM items WHERE type = 'paper'`)).rows;
  for (const r of rows) {
    assert.deepEqual(validate('vault-item', itemRecord(r)), [], r.origin.url);
    assert.equal(r.legal_tag, 'lt-public');
    assert.equal(r.project_id, 'firm');
    assert.equal(r.origin.source, 'assistant');
    assert.equal(r.external_id, r.origin.url);
    assert.match(r.extracted.radar.edition, /^\d{4}-\d{2}$/);
    assert.ok(r.tags.includes(`radar:${r.extracted.radar.edition}`));
    assert.equal(r.authored_at, null, 'the ledger records the edition date, not the paper date');
  }
  const meth = rows.find((r: any) => /acp\.copernicus\.org/.test(r.origin.url));
  assert.match(meth.title, /MethaneSAT/, 'a source entry title beats the development name');
  assert.equal(meth.extracted.radar.tier, 'E1');

  const again = await importRadarLedger(db, { storage, now: new Date('2026-08-30T08:00:00Z') });
  assert.equal(again.created, 0);
  assert.equal(again.existing, distinctUrls().size);
  assert.equal(await n(`SELECT count(*)::int AS n FROM items WHERE type = 'paper'`), distinctUrls().size);
});

test('dedupe by URL is across sources, spellings and editions', async () => {
  const dir = tmpDir('radar-');
  const file = path.join(dir, 'ledger.json');
  const miner = itemFromRecord('crossref', { external_id: '10.1000/xyz', url: 'https://www.example.org/paper/1/', title: 'A paper the miners already found', authored_at: null, authors: [], text: 'x', meta: { doi: '10.1000/xyz' } }, IMPORTED);
  await upsertItem(db, storage, miner, IMPORTED);
  writeFileSync(file, JSON.stringify({ editions: [
    { edition: '2026-08', developments: [{ name: 'Dev A', discipline: 'Drilling', tier: 'E2', readiness: 1, urls: ['https://example.org/paper/1?utm_source=newsletter#top', 'https://example.org/new-one'] }] },
    { edition: '2026-09', developments: [{ name: 'Dev A again', urls: ['https://example.org/new-one/'] }], sources: [{ title: 'New one, properly titled', url: 'https://example.org/new-one', tier: 'E2' }] },
  ] }));
  const before = await n(`SELECT count(*)::int AS n FROM items WHERE type = 'paper'`);
  const s = await importRadarLedger(db, { ledgerPath: file, storage, now: IMPORTED });
  assert.equal(s.created, 1, 'only example.org/new-one is new');
  assert.equal(s.existing, 2);
  assert.equal(await n(`SELECT count(*)::int AS n FROM items WHERE type = 'paper'`), before + 1);
  assert.equal(await n(`SELECT count(*)::int AS n FROM items WHERE origin->>'url' LIKE '%example.org/paper/1%'`), 1);
  assert.equal(normUrl('https://WWW.Example.org/a/b/?utm_medium=x&q=1#frag'), 'example.org/a/b?q=1');
  assert.deepEqual(await importRadarLedger(db, { ledgerPath: path.join(dir, 'missing.json'), storage }), { editions: 0, urls: 0, created: 0, existing: 0, updated: 0 });
});

test('acceptance 5: on a seeded week the skill reads its reading list from the Vault', async () => {
  const day = (d: number) => new Date(Date.UTC(2026, 8, d, 9));
  const paper = (id: string, title: string, when: Date, over: any = {}) => upsertItem(db, storage, {
    ...itemFromRecord('semantic-scholar', { external_id: id, url: `https://www.semanticscholar.org/paper/${id}`, title, authored_at: '2026-09-01T00:00:00.000Z', authors: ['Q. Writer'], text: 'An abstract.', meta: { doi: `10.5555/${id}`, topic_id: 'polymer-eor-heavy-oil' } }, when), ...over,
  }, when);
  await paper('wk1', 'Monday paper on polymer flooding', day(21));
  await paper('wk2', 'Wednesday paper on conformance', day(23));
  const late = await paper('wk3', 'Friday paper on Orinoco recovery', day(25));
  await paper('old', 'Paper from before the week', new Date(Date.UTC(2026, 7, 1)));
  await db.query(`INSERT INTO organisations (id, name, kind) VALUES ('frontera', 'Frontera Energy', 'client')`);
  await db.query(`INSERT INTO legal_tags (id, classification, data_type, client_id, originator) VALUES ('lt-frontera-nda', 'client-nda', 'second-party', 'frontera', 'Frontera')`);
  await db.query(`INSERT INTO legal_tags (id, classification, data_type, originator, partners_only) VALUES ('lt-firm-po', 'firm', 'first-party', 'ATC', true)`);
  await paper('nda', 'Client confidential paper', day(24), { legal_tag: 'lt-frontera-nda' });
  await paper('po', 'Partners only paper', day(24), { legal_tag: 'lt-firm-po' });
  await paper('hid', 'Withdrawn paper', day(24));
  await db.query(`UPDATE items SET hidden = true WHERE external_id = 'hid'`);

  const list = await readingList(db, new Date(Date.UTC(2026, 8, 21)), { now: NOW });
  assert.deepEqual(list.map(x => x.title), ['Friday paper on Orinoco recovery', 'Wednesday paper on conformance', 'Monday paper on polymer flooding']);
  assert.equal(list[0].id, late.id);
  assert.equal(list[0].url, 'https://www.semanticscholar.org/paper/wk3');
  assert.equal(list[0].doi, '10.5555/wk3');
  assert.equal(list[0].source, 'semantic-scholar');
  assert.equal(list[0].topic_id, 'polymer-eor-heavy-oil');
  assert.equal(list[0].legal_tag, 'lt-public');
  assert.deepEqual(list[0].authors, ['Q. Writer']);
  assert.ok(!list.some(x => /Client confidential|Partners only|Withdrawn/.test(x.title)), 'nothing outside the firm scope, nothing hidden');
  assert.equal((await readingList(db, day(21).toISOString(), { limit: 2, now: NOW })).length, 2);
  assert.ok((await readingList(db, new Date(Date.UTC(2026, 7, 1)), { now: NOW })).some(x => x.title === 'Paper from before the week'));
  assert.ok((await readingList(db, new Date(Date.UTC(2026, 0, 1)), { now: NOW })).some(x => x.source === 'assistant'), 'radar ledger leads are on the list too');
  await assert.rejects(readingList(db, 'not a date'), /since must be a date/);
});
