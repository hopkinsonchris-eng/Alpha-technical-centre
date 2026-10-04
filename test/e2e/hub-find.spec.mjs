// M12: Hub Find page. The API is stubbed with page.route; the static server (python3 -m http.server,
// started by playwright.config.mjs) serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence/m12-find.png');

const DAY = 864e5;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const PROJECT = 'llanos-waterflood';
const SCOPE = 'project:' + PROJECT;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route, status, code, message) => json(route, { error: { code, message } }, status);

const hit = (o) => ({ item_id: null, run_id: null, version: 1, ordinal: 0, anchor: null, project_id: PROJECT, stale: false, authors: [], legal_tag: 'lt-frontera-nda-2026', ...o });
const HITS = [
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000001', item_id: '00000000-0000-4000-8000-000000000001', type: 'paper', title: 'Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones', snippet: '…Voidage replacement ratios below 0.8 correlated with early water breakthrough in 7 of 11 waterflood patterns; gains were <0.5 elsewhere.…', legal_tag: 'lt-onepetro-sub-2026', date: ago(19), authors: ['gs'] }),
  hit({ ref: 'run:00000000-0000-4000-8000-000000000002', run_id: '00000000-0000-4000-8000-000000000002', type: 'run', title: 'Cubiro waterflood: base (re-run on 2.1.0)', snippet: '…Voidage replacement capped at injector capacity of 8,500 bwpd. Waterflood recovery factor 0.20 on OOIP; NPV10 USD 171.1 MM.…', date: ago(2), authors: ['chris'] }),
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000003', item_id: '00000000-0000-4000-8000-000000000003', type: 'letter', title: 'Letter ATC-2026-0139 to Frontera: interim results, Cubiro waterflood screening', snippet: '…The waterflood screening supports an incremental 2P of 16.2 MMbbl, provided a voidage replacement close to 1.0 can be sustained.…', date: ago(12), stale: true, authors: ['chris', 'cm'] }),
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000004', item_id: '00000000-0000-4000-8000-000000000004', type: 'email', title: 'RE: Cubiro water injection data request', snippet: '…Current injection is 6,400 bwpd across 6 injectors, so full voidage replacement is not possible before the 2027 expansion.…', date: ago(4), authors: ['gs', 'chris'] }),
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000005', item_id: '00000000-0000-4000-8000-000000000005', type: 'spreadsheet', title: 'Cubiro_injectors_layout_v4.xlsx', snippet: '…Injector-producer pairs, cumulative injection and voidage balance by pattern. 6 injectors, 14 producers.…', date: ago(400), authors: ['cm'] }),
];
const PEOPLE = [
  { person_id: 'chris', name: 'Chris Hopkinson', role: 'partner', last_at: ago(2), count: 3, refs: [] },
  { person_id: 'gs', name: 'Gabriela Sosa', role: 'associate', last_at: ago(4), count: 2, refs: [] },
  { person_id: 'cm', name: 'Carlos Mora', role: 'associate', last_at: ago(12), count: 2, refs: [] },
];

/** Stub /api/**; `calls` records every search request. */
async function stub(page, over = {}) {
  const calls = { search: [], people: [] };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (over[p]) return over[p](url, route, calls);
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/projects') return json(route, { projects: [{ id: PROJECT, name: 'Llanos Basin waterflood screening', client_id: 'frontera' }, { id: 'orinoco-partnership', name: 'Orinoco partnership', client_id: 'pdo' }] });
    if (p === '/api/clients') return json(route, { clients: [{ id: 'frontera', name: 'Frontera Energy', project_ids: [PROJECT] }] });
    if (p === '/api/catalog') return json(route, { tools: [] });
    if (p === '/api/search') {
      calls.search.push(url.searchParams);
      if (!url.searchParams.get('scope')) return err(route, 400, 'scope_required', 'scope is required');
      if (!url.searchParams.get('q')) return err(route, 400, 'query_required', 'q is required');
      if (url.searchParams.get('scope') === 'project:forbidden') return err(route, 403, 'forbidden', 'not a member of project forbidden');
      return json(route, { hits: HITS, scope: url.searchParams.get('scope'), took_ms: 41 });
    }
    if (p === '/api/search/people') { calls.people.push(url.searchParams); return json(route, { people: PEOPLE, scope: url.searchParams.get('scope'), took_ms: 30 }); }
    return err(route, 404, 'not_found', 'no route');
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const results = (page) => page.locator('#find-results .result');
const openPage = async (page, qs = '') => { await page.goto('/hub/search.html' + qs); await ready(page); };

test('results render with type icon, highlighted snippet, source path, legal tag and who-worked chips; the address carries q and scope', async ({ page }) => {
  const calls = await stub(page);
  await openPage(page, '?q=' + encodeURIComponent('waterflood voidage') + '&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  expect(calls.search).toHaveLength(1);
  expect(calls.search[0].get('q')).toBe('waterflood voidage');
  expect(calls.search[0].get('scope')).toBe(SCOPE);
  expect(calls.people[0].get('scope')).toBe(SCOPE);
  await expect(page.locator('#find-scope')).toHaveValue(SCOPE);
  await expect(page.locator('#find-count')).toContainText('5 results for “waterflood voidage” in project:' + PROJECT);

  const first = results(page).nth(0);
  await expect(first.locator('.r-ico svg')).toHaveCount(1);
  await expect(first.locator('.r-title a')).toContainText('Waterflood performance and voidage management');
  await expect(first.locator('.r-title a')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT);
  await expect(first.locator('.r-title mark')).toHaveText(['Waterflood', 'voidage']);
  await expect(first.locator('.snip mark')).toHaveText(['Voidage', 'waterflood']);
  await expect(first.locator('.snip')).toContainText('<0.5', { useInnerText: true });   // a "<" in the Vault's text is text, never markup
  await expect(first.locator('.path')).toHaveText(/Llanos Basin waterflood screening · Paper · \d{1,2} \w{3,4} \d{4}/);
  await expect(first.locator('[data-legal-tag="lt-onepetro-sub-2026"]')).toBeVisible();
  await expect(first.locator('.hub-pill')).toHaveText('Paper');
  await expect(first.locator('.find-av')).toHaveCount(1);

  const run = results(page).nth(1);
  await expect(run).toHaveAttribute('data-type', 'run');
  await expect(run.locator('.r-title a')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT + '&run=00000000-0000-4000-8000-000000000002');
  await expect(results(page).nth(2).locator('.hub-stale')).toHaveText('Stale');
  await expect(results(page).nth(2).locator('.find-av')).toHaveCount(2);

  // Who worked this: chips from /api/search/people, in the order the API gave (most recent first).
  await expect(page.locator('#find-who .find-who-chip')).toHaveCount(3);
  await expect(page.locator('#find-who .find-who-chip').first()).toContainText('Chris Hopkinson');
  await expect(page.locator('#find-who .find-who-chip').nth(1)).toContainText('Gabriela Sosa');

  expect(new URL(page.url()).searchParams.get('q')).toBe('waterflood voidage');
  expect(new URL(page.url()).searchParams.get('scope')).toBe(SCOPE);
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  await page.screenshot({ path: EVIDENCE, fullPage: true });
});

test('scope is mandatory: nothing is sent without one, the state says so, and the choice is remembered', async ({ page }) => {
  const calls = await stub(page);
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('e2e-cleared')) { localStorage.removeItem('atc-hub-find-scope'); sessionStorage.setItem('e2e-cleared', '1'); } } catch (e) { /* */ } });
  await openPage(page);
  await expect(page.locator('#find-scope')).toHaveValue('');
  await expect(page.locator('#find-scope option')).toHaveText([
    'Choose a scope…', 'Project: Llanos Basin waterflood screening', 'Project: Orinoco partnership', 'Client: Frontera Energy (all projects)',
    'Firm: lessons, templates, firm-tagged', 'Public: regulators, papers, feeds',
  ]);
  await page.locator('#find-q').fill('waterflood voidage');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#notices [role="alert"]')).toContainText('Scope required.');
  await expect(page.locator('#find-scope')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#find-results')).toContainText('Choose a scope');
  expect(calls.search).toHaveLength(0);
  expect(calls.people).toHaveLength(0);

  await page.locator('#find-scope').selectOption('client:frontera');
  await expect(results(page)).toHaveCount(5);
  await expect(page.locator('#notices [role="alert"]')).toHaveCount(0);
  await expect(page.locator('#find-scope')).not.toHaveAttribute('aria-invalid', 'true');
  expect(calls.search.map((s) => s.get('scope'))).toEqual(['client:frontera']);
  await expect(page.locator('#scope-pred')).toContainText('scope = client:frontera');
  expect(new URL(page.url()).searchParams.get('scope')).toBe('client:frontera');

  // A fresh visit without ?scope= restores the remembered scope; ?scope= wins over it.
  await page.goto('/hub/search.html?q=waterflood');
  await ready(page);
  await expect(page.locator('#find-scope')).toHaveValue('client:frontera');
  await expect(results(page)).toHaveCount(5);
  await page.goto('/hub/search.html?q=waterflood&scope=firm');
  await ready(page);
  await expect(page.locator('#find-scope')).toHaveValue('firm');
});

test('a query is needed too: an empty query shows the prompt and sends nothing', async ({ page }) => {
  const calls = await stub(page);
  await openPage(page, '?scope=public');
  await expect(page.locator('#find-results')).toContainText('Enter a query');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#find-results')).toContainText('Enter a query');
  expect(calls.search).toHaveLength(0);
});

test('filters by type and by date narrow the hits already returned; empty state when nothing matches', async ({ page }) => {
  await stub(page);
  await openPage(page, '?q=waterflood&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  const chips = page.locator('#find-types .find-chip');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(chips).toContainText(['All types (5)', 'Runs (1)', 'Letters (1)', 'Emails (1)', 'Spreadsheets & data (1)', 'Papers (1)']);
  await expect(page.locator('#find-types .find-chip[data-type="lesson"]')).toHaveCount(0);   // no lessons among the hits

  await page.locator('#find-types [data-type="letter"]').click();
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toHaveAttribute('data-type', 'letter');
  await expect(page.locator('#find-types [data-type="letter"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#find-count')).toContainText('1 result for');

  // Date: the spreadsheet is 400 days old; the paper 19 days; the run 2 days.
  await page.locator('#find-types [data-type="all"]').click();
  await page.locator('#find-date').selectOption('30');
  await expect(results(page)).toHaveCount(4);
  await expect(page.locator('#find-results')).not.toContainText('Cubiro_injectors_layout_v4.xlsx');
  await expect(page.locator('#find-types [data-type="spreadsheet"]')).toHaveCount(0);
  await page.locator('#find-types [data-type="paper"]').click();
  await expect(results(page)).toHaveCount(1);
  await page.locator('#find-date').selectOption('365');
  await expect(results(page)).toHaveCount(1);
  await page.locator('#find-types [data-type="all"]').click();
  await expect(results(page)).toHaveCount(4);
  await page.locator('#find-date').selectOption('any');
  await expect(results(page)).toHaveCount(5);

  // Empty state: a search that returns nothing.
  await page.unroute('**/api/**');
  await stub(page, { '/api/search': (u, r) => json(r, { hits: [], scope: SCOPE, took_ms: 3 }), '/api/search/people': (u, r) => json(r, { people: [] }) });
  await page.locator('#find-q').fill('zzzz');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#find-results')).toContainText('No results');
  await expect(page.locator('#find-results')).toContainText('widen the scope');
  await expect(page.locator('#find-count')).toContainText('0 results for');
  await expect(page.locator('#find-who')).toBeHidden();
});

test('error states: a scope the caller may not search, a refused request and an unreachable Vault', async ({ page }) => {
  await stub(page);
  await openPage(page, '?q=waterflood&scope=project:forbidden');
  await expect(page.locator('#find-scope')).toHaveValue('project:forbidden');
  await expect(page.locator('#notices [role="alert"]')).toContainText('Outside your scope');
  await expect(page.locator('#notices [role="alert"]')).toContainText('not a member of project forbidden');
  await expect(results(page)).toHaveCount(0);

  await page.unroute('**/api/**');
  await stub(page, { '/api/search': (u, r) => err(r, 500, 'error', 'boom'), '/api/search/people': (u, r) => err(r, 500, 'error', 'boom') });
  await page.locator('#find-scope').selectOption('public');
  await expect(page.locator('#notices [role="alert"]')).toContainText('The Vault is unreachable');
  await expect(page.locator('#find-results')).toContainText('The Vault is unreachable');
});

test('bilingual: every data-en has its data-es, no bare text, and the toggle keeps highlights and results', async ({ page }) => {
  await stub(page);
  await openPage(page, '?q=waterflood%20voidage&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  const audit = () => page.evaluate(() => {
    const missing = [...document.querySelectorAll('[data-en]')].filter((el) => !el.hasAttribute('data-es')).map((el) => el.outerHTML.slice(0, 80));
    const missingPh = [...document.querySelectorAll('[data-en-ph]')].filter((el) => !el.hasAttribute('data-es-ph')).map((el) => el.outerHTML.slice(0, 80));
    const bare = [...document.body.querySelectorAll('*')].filter((el) => {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT'].includes(el.tagName.toUpperCase()) || el.closest('svg, .nav-wordmark, .hub-av, .nav-lang')) return false;
      if (el.children.length) return false;
      const t = el.textContent.trim();
      // Vault text containing "<" is set without data attributes on purpose (main.js would render such a value as HTML).
      return /\p{L}{2,}/u.test(t) && !t.includes('<') && !el.hasAttribute('data-en') && !el.closest('[data-en]');
    }).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
    return { count: document.querySelectorAll('[data-en]').length, missing, missingPh, bare, marks: document.querySelectorAll('.result mark').length };
  });
  const en = await audit();
  expect(en.count).toBeGreaterThan(80);
  expect(en.missing).toEqual([]); expect(en.missingPh).toEqual([]); expect(en.bare).toEqual([]);
  expect(en.marks).toBeGreaterThan(8);

  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('h1')).toHaveText('Buscar en el Vault');
  await expect(page.locator('label[for="find-scope"]')).toContainText('Alcance');
  await expect(page.locator('#find-q')).toHaveAttribute('placeholder', /voidage de inyección/);
  await expect(page.locator('#find-types [data-type="all"]')).toContainText('Todos los tipos (5)');
  await expect(results(page).first().locator('.path')).toContainText('Artículo');
  await expect(page.locator('#find-count')).toContainText('resultados para');
  const es = await audit();
  expect(es.missing).toEqual([]); expect(es.bare).toEqual([]);
  expect(es.marks).toBe(en.marks);                     // highlights survive the language switch

  // A new search after switching renders in Spanish straight away.
  await page.locator('#find-scope').selectOption('firm');
  await expect(page.locator('#find-count')).toContainText('resultados para');
  await expect(results(page).first().locator('.hub-pill')).toHaveText('Artículo');
});

test('accessibility: axe finds no WCAG 2 A/AA violations (results, empty, scope error, Spanish)', async ({ page }) => {
  await stub(page);
  const axe = async (label) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), label).toEqual([]);
  };
  await openPage(page, '?q=waterflood%20voidage&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  await axe('results');
  await page.locator('#find-types [data-type="letter"]').click();
  await axe('filtered');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await axe('spanish');
  await page.locator('.nav-lang button[data-lang="en"]').click();
  await page.locator('#find-scope').selectOption('');
  await page.locator('#find-q').fill('x');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#notices [role="alert"]')).toBeVisible();
  await axe('scope error');
});

test('not indexable: noindex meta, listed in robots.txt, absent from the sitemap, no keys in the page', async ({ page, request }) => {
  await page.goto('/hub/search.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  const html = await (await request.get('/hub/search.html')).text();
  const js = await (await request.get('/hub/search.js')).text();
  expect(html + js).not.toMatch(/googletagmanager|gtag\(|VOYAGE|api\.voyageai|sk-ant/i);
  expect(await (await request.get('/robots.txt')).text()).toMatch(/^Disallow: \/hub\/$/m);
  expect(await (await request.get('/sitemap.xml')).text()).not.toMatch(/\/hub\//);
});
