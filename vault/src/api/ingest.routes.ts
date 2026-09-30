/**
 * Ingest API (M09).
 *   POST /api/ingest/upload           multipart: one or many `files`, `project_id`, optional `legal_tag`, `type`, `title` (single file).
 *                                     Each file becomes an Item through POST /api/items (hash dedupe, versioning, tag resolution live
 *                                     there), then ingestItem runs synchronously below 5 MB; larger files queue a `jobs` row that
 *                                     src/jobs/ingest-sync.ts picks up.
 *   POST /api/ingest/reindex/:itemId  force a re-index of the item's current version.
 * A file is the same file when its bytes match the project's current item, or when it has the same name in the same project
 * (a changed file with the same name is version 2).
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, assertVisible, bad, canSee, loadAccess, notFound, requireWritableProject, route, scopeLabel, sha256Hex, uuidParam } from './common.ts';
import { openStorage, type Storage } from '../storage.ts';
import { openProvider } from '../llm/provider.ts';
import { openEmbedder } from '../ingest/embed.ts';
import { ingestItem, type IngestDeps, type IngestResult } from '../ingest/index.ts';
import { appSink, ItemSinkError } from '../ingest/items-client.ts';
import { inferType } from '../ingest/legal-finance.ts';

export const SYNC_LIMIT_BYTES = 5 * 1024 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html', eml: 'message/rfc822', json: 'application/json',
};

export interface UploadResult {
  filename: string; status: 'ingested' | 'queued' | 'unchanged' | 'stored' | 'failed';
  item_id?: string; version?: number; deduplicated?: boolean; type?: string; chunks?: number; ingest?: IngestResult['status']; error?: string;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  let storage: Storage | undefined;
  const store = () => (storage ??= openStorage());
  const ingestDeps = (): IngestDeps => ({ provider: openProvider(), embedder: openEmbedder() });

  route(app, 'POST', '/api/ingest/upload', 'ingest.upload', async (x) => {
    const { c, db, person } = x;
    if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) throw bad('multipart/form-data with one or more "files" is required', '/', 'invalid_multipart');
    let form: FormData;
    try { form = await c.req.raw.formData(); } catch { throw bad('malformed multipart body', '/', 'invalid_multipart'); }
    const projectId = form.get('project_id');
    if (typeof projectId !== 'string' || !projectId) throw bad('multipart field "project_id" is required', '/project_id', 'invalid_multipart');
    const files = [...form.getAll('files'), ...form.getAll('file')].filter((f): f is File => typeof f !== 'string');
    if (!files.length) throw bad('at least one file is required in multipart field "files"', '/files', 'invalid_multipart');
    const legalTag = form.get('legal_tag'), forcedType = form.get('type'), titleField = form.get('title');

    const acc = await loadAccess(db, person, x.now);
    const project = requireWritableProject(acc, projectId);
    x.a.scope = scopeLabel(project.id);

    const jwt = c.req.header('cf-access-jwt-assertion');
    const sink = appSink(app, jwt ? { 'cf-access-jwt-assertion': jwt } : {});
    let deps: IngestDeps | null = null, depsError = '';
    try { deps = ingestDeps(); } catch (e) { depsError = (e as Error).message; }

    const results: UploadResult[] = [];
    let createdAny = false;
    for (const file of files) {
      const filename = file.name || 'upload.bin';
      const r: UploadResult = { filename, status: 'failed' };
      results.push(r);
      try {
        if (file.size > MAX_BYTES) throw new ApiError(413, 'too_large', `${filename} exceeds ${MAX_BYTES} bytes`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const ext = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase() ?? '';
        const mime = file.type && file.type !== 'application/octet-stream' ? file.type : (MIME_BY_EXT[ext] ?? 'application/octet-stream');
        const head = /^(txt|md|markdown|text)$/.test(ext) ? new TextDecoder().decode(bytes.subarray(0, 600)) : '';
        const type = typeof forcedType === 'string' && forcedType ? forcedType : inferType(filename, mime, head);
        r.type = type;

        // Same bytes as the project's current item: nothing to create.
        const same = (await db.query<any>('SELECT id, version, legal_tag, project_id FROM items WHERE project_id = $1 AND content_hash = $2 AND NOT hidden ORDER BY created_at LIMIT 1', [project.id, `sha256:${sha256Hex(bytes)}`])).rows[0];
        let id: string, version: number, created: boolean;
        if (same && canSee(acc, same.legal_tag, same.project_id)) { id = same.id; version = same.version; created = false; r.deduplicated = true; }
        else {
          const res = await sink({
            bytes, mime, filename,
            meta: {
              type, title: files.length === 1 && typeof titleField === 'string' && titleField ? titleField : filename, project_id: project.id,
              origin: { source: 'upload', external_id: `upload:${filename.toLowerCase()}`, fetched_at: x.now.toISOString() },
              filing: { method: 'manual', confidence: 1, confirmed_by: person.id }, extracted: { filename, uploaded_by: person.id },
              ...(typeof legalTag === 'string' && legalTag ? { legal_tag: legalTag } : {}),
            },
          });
          id = res.id; version = res.version; created = !res.deduplicated; r.deduplicated = res.deduplicated;
        }
        r.item_id = id; r.version = version;
        if (created) createdAny = true;
        x.a.refs.push(`doc:${id}`);

        const have = Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND item_version = $2', [id, version])).rows[0].n);
        const done = (await db.query<any>(`SELECT extracted->'ingest'->>'version' AS v FROM items WHERE id = $1`, [id])).rows[0]?.v;
        if (!created && (have > 0 || Number(done) === version)) { r.status = 'unchanged'; r.chunks = have; continue; }
        if (file.size < SYNC_LIMIT_BYTES && deps) {
          try {
            const out = await ingestItem(db, store(), id, deps);
            r.ingest = out.status; r.chunks = out.chunks;
            r.status = out.status === 'ok' || out.status === 'skipped' ? 'ingested' : 'stored';
          } catch (e) { r.error = `stored, not indexed: ${(e as Error).message}`; await queue(id, version, r.error); r.status = 'queued'; }
        } else {
          // Not indexed now: say why in the result as well as in the queue, so the person uploading can act on it.
          const reason = file.size >= SYNC_LIMIT_BYTES ? `larger than ${SYNC_LIMIT_BYTES} bytes; the ingest job indexes it in the background` : `not indexed now: ${depsError}`;
          await queue(id, version, reason);
          r.status = 'queued'; r.error = reason;
        }
      } catch (e) {
        r.status = 'failed';
        r.error = e instanceof ItemSinkError || e instanceof ApiError ? e.message : (e as Error).message;
      }
    }
    async function queue(itemId: string, version: number, reason: string) {
      await db.query(`INSERT INTO jobs (name, status, summary) VALUES ('ingest-queue', 'running', $1::jsonb)`, [JSON.stringify({ item_id: itemId, version, queued: true, reason })]);
    }
    x.a.detail = { files: results.length, statuses: results.map(r => r.status), project: project.id };
    return { status: createdAny ? 201 : 200, body: { results } };
  });

  route(app, 'POST', '/api/ingest/reindex/:itemId', 'ingest.reindex', async (x) => {
    const id = uuidParam(x.c, 'itemId');
    const row = (await x.db.query<any>('SELECT id, project_id, legal_tag, hidden FROM items WHERE id = $1', [id])).rows[0];
    if (!row || row.hidden) throw notFound(`item ${id} not found`);
    x.a.refs = [`doc:${id}`]; x.a.scope = scopeLabel(row.project_id);
    const acc = await loadAccess(x.db, x.person, x.now);
    assertVisible(acc, row.legal_tag, row.project_id, `item ${id}`);
    requireWritableProject(acc, row.project_id);
    let deps: IngestDeps;
    try { deps = ingestDeps(); } catch (e) { throw new ApiError(503, 'embedder_unavailable', (e as Error).message); }
    let out: IngestResult;
    try { out = await ingestItem(x.db, store(), id, deps, { force: true }); }
    catch (e) { throw new ApiError(500, 'ingest_failed', (e as Error).message); }
    x.a.detail = { status: out.status, chunks: out.chunks };
    return { body: out };
  });
}
