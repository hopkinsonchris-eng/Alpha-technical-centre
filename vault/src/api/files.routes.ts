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
import { canSee, iso, loadAccess, notFound, route, scopeLabel, type Access } from './common.ts';

export interface ProjectFile {
  id: string; name: string; title: string; path: string | null; source: string | null; type: string; mime: string | null;
  size: number | null; version: number; created_at: string | null; authored_at: string | null;
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
      `SELECT id, type, title, created_at, authored_at, project_id, legal_tag, origin, mime, version, extracted
         FROM items WHERE project_id = $1 AND NOT hidden`, [p.id])).rows;
    const files = sortFiles(rows.filter(r => canSee(acc, r.legal_tag, r.project_id, r)).map(fileView));
    x.a.detail = { count: files.length };
    return { body: { project_id: p.id, count: files.length, generated_at: x.now.toISOString(), files } };
  });
}
