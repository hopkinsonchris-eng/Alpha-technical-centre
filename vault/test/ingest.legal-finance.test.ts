import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../src/llm/provider.ts';
import {
  extractLegalFinance, extractLegalFinanceHeuristic, flatten, inferType, isLegalFinanceType, LEGAL_FINANCE_TYPES, mergeLlm, parseDate, parseNumber, quoteInText,
} from '../src/ingest/legal-finance.ts';
import { readFixture, setup, type Harness } from './fixtures/ingest/harness.ts';

const NDA = readFixture('nda.txt').toString('utf8');
const INVOICE = readFixture('invoice.txt').toString('utf8');
let h: Harness;
before(async () => { h = await setup('vault-lf-'); });
after(async () => { await h.db.close(); });

test('types: the nine legal and finance types are typed, others are not', () => {
  assert.deepEqual([...LEGAL_FINANCE_TYPES].sort(), ['contract', 'expense', 'insurance', 'invoice', 'licence', 'nda', 'proposal', 'purchase-order', 'timesheet']);
  assert.ok(isLegalFinanceType('nda') && !isLegalFinanceType('report'));
  assert.equal(inferType('NDA_Orinoco_signed.pdf', ''), 'nda');
  assert.equal(inferType('factura 0042.pdf', ''), 'invoice');
  assert.equal(inferType('notes.txt', '', 'MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis agreement...'), 'nda');
  assert.equal(inferType('deck.pptx', ''), 'presentation');
  assert.equal(inferType('rates.csv', 'text/csv'), 'spreadsheet');
});

test('dates and numbers: ISO, English, Spanish and day-first numeric forms; European and English number formats', () => {
  assert.equal(parseDate('2026-03-01'), '2026-03-01');
  assert.equal(parseDate('1st March 2026'), '2026-03-01');
  assert.equal(parseDate('March 1, 2026'), '2026-03-01');
  assert.equal(parseDate('1 de marzo de 2026'), '2026-03-01');
  assert.equal(parseDate('01/03/2026'), '2026-03-01');
  assert.equal(parseDate('31 February 2026'), null);
  assert.equal(parseNumber('12,500.00'), 12500);
  assert.equal(parseNumber('12.500,50'), 12500.5);
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('8400'), 8400);
});

test('NDA: parties, effective date, expiry, confidentiality term and governing law, each with a quote found in the text', () => {
  const lf = extractLegalFinanceHeuristic(NDA, 'nda');
  assert.deepEqual(lf.parties.map(p => [p.name, p.role]), [['Petrolera del Orinoco S.A.', 'Discloser'], ['Alpha Technical Centre Ltd', 'Recipient']]);
  assert.equal(lf.dates.effective?.value, '2026-02-14');
  assert.equal(lf.dates.expiry?.value, '2029-02-13');
  assert.equal(lf.dates.expiry?.derived, true, 'the expiry is computed from "three (3) years from the Effective Date"');
  assert.equal(lf.confidentiality_term?.value, '5 years');
  assert.equal(lf.governing_law?.value, 'England and Wales');
  assert.equal(lf.partners_only, true);
  const facts = [...lf.parties.map(p => p.quote), lf.dates.effective!.quote, lf.dates.expiry!.quote, lf.confidentiality_term!.quote, lf.governing_law!.quote];
  for (const q of facts) assert.ok(q.length >= 10 && quoteInText(NDA, q), `quote not in text: ${q}`);
  assert.match(lf.dates.effective!.quote, /14 February 2026/);
  assert.match(lf.dates.expiry!.quote, /three \(3\) years/);
});

test('an explicit expiry date beats a computed one', () => {
  const lf = extractLegalFinanceHeuristic(`Agreement made as of 1 January 2026 between Alpha Ltd ("A") and Beta S.A. ("B").\nThis Agreement expires on 30 June 2027.\nIt shall remain in force for a period of five (5) years.`, 'nda');
  assert.equal(lf.dates.expiry?.value, '2027-06-30');
  assert.ok(!lf.dates.expiry?.derived);
});

test('invoice: reference, issue and due dates, amounts, currency, paid status and parties with quotes', () => {
  const lf = extractLegalFinanceHeuristic(INVOICE, 'invoice');
  assert.equal(lf.reference?.value, 'ATC-2026-014');
  assert.equal(lf.dates.issue?.value, '2026-08-03');
  assert.equal(lf.dates.due?.value, '2026-09-02');
  assert.equal(lf.total?.amount, 8400);
  assert.equal(lf.total?.currency, 'USD');
  assert.equal(lf.currency?.value, 'USD');
  assert.equal(lf.paid_status?.value, 'unpaid');
  assert.deepEqual(lf.parties.map(p => [p.name, p.role]), [['Petrolera del Orinoco S.A.', 'Bill To'], ['Alpha Technical Centre Ltd', 'From']]);
  assert.deepEqual(lf.amounts.map(a => [a.label, a.amount]), [['subtotal', 8400], ['tax', 0], ['total', 8400]]);
  const facts = [lf.reference!.quote, lf.dates.issue!.quote, lf.dates.due!.quote, lf.total!.quote, lf.paid_status!.quote, ...lf.parties.map(p => p.quote), ...lf.amounts.map(a => a.quote)];
  for (const q of facts) assert.ok(quoteInText(INVOICE, q), `quote not in text: ${q}`);
  const flat = flatten(lf);
  assert.deepEqual([flat.reference, flat.amount, flat.currency, flat.issue_date, flat.due_date, flat.paid_status, flat.partners_only], ['ATC-2026-014', 8400, 'USD', '2026-08-03', '2026-09-02', 'unpaid', true]);
});

test('invoice: paid status from "paid in full" or a zero balance, and a due date from "Net 30"', () => {
  const paid = extractLegalFinanceHeuristic('Invoice No: INV-9\nInvoice Date: 1 May 2026\nTotal: EUR 1.250,00\nBalance due: EUR 0,00\nPayment terms: Net 30\n', 'invoice');
  assert.equal(paid.paid_status?.value, 'paid');
  assert.equal(paid.total?.amount, 1250);
  assert.equal(paid.total?.currency, 'EUR');
  assert.equal(paid.dates.due?.value, '2026-05-31');
  assert.equal(paid.dates.due?.derived, true);
});

test('other types: insurance period and amounts, contract governing law and expiry in Spanish', () => {
  const ins = extractLegalFinanceHeuristic('CERTIFICATE OF INSURANCE\nPolicy No: PL-77821\nInsured: Alpha Technical Centre Ltd\nInsurer: Lloyd Marine Ltd\nPeriod of insurance from 1 April 2026 to 31 March 2027\nLimit of liability: USD 5,000,000\nPremium: GBP 4,200.00\n', 'insurance');
  assert.equal(ins.dates.effective?.value, '2026-04-01');
  assert.equal(ins.dates.expiry?.value, '2027-03-31');
  assert.ok(ins.amounts.some(a => a.label === 'limit' && a.amount === 5000000 && a.currency === 'USD'));
  assert.ok(ins.amounts.some(a => a.label === 'premium' && a.currency === 'GBP'));
  assert.equal(ins.reference?.value, 'PL-77821');
  const es = extractLegalFinanceHeuristic('CONTRATO DE SERVICIOS\nEste contrato se regirá por las leyes de Colombia, sin considerar sus normas de conflicto.\nFecha de vencimiento: 31 de diciembre de 2027\n', 'contract');
  assert.equal(es.governing_law?.value, 'Colombia');
  assert.equal(es.dates.expiry?.value, '2027-12-31');
});

test('the provider pass: JSON is validated with zod, only quoted facts are kept, heuristics are never overwritten', async () => {
  const base = extractLegalFinanceHeuristic('Service agreement between Alpha Ltd ("Supplier") and Beta S.A. ("Client").\nSigned in Bogota.\nThe Client will pay a licence fee of USD 10,000 per year.', 'contract');
  assert.equal(base.dates.effective, undefined);
  const provider = new FakeProvider(() => '```json\n' + JSON.stringify({
    parties: [{ name: 'Gamma Corp', role: 'Guarantor', quote: 'guaranteed by Gamma Corp' }, { name: 'Alpha Ltd', role: 'Someone else', quote: 'Alpha Ltd ("Supplier")' }],
    dates: { effective: { value: '2026-05-05', quote: 'Signed in Bogota' }, expiry: { value: '2031-05-05', quote: 'expires on the fifth of May 2031, as invented' } },
    amounts: [{ label: 'fee', amount: 10000, currency: 'USD', quote: 'licence fee of USD 10,000 per year' }],
    governing_law: { value: 'Colombia', quote: 'Signed in Bogota' },
  }) + '\n```');
  const lf = await extractLegalFinance('Service agreement between Alpha Ltd ("Supplier") and Beta S.A. ("Client").\nSigned in Bogota.\nThe Client will pay a licence fee of USD 10,000 per year.', 'contract', { provider });
  assert.equal(lf.method, 'heuristic+llm');
  assert.equal(lf.dates.effective?.value, '2026-05-05', 'a quoted fact fills a gap');
  assert.equal(lf.dates.expiry, undefined, 'a quote that is not in the document is dropped');
  assert.ok(!lf.parties.some(p => p.name === 'Gamma Corp'), 'invented party dropped');
  assert.equal(lf.parties.find(p => p.name === 'Alpha Ltd')?.role, 'Supplier', 'heuristic role kept');
  assert.equal(lf.governing_law?.value, 'Colombia');

  const text = 'Invoice Number: X-1\nTotal: USD 5.00';
  const junk = mergeLlm(extractLegalFinanceHeuristic(text, 'invoice'), { parties: 'nope', dates: 3 }, text);
  assert.equal(junk.used, false);
  for (const reply of ['not json at all', '{"dates":{"issue":{"value":"not a date","quote":"Invoice Number"}}}']) {
    const r = await extractLegalFinance(text, 'invoice', { provider: new FakeProvider(() => reply) });
    assert.equal(r.method, 'heuristic');
    assert.equal(r.dates.issue, undefined);
  }
  const broken = await extractLegalFinance(text, 'invoice', { provider: new FakeProvider(() => { throw new Error('down'); }) });
  assert.equal(broken.reference?.value, 'X-1');
});

// ── through the API: extracted facts on the item, partners only, and the nda-expiry review row ──
const item = async (id: string) => (await h.db.query<any>('SELECT * FROM items WHERE id = $1', [id])).rows[0];
const reviews = async (id: string) => (await h.db.query<any>(`SELECT * FROM review_queue WHERE kind = 'nda-expiry' AND payload->>'item_id' = $1 ORDER BY created_at`, [id])).rows;

test('an uploaded NDA is typed, extracted with quotes, flagged partners-only, and proposes the client\'s legal-tag expiry', async () => {
  const r = await h.upload([{ name: 'nda-orinoco.txt', bytes: NDA, type: 'text/plain' }]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const x = r.body.results[0];
  assert.equal(x.type, 'nda');
  assert.equal(x.status, 'ingested');
  const it = await item(x.item_id);
  assert.equal(it.type, 'nda');
  assert.equal(it.extracted.partners_only, true);
  assert.deepEqual(it.extracted.parties, ['Petrolera del Orinoco S.A.', 'Alpha Technical Centre Ltd']);
  assert.equal(it.extracted.effective_date, '2026-02-14');
  assert.equal(it.extracted.expiry_date, '2029-02-13');
  assert.equal(it.extracted.governing_law, 'England and Wales');
  assert.match(it.extracted.legal_finance.dates.expiry.quote, /three \(3\) years from the Effective Date/);
  for (const c of (await h.db.query<any>('SELECT partners_only FROM chunks WHERE item_id = $1', [it.id])).rows) assert.equal(c.partners_only, true);

  const rows = await reviews(it.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'open');
  assert.equal(rows[0].payload.proposed_expires_at, '2029-02-13');
  assert.equal(rows[0].payload.current_expires_at, '2028-02-13');
  assert.equal(rows[0].payload.legal_tag, 'lt-orinoco-nda-2026');
  assert.equal(rows[0].payload.client_id, 'petrolera-del-orinoco');
  assert.match(rows[0].payload.evidence, /three \(3\) years/);

  // re-indexing does not queue a second proposal
  assert.equal((await h.app.request(`/api/ingest/reindex/${it.id}`, { method: 'POST' })).status, 200);
  assert.equal((await reviews(it.id)).length, 1);
});

test('an NDA whose expiry equals the tag already in force proposes nothing', async () => {
  const same = NDA.replace('three (3) years', 'two (2) years').replace('Mutual', 'Second');
  const r = await h.upload([{ name: 'nda-second.txt', bytes: same, type: 'text/plain' }]);
  const it = await item(r.body.results[0].item_id);
  assert.equal(it.extracted.expiry_date, '2028-02-13');
  assert.equal((await reviews(it.id)).length, 0);
});

test('an uploaded invoice is typed, extracted, partners-only, and creates no NDA review', async () => {
  const r = await h.upload([{ name: 'invoice-atc-2026-014.txt', bytes: INVOICE, type: 'text/plain' }]);
  const x = r.body.results[0];
  assert.equal(x.type, 'invoice');
  const it = await item(x.item_id);
  assert.deepEqual([it.extracted.reference, it.extracted.amount, it.extracted.currency, it.extracted.issue_date, it.extracted.due_date, it.extracted.paid_status, it.extracted.partners_only],
    ['ATC-2026-014', 8400, 'USD', '2026-08-03', '2026-09-02', 'unpaid', true]);
  assert.ok(quoteInText(INVOICE, it.extracted.legal_finance.total.quote));
  assert.equal((await reviews(it.id)).length, 0);
  assert.ok(!('legal_finance' in (await item((await h.upload([{ name: 'plain-notes.md', bytes: '# Notes\n\nNothing legal here at all, just notes about wells.', type: 'text/markdown' }])).body.results[0].item_id)).extracted));
});
