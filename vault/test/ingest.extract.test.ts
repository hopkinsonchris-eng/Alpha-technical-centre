import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractText, UnsupportedFormat, detectFormat } from '../src/ingest/extract.ts';
import { EML, longPdf, makeDocx, makePdf, makePptx, makeScannedPdf, makeXlsx, paragraphs } from './fixtures/ingest/build.ts';
import { HERE, readFixture } from './fixtures/ingest/harness.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const anchorLabels = (r: { anchors: { label: string }[] }) => r.anchors.map(a => a.label);
const VAULT_DIR = path.resolve(HERE, '../../..');

test('PDF with a text layer: page anchors and the text', async () => {
  const bytes = await makePdf(['First page. Effective date 1 March 2026.\nSecond line here.', 'Second page about Carabobo.', 'Third page.']);
  const r = await extractText(bytes, 'application/pdf', 'memo.pdf');
  assert.equal(r.format, 'pdf');
  assert.equal(r.pages, 3);
  assert.ok(!r.needs_ocr && !r.ocr);
  assert.match(r.text, /Effective date 1 March 2026/);
  assert.match(r.text, /Second page about Carabobo/);
  assert.deepEqual(anchorLabels(r), ['page 1', 'page 2', 'page 3']);
  for (const a of r.anchors) assert.ok(r.text.slice(a.offset).startsWith('## Page'), 'anchor offsets point at the page heading');
});

test('scanned PDF: OCR when the language data is local, otherwise needs_ocr is set and nothing throws', async (t) => {
  const bytes = await makeScannedPdf(['SCANNED LETTER Carabobo', 'Payment of USD 12,500.00 is due']);
  // No language data available: the scan is flagged, not silently dropped.
  const prev = process.env.VAULT_TESSDATA_DIR;
  process.env.VAULT_TESSDATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'no-tessdata-'));
  try {
    const r = await extractText(bytes, 'application/pdf', 'scan.pdf');
    assert.equal(r.needs_ocr, true);
    assert.ok(!r.ocr);
    assert.equal(r.text.replace(/## Page \d+/g, '').trim(), '');
  } finally { if (prev === undefined) delete process.env.VAULT_TESSDATA_DIR; else process.env.VAULT_TESSDATA_DIR = prev; }

  // With language data in vault/.storage/tessdata (git-ignored; see the report) the worker runs offline.
  const dir = path.join(VAULT_DIR, '.storage', 'tessdata');
  if (!existsSync(path.join(dir, 'eng.traineddata.gz')) && !existsSync(path.join(dir, 'eng.traineddata'))) { t.skip('no local tesseract language data'); return; }
  const ocr = await extractText(bytes, 'application/pdf', 'scan.pdf');
  assert.equal(ocr.ocr, true);
  assert.ok(!ocr.needs_ocr);
  assert.match(ocr.text, /SCANNED LETTER/i);
  assert.match(ocr.text, /12,500/);
  assert.deepEqual(anchorLabels(ocr), ['page 1']);
});

test('DOCX: headings become anchors, tables become Markdown tables', async () => {
  const r = await extractText(await makeDocx(), '', 'report.docx');
  assert.equal(r.format, 'docx');
  assert.match(r.text, /^# Carabobo Screening Report/m);
  assert.match(r.text, /3\.2 Darcy/);
  assert.match(r.text, /\| CB-12 \| 410 \|/);
  assert.deepEqual(anchorLabels(r).slice(0, 2), ['Carabobo Screening Report', 'Reservoir summary']);
});

test('XLSX with 3 sheets: one Markdown table per sheet, cell references as anchors', async () => {
  const r = await extractText(makeXlsx(), '', 'model.xlsx');
  assert.equal(r.format, 'xlsx');
  for (const s of ['Prices', 'Wells', 'Notes']) assert.match(r.text, new RegExp(`## Sheet: ${s}`));
  assert.match(r.text, /\| Year \| Brent \(USD\/bbl\) \|\n\| --- \| --- \|\n\| 2026 \| 74\.5 \|/);
  assert.match(r.text, /pipe test/);
  assert.match(r.text, /Prices are a flat real deck \\\| pipe test/, 'pipes inside cells are escaped');
  const labels = anchorLabels(r);
  assert.ok(labels.includes('sheet Prices') && labels.includes('sheet Wells') && labels.includes('sheet Notes'));
  assert.ok(labels.includes('Prices!A3') && labels.includes('Wells!A3'), 'row cell references are kept');
  const a = r.anchors.find(x => x.label === 'Wells!A3')!;
  assert.ok(r.text.slice(a.offset).startsWith('| CB-15 |'));
});

test('CSV goes through the same table path', async () => {
  const r = await extractText(enc('well,rate\nCB-12,410\nCB-15,385\n'), 'text/csv', 'rates.csv');
  assert.equal(r.format, 'csv');
  assert.match(r.text, /\| well \| rate \|/);
  assert.ok(anchorLabels(r).includes('Sheet1!A3'));
});

test('PPTX: slide text, notes and slide anchors from a minimal zip', async () => {
  const r = await extractText(await makePptx(), '', 'deck.pptx');
  assert.equal(r.format, 'pptx');
  assert.equal(r.pages, 2);
  assert.match(r.text, /### Carabobo redevelopment/);
  assert.match(r.text, /- Capex & opex assumptions/);
  assert.match(r.text, /Notes: Mention the windfall clause/);
  assert.deepEqual(anchorLabels(r), ['slide 1', 'slide 2']);
});

test('HTML: scripts dropped, headings and tables kept', async () => {
  const html = '<html><head><title>Basis note</title><style>p{}</style></head><body><h1>Basis</h1><p>Brent &amp; WTI &lt; 80.</p><script>alert(1)</script><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>';
  const r = await extractText(enc(html), 'text/html', 'note.html');
  assert.equal(r.title, 'Basis note');
  assert.match(r.text, /^# Basis/m);
  assert.match(r.text, /Brent & WTI < 80\./);
  assert.match(r.text, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  assert.ok(!/alert|p\{\}/.test(r.text));
  assert.deepEqual(anchorLabels(r), ['Basis']);
});

test('MD and TXT: headings and numbered clauses are anchors; the NDA and invoice fixtures extract', async () => {
  const md = await extractText(enc('# Title\n\nBody.\n\n## Part two\n\nMore.\n'), 'text/markdown', 'a.md');
  assert.deepEqual(anchorLabels(md), ['Title', 'Part two']);
  const nda = await extractText(readFixture('nda.txt'), 'text/plain', 'nda.txt');
  assert.ok(nda.text.length > 500);
  assert.ok(anchorLabels(nda).includes('3. Term') && anchorLabels(nda).includes('5. Governing Law'));
  const inv = await extractText(readFixture('invoice.txt'), '', 'invoice.txt');
  assert.match(inv.text, /Total Due: USD 8,400\.00/);
  assert.ok(inv.anchors.length >= 1);
});

test('EML: decoded headers, quoted-printable body, attachment names', async () => {
  const r = await extractText(enc(EML), 'message/rfc822', 'mail.eml');
  assert.equal(r.format, 'eml');
  assert.equal(r.title, 'Carabobo data room access');
  assert.match(r.text, /^# Carabobo data room access/m);
  assert.match(r.text, /From: María Fernández <mfernandez@petroleradelorinoco\.com>/);
  assert.match(r.text, /El acceso al cuarto de datos será habilitado el lunes\./);
  assert.match(r.text, /Attachments: nda\.pdf/);
  assert.deepEqual(anchorLabels(r), ['headers', 'body']);
});

test('format detection: extension, then mime, then content; unknown formats are refused', async () => {
  assert.equal(await detectFormat(enc('x'), '', 'a.PDF'), 'pdf');
  assert.equal(await detectFormat(enc('x'), 'text/csv', 'noext'), 'csv');
  assert.equal(await detectFormat(await makeDocx(), '', 'blob'), 'docx');
  assert.equal(await detectFormat(await makePdf(['x']), 'application/octet-stream', 'blob'), 'pdf');
  await assert.rejects(extractText(new Uint8Array([1, 2, 3, 4]), 'application/octet-stream', 'x.bin'), UnsupportedFormat);
});

test('a 50-page PDF extracts every page quickly', async () => {
  const bytes = await longPdf(50);
  const t0 = Date.now();
  const r = await extractText(bytes, 'application/pdf', 'big.pdf');
  assert.equal(r.pages, 50);
  assert.equal(r.anchors.length, 50);
  assert.ok(r.text.length > 50 * 1500, `text too short: ${r.text.length}`);
  assert.ok(Date.now() - t0 < 20_000);
  assert.ok(paragraphs(1)[0].length > 100);
});
