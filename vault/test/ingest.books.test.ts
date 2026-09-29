import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../src/llm/provider.ts';
import { FakeEmbedder } from '../src/ingest/embed.ts';
import { appSink } from '../src/ingest/items-client.ts';
import { booksConfig, syncBooks } from '../src/ingest/zoho-books.ts';
import { runIngestSync } from '../src/jobs/ingest-sync.ts';
import { makePdf } from './fixtures/ingest/build.ts';
import { readJson, setup, type Harness } from './fixtures/ingest/harness.ts';

let h: Harness;
before(async () => { h = await setup('vault-books-'); });
after(async () => { await h.db.close(); });

const ENV = { ZOHO_BOOKS_CLIENT_ID: 'cid', ZOHO_BOOKS_CLIENT_SECRET: 'secret', ZOHO_BOOKS_REFRESH_TOKEN: 'refresh', ZOHO_BOOKS_ORG_ID: '20090001', ZOHO_BOOKS_API_URL: 'https://www.zohoapis.eu/books/v3' } as NodeJS.ProcessEnv;
const MAP = { project_id: 'firm', customer_projects: { 'Petrolera del Orinoco S.A.': 'orinoco-partnership' } };

/** Recorded Books: list and detail JSON per tick, PDFs generated per invoice (with a revision that changes the bytes). */
function recorded(tick: { value: 't1' | 't2' }) {
  const log: string[] = [];
  const pdfFor = (label: string, rev: number) => makePdf([`${label}\nRevision ${rev}\nTotal Due: USD 8,400.00\nStatus: Unpaid`]);
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    log.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/oauth/v2/token') return Response.json({ access_token: 'books-token', expires_in: 3600 });
    assert.equal((init?.headers as any).authorization, 'Zoho-oauthtoken books-token');
    assert.equal(url.host, 'www.zohoapis.eu');
    assert.equal(url.searchParams.get('organization_id'), '20090001');
    const p = url.pathname.replace('/books/v3', '');
    const wantsPdf = url.searchParams.get('accept') === 'pdf';
    const t = tick.value;
    if (p === '/invoices') return Response.json(readJson(`books/invoices-${t}.json`));
    if (p === '/purchaseorders') return t === 't1' ? Response.json(readJson('books/purchaseorders-t1.json')) : Response.json({ code: 0, purchaseorders: [], page_context: { has_more_page: false } });
    if (p === '/expenses') return t === 't1' ? Response.json(readJson('books/expenses-t1.json')) : Response.json({ code: 0, expenses: [], page_context: { has_more_page: false } });
    let m = /^\/invoices\/(\d+)$/.exec(p);
    if (m) {
      if (wantsPdf) return new Response(await pdfFor(`Invoice ${m[1]}`, m[1] === '9001' && t === 't2' ? 2 : 1) as BodyInit, { headers: { 'content-type': 'application/pdf' } });
      return Response.json(readJson(m[1] === '9001' ? `books/invoice-9001-${t}.json` : 'books/invoice-9002.json'));
    }
    m = /^\/purchaseorders\/(\d+)$/.exec(p);
    if (m) return wantsPdf ? new Response(await pdfFor('Purchase order PO-00007\nVendor: Seismic Data Brokers Inc', 1) as BodyInit, { headers: { 'content-type': 'application/pdf' } }) : Response.json(readJson('books/purchaseorder-7001.json'));
    m = /^\/expenses\/(\d+)$/.exec(p);
    if (m) return Response.json(readJson(`books/expense-${m[1]}.json`));
    m = /^\/expenses\/(\d+)\/receipt$/.exec(p);
    if (m) return m[1] === '8001' ? new Response(await pdfFor('Receipt: Avianca flight BOG-CCS\nTotal: USD 640.00', 1) as BodyInit, { headers: { 'content-type': 'application/pdf' } }) : new Response('{"code":5}', { status: 404 });
    return new Response('unexpected ' + p, { status: 500 });
  }) as unknown as typeof fetch;
  return { fetchImpl, log };
}

const items = async () => (await h.db.query<any>(`SELECT * FROM items WHERE origin->>'source' = 'zoho-books' ORDER BY title`)).rows;

test('Books sync: invoices, purchase orders and expenses become items with the PDF original and the structured record; a second run and a modified record behave', async () => {
  const tick = { value: 't1' as 't1' | 't2' };
  const { fetchImpl, log } = recorded(tick);
  const config = booksConfig(ENV, fetchImpl);
  assert.equal(booksConfig({} as any), null);
  const sink = appSink(h.app);

  // 1. new
  const first = await syncBooks(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([first.listed, first.created, first.versioned, first.unchanged, first.failed], [5, 5, 0, 0, 0], first.errors.join('; '));
  assert.deepEqual(first.by_kind, { invoice: { created: 2, versioned: 0, unchanged: 0 }, 'purchase-order': { created: 1, versioned: 0, unchanged: 0 }, expense: { created: 2, versioned: 0, unchanged: 0 } });
  const rows = await items();
  assert.deepEqual(rows.map(r => [r.type, r.title, r.project_id]).sort(), [
    ['expense', 'Expense 8001, Avianca', 'firm'], ['expense', 'Expense 8002, Voyage AI', 'firm'],
    ['invoice', 'Invoice INV-000014, Petrolera del Orinoco S.A.', 'orinoco-partnership'], ['invoice', 'Invoice INV-000015, Acme Drilling Ltd', 'firm'],
    ['purchase-order', 'Purchase order PO-00007, Seismic Data Brokers Inc', 'firm'],
  ].sort());
  const inv = rows.find(r => r.title.includes('INV-000014'))!;
  assert.equal(inv.origin.source, 'zoho-books');
  assert.equal(inv.origin.external_id, 'invoice:9001');
  assert.equal(inv.mime, 'application/pdf');
  assert.match(inv.storage_key, /^originals\//);
  const bytes = await h.storage.get(inv.storage_key);
  assert.equal(Buffer.from(bytes!.subarray(0, 4)).toString(), '%PDF');
  assert.equal(inv.extracted.zoho_books.number, 'INV-000014');
  assert.equal(inv.extracted.zoho_books.record.line_items.length, 2, 'the structured record is kept whole');
  assert.deepEqual([inv.extracted.reference, inv.extracted.amount, inv.extracted.currency, inv.extracted.issue_date, inv.extracted.due_date, inv.extracted.paid_status, inv.extracted.partners_only, inv.extracted.parties],
    ['INV-000014', 8400, 'USD', '2026-08-03', '2026-09-02', 'unpaid', true, ['Petrolera del Orinoco S.A.']]);
  assert.equal(inv.legal_tag, 'lt-orinoco-nda-2026');
  assert.equal(inv.authored_at.toISOString(), '2026-08-03T00:00:00.000Z');
  // an expense with no receipt keeps the record itself as its original
  const noReceipt = rows.find(r => r.title.includes('8002'))!;
  assert.equal(noReceipt.mime, 'application/json');
  assert.equal(noReceipt.extracted.paid_status, 'paid', 'reimbursed');
  assert.equal(rows.find(r => r.title.includes('8001'))!.mime, 'application/pdf');
  // cursor per kind
  assert.equal((await h.db.query<any>(`SELECT value FROM settings WHERE key = 'zoho-books:invoice'`)).rows[0].value.last_modified_time, '2026-08-12T14:00:00-0500');
  assert.ok(log.some(l => l.startsWith('/books/v3/invoices?') && l.includes('sort_column=last_modified_time')));

  // 2. unchanged: the cursor is sent, no detail or PDF fetches
  log.length = 0;
  const second = await syncBooks(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([second.created, second.versioned, second.unchanged, second.failed], [0, 0, 5, 0]);
  assert.ok(log.some(l => l.includes('last_modified_time=2026-08-12')), 'the stored cursor narrows the list');
  assert.ok(!log.some(l => /\/invoices\/\d+/.test(l)), 'unchanged records are not fetched again');

  // 3. INV-000014 is modified (now paid, new PDF)
  tick.value = 't2';
  const third = await syncBooks(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([third.created, third.versioned, third.unchanged, third.failed], [0, 1, 1, 0], third.errors.join('; '));
  assert.deepEqual(third.by_kind.invoice, { created: 0, versioned: 1, unchanged: 1 });
  const v2 = (await h.db.query<any>(`SELECT version, extracted FROM items WHERE external_id = 'invoice:9001'`)).rows[0];
  assert.equal(v2.version, 2);
  assert.equal(v2.extracted.paid_status, 'paid');
  assert.equal(v2.extracted.zoho_books.status, 'paid');

  // 4. and then nothing
  const fourth = await syncBooks(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([fourth.created, fourth.versioned, fourth.failed], [0, 0, 0]);
});

test('ingest of Books items: the PDF text is indexed, partners-only, and the structured facts win over the PDF text', async () => {
  const job = await runIngestSync(h.db, { workdrive: false, books: false, deps: { provider: new FakeProvider(), embedder: new FakeEmbedder() } });
  assert.equal(job.failed, 0, job.errors.join('; '));
  assert.equal(job.ingested, 5);
  const inv = (await h.db.query<any>(`SELECT id, extracted FROM items WHERE external_id = 'invoice:9001'`)).rows[0];
  // the PDF says "Status: Unpaid", Books says paid: the structured record is not overwritten
  assert.equal(inv.extracted.paid_status, 'paid');
  assert.match(inv.extracted.legal_finance.paid_status.quote, /Unpaid/i);
  assert.equal(inv.extracted.text_chars > 20, true);
  assert.ok((await h.db.query<any>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND partners_only AND current', [inv.id])).rows[0].n >= 1);
  const po = (await h.db.query<any>(`SELECT extracted FROM items WHERE external_id = 'purchase-order:7001'`)).rows[0];
  assert.equal(po.extracted.zoho_books.number, 'PO-00007');
  const json = (await h.db.query<any>(`SELECT extracted FROM items WHERE external_id = 'expense:8002'`)).rows[0];
  assert.ok(json.extracted.chunks >= 1, 'a record kept as JSON is indexed too');
});

test('a failing record does not stop the others and keeps the cursor behind it', async () => {
  const tick = { value: 't1' as 't1' | 't2' };
  const { fetchImpl } = recorded(tick);
  const flaky = (async (input: string | URL, init?: RequestInit) => (String(input).includes('/expenses/8001?') ? new Response('{"code":9,"message":"boom"}', { status: 500 }) : fetchImpl(input, init))) as unknown as typeof fetch;
  await h.db.query(`DELETE FROM settings WHERE key LIKE 'zoho-books:%'`);
  await h.db.query(`UPDATE items SET extracted = extracted - 'zoho_books' WHERE external_id = 'expense:8001'`);
  const s = await syncBooks(h.db, appSink(h.app), { fetchImpl: flaky, config: booksConfig(ENV, flaky), map: MAP, kinds: ['expense'] });
  assert.equal(s.failed, 1);
  assert.match(s.errors[0], /expense 8001/);
  assert.equal((await h.db.query<any>(`SELECT count(*)::int AS n FROM settings WHERE key = 'zoho-books:expense'`)).rows[0].n, 0, 'cursor did not advance past the failed record');
  const off = await syncBooks(h.db, appSink(h.app), { config: null });
  assert.match(off.errors[0], /not configured/);
});
