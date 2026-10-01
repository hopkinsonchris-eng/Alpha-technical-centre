// Wave 4, W4-D1 revised (docs/vault-hub/wave4/05-markup.md §1.4.8): the two added sources, read on their
// own. The Global Energy Monitor wiki page becomes one note and one finding per reference it cites, with no
// model (W4-AC9, parser part). Web search goes through the provider's server-side tool: only API-cited
// sentences become findings, each with the page URL and the verbatim cited text; a pause_turn is resumed
// once; a switched-off organisation is an error, not a crash (W4-AC10, provider part).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGemWiki, fetchGemWiki, gemWikiFindings, GEM_ATTRIBUTION } from '../src/research/gemwiki.ts';
import { webFindings, searchWeb, researchWebEnabled } from '../src/research/web.ts';
import { AnthropicProvider, FakeProvider, readWebSearch } from '../src/llm/provider.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'research');
const HTML = readFileSync(path.join(FIX, 'gem-guafita.html'), 'utf8');
const URL_ = 'https://www.gem.wiki/Guafita_Oil_Field_(Venezuela)';

test('W4-AC9: a GEM wiki page gives its title, lead sentence, flattened facts and the external references it cites, never its own pages', () => {
  const p = parseGemWiki(HTML, URL_);
  assert.equal(p.title, 'Guafita Oil Field (Venezuela)');
  assert.equal(p.lead, 'Guafita Oil Field is an operating oil field in Venezuela.');
  assert.ok(p.text.startsWith('Guafita Oil Field is an operating oil field in Venezuela. | Project Details'), p.text.slice(0, 120));
  assert.ok(p.text.includes('Guafita operating PDVSA 1984') && p.text.includes('production 12.4 thousand bbl/d 2024'), 'tables are flattened and the [n] markers go');
  assert.ok(!/Articles and Resources|Additional Data|Report an error|This article is part of/.test(p.text), 'banner and boilerplate are dropped');
  assert.deepEqual(p.references, [
    { url: 'https://eprinc.org/wp-content/uploads/2021/09/The-Future-of-Venezuela%E2%80%99s-Oil-Industry.pdf', title: null },
    { url: 'https://www.reuters.com/business/energy/pdvsa-restarts-guafita-2026-09-30/', title: 'PDVSA restarts Guafita field with Chinese partner. Reuters. 30 September 2026' },
    { url: 'https://web.archive.org/web/20240108230410/https://pubs.usgs.gov/of/1980/0782/plate-1.pdf', title: null },
  ]);
  const f = gemWikiFindings({ id: 'field:ve:guafita', name: 'Guafita' }, p);
  assert.equal(f.length, 4);
  assert.equal(f[0].source, 'gem-wiki'); assert.equal(f[0].external_id, URL_); assert.equal(f[0].title, 'Global Energy Monitor: Guafita'); assert.deepEqual(f[0].asset_ids, ['field:ve:guafita']);
  assert.equal(f[0].facts!.attribution, GEM_ATTRIBUTION); assert.ok(f[0].text.startsWith('Guafita Oil Field is an operating oil field'));
  assert.equal(f[1].source, 'gem-wiki-ref'); assert.equal(f[1].url, p.references[0].url); assert.equal(f[1].title, 'Source cited by Global Energy Monitor for Guafita (eprinc.org)');
  assert.equal(f[2].title, 'PDVSA restarts Guafita field with Chinese partner. Reuters. 30 September 2026'); assert.equal(f[2].external_id, f[2].url);
  assert.equal(f[3].title, 'Source cited by Global Energy Monitor for Guafita (web.archive.org)');
});

test('W4-AC9: fetching a page times out, reports an HTTP status, and reads a real answer', async () => {
  const slow = (async (_u: string, init: any) => new Promise<Response>((_, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); })) as unknown as typeof fetch;
  const r1 = await fetchGemWiki(URL_, slow, 20);
  assert.deepEqual(r1, { ok: false, reason: 'gem.wiki timed out' });
  const r2 = await fetchGemWiki(URL_, (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch);
  assert.deepEqual(r2, { ok: false, reason: 'gem.wiki answered HTTP 404' });
  const r3 = await fetchGemWiki(URL_, (async () => new Response(HTML, { status: 200 })) as unknown as typeof fetch);
  assert.ok(r3.ok && r3.page.references.length === 3);
  const r4 = await fetchGemWiki(URL_, (async () => new Response('<html><body><div id="mw-content-text"></div></body></html>', { status: 200 })) as unknown as typeof fetch);
  assert.deepEqual(r4, { ok: false, reason: 'gem.wiki page has no article text' });
});

const RESPONSE = {
  id: 'msg_1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
  content: [
    { type: 'text', text: "I'll search for the Guafita field." },
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Guafita oil field Venezuela operator production' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
      { type: 'web_search_result', url: 'https://www.reuters.com/x/guafita', title: 'PDVSA restarts Guafita', encrypted_content: 'xx', page_age: 'September 30, 2026' },
      { type: 'web_search_result', url: 'https://example.org/uncited', title: 'Not cited', encrypted_content: 'yy', page_age: null },
    ] },
    { type: 'text', text: 'PDVSA operates the Guafita field in Apure state. ', citations: [{ type: 'web_search_result_location', url: 'https://www.reuters.com/x/guafita', title: 'PDVSA restarts Guafita', encrypted_index: 'e1', cited_text: 'PDVSA restarts the Guafita field with Chinese partner' }] },
    { type: 'text', text: 'The field produces about 12,400 bopd. ', citations: [{ type: 'web_search_result_location', url: 'https://www.reuters.com/x/guafita', title: 'PDVSA restarts Guafita', encrypted_index: 'e2', cited_text: 'output has recovered to 12,400 barrels per day' }] },
    { type: 'text', text: 'It lies in the Barinas-Apure basin.' },
  ],
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 2 } },
};

test('W4-AC10: the response reader keeps the cited sentences, the search results and the search count', () => {
  const r = readWebSearch(RESPONSE, 'claude-sonnet-5-5');
  assert.equal(r.searches, 2); assert.equal(r.usage.input, 1200); assert.equal(r.results.length, 2);
  assert.equal(r.citations.length, 2);
  assert.deepEqual(r.citations[1], { url: 'https://www.reuters.com/x/guafita', title: 'PDVSA restarts Guafita', cited_text: 'output has recovered to 12,400 barrels per day', sentence: 'The field produces about 12,400 bopd.' });
  const err = readWebSearch({ content: [{ type: 'web_search_tool_result', tool_use_id: 'x', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }], usage: {} }, 'm');
  assert.equal(err.error, 'web search error: max_uses_exceeded'); assert.equal(err.searches, 0);
});

test('W4-AC10: one finding per cited page with the verbatim cited text as the quote; uncited results file nothing', () => {
  const r = readWebSearch(RESPONSE, 'claude-sonnet-5-5');
  const f = webFindings({ label: 'Guafita', query: '"Guafita" Venezuela', field_id: 'field:ve:guafita' }, r);
  assert.equal(f.length, 1, 'the uncited result is not a finding');
  assert.equal(f[0].source, 'web'); assert.equal(f[0].url, 'https://www.reuters.com/x/guafita'); assert.equal(f[0].external_id, f[0].url);
  assert.equal(f[0].title, 'PDVSA restarts Guafita'); assert.equal(f[0].text, 'PDVSA restarts the Guafita field with Chinese partner', 'the quote is the API\'s cited text, verbatim');
  assert.deepEqual(f[0].facts!.excerpts, ['PDVSA restarts the Guafita field with Chinese partner', 'output has recovered to 12,400 barrels per day']);
  assert.equal(f[0].facts!.summary, 'PDVSA operates the Guafita field in Apure state. The field produces about 12,400 bopd.');
  assert.equal(f[0].facts!.page_age, 'September 30, 2026'); assert.deepEqual(f[0].asset_ids, ['field:ve:guafita']);
});

test('W4-AC10: the Anthropic provider sends the server tool with max_uses, resumes one pause_turn, and surfaces a switched-off organisation as an error', async () => {
  const calls: any[] = [];
  const paused = { ...RESPONSE, stop_reason: 'pause_turn', content: RESPONSE.content.slice(0, 3), usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } };
  let n = 0;
  const fetchImpl = (async (_u: string, init: any) => { const b = JSON.parse(init.body); calls.push(b); n++; return Response.json(n === 1 ? paused : RESPONSE); }) as unknown as typeof fetch;
  const p = new AnthropicProvider('k', 'claude-sonnet-5-5', fetchImpl);
  const r = await p.search({ system: 'S', prompt: 'P', maxUses: 3 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]);
  assert.equal(calls[0].output_config.effort, 'low'); assert.equal(calls[0].messages.length, 1);
  assert.equal(calls[1].messages.length, 2); assert.equal(calls[1].messages[1].role, 'assistant'); assert.deepEqual(calls[1].messages[1].content, paused.content, 'the paused assistant content goes back unchanged');
  assert.equal(r.searches, 3); assert.equal(r.citations.length, 2); assert.equal(r.usage.input, 1300);
  const off = new AnthropicProvider('k', 'claude-sonnet-5-5', (async () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Web search is not enabled for this organization."}}', { status: 400 })) as unknown as typeof fetch);
  await assert.rejects(() => off.search({ system: 'S', prompt: 'P', maxUses: 1 }), /anthropic 400: .*Web search is not enabled/);
  // The fake answers what the test says, and the module reports a provider without search.
  const fake = new FakeProvider(undefined, () => ({ citations: [{ url: 'https://a.example/x', title: 'A', cited_text: 'quoted', sentence: 'S.' }], searches: 2 }));
  const fr = await searchWeb(fake, { label: 'Guafita', query: '"Guafita" Venezuela', field_id: null }, 'Venezuela', 3);
  assert.equal(fr.searches, 2); assert.equal(fr.citations[0].cited_text, 'quoted');
  const none = await searchWeb({ name: 'x', model: 'm', complete: async () => ({ text: '', usage: { input: 0, cached: 0, output: 0 }, model: 'm', provider: 'x' }) }, { label: 'G', query: 'q', field_id: null }, null, 1);
  assert.equal(none.error, 'the provider has no web search');
  process.env.RESEARCH_WEB = 'false'; assert.equal(researchWebEnabled(), false); delete process.env.RESEARCH_WEB; assert.equal(researchWebEnabled(), true);
});
