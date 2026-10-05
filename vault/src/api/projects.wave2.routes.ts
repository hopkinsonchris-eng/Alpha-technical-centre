/**
 * Project updates (wave 2, docs/vault-hub/wave2/05-markup.md §1.3):
 *   PATCH /api/projects/:id  {stage?, status?, country?, lat?, lon?, register?}
 * Members and partners move an opportunity through its stages; every stage
 * change is appended to stage_history and named in the audit event. A project
 * the caller cannot see answers 404 so its existence is not leaked. The
 * register block merges field by field (a partial edit keeps the rest).
 * Wave 7 PR3 (S2, S3, S4): a stage change stamps projects.stage_changed_at; register.next (with an optional
 * next_due date, YYYY-MM-DD) keeps one open next_action milestone in step so the Hub's Next token has a date;
 * a holder, government or partner that names an organisation writes the project_organisations link.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, canSee, jsonBody, loadAccess, notFound, requireWritableProject, route, scopeLabel } from './common.ts';
import { readOpportunityFields, stageEntry } from '../opportunities.ts';
import { ensureNextActionMilestone, readDate } from './milestones.routes.ts';
import { linkRegisterCounterparties } from './organisations.routes.ts';
import { projectView } from './projects.routes.ts';

const STATUSES = ['prospect', 'active', 'closed', 'archived'];
const FIELDS = new Set(['stage', 'status', 'country', 'lat', 'lon', 'register']);

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'PATCH', '/api/projects/:id', 'project.update', async (x) => {
    const id = x.c.req.param('id')!;
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = acc.projects.get(id);
    if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project "${id}" not found`);
    x.a.scope = scopeLabel(id); x.a.refs = [`project:${id}`];
    requireWritableProject(acc, id);
    const b = await jsonBody(x.c);
    const keys = Object.keys(b);
    if (!keys.length) throw bad('nothing to change: send stage, status, country, lat, lon or register', '/');
    for (const k of keys) if (!FIELDS.has(k)) throw bad(`"${k}" cannot be changed here`, `/${k}`);
    const opp = readOpportunityFields(b);
    if (b.status !== undefined && !STATUSES.includes(b.status)) throw bad(`status must be one of ${STATUSES.join(', ')}`, '/status');

    const sets: string[] = []; const params: unknown[] = [id];
    const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
    if (opp.country !== undefined) set('country', opp.country);
    if (opp.lat !== undefined) set('lat', opp.lat);
    if (opp.lon !== undefined) set('lon', opp.lon);
    // Wave 7 (S14): archiving remembers the status the project had in register.status_before_archive;
    // leaving archived clears the note, so Restore puts an Active project back as Active.
    let register = opp.register;
    if (b.status !== undefined) {
      set('status', b.status);
      if (b.status === 'closed' && p.status !== 'closed') set('closed_at', x.now.toISOString());
      if (b.status === 'archived' && p.status !== 'archived') register = { ...(register ?? {}), status_before_archive: p.status };
      if (b.status !== 'archived' && p.status === 'archived') register = { ...(register ?? {}), status_before_archive: null };
    }
    // Wave 7 PR3 (S2): the next action's date lives on the milestone, not in the register.
    const nextText = typeof register?.next === 'string' && register.next.trim() ? register.next.trim() : null;
    let nextDue: string | null | undefined;
    if (register && register.next_due !== undefined) {
      nextDue = readDate(register.next_due, '/register/next_due');
      const { next_due: _drop, ...rest } = register;
      register = rest;
    }
    if (register !== undefined) set('register', JSON.stringify(register), '::jsonb');
    const stageChange = opp.stage !== undefined && opp.stage !== p.stage ? { from: p.stage, to: opp.stage } : null;
    if (stageChange) {
      set('stage', stageChange.to);
      set('stage_history', JSON.stringify([...p.stage_history, stageEntry(stageChange.to, x.person.id, x.now)]), '::jsonb');
      set('stage_changed_at', x.now.toISOString(), '::timestamptz');
    }
    if (sets.length) {
      // register merges: existing fields survive unless the patch names them; a key sent as null is cleared.
      const sql = `UPDATE projects SET ${sets.map(s => s.startsWith('register =') ? s.replace(/^register = (\$\d+::jsonb)$/, 'register = jsonb_strip_nulls(register || $1)') : s).join(', ')} WHERE id = $1`;
      await x.db.query(sql, params);
    }
    const milestone = nextText ? await ensureNextActionMilestone(x.db, id, x.person.id, nextText, nextDue, x.now) : null;
    const linked = register ? await linkRegisterCounterparties(x.db, id, register) : [];
    x.a.detail = { fields: keys, ...(stageChange ? { stage: stageChange } : {}), ...(milestone ? { next_milestone: milestone.id } : {}), ...(linked.length ? { linked } : {}) };
    const freshAcc = await loadAccess(x.db, x.person, x.now);
    return { body: await projectView(x, freshAcc, freshAcc.projects.get(id)!) };
  });
}
