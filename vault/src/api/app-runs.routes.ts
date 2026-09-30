/**
 * POST /api/app/runs (M05, D6): where the external APEX apps push run records.
 *
 * The route authenticates the app token itself (src/app-tokens.ts), so the
 * bearer token, not an Access login, decides who is calling. It then:
 *   - forces rec.job to the token's tool (a token for tool A cannot write job B),
 *   - forces rec.author to app:<tool> (added as a service person on first sight),
 *   - stamps facets.capture = 'push',
 *   - fills id, created_at, status and input_hash when the app leaves them out,
 *   - delegates to createRun, so validation, legal tags and dedupe are the same as for staff.
 * Nothing else is reachable with an app token.
 *
 * Deployment note: src/app.ts requires an Access identity on every /api route
 * before route handlers run. See src/adapters/README.md ("Bypass in app.ts").
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { AuthError } from '../auth.ts';
import { appPersonFor, ensureAppPerson, verifyAppToken } from '../app-tokens.ts';
import { ApiError, jsonBody, route, type Ctx } from './common.ts';
import { createRun } from './runs.routes.ts';
import { runInputHash } from '../hash.ts';

/** Force the app's identity onto a posted record. Exported for the snapshot job and tests. */
export function stampAppRun(rec: any, tool: string, capture: 'push' | 'snapshot' = 'push', now = new Date()): any {
  const facets = rec.facets && typeof rec.facets === 'object' && !Array.isArray(rec.facets) ? rec.facets : {};
  const out: any = { ...rec, job: tool, author: `app:${tool}`, facets: { ...facets, capture } };
  out.id ??= randomUUID();
  out.created_at ??= now.toISOString();
  out.status ??= 'draft';
  if (out.input_hash == null && out.inputs !== undefined && out.params !== undefined) out.input_hash = runInputHash(out);
  return out;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/app/runs', 'run.create', async (x) => {
    // Until the token checks out the caller is nobody; audit records that.
    x.person = { id: 'app:unauthenticated', email: 'unauthenticated@app.invalid', name: 'unauthenticated app', role: 'service' };
    let svc;
    try { svc = verifyAppToken(x.c.req.raw.headers, process.env); }
    catch (e) { if (e instanceof AuthError) throw new ApiError(401, 'unauthenticated', e.message); throw e; }
    await ensureAppPerson(x.db, svc);
    x.person = appPersonFor(svc.tool);
    x.a.detail = { app: svc.tool, capture: 'push' };
    return createRun(x as Ctx, stampAppRun(await jsonBody(x.c), svc.tool), null);
  });
}
