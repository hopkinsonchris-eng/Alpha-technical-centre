/**
 * Re-run and review queue (M08).
 *   POST /api/runs/:id/rerun          replay a run's pinned params through the current tool version
 *   GET  /api/projects/:id/stale      stale runs and items for a project (from the nightly job)
 *   GET  /api/queue/review?kind=      review queue (rerun-delta, nda-expiry, …)
 *   POST /api/queue/review/:id/accept | /reject
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, assertVisible, canSee, conflict, loadAccess, notFound, route, scopeLabel, uuidParam, requirePartner, type Ctx } from './common.ts';
import { createRun, runRecord } from './runs.routes.ts';
import { buildCatalog, resolve as resolveTool, type Catalog } from '../catalog.ts';
import { headlessRun } from '../rerun/runner.ts';
import { computeChanges, explainDelta, historicalSpread } from '../rerun/delta.ts';
import { runInputHash } from '../hash.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export interface RerunDeps { siteOrigin?: string; provider?: LlmProvider | null; catalog?: () => Catalog; executablePath?: string | null }
let deps: RerunDeps = {};
/** Tests inject the site origin, a fake provider and the chromium path. */
export function configureRerun(d: RerunDeps) { deps = { ...deps, ...d }; }

function siteOrigin(): string {
  const o = deps.siteOrigin ?? process.env.SITE_ORIGIN;
  if (!o) throw new ApiError(503, 'runner_unavailable', 'SITE_ORIGIN is not configured');
  return o.replace(/\/$/, '');
}

async function rerun(x: Ctx): Promise<{ status?: number; body: unknown }> {
  const { db, person } = x;
  const id = uuidParam(x.c);
  const row = (await db.query<any>('SELECT id, job, tool_version, project_id, legal_tag, status, supersedes, hidden, created_at, record FROM runs WHERE id = $1', [id])).rows[0];
  if (!row || row.hidden) throw notFound(`run ${id} not found`);
  const acc = await loadAccess(db, person, x.now);
  assertVisible(acc, row.legal_tag, row.project_id, `run ${id}`);
  x.a.scope = scopeLabel(row.project_id); x.a.refs = [`run:${id}`];
  const old = runRecord(row);

  const catalog = deps.catalog ? deps.catalog() : buildCatalog(REPO_ROOT);
  const tool = catalog.tools.find(t => t.id === old.job);
  if (!tool) throw notFound(`tool ${old.job} is not in the catalog`);
  if (tool.kind !== 'browser-tool') throw new ApiError(501, 'not_implemented', `re-run of ${tool.kind} tools needs the app's own /rerun adapter (D6)`);
  const cur = resolveTool(catalog, old.job);
  const entryUrl = `${siteOrigin()}/${cur.entry.replace(/^\//, '')}`;

  let r;
  try { r = await headlessRun({ entryUrl, params: old.params, executablePath: deps.executablePath }); }
  catch (e: any) { throw new ApiError(e.status ?? 502, e.code ?? 'rerun_failed', `re-run failed: ${e.message}`); }

  // Re-resolve reference and document inputs to their latest version and hash.
  const causes: string[] = [];
  const inputs = [];
  for (const inp of r.inputs?.length ? r.inputs : old.inputs) {
    const i: any = { ...inp };
    if ((i.kind === 'document' || i.kind === 'reference') && typeof i.ref === 'string') {
      const key = i.ref.replace(/^(doc|ref):/, '');
      const it = (await db.query<any>('SELECT id, version, content_hash FROM items WHERE NOT hidden AND (id::text = $1 OR external_id = $1) ORDER BY version DESC LIMIT 1', [key])).rows[0];
      if (it) {
        const prev = (old.inputs as any[]).find(o => o.ref === i.ref);
        if (prev?.hash && prev.hash !== it.content_hash) causes.push(`${i.ref} (${i.role ?? i.kind}) changed`);
        i.version = String(it.version); i.hash = it.content_hash;
      }
    }
    inputs.push(i);
  }
  if (old.tool_version !== cur.version) causes.push(`tool ${old.job} ${old.tool_version} → ${cur.version}`);

  const rec: any = {
    id: randomUUID(), job: old.job, tool_version: cur.version, tool_commit: cur.commit, author: person.id, created_at: x.now.toISOString(),
    client_id: old.client_id ?? null, project_id: old.project_id, asset_ids: old.asset_ids ?? [], legal_tag: old.legal_tag,
    title: old.title ? `${old.title} (re-run on ${cur.version})` : `Re-run of ${old.id.slice(0, 8)} on ${cur.version}`,
    inputs, assumptions: r.assumptions ?? old.assumptions ?? {}, params: r.params ?? old.params, outputs: r.outputs ?? {},
    parents: [old.id], status: 'draft', tags: ['rerun'], facets: { rerun: { of: old.id, from_version: old.tool_version, causes } },
  };
  rec.input_hash = runInputHash(rec);
  const created = await createRun({ ...x, a: { scope: x.a.scope, refs: [], detail: {} } } as Ctx, rec, null);
  const newId = (created.body as any).id as string;

  // Delta, spread and the note.
  const { changes, unchanged } = computeChanges(old.outputs ?? {}, rec.outputs ?? {});
  const history = (await db.query<any>("SELECT record->'outputs' AS outputs FROM runs WHERE job=$1 AND project_id=$2 AND status='final' AND NOT hidden", [old.job, old.project_id])).rows.map(h => h.outputs);
  const spread = historicalSpread(history);
  const review_required = changes.some(c => c.kind === 'changed' && typeof c.abs === 'number' && spread[c.output] != null && Math.abs(c.abs) > spread[c.output]);
  const provider = deps.provider === undefined ? openProvider() : deps.provider;
  const ex = await explainDelta(provider, { oldRun: old, newRun: rec, changes, causes });
  if (review_required) await db.query("UPDATE runs SET record = jsonb_set(record, '{facets,review_required}', 'true') WHERE id = $1", [newId]);

  const noteId = randomUUID();
  const noteTitle = `Re-run delta: ${old.title ?? old.job} · ${old.tool_version} → ${cur.version}`;
  await db.query(`INSERT INTO items (id, type, title, created_at, authors, client_id, project_id, legal_tag, origin, content_hash, version, extracted)
                  VALUES ($1,'note',$2,$3,$4::text[],$5,$6,$7,$8::jsonb,$9,1,$10::jsonb)`,
    [noteId, noteTitle, x.now.toISOString(), [person.id], old.client_id ?? null, old.project_id, old.legal_tag, JSON.stringify({ source: 'tool', external_id: `rerun:${newId}` }),
     'sha256:' + Buffer.from(newId.replace(/-/g, '').padEnd(64, '0')).toString('hex').slice(0, 64),
     JSON.stringify({ kind: 'rerun-delta', of: old.id, rerun: newId, changes, unchanged, spread, review_required, summary: ex.summary, explanation_source: ex.source, causes })]);
  for (const ref of [`run:${old.id}`, `run:${newId}`]) await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1,$2) ON CONFLICT DO NOTHING', [noteId, ref]);
  const queueId = randomUUID();
  await db.query("INSERT INTO review_queue (id, kind, payload) VALUES ($1,'rerun-delta',$2::jsonb)", [queueId, JSON.stringify({ project_id: old.project_id, of: old.id, rerun: newId, note: noteId, summary: ex.summary, review_required, changes })]);
  if (ex.usage) await db.query("INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out) VALUES ($1,'llm.delta',$2,$3::text[],$4::jsonb,$5,$6,$7)",
    [person.id, x.a.scope, [`run:${newId}`], JSON.stringify({ model: ex.model }), ex.usage.input, ex.usage.cached, ex.usage.output]);

  x.a.refs = [`run:${old.id}`, `run:${newId}`, `doc:${noteId}`];
  x.a.detail = { from_version: old.tool_version, to_version: cur.version, changes: changes.length, review_required, deduplicated: (created.body as any).deduplicated };
  return { status: 201, body: { id: newId, deduplicated: (created.body as any).deduplicated, note_id: noteId, queue_id: queueId, delta: { changes, unchanged, spread, review_required, summary: ex.summary, explanation_source: ex.source, causes } } };
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/runs/:id/rerun', 'run.rerun', rerun);

  route(app, 'GET', '/api/projects/:id/stale', 'project.stale', async (x) => {
    const pid = x.c.req.param('id') as string;
    const acc = await loadAccess(x.db, x.person, x.now);
    if (!acc.projects.has(pid)) throw notFound(`project ${pid} not found`);
    const runs = (await x.db.query<any>('SELECT id, job, tool_version, title, legal_tag, project_id, created_at, stale_reasons FROM runs WHERE project_id=$1 AND stale AND NOT hidden ORDER BY created_at DESC', [pid])).rows.filter(r => canSee(acc, r.legal_tag, r.project_id));
    const items = (await x.db.query<any>('SELECT id, type, title, legal_tag, project_id, created_at, reference_no, stale_reasons FROM items WHERE project_id=$1 AND stale AND NOT hidden ORDER BY created_at DESC', [pid])).rows.filter(r => canSee(acc, r.legal_tag, r.project_id));
    const last = (await x.db.query<any>("SELECT finished_at, summary FROM jobs WHERE name='nightly-staleness' AND status='ok' ORDER BY id DESC LIMIT 1")).rows[0] ?? null;
    x.a.scope = scopeLabel(pid); x.a.refs = [...runs.map(r => `run:${r.id}`), ...items.map(i => `doc:${i.id}`)];
    return { body: { project_id: pid, runs, items, last_job: last } };
  });

  route(app, 'GET', '/api/queue/review', 'queue.review.list', async (x) => {
    const kind = x.c.req.query('kind'); const status = x.c.req.query('status') ?? 'open';
    const params: unknown[] = [status]; let where = 'status = $1';
    if (kind) { params.push(kind); where += ` AND kind = $${params.length}`; }
    const acc = await loadAccess(x.db, x.person, x.now);
    const rows = (await x.db.query<any>(`SELECT id, kind, payload, status, created_at, resolved_by, resolved_at FROM review_queue WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params)).rows
      .filter(r => !r.payload?.project_id || acc.projects.has(r.payload.project_id));
    x.a.scope = 'firm'; x.a.detail = { count: rows.length, kind: kind ?? null };
    return { body: { items: rows } };
  });

  for (const verb of ['accept', 'reject'] as const) {
    route(app, 'POST', `/api/queue/review/:id/${verb}`, `queue.review.${verb}`, async (x) => {
      const id = uuidParam(x.c);
      const row = (await x.db.query<any>('SELECT id, kind, payload, status FROM review_queue WHERE id = $1', [id])).rows[0];
      if (!row) throw notFound(`review item ${id} not found`);
      if (row.status !== 'open') throw conflict(`review item ${id} is already ${row.status}`);
      if (row.kind !== 'rerun-delta') requirePartner(x.person, `${verb} a ${row.kind} review item`);
      await x.db.query('UPDATE review_queue SET status=$2, resolved_by=$3, resolved_at=$4 WHERE id=$1', [id, verb === 'accept' ? 'accepted' : 'rejected', x.person.id, x.now.toISOString()]);
      if (verb === 'accept' && row.kind === 'rerun-delta' && row.payload?.rerun) {
        await x.db.query("UPDATE runs SET status='reviewed', record = jsonb_set(record, '{reviewed_by}', to_jsonb($2::text)) WHERE id=$1 AND status='draft'", [row.payload.rerun, x.person.id]);
      }
      x.a.refs = [`review:${id}`]; x.a.detail = { kind: row.kind };
      return { body: { id, status: verb === 'accept' ? 'accepted' : 'rejected' } };
    });
  }
}
