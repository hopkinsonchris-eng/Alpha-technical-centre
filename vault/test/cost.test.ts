// M17 AC4: the cost report's totals equal the sum of the audit events' costs for the period; cost_usd is computed from the
// price table where the event has none; a monthly budget raises an alert. Infrastructure lines add up (AC14).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { costReport, DEFAULT_INFRA, featureOf, INFRA_CEILING_USD, parseInfra } from '../src/cost.ts';
import { costOf, priceFor, PRICES } from '../src/prices.ts';

const DOMAIN = 'alpha-technical-centre.com';
let db: Db;

interface Ev { at: string; action: string; in?: number; cached?: number; out?: number; cost?: number; detail?: object }
async function event(e: Ev) {
  await db.query('INSERT INTO audit_events (at, person_id, action, scope, detail, tokens_in, tokens_cached, tokens_out, cost_usd) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)',
    [e.at, 'chris', e.action, 'firm', JSON.stringify(e.detail ?? {}), e.in ?? null, e.cached ?? null, e.out ?? null, e.cost ?? null]);
}

// September 2026 fixture. Expected USD worked out by hand from the Sep 2026 list prices (per 1M tokens in / out):
// sonnet 2 / 10, opus 4 / 20, haiku 1 / 5; cache reads at 0.1 x input; batch at half.
const EVENTS: Array<Ev & { usd: number }> = [
  { at: '2026-09-01T09:00:00Z', action: 'llm.draft', in: 1_000_000, cached: 500_000, out: 100_000, detail: { model: 'claude-sonnet-5-5' }, usd: 3.1 },     // 2 + 0.1 + 1
  { at: '2026-09-09T09:00:00Z', action: 'llm.draft', in: 250_000, out: 50_000, detail: { model: 'claude-opus-5-5' }, usd: 2 },                              // 1 + 1
  { at: '2026-09-09T10:00:00Z', action: 'llm.tool', in: 2_000_000, out: 400_000, cost: 0.75, detail: { model: 'claude-haiku-4-5' }, usd: 0.75 },             // recorded cost wins over the table (would be 4)
  { at: '2026-09-10T10:00:00Z', action: 'llm.delta', in: 40_000, out: 4_000, detail: { model: 'fake-1' }, usd: 0 },
  { at: '2026-09-16T09:00:00Z', action: 'llm.dream', in: 1_000_000, out: 100_000, detail: { model: 'claude-sonnet-5-5', batch: true }, usd: 1.5 },       // (2 + 1) / 2
  { at: '2026-09-16T09:05:00Z', action: 'paper_facts.extract', detail: { model: 'claude-haiku-4-5', tokens_in: 500_000, tokens_out: 50_000 }, usd: 0.75 },   // counts live in detail
  { at: '2026-09-17T09:00:00Z', action: 'ingest.context', in: 1_000_000, cached: 4_000_000, out: 200_000, detail: { model: 'claude-haiku-4-5' }, usd: 2.4 }, // 1 + 0.4 + 1
  { at: '2026-09-18T09:00:00Z', action: 'llm.tool', in: 1000, out: 100, detail: { model: 'mystery-9' }, usd: 0 },                                                  // no price: counted, not guessed
  { at: '2026-09-30T23:59:00Z', action: 'x.unmapped', in: 100_000, out: 10_000, detail: { model: 'claude-sonnet-5-5' }, usd: 0.3 },                            // last minute of the month
];

before(async () => {
  db = await openDb(undefined); await migrate(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris',$1,'Chris','partner'),('ana',$2,'Ana','associate')", [`chris@${DOMAIN}`, `ana@${DOMAIN}`]);
  for (const e of EVENTS) await event(e);
  await event({ at: '2026-09-16T09:10:00Z', action: 'lesson.dream', detail: { tokens: { input: 1_000_000, output: 100_000 } } });                              // a summary that repeats totals: never counted
  await event({ at: '2026-08-31T23:59:00Z', action: 'llm.draft', in: 9_000_000, out: 900_000, detail: { model: 'claude-sonnet-5-5' } });                       // August
  await event({ at: '2026-10-01T00:00:00Z', action: 'llm.draft', in: 9_000_000, out: 900_000, detail: { model: 'claude-sonnet-5-5' } });                       // October
  await event({ at: '2026-09-12T09:00:00Z', action: 'search.query' });                                                                                          // no tokens
});
after(async () => { await db.close(); });

const setting = (k: string, v: unknown) => db.query('INSERT INTO settings (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
const unsetting = (k: string) => db.query('DELETE FROM settings WHERE key = $1', [k]);
const cents = (n: number) => Math.round(n * 100);

test('the price table holds the Sep 2026 list prices; cache reads cost a tenth; unknown models have no price', () => {
  assert.deepEqual([PRICES['claude-fable-5-1'].input, PRICES['claude-fable-5-1'].output], [10, 50]);
  assert.deepEqual([PRICES['claude-opus-5-5'].input, PRICES['claude-opus-5-5'].output], [4, 20]);
  assert.deepEqual([PRICES['claude-sonnet-5-5'].input, PRICES['claude-sonnet-5-5'].output], [2, 10]);
  assert.deepEqual([PRICES['claude-haiku-4-5'].input, PRICES['claude-haiku-4-5'].output], [1, 5]);
  assert.equal(costOf('claude-sonnet-5-5', { input: 0, cached: 1_000_000, output: 0 }), 0.2);
  assert.equal(costOf('claude-opus-5-5', { input: 1_000_000, cached: 0, output: 1_000_000 }), 24);
  assert.equal(costOf('claude-sonnet-5-5-20260901', { input: 1_000_000, cached: 0, output: 0 }), 2, 'dated model ids resolve');
  assert.equal(costOf('claude-sonnet-5-5', { input: 1_000_000, cached: 0, output: 0 }, { batch: true }), 1);
  assert.equal(costOf('mystery-9', { input: 1, cached: 0, output: 1 }), undefined);
  assert.equal(priceFor(undefined), undefined);
  assert.equal(costOf('claude-haiku-4-5', { input: 30, cached: 0, output: 0 }), 0.00003);
  assert.equal(costOf('claude-haiku-4-5', { input: 3, cached: 0, output: 0 }), 0, 'rounded to five decimals, the precision of audit_events.cost_usd');
});

test('the audit action → feature mapping', () => {
  const m = (a: string) => featureOf(a);
  assert.deepEqual(['llm.draft', 'llm.tool', 'llm.delta', 'llm.dream', 'dream', 'ingest.context', 'miners.paper-facts', 'paper_facts.extract', 'lesson.dream', 'draft.create'].map(m),
    ['draft', 'tool', 'delta', 'dream', 'dream', 'chunking', 'extraction', 'extraction', 'other', 'other']);
  assert.equal(m('llm.drafted'), 'other', 'a prefix matches whole words only');
  assert.equal(m('dream.run'), 'dream');
});

test('AC4: the totals equal the sum of the audit events\' costs for the period, by feature and by week', async () => {
  const r = await costReport(db, '2026-09-01', '2026-09-30');
  const hand = EVENTS.reduce((n, e) => n + cents(e.usd), 0);
  assert.equal(cents(r.llm.cost_usd), hand);
  assert.equal(r.llm.cost_usd, 10.8);
  // the same total, from the database: recorded costs plus the hand-computed cost of the rows that had none
  const recorded = Number((await db.query("SELECT COALESCE(sum(cost_usd),0)::text AS s FROM audit_events WHERE at >= '2026-09-01' AND at < '2026-10-01'")).rows[0].s);
  const computed = EVENTS.filter(e => e.cost === undefined).reduce((n, e) => n + e.usd, 0);
  assert.equal(cents(recorded + computed), hand);
  // features and weeks add up to the same figure
  assert.equal(r.features.reduce((n, f) => n + cents(f.cost_usd), 0), hand);
  assert.equal(r.weekly.reduce((n, w) => n + cents(w.cost_usd), 0), hand);
  const f = Object.fromEntries(r.features.map(x => [x.feature, x]));
  assert.equal(f.draft.cost_usd, 5.1); assert.equal(f.draft.calls, 2);
  assert.equal(f.tool.cost_usd, 0.75); assert.equal(f.tool.calls, 2);
  assert.equal(f.delta.cost_usd, 0);
  assert.equal(f.dream.cost_usd, 1.5);
  assert.equal(f.extraction.cost_usd, 0.75); assert.equal(f.extraction.tokens_in, 500_000); assert.equal(f.extraction.tokens_out, 50_000);
  assert.equal(f.chunking.cost_usd, 2.4); assert.equal(f.chunking.cache_hit_rate, 0.8);
  assert.equal(f.other.cost_usd, 0.3);
  assert.equal(r.llm.calls, EVENTS.length, 'the no-token search, the lesson.dream summary and the other months are not calls');
  assert.equal(r.llm.unpriced_calls, 1);
  assert.equal(r.llm.tokens_in, EVENTS.reduce((n, e) => n + (e.in ?? (e.detail as any)?.tokens_in ?? 0), 0));
  // weekly series: Mondays, every week from the first to the last, none missing
  assert.deepEqual(r.weekly.map(w => w.week), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  assert.deepEqual(r.weekly.map(w => w.cost_usd), [3.1, 2.75, 4.65, 0, 0.3]);
  assert.equal(r.weekly[1].by_feature.draft, 2); assert.equal(r.weekly[1].by_feature.tool, 0.75);
  // a narrower period is the sum of its own events; the boundaries are inclusive dates
  const mid = await costReport(db, '2026-09-09', '2026-09-10');
  assert.equal(mid.llm.cost_usd, 2.75); assert.equal(mid.llm.calls, 3);
  assert.equal((await costReport(db, '2026-08-31', '2026-08-31')).llm.calls, 1);
});

test('infrastructure lines default to the running-cost table and the total is their sum (AC14)', async () => {
  await unsetting('infra_costs');
  const r = await costReport(db, '2026-09-01', '2026-09-30');
  assert.deepEqual(r.infrastructure.lines.map(l => [l.label, l.usd_month]), [['Render', 7], ['Render cron jobs', 2], ['Supabase', 25], ['Cloudflare', 0], ['Voyage', 3]]);
  assert.equal(r.infrastructure.total_usd, 37);
  assert.equal(r.infrastructure.source, 'default');
  assert.ok(r.infrastructure.total_usd <= INFRA_CEILING_USD && r.infrastructure.ceiling_usd === 60);
  assert.equal(DEFAULT_INFRA.reduce((n, l) => n + l.usd_month, 0), 37);
  assert.equal(cents(r.total_usd), cents(r.llm.cost_usd) + cents(r.infrastructure.total_usd));

  await setting('infra_costs', [{ label: 'Render', plan: 'starter', usd_month: 7.25 }, { label: 'Supabase', usd_month: 25.1 }, { label: 'Broken', usd_month: 'lots' }]);
  const custom = await costReport(db, '2026-09-01', '2026-09-30');
  assert.equal(custom.infrastructure.source, 'settings');
  assert.deepEqual(custom.infrastructure.lines.map(l => l.usd_month), [7.25, 25.1]);
  assert.equal(custom.infrastructure.total_usd, 32.35);
  assert.deepEqual(custom.infrastructure.ignored, ['Broken']);
  assert.deepEqual(parseInfra({ render: 7, 'Supabase Pro': { usd_month: 25, plan: 'Pro' } }).lines.map(l => [l.key, l.usd_month]), [['render', 7], ['supabase-pro', 25]]);
  await unsetting('infra_costs');
});

test('a monthly budget raises an alert when a feature exceeds it, and a warning at 80 %', async () => {
  await unsetting('budgets');
  assert.deepEqual((await costReport(db, '2026-09-01', '2026-09-30')).alerts, []);
  await setting('budgets', { draft: 5, dream: 1.5, tool: 10, chunking: 100, extraction: 'lots' });
  const r = await costReport(db, '2026-09-01', '2026-09-30');
  assert.deepEqual(r.budgets, { draft: 5, dream: 1.5, tool: 10, chunking: 100 });
  assert.deepEqual(r.alerts.map(a => [a.feature, a.level, a.month, a.budget_usd, a.spent_usd]), [['draft', 'exceeded', '2026-09', 5, 5.1], ['dream', 'warning', '2026-09', 1.5, 1.5]]);
  assert.equal(r.alerts[0].pct, 102);
  assert.equal(r.features.find(f => f.feature === 'draft')!.budget_usd, 5);
  // the alert is about the calendar month of `to`, whatever the range shown
  const late = await costReport(db, '2026-09-20', '2026-09-30');
  assert.equal(late.features.find(f => f.feature === 'draft')!.cost_usd, 0);
  assert.equal(late.alerts.find(a => a.feature === 'draft')!.spent_usd, 5.1);
  const aug = await costReport(db, '2026-08-01', '2026-08-31');   // one big draft call on 31 August: 9 M in at 2 + 0.9 M out at 10 = 27 against a budget of 5
  assert.deepEqual(aug.alerts.map(a => [a.feature, a.level, a.month, a.spent_usd]), [['draft', 'exceeded', '2026-08', 27]]);
  await unsetting('budgets');
});

test('GET /api/cost and /api/eval/results: partners only, validated, and consistent with the report', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'evalres-'));
  process.env.EVAL_RESULTS_DIR = dir;
  try {
    writeFileSync(path.join(dir, '2026-09-22.json'), JSON.stringify({ date: '2026-09-22', k: 5, thresholds: { faithfulness: 0.85, context_precision: 0.7 }, metrics: { faithfulness: 0.9, context_precision: 0.76, context_recall: 0.8, response_relevancy: 0.6 }, passed: true, questions: [{}, {}] }));
    writeFileSync(path.join(dir, '2026-09-29.json'), JSON.stringify({ date: '2026-09-29', k: 5, metrics: { faithfulness: 0.92, context_precision: 0.78 }, passed: true, questions: [{}] }));
    writeFileSync(path.join(dir, '2026-09-29.regress-no-rerank.json'), '{}');
    writeFileSync(path.join(dir, '2026-09-30.json'), 'not json');
    const as = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
    const chris = await as(`chris@${DOMAIN}`), ana = await as(`ana@${DOMAIN}`);
    const r = await chris.request('/api/cost?from=2026-09-01&to=2026-09-30');
    assert.equal(r.status, 200);
    const body: any = await r.json();
    assert.equal(body.llm.cost_usd, 10.8);
    assert.equal(body.infrastructure.total_usd, body.infrastructure.lines.reduce((n: number, l: any) => n + l.usd_month, 0));
    assert.equal((await chris.request('/api/cost')).status, 200, 'defaults to this month');
    assert.equal((await ana.request('/api/cost?from=2026-09-01&to=2026-09-30')).status, 403);
    for (const q of ['from=2026-9-1', 'to=yesterday', 'from=2026-02-30', 'from=2026-09-30&to=2026-09-01', 'from=2020-01-01&to=2026-09-30']) assert.equal((await chris.request('/api/cost?' + q)).status, 400, q);

    const e: any = await (await ana.request('/api/eval/results')).json();
    assert.deepEqual(e.results.map((x: any) => x.date), ['2026-09-22', '2026-09-29'], 'oldest first; regression and corrupt files are left out');
    assert.equal(e.results[0].metrics.context_precision, 0.76); assert.equal(e.results[0].questions, 2);
  } finally { delete process.env.EVAL_RESULTS_DIR; rmSync(dir, { recursive: true, force: true }); }
});
