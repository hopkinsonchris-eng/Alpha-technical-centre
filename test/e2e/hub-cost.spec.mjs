// M17: Hub cost and health page. The API is stubbed with page.route; the static server (python3 -m http.server,
// started by playwright.config.mjs) serves the pages.
// AC4 (page): the total shown equals the sum of what is shown. AC5 (AC14): infrastructure <= USD 60 and equals the sum of its lines.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence/m17-cost.png');

const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route, status, code, message) => json(route, { error: { code, message } }, status);
const cents = (n) => Math.round(n * 100);
const money = (t) => Number(String(t).replace(/[^0-9.\-]/g, ''));

const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 8) + '01';
const monday = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/* ── seeded server answers ───────────────────────────────────────────── */

const FEATURES = [
  { feature: 'draft', label: 'Drafting', calls: 40, tokens_in: 3_100_000, tokens_cached: 0, tokens_out: 420_000, cost_usd: 27.4, cache_hit_rate: null, budget_usd: 25 },
  { feature: 'tool', label: 'Tool assistant', calls: 12, tokens_in: 400_000, tokens_cached: 0, tokens_out: 60_000, cost_usd: 1.4, cache_hit_rate: null, budget_usd: null },
  { feature: 'delta', label: 'Delta notes', calls: 6, tokens_in: 900_000, tokens_cached: 0, tokens_out: 90_000, cost_usd: 4.1, cache_hit_rate: null, budget_usd: null },
  { feature: 'chunking', label: 'Chunking', calls: 300, tokens_in: 1_700_000, tokens_cached: 7_700_000, tokens_out: 550_000, cost_usd: 11.6, cache_hit_rate: 0.82, budget_usd: 12 },
  { feature: 'dream', label: 'Dream', calls: 4, tokens_in: 2_200_000, tokens_cached: 0, tokens_out: 120_000, cost_usd: 6.8, cache_hit_rate: null, budget_usd: null },
  { feature: 'extraction', label: 'Extraction', calls: 80, tokens_in: 5_800_000, tokens_cached: 0, tokens_out: 310_000, cost_usd: 18.15, cache_hit_rate: null, budget_usd: null },
];
const LLM_TOTAL = FEATURES.reduce((n, f) => n + cents(f.cost_usd), 0) / 100;          // 69.45
const INFRA = [
  { key: 'render', label: 'Render', plan: 'Web service vault-api, starter; static site free', usd_month: 7 },
  { key: 'supabase', label: 'Supabase', plan: 'Pro: Postgres, pgvector, storage, backups', usd_month: 25 },
  { key: 'cloudflare', label: 'Cloudflare', plan: 'Access, 6 of 50 seats', usd_month: 0 },
  { key: 'voyage', label: 'Voyage', plan: 'Embeddings and rerank, 4.1 M tokens', usd_month: 3.5 },
];
const INFRA_TOTAL = INFRA.reduce((n, l) => n + cents(l.usd_month), 0) / 100;          // 35.5

function costBody(over = {}) {
  const w0 = monday(monthStart);
  const weeks = [];
  for (let d = w0; d <= today; d = addDays(d, 7)) weeks.push(d);
  const spread = [3, 2, 1, 2, 1, 1];
  const weekly = weeks.map((w, i) => ({ week: w, calls: 10, tokens_in: 1, tokens_cached: 0, tokens_out: 1, cost_usd: (spread[i % 6] * LLM_TOTAL) / 10, by_feature: {} }));
  return {
    from: monthStart, to: today, currency: 'USD',
    llm: { calls: 442, tokens_in: 14_100_000, tokens_cached: 7_700_000, tokens_out: 1_550_000, cost_usd: LLM_TOTAL, cache_hit_rate: 0.353, unpriced_calls: 0 },
    features: FEATURES, weekly,
    infrastructure: { lines: INFRA, total_usd: INFRA_TOTAL, ceiling_usd: 60, source: 'settings', ignored: [] },
    total_usd: (cents(LLM_TOTAL) + cents(INFRA_TOTAL)) / 100,
    budgets: { draft: 25, chunking: 12 }, budget_month: monthStart.slice(0, 7),
    alerts: [
      { feature: 'draft', label: 'Drafting', month: monthStart.slice(0, 7), budget_usd: 25, spent_usd: 27.4, pct: 109.6, level: 'exceeded' },
      { feature: 'chunking', label: 'Chunking', month: monthStart.slice(0, 7), budget_usd: 12, spent_usd: 11.6, pct: 96.7, level: 'warning' },
    ],
    ...over,
  };
}

const evalRun = (date, f, p, r, rel) => ({ date, questions: 26, k: 5, thresholds: { faithfulness: 0.85, context_precision: 0.7 }, metrics: { faithfulness: f, context_precision: p, context_recall: r, response_relevancy: rel }, leaks: 0, passed: f >= 0.85 && p >= 0.7 });
const EVAL = [evalRun('2026-08-04', 0.88, 0.71, 0.9, 0.6), evalRun('2026-08-18', 0.89, 0.73, 0.92, 0.62), evalRun('2026-09-01', 0.9, 0.74, 0.93, 0.63), evalRun('2026-09-15', 0.92, 0.76, 0.95, 0.66), evalRun('2026-09-29', 0.94, 0.78, 0.96, 0.67)];

const RULES = [
  { n: 1, id: 'tool-version', name: 'Every final run uses the current tool version' },
  { n: 2, id: 'basis-note', name: 'Every evaluation has a basis note' },
  { n: 3, id: 'letter-cites-run', name: 'Every letter cites at least one run' },
  { n: 4, id: 'stale-documents', name: 'No stale document older than 7 days' },
  { n: 5, id: 'unfiled-mail', name: 'No unfiled correspondence older than 3 days' },
  { n: 6, id: 'legal-expiry', name: 'Legal tags not expiring within 30 days without a renewal note' },
];
const proj = (id, name, client, statuses) => {
  const pass = statuses.filter((s) => s === 'pass').length, fail = statuses.filter((s) => s === 'fail').length;
  const rag = pass + fail === 0 ? 'grey' : fail === 0 ? 'green' : fail <= 2 ? 'amber' : 'red';
  return { id, name, client_id: id, client_name: client, status: 'active', rag, pass, fail, not_measurable: 6 - pass - fail, rules: RULES.map((r, i) => ({ n: r.n, id: r.id, status: statuses[i] })) };
};
const P = 'pass', F = 'fail', N = 'not-measurable';
const PROJECTS = [
  proj('llanos-waterflood', 'Llanos Basin waterflood screening', 'Frontera Energy', [P, P, F, F, P, P]),
  proj('middle-magdalena', 'Middle Magdalena infill screening', 'Ecopetrol', [P, F, F, F, P, F]),
  proj('talara-brownfield', 'Talara brownfield redevelopment', 'Costa Norte Petróleos', [P, P, P, P, P, P]),
  proj('putumayo', 'Putumayo tight-sand review', 'Andean Resources', [N, N, N, N, N, N]),
];
const SCORECARDS = { as_of: new Date().toISOString(), rules: RULES, summary: { green: 1, amber: 1, red: 1, grey: 1 }, projects: PROJECTS };

/** Stub /api/**: `over` maps a pathname to a handler; the seeded answers are the default. */
async function stub(page, over = {}) {
  const calls = { cost: [], eval: 0, scorecards: 0 };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (over[p]) return over[p](url, route, calls);
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, { tools: [] });
    if (p === '/api/cost') { calls.cost.push(url.searchParams); return json(route, costBody()); }
    if (p === '/api/eval/results') { calls.eval++; return json(route, { results: EVAL }); }
    if (p === '/api/scorecards') { calls.scorecards++; return json(route, SCORECARDS); }
    return err(route, 404, 'not_found', 'no route');
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const open = async (page, over, qs = '') => { const calls = await stub(page, over); await page.goto('/hub/cost.html' + qs); await ready(page); return calls; };

/* ── tests ───────────────────────────────────────────────────────────── */

test('(a) the total equals the sum of its parts, and infrastructure is within the USD 60 ceiling (AC4, AC5), with the screenshot', async ({ page }) => {
  const calls = await open(page);
  expect(calls.cost).toHaveLength(1);
  expect(calls.cost[0].get('from')).toBe(monthStart);
  expect(calls.cost[0].get('to')).toBe(today);
  await expect(page.locator('#me-name')).toHaveText('Chris Hopkinson');

  // per-feature bars: every feature once, and the bars add up to the token total shown
  await expect(page.locator('[data-feature]')).toHaveCount(FEATURES.length);
  const feature = await page.locator('[data-feature]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-feature'), e.querySelector('.c-feat-top b').textContent]));
  expect(feature.map((f) => f[0])).toEqual(FEATURES.map((f) => f.feature));
  for (const [id, text] of feature) expect(cents(money(text))).toBe(cents(FEATURES.find((f) => f.feature === id).cost_usd));
  const featureSum = feature.reduce((n, f) => n + cents(money(f[1])), 0);
  const llmShown = cents(money(await page.locator('[data-llm-total] > span:last-child').textContent()));
  expect(llmShown).toBe(featureSum);
  await expect(page.locator('[data-feature="chunking"] .c-note')).toContainText('cached 82%');
  await expect(page.locator('[data-feature="draft"] .c-note')).toContainText('3.10 M in');

  // infrastructure: lines add up to the total, and the total is at most 60
  const lines = await page.locator('[data-infra-line] td:last-child').allTextContents();
  expect(lines).toHaveLength(INFRA.length);
  const lineSum = lines.reduce((n, t) => n + cents(money(t)), 0);
  const infraShown = cents(money(await page.locator('[data-infra-total] td:last-child').textContent()));
  expect(infraShown).toBe(lineSum);
  expect(infraShown).toBeLessThanOrEqual(6000);
  expect(cents(money(await page.locator('[data-kpi="infra"] [data-value]').textContent()))).toBe(infraShown);
  await expect(page.locator('[data-kpi="infra"] .d')).toContainText('within the 60 ceiling');

  // grand total = tokens + infrastructure, in the table and in the KPI
  const grand = cents(money(await page.locator('[data-grand-total] td:last-child').textContent()));
  expect(grand).toBe(llmShown + infraShown);
  expect(cents(money(await page.locator('[data-kpi="total"] [data-value]').textContent()))).toBe(grand);
  expect(cents(money(await page.locator('[data-llm-line] td:last-child').textContent()))).toBe(llmShown);

  // weekly series: one bar per week, none missing
  const weeks = await page.locator('[data-week]').evaluateAll((els) => els.map((e) => e.getAttribute('data-week')));
  expect(weeks).toEqual(costBody().weekly.map((w) => w.week));
  await expect(page.locator('#c-title')).toContainText(String(new Date().getUTCFullYear()));

  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  await page.screenshot({ path: EVIDENCE, fullPage: true });
});

test('(b) a feature over its monthly budget is flagged, and one near it is warned', async ({ page }) => {
  await open(page);
  await expect(page.locator('#sec-alerts')).toBeVisible();
  await expect(page.locator('#n-alerts')).toHaveText('2');
  const over = page.locator('[data-alert="draft"]');
  await expect(over).toHaveAttribute('data-level', 'exceeded');
  await expect(over).toHaveClass(/bad/);
  await expect(over).toContainText('over its monthly budget');
  await expect(over).toContainText('USD 27.40 of USD 25.00');
  await expect(page.locator('[data-alert="chunking"]')).toHaveAttribute('data-level', 'warning');
  await expect(page.locator('[data-alert="chunking"]')).toContainText('96.7% of its monthly budget');
  await expect(page.locator('[data-feature="draft"] .hub-bar')).toHaveClass(/over/);
  await expect(page.locator('[data-feature="chunking"] .hub-bar')).not.toHaveClass(/over/);
  await expect(page.locator('[data-feature="draft"] .c-note')).toContainText('budget USD 25.00');
});

test('(b2) no alerts, no alert section; infrastructure above the ceiling is shown as such', async ({ page }) => {
  const big = [...INFRA, { key: 'extra', label: 'Extra service', plan: null, usd_month: 40 }];
  await open(page, { '/api/cost': (u, r) => json(r, costBody({ alerts: [], infrastructure: { lines: big, total_usd: 75.5, ceiling_usd: 60, source: 'settings', ignored: [] }, total_usd: LLM_TOTAL + 75.5 })) });
  await expect(page.locator('#sec-alerts')).toBeHidden();
  await expect(page.locator('[data-kpi="infra"] .d')).toContainText('above the 60 ceiling');
  await expect(page.locator('[data-infra-total]')).toContainText('exceeded');
});

test('(c) RAGAS: latest scores against their targets, the change since the last run, and a trend point per run', async ({ page }) => {
  const calls = await open(page);
  expect(calls.eval).toBe(1);
  const f = page.locator('[data-metric="faithfulness"]');
  await expect(f.locator('[data-value]')).toHaveText('0.94');
  await expect(f.locator('[data-target-met]')).toHaveAttribute('data-target-met', 'yes');
  await expect(f.locator('[data-target-met]')).toContainText('Target ≥ 0.85');
  await expect(f.locator('[data-delta]')).toHaveAttribute('data-delta', '+0.02');
  await expect(f.locator('svg circle')).toHaveCount(EVAL.length);
  const p = page.locator('[data-metric="context_precision"]');
  await expect(p.locator('[data-value]')).toHaveText('0.78');
  await expect(p.locator('[data-target-met]')).toContainText('Target ≥ 0.70');
  await expect(p.locator('svg circle')).toHaveCount(EVAL.length);
  await expect(page.locator('[data-metric="context_recall"] b')).toHaveText('0.96');
  await expect(page.locator('[data-metric="response_relevancy"] b')).toHaveText('0.67');
  await expect(page.locator('#ragas-note')).toContainText('26 gold questions');
});

test('(c2) a run below target is shown as below target; no runs shows how to make one', async ({ page }) => {
  await open(page, { '/api/eval/results': (u, r) => json(r, { results: [evalRun('2026-09-28', 0.9, 0.78, 0.9, 0.6), evalRun('2026-09-29', 0.9, 0.55, 0.7, 0.6)] }) });
  const p = page.locator('[data-metric="context_precision"]');
  await expect(p.locator('[data-target-met]')).toHaveAttribute('data-target-met', 'no');
  await expect(p.locator('[data-target-met]')).toContainText('Below target');
  await expect(p.locator('[data-delta]')).toHaveAttribute('data-delta', '−0.23');
  await expect(page.locator('#ragas-note')).toContainText('below threshold');

  const page2 = await page.context().newPage();
  await stub(page2, { '/api/eval/results': (u, r) => json(r, { results: [] }) });
  await page2.goto('/hub/cost.html');
  await ready(page2);
  await expect(page2.locator('#ragas')).toContainText('No evaluation has run yet');
  await expect(page2.locator('[data-metric]')).toHaveCount(0);
});

test('(d) scorecard grid: a row per project, a cell per rule, and the RAG the server gave', async ({ page }) => {
  const calls = await open(page);
  expect(calls.scorecards).toBe(1);
  await expect(page.locator('#sc-table thead th')).toHaveCount(2 + 6 + 2);
  await expect(page.locator('#sc-table tbody tr')).toHaveCount(PROJECTS.length);
  for (const p of PROJECTS) {
    const row = page.locator(`[data-project="${p.id}"]`);
    await expect(row).toHaveAttribute('data-rag', p.rag);
    await expect(row.locator('a')).toHaveText(p.name);
    await expect(row.locator('a')).toHaveAttribute('href', '/hub/project.html?id=' + p.id);
    await expect(row.locator('td[data-rule]')).toHaveCount(6);
    for (const r of p.rules) await expect(row.locator(`td[data-rule="${r.id}"]`)).toHaveAttribute('data-status', r.status);
    await expect(row.locator('[data-score]')).toHaveText(`${p.pass}/6`);
  }
  await expect(page.locator('[data-project="llanos-waterflood"] .hub-rag')).not.toHaveClass(/\b(g|r|grey)\b/);   // amber
  await expect(page.locator('[data-project="talara-brownfield"] .hub-rag')).toHaveClass(/\bg\b/);
  await expect(page.locator('[data-project="middle-magdalena"] .hub-rag')).toHaveClass(/\br\b/);
  await expect(page.locator('[data-project="putumayo"] .hub-rag')).toHaveClass(/grey/);
  // status is in words for assistive technology, not only in colour
  await expect(page.locator('[data-project="middle-magdalena"] td[data-rule="basis-note"] .sr-only')).toHaveText('Fail');
  await expect(page.locator('[data-project="putumayo"] td[data-rule="tool-version"] .sr-only')).toHaveText('Not measurable');
  await expect(page.locator('[data-project="talara-brownfield"] .hub-rag + .sr-only')).toHaveText('Green');
  await expect(page.locator('#status-strip')).toContainText('1 green · 1 amber · 1 red');
});

test('(e) associates see the reason instead of the spend; unbuilt endpoints hide their section; a failing API says so', async ({ page }) => {
  await open(page, { '/api/cost': (u, r) => err(r, 403, 'forbidden', 'the cost report is for partners') });
  await expect(page.locator('.hub-notice.warn')).toContainText('Cost is for partners only');
  await expect(page.locator('#sec-cost')).toBeHidden();
  await expect(page.locator('#sec-alerts')).toBeHidden();
  await expect(page.locator('#sc-table tbody tr')).toHaveCount(PROJECTS.length);   // the rest still works

  const p2 = await page.context().newPage();
  await stub(p2, { '/api/cost': (u, r) => err(r, 501, 'not_implemented', 'later'), '/api/eval/results': (u, r) => err(r, 404, 'not_found', 'x'), '/api/scorecards': (u, r) => err(r, 501, 'not_implemented', 'later') });
  await p2.goto('/hub/cost.html');
  await ready(p2);
  for (const id of ['#sec-cost', '#sec-ragas', '#sec-scorecards', '#sec-alerts']) await expect(p2.locator(id)).toBeHidden();
  await expect(p2.locator('.hub-notice')).toHaveCount(0);

  const p3 = await page.context().newPage();
  await p3.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"boom","message":"database down"}}' }));
  await p3.goto('/hub/cost.html');
  await ready(p3);
  await expect(p3.locator('.hub-notice.bad').first()).toBeVisible();
  await expect(p3.locator('#notices')).toContainText('Could not load the cost report');
  await expect(p3.locator('#sec-cost')).toBeHidden();
  await expect(p3.locator('#me-name')).toHaveText('Signed out · local catalog');
});

test('(f) a range in the address is passed to the API as from and to', async ({ page }) => {
  const calls = await open(page, {}, '?from=2026-08-01&to=2026-08-31');
  expect(calls.cost[0].get('from')).toBe('2026-08-01');
  expect(calls.cost[0].get('to')).toBe('2026-08-31');
});

test('(g) every element with data-en also has data-es, and rendered text follows the language toggle', async ({ page }) => {
  await open(page);
  const check = () => page.evaluate(() => {
    const missing = [...document.querySelectorAll('[data-en]')].filter((el) => !el.hasAttribute('data-es')).map((el) => el.outerHTML.slice(0, 80));
    const missingPh = [...document.querySelectorAll('[data-en-ph]')].filter((el) => !el.hasAttribute('data-es-ph')).map((el) => el.outerHTML.slice(0, 80));
    const bare = [...document.body.querySelectorAll('*')].filter((el) => {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT'].includes(el.tagName.toUpperCase()) || el.closest('svg, .nav-wordmark, .hub-av, .nav-lang')) return false;
      if (el.children.length) return false;
      const t = el.textContent.trim();
      return /\p{L}{2,}/u.test(t) && !el.hasAttribute('data-en') && !el.closest('[data-en]');
    }).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
    return { count: document.querySelectorAll('[data-en]').length, missing, missingPh, bare };
  });
  const en = await check();
  expect(en.count).toBeGreaterThan(80);
  expect(en.missing).toEqual([]);
  expect(en.missingPh).toEqual([]);
  expect(en.bare).toEqual([]);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('.hub-crumb b')).toHaveText('Coste y salud');
  await expect(page.locator('#h-cost')).toHaveText('Gasto de tokens por función');
  await expect(page.locator('[data-feature="draft"] .c-feat-top span')).toContainText('Redacción');
  await expect(page.locator('#h-alerts')).toHaveText('Alertas de presupuesto');
  await expect(page.locator('[data-alert="draft"]')).toContainText('supera su presupuesto mensual');
  await expect(page.locator('[data-project="putumayo"] td[data-rule="tool-version"] .sr-only')).toHaveText('No medible');
  const es = await check();
  expect(es.missing).toEqual([]);
});

test('(h) accessibility: axe finds no WCAG 2 A/AA violations on the seeded page', async ({ page }) => {
  await open(page);
  let AxeBuilder;
  try { ({ default: AxeBuilder } = await import('@axe-core/playwright')); } catch (e) { AxeBuilder = null; }
  if (!AxeBuilder) {
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('nav[aria-label]')).toHaveCount(1);
    await expect(page.locator('[role="search"] input')).toHaveAccessibleName(/.+/);
    return;
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('not indexable: noindex meta, no analytics snippet, listed in robots.txt, absent from the sitemap', async ({ page, request }) => {
  await page.goto('/hub/cost.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  const html = await (await request.get('/hub/cost.html')).text();
  expect(html).not.toMatch(/googletagmanager|gtag\(/);
  expect(await (await request.get('/robots.txt')).text()).toMatch(/^Disallow: \/hub\/$/m);
  expect(await (await request.get('/sitemap.xml')).text()).not.toMatch(/\/hub\//);
});
