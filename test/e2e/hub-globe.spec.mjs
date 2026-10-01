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
  attention: { stale: 0, filing: 0, expiring_days: null }, ...extra,
});
const COUNTRIES = {
  countries: [
    { code: 'EG', name: { en: 'Egypt', es: 'Egipto' }, projects: [proj('egy-onshore', 'Egypt Onshore Gas Hub', { client_id: 'frontera', client_name: 'Frontera Energy', lat: 30.5, lon: 30.2, stage: 'Negotiation', attention: { stale: 0, filing: 0, expiring_days: 12 } })], counts: { projects: 1, stale: 0, filing: 0, expiring: 1 } },
    { code: 'KZ', name: { en: 'Kazakhstan', es: 'Kazajistán' }, projects: [proj('kaz-brownfield', 'Western Kazakhstan Brownfield', { lat: 47.1, lon: 51.9, last_run_at: '2026-09-28T14:12:00.000Z' })], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 } },
    { code: 'VE', name: { en: 'Venezuela', es: 'Venezuela' }, projects: [
      proj('ven-barinas', 'Barinas–Apure Cluster', { lat: 8.1, lon: -69.3, stage: 'Technical review', status: 'active', attention: { stale: 2, filing: 1, expiring_days: null } }),
      proj('ven-maracaibo', 'Lake Maracaibo Redevelopment', { lat: 10.4, lon: -71.6 }),
    ], counts: { projects: 2, stale: 2, filing: 1, expiring: 0 } },
  ],
  unplaced: [proj('plain-project', 'Plain internal project', { status: 'active', stage: 'Initial screen' })],
  generated_at: '2026-10-01T08:00:00.000Z',
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
