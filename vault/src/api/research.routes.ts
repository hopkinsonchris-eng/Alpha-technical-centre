/**
 * Research runs per project (wave 4, docs/vault-hub/wave4/05-markup.md §1.5).
 *   POST /api/projects/:id/research   queues (or extends) a run; 202 with the job; 409 while one runs; 501 when switched off
 *   GET  /api/projects/:id/research   the latest runs and the findings grouped by source
 * Writes need a writable project; a project the caller cannot see answers 404. The API server
 * runs a queued job in the background at once (tests call runQueued themselves); the cron
 * `research-sync` finishes what a restart left.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, canSee, loadAccess, notFound, requireWritableProject, route, scopeLabel, type Access } from './common.ts';
import { enqueueResearch, kickResearch, researchEnabled, researchView, RESEARCH_DISABLED, type ResearchOptions } from '../research/run.ts';

let runOpts: ResearchOptions = {};
let autorun: boolean | null = null;
/** Tests inject fetch, adapters, the provider and the clock, and switch the in-process run off. */
export function configureResearch(o: ResearchOptions & { autorun?: boolean }) { const { autorun: a, ...rest } = o; runOpts = { ...runOpts, ...rest }; if (a !== undefined) autorun = a; }
/** Never in a test process (node --test sets NODE_TEST_CONTEXT): a test that wants a run calls runQueued itself. */
const shouldAutorun = () => (autorun ?? (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT));

function visibleProject(acc: Access, id: string) {
  const p = acc.projects.get(id);
  if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project "${id}" not found`);
  return p;
}

/** Queues a run after a project is created or a field attached (the triggers in §1.3); a no-op when switched off. */
export async function triggerResearch(db: RouteDeps['db'], projectId: string, by: string, names: string[] = []): Promise<void> {
  if (!researchEnabled()) return;
  await enqueueResearch(db, projectId, by, names);
  if (shouldAutorun()) kickResearch(db, runOpts);
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/projects/:id/research', 'project.research', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    x.a.scope = scopeLabel(p.id); x.a.refs = [`project:${p.id}`];
    requireWritableProject(acc, p.id);
    if (!researchEnabled()) throw new ApiError(501, 'not_implemented', RESEARCH_DISABLED);
    const r = await enqueueResearch(x.db, p.id, x.person.id);
    if (r.state === 'running') throw new ApiError(409, 'research_running', `a research run for "${p.id}" is in progress (job ${r.job_id})`, undefined, { job_id: r.job_id });
    if (shouldAutorun()) kickResearch(x.db, runOpts);
    x.a.detail = { job_id: r.job_id, state: r.state };
    return { status: 202, body: { project_id: p.id, job_id: r.job_id, state: r.state } };
  });

  route(app, 'GET', '/api/projects/:id/research', 'project.research.read', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    x.a.scope = scopeLabel(p.id); x.a.refs = [`project:${p.id}`];
    const view = await researchView(x.db, p.id);
    x.a.detail = { runs: view.runs.length, findings: view.findings.length };
    return { body: { ...view, enabled: researchEnabled() } };
  });
}
