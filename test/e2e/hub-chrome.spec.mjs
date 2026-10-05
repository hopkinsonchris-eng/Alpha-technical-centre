// Wave 7 PR2, builder E (docs/vault-hub/wave7/05-markup.md §1.2, §1.4, §1.5; 02-ui-review.md R3, R7,
// signature idea C): the chrome every Hub page shares. The status strip under the top bar with its
// figures and links, the Queues count in the sidebar, the 56 px bottom bar below 900 px with the
// user card inside More, the hidden scope the header Find form carries, and the palette trigger on
// touch. The API is stubbed with page.route; the static server serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const CATALOG = JSON.parse(readFileSync(path.join(ROOT, 'hub/catalog.json'), 'utf8'));
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const PID = 'llanos-screen';
const NOW = Date.now(), DAY = 864e5;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const hm = (isoStr) => new Date(isoStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const POLLED = iso(4 * 60e3);

const PROJECTS = [
  { id: PID, client_id: 'frontera', name: 'Llanos waterflood screen', status: 'active', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'], created_at: iso(30 * DAY), closed_at: null, contacts: [], country: 'CO', lat: 4.1, lon: -72.9, stage: 'Technical review', stage_history: [{ stage: 'Technical review', at: iso(12 * DAY), by: 'chris' }], register: { next: 'Issue screening letter to Frontera', owner: 'Chris', risk: 'amber', risk_score: 48 }, last_activity_at: iso(2 * 3600e3), run_count: 4, item_count: 6, stale_count: 2 },
  { id: 'talara-redevelopment', client_id: 'petroperu', name: 'Talara redevelopment', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'], created_at: iso(20 * DAY), closed_at: null, contacts: [], country: 'PE', lat: -4.6, lon: -81.3, stage: 'Qualified', stage_history: [], register: {}, last_activity_at: iso(5 * DAY), run_count: 1, item_count: 2, stale_count: 0 },
];
const COUNTRIES = { countries: [
  { code: 'CO', name: { en: 'Colombia', es: 'Colombia' }, projects: [{ id: PID, name: PROJECTS[0].name, status: 'active', stage: 'Technical review', client_id: 'frontera', client_name: 'Frontera Energy', lat: 4.1, lon: -72.9, last_run_at: iso(2 * DAY), attention: { stale: 2, filing: 0, expiring_days: null }, assets: [] }], counts: { projects: 1, stale: 2, filing: 0, expiring: 0 }, risk: null },
  { code: 'PE', name: { en: 'Peru', es: 'Perú' }, projects: [{ id: 'talara-redevelopment', name: 'Talara redevelopment', status: 'prospect', stage: 'Qualified', client_id: 'petroperu', client_name: 'Petroperú', lat: -4.6, lon: -81.3, last_run_at: null, attention: { stale: 0, filing: 0, expiring_days: null }, assets: [] }], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
], unplaced: [], generated_at: iso(0), world_monitor: { status: 'not_connected', reason: 'not connected', notes: [] } };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** The seeded Vault: 3 need a decision, 12 came in, 1 to file, 2 stale, 1 lesson proposed, a connected mailbox polled 4 minutes ago. */
async function seed(page, over = {}) {
  const o = { filing: 1, lessons: 1, review: 3, records: 12, mailbox: 'connected', ...over };
  const log = { search: [], notFound: [] };
  await page.route('**/api/**', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (p === '/api/health') return json(route, { ok: true, version: '0.7.0', migrations: 7, backend: 'pg' });
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (/^\/api\/tools\/[^/]+\/resolve$/.test(p)) { const t = CATALOG.tools.find((x) => x.id === p.split('/')[3]); return t ? json(route, { id: t.id, version: t.aliases.current, entry: t.entry }) : json(route, { error: { code: 'not_found', message: 'no tool' } }, 404); }
    if (p === '/api/me/mailbox') return json(route, o.mailbox === 'connected'
      ? { configured: true, connected: true, prompt: false, connection: { id: 'mb1', address: PARTNER.email, status: 'connected', privacy: 'full', connected_at: iso(10 * DAY), last_poll_at: POLLED, last_error: null }, counts: { messages: 10, filed: 8, waiting: 1, hidden_internal: 1, hidden_bulk: 0 }, firm_domains: ['alpha-technical-centre.com'] }
      : { configured: false, connected: false, prompt: false, connection: null, counts: null, firm_domains: [] });
    if (p === '/api/me/activity') return json(route, { since: iso(DAY), counts: { records: o.records, messages_filed: 5, ready: 2, review: o.review, invoices: 0, files: 4, organisations_proposed: 1, bulk_hidden: 0 }, projects: [], brief_available: false });
    if (p === '/api/queue/filing') return json(route, { items: Array.from({ length: o.filing }, (_, i) => ({ id: 'f' + i, subject: 'RE: Cubiro data request ' + i, from: 'Jorge Salazar', suggested_project_name: PROJECTS[0].name, confidence: 0.8 })) });
    if (p === '/api/lessons') return json(route, { lessons: Array.from({ length: o.lessons }, (_, i) => ({ id: 'l' + i, statement: 'Test aquifer strength before assuming voidage replacement.', discipline: 'reservoir-engineering', confidence: 0.8 })) });
    if (p === '/api/queue/review') return json(route, { items: [] });
    if (p === '/api/projects') return json(route, { projects: PROJECTS });
    if (/^\/api\/projects\/[^/]+\/stale$/.test(p)) { const id = p.split('/')[3]; const n = (PROJECTS.find((x) => x.id === id) || {}).stale_count || 0; return json(route, { runs: Array.from({ length: n }, (_, i) => ({ id: 'r' + i, job: 'opportunity-register', tool_version: '2.0.0', stale_reasons: [{ rule: 'R1', detail: 'tool version 2.0.0, now 2.1.0' }] })), items: [] }); }
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (/^\/api\/countries\/[A-Z]{2}\/intel$/.test(p)) return json(route, { country: p.split('/')[3], name: { en: 'Country', es: 'País' }, world_monitor: { status: 'not_connected', reason: 'not connected' }, sections: {} });
    if (p === '/api/organisations') return json(route, { organisations: [{ id: 'frontera', name: 'Frontera Energy', kind: 'client', country: 'CO' }, { id: 'petroperu', name: 'Petroperú', kind: 'operator', country: 'PE' }].filter((x) => !url.searchParams.get('q') || x.name.toLowerCase().includes(url.searchParams.get('q').toLowerCase())) });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/search') { log.search.push(url.search); return json(route, { hits: [], scope: url.searchParams.get('scope'), took_ms: 1 }); }
    if (p === '/api/projects/' + PID) return json(route, PROJECTS[0]);
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: 0, entries: [] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/projects/' + PID + '/contacts') return json(route, { project_id: PID, client_id: 'frontera', contacts: [], counterparties: [] });
    if (p === '/api/projects/' + PID + '/research') return json(route, { enabled: false, findings: [], runs: [] });
    if (p === '/api/projects/' + PID + '/assets') return json(route, { project_id: PID, assets: [] });
    if (p === '/api/organisations/frontera') return json(route, { id: 'frontera', name: 'Frontera Energy', kind: 'client', contacts: [] });
    if (p === '/api/settings/day-rates') return json(route, { key: 'day-rates', value: { rates: { Principal: 13500, Senior: 11000, 'Mid-level': 8000, Junior: 5500 } }, defaults: true });
    if (p === '/api/me/connections') return json(route, { connections: [] });
    if (p === '/api/analogues') return json(route, { scope: 'firm', count: 0, counts: {}, rows: [] });
    if (p === '/api/cost' || p.startsWith('/api/cost/') || p.startsWith('/api/health/')) return json(route, { rows: [], days: [], features: [], budget: null, runs: [] });
    log.notFound.push(req.method() + ' ' + p);
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return log;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const PAGES = ['index.html', 'project.html?id=' + PID, 'queue.html', 'search.html', 'settings.html', 'tool.html?id=opportunity-register', 'cost.html', 'analogues.html'];

test('idea C: the status strip sits under the top bar on every page, 28 px, with every figure a link and zeros dimmed, never hidden', async ({ page }) => {
  await seed(page, { filing: 0 });
  for (const p of PAGES) {
    await page.goto('/hub/' + p);
    const strip = page.locator('#hub-strip');
    await expect(strip, p).toBeVisible();
    await expect(strip, p).toHaveAttribute('data-state', 'synced');
    const top = await page.locator('.hub-top').boundingBox();
    const box = await strip.boundingBox();
    expect(Math.round(box.height), p + ' strip height').toBe(28);
    expect(Math.round(box.y), p + ' strip sits under the top bar').toBe(Math.round(top.y + top.height));
    await expect(strip.locator('[data-figure="vault"]'), p).toContainText(/Vault synced \d\d:\d\d/);
    await expect(strip.locator('[data-figure="mail"]'), p).toHaveText('mail polled ' + hm(POLLED));
    const need = strip.locator('a[data-figure="need"]');
    await expect(need, p).toHaveText('3 need you');
    await expect(need, p).toHaveAttribute('href', '/hub/queue.html?kind=review');
    const came = strip.locator('a[data-figure="came"]');
    await expect(came, p).toHaveText('12 came in');
    await expect(came, p).toHaveAttribute('href', '/hub/index.html#sec-activity');
    const file = strip.locator('a[data-figure="file"]');
    await expect(file, p).toHaveText('0 to file');
    await expect(file, p).toHaveAttribute('data-zero', '1');            // dimmed, still there
    await expect(file, p).toHaveAttribute('href', '/hub/queue.html');
    const stale = strip.locator('a[data-figure="stale"]');
    await expect(stale, p).toHaveText('2 stale');
    await expect(stale, p).not.toHaveAttribute('data-zero', /.+/);
    await expect(stale, p).toHaveAttribute('href', '/hub/index.html#card-stale');
    const lessons = strip.locator('a[data-figure="lessons"]');
    await expect(lessons, p).toHaveText('1 lesson to confirm');
    await expect(lessons, p).toHaveAttribute('href', '/hub/queue.html?kind=lesson');
    // R3: the Queues entry carries the count, filing plus lessons proposed.
    await expect(page.locator('aside.hub-side a[data-nav="queue"] [data-nav-count]'), p).toHaveText('1');
    // The strip's text is bilingual like everything else.
    for (const el of await strip.locator('[data-en]').all()) expect(await el.getAttribute('data-es'), p).toBeTruthy();
  }
  // Two lessons and two to file read as plurals; a count of two in the Queues badge.
  await seed(page, { filing: 2, lessons: 2 });
  await page.goto('/hub/queue.html');
  await expect(page.locator('#hub-strip a[data-figure="file"]')).toHaveText('2 to file');
  await expect(page.locator('#hub-strip a[data-figure="lessons"]')).toHaveText('2 lessons to confirm');
  await expect(page.locator('aside.hub-side a[data-nav="queue"] [data-nav-count]')).toHaveText('4');
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#hub-strip a[data-figure="need"]')).toHaveText('3 le esperan');
  await expect(page.locator('#hub-strip a[data-figure="file"]')).toHaveText('2 por archivar');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('.nav-lang button[data-lang="en"]').click();
  await page.goto('/hub/index.html');
  await ready(page);
  await page.locator('.hub-main').screenshot({ path: path.join(EVIDENCE, 'w7-strip-desk.png'), clip: { x: 0, y: 0, width: 1192, height: 90 } });
});

test('idea C: without a connected mailbox the mail figure is quiet; with the Vault unreachable the strip renders a quiet dash and the sidebar has no Vault footer', async ({ page }) => {
  await seed(page, { mailbox: 'none' });
  await page.goto('/hub/queue.html');
  const strip = page.locator('#hub-strip');
  await expect(strip).toHaveAttribute('data-state', 'synced');
  await expect(strip.locator('[data-figure="mail"]')).toHaveText('mail not connected');
  await expect(strip.locator('[data-figure="mail"]')).toHaveAttribute('data-zero', '1');
  await expect(page.locator('.hub-side-foot')).toHaveCount(0);
  await expect(page.locator('#vault-dot')).toHaveCount(0);

  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/hub/queue.html');
  await expect(strip).toHaveAttribute('data-state', 'off');
  await expect(strip.locator('.hub-strip-dot')).toHaveText('—');                // the quiet dash
  await expect(strip.locator('[data-figure="vault"]')).toContainText('Vault unreachable');
  await expect(strip.locator('a[data-figure]:not([hidden])')).toHaveCount(0);   // no figure pretends to be a count
  await expect(strip.locator('[data-en]').first()).toHaveAttribute('data-es', /.+/);
});

test('R3: below 900 px the sidebar is a 56 px sticky bottom bar of five icons, Today · Projects · Find · Queues · More, and the user card lives in More', async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/hub/index.html');
  await ready(page);
  const side = page.locator('aside.hub-side');
  const box = await side.boundingBox();
  expect(Math.round(box.height)).toBe(56);
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(Math.round(box.width)).toBe(390);
  expect(await side.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  // Five items left to right (the markup keeps the nav's order; the bar lays them out Today · Projects · Find · Queues · More).
  const items = side.locator('[data-bar]');
  await expect(items).toHaveCount(5);
  const placed = [];
  for (const it of await items.all()) { const b = await it.boundingBox(); expect(b.height, 'hit area').toBeGreaterThanOrEqual(44); placed.push({ key: await it.getAttribute('data-bar'), x: b.x }); }
  expect(placed.sort((a, b) => a.x - b.x).map((p) => p.key)).toEqual(['today', 'projects', 'find', 'queue', 'more']);
  await expect(side.locator('a[data-nav="queue"] [data-nav-count]')).toHaveText('2');
  // The user card and Settings are in More, closed until asked for; the language switch stays in reach at the top right.
  await expect(page.locator('#me')).toBeHidden();
  await expect(side.locator('a[data-nav="settings"]')).toBeHidden();
  const lang = await side.locator('.nav-lang').boundingBox();
  expect(lang.y).toBeLessThan(56);
  expect(lang.x + lang.width).toBeGreaterThan(300);
  await expect(side.locator('.nav-lang button[data-lang="es"]')).toBeVisible();
  const more = page.locator('#hub-more');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#me')).toBeVisible();
  await expect(page.locator('#me-name')).toHaveText('Chris Hopkinson');
  await expect(side.locator('a[data-nav="settings"]')).toBeVisible();
  await expect(side.locator('a[data-nav="settings"]')).toHaveAttribute('href', '/hub/settings.html');
  // Content is not hidden under the bar: the page keeps 56 px of room below its foot.
  expect(await page.locator('.hub-foot').evaluate((el) => { const r = el.getBoundingClientRect(); return document.documentElement.scrollHeight - (r.bottom + window.scrollY); })).toBeGreaterThanOrEqual(56);
  await more.click();
  await expect(page.locator('#me')).toBeHidden();
  // Escape closes it too.
  await more.click();
  await page.keyboard.press('Escape');
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // At 1440 the bar is the sidebar again: the user card shows, More does not.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#me')).toBeVisible();
  await expect(more).toBeHidden();
  await expect(side.locator('a[data-nav="settings"]')).toBeVisible();
  expect(await side.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
});

test('§1.4: the header Find form carries a hidden scope the page sets: the project on a project page, else the remembered scope or firm', async ({ page }) => {
  await seed(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const scope = page.locator('form.hub-find input[name="scope"]');
  await expect(scope).toHaveCount(1);
  await expect(scope).toHaveAttribute('type', 'hidden');
  await expect(scope).toHaveValue('firm');
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('form.hub-find input[name="scope"]')).toHaveValue('project:' + PID);
  await page.evaluate(() => localStorage.setItem('atc-hub-find-scope', 'client:frontera'));
  for (const p of ['queue.html', 'settings.html', 'tool.html?id=opportunity-register', 'cost.html', 'analogues.html']) {
    await page.goto('/hub/' + p);
    await expect(page.locator('form.hub-find input[name="scope"]'), p).toHaveValue('client:frontera');
  }
  await page.goto('/hub/project.html?id=' + PID);
  await expect(page.locator('form.hub-find input[name="scope"]')).toHaveValue('project:' + PID);   // the page wins over the memory
  // Submitting carries both.
  await page.locator('form.hub-find input[name="q"]').fill('cubiro');
  await page.locator('form.hub-find button[type="submit"]').click();
  await expect(page).toHaveURL(/search\.html\?q=cubiro&scope=project%3Allanos-screen$/);
});

test('R7: on a touch device the palette trigger is a search icon and "Jump", not "Jump ⌘K"', async ({ browser }) => {
  const touch = await browser.newContext({ hasTouch: true, viewport: { width: 1024, height: 768 } });
  const page = await touch.newPage();
  await seed(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const btn = page.locator('#palette-btn');
  await expect(btn).toBeVisible();
  await expect(btn.locator('kbd')).toHaveCount(0);
  await expect(btn.locator('svg')).toHaveCount(1);
  await expect(btn).toHaveText('Jump');
  await expect(btn).toHaveAttribute('data-touch', '1');
  await touch.close();
  const mouse = await browser.newContext({ hasTouch: false, viewport: { width: 1024, height: 768 } });
  const p2 = await mouse.newPage();
  await seed(p2);
  await p2.goto('/hub/index.html');
  await ready(p2);
  await expect(p2.locator('#palette-btn kbd')).toHaveText('⌘K');
  await mouse.close();
});
