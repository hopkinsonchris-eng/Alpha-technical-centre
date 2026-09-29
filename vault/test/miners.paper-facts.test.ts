import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider, type LlmRequest } from '../src/llm/provider.ts';
import { assembleRow, extractPaperFacts, MIN_ABSTRACT_CHARS, numericProperties, parseModelJson, quoteInText, SYSTEM_PROMPT } from '../src/miners/paper-facts.ts';
import { itemFromRecord, upsertItem } from '../src/miners/run.ts';
import { validate } from '../src/schemas.ts';
import { fxJson, testDb } from './miners.helpers.ts';

const fixture = fxJson('papers-20.json') as { papers: { n: number; title: string; doi: string; authored_at: string; abstract: string }[]; replies: Record<string, { kind: string; body: any }> };
let db: Awaited<ReturnType<typeof testDb>>['db'];
let storage: Awaited<ReturnType<typeof testDb>>['storage'];
const idByTitle = new Map<string, string>();
const requests: LlmRequest[] = [];

/** The fake model: answers each paper from the fixture, looked up by the TITLE line of the prompt. */
const fake = new FakeProvider(req => {
  requests.push(req);
  const title = /^TITLE: (.*)$/m.exec(req.messages.at(-1)!.content)?.[1] ?? '';
  const r = fixture.replies[title];
  if (!r) return '{}';
  const json = JSON.stringify(r.body);
  return r.kind === 'json' ? json : r.kind === 'fenced' ? `Here is the extraction:\n\`\`\`json\n${json}\n\`\`\`\nLet me know if you need more.` : String(r.body);
});

before(async () => {
  ({ db, storage } = await testDb());
  for (const p of fixture.papers) {
    const rec = { external_id: p.doi, url: `https://doi.org/${p.doi}`, title: p.title, authored_at: p.authored_at, authors: ['A. Author'], text: p.abstract, meta: { doi: p.doi } };
    idByTitle.set(p.title, (await upsertItem(db, storage, itemFromRecord('crossref', rec, new Date('2026-09-29T00:00:00Z')))).id);
  }
});
after(async () => { await db.close(); });

const NOW = new Date('2026-09-29T07:00:00Z');
let summary: Awaited<ReturnType<typeof extractPaperFacts>>;

test('acceptance 3: the 20-paper fixture yields rows that validate, with an evidence quote for every numeric property', async () => {
  assert.equal(fixture.papers.length, 20);
  summary = await extractPaperFacts(db, { provider: fake, storage, now: NOW });
  assert.equal(summary.skipped_short, 3, 'papers 18-20 have abstracts under 400 characters');
  assert.equal(summary.considered, 17);
  assert.equal(summary.extracted, 16);
  assert.equal(summary.failed.length, 1, 'paper 7 came back as prose, not JSON');
  assert.equal(summary.failed[0].item_id, idByTitle.get(fixture.papers[6].title));
  assert.equal(summary.rows, 16);
  assert.ok(summary.dropped_properties >= 5);
  assert.equal(requests.length, 17, 'short abstracts never reach the model');
  assert.ok(requests.every(r => !/full text/i.test(r.messages[0].content)));

  const rows = (await db.query<any>('SELECT * FROM analogue_rows ORDER BY source_ref')).rows;
  assert.equal(rows.length, 16);
  const numeric = new Set(numericProperties());
  let numericSeen = 0;
  for (const r of rows) {
    assert.deepEqual(validate('analogue-row', r.row), [], r.source_ref);
    assert.equal(r.provenance, 'paper');
    assert.equal(r.legal_tag, 'lt-public');
    assert.match(r.source_ref, /^doc:[0-9a-f-]{36}$/);
    const item = fixture.papers.find(p => idByTitle.get(p.title) === r.source_ref.slice(4))!;
    assert.ok(item, 'source_ref points at a paper item');
    assert.equal(r.as_of.toISOString().slice(0, 10), item.authored_at.slice(0, 10));
    const evidence = new Map<string, any>((r.row.evidence ?? []).map((e: any) => [e.property, e]));
    for (const [prop, val] of Object.entries<any>(r.row)) {
      if (!numeric.has(prop)) continue;
      numericSeen++;
      const ev = evidence.get(prop);
      assert.ok(ev?.quote, `${r.source_ref} ${prop} has an evidence quote`);
      assert.ok(quoteInText(ev.quote, item.abstract, true), `${prop} quote "${ev.quote}" occurs in the abstract`);
      assert.equal(typeof val.value, 'number');
      assert.ok(['measured', 'reported', 'analogue', 'assumed', 'calculated'].includes(val.provenance));
    }
    for (const p of evidence.keys()) assert.ok(numeric.has(p), 'evidence only for numeric properties');
    assert.match(r.row.extracted_by, /^fake:fake-1$/);
  }
  assert.ok(numericSeen >= 50, `expected many numeric properties, saw ${numericSeen}`);
});

test('the model is not trusted: unquoted, unverifiable, unknown and out-of-enum output is dropped, not stored', async () => {
  const row = async (n: number) => (await db.query<any>('SELECT row FROM analogue_rows WHERE source_ref = $1', [`doc:${idByTitle.get(fixture.papers[n - 1].title)}`])).rows[0]?.row;
  const p4 = await row(4);
  assert.equal(p4.stoiip_mmbbl, undefined, 'no quote');
  assert.equal(p4.eur_mmbbl, undefined, 'quote is not in the abstract');
  assert.ok(p4.oil_viscosity_cp, 'the legitimate numbers survive');
  const p5 = await row(5);
  assert.equal(p5.lithology, undefined, 'sandstone is not in the schema enum');
  assert.equal(p5.skin_factor, undefined);
  assert.equal(p5.net_pay_m, undefined, 'a quote with no digit cannot support a number');
  assert.equal(p5.drive_mechanism, 'eor-polymer');
  assert.ok(await row(6), 'fenced JSON with prose around it is parsed');
  assert.equal(await row(7), undefined);
  const p8 = await row(8);
  assert.ok(p8.oil_viscosity_cp ?? p8.api_gravity, 'quotes match regardless of case and spacing');
  const p9 = await row(9);
  const first = Object.values<any>(p9).find(v => v && typeof v === 'object' && 'value' in v);
  assert.equal(first.low, undefined); assert.equal(first.high, undefined);
  assert.equal(first.provenance, 'reported');
});

test('master data: known fields and basins resolve to ids, others fall back to paper:<doc>', async () => {
  const get = async (n: number) => (await db.query<any>('SELECT asset_id, row FROM analogue_rows WHERE source_ref = $1', [`doc:${idByTitle.get(fixture.papers[n - 1].title)}`])).rows[0];
  const rubiales = await get(1);
  assert.equal(rubiales.asset_id, 'field:llanos:rubiales');
  assert.equal(rubiales.row.basin_id, 'basin:llanos');
  assert.equal(rubiales.row.country, 'CO');
  assert.equal(rubiales.row.fluid_type, 'heavy-oil');
  const pelican = await get(4);
  assert.equal(pelican.asset_id, `paper:${idByTitle.get(fixture.papers[3].title)}`);
});

test('the item carries a paper_facts block with verified evidence; its bytes and version are untouched', async () => {
  const it = (await db.query<any>('SELECT extracted, version, content_hash FROM items WHERE id = $1', [idByTitle.get(fixture.papers[0].title)])).rows[0];
  const pf = it.extracted.paper_facts;
  assert.ok(pf);
  assert.equal(pf.study_type, 'field performance review');
  assert.ok(pf.findings.length === 1 && pf.findings[0].quote);
  assert.ok(pf.evidence.length >= 4);
  assert.ok(pf.row_id);
  assert.equal(it.version, 1);
  assert.equal(it.extracted.manifest.sha256, it.content_hash.slice(7));
  const short = (await db.query<any>('SELECT extracted FROM items WHERE id = $1', [idByTitle.get(fixture.papers[17].title)])).rows[0];
  assert.equal(short.extracted.paper_facts, undefined, 'short abstracts are skipped, not extracted');
});

test('running again writes no duplicate rows; the failed paper is retried', async () => {
  const s = await extractPaperFacts(db, { provider: fake, storage, now: NOW });
  assert.equal(s.considered, 1);
  assert.equal(s.extracted, 0);
  assert.equal(s.failed.length, 1);
  assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM analogue_rows')).rows[0].n, 16);
  assert.equal((await db.query<any>('SELECT count(DISTINCT source_ref)::int AS n FROM analogue_rows')).rows[0].n, 16);
});

test('assembleRow: guards in isolation', () => {
  const ctx = { docId: '00000000-0000-4000-8000-000000000001', legalTag: 'lt-public', abstract: 'The reservoir has permeability of 250 md and 30% porosity.', authoredAt: null, now: NOW, extractedBy: 'fake:fake-1' };
  const a = assembleRow({
    country: 'colombia', categorical: { drive_mechanism: 'magic', method: ['analogy', 'guessing'], notes: 'x' },
    numeric: [
      { property: 'permeability_md', value: 250, quote: 'permeability of 250 md' },
      { property: 'porosity_frac', value: 0.3, quote: '30% porosity', low: 0.2, high: 0.4 },
      { property: 'permeability_md', value: 300, quote: 'permeability of 250 md' },
      { property: 'depth_m', value: 'deep', quote: 'depth of 2 m' },
    ],
  }, ctx);
  assert.equal(a.row.country, undefined, 'not an ISO code');
  assert.equal(a.row.drive_mechanism, undefined);
  assert.deepEqual(a.row.method, ['analogy']);
  assert.equal(a.row.as_of, NOW.toISOString().slice(0, 10), 'no publication date: the extraction date');
  assert.deepEqual(a.row.porosity_frac, { value: 0.3, provenance: 'reported', low: 0.2, high: 0.4 });
  assert.deepEqual(a.row.evidence.map((e: any) => e.property), ['permeability_md', 'porosity_frac']);
  assert.deepEqual(a.dropped.map(d => d.property).sort(), ['depth_m', 'drive_mechanism', 'permeability_md']);
  assert.deepEqual(validate('analogue-row', a.row), []);
  assert.throws(() => assembleRow('nope', ctx), /not a JSON object/);
  assert.throws(() => parseModelJson('no braces here'), /no JSON object/);
  assert.equal(MIN_ABSTRACT_CHARS, 400);
  assert.match(SYSTEM_PROMPT(), /porosity_frac/);
});
