/**
 * Retrieval gateway routes (M12). The one door through which the Hub, the tools and the
 * drafting assistant search the Vault: scope is mandatory and enforced inside the query.
 *   GET /api/search?q=&scope=&k=&types=   {hits, scope, took_ms}; 400 without q or scope, 403 outside the caller's scope
 *   GET /api/search/people?q=&scope=      {people, scope, took_ms}; colleagues who worked the topic, most recent first
 *   GET /api/search/runs?scope=&job=&since=&k=   {runs, scope}; structured retrieval for the drafting assistant
 *   POST /api/search/reindex-runs?limit=        {indexed, run_ids}; partners only: chunks runs saved before runs were
 *                                               indexed (wave 7, S31). Idempotent: a run that has chunks is left alone.
 * Every call is audited by the route wrapper with the scope, a hash of the query (never the text) and the returned refs.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, bad, intParam, requirePartner, route, sha256Hex, sinceParam, type Ctx } from './common.ts';
import { configureDraft } from './draft.routes.ts';
import { openEmbedder } from '../ingest/embed.ts';
import { indexPendingRuns } from '../ingest/index.ts';
import { hybridSearch, loadProjects, peopleWhoWorked, resolveScope, runsFor, ScopeError, searchDeps, type ResolvedScope, type SearchHit } from '../gateway/index.ts';

export interface FoundHit extends SearchHit { type: string; date: string | null; authors: string[]; stale: boolean }

const TYPE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const queryHash = (q: string) => 'sha256:' + sha256Hex(q.trim().toLowerCase().replace(/\s+/g, ' '));

/** Scope and query from the request; throws 400 (missing) or 403 (not permitted) and records the attempted scope for the audit. */
async function scopeAndQuery(x: Ctx, needQuery: boolean): Promise<{ q: string; scope: ResolvedScope; projects: Awaited<ReturnType<typeof loadProjects>> }> {
  const raw = x.c.req.query('scope')?.trim() || undefined;
  const q = (x.c.req.query('q') ?? '').trim();
  x.a.scope = raw ? raw.slice(0, 200) : null;
  if (!raw) throw bad('scope is required: project:<id> | client:<id> | firm | public', '?scope', 'scope_required');
  if (needQuery && !q) throw bad('q is required', '?q', 'query_required');
  if (q) x.a.detail.query_hash = queryHash(q);
  const projects = await loadProjects(x.db);
  try {
    const scope = resolveScope(raw, x.person, projects);
    x.a.scope = scope.label;
    return { q, scope, projects };
  } catch (e) {
    if (e instanceof ScopeError) throw new ApiError(e.status, e.status === 403 ? 'forbidden' : 'invalid', e.message, '?scope');
    throw e;
  }
}

/** Adds type, date, authors and stale to hits already admitted by the scope predicate; drops hidden records. */
async function enrich(x: Ctx, hits: SearchHit[]): Promise<FoundHit[]> {
  const itemIds = [...new Set(hits.map(h => h.item_id).filter((v): v is string => !!v))];
  const runIds = [...new Set(hits.map(h => h.run_id).filter((v): v is string => !!v))];
  const items = new Map((itemIds.length ? (await x.db.query<any>('SELECT id::text AS id, type, title, COALESCE(authored_at, created_at) AS at, authors, stale, hidden FROM items WHERE id = ANY($1::uuid[])', [itemIds])).rows : []).map(r => [r.id, r]));
  const runs = new Map((runIds.length ? (await x.db.query<any>('SELECT id::text AS id, job, title, created_at AS at, author, stale, hidden FROM runs WHERE id = ANY($1::uuid[])', [runIds])).rows : []).map(r => [r.id, r]));
  const out: FoundHit[] = [];
  for (const h of hits) {
    const r = h.item_id ? items.get(h.item_id) : h.run_id ? runs.get(h.run_id) : undefined;
    if (!r || r.hidden) continue;
    out.push({
      ...h, title: h.item_id ? r.title : (r.title || r.job),
      type: h.item_id ? r.type : 'run', date: r.at ? new Date(r.at).toISOString() : null,
      authors: h.item_id ? r.authors ?? [] : [r.author], stale: !!r.stale,
    });
  }
  return out;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  configureDraft({ search: searchDeps() });

  route(app, 'GET', '/api/search', 'search.query', async (x) => {
    const { q, scope, projects } = await scopeAndQuery(x, true);
    const k = intParam(x.c, 'k', 20, 50);
    const types = (x.c.req.query('types') ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    for (const t of types) if (!TYPE_RE.test(t)) throw bad(`unknown type "${t.slice(0, 40)}"`, '?types');
    const t0 = performance.now();
    // Type filtering and hidden records are dropped after ranking, so ask for more than k.
    const found = await hybridSearch(x.db, q, scope, x.person, projects, searchDeps(), { k: types.length ? 50 : Math.min(50, k + 10), now: x.now });
    let hits = await enrich(x, found);
    if (types.length) hits = hits.filter(h => types.includes(h.type));
    hits = hits.slice(0, k);
    const took_ms = Math.round(performance.now() - t0);
    x.a.refs = [...new Set(hits.map(h => h.ref))];
    x.a.detail = { ...x.a.detail, k, types, count: hits.length, took_ms };
    return { body: { hits, scope: scope.label, took_ms } };
  });

  route(app, 'GET', '/api/search/people', 'search.people', async (x) => {
    const { q, scope, projects } = await scopeAndQuery(x, true);
    const t0 = performance.now();
    const people = await peopleWhoWorked(x.db, q, scope, x.person, projects, searchDeps(), { limit: intParam(x.c, 'k', 10, 25), now: x.now });
    const took_ms = Math.round(performance.now() - t0);
    x.a.refs = [...new Set(people.flatMap(p => p.refs))];
    x.a.detail = { ...x.a.detail, count: people.length, took_ms };
    return { body: { people, scope: scope.label, took_ms } };
  });

  route(app, 'GET', '/api/search/runs', 'search.runs', async (x) => {
    const { scope, projects } = await scopeAndQuery(x, false);
    const job = x.c.req.query('job')?.trim() || undefined;
    const since = sinceParam(x.c);
    const runs = await runsFor(x.db, scope, x.person, projects, { job, since, limit: intParam(x.c, 'k', 50, 200), now: x.now });
    x.a.refs = runs.map(r => r.ref);
    x.a.detail = { ...x.a.detail, job: job ?? null, since: since ?? null, count: runs.length };
    return { body: { runs, scope: scope.label } };
  });

  route(app, 'POST', '/api/search/reindex-runs', 'search.reindex_runs', async (x) => {
    requirePartner(x.person, 'indexing runs');
    let embedder;
    try { embedder = openEmbedder(); } catch (e) { throw new ApiError(503, 'embedder_unavailable', (e as Error).message); }
    const r = await indexPendingRuns(x.db, embedder, { limit: intParam(x.c, 'limit', 200, 1000) });
    x.a.scope = 'firm'; x.a.refs = r.run_ids.map(id => `run:${id}`); x.a.detail = { ...x.a.detail, indexed: r.indexed };
    return { body: { indexed: r.indexed, run_ids: r.run_ids } };
  });
}
