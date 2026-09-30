import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { approxTokens, chunkText, contextualise, templateContext, TARGET_TOKENS } from '../src/ingest/chunk.ts';
import { EMBED_DIMS, FakeEmbedder, openEmbedder, VoyageEmbedder } from '../src/ingest/embed.ts';
import { FakeProvider, type LlmRequest } from '../src/llm/provider.ts';
import { paragraphs } from './fixtures/ingest/build.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';

const doc = (n: number) => paragraphs(n).join('\n\n') + '\n';

test('chunk count is within 10% of chars/4/600 for documents of several sizes', () => {
  for (const n of [40, 90, 160, 400]) {
    const text = doc(n);
    const expected = text.length / 4 / TARGET_TOKENS;
    const chunks = chunkText(text);
    assert.ok(chunks.length >= expected * 0.9 && chunks.length <= expected * 1.1, `${n} paragraphs: ${chunks.length} chunks, expected ${expected.toFixed(1)} ±10%`);
    chunks.forEach((c, i) => assert.equal(c.ordinal, i));
  }
});

test('chunks are ~600 tokens of own content and each carries ~15% overlap from the one before', () => {
  const text = doc(120);
  const chunks = chunkText(text);
  assert.ok(chunks.length > 10);
  assert.equal(chunks[0].overlap, 0);
  for (const c of chunks.slice(0, -1)) assert.ok(approxTokens(c.text) <= TARGET_TOKENS * 1.5, `chunk too large: ${approxTokens(c.text)} tokens`);
  const middle = chunks.slice(1, -1);
  for (const c of middle) {
    assert.ok(c.overlap > 0 && c.overlap <= 2400 * 0.15 + 2, `overlap ${c.overlap}`);
    const own = c.text.slice(c.overlap);
    assert.ok(approxTokens(own) >= TARGET_TOKENS * 0.5 && approxTokens(own) <= TARGET_TOKENS * 1.4, `own content ${approxTokens(own)} tokens`);
  }
  // the overlap is the tail of the previous chunk's text
  for (let i = 1; i < chunks.length; i++) {
    const pre = chunks[i].text.slice(0, chunks[i].overlap).trim();
    assert.ok(chunks[i - 1].text.includes(pre), `chunk ${i} overlap is not the end of chunk ${i - 1}`);
  }
  // every paragraph appears in some chunk (nothing dropped)
  const all = chunks.map(c => c.text).join('\n');
  for (const p of paragraphs(120)) assert.ok(all.includes(p.slice(0, 60)));
});

test('paragraph boundaries are respected: no chunk starts or ends mid-paragraph when paragraphs are small', () => {
  const ps = paragraphs(60);
  const chunks = chunkText(ps.join('\n\n'));
  for (const c of chunks) {
    const own = c.text.slice(c.overlap).trim();
    assert.ok(ps.some(p => p.startsWith(own.slice(0, 40))), 'own content starts at a paragraph start');
    assert.ok(ps.some(p => p.endsWith(own.slice(-40))), 'own content ends at a paragraph end');
  }
});

test('a table that fits stays whole; a huge table splits by rows with its header repeated', () => {
  const row = (i: number) => `| CB-${i} | Carabobo | ${400 + i} |`;
  const small = ['## Sheet: Wells', '| Well | Field | Rate |', '| --- | --- | --- |', ...Array.from({ length: 10 }, (_, i) => row(i))].join('\n');
  const text = `${paragraphs(4).join('\n\n')}\n\n${small}\n\n${paragraphs(3).join('\n\n')}\n`;
  const withTable = chunkText(text).filter(c => c.text.includes('| CB-'));
  assert.equal(withTable.length, 1, 'the small table is not split across chunks');
  assert.ok(withTable[0].text.includes(row(9)) && withTable[0].text.includes(row(0)));

  const big = ['| Well | Field | Rate |', '| --- | --- | --- |', ...Array.from({ length: 900 }, (_, i) => row(i))].join('\n');
  const chunks = chunkText(big);
  assert.ok(chunks.length > 3);
  for (const c of chunks) {
    assert.ok(c.text.includes('| Well | Field | Rate |'), 'header repeated');
    for (const l of c.text.split('\n')) assert.ok(l === '' || l.endsWith('|'), `row cut in half: ${l}`);
  }
});

test('anchors: a chunk records the anchor in force where its own content starts', () => {
  const text = `## Page 1\n\n${paragraphs(20, 'A').join('\n\n')}\n\n## Page 2\n\n${paragraphs(20, 'B').join('\n\n')}\n`;
  const anchors = [{ label: 'page 1', offset: 0 }, { label: 'page 2', offset: text.indexOf('## Page 2') }];
  const chunks = chunkText(text, anchors);
  assert.equal(chunks[0].anchor, 'page 1');
  assert.equal(chunks.at(-1)!.anchor, 'page 2');
  assert.ok(chunks.every(c => c.anchor));
});

test('contextualise: one call per chunk, document in the system prompt, every chunk gets a 50-100 token context', async () => {
  const chunks = chunkText(doc(60), [{ label: 'Terms', offset: 0 }]);
  const seen: LlmRequest[] = [];
  const provider = new FakeProvider(req => { seen.push(req); return `This chunk is from "Screening report", section Terms, about cold production economics for Carabobo (${req.messages[0].content.length}).`; });
  const out = await contextualise(chunks, { title: 'Screening report', type: 'report', text: doc(60) }, provider);
  assert.equal(seen.length, chunks.length);
  assert.ok(seen.every(r => r.system.includes('Screening report') && r.system.includes('Section 1.')), 'whole document rides in the (cacheable) system prompt');
  assert.equal(out.length, chunks.length);
  for (const c of out) { assert.match(c.context, /^This chunk is from "Screening report", section Terms/); assert.ok(approxTokens(c.context) <= 100); }
  assert.ok(chunks.every(c => c.context === ''), 'input chunks are not mutated');
});

test('contextualise with the default FakeProvider is deterministic and names the title and section', async () => {
  const chunks = chunkText(doc(30), [{ label: 'Scope', offset: 0 }]);
  const a = await contextualise(chunks, { title: 'NDA Orinoco' }, new FakeProvider());
  const b = await contextualise(chunks, { title: 'NDA Orinoco' }, new FakeProvider());
  assert.deepEqual(a.map(c => c.context), b.map(c => c.context));
  for (const c of a) { assert.match(c.context, /NDA Orinoco/); assert.match(c.context, /Scope/); assert.ok(c.context.length > 20 && approxTokens(c.context) <= 100); }
});

test('contextualise falls back to a template context with no provider, a failing provider, or an empty reply', async () => {
  const chunks = chunkText(doc(20));
  for (const provider of [null, new FakeProvider(() => { throw new Error('rate limited'); }), new FakeProvider(() => '   ')]) {
    const out = await contextualise(chunks, { title: 'Report', type: 'report' }, provider);
    for (const [i, c] of out.entries()) assert.equal(c.context, templateContext({ title: 'Report', type: 'report' }, chunks[i]));
  }
  const long = await contextualise(chunks.slice(0, 1), { title: 'R' }, new FakeProvider(() => 'word '.repeat(500)));
  assert.ok(approxTokens(long[0].context) <= 100);
});

test('FakeEmbedder: 1024 dimensions, deterministic, unit length, related texts closer than unrelated ones', async () => {
  const e = new FakeEmbedder();
  const [a, a2, b, c] = await e.embed(['wormhole growth in cold heavy oil production', 'wormhole growth in cold heavy oil production', 'cold production of heavy oil with sand', 'brent price deck for royalty tests']);
  assert.equal(a.length, EMBED_DIMS);
  assert.deepEqual(a, a2);
  const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
  assert.ok(Math.abs(dot(a, a) - 1) < 1e-3);
  assert.ok(dot(a, b) > dot(a, c));
  assert.equal((await e.embed([])).length, 0);
});

test('VoyageEmbedder posts batches with the key, model and 1024 dims, and keeps input order', async () => {
  const calls: any[] = [];
  const fakeFetch = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.authorization, body });
    const data = body.input.map((t: string, i: number) => ({ index: i, embedding: Array.from({ length: 1024 }, () => t.length) })).reverse();
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
  const e = new VoyageEmbedder('key-1', 'voyage-3.5', fakeFetch, 2);
  const out = await e.embed(['a', 'bb', 'ccc']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.voyageai.com/v1/embeddings');
  assert.equal(calls[0].auth, 'Bearer key-1');
  assert.deepEqual([calls[0].body.model, calls[0].body.output_dimension, calls[0].body.input_type], ['voyage-3.5', 1024, 'document']);
  assert.deepEqual(out.map(v => v[0]), [1, 2, 3]);
  const bad = new VoyageEmbedder('k', 'voyage-3.5', (async () => new Response('nope', { status: 400 })) as unknown as typeof fetch);
  await assert.rejects(bad.embed(['x']), /voyage 400/);
});

test('openEmbedder: Voyage with a key, Fake without one, a refusal in production', () => {
  assert.equal(openEmbedder({ VOYAGE_API_KEY: 'k' } as any).name, 'voyage');
  assert.equal(openEmbedder({} as any).name, 'fake');
  assert.throws(() => openEmbedder({ NODE_ENV: 'production' } as any), /VOYAGE_API_KEY/);
});

// ── stored chunks: context prefix and tsvector on every row ───────────────
let h: Harness;
before(async () => { h = await setup('vault-chunk-'); });
after(async () => { await h.db.close(); });

test('ingested chunks all carry a context and a populated tsvector that matches on the context', async () => {
  const text = `# Carabobo screening\n\n${paragraphs(80).join('\n\n')}\n`;
  const r = await h.upload([{ name: 'screening-notes.md', bytes: text, type: 'text/markdown' }]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.results[0].item_id;
  const rows = (await h.db.query<any>(`SELECT context, text, length(tsv) AS tsv_len, embedding IS NOT NULL AS has_vec, anchor FROM chunks WHERE item_id = $1 ORDER BY ordinal`, [id])).rows;
  const expected = text.length / 4 / TARGET_TOKENS;
  assert.ok(rows.length >= expected * 0.9 && rows.length <= expected * 1.1, `${rows.length} stored chunks vs ${expected.toFixed(1)} expected`);
  for (const row of rows) {
    assert.ok(row.context.length > 0, 'context prefix present');
    assert.ok(row.tsv_len > 0, 'tsvector populated');
    assert.ok(row.has_vec);
  }
  // the context is part of the tsvector: FakeProvider's context names the document title, which the chunk text does not contain
  const hit = (await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND tsv @@ plainto_tsquery('simple', 'screening-notes.md')`, [id])).rows[0].n;
  assert.equal(hit, rows.length);
});
