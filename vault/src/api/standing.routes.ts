/**
 * Where a project stands, in one call (wave 7 PR3, docs/vault-hub/wave7/05-markup.md §1.7, W7-AC12; data review
 * 03 §3.3 and §5.2 A1, A7).
 *   GET  /api/projects/:id/standing          the shape below, scope-checked like the timeline
 *   POST /api/projects/:id/figures/refresh   partners: fill project_figures for this project now (the nightly job does it anyway)
 * computeStanding is also the body of the MCP tool get_project_context and of vault://projects/{id}/summary.md.
 *
 * { project: {id, name, status, stage, stage_since, country, client_id},
 *   next: {title, due_at, owner, ref} | null,
 *   figures: [{job, name, value, unit, as_of, source_ref, provenance, run_status, stale, asset_id}],
 *   open: {proposals: {asset, organisation, research, round}, filing, questions_in_drafts, unanswered_inbound, unacknowledged_dispatches},
 *   counterparties: [{organisation_id, name, role, last_contact_at, last_contact_by}],
 *   deadlines: [{kind, title, due_at, ref, overdue}],
 *   since: {opened_at, runs, items, mail},        relative to the caller's last `project.read` audit event on this project
 *   stale_counts: {runs, items},
 *   last_activity: {title, at, ref} | null }
 * Every record counted or listed passed canSee; figures carry the tag of the run or document behind them.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { Db } from '../db/client.ts';
import type { RouteDeps } from './index.ts';
import { assertVisible, canSee, iso, loadAccess, notFound, requirePartner, route, scopeLabel, sinceParam, type Access, type Ctx, type ProjectRow } from './common.ts';
import { deriveFigures, refreshFigures, type FigureRow, type FigureRun, RUN_SELECT } from '../jobs/figures.ts';
import { openMilestones } from './milestones.routes.ts';

export interface Figure { job: string; name: string; value: number; unit: string; as_of: string; source_ref: string; provenance: string | null; run_status: string | null; stale: boolean; asset_id: string | null }
export interface Standing {
  project: { id: string; name: string; status: string; stage: string; stage_since: string; country: string | null; client_id: string | null };
  next: { title: string; due_at: string | null; owner: string | null; ref: string | null } | null;
  figures: Figure[];
  open: { proposals: { asset: number; organisation: number; research: number; round: number }; filing: number; questions_in_drafts: number; unanswered_inbound: number; unacknowledged_dispatches: number };
  counterparties: { organisation_id: string; name: string; role: string; last_contact_at: string | null; last_contact_by: string | null }[];
  deadlines: { kind: string; title: string; due_at: string; ref: string | null; overdue: boolean }[];
  since: { opened_at: string | null; runs: number; items: number; mail: number };
  stale_counts: { runs: number; items: number };
  last_activity: { title: string; at: string; ref: string } | null;
}

const ROLE_ORDER = ['holder', 'government', 'partner', 'operator', 'regulator', 'counsel', 'vendor'];
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** When the current stage was entered: the stamped column, else the last stage history entry, else the opening. */
export function stageSince(p: ProjectRow, stamped: string | Date | null | undefined): string {
  return iso(stamped) ?? (p.stage_history?.length ? iso(p.stage_history[p.stage_history.length - 1].at) : null) ?? p.created_at;
}

/** The caller's last `project.read` on this project, or null when they never opened it. */
export async function lastOpened(db: Db, personId: string, projectId: string): Promise<string | null> {
  const r = (await db.query<{ at: string }>("SELECT at FROM audit_events WHERE person_id = $1 AND action = 'project.read' AND $2 = ANY(refs) ORDER BY id DESC LIMIT 1", [personId, `project:${projectId}`])).rows[0];
  return r ? iso(r.at) : null;
}

/**
 * The project's current figures the caller may see, derived live from its runs and register by the same rule the
 * nightly job writes to project_figures (so a run saved this afternoon shows this afternoon; the table serves
 * cross-project readers and is refreshed nightly or on demand).
 */
export async function figuresFor(db: Db, acc: Access, p: ProjectRow, runs?: FigureRun[]): Promise<Figure[]> {
  const projectRow = (await db.query<any>('SELECT id, register, stage_history, created_at FROM projects WHERE id = $1', [p.id])).rows[0];
  const manifests = new Map((await db.query<{ id: string; manifest: any }>('SELECT id, manifest FROM tools')).rows.map(t => [t.id, t.manifest]));
  const rows: FigureRow[] = deriveFigures(projectRow, runs ?? (await db.query<FigureRun>(RUN_SELECT, [p.id])).rows, manifests).rows.filter(r => !r.superseded)
    .sort((a, b) => a.job.localeCompare(b.job) || a.name.localeCompare(b.name) || (a.asset_id ?? '').localeCompare(b.asset_id ?? ''));
  // Confidentiality is structural: a figure is seen only when the run or document behind it is.
  const runIds = rows.map(r => /^run:([0-9a-f-]{36})$/i.exec(r.source_ref)?.[1]).filter((v): v is string => !!v);
  const docIds = rows.map(r => /^doc:([0-9a-f-]{36})$/i.exec(r.source_ref)?.[1]).filter((v): v is string => !!v);
  const tags = new Map<string, { tag: string; row?: any }>();
  if (runIds.length) for (const r of (await db.query<any>('SELECT id::text AS id, legal_tag, hidden FROM runs WHERE id = ANY($1::uuid[])', [runIds])).rows) if (!r.hidden) tags.set(`run:${r.id}`, { tag: r.legal_tag });
  if (docIds.length) for (const r of (await db.query<any>('SELECT id::text AS id, legal_tag, hidden, type, extracted FROM items WHERE id = ANY($1::uuid[])', [docIds])).rows) if (!r.hidden) tags.set(`doc:${r.id}`, { tag: r.legal_tag, row: r });
  const out: Figure[] = [];
  for (const r of rows) {
    if (r.source_ref !== 'register') {
      const t = tags.get(r.source_ref.toLowerCase());
      if (!t || !canSee(acc, t.tag, p.id, t.row)) continue;
    }
    out.push({ job: r.job, name: r.name, value: Number(r.value), unit: r.unit, as_of: r.as_of, source_ref: r.source_ref, provenance: r.provenance ?? null, run_status: r.run_status ?? null, stale: !!r.stale, asset_id: r.asset_id ?? null });
  }
  return out;
}

export async function computeStanding(db: Db, acc: Access, p: ProjectRow, now: Date, sinceOverride?: string | null): Promise<Standing> {
  const today = now.toISOString().slice(0, 10);
  const extra = (await db.query<any>('SELECT stage_changed_at, register FROM projects WHERE id = $1', [p.id])).rows[0] ?? {};
  const register: Record<string, any> = extra.register ?? p.register ?? {};

  const runs = (await db.query<any>('SELECT id, job, asset_ids, title, status, legal_tag, created_at, stale, record FROM runs WHERE project_id = $1 AND NOT hidden ORDER BY created_at DESC, id DESC', [p.id])).rows
    .filter(r => canSee(acc, r.legal_tag, p.id));
  const items = (await db.query<any>('SELECT id, type, title, legal_tag, created_at, stale, kind, extracted FROM items WHERE project_id = $1 AND NOT hidden', [p.id])).rows
    .filter(i => canSee(acc, i.legal_tag, p.id, i));
  const itemIds = items.map(i => i.id);

  /* figures */
  const figures = await figuresFor(db, acc, p, runs);

  /* next action and deadlines */
  const milestones = await openMilestones(db, p.id);
  const nextMs = milestones.find(m => m.kind === 'next_action');
  const nextText = typeof register.next === 'string' && register.next.trim() ? register.next.trim() : null;
  const next = nextMs ? { title: nextMs.title, due_at: nextMs.due_at, owner: nextMs.owner, ref: nextMs.ref }
    : nextText ? { title: nextText, due_at: null, owner: typeof register.owner === 'string' && register.owner.trim() ? register.owner.trim() : null, ref: null } : null;
  const deadlines: Standing['deadlines'] = milestones.filter(m => m.due_at).map(m => ({ kind: m.kind, title: m.title, due_at: m.due_at!, ref: m.ref, overdue: m.due_at! < today }));
  const tag = acc.tags.get(p.default_legal_tag);
  if (tag?.expires_at) deadlines.push({ kind: 'expiry', title: `NDA ${tag.id} expires`, due_at: tag.expires_at, ref: `tag:${tag.id}`, overdue: tag.expires_at < today });
  const closed = new Set(['paid', 'void', 'voided', 'cancelled', 'canceled', 'written-off']);
  for (const i of items) {
    if (i.type !== 'invoice') continue;
    const e = i.extracted ?? {};
    if (e.paid === true || closed.has(String(e.paid_status ?? e.status ?? '').toLowerCase())) continue;
    const due = day(e.due_date) ?? day(e.due);
    if (due) deadlines.push({ kind: 'deadline', title: `${i.title} due`, due_at: due, ref: `doc:${i.id}`, overdue: due < today });
  }
  deadlines.sort((a, b) => a.due_at.localeCompare(b.due_at) || a.title.localeCompare(b.title));

  /* open decisions */
  const proposals = { asset: 0, organisation: 0, research: 0, round: 0 };
  for (const r of (await db.query<{ kind: string; n: number }>("SELECT kind, count(*)::int AS n FROM review_queue WHERE status = 'open' AND payload->>'project_id' = $1 GROUP BY kind", [p.id])).rows)
    if (r.kind in proposals) proposals[r.kind as keyof typeof proposals] = r.n;
  const filing = (await db.query<{ suggestions: { project_id?: string }[] }>("SELECT suggestions FROM filing_queue WHERE status = 'open'")).rows
    .filter(f => Array.isArray(f.suggestions) && f.suggestions[0]?.project_id === p.id).length;
  const questions = items.filter(i => i.kind === 'draft' && !i.extracted?.sent).reduce((n, i) => n + (Array.isArray(i.extracted?.questions) ? i.extracted.questions.length : 0), 0);
  const dispatches = itemIds.length ? (await db.query<any>(
    `SELECT d.id, d.direction, d.organisation_id, d.occurred_at, d.acknowledged_at, d.recorded_by, d.signed_by,
            EXISTS (SELECT 1 FROM dispatches r WHERE r.in_reply_to = d.id) AS answered
       FROM dispatches d WHERE d.item_id = ANY($1::uuid[])`, [itemIds])).rows : [];
  const unansweredInbound = dispatches.filter(d => d.direction === 'in' && !d.answered).length;
  const unacknowledged = dispatches.filter(d => d.direction === 'out' && !d.acknowledged_at).length;

  /* counterparties with last contact */
  const links = (await db.query<any>('SELECT po.organisation_id, po.role, o.name FROM project_organisations po JOIN organisations o ON o.id = po.organisation_id WHERE po.project_id = $1', [p.id])).rows;
  const orgIds = [...new Set<string>(links.map((l: any) => l.organisation_id))];
  const contactRel = orgIds.length ? (await db.query<any>('SELECT organisation_id, relationship FROM contacts WHERE organisation_id = ANY($1::text[])', [orgIds])).rows : [];
  const lastContact = new Map<string, { at: string; by: string | null }>();
  const touch = (org: string, at: string | null, by: string | null) => { if (!at) return; const cur = lastContact.get(org); if (!cur || cur.at < at) lastContact.set(org, { at, by }); };
  for (const c of contactRel) touch(c.organisation_id, iso(c.relationship?.last_contact_at ?? null), c.relationship?.last_contact_by ?? null);
  for (const d of dispatches) touch(d.organisation_id, iso(d.occurred_at), d.signed_by ?? d.recorded_by ?? null);
  const counterparties = links.map((l: any) => ({ organisation_id: l.organisation_id, name: l.name, role: l.role, last_contact_at: lastContact.get(l.organisation_id)?.at ?? null, last_contact_by: lastContact.get(l.organisation_id)?.by ?? null }))
    .sort((a: any, b: any) => (ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)) || a.name.localeCompare(b.name));

  /* since the caller last opened it */
  const openedAt = sinceOverride === undefined ? await lastOpened(db, acc.person.id, p.id) : sinceOverride;
  const after = (at: unknown) => !openedAt || iso(at)! > openedAt;
  const sinceRuns = runs.filter(r => after(r.created_at)), sinceItems = items.filter(i => after(i.created_at));
  const since = { opened_at: openedAt, runs: sinceRuns.length, items: sinceItems.length, mail: sinceItems.filter(i => i.type === 'email').length };

  /* stale and last activity */
  const stale_counts = { runs: runs.filter(r => r.stale && r.status !== 'superseded').length, items: items.filter(i => i.stale).length };
  const events = [
    ...runs.map(r => ({ title: r.title ?? r.job, at: iso(r.created_at)!, ref: `run:${r.id}` })),
    ...items.map(i => ({ title: i.title, at: iso(i.created_at)!, ref: `doc:${i.id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.ref.localeCompare(a.ref));

  return {
    project: { id: p.id, name: p.name, status: p.status, stage: p.stage, stage_since: stageSince(p, extra.stage_changed_at), country: p.country ?? null, client_id: p.client_id ?? null },
    next, figures,
    open: { proposals, filing, questions_in_drafts: questions, unanswered_inbound: unansweredInbound, unacknowledged_dispatches: unacknowledged },
    counterparties, deadlines, since, stale_counts,
    last_activity: events[0] ?? null,
  };
}

async function loadProject(x: Ctx, acc: Access): Promise<ProjectRow> {
  const id = x.c.req.param('id')!;
  const p = acc.projects.get(id);
  if (!p) throw notFound(`project "${id}" not found`);
  x.a.scope = scopeLabel(id);
  assertVisible(acc, p.default_legal_tag, p.id, `project "${id}"`);
  return p;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/projects/:id/standing', 'project.standing', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    const s = await computeStanding(x.db, acc, p, x.now, sinceParam(x.c));
    x.a.refs = [`project:${p.id}`]; x.a.detail = { figures: s.figures.length, deadlines: s.deadlines.length, since: s.since.opened_at };
    return { body: s };
  });

  route(app, 'POST', '/api/projects/:id/figures/refresh', 'project.figures.refresh', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    requirePartner(x.person, 'refreshing a project\'s figures');
    const s = await refreshFigures(x.db, { projectId: p.id, now: x.now });
    const figures = await figuresFor(x.db, acc, p);
    x.a.refs = [`project:${p.id}`]; x.a.detail = { rows: s.rows, superseded: s.superseded, without_unit: s.without_unit };
    return { body: { project_id: p.id, computed_at: x.now.toISOString(), rows: s.rows, without_unit: s.without_unit, figures } };
  });
}
