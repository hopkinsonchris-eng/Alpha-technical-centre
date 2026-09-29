/**
 * Crossref REST works feed (M11). `from-index-date` finds records deposited or
 * updated since the window opened; deep paging uses the cursor. Requests carry
 * a mailto (polite pool). CROSSREF_MAILTO or the `mailto` option sets it.
 */
import type { FeedAdapter, FeedRecord, TopicSpec } from './types.ts';
import { Http, isoDate, normDoi, q, stripMarkup, ymd, type AdapterOptions } from './util.ts';

export interface CrossrefOptions extends AdapterOptions { mailto?: string; base?: string; rows?: number; maxPagesPerTopic?: number }

const SELECT = 'DOI,title,author,issued,abstract,URL,container-title,type,indexed';

export function createCrossrefAdapter(o: CrossrefOptions = {}): FeedAdapter {
  const base = o.base ?? 'https://api.crossref.org';
  const mailto = o.mailto ?? process.env.CROSSREF_MAILTO ?? process.env.MINERS_MAILTO ?? 'chris@alpha-technical-centre.com';
  const http = new Http(5, o, { 'user-agent': `ATC-Vault-Miner/0.1 (https://www.alpha-technical-centre.com; mailto:${mailto})`, accept: 'application/json' });
  const rows = o.rows ?? 100, maxPages = o.maxPagesPerTopic ?? 3;

  return {
    id: 'crossref',
    schedule: 'weekly',
    rateLimit: { perSecond: 5 },
    async *fetch(since: Date, topics: TopicSpec[]): AsyncIterable<FeedRecord> {
      for (const topic of topics) {
        let cursor = '*';
        for (let page = 0; page < maxPages; page++) {
          const url = `${base}/works?query.bibliographic=${q(topic.query)}&filter=from-index-date:${ymd(since)}&rows=${rows}&cursor=${q(cursor)}&select=${SELECT}&mailto=${q(mailto)}`;
          const j = await http.json<{ message?: { items?: any[]; 'next-cursor'?: string } }>(url);
          const items = j.message?.items ?? [];
          for (const w of items) {
            const doi = normDoi(w.DOI);
            const title = Array.isArray(w.title) ? w.title[0] : w.title;
            if (!doi || !title) continue;
            const dp: number[] | undefined = w.issued?.['date-parts']?.[0];
            yield {
              external_id: doi,
              url: w.URL ?? `https://doi.org/${doi}`,
              title: stripMarkup(String(title)),
              authored_at: dp?.[0] ? isoDate(`${dp[0]}-${String(dp[1] ?? 1).padStart(2, '0')}-${String(dp[2] ?? 1).padStart(2, '0')}`) : null,
              authors: (w.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean),
              text: typeof w.abstract === 'string' && stripMarkup(w.abstract) ? stripMarkup(w.abstract) : undefined,
              meta: { doi, topic_id: topic.id, venue: (w['container-title'] ?? [])[0], type: w.type, indexed: w.indexed?.['date-time'] },
            };
          }
          const next = j.message?.['next-cursor'];
          if (!next || !items.length || items.length < rows) break;
          cursor = next;
        }
      }
    },
  };
}
