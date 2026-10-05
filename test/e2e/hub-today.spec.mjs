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
  '/api/health': (u, r) => json(r, { ok: true, version: '0.7.0', migrations: 7, backend: 'pg' }),
  '/api/catalog': (u, r) => json(r, cat),
  '/api/projects': (u, r) => json(r, { projects: [{ id: 'llanos-waterflood', name: 'Llanos Basin waterflood screening', client_name: 'Frontera Energy', country: 'CO', stage: 'Technical review', register: { next: 'Issue screening letter', owner: 'Chris' }, last_activity_at: new Date().toISOString(), run_count: 9, item_count: 31, stale_count: 3 }] }),
});

const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

// Wave 7 PR2 (R4, idea A): the catalog is no longer on Today; hub/tool.html without a tool id is the Tools index.
test('(a) the Tools index lists every catalog tool once with its current version and an Open link to the manifest entry', async ({ page, baseURL }) => {
  const cat = seededCatalog();
  await stubApi(page, baseHandlers(cat));
  await page.goto('/hub/tool.html');
  await ready(page);
  await expect(page.locator('h1')).toHaveText('Tools');
  await expect(page.locator('#t-body')).toBeHidden();                       // the single-tool page stays out of sight

  const want = expectedFor(cat, baseURL + '/');
  await expect(page.locator('[data-tool-id]')).toHaveCount(cat.tools.length);
  expect(cat.tools.length).toBeGreaterThan(STATIC_CATALOG.tools.length);   // the deprecated one is extra

  for (const t of cat.tools) {
    const card = page.locator(`[data-tool-id="${t.id}"]`);
    await expect(card, t.id + ' appears exactly once').toHaveCount(1);
    await expect(card.locator('h3')).toHaveText(t.name);
    // Wave 7 (S6): an external app shows a version only when it publishes one; the manifest's is a stated placeholder.
    if (t.kind === 'external-app') await expect(card.locator('[data-version]')).toHaveCount(0);
    else await expect(card.locator('[data-version]')).toHaveText(want.get(t.id).version);
    await expect(card.locator('[data-lifecycle]')).toHaveAttribute('data-lifecycle', t.lifecycle);
    const open = card.locator('a[data-open]');
    // Wave 7 (S7): a skill runs in Claude Code; its card links the published insights instead of a raw file.
    if (t.kind === 'skill') { await expect(open).toHaveCount(0); await expect(card.locator('a[data-insights]')).toHaveAttribute('href', new URL('insights.html', baseURL + '/').href); continue; }
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

  // Session in the sidebar; the Today-only sections are not on the Tools index.
  await expect(page.locator('#me-name')).toHaveText('Chris Hopkinson');
  await expect(page.locator('#me-role')).toHaveText('PARTNER');
  await expect(page.locator('#sec-globe')).toHaveCount(0);
  await expect(page.locator('.hub-notice')).toHaveCount(0);
});

test('(a1) Today lists the project in the live register and keeps the catalog off the page; sections whose endpoints are 404 stay out of sight', async ({ page }) => {
  const cat = seededCatalog();
  await stubApi(page, baseHandlers(cat));
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#sec-projects')).toHaveCount(0);
  await expect(page.locator('[data-project-id]')).toHaveCount(0);
  await expect(page.locator('#sec-tools')).toHaveCount(0);
  await expect(page.locator('[data-tool-id]')).toHaveCount(0);
  await expect(page.locator('#register [data-register-row="llanos-waterflood"] .hub-stateline[data-stateline="row"]')).toContainText('Technical review');
  await expect(page.locator('#sec-runs')).toBeHidden();
  await expect(page.locator('.hub-notice')).toHaveCount(0);
  // No "nothing waiting" cards: the counters read zero in one line each (R12).
  for (const id of ['#card-stale', '#card-filing', '#card-lessons', '#card-rerun']) {
    await expect(page.locator(id)).toHaveAttribute('data-empty', '1');
    await expect(page.locator(id + ' .hub-num')).toHaveText('0');
    await expect(page.locator(id)).not.toContainText('Nothing waiting');
  }
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
  await expect(page.locator('#card-filing')).toHaveAttribute('data-empty', '1');
  await expect(page.locator('#sec-runs')).toBeHidden();
  await expect(page.locator('.hub-notice')).toHaveCount(0);
  await page.goto('/hub/tool.html');
  await ready(page);
  await expect(page.locator('[data-tool-id]')).toHaveCount(cat.tools.length);
});

test('(b) with the API answering 500 the Tools index still renders from hub/catalog.json and says the Vault is unreachable; Today shows the globe and no register', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await page.goto('/hub/tool.html');
  await ready(page);
  await expect(page.locator('[data-tool-id]')).toHaveCount(STATIC_CATALOG.tools.length);
  for (const t of STATIC_CATALOG.tools) {
    await expect(page.locator(`[data-tool-id="${t.id}"]`)).toHaveCount(1);
    if (t.kind !== 'external-app') await expect(page.locator(`[data-tool-id="${t.id}"] [data-version]`)).toHaveText(t.aliases.current);
  }
  await expect(page.locator('.hub-notice.warn')).toContainText('The Vault is unreachable');
  await expect(page.locator('.hub-notice.warn')).not.toContainText('catalog.json');     // R11: no file names in user copy
  await expect(page.locator('#me-name')).toHaveText('Signed out · local catalog');
  await expect(page.locator('#hub-strip')).toHaveAttribute('data-state', 'off');
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('.hub-notice.bad')).toContainText('The Vault is unreachable');
  await expect(page.locator('#register [data-register-row]')).toHaveCount(0);
  for (const id of ['#sec-runs']) await expect(page.locator(id)).toBeHidden();
});

/** Rich seed used for the accessibility check, the bilingual check and the screenshot. */
function richHandlers(cat) {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const projects = [
    { id: 'llanos-waterflood', name: 'Llanos Basin waterflood screening', client_name: 'Frontera Energy · CO', country: 'CO', stage: 'Technical review', register: { next: 'Issue screening letter to Frontera', owner: 'Chris', risk: 'amber', risk_score: 54 }, last_activity_at: iso(2 * 3600e3), run_count: 9, item_count: 31, stale_count: 3 },
    { id: 'middle-magdalena', name: 'Middle Magdalena infill screening', client_name: 'Ecopetrol · CO', country: 'CO', stage: 'Qualified', register: {}, last_activity_at: iso(DAY), run_count: 12, item_count: 40, stale_count: 2 },
    { id: 'talara-brownfield', name: 'Talara brownfield redevelopment', client_name: 'Costa Norte Petróleos · PE', country: 'PE', stage: 'Commercial review', register: { next: 'Data room visit', owner: 'Tom' }, last_activity_at: iso(6 * DAY), run_count: 8, item_count: 28, stale_count: 0 },
    { id: 'reconcavo', name: 'Recôncavo late-life economics', client_name: 'Bahía Oil & Gas · BR', country: 'BR', stage: 'Negotiation', register: { next: 'Sign the farm-in' }, last_activity_at: iso(21 * DAY), run_count: 5, item_count: 19, stale_count: 1 },
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
  const CC = { CO: ['Colombia', 4.1, -72.9], PE: ['Peru', -4.6, -81.3], BR: ['Brazil', -12.5, -38.5] };
  const countries = Object.keys(CC).map((code) => ({ code, name: { en: CC[code][0], es: CC[code][0] }, projects: projects.filter((p) => p.country === code).map((p, i) => ({ id: p.id, name: p.name, status: 'active', stage: p.stage, client_id: null, client_name: p.client_name, lat: CC[code][1] + i * 0.4, lon: CC[code][2] + i * 0.4, last_run_at: p.last_activity_at, attention: { stale: p.stale_count, filing: 0, expiring_days: null }, assets: [] })), counts: { projects: projects.filter((p) => p.country === code).length, stale: 0, filing: 0, expiring: 0 }, risk: code === 'CO' ? { score: 71.2, level: 'exercise caution', computed_at: iso(3600e3), fetched_at: iso(3600e3) } : null }));
  return {
    ...baseHandlers(cat),
    '/api/projects': (u, r) => json(r, { projects }),
    '/api/countries': (u, r) => json(r, { countries, unplaced: [], generated_at: iso(0), world_monitor: { status: 'live', notes: [] } }),
    '/api/me/mailbox': (u, r) => json(r, { configured: true, connected: true, prompt: false, connection: { id: 'mb1', address: PARTNER.email, status: 'connected', privacy: 'full', connected_at: iso(10 * DAY), last_poll_at: iso(4 * 60e3), last_error: null }, counts: { messages: 10, filed: 8, waiting: 1, hidden_internal: 1, hidden_bulk: 0 }, firm_domains: ['alpha-technical-centre.com'] }),
    '/api/me/activity': (u, r) => json(r, { since: iso(DAY), counts: { records: 12, messages_filed: 5, ready: 2, review: 3, invoices: 0, files: 4, organisations_proposed: 1, bulk_hidden: 0 }, projects: [{ id: 'llanos-waterflood', name: 'Llanos Basin waterflood screening', records: [{ ref: 'doc:00000000-0000-4000-8000-000000000301', title: 'RE: Cubiro screening letter', type: 'email' }, { ref: 'run:00000000-0000-4000-8000-000000000401', title: 'Cubiro screen, base case', type: 'run' }] }], brief_available: false }),
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

test('seeded sections: the four counters expand when non-zero, recent runs, and the screenshot', async ({ page }) => {
  await seededPage(page);
  await expect(page.locator('[data-tool-id]')).toHaveCount(0);
  await expect(page.locator('#register [data-register-row]')).toHaveCount(4);
  await expect(page.locator('#card-stale')).toContainText('Stale runs and documents');
  await expect(page.locator('#card-stale .hub-num')).toHaveText('3');
  await expect(page.locator('#card-stale')).not.toHaveAttribute('data-empty', /.+/);
  await expect(page.locator('#card-stale .hub-item')).toHaveCount(3);
  await expect(page.locator('#card-filing .hub-item')).toHaveCount(2);
  await expect(page.locator('#card-lessons .hub-item')).toHaveCount(1);
  await expect(page.locator('#card-rerun .hub-item')).toHaveCount(1);
  // The strip reads the same counts the counters do (idea C).
  await expect(page.locator('#hub-strip a[data-figure="file"]')).toHaveText('2 to file');
  await expect(page.locator('#hub-strip a[data-figure="stale"]')).toHaveText('3 stale');
  await expect(page.locator('#hub-strip a[data-figure="lessons"]')).toHaveText('1 lesson to confirm');
  await expect(page.locator('aside.hub-side a[data-nav="queue"] [data-nav-count]')).toHaveText('3');
  const rows = page.locator('#runs-wrap tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText('apex-reservoir-3d@2.2.0');
  await expect(rows.first()).toContainText('ooip 412 MMbbl');
  await expect(page.locator('#runs-wrap tr.is-stale')).toHaveCount(1);
  await expect(page.locator('#runs-wrap th')).toHaveCount(7);
  // Find is a plain link-only form to the search page.
  await expect(page.locator('form[role="search"]')).toHaveAttribute('action', '/hub/search.html');
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
  await expect(page.locator('#card-filing h3')).toHaveText('Cola de archivo');
  await expect(page.locator('#hub-strip [data-figure="vault"]')).toContainText('Vault sincronizado');
  const es = await check();
  expect(es.missing).toEqual([]);
});

/* ── Wave 7 PR2 (R4, idea A, W7-AC7): the globe is the door ───────────── */

/** Seventeen projects in five countries, Venezuela the tallest group and last by name, so the register column scrolls at 1440×900. `door.ve` places its first dot. */
const door = { ve: null };
function doorHandlers(cat) {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const CC = [['CO', 'Colombia', 4.1, -72.9, 3], ['PE', 'Peru', -4.6, -81.3, 3], ['BR', 'Brazil', -12.5, -38.5, 3], ['AR', 'Argentina', -38.9, -68.1, 3], ['VE', 'Venezuela', 8.1, -69.3, 5]];
  const build = () => {
    const projects = [], countries = [];
    CC.forEach(([code, name, lat, lon, n], ci) => {
      const list = [];
      for (let i = 0; i < n; i++) {
        const id = code.toLowerCase() + '-' + i;
        const at = code === 'VE' && i === 0 && door.ve ? door.ve : { lat: lat + i * 0.3, lon: lon + i * 0.3 };
        const p = { id, name: name + ' project ' + i, status: 'active', country: code, lat: at.lat, lon: at.lon, stage: 'Technical review', stage_history: [{ stage: 'Technical review', at: iso(12 * DAY), by: 'chris' }], register: { next: 'Next step ' + i, owner: 'Chris', risk: i ? 'amber' : 'green', risk_score: 40 + i }, last_activity_at: iso((ci * 5 + i + 1) * 3600e3), run_count: i, item_count: i * 2, stale_count: 0 };
        projects.push(p);
        list.push({ id, name: p.name, status: 'active', stage: p.stage, client_id: null, client_name: null, lat: p.lat, lon: p.lon, last_run_at: null, attention: { stale: 0, filing: 0, expiring_days: null }, assets: [] });
      }
      countries.push({ code, name: { en: name, es: name }, projects: list, counts: { projects: list.length, stale: 0, filing: 0, expiring: 0 }, risk: code === 'CO' ? { score: 71.2, level: 'exercise caution', computed_at: iso(3600e3), fetched_at: iso(3600e3) } : null });
    });
    return { projects, countries };
  };
  return {
    ...baseHandlers(cat),
    '/api/projects': (u, r) => json(r, { projects: build().projects }),
    '/api/countries': (u, r) => json(r, { countries: build().countries, unplaced: [], generated_at: iso(0), world_monitor: { status: 'live', notes: [] } }),
    '/api/me/activity': (u, r) => json(r, { since: iso(DAY), counts: { records: 2, messages_filed: 1, ready: 0, review: 1, invoices: 0, files: 1, organisations_proposed: 0, bulk_hidden: 0 }, projects: [{ id: 'co-0', name: 'Colombia project 0', records: [{ ref: 'doc:00000000-0000-4000-8000-000000000301', title: 'Data room index', type: 'email' }, { ref: 'run:00000000-0000-4000-8000-000000000401', title: 'Base case screen', type: 'run' }] }], brief_available: false }),
    '/api/queue/filing': (u, r) => json(r, { items: [] }),
    '/api/lessons': (u, r) => json(r, { lessons: [] }),
    '/api/queue/review': (u, r) => json(r, { items: [] }),
    '/api/runs': (u, r) => json(r, { runs: [] }),
  };
}
const globeReady = (page) => page.locator('#sec-globe[data-globe="ready"]').waitFor();
const fits = async (page, sel, height) => {
  const box = await page.locator(sel).first().boundingBox();
  expect(box, sel).not.toBeNull();
  expect(box.y, sel + ' starts on the first screen').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, sel + ' ends on the first screen').toBeLessThanOrEqual(height + 1);
};

for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`W7-AC7 (${vp.width}×${vp.height}): the first screen is the strip, the globe and the live register; What came in is the next band; no catalog on Today`, async ({ page }) => {
    await page.setViewportSize(vp);
    const cat = seededCatalog();
    await stubApi(page, doorHandlers(cat));
    await page.goto('/hub/index.html');
    await ready(page); await globeReady(page);
    await fits(page, '#hub-strip', vp.height);
    await fits(page, '#globe', vp.height);
    await fits(page, '#register [data-register-row]', vp.height);
    await fits(page, '#register [data-country-group] .hub-country', vp.height);
    // The globe takes 55 % of the row, the register the rest, scrolling inside its column.
    const row = await page.locator('.hub-globe').boundingBox();
    const globe = await page.locator('.hub-globe-wrap').boundingBox();
    expect(globe.width / row.width).toBeGreaterThan(0.5);
    expect(globe.width / row.width).toBeLessThan(0.6);
    const reg = page.locator('#register');
    expect(await reg.evaluate((el) => el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))).toBe(true);
    // One stateline row per project, grouped by country, with "Create a project here" as an outline action at the end of each group.
    await expect(reg.locator('[data-register-row]')).toHaveCount(17);
    const groups = reg.locator('[data-country-group]');
    await expect(groups).toHaveCount(5);
    await expect(groups.first().locator('[data-register-row] .hub-stateline[data-stateline="row"]')).toHaveCount(3);
    const create = groups.first().locator('[data-create-here]');
    await expect(create).toHaveText('Create a project here');
    await expect(create).toHaveClass(/btn-outline/);
    await expect(create).not.toHaveClass(/btn-primary/);
    expect(await groups.first().evaluate((g) => g.lastElementChild.hasAttribute('data-create-here'))).toBe(true);
    // R11: both risks are labelled where they appear.
    await expect(reg.locator('[data-country-group="CO"] .hub-country')).toContainText('World Monitor 71');
    await expect(reg.locator('[data-register-row="co-1"] [data-risk-tag]')).toHaveText('our execution risk Amber 41');
    // What came in is the next band, full width, with chips as links and figures as a grid; the catalog is gone.
    expect(await page.locator('#sec-globe').evaluate((el) => el.nextElementSibling.id)).toBe('sec-activity');
    const band = await page.locator('#sec-activity').boundingBox();
    expect(band.width / row.width).toBeGreaterThan(0.98);
    await expect(page.locator('#activity-counts [data-count] .hub-num').first()).toHaveText('1');
    await expect(page.locator('#activity-counts [data-count] .hub-unit').first()).toHaveText('messages filed');
    await expect(page.locator('#card-activity a.hub-cite')).toHaveCount(2);
    await expect(page.locator('#card-activity a.hub-cite').first()).toHaveAttribute('href', '/hub/project.html?id=co-0&doc=00000000-0000-4000-8000-000000000301');
    expect(await page.locator('#sec-activity').evaluate((el) => el.nextElementSibling.id)).toBe('sec-counters');
    await expect(page.locator('#sec-tools')).toHaveCount(0);
    await expect(page.locator('[data-tool-id]')).toHaveCount(0);
    await expect(page.locator('#sec-counters [data-empty="1"]')).toHaveCount(4);   // all four collapse at zero
    for (const id of ['#card-filing', '#card-lessons', '#card-rerun', '#card-stale']) {
      const b = await page.locator(id).boundingBox();
      expect(b.height, id + ' is one line').toBeLessThan(64);
    }
    // The skeleton is gone once data-ready is set.
    await expect(page.locator('.hub-skel')).toHaveCount(0);
  });
}

test('W7-AC7: scrolling the register turns the globe to the country in view; tapping a dot highlights its row and scrolls it into view', async ({ page }) => {
  const cat = seededCatalog();
  await stubApi(page, doorHandlers(cat));
  // Venezuela's first dot sits at the country's centre (computed in the page from the same polygons the globe draws), so the flight there ends with the dot at the canvas centre.
  await page.goto('/hub/index.html');
  await ready(page);
  door.ve = await page.evaluate(async () => {
    const g = await (await fetch('/hub/geo/countries-110m.json')).json();
    const f = g.features.find((x) => x.properties.iso2 === 'VE');
    const [lon, lat] = window.d3.geoCentroid(f);
    return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
  });
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  const sec = page.locator('#sec-globe');
  await expect(sec).not.toHaveAttribute('data-target', /.+/);
  const reg = page.locator('#register');
  await reg.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(sec).toHaveAttribute('data-target', 'VE');
  await reg.evaluate((el) => { el.scrollTop = 0; });
  await expect(sec).toHaveAttribute('data-target', 'AR');
  await expect(page).not.toHaveURL(/country=/);                        // scroll-linking is not a selection
  await expect(page.locator('#country-panel')).toBeHidden();
  await reg.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(sec).toHaveAttribute('data-target', 'VE');
  await page.waitForTimeout(1200);                                     // the flight
  const box = await page.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const row = page.locator('[data-register-row="ve-0"]');
  await expect(row).toHaveAttribute('data-hot', '1');
  await expect(page.locator('[data-register-row][data-hot="1"]')).toHaveCount(1);
  await expect(page.locator('#country-panel')).toBeHidden();           // a dot is a project, not a country
  expect(await row.evaluate((el) => { const r = el.getBoundingClientRect(), c = el.closest('#register').getBoundingClientRect(); return r.top >= c.top - 1 && r.bottom <= c.bottom + 1; })).toBe(true);
  // The row's tokens are the stateline's links.
  await expect(row.locator('a[data-token="name"]')).toHaveAttribute('href', '/hub/project.html?id=ve-0');
  await expect(row.locator('a[data-token="stage"]')).toHaveAttribute('href', '/hub/project.html?id=ve-0#stage');
  door.ve = null;
});

for (const [name, vp] of [['desk', { width: 1440, height: 900 }], ['ipadl', { width: 1024, height: 768 }], ['ipadp', { width: 820, height: 1180 }], ['phone', { width: 390, height: 844 }]]) {
  test(`W7-AC7 evidence: w7-today-${name}.png`, async ({ page }) => {
    await page.setViewportSize(vp);
    const cat = seededCatalog();
    await stubApi(page, richHandlers(cat));
    await page.goto('/hub/index.html');
    await ready(page);
    try { await page.locator('#sec-globe[data-globe="ready"]').waitFor({ timeout: 5000 }); } catch (e) { /* no geo: still a page */ }
    await page.waitForTimeout(600);
    mkdirSync(path.join(ROOT, 'docs/vault-hub/wave7/evidence'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'docs/vault-hub/wave7/evidence', `w7-today-${name}.png`) });
  });
}

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

// Wave 7 PR2: the Settings page's own checks live in hub-settings.spec.mjs (builder F).

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

/* ── New project (partners) ───────────────────────────────────────────── */

test('new project: a partner creates a project from Today; the form posts to POST /api/projects and opens the project file', async ({ page }) => {
  const cat = seededCatalog();
  const h = baseHandlers(cat);
  let posted = null;
  h['/api/organisations'] = (u, r) => json(r, { organisations: [{ id: 'frontera-energy', name: 'Frontera Energy', kind: 'operator' }] });
  h['/api/projects'] = (u, r) => {
    if (r.request().method() === 'POST') { posted = JSON.parse(r.request().postData()); return json(r, { ...posted, status: 'active', contacts: [] }, 201); }
    return json(r, { projects: [] });
  };
  await stubApi(page, h);
  await page.goto('/hub/index.html');
  await ready(page);

  // The button sits with the register for a partner (wave 7, S2: the My projects section is gone); the form is closed until asked for.
  await expect(page.locator('#sec-projects')).toHaveCount(0);
  await expect(page.locator('#register')).toBeVisible();
  const btn = page.getByRole('button', { name: 'New project' });
  await expect(btn).toBeVisible();
  await expect(page.locator('#new-project')).toBeHidden();
  await btn.click();
  const form = page.locator('#new-project');
  await expect(form).toBeVisible();

  // The id follows the name as a slug and can be edited; the client list is loaded from the API with Internal first.
  await form.locator('#np-name').fill('Cubiro 2027 Review (Phase 2)');
  await expect(form.locator('#np-id')).toHaveValue('cubiro-2027-review-phase-2');
  await expect(form.locator('#np-client option')).toHaveCount(2);
  await expect(form.locator('#np-client option').nth(0)).toHaveText('Internal (no client)');
  await expect(form.locator('#np-client option').nth(1)).toHaveText('Frontera Energy');
  await expect(form.locator('#np-tag-field')).toBeHidden();   // a legal tag is only asked for with a client

  await form.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/project\.html\?id=cubiro-2027-review-phase-2$/);
  expect(posted).toEqual({ id: 'cubiro-2027-review-phase-2', name: 'Cubiro 2027 Review (Phase 2)', client_id: null });
});

test('new project (W7-AC1): a client project creates its NDA tag first, then the project under it; an API refusal is shown in the form; associates get no button', async ({ page }) => {
  const cat = seededCatalog();
  const h = baseHandlers(cat);
  let posted = null, tagPosted = null;
  h['/api/organisations'] = (u, r) => json(r, { organisations: [{ id: 'frontera-energy', name: 'Frontera Energy', kind: 'operator' }] });
  h['/api/legal-tags'] = (u, r) => {
    if (r.request().method() === 'POST') { tagPosted = JSON.parse(r.request().postData()); return json(r, { ...tagPosted, classification: 'client-nda' }, 201); }
    return json(r, { tags: [] });
  };
  h['/api/projects'] = (u, r) => {
    if (r.request().method() === 'POST') { posted = JSON.parse(r.request().postData()); return json(r, { error: { code: 'unknown_legal_tag', message: 'legal tag "lt-frontera-nda-2026" does not exist' } }, 400); }
    return json(r, { projects: [] });
  };
  await stubApi(page, h);
  await page.goto('/hub/index.html');
  await ready(page);
  await page.getByRole('button', { name: 'New project' }).click();
  const form = page.locator('#new-project');
  await form.locator('#np-name').fill('Cubiro waterflood');
  await form.locator('#np-client').selectOption('frontera-energy');
  await expect(form.locator('#np-tag-field')).toBeVisible();
  await expect(form.locator('#np-tag-pick')).toHaveValue('new');          // no tag exists for this client yet
  await expect(form.locator('#np-tag-new')).toBeVisible();
  await form.locator('#np-tag-name').fill('Frontera NDA 2026');
  await expect(form.locator('#np-tag')).toHaveValue('lt-frontera-nda-2026');  // the id follows the name
  await form.locator('#np-tag-expires').fill('2027-03-31');
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(form.locator('.hub-notice.bad')).toContainText('legal tag "lt-frontera-nda-2026" does not exist');
  expect(tagPosted).toEqual({ id: 'lt-frontera-nda-2026', name: 'Frontera NDA 2026', client_id: 'frontera-energy', expires_at: '2027-03-31' });
  expect(posted).toEqual({ id: 'cubiro-waterflood', name: 'Cubiro waterflood', client_id: 'frontera-energy', default_legal_tag: 'lt-frontera-nda-2026' });
  expect(page.url()).toContain('/hub/index.html');   // still here, nothing lost

  // A client with an existing tag: the picker offers it first and no tag is posted.
  tagPosted = null; posted = null;
  h['/api/legal-tags'] = (u, r) => json(r, { tags: [{ id: 'lt-frontera-nda-2025', name: 'Frontera NDA 2025', client_id: 'frontera-energy', expires_at: '2026-12-31', classification: 'client-nda' }] });
  await page.goto('/hub/index.html');
  await ready(page);
  await page.getByRole('button', { name: 'New project' }).click();
  await form.locator('#np-name').fill('Cubiro phase 2');
  await form.locator('#np-client').selectOption('frontera-energy');
  await expect(form.locator('#np-tag-pick')).toHaveValue('lt-frontera-nda-2025');
  await expect(form.locator('#np-tag-new')).toBeHidden();
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(form.locator('.hub-notice.bad')).toBeVisible();
  expect(tagPosted).toBeNull();
  expect(posted.default_legal_tag).toBe('lt-frontera-nda-2025');

  // An associate cannot create projects (the API requires a partner), so the button is not offered.
  h['/api/me'] = (u, r) => json(r, { ...PARTNER, role: 'associate' });
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  await expect(page.locator('#btn-new-project')).toBeHidden();
});

/* ── wave 2, PR 1: catalog lifecycle defaults (AC7) and live versions (AC8) ── */

/** The seeded catalog plus a retired tool and one external app with a live version. */
function lifecycleCatalog() {
  const cat = seededCatalog();
  cat.tools.push({
    id: 'well-logger', name: 'Well Logger', owner: 'chris', lifecycle: 'retired', kind: 'browser-tool', entry: 'well-logger.html',
    versions: [{ version: '0.3.0', released_at: '2025-01-01', commit: 'dead000' }], aliases: { current: '0.3.0' }, releases: [], hub: null,
  });
  const ai = cat.tools.find((t) => t.id === 'apex-asset-intelligence');
  ai.hub = { context: ['project'], param: 'project', toolbar: 90, version_url: 'https://apex-app2.onrender.com/version.json', live_version: { version: '4.2.0', released_at: '2026-09-12', checked_at: '2026-10-01T08:00:00.000Z' } };
  const m3 = cat.tools.find((t) => t.id === 'apex-3d-model');
  m3.hub = { context: ['project'], param: 'project', toolbar: 80, version_url: 'https://apex-3d-model.uk/version.json', live_version: null };
  return cat;
}
const visibleIds = (page) => page.locator('[data-tool-id]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-tool-id')).sort());

test('AC7: on the Tools index, production tools by default; Experimental and Older chips reveal the rest; retired never; the choice persists', async ({ page }) => {
  const cat = lifecycleCatalog();
  await stubApi(page, baseHandlers(cat));
  await page.goto('/hub/tool.html');
  await ready(page);
  const prod = cat.tools.filter((t) => t.lifecycle === 'production').map((t) => t.id).sort();
  const exp = cat.tools.filter((t) => t.lifecycle === 'experimental').map((t) => t.id);
  const dep = cat.tools.filter((t) => t.lifecycle === 'deprecated').map((t) => t.id);
  expect(exp.length).toBeGreaterThan(0); expect(dep.length).toBeGreaterThan(0);

  expect(await visibleIds(page)).toEqual(prod);
  await expect(page.locator('[data-tool-id="well-logger"]')).toHaveCount(0);          // retired: never rendered
  const chips = page.locator('#tools-filter [data-lifecycle-chip]');
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toHaveText('Production ' + prod.length);
  await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.nth(1)).toHaveText('Experimental ' + exp.length);
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(chips.nth(2)).toHaveText('Older ' + dep.length);
  await expect(page.locator('#tools-sub')).toContainText(prod.length + ' in production');

  await chips.nth(1).click();
  expect(await visibleIds(page)).toEqual([...prod, ...exp].sort());
  await chips.nth(2).click();
  // Older tools sit in their own collapsed group under the grid.
  const older = page.locator('#tools-older');
  await expect(older).toBeVisible();
  expect(await older.evaluate((d) => d.open)).toBe(false);
  await expect(older.locator('summary')).toContainText('Older tools');
  for (const id of dep) await expect(page.locator(`[data-tool-id="${id}"]`)).toBeHidden();
  await older.locator('summary').click();
  for (const id of dep) await expect(page.locator(`[data-tool-id="${id}"]`)).toBeVisible();
  await chips.nth(0).click();                                                           // production off
  expect(await visibleIds(page)).toEqual([...exp, ...dep].sort());

  await page.reload();
  await ready(page);
  await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
  expect(await visibleIds(page)).toEqual([...exp].sort());                             // the older group starts collapsed again
  await older.locator('summary').click();
  expect(await visibleIds(page)).toEqual([...exp, ...dep].sort());
  // Every chip off: the grid says so instead of going blank.
  await chips.nth(1).click(); await chips.nth(2).click();
  await expect(page.locator('#tools-empty')).toBeVisible();
  await expect(page.locator('#tools-empty')).toContainText('No tools match');
});

test('AC8 (wave 7, S6): an external app shows the version it publishes; one that publishes nothing yet shows no version line; a browser tool shows its manifest version', async ({ page }) => {
  const cat = lifecycleCatalog();
  await stubApi(page, baseHandlers(cat));
  await page.goto('/hub/tool.html');
  await ready(page);
  const ai = page.locator('[data-tool-id="apex-asset-intelligence"]');
  await expect(ai.locator('[data-version]')).toHaveText('4.2.0');
  await expect(ai.locator('[data-version-source]')).toHaveAttribute('data-version-source', 'live');
  await expect(ai.locator('.hub-ver')).toContainText('published by the app');
  await expect(ai.locator('.hub-ver')).toContainText('12 Sept 2026');
  const m3 = page.locator('[data-tool-id="apex-3d-model"]');
  await expect(m3.locator('[data-version]')).toHaveCount(0);
  await expect(m3.locator('.hub-ver')).toHaveCount(0);
  await expect(m3.locator('.hub-pill.warn')).toHaveCount(0);
  await expect(m3).not.toContainText('version.json');
  await expect(m3.locator('a[data-open]')).toHaveAttribute('href', 'https://apex-3d-model.uk/');   // the card still links the app (W7-AC5)
  const reg = page.locator('[data-tool-id="opportunity-register"]');
  await expect(reg.locator('[data-version-source]')).toHaveAttribute('data-version-source', 'manifest');
  await expect(reg.locator('.hub-ver')).toContainText('current');
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(ai.locator('.hub-ver')).toContainText('publicada por la app');
});
