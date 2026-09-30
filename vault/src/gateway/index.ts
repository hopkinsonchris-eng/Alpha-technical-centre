/**
 * Retrieval gateway wiring and structured helpers (M12).
 *  - searchDeps(): what hybridSearch needs (a query embedder and a reranker). Delegating, so
 *    configureSearch() after the fact still reaches holders of an earlier searchDeps() (the draft routes).
 *  - configureSearch(deps): tests inject a fake embedder or a recorded reranker.
 *  - peopleWhoWorked(): authors of the runs and documents that match a topic, most recent first.
 *  - runsFor(): the runs visible in a scope (same predicate as search), for the drafting assistant.
 * Nothing here reads a record without the scope predicate.
 */
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { openEmbedder, type Embedder } from '../ingest/embed.ts';
import { openReranker } from './rerank.ts';
import { buildPredicate, type ProjectInfo, type ResolvedScope } from './scope.ts';
import { hybridSearch, type Reranker, type SearchDeps, type SearchHit } from './search.ts';

export { hybridSearch, passthroughReranker, type SearchDeps, type SearchHit, type Reranker } from './search.ts';
export { resolveScope, ScopeError, type ProjectInfo, type ResolvedScope } from './scope.ts';
export { VoyageReranker, openReranker } from './rerank.ts';

export interface SearchOverrides { embed?: (text: string) => Promise<number[]>; reranker?: Reranker }
let overrides: SearchOverrides = {};
let embedder: Embedder | undefined;
let reranker: Reranker | undefined;

/** Replace the embedder and/or reranker (tests). Call with {} to go back to the environment defaults. */
export function configureSearch(deps: SearchOverrides): void {
  overrides = deps;
  if (!Object.keys(deps).length) { embedder = undefined; reranker = undefined; }
}

const currentEmbedder = () => (embedder ??= openEmbedder());
const currentReranker = () => (reranker ??= openReranker());

/** Embeds a single query (input_type "query"); reranks with Voyage when a key is set, else keeps the fused order. */
export function searchDeps(): Required<SearchDeps> {
  return {
    embed: (text) => overrides.embed ? overrides.embed(text) : currentEmbedder().embed([text], 'query').then(r => r[0]),
    reranker: { rerank: (q, hits, k) => (overrides.reranker ?? currentReranker()).rerank(q, hits, k) },
  };
}

export async function loadProjects(db: Db): Promise<Map<string, ProjectInfo>> {
  return new Map((await db.query<any>('SELECT id, client_id, members FROM projects')).rows.map(r => [r.id, { id: r.id, client_id: r.client_id, members: r.members ?? [] }]));
}

/* ── people who worked a topic ─────────────────────────────────────── */

export interface WorkedBy { person_id: string; name: string; role: string; last_at: string; count: number; refs: string[] }

/**
 * Authors of the runs and documents matching `topic` inside `scope`, ranked by the recency of their
 * newest matching record (then by how many they wrote). Only colleagues (people rows that are not service
 * accounts) are returned: external senders and tools are not "who to ask".
 */
export async function peopleWhoWorked(db: Db, topic: string, scope: ResolvedScope, person: Person, projects: Map<string, ProjectInfo>, deps: SearchDeps = {}, opts: { limit?: number; now?: Date } = {}): Promise<WorkedBy[]> {
  const hits = await hybridSearch(db, topic, scope, person, projects, deps, { k: 50, now: opts.now });
  return authorsOf(db, hits, opts.limit ?? 10);
}

export async function authorsOf(db: Db, hits: SearchHit[], limit = 10): Promise<WorkedBy[]> {
  const runIds = [...new Set(hits.map(h => h.run_id).filter((x): x is string => !!x))];
  const itemIds = [...new Set(hits.map(h => h.item_id).filter((x): x is string => !!x))];
  const rows: { ref: string; author: string; at: Date | string }[] = [];
  if (runIds.length) rows.push(...(await db.query<any>("SELECT 'run:' || id::text AS ref, author, created_at AS at FROM runs WHERE id = ANY($1::uuid[]) AND NOT hidden", [runIds])).rows);
  if (itemIds.length) rows.push(...(await db.query<any>("SELECT 'doc:' || i.id::text AS ref, a AS author, COALESCE(i.authored_at, i.created_at) AS at FROM items i, unnest(i.authors) AS a WHERE i.id = ANY($1::uuid[]) AND NOT i.hidden", [itemIds])).rows);
  if (!rows.length) return [];
  const people = new Map<string, any>((await db.query<any>("SELECT id, name, role FROM people WHERE id = ANY($1::text[]) AND role <> 'service'", [[...new Set(rows.map(r => r.author))]])).rows.map(p => [p.id, p]));
  const by = new Map<string, WorkedBy>();
  for (const r of rows) {
    const p = people.get(r.author);
    if (!p) continue;
    const at = new Date(r.at).toISOString();
    const w: WorkedBy = by.get(p.id) ?? { person_id: p.id, name: p.name, role: p.role, last_at: at, count: 0, refs: [] as string[] };
    if (at > w.last_at) w.last_at = at;
    w.count++; w.refs.push(r.ref);
    by.set(p.id, w);
  }
  return [...by.values()].sort((a, b) => b.last_at.localeCompare(a.last_at) || b.count - a.count || a.person_id.localeCompare(b.person_id)).slice(0, limit);
}

/* ── structured run retrieval ──────────────────────────────────────── */

export interface RunFilters { job?: string; since?: string; limit?: number; now?: Date }
export interface RunRow { ref: string; id: string; job: string; tool_version: string; title: string | null; status: string; created_at: string; author: string; project_id: string; legal_tag: string; stale: boolean; outputs: unknown }

/** Non-hidden, non-superseded runs visible in `scope`, newest first. The scope predicate is the one search uses. */
export async function runsFor(db: Db, scope: ResolvedScope, person: Person, projects: Map<string, ProjectInfo>, f: RunFilters = {}): Promise<RunRow[]> {
  const pred = buildPredicate(scope, person, f.now ?? new Date(), projects, 1);
  const params = [...pred.params];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const extra: string[] = [];
  if (f.job) extra.push(`c.job = ${p(f.job)}`);
  if (f.since) extra.push(`c.created_at >= ${p(f.since)}::timestamptz`);
  const limit = p(Math.min(f.limit ?? 50, 200));
  const rows = (await db.query<any>(
    `SELECT c.id, c.job, c.tool_version, c.title, c.status, c.created_at, c.author, c.project_id, c.legal_tag, c.stale, c.outputs
       FROM (SELECT r.id, r.job, r.tool_version, r.title, r.status, r.created_at, r.author, r.project_id, r.client_id, r.legal_tag, r.stale, r.record->'outputs' AS outputs,
                    true AS current, NULL::date AS expires_at, false AS partners_only
               FROM runs r WHERE NOT r.hidden AND r.status <> 'superseded') c
       JOIN legal_tags lt ON lt.id = c.legal_tag
      WHERE ${[pred.sql, ...extra].join(' AND ')} ORDER BY c.created_at DESC LIMIT ${limit}`, params)).rows;
  return rows.map(r => ({ ref: `run:${r.id}`, id: r.id, job: r.job, tool_version: r.tool_version, title: r.title, status: r.status, created_at: new Date(r.created_at).toISOString(), author: r.author, project_id: r.project_id, legal_tag: r.legal_tag, stale: r.stale, outputs: r.outputs }));
}
