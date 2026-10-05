/**
 * Hybrid search (M12): BM25-style full text (ts_rank_cd) ∪ vector similarity,
 * both with the scope predicate inside the query, fused by reciprocal rank
 * fusion, then optionally reranked. Every call is audited by the route.
 *
 * Wave 7 (S30): a hit must match. The lexical branch matches by construction
 * (tsquery @@); the vector branch has a nearest neighbour for every query, so
 * it only counts a neighbour within `maxDistance` (cosine). On top of that a
 * fused score must clear the reciprocal-rank floor: a chunk that only appears
 * at the last place of one candidate list is not a result. A query that
 * matches nothing therefore returns [].
 */
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { buildPredicate, type ProjectInfo, type ResolvedScope } from './scope.ts';

export interface SearchHit { ref: string; item_id: string | null; run_id: string | null; version: number | null; ordinal: number; score: number; snippet: string; anchor: string | null; legal_tag: string; project_id: string; title?: string }
export interface Reranker { rerank(query: string, hits: SearchHit[], topK: number): Promise<SearchHit[]> }
export const passthroughReranker: Reranker = { async rerank(_q, hits, k) { return hits.slice(0, k); } };

export interface SearchDeps { embed?: (text: string) => Promise<number[]>; reranker?: Reranker; /** the embedder's own cosine ceiling; see Embedder.maxDistance */ maxDistance?: number }

/** RRF constant: a hit at rank i (1-based) in one list scores 1 / (RRF_K + i). */
export const RRF_K = 60;
/**
 * Cosine distance above which a vector neighbour is not a match when the embedder does not say (Embedder.maxDistance
 * does for Voyage and for the fake). 0.6 suits the Voyage models; SEARCH_MAX_DISTANCE overrides it.
 */
export const DEFAULT_MAX_DISTANCE = 0.6;
export function maxDistance(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.SEARCH_MAX_DISTANCE);
  return Number.isFinite(v) && v > 0 && v <= 2 ? v : DEFAULT_MAX_DISTANCE;
}

const COLS = 'c.id, c.item_id::text AS item_id, c.run_id::text AS run_id, c.item_version AS version, c.ordinal, c.anchor, c.text, c.legal_tag, c.project_id, i.title';

export async function hybridSearch(db: Db, q: string, scope: ResolvedScope, person: Person, projects: Map<string, ProjectInfo>, deps: SearchDeps = {}, opts: { k?: number; candidates?: number; now?: Date; maxDistance?: number } = {}): Promise<SearchHit[]> {
  const k = opts.k ?? 20, cand = opts.candidates ?? 50, now = opts.now ?? new Date(), maxd = opts.maxDistance ?? deps.maxDistance ?? maxDistance();
  if (!q.trim()) return [];
  const pred = buildPredicate(scope, person, now, projects, 2);
  const base = `FROM chunks c JOIN legal_tags lt ON lt.id = c.legal_tag LEFT JOIN items i ON i.id = c.item_id WHERE ${pred.sql}`;
  const lexical = (await db.query<any>(
    `SELECT ${COLS}, ts_rank_cd(c.tsv, plainto_tsquery('simple', $1)) AS s ${base} AND c.tsv @@ plainto_tsquery('simple', $1) ORDER BY s DESC LIMIT ${cand}`,
    [q, ...pred.params])).rows;
  let vector: any[] = [];
  if (deps.embed) {
    const e = await deps.embed(q);
    const vec = '[' + e.join(',') + ']';
    const pred2 = buildPredicate(scope, person, now, projects, 3);
    // Only neighbours within the distance floor: the nearest of a far-away list is not a match (S30).
    vector = (await db.query<any>(
      `SELECT ${COLS}, (c.embedding <=> $1::vector) AS d FROM chunks c JOIN legal_tags lt ON lt.id = c.legal_tag LEFT JOIN items i ON i.id = c.item_id WHERE c.embedding IS NOT NULL AND (c.embedding <=> $1::vector) <= $2 AND ${pred2.sql} ORDER BY d ASC LIMIT ${cand}`,
      [vec, maxd, ...pred2.params])).rows;
  }
  // Reciprocal rank fusion (k=60), lexical ranks first so exact identifiers win ties.
  const fused = new Map<number, { row: any; score: number }>();
  const add = (rows: any[], weight: number) => rows.forEach((r, i) => { const f = fused.get(r.id) ?? { row: r, score: 0 }; f.score += weight / (RRF_K + i + 1); fused.set(r.id, f); });
  add(lexical, 1.0); add(vector, 1.0);
  // The floor: a chunk seen only at the last place of one list scores exactly 1 / (RRF_K + cand); it is not a result.
  const floor = 1 / (RRF_K + cand);
  const hits: SearchHit[] = [...fused.values()].filter(f => f.score > floor).sort((a, b) => b.score - a.score).map(({ row, score }) => ({
    ref: row.item_id ? `doc:${row.item_id}` : `run:${row.run_id}`, item_id: row.item_id, run_id: row.run_id, version: row.version, ordinal: row.ordinal,
    score, snippet: snippetFor(row.text, q), anchor: row.anchor, legal_tag: row.legal_tag, project_id: row.project_id, title: row.title ?? undefined,
  }));
  return (deps.reranker ?? passthroughReranker).rerank(q, hits, k);
}

function snippetFor(text: string, q: string, width = 240): string {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = Math.max(0, (at < 0 ? 0 : at) - width / 3);
  const s = text.slice(start, start + width).trim();
  return (start > 0 ? '…' : '') + s + (start + width < text.length ? '…' : '');
}
