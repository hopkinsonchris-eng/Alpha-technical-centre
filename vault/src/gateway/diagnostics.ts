/**
 * Search health (27 Nov 2026): what a session needs to see to know why search is slow, read live through
 * get_project_context. Nothing here changes how search behaves.
 *
 *  - chunks: how many, how many carry an embedding, by project (the largest first);
 *  - the size of `chunks` on disk (heap, TOAST where the embeddings live, each index), and the database;
 *  - Postgres and pgvector versions and the settings an index build depends on;
 *  - the statements running in the database now and for how long (abandoned searches show here);
 *  - the plan Postgres picks for the two search statements in this project's scope (EXPLAIN only: nothing is run);
 *  - what the recent searches spent in each stage (gateway/timings.ts);
 *  - for the project: the files with the most chunks and the files stored more than once.
 *
 * Every statement runs under a server-side time limit (Db.bounded) so reading health cannot itself pile up, and
 * each section fails on its own: a section that could not be read says so and the rest is still returned.
 * Firm-wide detail (other projects' counts, running statements, other scopes' timings) is for partners only.
 */
import { bounded, type Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { buildPredicate, type ProjectInfo, type ResolvedScope } from './scope.ts';
import { lexicalSql, vectorSql } from './search.ts';
import { recentSearchTimings, type SearchTiming } from './timings.ts';

export const DIAG_STATEMENT_MS = 8000;
const SETTINGS = ['maintenance_work_mem', 'work_mem', 'shared_buffers', 'effective_cache_size', 'max_parallel_maintenance_workers', 'max_parallel_workers_per_gather', 'max_connections', 'idle_in_transaction_session_timeout'];

export interface ProjectChunks { project_id: string; chunks: number; embedded: number; current: number; files: number }
export interface RelationSize { heap_bytes: number; toast_bytes: number; indexes_bytes: number; total_bytes: number; database_bytes: number; indexes: Array<{ name: string; method: string; bytes: number; valid: boolean }> }
export interface RunningStatement { pid: number; state: string; seconds: number; wait: string | null; application: string | null; query: string }
export interface SearchDiagnostics {
  as_of: string;
  chunks: { total: number; embedded: number; current: number; this_project: ProjectChunks | null; by_project: ProjectChunks[] | null } | { error: string };
  size: RelationSize | { error: string };
  server: { postgres: string; pgvector: string | null; statement_timeout_default: string; settings: Record<string, string> } | { error: string };
  activity: { connections: number; active: number; idle_in_transaction: number; running: RunningStatement[] } | { error: string } | null;
  plans: { lexical: string[]; vector: string[] } | { error: string } | null;
  recent_searches: Array<SearchTiming & { running_ms: number | null }>;
  largest_files: { files_over_100_chunks: number; chunks_in_them: number; top: Array<{ item_id: string; title: string | null; chunks: number }> } | { error: string };
  duplicates: { groups: number; extra_copies: number; chunks_in_extra_copies: number } | { error: string };
}

const num = (v: unknown) => Number(v ?? 0);
const errOf = (e: unknown) => ({ error: String((e as Error)?.message ?? e).slice(0, 200) });
const flat = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

export async function searchDiagnostics(db: Db, projectId: string, person: Person, projects: Map<string, ProjectInfo>, now = new Date()): Promise<SearchDiagnostics> {
  const partner = person.role === 'partner';
  /** One section: its own connection and time limit, its own failure. */
  const section = <T,>(fn: (q: Db['query']) => Promise<T>): Promise<T | { error: string }> => bounded(db, DIAG_STATEMENT_MS, fn).catch(errOf);

  const chunks = await section(async (q) => {
    const rows = (await q<any>(`SELECT project_id, count(*)::int AS chunks, count(embedding)::int AS embedded, (count(*) FILTER (WHERE current))::int AS current, count(DISTINCT item_id)::int AS files FROM chunks GROUP BY 1 ORDER BY 2 DESC`)).rows as ProjectChunks[];
    const sum = (k: 'chunks' | 'embedded' | 'current') => rows.reduce((n, r) => n + r[k], 0);
    return { total: sum('chunks'), embedded: sum('embedded'), current: sum('current'), this_project: rows.find(r => r.project_id === projectId) ?? null, by_project: partner ? rows.slice(0, 12) : null };
  });

  const size = await section(async (q) => {
    const r = (await q<any>(`SELECT pg_relation_size(c.oid) AS heap, CASE WHEN c.reltoastrelid <> 0 THEN pg_total_relation_size(c.reltoastrelid) ELSE 0 END AS toast, pg_indexes_size(c.oid) AS indexes, pg_total_relation_size(c.oid) AS total, pg_database_size(current_database()) AS db FROM pg_class c WHERE c.oid = 'chunks'::regclass`)).rows[0];
    const idx = (await q<any>(`SELECT ic.relname AS name, am.amname AS method, pg_relation_size(i.indexrelid) AS bytes, i.indisvalid AS valid FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam WHERE i.indrelid = 'chunks'::regclass ORDER BY 3 DESC`)).rows;
    return { heap_bytes: num(r.heap), toast_bytes: num(r.toast), indexes_bytes: num(r.indexes), total_bytes: num(r.total), database_bytes: num(r.db), indexes: idx.map((i: any) => ({ name: i.name, method: i.method, bytes: num(i.bytes), valid: !!i.valid })) };
  });

  const server = await section(async (q) => {
    const v = (await q<any>(`SELECT current_setting('server_version') AS pg, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vec, (SELECT reset_val || coalesce(unit, '') FROM pg_settings WHERE name = 'statement_timeout') AS st`)).rows[0];
    const s = (await q<any>(`SELECT name, current_setting(name) AS v FROM pg_settings WHERE name = ANY($1::text[])`, [SETTINGS])).rows;
    return { postgres: String(v.pg), pgvector: v.vec ?? null, statement_timeout_default: String(v.st ?? '?'), settings: Object.fromEntries(SETTINGS.map(n => [n, String(s.find((r: any) => r.name === n)?.v ?? '?')])) };
  });

  const activity = !partner ? null : await section(async (q) => {
    const c = (await q<any>(`SELECT count(*)::int AS n, (count(*) FILTER (WHERE state = 'active'))::int AS active, (count(*) FILTER (WHERE state LIKE 'idle in transaction%'))::int AS iit FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`)).rows[0];
    const rows = (await q<any>(`SELECT pid, state, greatest(0, extract(epoch FROM (now() - coalesce(query_start, state_change))))::int AS seconds, wait_event_type, wait_event, application_name, query FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state IS NOT NULL AND state <> 'idle' ORDER BY query_start NULLS LAST LIMIT 12`)).rows;
    return { connections: c.n, active: c.active, idle_in_transaction: c.iit, running: rows.map((r: any) => ({ pid: r.pid, state: r.state, seconds: r.seconds, wait: r.wait_event ? `${r.wait_event_type}/${r.wait_event}` : null, application: r.application_name || null, query: flat(String(r.query ?? ''), 140) })) };
  });

  // The plan for this project's scope, as this person. EXPLAIN without ANALYZE plans the statement and runs nothing.
  const p = projects.get(projectId);
  const plans = !partner || !p ? null : await section(async (q) => {
    const scope: ResolvedScope = { kind: 'project', project_id: projectId, client_id: p.client_id ?? undefined, label: `project:${projectId}` };
    const dims = num((await q<any>(`SELECT atttypmod AS d FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`)).rows[0]?.d) || 1024;
    const unit = '[1' + ',0'.repeat(dims - 1) + ']';
    const lp = buildPredicate(scope, person, now, projects, 2), vp = buildPredicate(scope, person, now, projects, 3);
    const lines = async (sql: string, params: unknown[]) => (await q<any>(`EXPLAIN ${sql}`, params)).rows.map((r: any) => String(r['QUERY PLAN']).replace(/'\[[-0-9.,e ]{40,}\]?/g, "'[query vector]").slice(0, 400)).slice(0, 30);
    return { lexical: await lines(lexicalSql(lp, 50), ['frost sidetrack', ...lp.params]), vector: await lines(vectorSql(vp, 50), [unit, 0.6, ...vp.params]) };
  });

  const largest_files = await section(async (q) => {
    const a = (await q<any>(`SELECT (count(*) FILTER (WHERE n > 100))::int AS files, coalesce(sum(n) FILTER (WHERE n > 100), 0)::int AS chunks FROM (SELECT count(*) AS n FROM chunks WHERE project_id = $1 AND item_id IS NOT NULL GROUP BY item_id) t`, [projectId])).rows[0];
    const top = (await q<any>(`SELECT t.item_id::text AS item_id, i.title, t.n::int AS chunks FROM (SELECT item_id, count(*) AS n FROM chunks WHERE project_id = $1 AND item_id IS NOT NULL GROUP BY item_id ORDER BY 2 DESC LIMIT 10) t JOIN items i ON i.id = t.item_id ORDER BY t.n DESC`, [projectId])).rows;
    return { files_over_100_chunks: a.files, chunks_in_them: a.chunks, top: top.map((r: any) => ({ item_id: r.item_id, title: r.title ?? null, chunks: r.chunks })) };
  });

  // The same bytes stored as more than one record: every copy after the first, and the chunks those copies carry.
  const duplicates = await section(async (q) => {
    const r = (await q<any>(
      `WITH d AS (SELECT id, row_number() OVER (PARTITION BY content_hash ORDER BY created_at, id) AS rn, count(*) OVER (PARTITION BY content_hash) AS n
                    FROM items WHERE project_id = $1 AND NOT hidden AND storage_key IS NOT NULL AND content_hash IS NOT NULL)
       SELECT (SELECT count(*) FROM d WHERE rn = 1 AND n > 1)::int AS groups, (SELECT count(*) FROM d WHERE rn > 1)::int AS extra,
              (SELECT count(*) FROM chunks c WHERE c.item_id IN (SELECT id FROM d WHERE rn > 1))::int AS chunks`, [projectId])).rows[0];
    return { groups: r.groups, extra_copies: r.extra, chunks_in_extra_copies: r.chunks };
  });

  const label = `project:${projectId}`;
  const recent_searches = recentSearchTimings().filter(t => partner || t.scope === label);
  return { as_of: now.toISOString(), chunks, size, server, activity, plans, recent_searches, largest_files, duplicates };
}

const mb = (b: number) => b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB` : `${(b / (1 << 20)).toFixed(1)} MB`;
const ms = (v: number | null) => v == null ? '-' : `${v} ms`;

/** The same, as lines for get_project_context's markdown. */
export function searchHealthLines(d: SearchDiagnostics): string[] {
  const out = ['', '## Search health', ''];
  const failed = (name: string, v: { error: string }) => out.push(`- ${name}: could not be read: ${v.error}`);
  const c = d.chunks;
  if ('error' in c) failed('Chunks', c); else {
    out.push(`- Chunks (firm-wide): ${c.total}; with an embedding ${c.embedded}; current ${c.current}`);
    if (c.this_project) out.push(`- Chunks (this project): ${c.this_project.chunks} from ${c.this_project.files} files; with an embedding ${c.this_project.embedded}; current ${c.this_project.current}`);
    if (c.by_project) out.push(`- Chunks by project: ${c.by_project.map(p => `${p.project_id} ${p.chunks} (${p.files} files)`).join(', ')}`);
  }
  const s = d.size;
  if ('error' in s) failed('Size', s); else {
    out.push(`- Size of chunks: ${mb(s.total_bytes)} (rows ${mb(s.heap_bytes)}, TOAST ${mb(s.toast_bytes)}, indexes ${mb(s.indexes_bytes)}); database ${mb(s.database_bytes)}`);
    out.push(`- Indexes on chunks: ${s.indexes.map(i => `${i.name} (${i.method}, ${mb(i.bytes)}${i.valid ? '' : ', NOT VALID'})`).join(', ') || 'none'}`);
  }
  const v = d.server;
  if ('error' in v) failed('Server', v); else out.push(`- Postgres ${v.postgres}, pgvector ${v.pgvector ?? 'not installed'}; statement_timeout ${v.statement_timeout_default}; ${Object.entries(v.settings).map(([k, x]) => `${k} ${x}`).join(', ')}`);
  const a = d.activity;
  if (a && 'error' in a) failed('Running statements', a); else if (a) {
    out.push(`- Database connections: ${a.connections} (active ${a.active}, idle in transaction ${a.idle_in_transaction})`);
    for (const r of a.running) out.push(`  - pid ${r.pid}, ${r.state}, ${r.seconds} s${r.wait ? `, waiting on ${r.wait}` : ''}${r.application ? `, ${r.application}` : ''}: ${r.query}`);
  }
  const p = d.plans;
  if (p && 'error' in p) failed('Plans', p); else if (p) {
    out.push('- Plan, lexical query (this project):', ...p.lexical.map(l => `      ${l}`));
    out.push('- Plan, vector query (this project):', ...p.vector.map(l => `      ${l}`));
  }
  out.push(`- Recent searches in this API process (newest first): ${d.recent_searches.length ? '' : 'none since it started'}`);
  for (const t of d.recent_searches) out.push(`  - ${t.started_at} ${t.scope}: ${t.stage === 'done' ? `done in ${ms(t.total_ms)}${t.error ? ` (${t.error})` : ''}` : t.stage === 'error' ? `failed after ${ms(t.total_ms)} (${t.error})` : `STILL IN ${t.stage} for ${ms(t.running_ms)}`}; lexical ${ms(t.lexical_ms)} (${t.lexical_n ?? '-'} rows), embedding ${ms(t.embed_ms)}, vector ${ms(t.vector_ms)} (${t.vector_n ?? '-'} rows)`);
  const f = d.largest_files;
  if ('error' in f) failed('Largest files', f); else {
    out.push(`- Files over 100 chunks (this project): ${f.files_over_100_chunks}, holding ${f.chunks_in_them} chunks`);
    if (f.top.length) out.push(`- Most chunks: ${f.top.map(t => `${t.title ?? t.item_id} ${t.chunks}`).join('; ')}`);
  }
  const u = d.duplicates;
  if ('error' in u) failed('Duplicates', u); else out.push(`- Stored more than once (this project): ${u.groups} files have ${u.extra_copies} extra copies, carrying ${u.chunks_in_extra_copies} chunks`);
  return out;
}
