/**
 * Runs (M02). POST validates against run-record, resolves the legal tag
 * (project default ∪ posted tag ∪ every run/document input and parent), dedupes on
 * (job, tool_version, input_hash), inserts and audits. Runs are immutable:
 * PUT/PATCH/DELETE answer 409, supersede creates a new run and marks the old one.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import {
  assertVisible, bad, canSee, check, conflict, forbidden, jsonBody, intParam, loadAccess, notFound,
  requireWritableProject, resolveTag, route, scopeLabel, sinceParam, tagsOfRefs, uuidParam, type Access, type Ctx,
} from './common.ts';

import { emitIfEvaluation } from '../analogues/emit.ts';

const RUN_COLS = 'id, job, tool_version, project_id, legal_tag, status, supersedes, hidden, created_at, record';

/** The RunRecord as stored, with the one mutable field (status) taken from the row. */
export function runRecord(row: any) {
  return { ...row.record, status: row.status, supersedes: row.supersedes ?? row.record.supersedes ?? null };
}

export async function createRun(x: Ctx, rec: any, supersedesId: string | null) {
  const { db, person } = x;
  if (supersedesId) {
    if (rec.supersedes != null && String(rec.supersedes).toLowerCase() !== supersedesId) throw bad('supersedes must match the run being superseded', '/supersedes');
    rec.supersedes = supersedesId;
  }
  check('run-record', rec);
  rec.id = rec.id.toLowerCase();
  const acc = await loadAccess(db, person, x.now);

  const author = (await db.query('SELECT id FROM people WHERE id = $1', [rec.author])).rows[0];
  if (!author) throw bad(`author "${rec.author}" is not a known person`, '/author', 'unknown_author');
  if (rec.author !== person.id && person.role === 'associate') throw forbidden('an associate can only save runs under their own name');

  const project = requireWritableProject(acc, rec.project_id);
  if (rec.client_id != null && rec.client_id !== project.client_id) throw bad(`client_id "${rec.client_id}" does not match the project's client`, '/client_id');
  x.a.scope = scopeLabel(project.id);
  x.a.refs = [`run:${rec.id}`];

  // Dedupe: identical inputs on the same tool version collapse onto the first run.
  const existing = (await db.query<any>('SELECT id, legal_tag, project_id FROM runs WHERE job=$1 AND tool_version=$2 AND input_hash=$3', [rec.job, rec.tool_version, rec.input_hash])).rows[0];
  if (existing) return deduped(x, acc, existing, supersedesId);
  const clash = (await db.query('SELECT 1 FROM runs WHERE id = $1', [rec.id])).rows[0];
  if (clash) throw conflict(`run ${rec.id} already exists and runs are immutable; supersede it instead`, 'immutable');

  let target: any;
  if (supersedesId) {
    target = (await db.query<any>('SELECT id, project_id, legal_tag, status, hidden FROM runs WHERE id = $1', [supersedesId])).rows[0];
    if (!target || (target.hidden)) throw notFound(`run ${supersedesId} not found`);
    assertVisible(acc, target.legal_tag, target.project_id, `run ${supersedesId}`);
    if (target.project_id !== rec.project_id) throw bad('a run can only supersede a run of the same project', '/supersedes');
    if (target.status === 'superseded') throw conflict(`run ${supersedesId} is already superseded`, 'conflict');
  }

  const inputRefs: string[] = rec.inputs.map((i: any) => i.ref);
  const parentRefs: string[] = (rec.parents ?? []).map((p: string) => `run:${p}`);
  const parentTags = await tagsOfRefs(db, [...inputRefs, ...parentRefs]);
  const legalTag = await resolveTag(db, acc, [project.default_legal_tag, rec.legal_tag, ...parentTags]);
  const stored = { ...rec, legal_tag: legalTag, ...(project.client_id ? { client_id: project.client_id } : {}) };

  const ins = await db.query<{ id: string }>(
    `INSERT INTO runs (id, job, tool_version, tool_commit, author, created_at, client_id, project_id, asset_ids, legal_tag, title, record, input_hash, output_hash, status, supersedes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12::jsonb,$13,$14,$15,$16)
     ON CONFLICT (job, tool_version, input_hash) DO NOTHING RETURNING id`,
    [stored.id, stored.job, stored.tool_version, stored.tool_commit, stored.author, stored.created_at, project.client_id ?? stored.client_id ?? null, stored.project_id,
     stored.asset_ids ?? [], legalTag, stored.title ?? null, JSON.stringify(stored), stored.input_hash, stored.output_hash ?? null, stored.status, supersedesId],
  );
  if (!ins.rows.length) {   // lost a race with an identical concurrent save
    const won = (await db.query<any>('SELECT id, legal_tag, project_id FROM runs WHERE job=$1 AND tool_version=$2 AND input_hash=$3', [rec.job, rec.tool_version, rec.input_hash])).rows[0];
    return deduped(x, acc, won, supersedesId);
  }
  for (const i of rec.inputs) {
    await db.query('INSERT INTO run_inputs (run_id, ref, kind, version, hash, role) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [stored.id, i.ref, i.kind, i.version == null ? null : String(i.version), i.hash ?? null, i.role ?? null]);
  }
  if (supersedesId) await db.query("UPDATE runs SET status = 'superseded' WHERE id = $1 AND status <> 'superseded'", [supersedesId]);
  // Analogue memory (M16): evaluation runs also become a row in the analogue table. Never blocks the save.
  // Only reviewed and final runs enter the analogue table; drafts would be noise. Superseding removes the old row.
  if (stored.status === 'reviewed' || stored.status === 'final') { try { await emitIfEvaluation(db, stored.id); } catch (e) { console.warn('[analogues] emit failed for', stored.id, (e as Error).message); } }
  if (supersedesId) { try { await emitIfEvaluation(db, supersedesId); } catch { /* row removal is best effort */ } }
  x.a.detail = { deduplicated: false, legal_tag: legalTag, ...(supersedesId ? { supersedes: supersedesId } : {}) };
  return { status: 201, body: { id: stored.id, deduplicated: false } };
}

function deduped(x: Ctx, acc: Access, existing: any, supersedesId: string | null) {
  if (supersedesId) throw conflict(`an identical run already exists (${existing.id}); nothing to supersede`, 'conflict');
  if (!canSee(acc, existing.legal_tag, existing.project_id)) throw conflict('a run with the same job, tool version and input hash already exists outside your scope', 'conflict');
  x.a.refs = [`run:${existing.id}`];
  x.a.detail = { deduplicated: true };
  return { status: 200, body: { id: existing.id, deduplicated: true } };
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/runs', 'run.create', async (x) => createRun(x, await jsonBody(x.c), null));

  route(app, 'POST', '/api/runs/:id/supersede', 'run.supersede', async (x) => {
    const id = uuidParam(x.c);
    return createRun(x, await jsonBody(x.c), id);
  });

  route(app, 'GET', '/api/runs/:id', 'run.read', async (x) => {
    const id = uuidParam(x.c);
    const row = (await x.db.query<any>(`SELECT ${RUN_COLS} FROM runs WHERE id = $1`, [id])).rows[0];
    if (!row || row.hidden) throw notFound(`run ${id} not found`);
    x.a.refs = [`run:${id}`]; x.a.scope = scopeLabel(row.project_id);
    assertVisible(await loadAccess(x.db, x.person, x.now), row.legal_tag, row.project_id, `run ${id}`);
    return { body: runRecord(row) };
  });

  route(app, 'GET', '/api/runs', 'run.list', async (x) => {
    const { c } = x;
    const where = ['NOT hidden']; const params: unknown[] = [];
    for (const [q, col] of [['project', 'project_id'], ['job', 'job'], ['status', 'status']] as const) {
      const v = c.req.query(q);
      if (v) { params.push(v); where.push(`${col} = $${params.length}`); }
    }
    const status = c.req.query('status');
    if (status && !['draft', 'reviewed', 'final', 'superseded'].includes(status)) throw bad('status must be draft, reviewed, final or superseded', '?status');
    const since = sinceParam(c);
    if (since) { params.push(since); where.push(`created_at >= $${params.length}`); }
    const limit = intParam(c, 'limit', 200, 1000);
    const rows = (await x.db.query<any>(`SELECT ${RUN_COLS} FROM runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id`, params)).rows;
    const acc = await loadAccess(x.db, x.person, x.now);
    const visible = rows.filter(r => canSee(acc, r.legal_tag, r.project_id)).slice(0, limit);
    x.a.scope = scopeLabel(c.req.query('project'));
    x.a.refs = visible.map(r => `run:${r.id}`);
    x.a.detail = { count: visible.length, project: c.req.query('project') ?? null, job: c.req.query('job') ?? null, status: status ?? null };
    return { body: { runs: visible.map(runRecord) } };
  });

  // Runs are immutable: there is no edit, only supersede.
  route(app, ['PUT', 'PATCH', 'DELETE'], '/api/runs/:id', 'run.mutate_refused', async (x) => {
    x.a.refs = [`run:${x.c.req.param('id')}`];
    throw conflict('runs are immutable: POST /api/runs/:id/supersede to correct one, POST /api/runs/:id/hide to withdraw it', 'immutable');
  });
}
