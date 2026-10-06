/**
 * Web search as a research source (wave 4, W4-D1 revised; 05-markup.md §1.4.8). The model searches through
 * the Messages API's server-side web search tool and writes short cited sentences; only what the API cites
 * is filed, each finding carrying the page URL and the API's verbatim `cited_text`. Nothing comes from the
 * model's memory: a sentence without a citation files nothing.
 */
import type { LlmProvider, LlmUsage, WebCitation, WebSearchResult } from '../llm/provider.ts';
import type { Finding } from './findings.ts';

export const RESEARCH_WEB_OFF = 'web search is switched off (RESEARCH_WEB=false on the Vault service)';
export function researchWebEnabled(env = process.env): boolean { return !/^(false|0|off)$/i.test(env.RESEARCH_WEB ?? ''); }

const SYSTEM = [
  'You research one oil or gas field, block or company for an engineering consultancy. Use web search, then report only what the pages say.',
  'Write short plain sentences, one fact each, every sentence drawn from a page you found: the operator and partners, the licence, block or contract, production and reserves with their dates and units, the basin and reservoir, recent news, technical papers or reports about it.',
  'Do not add anything you did not find. If the searches find nothing about it, say "Nothing found." and stop.',
].join('\n');

export interface WebQuery { label: string; query: string; field_id: string | null }

/** The findings for one name: one per cited page, the API's cited text as the quote. */
export function webFindings(q: WebQuery, r: WebSearchResult): Finding[] {
  const byUrl = new Map<string, { title: string | null; excerpts: string[]; sentences: string[] }>();
  for (const c of r.citations) {
    if (!c.url || !c.cited_text) continue;
    const e = byUrl.get(c.url) ?? { title: c.title ?? null, excerpts: [], sentences: [] };
    if (!e.excerpts.includes(c.cited_text)) e.excerpts.push(c.cited_text);
    if (c.sentence && !e.sentences.includes(c.sentence)) e.sentences.push(c.sentence);
    if (!e.title && c.title) e.title = c.title;
    byUrl.set(c.url, e);
  }
  const out: Finding[] = [];
  for (const [url, e] of byUrl) {
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = ''; }
    const result = r.results.find(x => x.url === url);
    out.push({ source: 'web', external_id: url, url, title: e.title ?? result?.title ?? host ?? url, text: e.excerpts[0], published_at: null, authors: [], query: q.query, asset_ids: q.field_id ? [q.field_id] : [],
      facts: { host, excerpts: e.excerpts, summary: e.sentences.join(' '), page_age: result?.page_age ?? null, searched: q.label } });
  }
  return out;
}

export async function searchWeb(provider: LlmProvider, q: WebQuery, countryName: string | null, maxUses: number): Promise<WebSearchResult> {
  if (!provider.search) return { text: '', usage: { input: 0, cached: 0, output: 0 }, model: provider.model, searches: 0, citations: [], results: [], error: 'the provider has no web search' };
  const prompt = `Research "${q.label}"${countryName ? ` in ${countryName}` : ''} (an oil and gas field, block or company). Search for: ${q.query}`;
  return provider.search({ system: SYSTEM, prompt, maxUses, purpose: 'research.search' });
}

export type { WebCitation, LlmUsage };
