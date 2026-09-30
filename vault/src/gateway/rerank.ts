/**
 * Reranking (M12). VoyageReranker calls Voyage AI's rerank endpoint over fetch
 * (VOYAGE_API_KEY; model rerank-2.5 unless VOYAGE_RERANK_MODEL says otherwise).
 * openReranker() returns it when a key is set and the passthrough reranker
 * otherwise, so keyless dev and tests keep the fused order.
 *
 * The reranker only reorders candidates the scope predicate has already
 * admitted; it never sees, and cannot add, an out-of-scope chunk. If the
 * provider fails the fused order is kept: search degrades, it does not fail.
 */
import { passthroughReranker, type Reranker, type SearchHit } from './search.ts';

export const RERANK_MODEL = 'rerank-2.5';
const ENDPOINT = 'https://api.voyageai.com/v1/rerank';
/** Characters of a candidate sent to the reranker: title plus snippet is enough to judge relevance. */
const DOC_CHARS = 1200;

export class VoyageReranker implements Reranker {
  readonly name = 'voyage';
  constructor(
    private readonly apiKey: string,
    public readonly model = process.env.VOYAGE_RERANK_MODEL || RERANK_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retryDelayMs = 250,
  ) {}

  async rerank(query: string, hits: SearchHit[], topK: number): Promise<SearchHit[]> {
    if (hits.length <= 1) return hits.slice(0, topK);
    const documents = hits.map(h => `${h.title ? h.title + '\n' : ''}${h.snippet}`.slice(0, DOC_CHARS));
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ query, documents, model: this.model, top_k: Math.min(topK, documents.length), truncation: true }),
        });
      } catch (e) { lastErr = `voyage rerank network error: ${(e as Error).message}`; await this.wait(attempt); continue; }
      if (res.ok) {
        const j: any = await res.json();
        const seen = new Set<number>();
        const out: SearchHit[] = [];
        for (const d of [...(j.data ?? [])].sort((a: any, b: any) => b.relevance_score - a.relevance_score)) {
          const h = hits[d.index];
          if (!h || seen.has(d.index)) continue;       // ignore indices the provider invented
          seen.add(d.index);
          out.push({ ...h, score: d.relevance_score });
        }
        if (out.length) return out.slice(0, topK);
        lastErr = 'voyage rerank returned no usable results';
        break;
      }
      lastErr = `voyage rerank ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.status !== 429 && res.status < 500) break;
      await this.wait(attempt);
    }
    console.warn(`[rerank] ${lastErr}; keeping the fused order`);
    return hits.slice(0, topK);
  }

  private wait(attempt: number) { return new Promise(r => setTimeout(r, this.retryDelayMs * 2 ** attempt)); }
}

export function openReranker(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): Reranker {
  return env.VOYAGE_API_KEY ? new VoyageReranker(env.VOYAGE_API_KEY, env.VOYAGE_RERANK_MODEL || RERANK_MODEL, fetchImpl) : passthroughReranker;
}
