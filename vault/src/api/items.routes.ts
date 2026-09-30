/**
 * Items (M02). POST /api/items takes multipart (`original` bytes + `item`
 * metadata JSON) or a JSON metadata body. Bytes are hashed and stored
 * content-addressed under originals/<hash-prefix>/<hash>; the item version
 * increments only when the hash differs for the same origin.external_id.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { openStorage, originalKey, type Storage } from '../storage.ts';
import {
  ApiError, assertVisible, bad, canSee, check, conflict, forbidden, intParam, iso, jsonBody, loadAccess, notFound,
  requireWritableProject, resolveTag, route, scopeLabel, sha256Hex, sinceParam, tagsOfRefs, uuidParam, type Ctx,
} from './common.ts';

const MAX_BYTES = 50 * 1024 * 1024;
const ITEM_COLS = `id, type, title, created_at, authored_at, authors, client_id, project_id, asset_ids, organisation_ids, legal_tag, origin,
  storage_key, mime, content_hash, version, supersedes, reference_no, filing, extracted, stale, tags, hidden`;

/** A VaultItem as the schema describes it (server-owned fields taken from the row). */
export function itemRecord(row: any, cites: string[] = []) {
  const o: Record<string, unknown> = {
    id: row.id, type: row.type, title: row.title, created_at: iso(row.created_at), authored_at: iso(row.authored_at),
    authors: row.authors ?? [], client_id: row.client_id ?? null, project_id: row.project_id, asset_ids: row.asset_ids ?? [],
    legal_tag: row.legal_tag, origin: row.origin, storage_key: row.storage_key ?? null,
    content_hash: row.content_hash, version: row.version, supersedes: row.supersedes ?? null, cites,
    filing: row.filing ?? {}, extracted: row.extracted ?? {}, stale: !!row.stale, tags: row.tags ?? [],
    organisation_ids: row.organisation_ids ?? [], reference_no: row.reference_no ?? null,
  };
  if (row.mime) o.mime = row.mime;
  return o;
}

export async function citesOf(x: Ctx, ids: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (!ids.length) return m;
  const rows = (await x.db.query<{ item_id: string; ref: string }>('SELECT item_id::text AS item_id, ref FROM item_cites WHERE item_id = ANY($1::uuid[]) ORDER BY ref', [ids])).rows;
  for (const r of rows) (m.get(r.item_id) ?? m.set(r.item_id, []).get(r.item_id)!).push(r.ref);
  return m;
}

async function readUpload(x: Ctx): Promise<{ meta: any; bytes: Uint8Array | null; mime: string | null }> {
  const type = x.c.req.header('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) return { meta: await jsonBody(x.c), bytes: null, mime: null };
  let form: FormData;
  try { form = await x.c.req.raw.formData(); } catch { throw bad('malformed multipart body', '/', 'invalid_multipart'); }
  const raw = form.get('item');
  if (typeof raw !== 'string') throw bad('multipart field "item" (VaultItem metadata JSON) is required', '/item', 'invalid_multipart');
  let meta: any;
  try { meta = JSON.parse(raw); } catch { throw bad('multipart field "item" must be valid JSON', '/item', 'invalid_json'); }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw bad('multipart field "item" must be a JSON object', '/item', 'invalid_json');
  const file = form.get('original');
  if (file == null) return { meta, bytes: null, mime: null };
  if (typeof file === 'string') throw bad('multipart field "original" must be a file', '/original', 'invalid_multipart');
  if (file.size > MAX_BYTES) throw new ApiError(413, 'too_large', `original exceeds ${MAX_BYTES} bytes`);
  return { meta, bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || null };
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  let storage: Storage | undefined;
  const store = () => (storage ??= openStorage());

  route(app, 'POST', '/api/items', 'item.create', async (x) => {
    const { db, person } = x;
    const { meta, bytes, mime } = await readUpload(x);
    const acc = await loadAccess(db, person, x.now);

    // Server-owned fields are filled before validation so the schema sees the whole record.
    const project = typeof meta.project_id === 'string' ? acc.projects.get(meta.project_id) : undefined;
    if (typeof meta.project_id === 'string' && !project) throw bad(`project "${meta.project_id}" does not exist`, '/project_id', 'unknown_project');
    const tagGiven = meta.legal_tag != null;
    if (!tagGiven && project) meta.legal_tag = project.default_legal_tag;
    meta.id = meta.id ?? randomUUID();
    meta.created_at = meta.created_at ?? x.now.toISOString();
    meta.version = 1;
    meta.stale = false;
    let hashHex: string | null = null;
    if (bytes) {
      hashHex = sha256Hex(bytes);
      if (meta.content_hash != null && meta.content_hash !== `sha256:${hashHex}`) throw bad('content_hash does not match the uploaded bytes', '/content_hash', 'hash_mismatch');
      meta.content_hash = `sha256:${hashHex}`;
      meta.storage_key = originalKey(hashHex);
      if (mime && !meta.mime) meta.mime = mime;
    } else {
      meta.storage_key = null;
    }
    check('vault-item', meta);
    meta.id = meta.id.toLowerCase();
    x.a.refs = [`doc:${meta.id}`];

    const proj = requireWritableProject(acc, meta.project_id);
    x.a.scope = scopeLabel(proj.id);
    if (meta.client_id != null && meta.client_id !== proj.client_id) throw bad(`client_id "${meta.client_id}" does not match the project's client`, '/client_id');
    if (meta.supersedes) {
      const sup = (await db.query<any>('SELECT id, project_id, legal_tag FROM items WHERE id = $1', [meta.supersedes])).rows[0];
      if (!sup) throw bad(`item ${meta.supersedes} does not exist`, '/supersedes', 'unknown_item');
      assertVisible(acc, sup.legal_tag, sup.project_id, `item ${meta.supersedes}`);
    }

    // Which item is this a version of? Same origin (source + external id) in the same project, else the same id.
    const extId: string | null = meta.origin.external_id ?? null;
    let existing: any;
    if (extId) {
      existing = (await db.query<any>(`SELECT ${ITEM_COLS} FROM items WHERE origin->>'source' = $1 AND external_id = $2 AND project_id = $3`, [meta.origin.source, extId, meta.project_id])).rows[0];
    }
    const byId = (await db.query<any>(`SELECT ${ITEM_COLS} FROM items WHERE id = $1`, [meta.id])).rows[0];
    if (existing && byId && existing.id !== byId.id) throw conflict(`id ${meta.id} belongs to a different item than origin ${meta.origin.source}:${extId}`, 'conflict');
    existing = existing ?? byId;
    if (existing) {
      x.a.refs = [`doc:${existing.id}`];
      assertVisible(acc, existing.legal_tag, existing.project_id, `item ${existing.id}`);
      if (existing.project_id !== meta.project_id) throw conflict(`item ${existing.id} belongs to project "${existing.project_id}"`, 'conflict');
    }

    // Tag: explicit or the project's default, raised by whatever the item cites, never lowered below the existing item.
    const citeTags = await tagsOfRefs(db, meta.cites ?? []);
    const legalTag = await resolveTag(db, acc, [meta.legal_tag, ...citeTags, ...(existing ? [existing.legal_tag] : [])]);

    if (existing && existing.content_hash === meta.content_hash) {
      x.a.detail = { deduplicated: true, version: existing.version };
      return { status: 200, body: { id: existing.id, version: existing.version, deduplicated: true } };
    }

    if (bytes) {
      try { if (!(await store().exists(meta.storage_key))) await store().put(meta.storage_key, bytes, meta.mime ?? 'application/octet-stream'); }
      catch (e) { throw new ApiError(503, 'storage_unavailable', (e as Error).message); }
    }

    const cols = {
      title: meta.title, authored_at: meta.authored_at ?? null, authors: meta.authors ?? [], client_id: proj.client_id ?? meta.client_id ?? null,
      asset_ids: meta.asset_ids ?? [], organisation_ids: meta.organisation_ids ?? [], legal_tag: legalTag, origin: JSON.stringify(meta.origin),
      external_id: extId, storage_key: meta.storage_key, mime: meta.mime ?? null, content_hash: meta.content_hash,
      reference_no: meta.reference_no ?? null, filing: JSON.stringify(meta.filing ?? {}), extracted: JSON.stringify(meta.extracted ?? {}), tags: meta.tags ?? [],
    };
    let id: string, version: number;
    if (!existing) {
      id = meta.id; version = 1;
      await db.query(
        `INSERT INTO items (id, type, title, created_at, authored_at, authors, client_id, project_id, asset_ids, organisation_ids, legal_tag, origin, external_id,
           storage_key, mime, content_hash, version, supersedes, reference_no, filing, extracted, tags)
         VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9::text[],$10::text[],$11,$12::jsonb,$13,$14,$15,$16,1,$17,$18,$19::jsonb,$20::jsonb,$21::text[])`,
        [id, meta.type, cols.title, meta.created_at, cols.authored_at, cols.authors, cols.client_id, meta.project_id, cols.asset_ids, cols.organisation_ids, cols.legal_tag,
         cols.origin, cols.external_id, cols.storage_key, cols.mime, cols.content_hash, meta.supersedes ?? null, cols.reference_no, cols.filing, cols.extracted, cols.tags],
      );
    } else {
      id = existing.id; version = existing.version + 1;
      const upd = await db.query(
        `UPDATE items SET title=$3, authored_at=$4, authors=$5::text[], asset_ids=$6::text[], organisation_ids=$7::text[], legal_tag=$8, storage_key=$9, mime=$10,
           content_hash=$11, version=$2, reference_no=coalesce($12, reference_no), filing=$13::jsonb, extracted=$14::jsonb, tags=$15::text[], stale=false
         WHERE id=$1 AND version=$16 RETURNING id`,
        [id, version, cols.title, cols.authored_at ?? existing.authored_at, cols.authors, cols.asset_ids, cols.organisation_ids, cols.legal_tag, cols.storage_key, cols.mime,
         cols.content_hash, cols.reference_no, cols.filing, cols.extracted, cols.tags, existing.version],
      );
      if (!upd.rows.length) throw conflict(`item ${id} changed while it was being saved; retry`, 'conflict');
    }
    await db.query('INSERT INTO item_versions (item_id, version, content_hash, storage_key) VALUES ($1,$2,$3,$4)', [id, version, cols.content_hash, cols.storage_key]);
    for (const ref of new Set<string>(meta.cites ?? [])) await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, ref]);
    x.a.refs = [`doc:${id}`];
    x.a.detail = { deduplicated: false, version, legal_tag: legalTag };
    return { status: 201, body: { id, version, deduplicated: false } };
  });

  route(app, 'GET', '/api/items/:id', 'item.read', async (x) => {
    const id = uuidParam(x.c);
    const row = (await x.db.query<any>(`SELECT ${ITEM_COLS} FROM items WHERE id = $1`, [id])).rows[0];
    if (!row || row.hidden) throw notFound(`item ${id} not found`);
    x.a.refs = [`doc:${id}`]; x.a.scope = scopeLabel(row.project_id);
    assertVisible(await loadAccess(x.db, x.person, x.now), row.legal_tag, row.project_id, `item ${id}`, row);
    return { body: itemRecord(row, (await citesOf(x, [id])).get(id) ?? []) };
  });

  route(app, 'GET', '/api/items/:id/versions', 'item.versions', async (x) => {
    const id = uuidParam(x.c);
    const row = (await x.db.query<any>('SELECT id, project_id, legal_tag, hidden, type, extracted FROM items WHERE id = $1', [id])).rows[0];
    if (!row || row.hidden) throw notFound(`item ${id} not found`);
    x.a.refs = [`doc:${id}`]; x.a.scope = scopeLabel(row.project_id);
    assertVisible(await loadAccess(x.db, x.person, x.now), row.legal_tag, row.project_id, `item ${id}`, row);
    const versions = (await x.db.query<any>('SELECT version, content_hash, storage_key, created_at FROM item_versions WHERE item_id = $1 ORDER BY version DESC', [id])).rows
      .map(v => ({ ...v, created_at: iso(v.created_at) }));
    return { body: { item_id: id, versions } };
  });

  route(app, 'GET', '/api/items', 'item.list', async (x) => {
    const { c } = x;
    const where = ['NOT hidden']; const params: unknown[] = [];
    for (const [q, col] of [['project', 'project_id'], ['type', 'type']] as const) {
      const v = c.req.query(q);
      if (v) { params.push(v); where.push(`${col} = $${params.length}`); }
    }
    const org = c.req.query('organisation');
    if (org) { params.push([org]); where.push(`organisation_ids && $${params.length}::text[]`); }
    const since = sinceParam(c);
    if (since) { params.push(since); where.push(`created_at >= $${params.length}`); }
    const limit = intParam(c, 'limit', 200, 1000);
    const rows = (await x.db.query<any>(`SELECT ${ITEM_COLS} FROM items WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id`, params)).rows;
    const acc = await loadAccess(x.db, x.person, x.now);
    const visible = rows.filter(r => canSee(acc, r.legal_tag, r.project_id, r)).slice(0, limit);
    const cites = await citesOf(x, visible.map(r => r.id));
    x.a.scope = scopeLabel(c.req.query('project'));
    x.a.refs = visible.map(r => `doc:${r.id}`);
    x.a.detail = { count: visible.length, project: c.req.query('project') ?? null, type: c.req.query('type') ?? null };
    return { body: { items: visible.map(r => itemRecord(r, cites.get(r.id) ?? [])) } };
  });

  // Items are immutable: a change is a new version through POST /api/items.
  route(app, ['PUT', 'PATCH', 'DELETE'], '/api/items/:id', 'item.mutate_refused', async (x) => {
    x.a.refs = [`doc:${x.c.req.param('id')}`];
    throw conflict('items are immutable: POST /api/items with the same origin.external_id to add a version, POST /api/items/:id/hide to withdraw one', 'immutable');
  });
  route(app, ['PUT', 'PATCH', 'DELETE'], '/api/items/:id/versions/:v', 'item.mutate_refused', async (x) => {
    x.a.refs = [`doc:${x.c.req.param('id')}`];
    throw conflict('item versions are immutable', 'immutable');
  });
}
