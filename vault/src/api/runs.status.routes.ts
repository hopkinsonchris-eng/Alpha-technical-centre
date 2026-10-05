/**
 * A run becomes reviewed or final (wave 7 PR3, docs/vault-hub/wave7/03-data-hierarchy.md A5 and S7).
 *   POST /api/runs/:id/status {status: 'reviewed' | 'final'}
 * The row's status was always the one mutable field; this route moves it forward and stamps reviewed_by and
 * reviewed_at. The record JSON is never touched (the response carries its hash so a caller can hold us to that).
 * Members of the project and partners may mark reviewed; only partners may mark final; anyone else is refused.
 * A superseded run cannot come back: supersede the superseding run instead. Promotion is one-way: a final run
 * that must be withdrawn is superseded or hidden, never demoted. Reviewed and final runs are evaluation
 * candidates, so promotion emits the analogue row the save skipped while the run was a draft.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { assertVisible, bad, conflict, forbidden, jsonBody, loadAccess, notFound, route, scopeLabel, sha256Hex, uuidParam } from './common.ts';
import { emitIfEvaluation } from '../analogues/emit.ts';

const RANK: Record<string, number> = { draft: 0, reviewed: 1, final: 2 };

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/runs/:id/status', 'run.status', async (x) => {
    const id = uuidParam(x.c);
    const b = await jsonBody(x.c);
    const to = b.status;
    if (to !== 'reviewed' && to !== 'final') throw bad('status must be reviewed or final', '/status');
    const row = (await x.db.query<any>('SELECT id, project_id, legal_tag, status, hidden, record FROM runs WHERE id = $1', [id])).rows[0];
    if (!row || row.hidden) throw notFound(`run ${id} not found`);
    x.a.refs = [`run:${id}`]; x.a.scope = scopeLabel(row.project_id);
    const acc = await loadAccess(x.db, x.person, x.now);
    assertVisible(acc, row.legal_tag, row.project_id, `run ${id}`);
    const project = acc.projects.get(row.project_id);
    const member = !!project && project.members.includes(x.person.id);
    const partner = x.person.role === 'partner';
    if (to === 'final' && !partner) throw forbidden('only a partner can mark a run final');
    if (!partner && !member) throw forbidden(`you are not a member of project "${row.project_id}"`);
    if (row.status === 'superseded') throw conflict(`run ${id} is superseded; promote the run that replaced it`, 'superseded');
    const hashBefore = `sha256:${sha256Hex(JSON.stringify(row.record))}`;
    x.a.detail = { from: row.status, to };
    if (row.status === to) {
      const same = (await x.db.query<any>('SELECT reviewed_by, reviewed_at FROM runs WHERE id = $1', [id])).rows[0];
      x.a.detail.changed = false;
      return { body: { id, status: to, previous_status: row.status, changed: false, reviewed_by: same.reviewed_by, reviewed_at: same.reviewed_at, record_hash: hashBefore, analogue: null } };
    }
    if (RANK[to] < RANK[row.status]) throw conflict(`run ${id} is ${row.status}; a run is never demoted, supersede or hide it instead`, 'conflict');
    const upd = await x.db.query<any>(
      `UPDATE runs SET status = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $1 AND status = $5 AND status <> 'superseded' RETURNING reviewed_by, reviewed_at, record`,
      [id, to, x.person.id, x.now.toISOString(), row.status]);
    if (!upd.rows.length) throw conflict(`run ${id} changed while it was being promoted; read it again`, 'conflict');
    const hashAfter = `sha256:${sha256Hex(JSON.stringify(upd.rows[0].record))}`;
    if (hashAfter !== hashBefore) throw new Error(`run ${id}: the record changed during a status update (${hashBefore} -> ${hashAfter})`);
    // Analogue memory (M16): a reviewed or final evaluation run is a row in the analogue table. Never blocks the promotion.
    const analogue = await emitIfEvaluation(x.db, id);
    x.a.detail = { ...x.a.detail, changed: true, analogue: analogue.status, ...(analogue.row_id ? { analogue_row: analogue.row_id } : {}) };
    return { body: { id, status: to, previous_status: row.status, changed: true, reviewed_by: upd.rows[0].reviewed_by, reviewed_at: new Date(upd.rows[0].reviewed_at).toISOString(), record_hash: hashAfter, analogue } };
  });
}
