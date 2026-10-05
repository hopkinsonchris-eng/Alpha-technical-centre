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
  const calls = { search: [] };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname;
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
    if (p === '/api/organisations') { const q = (u.searchParams.get('q') || '').toLowerCase(); return json(route, { organisations: ORGS.filter((o) => !q || o.name.toLowerCase().includes(q) || o.id.includes(q)) }); }
    if (p === '/api/search') { calls.search.push(u.search); const q = (u.searchParams.get('q') || '').toLowerCase(); return json(route, { hits: HITS.filter((h) => h.title.toLowerCase().includes(q)).slice(0, Number(u.searchParams.get('limit') || 5)), scope: u.searchParams.get('scope'), took_ms: 2 }); }
    if (p === '/api/health') return json(route, { ok: true });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ORGS = [{ id: 'tennor', name: 'Tennor Holding', kind: 'client' }, { id: 'cubiro-services', name: 'Cubiro Services SAS', kind: 'vendor' }];
const HITS = [
  { ref: 'run:00000000-0000-4000-8000-000000000401', run_id: '00000000-0000-4000-8000-000000000401', item_id: null, project_id: 'ven-barinas', title: 'Cubiro-1 ESP nodal', type: 'run', score: 0.9, snippet: '' },
  { ref: 'doc:00000000-0000-4000-8000-000000000301', run_id: null, item_id: '00000000-0000-4000-8000-000000000301', project_id: 'kaz-brownfield', title: 'Cubiro screening letter', type: 'letter', score: 0.8, snippet: '' },
];
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
  // A country goes to the globe with the country selected; a page goes to the page. Wave 7 (R7): the Vault's own
  // project in Venezuela outranks the country the Vault does not hold.
  await page.locator('#palette-btn').click();
  await pal.locator('input').fill('venez');
  await expect(pal.locator('[data-item]').first()).toContainText('Barinas–Apure Cluster');
  await expect(pal.locator('[data-group="countries"] [data-item]').first()).toContainText('Venezuela');
  await expect(pal.locator('[data-group="countries"] [data-item]').first()).toHaveAttribute('data-href', '/hub/index.html?country=VE');
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

/* ── wave 7 PR2 (R7): the palette searches the Vault ─────────────────── */

test('R7: a held country matches on word start only and never outranks a record; a Records group comes from /api/search after the third character, debounced; Contacts and Organisations from /api/organisations', async ({ page }) => {
  const calls = await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  const pal = page.locator('#palette');
  const input = pal.locator('input');
  // Two letters: no Vault call yet.
  await input.fill('cu');
  await page.waitForTimeout(250);
  expect(calls.search).toEqual([]);
  // Three letters, typed quickly: one call, 150 ms after the last keystroke.
  await input.fill('cub');
  await input.fill('cubi');
  await expect.poll(() => calls.search.length).toBe(1);
  await page.waitForTimeout(300);
  expect(calls.search.length).toBe(1);
  expect(calls.search[0]).toBe('?q=cubi&scope=firm&limit=5');
  const groups = await groupsOf(page);
  expect(groups.indexOf('records')).toBeGreaterThanOrEqual(0);
  const rec = pal.locator('[data-group="records"] [data-item]');
  await expect(rec).toHaveCount(2);
  await expect(rec.nth(0)).toContainText('Cubiro-1 ESP nodal');
  await expect(rec.nth(0).locator('.s')).toContainText('run');
  await expect(rec.nth(1)).toContainText('Cubiro screening letter');
  await expect(rec.nth(1).locator('.s')).toContainText('letter');
  await expect(rec.nth(1)).toHaveAttribute('data-href', '/hub/project.html?id=kaz-brownfield&doc=00000000-0000-4000-8000-000000000301');
  await expect(rec.nth(0)).toHaveAttribute('data-href', '/hub/project.html?id=ven-barinas&run=00000000-0000-4000-8000-000000000401');
  // Cuba is a country the Vault does not hold: it never sits above a record.
  const items = pal.locator('[data-item]');
  await expect(items.first()).toContainText('Cubiro-1 ESP nodal');
  const groupOrder = await pal.locator('[data-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  if (groupOrder.includes('countries')) expect(groupOrder.indexOf('records')).toBeLessThan(groupOrder.indexOf('countries'));
  // Organisations from the Vault, not from a local list.
  const orgs = pal.locator('[data-group="organisations"] [data-item]');
  await expect(orgs).toHaveCount(1);
  await expect(orgs.first()).toContainText('Cubiro Services SAS');
  await expect(orgs.first()).toHaveAttribute('data-href', '/hub/search.html?q=Cubiro%20Services%20SAS&scope=firm');
  // Enter on the record goes to the project file with the record open.
  await page.keyboard.press('Enter');
  await page.waitForURL(/project\.html\?id=ven-barinas&run=00000000-0000-4000-8000-000000000401$/);
});

test('R7: word start only. "zuela" finds no country, "venez" does; a held country still ranks after a record; the Records group is absent without a query', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page);
  await page.keyboard.press('ControlOrMeta+k');
  const pal = page.locator('#palette');
  expect(await groupsOf(page)).toEqual(['projects', 'countries', 'tools', 'pages']);   // no Records, no Organisations until typed
  await pal.locator('input').fill('zuela');
  await page.waitForTimeout(250);
  await expect(pal.locator('[data-group="countries"] [data-item]')).toHaveCount(0);
  await pal.locator('input').fill('venez');
  await expect(pal.locator('[data-group="countries"] [data-item]').first()).toContainText('Venezuela');
  await pal.locator('input').fill('kaz');
  await expect(pal.locator('[data-item]').first()).toContainText('Western Kazakhstan Brownfield');
  await expect(pal.locator('[data-group="countries"] [data-item]')).toContainText('Kazakhstan');
  // A country the Vault holds (KZ) matches on its name's word start; "stan" alone is not a word start.
  await pal.locator('input').fill('stan');
  await page.waitForTimeout(250);
  await expect(pal.locator('[data-group="countries"] [data-item]')).toHaveCount(0);
  // The Tools index is reachable from the palette (R4).
  await pal.locator('input').fill('tools');
  await expect(pal.locator('[data-group="pages"] [data-item]').first()).toContainText('Tools');
  await expect(pal.locator('[data-group="pages"] [data-item]').first()).toHaveAttribute('data-href', '/hub/tool.html');
});
