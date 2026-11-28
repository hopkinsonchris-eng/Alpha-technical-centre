// 28 Nov 2026: a large spreadsheet keeps every slice for word search and embeds only its first slices; search returns one hit per file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { capEmbeddings, embedLimit, EMBED_CAP, EMBEDDED_INDEX } from '../src/ingest/embed-cap.ts';
import { FakeEmbedder, vectorLiteral } from '../src/ingest/embed.ts';
import { configureSearch } from '../src/gateway/index.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';

let h: Harness;
const P = 'orinoco-partnership';
const fake = new FakeEmbedder();
before(async () => { h = await setup('vault-embedcap-'); configureSearch({ embed: async (t) => (await fake.embed([t]))[0], maxDistance: fake.maxDistance }); });
after(async () => { configureSearch({}); await h.db.close(); });

/** An indexed file as the indexer leaves it: an item with format and chunk count, and its chunks, all embedded. */
async function file(title: string, format: string, n: number, text: (i: number) => string, hash: string = randomUUID()): Promise<string> {
  const id = randomUUID();
  const { default_legal_tag: lt, client_id: cid } = (await h.db.query<any>('SELECT default_legal_tag, client_id FROM projects WHERE id = $1', [P])).rows[0];
  await h.db.query(`INSERT INTO items (id, type, title, legal_tag, project_id, storage_key, origin, extracted, created_at, content_hash, client_id) VALUES ($1::uuid, 'spreadsheet', $2, $3, $4, $5, '{}'::jsonb, $6::jsonb, now(), $7, $8)`,
    [id, title, lt, P, `originals/${id}`, JSON.stringify({ format, chunks: n, ingest: { version: 1, status: 'ok' } }), hash, cid]);
  for (let i = 0; i < n; i++) {
    const [e] = await fake.embed([text(i)]);
    await h.db.query('INSERT INTO chunks (item_id, item_version, ordinal, text, legal_tag, project_id, embedding, client_id) VALUES ($1::uuid, 1, $2, $3, $4, $5, $6::vector, $7)', [id, i, text(i), lt, P, vectorLiteral(e), cid]);
  }
  return id;
}
const counts = async (id: string) => (await h.db.query<any>('SELECT count(*)::int AS n, count(embedding)::int AS e, coalesce(max(ordinal) FILTER (WHERE embedding IS NOT NULL), -1) AS last FROM chunks WHERE item_id = $1::uuid', [id])).rows[0];
const search = async (q: string) => ((await (await h.app.request(`/api/search?q=${encodeURIComponent(q)}&scope=project:${P}&k=50`)).json()) as any);

test('the cap applies to large spreadsheets and CSVs only', () => {
  assert.equal(embedLimit('xlsx', 25042), EMBED_CAP.keep);
  assert.equal(embedLimit('csv', 101), EMBED_CAP.keep);
  assert.equal(embedLimit('xlsx', 100), 100);
  assert.equal(embedLimit('pdf', 5000), 5000);
});

test('clearing keeps every row and the first slices\' embeddings, leaves other files alone, is resumable and idempotent', async () => {
  const big = await file('Workover A.xlsx', 'xlsx', 130, i => `workover day ${i} zebrafinch${i} tubing pulled`);
  const big2 = await file('Workover B.csv', 'csv', 120, i => `completion day ${i} quokka${i} packer set`);
  const small = await file('Small.xlsx', 'xlsx', 60, i => `small sheet row ${i}`);
  const report = await file('Long report.pdf', 'pdf', 140, i => `report page ${i} narrative`);

  // A run with no time left clears nothing and builds nothing.
  let t = 0;
  const none = await capEmbeddings(h.db, { budgetMs: 10, now: () => (t += 100) });
  assert.equal(none.files, 0); assert.equal(none.left_files, 2); assert.equal(none.index, 'waiting');

  // A run that is cut off part way through a file leaves it for the next, which finishes it.
  let calls = 0;
  const part = await capEmbeddings(h.db, { budgetMs: 5, batchRows: 30, now: () => (calls++ < 4 ? 0 : 100) });
  assert.equal(part.files, 0); assert.ok(part.cleared > 0 && part.cleared < 90, JSON.stringify(part));
  const done = await capEmbeddings(h.db, { batchRows: 30 });
  assert.equal(done.error ?? '', '');
  assert.equal(done.files, 2); assert.equal(done.left_files, 0); assert.equal(done.index, 'built');
  assert.equal(part.cleared + done.cleared, (130 - 40) + (120 - 40));

  assert.deepEqual(await counts(big), { n: 130, e: 40, last: 39 });
  assert.deepEqual(await counts(big2), { n: 120, e: 40, last: 39 });
  assert.deepEqual(await counts(small), { n: 60, e: 60, last: 59 });
  assert.deepEqual(await counts(report), { n: 140, e: 140, last: 139 });
  assert.equal((await h.db.query<any>(`SELECT extracted->'embed_cap'->>'keep' AS k FROM items WHERE id = $1::uuid`, [big])).rows[0].k, '40');
  assert.equal((await h.db.query<any>('SELECT count(*)::int AS n FROM pg_class WHERE relname = $1', [EMBEDDED_INDEX])).rows[0].n, 1);

  const again = await capEmbeddings(h.db);
  assert.deepEqual([again.files, again.cleared, again.left_files, again.index], [0, 0, 0, 'present']);

  // A word in a slice beyond the cap is still found, by word match, with its cell anchor's file.
  const r = await search('zebrafinch120');
  assert.ok(r.hits.some((x: any) => x.item_id === big && x.ordinal === 120), JSON.stringify(r.hits.map((x: any) => [x.title, x.ordinal])));
});

test('search returns one hit per file, and one per set of identical copies', async () => {
  const hash = 'sha256:' + 'ab'.repeat(32);
  const a = await file('AFE copy 1.pdf', 'pdf', 3, i => `authority for expenditure wombatwell sidetrack part ${i}`, hash);
  const b = await file('AFE copy 2.pdf', 'pdf', 3, i => `authority for expenditure wombatwell sidetrack part ${i}`, hash);
  const other = await file('Letter.docx', 'docx', 2, i => `letter about wombatwell part ${i}`);
  const r = await search('wombatwell');
  assert.ok(Array.isArray(r.hits), JSON.stringify(r));
  const ids = r.hits.map((x: any) => x.item_id);
  assert.equal(ids.filter((x: string) => x === a || x === b).length, 1, 'the two copies give one hit');
  assert.equal(ids.filter((x: string) => x === other).length, 1, 'two slices of one file give one hit');
});

test('a new large spreadsheet is indexed with every slice and only the first slices embedded', async () => {
  const rows = ['well,date,activity,depth'];
  for (let i = 0; i < 9000; i++) rows.push(`FROST-${i},2023-09-${String(i % 28 + 1).padStart(2, '0')},pulled tubing joint ${i} and laid down on rack numbatrow${i},${10000 + i}`);
  const up = await h.upload([{ name: 'big-log.csv', bytes: rows.join('\n'), type: 'text/csv' }]);
  assert.equal(up.status, 201);
  assert.equal(up.body.results[0].ingest, 'ok');
  const item = (await h.db.query<any>(`SELECT id::text AS id, extracted FROM items WHERE title LIKE 'big-log%' OR extracted->>'filename' = 'big-log.csv' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const c = await counts(item.id);
  assert.ok(c.n > EMBED_CAP.over, `chunks ${c.n}`);
  assert.equal(c.e, EMBED_CAP.keep);
  assert.equal(item.extracted.embed_cap.keep, EMBED_CAP.keep);
  // The job's clearing phase runs, finds nothing left to do for a file indexed under the cap, and reports no error.
  const { runIngestSync } = await import('../src/jobs/ingest-sync.ts');
  const s = await runIngestSync(h.db, { embedder: fake, workdrive: false, books: false } as any);
  assert.equal(s.embed_cap?.error ?? '', '');
  assert.equal(s.embed_cap?.cleared, 0);
  assert.equal((await counts(item.id)).e, EMBED_CAP.keep);
});
