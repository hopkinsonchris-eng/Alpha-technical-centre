// Wave 2, PR 2 (docs/vault-hub/wave2/05-markup.md §1.1): the Hub front page is a globe
// of where the firm works, with the country list as the keyboard path, a country
// drill-down that is linkable (?country=XX), and the opportunity register. AC2–AC6.
// The API is stubbed with page.route; the static server serves the pages and the geo file.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };

const proj = (id, name, extra = {}) => ({
  id, name, status: 'prospect', stage: 'Qualified', client_id: null, client_name: null, lat: null, lon: null, last_run_at: null,
  attention: { stale: 0, filing: 0, expiring_days: null }, assets: [], ...extra,
});
// Wave 3: the fields attached to a project ride along in the country summary.
const BARINAS_FIELDS = [
  { id: 'field:ve:barinas', name: 'Barinas', kind: 'field', lat: 8.62, lon: -70.21, location_source: 'gem' },
  { id: 'field:ve:apure', name: 'Apure', kind: 'field', lat: 7.9, lon: -67.5, location_source: 'geonames' },
  { id: 'field:ve:unplaced', name: 'Unplaced block', kind: 'block', lat: null, lon: null, location_source: null },
];
const COUNTRIES = {
  countries: [
    { code: 'EG', name: { en: 'Egypt', es: 'Egipto' }, projects: [proj('egy-onshore', 'Egypt Onshore Gas Hub', { client_id: 'frontera', client_name: 'Frontera Energy', lat: 30.5, lon: 30.2, stage: 'Negotiation', attention: { stale: 0, filing: 0, expiring_days: 12 } })], counts: { projects: 1, stale: 0, filing: 0, expiring: 1 } },
    { code: 'KZ', name: { en: 'Kazakhstan', es: 'Kazajistán' }, projects: [proj('kaz-brownfield', 'Western Kazakhstan Brownfield', { lat: 47.1, lon: 51.9, last_run_at: '2026-09-28T14:12:00.000Z' })], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 } },
    { code: 'VE', name: { en: 'Venezuela', es: 'Venezuela' }, risk: { score: 71.4, level: 'reconsider travel', computed_at: '2026-10-01T08:00:00.000Z', fetched_at: '2026-10-01T09:00:00.000Z' }, projects: [
      proj('ven-barinas', 'Barinas–Apure Cluster', { lat: 8.1, lon: -69.3, stage: 'Technical review', status: 'active', attention: { stale: 2, filing: 1, expiring_days: null }, assets: BARINAS_FIELDS }),
      proj('ven-maracaibo', 'Lake Maracaibo Redevelopment', { lat: 10.4, lon: -71.6 }),
    ], counts: { projects: 2, stale: 2, filing: 1, expiring: 0 } },
  ],
  unplaced: [proj('plain-project', 'Plain internal project', { status: 'active', stage: 'Initial screen' })],
  generated_at: '2026-10-01T08:00:00.000Z',
  world_monitor: { status: 'live', notes: [] },
};
const PROJECTS = { projects: [
  { id: 'egy-onshore', name: 'Egypt Onshore Gas Hub', status: 'prospect', client_id: 'frontera', default_legal_tag: 'lt-frontera-nda-2026', country: 'EG', lat: 30.5, lon: 30.2, stage: 'Negotiation', stage_history: [{ stage: 'Negotiation', at: '2026-09-20T12:00:00.000Z', by: 'chris' }], register: { source: 'Government', current: 31, plan: 46, risk: 'amber', risk_score: 59, owner: 'Tom / Lars' }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', status: 'prospect', client_id: null, default_legal_tag: 'lt-firm', country: 'KZ', lat: 47.1, lon: 51.9, stage: 'Qualified', stage_history: [{ stage: 'Qualified', at: '2026-09-19T12:00:00.000Z', by: 'chris' }], register: { source: 'Intermediary', current: 16, plan: 22, risk: 'amber', risk_score: 54, owner: 'Tom' }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'ven-barinas', name: 'Barinas–Apure Cluster', status: 'active', client_id: null, default_legal_tag: 'lt-firm', country: 'VE', lat: 8.1, lon: -69.3, stage: 'Technical review', stage_history: [{ stage: 'Technical review', at: '2026-09-22T12:00:00.000Z', by: 'chris' }], register: { source: 'Tennor', current: 42, plan: 58, risk: 'red', risk_score: 78, owner: 'Lars / Chris' }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'ven-maracaibo', name: 'Lake Maracaibo Redevelopment', status: 'prospect', client_id: null, default_legal_tag: 'lt-firm', country: 'VE', lat: 10.4, lon: -71.6, stage: 'Qualified', stage_history: [{ stage: 'Qualified', at: '2026-09-21T12:00:00.000Z', by: 'chris' }], register: { source: 'Tennor', current: 27, plan: 39, risk: 'red', risk_score: 81, owner: 'Chris' }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'plain-project', name: 'Plain internal project', status: 'active', client_id: null, default_legal_tag: 'lt-firm', country: null, lat: null, lon: null, stage: 'Initial screen', stage_history: [], register: {}, members: ['chris'], contacts: [], created_at: '2026-08-01T00:00:00.000Z' },
] };
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, over = {}) {
  const posted = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname;
    if (over[p]) return over[p](u, route, posted);
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (p === '/api/projects') {
      if (route.request().method() === 'POST') { const b = JSON.parse(route.request().postData()); posted.push(b); return json(route, { ...b, status: b.status || 'active', stage_history: [], contacts: [] }, 201); }
      return json(route, PROJECTS);
    }
    if (p === '/api/organisations') return json(route, { organisations: [{ id: 'frontera', name: 'Frontera Energy', kind: 'client' }] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return posted;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const globeReady = (page) => page.locator('#sec-globe[data-globe="ready"]').waitFor();
const shot = (page) => page.locator('#globe').screenshot();

test('AC2: the globe is drawn on a canvas and turns; with reduced motion it stands still', async ({ page, browser }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  const canvas = page.locator('#globe');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('role', 'img');
  await expect(canvas).toHaveAttribute('aria-label', /Globe/);
  const a = await shot(page);
  await page.waitForTimeout(1500);
  const b = await shot(page);
  expect(Buffer.compare(a, b)).not.toBe(0);

  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const still = await ctx.newPage();
  await stubApi(still);
  await still.goto('/hub/index.html');
  await ready(still); await globeReady(still);
  await still.waitForTimeout(300);
  const c = await shot(still);
  await still.waitForTimeout(1500);
  const d = await shot(still);
  expect(Buffer.compare(c, d)).toBe(0);
  await ctx.close();
});

test('AC3: the country list shows what the caller may see with counts and attention flags, sorted by name', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#globe-count')).toHaveText('3 countries · 4 projects');
  const rows = page.locator('#country-list [data-country]');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-country')))).toEqual(['EG', 'KZ', 'VE']);
  const ve = page.locator('#country-list [data-country="VE"]');
  await expect(ve).toContainText('Venezuela');
  await expect(ve).toContainText('2 projects');
  await expect(ve.locator('.hub-flag.stale')).toHaveText('2 stale');
  await expect(ve.locator('.hub-flag.filing')).toHaveText('1 to file');
  await expect(ve.locator('.hub-flag.expiring')).toHaveCount(0);
  const eg = page.locator('#country-list [data-country="EG"]');
  await expect(eg).toContainText('1 project');
  await expect(eg.locator('.hub-flag.expiring')).toHaveText('NDA 12 d');
  await expect(eg.locator('.hub-flag.stale')).toHaveCount(0);
  await expect(page.locator('#country-list [data-country="KZ"] .hub-flag')).toHaveCount(0);
  // Projects without a country are listed too, never dropped.
  await expect(page.locator('#country-unplaced')).toContainText('1 project without a country');
  await expect(page.locator('#country-unplaced a[data-country-project="plain-project"]')).toHaveAttribute('href', 'project.html?id=plain-project');
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#country-list [data-country="KZ"]')).toContainText('Kazajistán');
  await expect(page.locator('#globe-count')).toHaveText('3 países · 4 proyectos');
});

test('AC4 and AC5: choosing a country sets ?country=, lists its projects, links each to its file, and the URL restores the state', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  await page.locator('#country-list [data-country="VE"]').click();
  await expect(page).toHaveURL(/\?country=VE$/);
  const panel = page.locator('#country-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h3')).toHaveText('Venezuela');
  await expect(page.locator('#country-list')).toBeHidden();
  const projects = panel.locator('[data-country-project]');
  await expect(projects).toHaveCount(2);
  await expect(projects.nth(0)).toContainText('Barinas–Apure Cluster');
  await expect(projects.nth(0)).toContainText('Technical review');
  await expect(projects.nth(0)).toHaveAttribute('href', 'project.html?id=ven-barinas');
  await expect(projects.nth(0).locator('.hub-flag.stale')).toHaveText('2 stale');
  await expect(projects.nth(1)).toContainText('Lake Maracaibo Redevelopment');
  await expect(page.locator('#sec-globe')).toHaveAttribute('data-country', 'VE');
  // Back to all countries.
  await panel.getByRole('button', { name: 'All countries' }).click();
  await expect(page).not.toHaveURL(/country=/);
  await expect(page.locator('#country-list')).toBeVisible();
  await expect(panel).toBeHidden();
  // Deep link.
  await page.goto('/hub/index.html?country=KZ');
  await ready(page); await globeReady(page);
  await expect(panel.locator('h3')).toHaveText('Kazakhstan');
  await expect(panel.locator('[data-country-project]')).toHaveCount(1);
  await expect(panel.locator('[data-country-project]').first()).toContainText('last run 28 Sept 2026');
  await expect(page.locator('#sec-globe')).toHaveAttribute('data-country', 'KZ');
  // A country we hold nothing in still opens, and says so.
  await page.goto('/hub/index.html?country=BR');
  await ready(page); await globeReady(page);
  await expect(panel.locator('h3')).toHaveText('Brazil');
  await expect(panel).toContainText('No projects here yet');
  // Tapping the globe itself selects a country: Kazakhstan is centred after the KZ deep link, so its centre is the globe's centre.
  await page.goto('/hub/index.html?country=KZ');
  await ready(page); await globeReady(page);
  await page.waitForTimeout(1200);                         // the flight
  const box = await page.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel.locator('h3')).toHaveText('Kazakhstan');
});

test('AC6: the register lists the projects with their opportunity fields; filters narrow it; Add opportunity posts the new fields', async ({ page }) => {
  const posted = await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const rows = page.locator('#register-body tr[data-register-row]');
  await expect(rows).toHaveCount(5);
  const kaz = page.locator('tr[data-register-row="kaz-brownfield"]');
  await expect(kaz).toContainText('Western Kazakhstan Brownfield');
  await expect(kaz).toContainText('Kazakhstan');
  await expect(kaz).toContainText('Qualified');
  await expect(kaz.locator('[data-col="plan"]')).toHaveText('16 → 22');
  await expect(kaz.locator('[data-col="risk"] .hub-rag')).toHaveAttribute('data-risk', 'amber');
  await expect(kaz.locator('[data-col="risk"]')).toContainText('54');
  await expect(kaz.locator('[data-col="owner"]')).toHaveText('Tom');
  await expect(kaz.locator('a')).toHaveAttribute('href', 'project.html?id=kaz-brownfield');
  await expect(page.locator('tr[data-register-row="egy-onshore"] [data-col="client"]')).toHaveText('Frontera Energy');
  await expect(page.locator('tr[data-register-row="plain-project"] [data-col="plan"]')).toHaveText('—');

  await page.locator('#reg-stage').selectOption('Qualified');
  await expect(page.locator('#register-body tr[data-register-row]:visible')).toHaveCount(2);
  await page.locator('#reg-risk').selectOption('red');
  await expect(page.locator('#register-body tr[data-register-row]:visible')).toHaveCount(1);
  await page.locator('#reg-stage').selectOption('');
  await page.locator('#reg-risk').selectOption('');
  await page.locator('#reg-country').selectOption('VE');
  await expect(page.locator('#register-body tr[data-register-row]:visible')).toHaveCount(2);
  await expect(page.locator('#register-count')).toHaveText('2 of 5');
  await page.locator('#reg-country').selectOption('');

  // Add opportunity opens the project form with the opportunity fields and posts them.
  await page.locator('#btn-new-opportunity').click();
  const form = page.locator('#new-project');
  await expect(form).toBeVisible();
  await expect(form.locator('#np-opp')).toBeVisible();
  await form.locator('#np-name').fill('Gabon Mature Field Package');
  await form.locator('#np-country').selectOption('GA');
  await form.locator('#np-lat').fill('-0.7');
  await form.locator('#np-lon').fill('9.4');
  await form.locator('#np-stage').selectOption('Commercial review');
  await form.locator('#np-source').fill('Tennor');
  await form.locator('#np-current').fill('11');
  await form.locator('#np-plan').fill('17');
  await form.locator('#np-risk').selectOption('amber');
  await form.locator('#np-owner').fill('Christophe');
  await form.getByRole('button', { name: 'Create opportunity' }).click();
  await page.waitForURL(/project\.html\?id=gabon-mature-field-package$/);
  expect(posted).toEqual([{
    id: 'gabon-mature-field-package', name: 'Gabon Mature Field Package', client_id: null, status: 'prospect', country: 'GA', lat: -0.7, lon: 9.4, stage: 'Commercial review',
    register: { source: 'Tennor', current: 11, plan: 17, risk: 'amber', owner: 'Christophe' },
  }]);
});

test('AC6: associates see the register but no Add opportunity; with the Vault down the register is hidden and the globe still draws', async ({ page }) => {
  await stubApi(page, { '/api/me': (u, r) => json(r, { ...PARTNER, role: 'associate' }) });
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#register-body tr[data-register-row]')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Add opportunity' })).toHaveCount(0);

  await page.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  await expect(page.locator('#globe')).toBeVisible();
  await expect(page.locator('#sec-register')).toBeHidden();
  await expect(page.locator('#globe-count')).toContainText('not available');
});

test('AC18: evidence screenshots of the globe front page and a selected country', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  await page.waitForTimeout(600);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w2-globe-front.png') });
  await page.locator('#country-list [data-country="VE"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(EVIDENCE, 'w2-globe-country.png') });
});

/* ── wave 2, PR 4: the country brief (AC16, Hub side) ─────────────────── */

const BRIEF = {
  country: 'VE', name: { en: 'Venezuela', es: 'Venezuela' }, language: 'en', cached: false, generated_at: '2026-10-01T09:00:00.000Z', model: 'claude-sonnet-5-5',
  projects: [{ id: 'ven-barinas', name: 'Barinas–Apure Cluster', stage: 'Technical review', status: 'active', client_id: null }],
  paragraphs: [
    'Situation. Alpha holds two opportunities in Venezuela, the larger at Technical review [run:00000000-0000-4000-8000-000000000401].',
    'Numbers. The base case gives 12,400 bopd of technical potential [run:00000000-0000-4000-8000-000000000401] and the data room index lists 140 producers [doc:00000000-0000-4000-8000-000000000301].',
    '[QUESTION FOR YOU: this sentence carries a figure with no record in scope to cite: "Lake Maracaibo power reliability is rated 60 percent."]',
  ],
  citations: ['run:00000000-0000-4000-8000-000000000401', 'doc:00000000-0000-4000-8000-000000000301'],
  sources: [
    { ref: 'run:00000000-0000-4000-8000-000000000401', title: 'Waterflood screen, base case', kind: 'run', project_id: 'ven-barinas', date: '2026-09-28', legal_tag: 'lt-firm' },
    { ref: 'doc:00000000-0000-4000-8000-000000000301', title: 'Data room index', kind: 'doc', project_id: 'ven-barinas', date: '2026-09-30', legal_tag: 'lt-firm' },
  ],
  warnings: ['1 sentence(s) had no citation and were turned into questions for you'],
  questions: ['Lake Maracaibo power reliability is rated 60 percent.'],
};

test('AC16: Brief this country asks the Vault and shows the cited paragraphs, the sources and the questions; a cached brief says so', async ({ page }) => {
  let posts = 0;
  await stubApi(page, { '/api/countries/VE/brief': (u, r) => { posts++; return json(r, { ...BRIEF, cached: posts > 1 }); } });
  await page.goto('/hub/index.html?country=VE');
  await ready(page); await globeReady(page);
  const btn = page.locator('#country-brief-btn');
  await expect(btn).toBeVisible();
  await expect(page.locator('#country-brief')).toBeHidden();
  await btn.click();
  const brief = page.locator('#country-brief');
  await expect(brief).toBeVisible();
  await expect(brief.locator('[data-brief-paragraph]')).toHaveCount(3);
  await expect(brief.locator('[data-brief-paragraph]').first()).toContainText('Situation. Alpha holds two opportunities');
  // Citations become chips that open the record in its project, not raw brackets.
  await expect(brief.locator('[data-brief-paragraph]').first()).not.toContainText('[run:');
  const cites = brief.locator('[data-brief-paragraph]').nth(1).locator('a[data-cite]');
  await expect(cites).toHaveCount(2);
  await expect(cites.nth(0)).toHaveAttribute('href', 'project.html?id=ven-barinas&run=00000000-0000-4000-8000-000000000401');
  await expect(cites.nth(0)).toHaveText('Waterflood screen, base case');
  await expect(cites.nth(1)).toHaveText('Data room index');
  await expect(brief.locator('[data-brief-paragraph]').nth(2)).toHaveClass(/question/);
  await expect(brief.locator('#brief-questions li')).toHaveCount(1);
  await expect(brief.locator('#brief-sources li')).toHaveCount(2);
  await expect(brief.locator('#brief-meta')).toContainText('1 Oct 2026');
  await expect(brief.locator('#brief-meta')).toContainText('claude-sonnet-5-5');
  await btn.click();
  await expect.poll(() => posts).toBe(2);
  await expect(brief.locator('#brief-meta')).toContainText('from the cache');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w2-country-brief.png'), fullPage: false });
  // Changing country hides the brief.
  await page.locator('#country-back').click();
  await page.locator('#country-list [data-country="KZ"]').click();
  await expect(brief).toBeHidden();
});

test('AC16: without a provider the button explains what is missing; a refusal is shown', async ({ page }) => {
  await stubApi(page, { '/api/countries/VE/brief': (u, r) => json(r, { error: { code: 'not_implemented', message: 'the Vault assistant is not connected (no LLM provider configured)' } }, 501) });
  await page.goto('/hub/index.html?country=VE');
  await ready(page); await globeReady(page);
  await page.locator('#country-brief-btn').click();
  await expect(page.locator('#country-brief .hub-notice.warn')).toContainText('no LLM provider configured');
  await expect(page.locator('#country-brief .hub-notice.warn')).toContainText('ANTHROPIC_API_KEY');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#country-brief-btn')).toHaveText('Resumen del país');
});

/* ── wave 3, PR 1: field points, fields under projects, create a project here (W3-AC7, W3-AC8) ── */

/** The geographic centre of a country's polygon, computed in the page with the vendored d3-geo (what the globe flies to). */
async function centroidOf(page, code) {
  return page.evaluate(async (c) => {
    const g = await (await fetch('/hub/geo/countries-110m.json')).json();
    const f = g.features.find((x) => x.properties.iso2 === c);
    const [lon, lat] = window.d3.geoCentroid(f);
    return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
  }, code);
}

test('W3-AC7: the country panel lists each project\'s fields with their source, and the globe draws a field point whose hover shows its name', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html?country=VE');
  await ready(page); await globeReady(page);
  const panel = page.locator('#country-panel');
  const fields = panel.locator('[data-project-fields="ven-barinas"] .hub-field-pt');
  await expect(fields).toHaveCount(3);
  await expect(fields.nth(0)).toContainText('Barinas');
  await expect(fields.nth(0)).toContainText('8.62, -70.21');
  await expect(fields.nth(0)).toHaveAttribute('title', 'GEM');
  await expect(fields.nth(1)).toHaveAttribute('title', 'GeoNames');
  await expect(fields.nth(2)).toContainText('Unplaced block');
  await expect(fields.nth(2)).toHaveAttribute('title', 'no location');
  await expect(panel.locator('[data-project-fields="ven-maracaibo"]')).toHaveCount(0);
  await page.waitForTimeout(1200);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w3-globe-fields.png') });

  // A field placed at Kazakhstan's centre sits at the canvas centre after the flight there; hovering it names it.
  const kz = await centroidOf(page, 'KZ');
  const withField = JSON.parse(JSON.stringify(COUNTRIES));
  withField.countries[1].projects[0].assets = [{ id: 'field:kz:tengiz', name: 'Tengiz', kind: 'field', lat: kz.lat, lon: kz.lon, location_source: 'gem' }];
  await stubApi(page, { '/api/countries': (u, r) => json(r, withField) });
  await page.goto('/hub/index.html?country=KZ');
  await ready(page); await globeReady(page);
  await page.waitForTimeout(1200);
  const box = await page.locator('#globe').boundingBox();
  const tip = page.locator('#globe-tip');
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText('Tengiz');
  // Away from the point (due west, still inside Kazakhstan) the tip names the country again.
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 + 6);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + box.width / 2 - 41, box.y + box.height / 2 + 6);
  await expect(tip).not.toHaveText('Tengiz');
  await expect(tip).toHaveText('Kazakhstan');
});

test('W3-AC8: Create a project here appears for partners, opens the form with the country and the tapped point filled, and the posted body carries them', async ({ page }) => {
  const posted = await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  // From the list: the country's centre stands in for the tap.
  await page.locator('#country-list [data-country="BR"], #country-list [data-country="VE"]').first().click();
  const row = page.locator('#country-create-row');
  await expect(row).toBeVisible();
  await expect(row.locator('#country-create')).toHaveText('Create a project here');
  await row.locator('#country-create').click();
  const form = page.locator('#new-project');
  await expect(form).toBeVisible();
  await expect(form.locator('#np-country')).toHaveValue('VE');
  const ve = await centroidOf(page, 'VE');
  await expect(form.locator('#np-lat')).toHaveValue(String(ve.lat));
  await expect(form.locator('#np-lon')).toHaveValue(String(ve.lon));
  await expect(form.locator('#np-opp')).toHaveAttribute('open', '');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.waitForTimeout(700);                          // the smooth scroll to the form
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w3-create-here.png') });
  await form.locator('#np-name').fill('Orinoco Belt Screen');
  await form.getByRole('button', { name: 'Create opportunity' }).click();
  await page.waitForURL(/project\.html\?id=orinoco-belt-screen$/);
  expect(posted).toEqual([{ id: 'orinoco-belt-screen', name: 'Orinoco Belt Screen', client_id: null, status: 'prospect', country: 'VE', lat: ve.lat, lon: ve.lon }]);

  // From a tap on the globe: the point under the tap. Kazakhstan is centred after the deep link, so the centre is its centroid.
  await page.goto('/hub/index.html?country=KZ');
  await ready(page); await globeReady(page);
  await page.waitForTimeout(1200);
  const box = await page.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#country-name')).toHaveText('Kazakhstan');
  await page.locator('#country-create').click();
  const kz = await centroidOf(page, 'KZ');
  await expect(form.locator('#np-country')).toHaveValue('KZ');
  expect(Math.abs(Number(await form.locator('#np-lat').inputValue()) - kz.lat)).toBeLessThan(0.2);
  expect(Math.abs(Number(await form.locator('#np-lon').inputValue()) - kz.lon)).toBeLessThan(0.2);
});

test('W3-AC8: associates do not see Create a project here', async ({ page }) => {
  await stubApi(page, { '/api/me': (u, r) => json(r, { ...PARTNER, role: 'associate' }) });
  await page.goto('/hub/index.html?country=VE');
  await ready(page); await globeReady(page);
  await expect(page.locator('#country-panel')).toBeVisible();
  await expect(page.locator('#country-create-row')).toBeHidden();
});

/* ── wave 3, PR 3: live risk from World Monitor (W3-AC9 Hub side, W3-AC10) ── */

test('W3-AC9: a country with a World Monitor reading shows the score and level with the time fetched; one without shows nothing; no browser request goes to worldmonitor.app', async ({ page }) => {
  const leaks = [];
  await page.route('**/*worldmonitor.app/**', (route) => { leaks.push(route.request().url()); return route.abort(); });
  await stubApi(page);
  await page.goto('/hub/index.html?country=VE');
  await ready(page); await globeReady(page);
  const risk = page.locator('#country-risk');
  await expect(risk).toBeVisible();
  await expect(risk).toContainText('risk 71');
  await expect(risk).toContainText('advisory: reconsider travel');
  await expect(risk).toContainText('World Monitor');
  await expect(risk.locator('.hub-rag')).toHaveAttribute('data-risk', 'red');
  await expect(risk.locator('[data-risk-score="71.4"]')).toHaveCount(1);
  await page.locator('#country-back').click();
  await expect(page.locator('#country-list [data-country="VE"] .hub-risk-n')).toHaveText('risk 71');
  await expect(page.locator('#country-list [data-country="KZ"] .hub-risk-n')).toHaveCount(0);
  await page.locator('#country-list [data-country="KZ"]').click();
  await expect(risk).toBeHidden();
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await page.locator('#country-back').click();
  await expect(page.locator('#country-list [data-country="VE"] .hub-risk-n')).toHaveText('riesgo 71');
  expect(leaks).toEqual([]);
});

test('W3-AC9: the brief shows live risk citations as chips, lists the World Monitor records in its sources, and says whether the feed was live', async ({ page }) => {
  const WM_BRIEF = { ...BRIEF, world_monitor: { status: 'live', reason: null, fetched_at: '2026-10-01T09:00:00.000Z', notes: [] },
    paragraphs: [...BRIEF.paragraphs, 'Live risk. World Monitor scores Venezuela 71 of 100, reconsider travel [wm:risk:VE]. Residents protested fuel shortages in Apure on 28 September [wm:acled:VEN12345]. The press reports a field restart [wm:news:1].'],
    citations: [...BRIEF.citations, 'wm:risk:VE', 'wm:acled:VEN12345', 'wm:news:1'],
    sources: [...BRIEF.sources,
      { ref: 'wm:risk:VE', title: 'World Monitor country risk VE', kind: 'wm', project_id: null, date: '2026-10-01', legal_tag: 'lt-public', detail: 'score 71.4, reconsider travel', url: null },
      { ref: 'wm:acled:VEN12345', title: 'Protests in Apure, 2026-09-28', kind: 'wm', project_id: null, date: '2026-09-28', legal_tag: 'lt-public', detail: 'ACLED via World Monitor; Protesters (Venezuela); 0 fatalities', url: null },
      { ref: 'wm:news:1', title: 'PDVSA restarts Apure field', kind: 'wm', project_id: null, date: '2026-09-30', legal_tag: 'lt-public', detail: 'headline via World Monitor, Reuters', url: 'https://example.com/a' }] };
  await stubApi(page, { '/api/countries/VE/brief': (u, r) => json(r, WM_BRIEF) });
  await page.goto('/hub/index.html?country=VE');
  await ready(page); await globeReady(page);
  await page.locator('#country-brief-btn').click();
  const brief = page.locator('#country-brief');
  const live = brief.locator('[data-brief-paragraph]').nth(3);
  await expect(live).toContainText('Live risk. World Monitor scores Venezuela 71 of 100');
  await expect(live).not.toContainText('[wm:');
  const chips = live.locator('[data-cite]');
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toHaveText('World Monitor country risk VE');
  await expect(chips.nth(0)).toHaveClass(/wm/);
  await expect(chips.nth(2)).toHaveAttribute('href', 'https://example.com/a');
  await expect(chips.nth(2)).toHaveAttribute('target', '_blank');
  await expect(brief.locator('#brief-sources li[data-source-kind="wm"]')).toHaveCount(3);
  await expect(brief.locator('#brief-wm')).toHaveAttribute('data-status', 'live');
  await expect(brief.locator('#brief-wm')).toContainText('World Monitor: live, fetched');
  mkdirSync(EVIDENCE, { recursive: true });
  await brief.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w3-live-risk.png') });
  // Not connected: the meta says what to set.
  await stubApi(page, { '/api/countries/VE/brief': (u, r) => json(r, { ...BRIEF, world_monitor: { status: 'not_connected', reason: 'not connected (set WORLD_MONITOR_API_KEY on the Vault service)', fetched_at: null, notes: [] } }) });
  await page.locator('#country-brief-btn').click();
  await expect(brief.locator('#brief-wm')).toHaveAttribute('data-status', 'not_connected');
  await expect(brief.locator('#brief-wm')).toContainText('World Monitor: not connected (set WORLD_MONITOR_API_KEY on the Vault service)');
});
