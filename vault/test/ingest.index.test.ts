import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FakeProvider } from '../src/llm/provider.ts';
import { FakeEmbedder } from '../src/ingest/embed.ts';
import { ingestItem } from '../src/ingest/index.ts';
import { runIngestSync } from '../src/jobs/ingest-sync.ts';
import { longPdf, makeDocx, makePdf, makePptx, makeScannedPdf, makeXlsx, paragraphs } from './fixtures/ingest/build.ts';
import { readFixture, setup, type Harness } from './fixtures/ingest/harness.ts';

let h: Harness;
const deps = { provider: new FakeProvider(), embedder: new FakeEmbedder() };
before(async () => { h = await setup('vault-index-'); });
after(async () => { await h.db.close(); });

const chunkCount = async (id: string, where = '') => Number((await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 ${where}`, [id])).rows[0].n);
const item = async (id: string) => (await h.db.query<any>('SELECT * FROM items WHERE id = $1', [id])).rows[0];
const derived = (id: string) => path.join(h.storageDir, 'derived', id, 'text.md');

test('the same file uploaded twice is one item; a changed file is version 2 with the old chunks kept but not current', async () => {
  const v1 = paragraphs(40).join('\n\n');
  const a = await h.upload([{ name: 'basis-note.md', bytes: v1, type: 'text/markdown' }]);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const id = a.body.results[0].item_id;
  assert.equal(a.body.results[0].version, 1);
  assert.equal(a.body.results[0].status, 'ingested');
  const n1 = await chunkCount(id);
  assert.ok(n1 > 3);

  const b = await h.upload([{ name: 'basis-note.md', bytes: v1, type: 'text/markdown' }]);
  assert.equal(b.status, 200);
  assert.equal(b.body.results[0].item_id, id);
  assert.equal(b.body.results[0].deduplicated, true);
  assert.equal(b.body.results[0].status, 'unchanged');
  // same bytes under another name: still the same item (hash dedupe inside the project)
  const c = await h.upload([{ name: 'copy-of-basis-note.md', bytes: v1, type: 'text/markdown' }]);
  assert.equal(c.body.results[0].item_id, id);
  assert.equal((await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM items WHERE project_id = 'orinoco-partnership' AND extracted->>'filename' LIKE '%basis-note.md'`)).rows[0].n, 1);
  assert.equal(await chunkCount(id), n1, 'no duplicate chunks');

  const v2 = paragraphs(60).join('\n\n') + '\n\nAddendum: the royalty rate changed.';
  const d = await h.upload([{ name: 'basis-note.md', bytes: v2, type: 'text/markdown' }]);
  assert.equal(d.status, 201);
  assert.equal(d.body.results[0].item_id, id);
  assert.equal(d.body.results[0].version, 2);
  assert.equal((await item(id)).version, 2);
  assert.equal(await chunkCount(id, 'AND item_version = 1 AND current'), 0, 'old chunks are no longer current');
  assert.equal(await chunkCount(id, 'AND item_version = 1'), n1, 'old chunks are kept');
  assert.ok(await chunkCount(id, 'AND item_version = 2 AND current') > n1);
  assert.match(readFileSync(derived(id), 'utf8'), /Addendum: the royalty rate changed/, 'derived text is the current version');
  assert.equal((await item(id)).extracted.chunks, await chunkCount(id, 'AND item_version = 2'));
});

test('ingestItem is idempotent per (item, version); reindex rebuilds without duplicating', async () => {
  const up = await h.upload([{ name: 'idem.md', bytes: paragraphs(30).join('\n\n'), type: 'text/markdown' }]);
  const id = up.body.results[0].item_id;
  const n = await chunkCount(id);
  const again = await ingestItem(h.db, h.storage, id, deps);
  assert.equal(again.status, 'skipped');
  assert.equal(await chunkCount(id), n);
  const res = await h.app.request(`/api/ingest/reindex/${id}`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.chunks, n);
  assert.equal(await chunkCount(id), n);
  assert.equal((await h.app.request('/api/ingest/reindex/00000000-0000-4000-8000-000000000000', { method: 'POST' })).status, 404);
});

test('chunks copy the item scope: legal_tag, client_id, project_id, expires_at from the tag, item_id and version', async () => {
  const up = await h.upload([{ name: 'scope.md', bytes: paragraphs(12).join('\n\n'), type: 'text/markdown' }]);
  const id = up.body.results[0].item_id;
  const it = await item(id);
  const rows = (await h.db.query<any>(`SELECT DISTINCT legal_tag, client_id, project_id, partners_only, to_char(expires_at,'YYYY-MM-DD') AS expires_at, item_version, current FROM chunks WHERE item_id = $1`, [id])).rows;
  assert.deepEqual(rows, [{ legal_tag: it.legal_tag, client_id: 'petrolera-del-orinoco', project_id: 'orinoco-partnership', partners_only: false, expires_at: '2028-02-13', item_version: 1, current: true }]);
  assert.equal(it.legal_tag, 'lt-orinoco-nda-2026');
});

test('a 50-page generated PDF ingests in under 60 s with the fake provider and embedder', async () => {
  const bytes = await longPdf(50);
  const t0 = Date.now();
  const r = await h.upload([{ name: 'big-report.pdf', bytes, type: 'application/pdf' }]);
  const took = Date.now() - t0;
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const res = r.body.results[0];
  assert.equal(res.status, 'ingested');
  assert.ok(took < 60_000, `took ${took} ms`);
  const it = await item(res.item_id);
  assert.equal(it.extracted.pages, 50);
  assert.equal(it.extracted.chunks, res.chunks);
  assert.ok(res.chunks > 40);
  assert.ok(it.extracted.text_chars > 50 * 1500);
  const pages = (await h.db.query<{ n: number }>(`SELECT count(DISTINCT anchor)::int AS n FROM chunks WHERE item_id = $1`, [res.item_id])).rows[0].n;
  assert.ok(pages >= 40, 'chunks are anchored to pages');
});

test('the fixture set: PDF, scanned PDF, DOCX, XLSX (3 sheets), PPTX, NDA and invoice each become one item with text, anchors and chunks', async () => {
  const files = [
    { name: 'memo.pdf', bytes: await makePdf(['Screening memo page one about Carabobo heavy oil.', 'Page two lists the fiscal terms and the royalty.']), type: 'application/pdf' },
    { name: 'scanned-letter.pdf', bytes: await makeScannedPdf(['SCANNED LETTER Carabobo', 'Payment of USD 12,500.00 is due']), type: 'application/pdf' },
    { name: 'screening-report.docx', bytes: await makeDocx(), type: '' },
    { name: 'price-deck.xlsx', bytes: makeXlsx(), type: '' },
    { name: 'kickoff.pptx', bytes: await makePptx(), type: '' },
    { name: 'nda-orinoco.txt', bytes: readFixture('nda.txt'), type: 'text/plain' },
    { name: 'invoice-atc-2026-014.txt', bytes: readFixture('invoice.txt'), type: 'text/plain' },
  ];
  const before = (await h.db.query<{ n: number }>('SELECT count(*)::int AS n FROM items')).rows[0].n;
  const r = await h.upload(files);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await h.db.query<{ n: number }>('SELECT count(*)::int AS n FROM items')).rows[0].n, before + files.length, 'one item each');
  const byName = Object.fromEntries(r.body.results.map((x: any) => [x.filename, x]));
  const types: Record<string, string> = { 'memo.pdf': 'report', 'screening-report.docx': 'report', 'price-deck.xlsx': 'spreadsheet', 'kickoff.pptx': 'presentation', 'nda-orinoco.txt': 'nda', 'invoice-atc-2026-014.txt': 'invoice' };
  for (const [name, type] of Object.entries(types)) {
    const x = byName[name];
    assert.equal(x.status, 'ingested', `${name}: ${JSON.stringify(x)}`);
    assert.equal(x.type, type);
    const it = await item(x.item_id);
    assert.ok(it.extracted.text_chars > 20, `${name}: text`);
    assert.ok(it.extracted.anchors >= 1, `${name}: anchors`);
    assert.ok(it.extracted.chunks >= 1);
    assert.ok(existsSync(derived(x.item_id)), `${name}: derived/<id>/text.md`);
    assert.ok(readFileSync(derived(x.item_id), 'utf8').trim().length > 20);
    const anchored = (await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND anchor IS NOT NULL`, [x.item_id])).rows[0].n;
    assert.equal(anchored, it.extracted.chunks);
  }
  const xl = await item(byName['price-deck.xlsx'].item_id);
  assert.match(readFileSync(derived(xl.id), 'utf8'), /## Sheet: Prices[\s\S]*## Sheet: Wells[\s\S]*## Sheet: Notes/);
  // the scan is OCRed when language data is present here, and otherwise flagged rather than lost
  const scan = await item(byName['scanned-letter.pdf'].item_id);
  const scanText = existsSync(derived(scan.id)) ? readFileSync(derived(scan.id), 'utf8') : '';
  if (scan.extracted.ocr) assert.match(scanText, /SCANNED LETTER/i);
  else { assert.equal(scan.extracted.needs_ocr, true); assert.equal(byName['scanned-letter.pdf'].ingest, 'needs_ocr'); }
  // NDA and invoice: partners only, with parties, dates and amounts (detail in ingest.legal-finance.test.ts)
  for (const name of ['nda-orinoco.txt', 'invoice-atc-2026-014.txt']) {
    const it = await item(byName[name].item_id);
    assert.equal(it.extracted.partners_only, true);
    assert.ok(it.extracted.legal_finance.parties.length >= 2);
    assert.ok((await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND partners_only`, [it.id])).rows[0].n === it.extracted.chunks);
  }
});

test('unsupported files are stored as items and marked, not retried forever', async () => {
  const r = await h.upload([{ name: 'blob.bin', bytes: new Uint8Array([1, 2, 3, 4, 5, 6]), type: 'application/octet-stream' }]);
  const x = r.body.results[0];
  assert.equal(x.status, 'stored');
  assert.equal(x.ingest, 'unsupported');
  assert.equal((await item(x.item_id)).extracted.ingest.status, 'unsupported');
  const s = await runIngestSync(h.db, { workdrive: false, books: false, deps });
  assert.ok(!s.errors.length, s.errors.join('; '));
});

test('upload validation: project required and known, at least one file, multipart only, bad type reported per file', async () => {
  assert.equal((await h.upload([{ name: 'a.txt', bytes: 'x' }], {})).status, 400);
  assert.equal((await h.upload([{ name: 'a.txt', bytes: 'x' }], { project_id: 'nope' })).status, 400);
  assert.equal((await h.upload([], { project_id: 'orinoco-partnership' })).status, 400);
  const json = await h.app.request('/api/ingest/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(json.status, 400);
  const bad = await h.upload([{ name: 'a.txt', bytes: 'hello world text' }], { project_id: 'orinoco-partnership', type: 'not-a-type' });
  assert.equal(bad.body.results[0].status, 'failed');
  assert.match(bad.body.results[0].error, /type/);
});

test('files of 5 MB or more are queued as a job and picked up by the ingest-sync job', async () => {
  const para = paragraphs(1)[0] + '\n\n';
  let text = '';
  for (let i = 0; text.length < 5 * 1024 * 1024 + 1000; i++) text += `Block ${i}. ${para}`;
  const r = await h.upload([{ name: 'huge-dataroom-log.txt', bytes: text, type: 'text/plain' }]);
  const x = r.body.results[0];
  assert.equal(x.status, 'queued', JSON.stringify(x));
  assert.equal(await chunkCount(x.item_id), 0);
  const job = (await h.db.query<any>(`SELECT * FROM jobs WHERE name = 'ingest-queue' AND summary->>'item_id' = $1`, [x.item_id])).rows[0];
  assert.equal(job.status, 'running');
  assert.equal(job.finished_at, null);

  const s = await runIngestSync(h.db, { workdrive: false, books: false, deps });
  assert.equal(s.failed, 0, s.errors.join('; '));
  assert.ok(s.ingested >= 1);
  assert.ok(await chunkCount(x.item_id, 'AND current') > 100);
  assert.equal((await h.db.query<any>(`SELECT status FROM jobs WHERE id = $1`, [job.id])).rows[0].status, 'ok');
  const run = (await h.db.query<any>(`SELECT status, summary FROM jobs WHERE name = 'ingest-sync' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(run.status, 'ok');
  assert.equal(run.summary.ingested, s.ingested);
  const again = await runIngestSync(h.db, { workdrive: false, books: false, deps });
  assert.equal(again.ingested, 0, 'nothing left to ingest');
});
