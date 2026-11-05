import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { countPapers, refreshCitations } from '../src/jobs/tech-citations.ts';
import { insertEntry } from '../src/technology/store.ts';
import { EntryBody } from '../src/technology/model.ts';

const noSleep = async () => {};
const body = (name: string, q?: string) => EntryBody.parse({
  application: 'water-handling', name, summary: 'A water handling technology summary.', readiness: 4,
  evidence: [{ claim: 'c', tier: 'E2', source: 'https://example.org' }], scores: { capex: 3, opex: 3, benefit: 3, evidence: 3 }, ...(q ? { citation_query: q } : {}),
});
/** A fake Semantic Scholar: total depends on the query and the year; `fail` answers 429 for those queries. */
function fakeS2(fail = new Set<string>()) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    const u = new URL(url); const q = u.searchParams.get('query')!; const y = u.searchParams.get('year')!;
    calls.push(`${q}|${y}`);
    if (fail.has(q)) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ total: q.length * (y === '2016-' ? 10 : 4), data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('countPapers reads total, retries 429 and gives up with a reason', async () => {
  let n = 0;
  const flaky = (async () => (++n < 3 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ total: 42 }), { status: 200 }))) as unknown as typeof fetch;
  assert.equal(await countPapers('"plunger lift"', 2016, { fetch: flaky, sleep: noSleep }), 42);
  assert.equal(n, 3);
  await assert.rejects(countPapers('x', 2016, { fetch: (async () => new Response('', { status: 429 })) as any, sleep: noSleep, maxTries: 3 }), /gave up after 3 tries \(HTTP 429\)/);
  await assert.rejects(countPapers('x', 2016, { fetch: (async () => new Response('', { status: 400 })) as any, sleep: noSleep }), /HTTP 400/);
});

test('the job appends one row per counted key, never edits an entry, and reports failures (AC8)', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  const now = new Date('2026-12-02T05:30:00Z');
  const a = (await insertEntry(db, body('Hydrocyclones', '"deoiling hydrocyclone"'), { author: 'chris', status: 'confirmed', now })).row;
  await insertEntry(db, body('Flotation', '"induced gas flotation"'), { author: 'chris', status: 'confirmed', now });
  await insertEntry(db, body('No query yet'), { author: 'chris', status: 'confirmed', now });
  await insertEntry(db, body('A proposal', '"proposal"'), { author: 'ana', status: 'proposed', now });
  const before = (await db.query('SELECT id, record, status, superseded_by FROM tech_entries ORDER BY id')).rows;

  const { f, calls } = fakeS2(new Set(['"induced gas flotation"']));
  const s = await refreshCitations(db, { fetch: f, sleep: noSleep, maxTries: 2, now });
  assert.equal(s.keys, 3, 'only current confirmed entries are counted');
  assert.equal(s.counted, 1); assert.deepEqual(s.skipped, ['WH03']); assert.equal(s.failed.length, 1); assert.equal(s.failed[0].key, 'WH02');
  assert.ok(!calls.some(c => c.startsWith('"proposal"')));
  const rows = (await db.query('SELECT key, query, source, since_2016, since_2023, counted_by FROM tech_citations')).rows;
  assert.deepEqual(rows, [{ key: a.key, query: '"deoiling hydrocyclone"', source: 'semantic-scholar', since_2016: 230, since_2023: 92, counted_by: 'job:tech-citations' }]);
  assert.deepEqual((await db.query('SELECT id, record, status, superseded_by FROM tech_entries ORDER BY id')).rows, before, 'entries are untouched');

  // A second month appends, and an entry without its own query reuses the query of its last count.
  await db.query("INSERT INTO tech_citations (id, key, query, source, since_2016, since_2023, counted_by) VALUES (gen_random_uuid(), 'WH03', '\"imported query\"', 'import', 1, 1, 'import:x')");
  const s2 = await refreshCitations(db, { fetch: fakeS2().f, sleep: noSleep, now: new Date('2027-01-02T05:30:00Z') });
  assert.equal(s2.counted, 3); assert.equal(s2.failed.length, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM tech_citations WHERE key = 'WH03' AND source = 'semantic-scholar'")).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_citations')).rows[0].n, 5);
  await db.close();
});

test('with the network down nothing is recorded and every key is reported failed (AC8)', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await insertEntry(db, body('Hydrocyclones', '"deoiling hydrocyclone"'), { author: 'chris', status: 'confirmed', now: new Date() });
  const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  const s = await refreshCitations(db, { fetch: down, sleep: noSleep, maxTries: 2 });
  assert.equal(s.counted, 0); assert.equal(s.failed.length, 1); assert.match(s.failed[0].error, /ECONNREFUSED/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_citations')).rows[0].n, 0);
  await db.close();
});
