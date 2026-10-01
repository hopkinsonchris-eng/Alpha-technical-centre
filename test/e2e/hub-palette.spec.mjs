// Wave 2, PR 3 (docs/vault-hub/wave2/05-markup.md §1.5): the command menu. Cmd/Ctrl+K (or the
// header button) on every Hub page; projects, countries, tools and pages; on a project page the
// first group offers that project's tools. AC15. The API is stubbed with page.route.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const PROJECTS = { projects: [
  { id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', status: 'prospect', client_id: null, country: 'KZ', stage: 'Qualified', register: {}, stage_history: [], members: ['chris'], contacts: [], default_legal_tag: 'lt-firm', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'ven-barinas', name: 'Barinas–Apure Cluster', status: 'active', client_id: 'tennor', country: 'VE', stage: 'Technical review', register: {}, stage_history: [], members: ['chris'], contacts: [], default_legal_tag: 'lt-firm', created_at: '2026-09-01T00:00:00.000Z' },
] };
const tool = (id, name, lifecycle, entry, hub) => ({ id, name, owner: 'chris', lifecycle, kind: 'browser-tool', entry, versions: [{ version: '1.0.0', released_at: '2026-09-01', commit: 'abc1234' }], aliases: { current: '1.0.0' }, releases: [], hub });
const CATALOG = { tools: [
  tool('opportunity-register', 'Opportunity Register', 'production', 'opportunity-register.html', { context: ['project'], param: 'project', toolbar: 10, live_version: null }),
  tool('nodal-analysis', 'Nodal Analysis', 'production', 'nodal-analysis-tool.html', { context: ['project'], param: 'project', toolbar: 20, live_version: null }),
  tool('situation-room', 'Situation Room', 'experimental', 'situation-room/index.html', null),
], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
const COUNTRIES = { countries: [
  { code: 'KZ', name: { en: 'Kazakhstan', es: 'Kazajistán' }, projects: [{ id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', status: 'prospect', stage: 'Qualified', client_id: null, client_name: null, lat: 47.1, lon: 51.9, last_run_at: null, attention: { stale: 0, filing: 0, expiring_days: null } }], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 } },
], unplaced: [], generated_at: '2026-10-01T08:00:00.000Z' };
const PROJECT = { ...PROJECTS.projects[0], lat: 47.1, lon: 51.9, asset_ids: [], closed_at: null };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page) {
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects') return json(route, PROJECTS);
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (p === '/api/projects/kaz-brownfield') return json(route, PROJECT);
    if (p === '/api/projects/kaz-brownfield/timeline') return json(route, { project_id: 'kaz-brownfield', count: 0, entries: [] });
    if (p === '/api/projects/kaz-brownfield/vintages') return json(route, { project_id: 'kaz-brownfield', vintages: [] });
    if (p === '/api/projects/kaz-brownfield/lineage') return json(route, { project_id: 'kaz-brownfield', nodes: [], edges: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/organisations') return json(route, { organisations: [{ id: 'tennor', name: 'Tennor Holding' }] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const groupsOf = (page) => page.locator('#palette [data-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));

test('AC15: Cmd/Ctrl+K opens the menu on the Today page; three letters of a project and Enter open it; Escape closes', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#palette-btn')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const pal = page.locator('#palette');
  await expect(pal).toBeVisible();
  await expect(pal.locator('input')).toBeFocused();
  // Empty query: every group in order, projects first.
  expect(await groupsOf(page)).toEqual(['projects', 'countries', 'tools', 'pages']);
  await expect(pal.locator('[data-group="tools"] [data-item]')).toHaveCount(2);          // production only
  await pal.locator('input').fill('kaz');
  const items = pal.locator('[data-item]');
  await expect(items.first()).toContainText('Western Kazakhstan Brownfield');
  await expect(items.first()).toHaveAttribute('aria-selected', 'true');
  await expect(pal.locator('[data-group="countries"] [data-item]')).toContainText('Kazakhstan');
  await page.keyboard.press('Enter');
  await page.waitForURL(/project\.html\?id=kaz-brownfield$/);
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(pal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pal).toBeHidden();
});

test('AC15: on a project page the first group offers the project tools and actions; arrows move the selection', async ({ page, baseURL }) => {
  await stubApi(page);
  await page.goto('/hub/project.html?id=kaz-brownfield');
  await ready(page);
  await page.locator('#palette-btn').click();
  const pal = page.locator('#palette');
  await expect(pal).toBeVisible();
  expect(await groupsOf(page)).toEqual(['context', 'projects', 'countries', 'tools', 'pages']);
  const ctx = pal.locator('[data-group="context"] [data-item]');
  await expect(ctx).toHaveCount(4);
  await expect(ctx.nth(0)).toContainText('Open Opportunity Register in this project');
  await expect(ctx.nth(0)).toHaveAttribute('data-href', new URL('opportunity-register.html?project=kaz-brownfield', baseURL + '/').href);
  await expect(ctx.nth(1)).toContainText('Open Nodal Analysis in this project');
  await expect(ctx.nth(2)).toContainText('Add documents');
  await expect(ctx.nth(3)).toContainText('Change stage');
  await page.keyboard.press('ArrowDown');
  await expect(ctx.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await expect(ctx.nth(0)).toHaveAttribute('aria-selected', 'true');     // stays at the top
  await pal.locator('input').fill('stage');
  await expect(pal.locator('[data-item]').first()).toContainText('Change stage');
  await page.keyboard.press('Enter');
  await expect(pal).toBeHidden();
  await expect(page.locator('#p-stage')).toBeFocused();
  // A country goes to the globe with the country selected; a page goes to the page.
  await page.locator('#palette-btn').click();
  await pal.locator('input').fill('venez');
  await expect(pal.locator('[data-item]').first()).toContainText('Venezuela');
  await expect(pal.locator('[data-item]').first()).toHaveAttribute('data-href', 'index.html?country=VE');
  await pal.locator('input').fill('settin');
  await expect(pal.locator('[data-item]').first()).toContainText('Settings');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w2-palette.png') });
  // No match says so.
  await pal.locator('input').fill('zzzz');
  await expect(pal.locator('#palette-empty')).toContainText('Nothing matches');
});

test('AC15: the menu is bilingual and present on every Hub page', async ({ page }) => {
  await stubApi(page);
  for (const p of ['search.html', 'queue.html', 'analogues.html', 'cost.html', 'settings.html', 'tool.html?id=nodal-analysis']) {
    await page.goto('/hub/' + p);
    await expect(page.locator('#palette-btn'), p).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('#palette'), p).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.goto('/hub/index.html');
  await ready(page);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('#palette input')).toHaveAttribute('placeholder', /Escriba/);
  await expect(page.locator('#palette [data-group="pages"] h4')).toHaveText('Páginas');
});
