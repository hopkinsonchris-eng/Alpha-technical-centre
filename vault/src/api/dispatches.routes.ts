/**
 * Dispatch register and reference numbers (M02). A Dispatch records one
 * transmission of an item to or from a counterparty. Reads inherit the carried
 * item's legal tag. Reference numbers ATC-<yyyy>-<nnnn> are reserved
 * atomically from reference_counters.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import {
  DISPATCH_SELECT, assertVisible, bad, canSee, check, conflict, dispatchView, forbidden, intParam, jsonBody, loadAccess, notFound,
  requireWritableProject, route, scopeLabel, sinceParam, uuidParam,
} from './common.ts';

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/dispatches', 'dispatch.list', async (x) => {
    const { c } = x;
    const where = ['NOT i.hidden']; const params: unknown[] = [];
    const org = c.req.query('organisation'), dir = c.req.query('direction');
    if (org) { params.push(org); where.push(`d.organisation_id = $${params.length}`); }
    if (dir) { if (dir !== 'in' && dir !== 'out') throw bad('direction must be in or out', '?direction'); params.push(dir); where.push(`d.direction = $${params.length}`); }
    const since = sinceParam(c);
    if (since) { params.push(since); where.push(`d.occurred_at >= $${params.length}`); }
    const order = c.req.query('order') ?? 'desc';
    if (order !== 'asc' && order !== 'desc') throw bad('order must be asc or desc', '?order');
    const limit = intParam(c, 'limit', 200, 1000);
    const rows = (await x.db.query<any>(`SELECT ${DISPATCH_SELECT} FROM dispatches d JOIN items i ON i.id = d.item_id WHERE ${where.join(' AND ')}
        ORDER BY d.occurred_at ${order === 'asc' ? 'ASC' : 'DESC'}, d.id`, params)).rows;
    const acc = await loadAccess(x.db, x.person, x.now);
    const visible = rows.filter(r => canSee(acc, r.item_legal_tag, r.item_project_id)).slice(0, limit);
    x.a.scope = 'firm'; x.a.refs = visible.map(r => `dispatch:${r.id}`);
    x.a.detail = { count: visible.length, organisation: org ?? null, direction: dir ?? null };
    return { body: { dispatches: visible.map(dispatchView) } };
  });

  route(app, 'POST', '/api/dispatches', 'dispatch.create', async (x) => {
    const { db, person } = x;
    const b = await jsonBody(x.c);
    const acc = await loadAccess(db, person, x.now);
    b.id = b.id ?? randomUUID();
    b.recorded_by = b.recorded_by ?? person.id;
    const item = typeof b.item_id === 'string' ? (await db.query<any>('SELECT id, project_id, legal_tag, reference_no, hidden FROM items WHERE id = $1', [b.item_id.toLowerCase()]).catch(() => ({ rows: [] }))).rows[0] : undefined;
    if (b.reference_no === undefined && item?.reference_no) b.reference_no = item.reference_no;
    check('dispatch', b);
    b.id = b.id.toLowerCase();
    if (b.recorded_by !== person.id && person.role !== 'service') throw forbidden('recorded_by must be the signed-in person');
    x.a.refs = [`dispatch:${b.id}`, `doc:${b.item_id}`, `org:${b.organisation_id}`];
    if (!item || item.hidden) throw bad(`item ${b.item_id} does not exist`, '/item_id', 'unknown_item');
    x.a.scope = scopeLabel(item.project_id);
    assertVisible(acc, item.legal_tag, item.project_id, `item ${b.item_id}`);
    requireWritableProject(acc, item.project_id, '/item_id');
    if (!(await db.query('SELECT 1 FROM organisations WHERE id = $1', [b.organisation_id])).rows[0]) throw bad(`organisation "${b.organisation_id}" does not exist`, '/organisation_id', 'unknown_organisation');
    for (const cid of b.contact_ids ?? []) {
      const ct = (await db.query<any>('SELECT organisation_id FROM contacts WHERE id = $1', [cid])).rows[0];
      if (!ct) throw bad(`contact "${cid}" does not exist`, '/contact_ids', 'unknown_contact');
      if (ct.organisation_id !== b.organisation_id) throw bad(`contact "${cid}" does not belong to organisation "${b.organisation_id}"`, '/contact_ids');
    }
    if (b.in_reply_to && !(await db.query('SELECT 1 FROM dispatches WHERE id = $1', [b.in_reply_to])).rows[0]) throw bad(`dispatch ${b.in_reply_to} does not exist`, '/in_reply_to', 'unknown_dispatch');
    if (b.signed_by && !(await db.query('SELECT 1 FROM people WHERE id = $1', [b.signed_by])).rows[0]) throw bad(`person "${b.signed_by}" does not exist`, '/signed_by', 'unknown_person');
    await db.query(
      `INSERT INTO dispatches (id, item_id, direction, organisation_id, contact_ids, channel, occurred_at, reference_no, their_reference, in_reply_to, signed_by, acknowledged_at, tracking, recorded_by, notes)
       VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [b.id, b.item_id.toLowerCase(), b.direction, b.organisation_id, b.contact_ids ?? [], b.channel, b.occurred_at, b.reference_no ?? null, b.their_reference ?? null, b.in_reply_to ?? null,
       b.signed_by ?? null, b.acknowledged_at ?? null, b.tracking ?? null, b.recorded_by, b.notes ?? null]);
    const row = (await db.query<any>(`SELECT ${DISPATCH_SELECT} FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.id = $1`, [b.id])).rows[0];
    return { status: 201, body: dispatchView(row) };
  });

  route(app, 'POST', '/api/dispatches/:id/acknowledge', 'dispatch.acknowledge', async (x) => {
    const id = uuidParam(x.c);
    let body: any = {};
    if ((x.c.req.header('content-type') ?? '').includes('json')) { try { body = (await x.c.req.json()) ?? {}; } catch { body = {}; } }
    const at = body.at ?? x.now.toISOString();
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw bad('at must be an ISO date-time', '/at');
    const row = (await x.db.query<any>(`SELECT ${DISPATCH_SELECT}, d.acknowledged_at FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.id = $1`, [id])).rows[0];
    if (!row || row.item_hidden) throw notFound(`dispatch ${id} not found`);
    x.a.refs = [`dispatch:${id}`, `doc:${row.item_id}`]; x.a.scope = scopeLabel(row.item_project_id);
    const acc = await loadAccess(x.db, x.person, x.now);
    assertVisible(acc, row.item_legal_tag, row.item_project_id, `dispatch ${id}`);
    requireWritableProject(acc, row.item_project_id, '/id');
    const upd = await x.db.query('UPDATE dispatches SET acknowledged_at = $2 WHERE id = $1 AND acknowledged_at IS NULL RETURNING id', [id, new Date(at).toISOString()]);
    if (!upd.rows.length) throw conflict(`dispatch ${id} was already acknowledged`, 'conflict');
    const fresh = (await x.db.query<any>(`SELECT ${DISPATCH_SELECT} FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.id = $1`, [id])).rows[0];
    return { body: dispatchView(fresh) };
  });

  route(app, 'POST', '/api/references/reserve', 'reference.reserve', async (x) => {
    let body: any = {};
    if ((x.c.req.header('content-type') ?? '').includes('json')) { try { body = (await x.c.req.json()) ?? {}; } catch { body = {}; } }
    const year = body.year ?? x.now.getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad('year must be a four-digit year', '/year');
    // One statement: the counter row is created (seeded past any number already in use) or bumped, and the new value returned.
    const { rows } = await x.db.query<{ last_no: number }>(
      `INSERT INTO reference_counters (year, last_no)
       VALUES ($1::int, 1 + (SELECT coalesce(max(n), 0) FROM (
          SELECT substring(reference_no from '^ATC-\\d{4}-(\\d{4})')::int AS n FROM dispatches WHERE reference_no LIKE $2
          UNION ALL
          SELECT substring(reference_no from '^ATC-\\d{4}-(\\d{4})')::int AS n FROM items WHERE reference_no LIKE $2) used))
       ON CONFLICT (year) DO UPDATE SET last_no = reference_counters.last_no + 1
       RETURNING last_no`, [year, `ATC-${year}-%`]);
    const n = rows[0].last_no;
    if (n > 9999) throw conflict(`reference numbers for ${year} are exhausted`, 'conflict');
    const reference_no = `ATC-${year}-${String(n).padStart(4, '0')}`;
    x.a.scope = 'firm'; x.a.refs = [`ref:${reference_no}`]; x.a.detail = { year, number: n };
    return { status: 201, body: { reference_no, year, number: n } };
  });
}
