/**
 * The stored original of a record (wave 5, W5-D2; docs/vault-hub/wave5/05-markup.md §1.2).
 *   GET /api/items/:id/original            the current version's bytes, inline with the record's mime
 *   GET /api/items/:id/original?download=1 the same as an attachment
 *   GET /api/items/:id/original?version=N  an earlier version through item_versions
 * Scope-checked like the record itself (403 outside the caller's scope, 404 hidden or unknown), never cached by
 * anyone (private, no-store), one `item.view` audit event per attempt with the mode and the version.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { openStorage, type Storage } from '../storage.ts';
import { ApiError, assertVisible, bad, loadAccess, notFound, route, scopeLabel, uuidParam } from './common.ts';

/** RFC 5987 filename for Content-Disposition: the record title, or the id, with the mime's usual extension when the title has none. */
export function dispositionName(title: string | null, mime: string | null, id: string): string {
  const base = (title ?? '').trim() || id;
  const ext = mime ? EXT[mime] : null;
  const named = ext && !/\.[A-Za-z0-9]{2,5}$/.test(base) ? `${base}.${ext}` : base;
  return encodeURIComponent(named.replace(/[\\/\u0000-\u001f]/g, '_')).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
const EXT: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'text/plain': 'txt', 'text/csv': 'csv', 'message/rfc822': 'eml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  let storage: Storage | undefined;
  const store = () => (storage ??= openStorage());

  route(app, 'GET', '/api/items/:id/original', 'item.view', async (x) => {
    const id = uuidParam(x.c);
    const row = (await x.db.query<any>('SELECT id, title, project_id, legal_tag, hidden, type, extracted, storage_key, mime, version FROM items WHERE id = $1', [id])).rows[0];
    if (!row || row.hidden) throw notFound(`item ${id} not found`);
    x.a.refs = [`doc:${id}`]; x.a.scope = scopeLabel(row.project_id);
    assertVisible(await loadAccess(x.db, x.person, x.now), row.legal_tag, row.project_id, `item ${id}`, row);
    const download = ['1', 'true'].includes(x.c.req.query('download') ?? '');
    const wanted = x.c.req.query('version');
    let key: string | null = row.storage_key, version: number = row.version;
    if (wanted !== undefined) {
      version = Number(wanted);
      if (!Number.isInteger(version) || version < 1) throw bad('version must be a positive integer', '/version');
      const v = (await x.db.query<any>('SELECT storage_key FROM item_versions WHERE item_id = $1 AND version = $2', [id, version])).rows[0];
      if (!v) throw notFound(`item ${id} has no version ${version}`);
      key = v.storage_key;
    }
    x.a.detail = { mode: download ? 'download' : 'inline', version };
    if (!key) throw new ApiError(404, 'no_original', `item ${id} has no original: it was filed without one`);
    const bytes = await store().get(key);
    if (!bytes) throw new ApiError(404, 'no_original', `item ${id}: the original is missing from the store (uploaded before durable storage); upload it again`);
    const mime = row.mime || 'application/octet-stream';
    return { body: new Response(bytes as unknown as BodyInit, { headers: {
      'content-type': mime,
      'content-length': String(bytes.byteLength),
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${dispositionName(row.title, row.mime, id)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'none',
    } }) };
  });
}
