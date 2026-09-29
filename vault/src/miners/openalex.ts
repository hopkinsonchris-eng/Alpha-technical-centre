/**
 * OpenAlex works feed (M11). `from_publication_date` bounds the window; cursor
 * paging follows `meta.next_cursor`. Abstracts arrive as an inverted index and
 * are rebuilt into text. OPENALEX_API_KEY is optional.
 */
import type { FeedAdapter, FeedRecord, TopicSpec } from './types.ts';
import { Http, isoDate, normDoi, q, ymd, type AdapterOptions } from './util.ts';

export interface OpenAlexOptions extends AdapterOptions { apiKey?: string; mailto?: string; base?: string; perPage?: number; maxPagesPerTopic?: number }

const SELECT = 'id,doi,title,publication_date,authorships,abstract_inverted_index,primary_location,cited_by_count,type';

export function abstractFromInverted(idx: Record<string, number[]> | null | undefined): string | undefined {
  if (!idx) return undefined;
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
  const t = words.filter(w => w !== undefined).join(' ').trim();
  return t || undefined;
}

export function createOpenAlexAdapter(o: OpenAlexOptions = {}): FeedAdapter {
  const base = o.base ?? 'https://api.openalex.org';
  const apiKey = o.apiKey ?? process.env.OPENALEX_API_KEY;
  const mailto = o.mailto ?? process.env.MINERS_MAILTO ?? 'chris@alpha-technical-centre.com';
  const http = new Http(5, o, { accept: 'application/json', 'user-agent': `ATC-Vault-Miner/0.1 (mailto:${mailto})` });
  const perPage = o.perPage ?? 100, maxPages = o.maxPagesPerTopic ?? 3;

  return {
    id: 'openalex',
    schedule: 'weekly',
    rateLimit: { perSecond: 5 },
    async *fetch(since: Date, topics: TopicSpec[]): AsyncIterable<FeedRecord> {
      for (const topic of topics) {
        let cursor = '*';
        for (let page = 0; page < maxPages; page++) {
          const url = `${base}/works?search=${q(topic.query)}&filter=from_publication_date:${ymd(since)}&per-page=${perPage}&cursor=${q(cursor)}&select=${SELECT}&mailto=${q(mailto)}${apiKey ? `&api_key=${q(apiKey)}` : ''}`;
          const j = await http.json<{ results?: any[]; meta?: { next_cursor?: string | null } }>(url);
          const results = j.results ?? [];
          for (const w of results) {
            if (!w?.id || !w.title) continue;
            const id = String(w.id).replace(/^https?:\/\/openalex\.org\//, '');
            const doi = normDoi(w.doi);
            yield {
              external_id: id,
              url: doi ? `https://doi.org/${doi}` : w.primary_location?.landing_page_url ?? String(w.id),
              title: String(w.title).trim(),
              authored_at: isoDate(w.publication_date),
              authors: (w.authorships ?? []).map((a: any) => a?.author?.display_name).filter(Boolean),
              text: abstractFromInverted(w.abstract_inverted_index),
              meta: { doi, topic_id: topic.id, openalex_id: id, venue: w.primary_location?.source?.display_name, type: w.type, cited_by_count: w.cited_by_count },
            };
          }
          cursor = j.meta?.next_cursor ?? '';
          if (!cursor || !results.length) break;
        }
      }
    },
  };
}
