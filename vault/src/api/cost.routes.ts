/**
 * Cost and evaluation results (M17).
 *   GET /api/cost?from=&to=     token spend per feature and week from the audit log, infrastructure lines from
 *                               settings.infra_costs, budget alerts from settings.budgets. from and to are dates
 *                               (YYYY-MM-DD, inclusive); default: the first of this month to today. Partners only:
 *                               it is firm spend. See src/cost.ts for the action → feature mapping.
 *   GET /api/eval/results       the retrieval-evaluation runs written by eval/runner.ts (eval/results/<date>.json),
 *                               oldest first, summary only; the Hub draws the trend from it. EVAL_RESULTS_DIR overrides
 *                               the directory. No client content is in these files (a seeded synthetic corpus).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, requirePartner, route } from './common.ts';
import { costReport } from '../cost.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../eval/results');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const MAX_RESULTS = 60;

function dateParam(v: string | undefined, name: string, fallback: string): string {
  if (v === undefined || v === '') return fallback;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (!DATE_RE.test(v) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) throw bad(`${name} must be a date, YYYY-MM-DD`, `?${name}`);
  return v;
}

export function evalResults(dir = process.env.EVAL_RESULTS_DIR || DIR) {
  let files: string[] = [];
  try { files = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-MAX_RESULTS); } catch { return []; }
  const out: any[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      out.push({ date: j.date ?? f.slice(0, 10), questions: j.questions?.length ?? j.n_questions ?? null, k: j.k ?? null, thresholds: j.thresholds ?? {}, metrics: j.metrics ?? {}, leaks: j.leaks ?? 0, passed: !!j.passed });
    } catch { /* a corrupt file is skipped, not fatal */ }
  }
  return out;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/cost', 'cost.report', async (x) => {
    requirePartner(x.person, 'the cost report');
    const today = x.now.toISOString().slice(0, 10);
    const from = dateParam(x.c.req.query('from'), 'from', today.slice(0, 8) + '01');
    const to = dateParam(x.c.req.query('to'), 'to', today);
    if (from > to) throw bad('from must not be after to', '?from');
    if ((Date.parse(to) - Date.parse(from)) / 864e5 >= MAX_DAYS) throw bad(`the range is limited to ${MAX_DAYS} days`, '?to');
    x.a.scope = 'firm'; x.a.detail = { from, to };
    return { body: await costReport(x.db, from, to) };
  });

  route(app, 'GET', '/api/eval/results', 'eval.results', async (x) => {
    x.a.scope = 'firm';
    const results = evalResults();
    x.a.detail = { count: results.length };
    return { body: { results } };
  });
}
