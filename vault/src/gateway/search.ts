/**
 * Hybrid search (M12): BM25-style full text (ts_rank_cd) ∪ vector similarity,
 * both with the scope predicate inside the query, fused by reciprocal rank
 * fusion, then optionally reranked. Every call is audited by the route.
 */
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { buildPredicate, type ProjectInfo, type ResolvedScope } from './scope.ts';

export interface SearchHit { ref: string; item_id: string | null; run_id: string | null; version: number | null; ordinal: number; score: number; snippet: string; anchor: string | null; legal_tag: string; project_id: string; title?: string }
export interface Reranker { rerank(query: string, hits: SearchHit[], topK: number): Promise<SearchHit[]> }
export const passthroughReranker: Reranker = { async rerank(_q, hits, k) { return hits.slice(0, k); } };

export interface SearchDeps { embed?: (text: string) => Promise<number[]>; reranker?: Reranker }

const COLS = 'c.id, c.item_id::text AS item_id, c.run_id::text AS run_id, c.item_version AS version, c.ordinal, c.anchor, c.text, c.legal_tag, c.project_id, i.title';

export async function hybridSearch(db: Db, q: string, scope: ResolvedScope, person: Person, projects: Map<string, ProjectInfo>, deps: SearchDeps = {}, opts: { k?: number; candidates?: number; now?: Date } = {}): Promise<SearchHit[]> {
  const k = opts.k ?? 20, cand = opts.candidates ?? 50, now = opts.now ?? new Date();
  const pred = buildPredicate(scope, person, now, projects, 2);
  const base = `FROM chunks c JOIN legal_tags lt ON lt.id = c.legal_tag LEFT JOIN items i ON i.id = c.item_id WHERE ${pred.sql}`;
  const lexical = (await db.query<any>(
    `SELECT ${COLS}, ts_rank_cd(c.tsv, plainto_tsquery('simple', $1)) AS s ${base} AND c.tsv @@ plainto_tsquery('simple', $1) ORDER BY s DESC LIMIT ${cand}`,
    [q, ...pred.params])).rows;
  let vector: any[] = [];
  if (deps.embed) {
    const e = await deps.embed(q);
    const vec = '[' + e.join(',') + ']';
    const pred2 = buildPredicate(scope, person, now, projects, 2);
    vector = (await db.query<any>(
      `SELECT ${COLS}, (c.embedding <=> $1::vector) AS d FROM chunks c JOIN legal_tags lt ON lt.id = c.legal_tag LEFT JOIN items i ON i.id = c.item_id WHERE c.embedding IS NOT NULL AND ${pred2.sql} ORDER BY d ASC LIMIT ${cand}`,
      [vec, ...pred2.params])).rows;
  }
  // Reciprocal rank fusion (k=60), lexical ranks first so exact identifiers win ties.
  const fused = new Map<number, { row: any; score: number }>();
  const add = (rows: any[], weight: number) => rows.forEach((r, i) => { const f = fused.get(r.id) ?? { row: r, score: 0 }; f.score += weight / (60 + i + 1); fused.set(r.id, f); });
  add(lexical, 1.0); add(vector, 1.0);
  const hits: SearchHit[] = [...fused.values()].sort((a, b) => b.score - a.score).map(({ row, score }) => ({
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
