/**
 * Settings, firm assets and record lifecycle (M02): key-value settings,
 * letterhead/template/style assets, soft delete (hide) and the purge command.
 * Purge is owner-only, is not exposed as a route and refuses when anything cites the record.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { audit } from '../audit.ts';
import type { RouteDeps } from './index.ts';
import {
  ApiError, assertVisible, bad, conflict, forbidden, iso, jsonBody, loadAccess, notFound, requirePartner, route, scopeLabel, uuidParam,
} from './common.ts';

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ASSET_KINDS = ['letterhead', 'template', 'signature', 'logo', 'style'];
const family = (id: string) => id.replace(/-v\d+$/, '');
const assetView = (r: any) => ({ id: r.id, family: family(r.id), kind: r.kind, language: r.language, version: r.version, path: r.path, content_hash: r.content_hash ?? null, is_current: r.is_current, created_at: iso(r.created_at) });

/* ── purge (not a route) ────────────────────────────────────────────── */

/** Everything that still depends on a run or an item, as refs. Empty means it may be purged. */
async function citedBy(db: Db, kind: 'run' | 'item', id: string): Promise<string[]> {
  const ref = kind === 'run' ? `run:${id}` : `doc:${id}`;
  const refs = [ref];
  if (kind === 'item') {
    const it = (await db.query<{ type: string; external_id: string | null }>('SELECT type, external_id FROM items WHERE id = $1', [id])).rows[0];
    if (it?.type === 'reference-set' && it.external_id) refs.push(`ref:${it.external_id}`);
  }
  const out: string[] = [];
  const add = (rows: { ref: string }[]) => rows.forEach(r => out.push(r.ref));
  add((await db.query<any>(`SELECT 'run:' || run_id AS ref FROM run_inputs WHERE ref = ANY($1::text[])`, [refs])).rows);
  add((await db.query<any>(`SELECT 'doc:' || item_id AS ref FROM item_cites WHERE ref = ANY($1::text[])`, [refs])).rows);
  add((await db.query<any>(`SELECT 'lesson:' || id AS ref FROM lessons WHERE ${refs.map((_, i) => `record::text LIKE '%' || $${i + 1} || '%'`).join(' OR ')}`, refs)).rows);
  add((await db.query<any>(`SELECT 'analogue:' || id AS ref FROM analogue_rows WHERE source_ref = ANY($1::text[])`, [refs])).rows);
  if (kind === 'run') {
    add((await db.query<any>(`SELECT 'run:' || id AS ref FROM runs WHERE supersedes = $1 OR record->'parents' @> to_jsonb($1::text)`, [id])).rows);
  } else {
    add((await db.query<any>(`SELECT 'doc:' || id AS ref FROM items WHERE supersedes = $1 OR parent_id = $1`, [id])).rows);
    add((await db.query<any>(`SELECT 'run:' || id AS ref FROM runs WHERE record->'artifacts' @> to_jsonb($1::text)`, [ref])).rows);
    add((await db.query<any>(`SELECT 'dispatch:' || id AS ref FROM dispatches WHERE item_id = $1`, [id])).rows);
  }
  return [...new Set(out)];
}

/**
 * Permanently remove a run or item. Owner-only (partners). Refuses with 409
 * when a run, item, lesson, analogue row or dispatch cites it. Stored original
 * bytes are content-addressed and may be shared, so they are left in storage.
 * Writes one audit event whether it purges or refuses.
 */
export async function purge(db: Db, person: Person, kind: 'run' | 'item', id: string): Promise<{ purged: string }> {
  const ref = kind === 'run' ? `run:${id}` : `doc:${id}`;
  let outcome: Record<string, unknown> = {};
  try {
    if (person.role !== 'partner') throw forbidden('purge is restricted to partners');
    const table = kind === 'run' ? 'runs' : 'items';
    if (!(await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rows[0]) throw notFound(`${kind} ${id} not found`);
    const citers = await citedBy(db, kind, id);
    if (citers.length) { outcome = { refused: 'cited', cited_by: citers.slice(0, 20) }; throw conflict(`${ref} is cited by ${citers.length} record(s) and cannot be purged: hide it instead`, 'cited', { cited_by: citers.slice(0, 20) }); }
    if (kind === 'run') {
      await db.query('DELETE FROM chunks WHERE run_id = $1', [id]);
      await db.query('DELETE FROM run_inputs WHERE run_id = $1', [id]);
      await db.query('DELETE FROM runs WHERE id = $1', [id]);
    } else {
      await db.query('DELETE FROM chunks WHERE item_id = $1', [id]);
      await db.query('DELETE FROM filing_queue WHERE item_id = $1', [id]);
      await db.query('DELETE FROM item_cites WHERE item_id = $1', [id]);
      await db.query('DELETE FROM item_versions WHERE item_id = $1', [id]);
      await db.query('DELETE FROM items WHERE id = $1', [id]);
    }
    outcome = { purged: true };
    return { purged: ref };
  } catch (e) {
    if (!Object.keys(outcome).length) outcome = { refused: e instanceof ApiError ? e.code : 'error' };
    throw e;
  } finally {
    await audit(db, person.id, `${kind}.purge`, 'firm', [ref], outcome);
  }
}

/* ── routes ─────────────────────────────────────────────────────────── */

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/settings', 'settings.list', async (x) => {
    const rows = (await x.db.query<any>('SELECT key, value FROM settings ORDER BY key')).rows;
    x.a.scope = 'firm'; x.a.detail = { count: rows.length };
    return { body: { settings: Object.fromEntries(rows.map(r => [r.key, r.value])) } };
  });

  route(app, 'GET', '/api/settings/:key', 'settings.read', async (x) => {
    const key = x.c.req.param('key')!;
    x.a.scope = 'firm'; x.a.refs = [`setting:${key}`];
    const r = (await x.db.query<any>('SELECT key, value, updated_by, updated_at FROM settings WHERE key = $1', [key])).rows[0];
    if (!r) throw notFound(`setting "${key}" not found`);
    return { body: { ...r, updated_at: iso(r.updated_at) } };
  });

  route(app, 'PUT', '/api/settings/:key', 'settings.write', async (x) => {
    requirePartner(x.person, 'changing settings');
    const key = x.c.req.param('key')!;
    x.a.scope = 'firm'; x.a.refs = [`setting:${key}`];
    if (!KEY_RE.test(key)) throw bad('key must be lowercase letters, digits, dot, hyphen or underscore (1-64 characters)', '/key');
    const b = await jsonBody(x.c);
    if (!('value' in b)) throw bad('body must be {"value": ...}', '/value');
    const r = (await x.db.query<any>(
      `INSERT INTO settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
       RETURNING key, value, updated_by, updated_at`, [key, JSON.stringify(b.value), x.person.id])).rows[0];
    return { body: { ...r, updated_at: iso(r.updated_at) } };
  });

  route(app, 'DELETE', '/api/settings/:key', 'settings.delete', async (x) => {
    requirePartner(x.person, 'changing settings');
    const key = x.c.req.param('key')!;
    x.a.scope = 'firm'; x.a.refs = [`setting:${key}`];
    const r = await x.db.query('DELETE FROM settings WHERE key = $1 RETURNING key', [key]);
    if (!r.rows.length) throw notFound(`setting "${key}" not found`);
    return { body: { deleted: key } };
  });

  route(app, 'GET', '/api/firm-assets', 'firm-asset.list', async (x) => {
    const kind = x.c.req.query('kind'), language = x.c.req.query('language');
    if (kind && !ASSET_KINDS.includes(kind)) throw bad(`kind must be one of ${ASSET_KINDS.join(', ')}`, '?kind');
    const where: string[] = []; const params: unknown[] = [];
    if (x.c.req.query('all') !== 'true') where.push('is_current');
    if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
    if (language) { params.push(language); where.push(`language = $${params.length}`); }
    const rows = (await x.db.query<any>(`SELECT * FROM firm_assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kind, language, id, version DESC`, params)).rows;
    x.a.scope = 'firm'; x.a.refs = rows.map(r => `firm-asset:${r.id}`); x.a.detail = { count: rows.length };
    return { body: { firm_assets: rows.map(assetView) } };
  });

  route(app, 'GET', '/api/firm-assets/:kind/current', 'firm-asset.current', async (x) => {
    const kind = x.c.req.param('kind')!;
    const language = x.c.req.query('language') ?? 'en', name = x.c.req.query('name');
    if (!ASSET_KINDS.includes(kind)) throw bad(`kind must be one of ${ASSET_KINDS.join(', ')}`, '/kind');
    x.a.scope = 'firm';
    let rows = (await x.db.query<any>('SELECT * FROM firm_assets WHERE kind = $1 AND language = $2 AND is_current ORDER BY id', [kind, language])).rows;
    if (name) rows = rows.filter(r => r.id === name || family(r.id) === name);
    if (!rows.length) throw notFound(`no current ${kind}${name ? ` "${name}"` : ''} in language "${language}"`);
    if (rows.length > 1) {
      const names = [...new Set(rows.map(r => family(r.id)))];
      if (names.length > 1) throw bad(`several current ${kind} assets exist; add ?name= one of ${names.join(', ')}`, '?name', 'ambiguous');
      rows.sort((a, b) => b.version - a.version);
    }
    x.a.refs = [`firm-asset:${rows[0].id}`];
    return { body: assetView(rows[0]) };
  });

  // Soft delete. Runs and items are never overwritten or deleted, only hidden.
  route(app, 'POST', '/api/:kind/:id/hide', 'record.hide', async (x) => {
    const kind = x.c.req.param('kind')!;
    if (kind !== 'runs' && kind !== 'items') throw notFound(`records of kind "${kind}" cannot be hidden`);
    const id = uuidParam(x.c);
    const ref = kind === 'runs' ? `run:${id}` : `doc:${id}`;
    x.a.refs = [ref];
    const row = (await x.db.query<any>(kind === 'runs' ? 'SELECT id, project_id, legal_tag, hidden, author AS authors FROM runs WHERE id = $1' : 'SELECT id, project_id, legal_tag, hidden, authors FROM items WHERE id = $1', [id])).rows[0];
    if (!row) throw notFound(`${kind === 'runs' ? 'run' : 'item'} ${id} not found`);
    x.a.scope = scopeLabel(row.project_id);
    assertVisible(await loadAccess(x.db, x.person, x.now), row.legal_tag, row.project_id, `${kind === 'runs' ? 'run' : 'item'} ${id}`);
    const authors: string[] = Array.isArray(row.authors) ? row.authors : [row.authors];
    if (x.person.role !== 'partner' && !authors.includes(x.person.id)) throw forbidden('only a partner or the author can hide a record');
    let reason: string | null = null;
    if ((x.c.req.header('content-type') ?? '').includes('json')) { try { const b = await x.c.req.json(); if (typeof b?.reason === 'string') reason = b.reason.slice(0, 500); } catch { /* no body */ } }
    await x.db.query(`UPDATE ${kind} SET hidden = true WHERE id = $1`, [id]);
    x.a.detail = { reason };
    return { body: { id, hidden: true } };
  });
}
