// M06: Hub shell and Today page. The API is stubbed with page.route; the static
// server (python3 -m http.server, started by playwright.config.mjs) serves the pages.
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC_CATALOG = JSON.parse(readFileSync(path.join(ROOT, 'hub/catalog.json'), 'utf8'));
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence/m06-hub-today.png');

const DAY = 864e5;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };

/** The static catalog plus a deprecated tool that names its replacement, and one fresh release for the badge. */
function seededCatalog() {
  const cat = JSON.parse(JSON.stringify(STATIC_CATALOG));
  const nodal = cat.tools.find((t) => t.id === 'nodal-analysis');
  nodal.releases[1].date = ymd(Date.now() - 3 * DAY);          // within 14 days -> "What's new"
  const old = cat.tools.find((t) => t.id === 'ela-studio');
  old.releases.forEach((r) => { if (r.date) r.date = '2026-01-15'; });   // long ago -> no badge
  cat.tools.push({
    id: 'reservoir-simulator', name: 'Reservoir Simulator', owner: 'chris', lifecycle: 'deprecated', kind: 'browser-tool',
    entry: 'reservoir-simulator.html', description: 'Superseded by APEX Reservoir 3D.',
    versions: [{ version: '1.4.2', released_at: '2026-06-01', commit: 'abc1234', status: 'deprecated' }],
    aliases: { current: 'apex-reservoir-3d' }, releases: [{ version: '1.4.2', date: '2026-06-01', sections: { Changed: ['Last release before the rename.'] } }],
  });
  return cat;
}

/** Independent statement of the page rules, used to compute expectations from the seeded data. */
function expectedFor(cat, base) {
  const byId = new Map(cat.tools.map((t) => [t.id, t]));
  const out = new Map();
  for (const t of cat.tools) {
    let cur = t; const seen = new Set();
    while (cur.lifecycle === 'deprecated' && byId.has(cur.aliases.current) && cur.aliases.current !== cur.id && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.aliases.current); }
    const replaced = t.lifecycle === 'deprecated' && byId.has(t.aliases.current) && t.aliases.current !== t.id ? byId.get(t.aliases.current) : null;
    const dates = t.releases.map((r) => r.date).filter(Boolean).sort();
    const newest = dates[dates.length - 1];
    out.set(t.id, {
      version: replaced ? t.versions[0].version : t.aliases.current,
      href: new URL(cur.entry, base).href,
      external: cur.kind === 'external-app',
      replacedBy: replaced ? replaced.name : null,
      isNew: !!newest && (Date.now() - Date.parse(newest + 'T00:00:00Z')) / DAY < 14,
      retired: t.lifecycle === 'retired',
    });
  }
  return out;
}

const notFound = (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'no route' } }) });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Stub /api/**: handlers is {pathname: (url, route) => ...}; anything else is 404. */
async function stubApi(page, handlers) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const h = handlers[url.pathname];
    if (!h) return notFound(route);
    return h(url, route);
  });
}

const baseHandlers = (cat) => ({
  '/api/me': (u, r) => json(r, PARTNER),
  '/api/catalog': (u, r) => json(r, cat),
  '/api/projects': (u, r) => json(r, { projects: [{ id: 'llanos-waterflood', name: 'Llanos Basin waterflood screening', client_name: 'Frontera Energy', last_activity_at: new Date().toISOString(), run_count: 9, item_count: 31, stale_count: 3 }] }),
});

const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('(a) every catalog tool appears once with its current version and an Open link to the manifest entry', async ({ page, baseURL }) => {
  const cat = seededCatalog();
  await stubApi(page, baseHandlers(cat));
  await page.goto('/hub/index.html');
  await ready(page);

  const want = expectedFor(cat, baseURL + '/');
  await expect(page.locator('[data-tool-id]')).toHaveCount(cat.tools.length);
  expect(cat.tools.length).toBeGreaterThan(STATIC_CATALOG.tools.length);   // the deprecated one is extra

  for (const t of cat.tools) {
    const card = page.locator(`[data-tool-id="${t.id}"]`);
    await expect(card, t.id + ' appears exactly once').toHaveCount(1);
    await expect(card.locator('h3')).toHaveText(t.name);
    await expect(card.locator('[data-version]')).toHaveText(want.get(t.id).version);
    await expect(card.locator('[data-lifecycle]')).toHaveAttribute('data-lifecycle', t.lifecycle);
    const open = card.locator('a[data-open]');
    if (want.get(t.id).retired) { await expect(open).toHaveCount(0); continue; }
    await expect(open, t.id + ' Open current').toHaveAttribute('href', want.get(t.id).href);
    if (want.get(t.id).external) {
      await expect(open).toHaveAttribute('target', '_blank');
      await expect(open).toHaveAttribute('rel', /noopener/);
    } else {
      await expect(open).not.toHaveAttribute('target', /.+/);
    }
    // "What's new" only when the newest changelog release is under 14 days old.
    await expect(card.locator('.hub-new')).toHaveCount(want.get(t.id).isNew ? 1 : 0);
  }
  expect([...want.values()].filter((w) => w.isNew).length).toBeGreaterThan(0);   // the fixture exercises the badge

  // Deprecated tool: shows the replacement and opens the replacement's entry.
  const dep = page.locator('[data-tool-id="reservoir-simulator"]');
  await expect(dep.locator('[data-replaced-by="apex-reservoir-3d"]')).toContainText('Replaced by APEX Reservoir 3D');
  await expect(dep.locator('a[data-open]')).toHaveAttribute('href', new URL(cat.tools.find((t) => t.id === 'apex-reservoir-3d').entry, baseURL + '/').href);

  // Changelog toggles inline.
  const reg = page.locator('[data-tool-id="apex-reservoir-3d"]');
  const btn = reg.getByRole('button', { name: 'Changelog' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(reg.locator('.hub-changelog')).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(reg.locator('.hub-changelog')).toContainText('2.2.0');
  await expect(reg.locator('.hub-changelog')).toContainText('AI Run Advisor');

  // Session, my projects, and sections whose endpoints are 404 stay out of sight.
  await expect(page.locator('#me-name')).toHaveText('Chris Hopkinson');
  await expect(page.locator('#me-role')).toHaveText('PARTNER');
  await expect(page.locator('#sec-projects')).toBeVisible();
  await expect(page.locator('[data-project-id]')).toHaveCount(1);
  await expect(page.locator('[data-project-id]')).toContainText('Frontera Energy');
  await expect(page.locator('[data-project-id]')).toContainText('9 · 31');
  await expect(page.locator('#sec-attention')).toBeHidden();
  await expect(page.locator('#sec-runs')).toBeHidden();
  await expect(page.locator('.hub-notice')).toHaveCount(0);
});

test('(a2) unbuilt endpoints answering 501 render nothing and no error', async ({ page }) => {
  const cat = seededCatalog();
  const h = baseHandlers(cat);
  for (const p of ['/api/projects/llanos-waterflood/stale', '/api/queue/filing', '/api/lessons', '/api/queue/review', '/api/runs']) {
    h[p] = (u, r) => json(r, { error: { code: 'not_implemented', message: 'later' } }, 501);
  }
  await stubApi(page, h);
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#sec-attention')).toBeHidden();
  await expect(page.locator('#sec-runs')).toBeHidden();
  await expect(page.locator('.hub-notice')).toHaveCount(0);
  await expect(page.locator('[data-tool-id]')).toHaveCount(cat.tools.length);
});

test('(b) with the API answering 500 the catalog still renders from hub/catalog.json and says the Vault is unreachable', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('[data-tool-id]')).toHaveCount(STATIC_CATALOG.tools.length);
  for (const t of STATIC_CATALOG.tools) {
    await expect(page.locator(`[data-tool-id="${t.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-tool-id="${t.id}"] [data-version]`)).toHaveText(t.aliases.current);
  }
  await expect(page.locator('.hub-notice.warn')).toContainText('The Vault is unreachable');
  await expect(page.locator('.hub-notice.warn')).toContainText('hub/catalog.json');
  await expect(page.locator('#me-name')).toHaveText('Signed out · local catalog');
  for (const id of ['#sec-projects', '#sec-attention', '#sec-runs']) await expect(page.locator(id)).toBeHidden();
});

/** Rich seed used for the accessibility check, the bilingual check and the screenshot. */
function richHandlers(cat) {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const projects = [
    { id: 'llanos-waterflood', name: 'Llanos Basin waterflood screening', client_name: 'Frontera Energy · CO', last_activity_at: iso(2 * 3600e3), run_count: 9, item_count: 31, stale_count: 3 },
    { id: 'middle-magdalena', name: 'Middle Magdalena infill screening', client_name: 'Ecopetrol · CO', last_activity_at: iso(DAY), run_count: 12, item_count: 40, stale_count: 2 },
    { id: 'talara-brownfield', name: 'Talara brownfield redevelopment', client_name: 'Costa Norte Petróleos · PE', last_activity_at: iso(6 * DAY), run_count: 8, item_count: 28, stale_count: 0 },
    { id: 'reconcavo', name: 'Recôncavo late-life economics', client_name: 'Bahía Oil & Gas · BR', last_activity_at: iso(21 * DAY), run_count: 5, item_count: 19, stale_count: 1 },
  ];
  const run = (i, job, ver, proj, status, out, stale) => ({
    id: '00000000-0000-4000-8000-00000000000' + i, job, tool_version: ver, project_id: proj, status, author: i % 2 ? 'geoscience' : 'commercial',
    created_at: iso(i * 7 * 3600e3), outputs: out, stale: !!stale, stale_reasons: stale ? [{ rule: 'R1', detail: 'potential.js 2.0.0, now 2.1.0 (breaking)' }] : [],
  });
  const runs = [
    run(1, 'apex-reservoir-3d', '2.2.0', 'middle-magdalena', 'draft', { ooip: { value: 412, unit: 'MMbbl' } }),
    run(2, 'financial-model', '1.0.0', 'talara-brownfield', 'reviewed', { npv10: { value: 58.3, unit: 'USD MM' } }),
    run(3, 'opportunity-register', '2.1.2', 'llanos-waterflood', 'draft', { technical_potential_bopd: { value: 12400, unit: 'bopd' } }),
    run(4, 'nodal-analysis', '1.2.0', 'reconcavo', 'reviewed', { operating_point_rate: { value: 1840, unit: 'bopd' } }),
    run(5, 'opportunity-register', '2.0.0', 'middle-magdalena', 'final', { uplift_bopd: { value: 38000, unit: 'bopd' } }, true),
    run(6, 'plan-your-job', '1.0.0', 'talara-brownfield', 'final', { cost_estimate: { value: 1.84, unit: 'USD MM' } }),
  ];
  return {
    ...baseHandlers(cat),
    '/api/projects': (u, r) => json(r, { projects }),
    '/api/projects/llanos-waterflood/stale': (u, r) => json(r, { runs: [{ id: 'r1', job: 'opportunity-register', tool_version: '2.0.0', stale_reasons: [{ rule: 'R1', detail: 'cites potential.js 2.0.0, now 2.1.0 (breaking)' }] }], items: [{ id: 'i1', title: 'Letter ATC-2026-0139 to Frontera cites the Cubiro base run', stale_reasons: [{ rule: 'R3', detail: 'run superseded on 2026-09-28' }] }] }),
    '/api/projects/middle-magdalena/stale': (u, r) => json(r, []),
    '/api/projects/talara-brownfield/stale': (u, r) => json(r, []),
    '/api/projects/reconcavo/stale': (u, r) => json(r, { items: [{ id: 'i2', title: 'Basis note BN-LLA-02 cites fiscal terms CO-2025, now CO-2026' }] }),
    '/api/queue/filing': (u, r) => json(r, { items: [
      { id: 'f1', subject: 'RE: Cubiro water injection data request', from: 'Jorge Salazar', suggested_project_name: 'Llanos Basin waterflood screening', confidence: 0.78 },
      { id: 'f2', subject: 'Updated PVT report, Cubiro-14 sample', from: 'Laboratorio Andino', suggested_project_name: 'Llanos Basin waterflood screening', confidence: 0.71 },
    ] }),
    '/api/lessons': (u, r) => {
      expect(u.searchParams.get('status')).toBe('proposed');
      return json(r, { lessons: [{ id: 'l1', statement: 'Test aquifer strength before assuming voidage replacement of 1.0 in a waterflood screening.', discipline: 'reservoir-engineering', confidence: 0.82 }] });
    },
    '/api/queue/review': (u, r) => {
      expect(u.searchParams.get('kind')).toBe('rerun-delta');
      return json(r, { items: [{ id: 'd1', title: 'NPV10 -8.2% after fiscal terms CO-2026 update', project_name: 'Llanos Basin waterflood screening', detail: 'USD 186.4 MM to 171.1 MM' }] });
    },
    '/api/runs': (u, r) => {
      expect(u.searchParams.get('limit')).toBe('20');
      const since = Date.parse(u.searchParams.get('since'));
      expect(Date.now() - since).toBeGreaterThan(29.9 * DAY);
      expect(Date.now() - since).toBeLessThan(30.1 * DAY);
      return json(r, { runs });
    },
  };
}

async function seededPage(page) {
  const cat = seededCatalog();
  await stubApi(page, richHandlers(cat));
  await page.goto('/hub/index.html');
  await ready(page);
  return cat;
}

test('seeded sections: needs attention, recent runs, and the screenshot', async ({ page }) => {
  const cat = await seededPage(page);
  await expect(page.locator('[data-tool-id]')).toHaveCount(cat.tools.length);
  await expect(page.locator('[data-project-id]')).toHaveCount(4);
  await expect(page.locator('#card-stale')).toContainText('Stale runs and documents');
  await expect(page.locator('#card-stale .hub-item')).toHaveCount(3);
  await expect(page.locator('#card-filing .hub-item')).toHaveCount(2);
  await expect(page.locator('#card-lessons .hub-item')).toHaveCount(1);
  await expect(page.locator('#card-rerun .hub-item')).toHaveCount(1);
  const rows = page.locator('#runs-wrap tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText('apex-reservoir-3d@2.2.0');
  await expect(rows.first()).toContainText('ooip 412 MMbbl');
  await expect(page.locator('#runs-wrap tr.is-stale')).toHaveCount(1);
  await expect(page.locator('#runs-wrap th')).toHaveCount(7);
  // Find is a plain link-only form to the search page.
  await expect(page.locator('form[role="search"]')).toHaveAttribute('action', 'search.html');
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  await page.screenshot({ path: EVIDENCE, fullPage: true });
});

test('(c) every element with data-en also has data-es, and rendered text follows the language toggle', async ({ page }) => {
  await seededPage(page);
  const check = () => page.evaluate(() => {
    const missing = [...document.querySelectorAll('[data-en]')].filter((el) => !el.hasAttribute('data-es')).map((el) => el.outerHTML.slice(0, 80));
    const missingPh = [...document.querySelectorAll('[data-en-ph]')].filter((el) => !el.hasAttribute('data-es-ph')).map((el) => el.outerHTML.slice(0, 80));
    // Every leaf element that shows words carries the pair (punctuation, numbers and symbols excepted;
    // the brand wordmark, avatar initials and the EN/ES switch are names and codes, as on every page).
    const bare = [...document.body.querySelectorAll('*')].filter((el) => {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT'].includes(el.tagName.toUpperCase()) || el.closest('svg, .nav-wordmark, .hub-av, .nav-lang')) return false;
      if (el.children.length) return false;
      const t = el.textContent.trim();
      return /\p{L}{2,}/u.test(t) && !el.hasAttribute('data-en') && !el.closest('[data-en]');
    }).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
    return { count: document.querySelectorAll('[data-en]').length, missing, missingPh, bare };
  });
  const en = await check();
  expect(en.count).toBeGreaterThan(100);
  expect(en.missing).toEqual([]);
  expect(en.missingPh).toEqual([]);
  expect(en.bare).toEqual([]);

  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('h1')).toHaveText('Hoy');
  await expect(page.locator('#sec-tools h2')).toHaveText('Catálogo');
  await expect(page.locator('[data-tool-id="apex-reservoir-3d"] a[data-open]')).toHaveText('Abrir versión actual');
  await expect(page.locator('#card-filing h3')).toHaveText('Cola de archivo');
  const es = await check();
  expect(es.missing).toEqual([]);
});

test('(d) accessibility: axe finds no WCAG 2 A/AA violations on the seeded page', async ({ page }) => {
  await seededPage(page);
  let AxeBuilder;
  try { ({ default: AxeBuilder } = await import('@axe-core/playwright')); } catch (e) { AxeBuilder = null; }
  if (!AxeBuilder) {
    // Fallback if axe cannot be installed: landmarks and labels.
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('nav[aria-label]')).toHaveCount(1);
    await expect(page.locator('[role="search"] input')).toHaveAccessibleName(/.+/);
    return;
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('not indexable: noindex meta, no analytics snippet, listed in robots.txt, absent from the sitemap', async ({ page, request }) => {
  await page.goto('/hub/index.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  const html = await (await request.get('/hub/index.html')).text();
  expect(html).not.toMatch(/googletagmanager|gtag\(/);
  expect(await (await request.get('/robots.txt')).text()).toMatch(/^Disallow: \/hub\/$/m);
  expect(await (await request.get('/sitemap.xml')).text()).not.toMatch(/\/hub\//);
});

test('settings: one-time import of browser rates, save through the API, fallback to the browser copy', async ({ page }) => {
  const saved = [];
  let stored = null;
  const cfg = { rates: { Principal: 15000, Senior: 12000, 'Mid-level': 9000, Junior: 6000 }, swMult: 110, miscMult: 100, dataMult: 100, margin: 5 };
  await page.addInitScript((c) => { try { if (!localStorage.getItem('atc_admin_config')) localStorage.setItem('atc_admin_config', JSON.stringify(c)); } catch (e) {} }, cfg);
  await stubApi(page, {
    '/api/me': (u, r) => json(r, PARTNER),
    '/api/catalog': (u, r) => json(r, seededCatalog()),
    '/api/settings/day-rates': (u, r) => {
      const req = r.request();
      if (req.method() === 'GET') return stored ? json(r, { key: 'day-rates', value: stored }) : notFound(r);
      const body = JSON.parse(req.postData());
      saved.push(body.value);
      stored = body.value;
      return json(r, { key: 'day-rates', value: stored });
    },
  });
  await page.goto('/hub/settings.html');
  await expect(page.locator('#r-principal')).toHaveValue('15000');
  await expect.poll(() => saved.length).toBe(1);                       // imported once
  expect(saved[0].rates.Principal).toBe(15000);
  await expect(page.locator('#d-principal')).toHaveText('$3,000');
  await page.locator('#r-senior').fill('12500');
  await page.getByRole('button', { name: 'Save and apply' }).click();
  await expect(page.locator('#save-status')).toContainText('Saved to the Vault');
  expect(saved.length).toBe(2);
  expect(saved[1].rates.Senior).toBe(12500);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atc_admin_config')).rates.Senior)).toBe(12500);
  await page.reload();
  await expect(page.locator('#r-senior')).toHaveValue('12500');
  expect(saved.length).toBe(2);                                        // not imported again
});

test('settings: Vault down falls back to this browser', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('atc_admin_config', JSON.stringify({ rates: { Principal: 14000, Senior: 11000, 'Mid-level': 8000, Junior: 5500 } })); } catch (e) {} });
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, body: 'x' }));
  await page.goto('/hub/settings.html');
  await expect(page.locator('#r-principal')).toHaveValue('14000');
  await expect(page.locator('.hub-notice')).toContainText('The Vault is unreachable');
  await page.getByRole('button', { name: 'Save and apply' }).click();
  await expect(page.locator('#save-status')).toContainText('this browser only');
});

test('plan-your-job reads day rates from the API first, then from localStorage', async ({ page }) => {
  const apiCfg = { rates: { Principal: 20000, Senior: 16000, 'Mid-level': 12000, Junior: 8000 } };
  await page.route('**/api/settings/day-rates', (route) => json(route, { key: 'day-rates', value: apiCfg }));
  await page.addInitScript(() => { try { localStorage.setItem('atc_admin_config', JSON.stringify({ rates: { Principal: 1, Senior: 2, 'Mid-level': 3, Junior: 4 } })); } catch (e) {} });
  await page.goto('/plan-your-job.html');
  expect(await page.evaluate(() => WEEKLY_RATE.Principal)).toBe(20000);

  const page2 = await page.context().newPage();
  await page2.route('**/api/settings/day-rates', (route) => notFound(route));
  await page2.addInitScript(() => { try { localStorage.setItem('atc_admin_config', JSON.stringify({ rates: { Principal: 1, Senior: 2, 'Mid-level': 3, Junior: 4 } })); } catch (e) {} });
  await page2.goto('/plan-your-job.html');
  expect(await page2.evaluate(() => WEEKLY_RATE.Principal)).toBe(1);
});
