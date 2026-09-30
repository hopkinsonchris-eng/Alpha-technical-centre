/**
 * Analogue memory (M16). Rows are read only through the legal-tag predicate in
 * analogues/similar.ts, so no handler here returns a row without a scope.
 *
 *   GET  /api/analogues?scope=&asset=&provenance=          the rows in scope
 *   GET  /api/analogues/similar?scope=&asset=<id>|row=<json>&k=   nearest rows with distance and drivers
 *   GET  /api/analogues/defaults?scope=&play_type=         low/mid/high per input, with counts and provenance mix
 *   POST /api/analogues/emit/:runId                        (re)build the row for one evaluation run
 *
 * `scope` is required (project:<id> | client:<id> | firm | public): 400 when
 * missing or malformed, 403 when the caller may not hold it.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, assertVisible, bad, intParam, loadAccess, notFound, route, scopeLabel, uuidParam, type Ctx } from './common.ts';
import { ScopeError, type ResolvedScope } from '../gateway/scope.ts';
import { toScope, visibleRows, similar as findSimilar } from '../analogues/similar.ts';
import { defaults, PlayError } from '../analogues/defaults.ts';
import { emitForRun, EmitError } from '../analogues/emit.ts';
import { validator } from '../schemas.ts';

const PROVENANCE = (): string[] => (validator('analogue-row').schema as any).properties.provenance.enum;

async function scopeOf(x: Ctx): Promise<ResolvedScope> {
  try { return (await toScope(x.db, x.c.req.query('scope') as string, x.person)).scope; }
  catch (e) {
    if (e instanceof ScopeError) throw new ApiError(e.status, e.status === 403 ? 'forbidden' : 'invalid', e.message, '?scope');
    throw e;
  }
}
const mapErr = (e: unknown): never => {
  if (e instanceof PlayError) throw bad(e.message, '?play_type');
  if (e instanceof EmitError) throw e.status === 404 ? notFound(e.message) : new ApiError(422, 'invalid', e.message);
  const s = (e as any)?.status;
  if (s === 404) throw notFound((e as Error).message);
  if (s === 400) throw bad((e as Error).message);
  throw e;
};

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/analogues', 'analogue.list', async (x) => {
    const scope = await scopeOf(x);
    const provenance = x.c.req.query('provenance') || undefined;
    if (provenance && !PROVENANCE().includes(provenance)) throw bad(`provenance must be one of ${PROVENANCE().join(', ')}`, '?provenance');
    const asset = x.c.req.query('asset') || undefined;
    const limit = intParam(x.c, 'limit', 1000, 5000);
    const { rows } = await visibleRows(x.db, x.person, scope, { asset, provenance, now: x.now, limit });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.provenance] = (counts[r.provenance] ?? 0) + 1;
    x.a.scope = scope.label; x.a.refs = [...new Set(rows.map(r => r.source_ref))];
    x.a.detail = { count: rows.length, asset: asset ?? null, provenance: provenance ?? null };
    return { body: { scope: scope.label, count: rows.length, counts, rows } };
  });

  route(app, 'GET', '/api/analogues/similar', 'analogue.similar', async (x) => {
    const scope = await scopeOf(x);
    const asset = x.c.req.query('asset') || undefined;
    const rawRow = x.c.req.query('row');
    if (!asset && !rawRow) throw bad('give asset=<id> or row=<json>', '?asset');
    if (asset && rawRow) throw bad('give asset or row, not both', '?row');
    let row: Record<string, any> | undefined;
    if (rawRow) {
      try { row = JSON.parse(rawRow); } catch { throw bad('row must be valid JSON', '?row'); }
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad('row must be a JSON object', '?row');
    }
    const k = intParam(x.c, 'k', 10, 50);
    let r; try { r = await findSimilar(x.db, x.person, scope, asset ? { asset_id: asset } : { row }, k, { now: x.now }); } catch (e) { return mapErr(e); }
    x.a.scope = scope.label; x.a.refs = r.hits.map(h => h.source_ref);
    x.a.detail = { k, asset: asset ?? null, returned: r.hits.length, population: r.population };
    return { body: { scope: scope.label, k, target: r.target, population: r.population, hits: r.hits } };
  });

  route(app, 'GET', '/api/analogues/defaults', 'analogue.defaults', async (x) => {
    const scope = await scopeOf(x);
    const play = x.c.req.query('play_type');
    if (!play) throw bad('play_type is required', '?play_type');
    let d; try { d = await defaults(x.db, x.person, scope, play, { now: x.now }); } catch (e) { return mapErr(e); }
    x.a.scope = scope.label; x.a.detail = { play_type: play, n_rows: d.n_rows, inputs: Object.keys(d.inputs).length };
    return { body: d };
  });

  route(app, 'POST', '/api/analogues/emit/:runId', 'analogue.emit', async (x) => {
    const id = uuidParam(x.c, 'runId');
    const run = (await x.db.query<any>('SELECT project_id, legal_tag, hidden FROM runs WHERE id = $1', [id])).rows[0];
    if (!run || run.hidden) throw notFound(`run ${id} not found`);
    x.a.refs = [`run:${id}`]; x.a.scope = scopeLabel(run.project_id);
    assertVisible(await loadAccess(x.db, x.person, x.now), run.legal_tag, run.project_id, `run ${id}`);
    let r; try { r = await emitForRun(x.db, id); } catch (e) { return mapErr(e); }
    x.a.detail = { result: r.status, ...(r.reason ? { reason: r.reason } : {}) };
    return { status: r.status === 'emitted' ? 201 : 200, body: r };
  });
}
