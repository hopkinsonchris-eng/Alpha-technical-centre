/**
 * Project milestones (wave 7 PR3, docs/vault-hub/wave7/05-markup.md §1.7; data review 03 §5.1 S2).
 * Dated obligations on a project: next_action, deadline, reply_due, expiry, data_room_closes.
 *   GET   /api/projects/:id/milestones[?open=1]       scope-checked like the timeline
 *   POST  /api/projects/:id/milestones                members: {kind, title, due_at?, owner?, ref?}
 *   PATCH /api/projects/:id/milestones/:mid           members: {done_at?, due_at?, title?}
 * A dispatch cannot carry an expected-reply date (Tier A), so the date lives here with ref 'dispatch:<id>'.
 * register.next stays as the display text; the project PATCH keeps one open next_action milestone in step with it
 * (ensureNextActionMilestone), so the Hub's Next token gains a date when one is given.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { Db } from '../db/client.ts';
import type { RouteDeps } from './index.ts';
import { assertVisible, bad, iso, jsonBody, loadAccess, notFound, requireWritableProject, route, scopeLabel, uuidParam, type Access, type Ctx, type ProjectRow } from './common.ts';

export const MILESTONE_KINDS = ['next_action', 'deadline', 'reply_due', 'expiry', 'data_room_closes'] as const;
export type MilestoneKind = typeof MILESTONE_KINDS[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_RE = /^(dispatch|doc|run|tag):[A-Za-z0-9._-]{1,80}$/;

export const MILESTONE_COLS = `id, project_id, kind, title, to_char(due_at,'YYYY-MM-DD') AS due_at, owner, ref, done_at, created_by, created_at`;
export function milestoneView(r: any) {
  return { id: r.id, project_id: r.project_id, kind: r.kind, title: r.title, due_at: r.due_at ?? null, owner: r.owner ?? null, ref: r.ref ?? null, done_at: iso(r.done_at), created_by: r.created_by, created_at: iso(r.created_at) };
}

/** A date field: YYYY-MM-DD that parses, or null to clear; anything else is 400 at `path`. */
export function readDate(v: unknown, path: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${path.slice(path.lastIndexOf('/') + 1)} must be a date, YYYY-MM-DD`, path);
  return v;
}

async function loadProject(x: Ctx, acc: Access): Promise<ProjectRow> {
  const id = x.c.req.param('id')!;
  const p = acc.projects.get(id);
  if (!p) throw notFound(`project "${id}" not found`);
  x.a.scope = scopeLabel(id);
  assertVisible(acc, p.default_legal_tag, p.id, `project "${id}"`);
  return p;
}

/** Open milestones of a project, soonest first (undated last). */
export async function openMilestones(db: Db, projectId: string) {
  return (await db.query<any>(`SELECT ${MILESTONE_COLS} FROM project_milestones WHERE project_id = $1 AND done_at IS NULL ORDER BY due_at ASC NULLS LAST, created_at ASC, id`, [projectId])).rows.map(milestoneView);
}

/**
 * Keep one open next_action milestone in step with register.next: update the open one (title, and the date when
 * one is given) or create it. Returns the milestone. Called by the project PATCH; never closes anything.
 */
export async function ensureNextActionMilestone(db: Db, projectId: string, personId: string, title: string, dueAt: string | null | undefined, now: Date) {
  const open = (await db.query<any>(`SELECT ${MILESTONE_COLS} FROM project_milestones WHERE project_id = $1 AND kind = 'next_action' AND done_at IS NULL ORDER BY created_at DESC LIMIT 1`, [projectId])).rows[0];
  if (open) {
    const r = (await db.query<any>(`UPDATE project_milestones SET title = $2, due_at = coalesce($3::date, due_at) WHERE id = $1 RETURNING ${MILESTONE_COLS}`, [open.id, title, dueAt ?? null])).rows[0];
    return milestoneView(r);
  }
  const r = (await db.query<any>(
    `INSERT INTO project_milestones (id, project_id, kind, title, due_at, owner, ref, created_by, created_at) VALUES ($1,$2,'next_action',$3,$4,NULL,NULL,$5,$6) RETURNING ${MILESTONE_COLS}`,
    [randomUUID(), projectId, title, dueAt ?? null, personId, now.toISOString()])).rows[0];
  return milestoneView(r);
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/projects/:id/milestones', 'milestone.list', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    const open = x.c.req.query('open') === '1';
    const rows = (await x.db.query<any>(
      `SELECT ${MILESTONE_COLS} FROM project_milestones WHERE project_id = $1 ${open ? 'AND done_at IS NULL' : ''}
       ORDER BY (done_at IS NOT NULL) ASC, due_at ASC NULLS LAST, created_at ASC, id`, [p.id])).rows.map(milestoneView);
    x.a.refs = [`project:${p.id}`]; x.a.detail = { count: rows.length, open };
    return { body: { project_id: p.id, count: rows.length, milestones: rows } };
  });

  route(app, 'POST', '/api/projects/:id/milestones', 'milestone.create', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    requireWritableProject(acc, p.id, '/id');
    const b = await jsonBody(x.c);
    if (!(MILESTONE_KINDS as readonly unknown[]).includes(b.kind)) throw bad(`kind must be one of ${MILESTONE_KINDS.join(', ')}`, '/kind');
    if (typeof b.title !== 'string' || !b.title.trim()) throw bad('title is required', '/title');
    const dueAt = readDate(b.due_at, '/due_at');
    let owner: string | null = null;
    if (b.owner != null) {
      if (typeof b.owner !== 'string') throw bad('owner must be a person id', '/owner');
      if (!(await x.db.query('SELECT 1 FROM people WHERE id = $1', [b.owner])).rows[0]) throw bad(`owner "${b.owner}" is not a known person`, '/owner', 'unknown_person');
      owner = b.owner;
    }
    let ref: string | null = null;
    if (b.ref != null) {
      if (typeof b.ref !== 'string' || !REF_RE.test(b.ref)) throw bad('ref must be dispatch:<id>, doc:<id>, run:<id> or tag:<id>', '/ref');
      ref = b.ref;
    }
    const id = randomUUID();
    const r = (await x.db.query<any>(
      `INSERT INTO project_milestones (id, project_id, kind, title, due_at, owner, ref, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${MILESTONE_COLS}`,
      [id, p.id, b.kind, b.title.trim(), dueAt, owner, ref, x.person.id, x.now.toISOString()])).rows[0];
    x.a.refs = [`project:${p.id}`, `milestone:${id}`, ...(ref ? [ref] : [])]; x.a.detail = { kind: b.kind, due_at: dueAt };
    return { status: 201, body: milestoneView(r) };
  });

  route(app, 'PATCH', '/api/projects/:id/milestones/:mid', 'milestone.update', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    requireWritableProject(acc, p.id, '/id');
    const mid = uuidParam(x.c, 'mid');
    const cur = (await x.db.query<any>(`SELECT ${MILESTONE_COLS} FROM project_milestones WHERE id = $1 AND project_id = $2`, [mid, p.id])).rows[0];
    if (!cur) throw notFound(`milestone ${mid} not found`);
    x.a.refs = [`project:${p.id}`, `milestone:${mid}`];
    const b = await jsonBody(x.c);
    const keys = Object.keys(b);
    if (!keys.length) throw bad('nothing to change: send done_at, due_at or title', '/');
    for (const k of keys) if (!['done_at', 'due_at', 'title'].includes(k)) throw bad(`"${k}" cannot be changed here`, `/${k}`);
    const sets: string[] = []; const params: unknown[] = [mid];
    const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
    if (b.title !== undefined) { if (typeof b.title !== 'string' || !b.title.trim()) throw bad('title is required', '/title'); set('title', b.title.trim()); }
    if (b.due_at !== undefined) set('due_at', readDate(b.due_at, '/due_at'), '::date');
    if (b.done_at !== undefined) {
      let done: string | null;
      if (b.done_at === null || b.done_at === false) done = null;
      else if (b.done_at === true) done = x.now.toISOString();
      else if (typeof b.done_at === 'string' && !Number.isNaN(Date.parse(b.done_at))) done = new Date(b.done_at).toISOString();
      else throw bad('done_at must be true, null or an ISO date-time', '/done_at');
      set('done_at', done, '::timestamptz');
    }
    const r = (await x.db.query<any>(`UPDATE project_milestones SET ${sets.join(', ')} WHERE id = $1 RETURNING ${MILESTONE_COLS}`, params)).rows[0];
    x.a.detail = { fields: keys };
    return { body: milestoneView(r) };
  });
}
