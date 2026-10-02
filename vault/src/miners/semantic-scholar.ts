/**
 * Semantic Scholar Academic Graph (M11). Two feeds:
 *  - bulk search per topic (`/graph/v1/paper/search/bulk`, token pagination)
 *  - recommendations seeded from papers already in the Vault
 *    (`POST /recommendations/v1/papers/`)
 * S2_API_KEY is optional (x-api-key). The limit is 1 request/s.
 */
import type { FeedAdapter, FeedRecord, TopicSpec } from './types.ts';
import { Http, isoDate, normDoi, q, ymd, type AdapterOptions } from './util.ts';

export interface SemanticScholarOptions extends AdapterOptions {
  apiKey?: string;
  base?: string;
  /** S2 paper ids of papers already in the Vault, used as positive seeds for recommendations. */
  seedIds?: () => Promise<string[]> | string[];
  maxPagesPerTopic?: number;
  pageSize?: number;
}

const FIELDS = 'title,abstract,authors,year,publicationDate,externalIds,url,venue';

export function createSemanticScholarAdapter(o: SemanticScholarOptions = {}): FeedAdapter {
  const base = o.base ?? 'https://api.semanticscholar.org';
  const apiKey = o.apiKey ?? process.env.S2_API_KEY;
  // The shared unauthenticated pool answers 429 often: four retries with a doubling back-off before the source gives up. S2_API_KEY is the real fix.
  const http = new Http(1, o, { accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) }, 4);
  const maxPages = o.maxPagesPerTopic ?? 3, pageSize = o.pageSize ?? 100;

  const toRecord = (p: any, topic_id: string | undefined, via: string): FeedRecord | null => {
    if (!p?.paperId || !p.title) return null;
    const doi = normDoi(p.externalIds?.DOI);
    return {
      external_id: p.paperId,
      url: p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
      title: String(p.title).trim(),
      authored_at: isoDate(p.publicationDate ?? (p.year ? String(p.year) : null)),
      authors: (p.authors ?? []).map((a: any) => a?.name).filter(Boolean),
      text: typeof p.abstract === 'string' && p.abstract.trim() ? p.abstract.trim() : undefined,
      meta: { doi, topic_id, venue: p.venue || undefined, year: p.year ?? undefined, via, externalIds: p.externalIds ?? undefined },
    };
  };

  return {
    id: 'semantic-scholar',
    schedule: 'weekly',
    rateLimit: { perSecond: 1 },
    async *fetch(since: Date, topics: TopicSpec[]): AsyncIterable<FeedRecord> {
      for (const topic of topics) {
        let token: string | undefined;
        for (let page = 0; page < maxPages; page++) {
          const url = `${base}/graph/v1/paper/search/bulk?query=${q(topic.query)}&fields=${FIELDS}&publicationDateOrYear=${ymd(since)}:&sort=publicationDate:desc&limit=${pageSize}${token ? `&token=${q(token)}` : ''}`;
          const j = await http.json<{ data?: any[]; token?: string | null }>(url);
          for (const p of j.data ?? []) { const r = toRecord(p, topic.id, 'bulk'); if (r) yield r; }
          token = j.token ?? undefined;
          if (!token || !(j.data ?? []).length) break;
        }
      }
      const seeds = o.seedIds ? [...new Set(await o.seedIds())].slice(0, 100) : [];
      if (seeds.length) {
        const j = await http.json<{ recommendedPapers?: any[] }>(`${base}/recommendations/v1/papers/?fields=${FIELDS}&limit=${pageSize}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ positivePaperIds: seeds }),
        });
        for (const p of j.recommendedPapers ?? []) {
          // Recommendations ignore dates: keep what was published since the window opened.
          if (p.publicationDate ? p.publicationDate < ymd(since) : p.year && p.year < since.getUTCFullYear()) continue;
          const r = toRecord(p, undefined, 'recommendation'); if (r) yield r;
        }
      }
    },
  };
}
