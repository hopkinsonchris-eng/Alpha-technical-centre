import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { indexHealth, healthLines } from '../src/ingest/health.ts';
import { paragraphs } from './fixtures/ingest/build.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';

let h: Harness;
before(async () => { h = await setup('vault-health-'); });
after(async () => { await h.db.close(); });

const P = 'orinoco-partnership';
const addItem = async (patch: { storage_key?: string | null; extracted?: Record<string, unknown> }) => {
  const id = randomUUID();
  const lt = (await h.db.query<any>('SELECT default_legal_tag FROM projects WHERE id = $1', [P])).rows[0].default_legal_tag;
  await h.db.query(`INSERT INTO items (id, type, title, legal_tag, project_id, storage_key, origin, extracted, created_at, content_hash) VALUES ($1::uuid, 'report', $2, $3, $4, $5, '{}'::jsonb, $6::jsonb, now(), $1::text)`,
    [id, `t-${id.slice(0, 4)}`, lt, P, patch.storage_key ?? null, JSON.stringify(patch.extracted ?? {})]);
  return id;
};

test('index health counts a project\'s files by state, reads the last ingest run and prices the ledger', async () => {
  const up = await h.upload([{ name: 'h1.md', bytes: paragraphs(10).join('\n\n'), type: 'text/markdown' }]);
  assert.equal(up.status, 201);
  await addItem({ storage_key: 'originals/aa' });                                                     // waiting
  await addItem({ storage_key: 'originals/bb', extracted: { ingest_error: { version: 1, at: '2026-11-14T10:00:00Z', message: 'anthropic 400: credit balance is too low', attempts: 2 } } });
  await addItem({ storage_key: 'originals/cc', extracted: { ingest: { version: 1, status: 'unsupported' } } });
  await addItem({ storage_key: 'originals/dd', extracted: { ingest: { version: 1, status: 'needs_ocr' } } });
  await addItem({ storage_key: null });                                                               // a note with no original
  await h.db.query(`INSERT INTO jobs (name, status, finished_at, summary) VALUES ('ingest-sync', 'ok', now(), $1::jsonb)`, [JSON.stringify({ ingested: 3, failed: 1, skipped: 0, errors: ['x: anthropic 400: credit balance is too low'] })]);
  await h.db.query(`INSERT INTO audit_events (person_id, action, detail, tokens_in, tokens_out) VALUES ('system', 'llm.context', '{"model":"claude-haiku-5-5"}', 1000000, 1000000)`);
  await h.db.query(`INSERT INTO audit_events (person_id, action, detail, cost_usd) VALUES ('system', 'llm.draft', '{"model":"claude-sonnet-5-5"}', 1.28)`);

  const r = await indexHealth(h.db, P);
  const f = r.files;
  assert.ok(f.indexed >= 1, JSON.stringify(f));
  assert.ok(f.waiting >= 2);
  assert.ok(f.failed >= 1);
  assert.ok(f.unsupported >= 1 && f.needs_ocr >= 1 && f.no_original >= 1);
  assert.equal(f.readable, f.indexed + f.waiting + f.needs_ocr);
  assert.equal(r.last_run?.status, 'ok');
  assert.equal(r.last_run?.ingested, 3);
  assert.match(r.last_run?.first_error ?? '', /credit balance/);
  assert.ok(r.runs_last_24h >= 1);
  assert.match(r.last_file_error?.message ?? '', /credit balance/);
  // Haiku 5.5: 1M in at $0.10 + 1M out at $0.50 = $0.60 ≈ £0.47; the draft row's cost_usd 1.28 = £1.00.
  assert.ok(r.spend.indexing_total_gbp >= 0.46 && r.spend.indexing_total_gbp < 0.6, JSON.stringify(r.spend));
  assert.ok(r.spend.total_gbp >= r.spend.indexing_total_gbp + 0.99, JSON.stringify(r.spend));
  assert.ok(r.spend.today_gbp >= r.spend.indexing_today_gbp);
  const md = healthLines(r).join('\n');
  assert.match(md, /## Index health/);
  assert.match(md, /Last ingest run #\d+/);
});

test('a record with no original but its own text (a research finding) is indexed from that text, without a model call', async () => {
  const { FakeEmbedder } = await import('../src/ingest/embed.ts');
  const { runIngestSync } = await import('../src/jobs/ingest-sync.ts');
  const id = await addItem({ storage_key: null, extracted: { kind: 'research', quote: 'Fire at the Sharara field in the Fezzan basin forced a reroute of oil flows.', url: 'https://example.com/sharara' } });
  const bare = await addItem({ storage_key: null, extracted: { kind: 'research' } });
  let calls = 0;
  const provider = { name: 'counting', async complete() { calls++; return { text: '', usage: { input: 0, cached: 0, output: 0 }, model: 'fake', provider: 'fake' }; } } as any;
  const s = await runIngestSync(h.db, { storage: h.storage, deps: { provider, embedder: new FakeEmbedder(), cheap: provider }, workdrive: false, books: false, folders: false });
  assert.equal(s.failed, 0, JSON.stringify(s.errors));
  const rows = (await h.db.query<any>('SELECT text, current FROM chunks WHERE item_id = $1', [id])).rows;
  assert.ok(rows.length >= 1 && rows.every((r: any) => r.current));
  assert.match(rows.map((r: any) => r.text).join(' '), /Sharara field in the Fezzan basin/);
  assert.equal(calls, 0, 'no model call for a record\'s own text');
  assert.equal((await h.db.query<any>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1', [bare])).rows[0].n, 0);
  const f = (await indexHealth(h.db, P)).files;
  assert.ok(f.no_original >= 1, 'the record with no text is still counted as having nothing to index');
});

test('unsupported files are broken down by extension, and a zero-byte original is marked empty rather than failed', async () => {
  await addItem({ storage_key: 'originals/u1', extracted: { filename: 'well-1.LAS', ingest: { version: 1, status: 'unsupported' } } });
  await addItem({ storage_key: 'originals/u2', extracted: { filename: 'well-2.las', ingest: { version: 1, status: 'unsupported' } } });
  const r = await indexHealth(h.db, P);
  assert.equal(r.unsupported_by_ext.find(e => e.ext === 'las')?.n, 2, JSON.stringify(r.unsupported_by_ext));
  assert.match(healthLines(r).join('\n'), /Unsupported by type: .*las 2/);
  const { FakeEmbedder } = await import('../src/ingest/embed.ts');
  const { ingestItem } = await import('../src/ingest/index.ts');
  await h.storage.put('originals/zero', new Uint8Array(0), 'application/pdf');
  const id = await addItem({ storage_key: 'originals/zero', extracted: { filename: 'blank.pdf' } });
  const res = await ingestItem(h.db, h.storage, id, { provider: null, embedder: new FakeEmbedder() });
  assert.equal(res.status, 'empty');
});

test('a LAS file marked unsupported by the older extractor is queued once more and indexed; a still-unreadable type is not retried', async () => {
  const { FakeEmbedder } = await import('../src/ingest/embed.ts');
  const { runIngestSync } = await import('../src/jobs/ingest-sync.ts');
  const las = '~VERSION\n VERS. 2.0 : LAS\n~WELL\n WELL. KNIGHT 32-10 #4 : WELL\n~A DEPT GR\n100 50\n';
  await h.storage.put('originals/las1', new TextEncoder().encode(las), 'application/octet-stream');
  const lasId = await addItem({ storage_key: 'originals/las1', extracted: { filename: 'KNIGHT_32_10_4.las', ingest: { version: 1, status: 'unsupported' } } });
  await h.storage.put('originals/tif1', new Uint8Array([0x4c, 0x50, 0x54, 0, 1, 2, 3, 4]), 'application/octet-stream');
  const tifId = await addItem({ storage_key: 'originals/tif1', extracted: { filename: 'plot.lpt', ingest: { version: 1, status: 'unsupported' } } });
  const deps = { provider: null, embedder: new FakeEmbedder(), cheap: null };
  await runIngestSync(h.db, { storage: h.storage, deps, workdrive: false, books: false, folders: false });
  const n = (await h.db.query<any>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND current', [lasId])).rows[0].n;
  assert.ok(n >= 1, 'the LAS header is indexed');
  const tif = (await h.db.query<any>('SELECT extracted FROM items WHERE id = $1', [tifId])).rows[0].extracted;
  assert.equal(tif.ingest.status, 'unsupported');
  assert.equal(tif.ingest.ext_v, undefined, 'an LPT plot is not a type this extractor reads, so it is not retried');
  const again = await runIngestSync(h.db, { storage: h.storage, deps, workdrive: false, books: false, folders: false });
  assert.equal(again.ingested, 0, 'nothing loops');
});

test('the queue shows a scan marked unsupported by the older extractor as a retry of a newly read type; a missing original is marked once', async () => {
  const before = (await indexHealth(h.db, P)).queue;
  await addItem({ storage_key: 'originals/scan-old', extracted: { filename: 'LOG_HEADER.TIFF', ingest: { version: 1, status: 'unsupported' } } });
  const q = (await indexHealth(h.db, P)).queue;
  assert.equal(q.total, before.total + 1, JSON.stringify(q));
  assert.ok(q.next_batch.retry_new_type >= 1);
  const md = healthLines(await indexHealth(h.db, P)).join('\n');
  assert.match(md, /Queue \(firm-wide\): \d+ waiting/);
  const { FakeEmbedder } = await import('../src/ingest/embed.ts');
  const { ingestItem } = await import('../src/ingest/index.ts');
  const gone = await addItem({ storage_key: 'originals/not-there' });
  assert.equal((await ingestItem(h.db, h.storage, gone, { provider: null, embedder: new FakeEmbedder() })).status, 'no_original');
  const q2 = (await indexHealth(h.db, P)).queue;
  assert.equal(q2.total, q.total, 'the missing original is out of the queue once marked');
});

test('a file whose last read never finished (the process died) is set aside, not tried again; a normal read leaves no attempt mark', async () => {
  const { FakeEmbedder } = await import('../src/ingest/embed.ts');
  const { ingestItem } = await import('../src/ingest/index.ts');
  await h.storage.put('originals/big-scan', new TextEncoder().encode('# A note\n\nWell header text.'), 'text/markdown');
  const id = await addItem({ storage_key: 'originals/big-scan', extracted: { filename: 'huge.tif', ingest_attempt: { version: 1, at: '2026-11-14T15:30:00Z' } } });
  const r = await ingestItem(h.db, h.storage, id, { provider: null, embedder: new FakeEmbedder() });
  assert.equal(r.status, 'needs_ocr');
  const ex = (await h.db.query<any>('SELECT extracted FROM items WHERE id = $1', [id])).rows[0].extracted;
  assert.equal(ex.ingest.status, 'needs_ocr'); assert.ok(ex.crashed); assert.equal(ex.ingest_attempt, undefined);
  const q = (await indexHealth(h.db, P)).queue;
  const ok = await addItem({ storage_key: 'originals/big-scan', extracted: { filename: 'note.md' } });
  assert.equal((await ingestItem(h.db, h.storage, ok, { provider: null, embedder: new FakeEmbedder() })).status, 'ok');
  assert.equal((await h.db.query<any>('SELECT extracted FROM items WHERE id = $1', [ok])).rows[0].extracted.ingest_attempt, undefined);
  assert.equal((await indexHealth(h.db, P)).queue.total, q.total, 'neither is left in the queue');
});
