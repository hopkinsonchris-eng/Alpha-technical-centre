/**
 * Scorecard routes (M17). The rules and their meaning are in src/scorecards.ts.
 *   GET /api/projects/:id/scorecard   {project_id, as_of, rules:[{n,id,name,status,detail,refs}], summary:{pass,fail,not_measurable,rag}}
 *   GET /api/scorecards               {as_of, rules:[{n,id,name}], projects:[{id,name,client_id,client_name,status,rag,pass,fail,not_measurable,rules:[{n,id,status}]}], summary:{green,amber,red,grey}}
 *                                     every project the caller can see; only records in the caller's scope are counted.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { route, scopeLabel } from './common.ts';
import { RULES, scorecard, scorecards } from '../scorecards.ts';

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/projects/:id/scorecard', 'project.scorecard', async (x) => {
    const id = x.c.req.param('id')!;
    x.a.scope = scopeLabel(id);
    const s = await scorecard(x.db, x.person, id, x.now);
    x.a.refs = [`project:${id}`]; x.a.detail = { ...s.summary };
    return { body: s };
  });

  route(app, 'GET', '/api/scorecards', 'scorecard.list', async (x) => {
    const rows = await scorecards(x.db, x.person, x.now);
    x.a.scope = 'firm'; x.a.refs = rows.map(r => `project:${r.project_id}`); x.a.detail = { count: rows.length };
    const summary = { green: 0, amber: 0, red: 0, grey: 0 };
    for (const r of rows) summary[r.scorecard.summary.rag]++;
    return {
      body: {
        as_of: x.now.toISOString(), rules: RULES.map((r, i) => ({ n: i + 1, ...r })), summary,
        projects: rows.map(r => ({
          id: r.project_id, name: r.name, client_id: r.client_id, client_name: r.client_name, status: r.status, rag: r.scorecard.summary.rag,
          pass: r.scorecard.summary.pass, fail: r.scorecard.summary.fail, not_measurable: r.scorecard.summary.not_measurable,
          rules: r.scorecard.rules.map(u => ({ n: u.n, id: u.id, status: u.status })),
        })),
      },
    };
  });
}
