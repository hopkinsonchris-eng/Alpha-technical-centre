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
import { bounded, type Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { buildPredicate, type Predicate, type ProjectInfo, type ResolvedScope } from './scope.ts';
import { startSearchTiming } from './timings.ts';

export interface SearchHit { ref: string; item_id: string | null; run_id: string | null; version: number | null; ordinal: number; score: number; snippet: string; anchor: string | null; legal_tag: string; project_id: string; title?: string }
export interface Reranker { rerank(query: string, hits: SearchHit[], topK: number): Promise<SearchHit[]> }
export const passthroughReranker: Reranker = { async rerank(_q, hits, k) { return hits.slice(0, k); } };

/**
 * Time limits (27 Nov 2026). A caller gets an answer or a clear error in about 20 seconds: each statement runs under
 * a server-side statement_timeout (Db.bounded), so one that overruns is cancelled in the database and nothing is left
 * running after the caller has gone; the embedding call and the rerank have their own limits (embed.ts, rerank.ts).
 * When the meaning-based half fails or runs out of time, the word matches are returned and marked partial.
 */
export const SEARCH_LIMITS = { lexicalMs: 6000, embedMs: 4000, vectorMs: 7000 };
export class SearchTimeoutError extends Error {
  readonly status = 504; readonly code = 'search_timeout';
  constructor(message: string) { super(message); }
}
export class SearchAbortedError extends Error {
  readonly status = 499; readonly code = 'search_aborted';
  constructor() { super('the caller went away before the search finished'); }
}
/** Postgres 57014 query_canceled: what statement_timeout raises. */
const timedOut = (e: unknown) => (e as any)?.code === '57014' || /statement timeout|canceling statement/i.test(String((e as Error)?.message ?? ''));
const within = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${what}: no answer in ${Math.round(ms / 1000)} s`)), ms);
  p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

export interface SearchResult { hits: SearchHit[]; /** set when only the word matches could be returned */ partial: { reason: string } | null }
export interface SearchOptions { k?: number; candidates?: number; now?: Date; maxDistance?: number; /** the caller's abort signal: no further stage starts once it has fired */ signal?: AbortSignal; limits?: Partial<typeof SEARCH_LIMITS>; /** one hit per file, and per set of identical copies */ perFile?: boolean }

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

/**
 * One hit per file (28 Nov 2026): a large spreadsheet has thousands of slices and many files are stored two or three
 * times, so a well name returned fifty slices of one report. With `perFile` each statement keeps the best chunk of
 * each record, and of each set of records holding the same bytes (items.content_hash), before the candidates are cut.
 */
const FILE_KEY = (t: string) => `coalesce(i.content_hash, ${t}.item_id::text, ${t}.run_id::text, 'chunk:' || ${t}.id)`;

/** The lexical half: $1 is the query text, the predicate's parameters start at $2. */
export const lexicalSql = (pred: Predicate, cand: number, perFile = false) => {
  const body = `${COLS}, ts_rank_cd(c.tsv, plainto_tsquery('simple', $1)) AS s FROM chunks c JOIN legal_tags lt ON lt.id = c.legal_tag LEFT JOIN items i ON i.id = c.item_id WHERE ${pred.sql} AND c.tsv @@ plainto_tsquery('simple', $1)`;
  return perFile
    ? `SELECT * FROM (SELECT DISTINCT ON (${FILE_KEY('c')}) ${FILE_KEY('c')} AS fk, ${body} ORDER BY ${FILE_KEY('c')}, s DESC, c.ordinal, c.id) f ORDER BY f.s DESC LIMIT ${cand}`
    : `SELECT ${body} ORDER BY s DESC LIMIT ${cand}`;
};
/**
 * The vector half: $1 is the query vector, $2 the distance ceiling, the predicate's parameters start at $3.
 * Only neighbours within the distance floor: the nearest of a far-away list is not a match (S30).
 *
 * Scope first, distance second (27 Nov 2026). Written as one WHERE, Postgres evaluated the distance before the scope
 * terms, so a search in a 114-chunk project read the embedding of every chunk in the firm (5 GB of TOAST) before
 * discarding them. The inner query admits rows by scope alone and computes the distance only for those; OFFSET 0
 * keeps the planner from pushing the distance test back inside. The rows admitted are exactly the ones the single
 * WHERE admitted. `c.embedding IS NOT NULL` is the predicate of chunks_embedded_idx (ingest/embed-cap.ts).
 */
export const vectorSql = (pred: Predicate, cand: number, perFile = false) => {
  const body = `${COLS.replaceAll('c.', 's.')}, s.d
     FROM (SELECT c.id, c.item_id, c.run_id, c.item_version, c.ordinal, c.anchor, c.text, c.legal_tag, c.project_id, (c.embedding <=> $1::vector) AS d
             FROM chunks c JOIN legal_tags lt ON lt.id = c.legal_tag
            WHERE c.embedding IS NOT NULL AND ${pred.sql} OFFSET 0) s
     LEFT JOIN items i ON i.id = s.item_id
    WHERE s.d <= $2`;
  return perFile
    ? `SELECT * FROM (SELECT DISTINCT ON (${FILE_KEY('s')}) ${FILE_KEY('s')} AS fk, ${body} ORDER BY ${FILE_KEY('s')}, s.d ASC, s.ordinal, s.id) f ORDER BY f.d ASC LIMIT ${cand}`
    : `SELECT ${body} ORDER BY s.d ASC LIMIT ${cand}`;
};

/** The hits alone, for callers that do not report partial results. */
export async function hybridSearch(db: Db, q: string, scope: ResolvedScope, person: Person, projects: Map<string, ProjectInfo>, deps: SearchDeps = {}, opts: SearchOptions = {}): Promise<SearchHit[]> {
  return (await searchWithStatus(db, q, scope, person, projects, deps, opts)).hits;
}

export async function searchWithStatus(db: Db, q: string, scope: ResolvedScope, person: Person, projects: Map<string, ProjectInfo>, deps: SearchDeps = {}, opts: SearchOptions = {}): Promise<SearchResult> {
  const k = opts.k ?? 20, cand = opts.candidates ?? 50, now = opts.now ?? new Date(), maxd = opts.maxDistance ?? deps.maxDistance ?? maxDistance();
  const lim = { ...SEARCH_LIMITS, ...opts.limits };
  if (!q.trim()) return { hits: [], partial: null };
  const gone = () => { if (opts.signal?.aborted) throw new SearchAbortedError(); };
  const timer = startSearchTiming(scope.label, now);
  let lexical: any[], vector: any[] = [], partial: SearchResult['partial'] = null;
  try {
    gone();
    const pred = buildPredicate(scope, person, now, projects, 2);
    try {
      lexical = await timer.stage('lexical', () => bounded(db, lim.lexicalMs, async (query) => (await query<any>(lexicalSql(pred, cand, opts.perFile), [q, ...pred.params])).rows), r => r.length);
    } catch (e) {
      if (timedOut(e)) throw new SearchTimeoutError(`search ran out of time: the word match passed ${Math.round(lim.lexicalMs / 1000)} s and was stopped. Try again, or use fewer or rarer words.`);
      throw e;
    }
    if (deps.embed) {
      // The meaning-based half. Its failure is not the search's failure: the word matches stand, marked partial.
      try {
        gone();
        const e = await timer.stage('embed', () => within(deps.embed!(q), lim.embedMs, 'embedding'));
        if (!e.length) throw new Error('embedding: none returned');
        gone();
        const vec = '[' + e.join(',') + ']';
        const pred2 = buildPredicate(scope, person, now, projects, 3);
        vector = await timer.stage('vector', () => bounded(db, lim.vectorMs, async (query) => (await query<any>(vectorSql(pred2, cand, opts.perFile), [vec, maxd, ...pred2.params])).rows), r => r.length);
      } catch (e) {
        if (e instanceof SearchAbortedError) throw e;
        const reason = timedOut(e) ? `the meaning-based match passed ${Math.round(lim.vectorMs / 1000)} s and was stopped` : String((e as Error)?.message ?? e).slice(0, 160);
        partial = { reason: `word matches only: ${reason}` };
        timer.note(partial.reason);
        vector = [];
      }
    }
    timer.done();
  } catch (e) { timer.fail(e); throw e; }
  // Reciprocal rank fusion (k=60), lexical ranks first so exact identifiers win ties.
  // With perFile the two lists are fused by file (fk), so a file whose best word match and best neighbour are different
  // slices, or different copies, is still one hit; the word-match slice is the one shown.
  const fused = new Map<number | string, { row: any; score: number }>();
  const add = (rows: any[], weight: number) => rows.forEach((r, i) => { const key = r.fk ?? r.id; const f = fused.get(key) ?? { row: r, score: 0 }; f.score += weight / (RRF_K + i + 1); fused.set(key, f); });
  add(lexical, 1.0); add(vector, 1.0);
  // The floor: a chunk seen only at the last place of one list scores exactly 1 / (RRF_K + cand); it is not a result.
  const floor = 1 / (RRF_K + cand);
  const hits: SearchHit[] = [...fused.values()].filter(f => f.score > floor).sort((a, b) => b.score - a.score).map(({ row, score }) => ({
    ref: row.item_id ? `doc:${row.item_id}` : `run:${row.run_id}`, item_id: row.item_id, run_id: row.run_id, version: row.version, ordinal: row.ordinal,
    score, snippet: snippetFor(row.text, q), anchor: row.anchor, legal_tag: row.legal_tag, project_id: row.project_id, title: row.title ?? undefined,
  }));
  if (opts.signal?.aborted) throw new SearchAbortedError();
  return { hits: await (deps.reranker ?? passthroughReranker).rerank(q, hits, k), partial };
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
