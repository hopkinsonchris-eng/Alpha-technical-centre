/**
 * The files of a project, with the folder each came from (wave 8 PR 2, docs/vault-hub/wave8/02-files-and-picker.md, W8-AC9).
 *   GET /api/projects/:id/files
 *   { project_id, count, generated_at,
 *     files: [{ id, name, title, path, source, type, mime, size, version, created_at, authored_at }] }
 * `path` is the WorkDrive folder the file was synced from (extracted.workdrive.path), null for anything else; `source`
 * is origin.source (upload, zoho-workdrive, zoho-mail, research…). Sorted by folder then name, files without a folder last.
 * Every row passed canSee (partners-only types are absent for members), hidden rows are absent, a project the caller
 * cannot see is 404. Nothing about storage reaches the client: no storage key, hash or extracted text. Read-only.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import type { Db } from '../db/client.ts';
import { assertVisible, canSee, iso, loadAccess, notFound, route, scopeLabel, uuidParam, type Access } from './common.ts';

export interface ProjectFile {
  id: string; name: string; title: string; path: string | null; source: string | null; type: string; mime: string | null;
  size: number | null; version: number; created_at: string | null; authored_at: string | null;
  /** Wave 8 PR 3 (W8-AC15): where the file stands with the indexer. */
  index?: IndexState;
}

export type IndexStateName = 'indexed' | 'waiting' | 'unsupported' | 'needs_ocr' | 'empty' | 'no_original';
export interface IndexState { state: IndexStateName; chunks: number; queue_position?: number; expected_at?: string }
export interface IndexSummary { indexed: number; waiting: number; unsupported: number; needs_ocr: number; empty: number; no_original: number; queue_total: number; per_run: number; next_run_at: string }

/** The sync job's pace: up to this many waiting files per run, one run each quarter hour (src/jobs/ingest-sync.ts, render.yml). */
export const INGEST_PER_RUN = 200;
export const INGEST_RUN_MINUTES = 15;

/** The quarter hour the file's run starts at: the next one for the first 200 in the queue, the one after for the next 200, and so on. */
export function expectedRunAt(now: Date, position: number): string {
  const run = Math.max(1, Math.ceil(position / INGEST_PER_RUN));
  const next = new Date(now.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() - (next.getUTCMinutes() % INGEST_RUN_MINUTES) + INGEST_RUN_MINUTES);
  return new Date(next.getTime() + (run - 1) * INGEST_RUN_MINUTES * 60000).toISOString();
}

/** The waiting files across the Vault in the order the sync job takes them (oldest filed first): id → position from 1. */
export async function ingestQueue(db: Db): Promise<Map<string, number>> {
  const rows = (await db.query<{ id: string }>(
    `SELECT i.id FROM items i
      WHERE NOT i.hidden AND i.storage_key IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.item_id = i.id AND c.item_version = i.version AND c.current)
        AND coalesce(i.extracted->'ingest'->>'version', '') <> i.version::text
      ORDER BY i.created_at, i.id`)).rows;
  return new Map(rows.map((r: { id: string }, i: number) => [r.id, i + 1]));
}

/** The state of one record from its ingest marker and its current chunks; waiting files carry their queue position. */
export function indexState(r: { id: string; version: number; storage_key: string | null; extracted: any }, chunks: number, queue: Map<string, number>, now: Date): IndexState {
  const ing = r.extracted?.ingest;
  if (chunks > 0) return { state: 'indexed', chunks };
  if (!r.storage_key) return { state: 'no_original', chunks: 0 };
  if (ing && Number(ing.version) === Number(r.version) && ing.status !== 'no_original') {
    const st = String(ing.status);
    if (st === 'ok' || st === 'skipped') return { state: 'indexed', chunks };
    if (st === 'unsupported' || st === 'needs_ocr' || st === 'empty') return { state: st, chunks: 0 };
  }
  const pos = queue.get(r.id);
  return pos ? { state: 'waiting', chunks: 0, queue_position: pos, expected_at: expectedRunAt(now, pos) } : { state: 'waiting', chunks: 0 };
}

function visibleProject(acc: Access, id: string) {
  const p = acc.projects.get(id);
  if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project "${id}" not found`);
  return p;
}

/** The row as the client sees it: a name (the stored filename, else the title), the folder, and no storage detail. */
export function fileView(r: any): ProjectFile {
  const ex = r.extracted ?? {};
  const wd = ex.workdrive ?? {};
  const size = Number(wd.size ?? ex.size ?? NaN);
  return {
    id: r.id, name: (typeof ex.filename === 'string' && ex.filename) || r.title || r.id, title: r.title ?? '',
    path: typeof wd.path === 'string' && wd.path ? wd.path : null, source: r.origin?.source ?? null,
    type: r.type, mime: r.mime ?? null, size: Number.isFinite(size) && size > 0 ? size : null, version: Number(r.version) || 1,
    created_at: iso(r.created_at), authored_at: iso(r.authored_at),
  };
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function sortFiles(files: ProjectFile[]): ProjectFile[] {
  return files.sort((a, b) => {
    if ((a.path === null) !== (b.path === null)) return a.path === null ? 1 : -1;
    return collator.compare(a.path ?? '', b.path ?? '') || collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
  });
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/projects/:id/files', 'project.files', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    x.a.scope = scopeLabel(p.id); x.a.refs = [`project:${p.id}`];
    const rows = (await x.db.query<any>(
      `SELECT id, type, title, created_at, authored_at, project_id, legal_tag, origin, mime, version, storage_key, extracted
         FROM items WHERE project_id = $1 AND NOT hidden`, [p.id])).rows;
    const visible = rows.filter(r => canSee(acc, r.legal_tag, r.project_id, r));
    // Wave 8 PR 3 (W8-AC15): the indexing state per file and the summary, from the chunks and the sync job's own queue.
    const chunkRows = (await x.db.query<{ item_id: string; n: number }>(
      `SELECT c.item_id, count(*)::int AS n FROM chunks c JOIN items i ON i.id = c.item_id WHERE i.project_id = $1 AND c.current AND c.item_version = i.version GROUP BY c.item_id`, [p.id])).rows;
    const chunks = new Map(chunkRows.map(c => [c.item_id, Number(c.n)]));
    const queue = await ingestQueue(x.db);
    const summary: IndexSummary = { indexed: 0, waiting: 0, unsupported: 0, needs_ocr: 0, empty: 0, no_original: 0, queue_total: queue.size, per_run: INGEST_PER_RUN, next_run_at: expectedRunAt(x.now, 1) };
    const files = sortFiles(visible.map(r => {
      const index = indexState(r, chunks.get(r.id) ?? 0, queue, x.now);
      summary[index.state]++;
      return { ...fileView(r), index };
    }));
    x.a.detail = { count: files.length, waiting: summary.waiting };
    return { body: { project_id: p.id, count: files.length, generated_at: x.now.toISOString(), index: summary, files } };
  });

  // Wave 8 PR 3 (W8-AC15): one record's indexing state for the record panel, scope-checked like the record itself.
  route(app, 'GET', '/api/items/:id/index', 'item.index', async (x) => {
    const id = uuidParam(x.c);
    const row = (await x.db.query<any>('SELECT id, project_id, legal_tag, hidden, type, version, storage_key, extracted FROM items WHERE id = $1', [id])).rows[0];
    if (!row || row.hidden) throw notFound(`item ${id} not found`);
    x.a.refs = [`doc:${id}`]; x.a.scope = scopeLabel(row.project_id);
    assertVisible(await loadAccess(x.db, x.person, x.now), row.legal_tag, row.project_id, `item ${id}`, row);
    const n = Number((await x.db.query<{ n: number }>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND item_version = $2 AND current', [id, row.version])).rows[0].n);
    const queue = await ingestQueue(x.db);
    const st = indexState(row, n, queue, x.now);
    return { body: { item_id: id, version: Number(row.version) || 1, ...st, ...(st.state === 'waiting' ? { queue_total: queue.size } : {}) } };
  });
}
