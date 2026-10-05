// Wave 2, PR 3 (docs/vault-hub/wave2/05-markup.md §1.2): the project file carries a toolbar of
// the tools that accept a project, each opening inside this one; the stage is changed in place
// with its history on the timeline; the opportunity card shows and edits the register fields.
// AC9 and AC10. The API is stubbed with page.route.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const PID = 'kaz-brownfield';

const PROJECT = {
  id: PID, client_id: null, name: 'Western Kazakhstan Brownfield', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'],
  created_at: '2026-09-01T09:00:00.000Z', closed_at: null, contacts: [], country: 'KZ', lat: 47.1, lon: 51.9, stage: 'Qualified',
  stage_history: [{ stage: 'Initial screen', at: '2026-09-01T09:00:00.000Z', by: 'chris' }, { stage: 'Qualified', at: '2026-09-19T12:00:00.000Z', by: 'tom' }],
  register: { source: 'Intermediary', current: 16, plan: 22, risk: 'amber', risk_score: 54, attractiveness: 76, owner: 'Tom', thesis: 'Producing onshore asset where waterflood optimisation may close a material gap.', next: 'Validate ownership and sale status', holder: 'KazMunayGas', government: 'Ministry of Energy', licence_type: 'psc', partners: ['Chevron', 'Lukoil'] },
};
const tool = (id, name, lifecycle, kind, entry, hub) => ({
  id, name, owner: 'chris', lifecycle, kind, entry, versions: [{ version: '1.0.0', released_at: '2026-09-01', commit: 'abc1234' }], aliases: { current: '1.0.0' }, releases: [], hub,
});
const CATALOG = { tools: [
  tool('plan-your-job', 'Plan Your Job', 'production', 'browser-tool', 'plan-your-job.html', { context: ['project'], param: 'project', toolbar: 60, live_version: null }),
  tool('opportunity-register', 'Opportunity Register', 'production', 'browser-tool', 'opportunity-register.html', { context: ['project'], param: 'project', toolbar: 10, live_version: null }),
  tool('insight-radar', 'Insight Radar', 'production', 'skill', '.claude/skills/insight-radar/SKILL.md', null),                                 // no sidecar: not in the toolbar
  tool('situation-room', 'Situation Room', 'experimental', 'browser-tool', 'situation-room/index.html', { context: ['project'], param: 'project', toolbar: 5, live_version: null }),   // experimental: not in the toolbar
  tool('apex-asset-intelligence', 'APEX Asset Intelligence', 'production', 'external-app', 'https://apex-app2.onrender.com', { context: ['project'], param: 'project', toolbar: 90, version_url: 'https://apex-app2.onrender.com/version.json', live_version: null }),
  tool('nodal-analysis', 'Nodal Analysis', 'production', 'browser-tool', 'nodal-analysis-tool.html', { context: ['project'], param: 'project', toolbar: 20, live_version: null }),
  tool('cost-report', 'Cost report', 'production', 'browser-tool', 'cost.html', { context: ['country'], live_version: null }),                 // takes a country, not a project
], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
const TIMELINE = [
  { kind: 'run', ref: 'run:00000000-0000-4000-8000-000000000401', id: '00000000-0000-4000-8000-000000000401', at: '2026-09-28T14:12:00.000Z', title: 'Waterflood screen, base case', job: 'opportunity-register', tool_version: '2.2.0', status: 'final', legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null, superseded_by: null },
];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, { patch } = {}) {
  const patched = [];
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) {
      if (route.request().method() === 'PATCH') {
        const b = JSON.parse(route.request().postData()); patched.push(b);
        if (patch) return patch(route, b);
        const merged = { ...PROJECT, ...b, register: { ...PROJECT.register, ...(b.register || {}) } };
        if (b.stage && b.stage !== PROJECT.stage) merged.stage_history = [...PROJECT.stage_history, { stage: b.stage, at: '2026-10-01T09:30:00.000Z', by: 'chris' }];
        return json(route, merged);
      }
      return json(route, PROJECT);
    }
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length, entries: TIMELINE });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/projects') return json(route, { projects: [PROJECT] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return patched;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('AC9 / R1: "Open in tool ▾" lists the production tools that take a project, the ones that produced this project\'s runs first, then toolbar order, each opening inside this project', async ({ page, baseURL }) => {
  await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('#p-openin-menu')).toBeHidden();
  await page.locator('#p-openin').click();
  await expect(page.locator('#p-openin-menu')).toBeVisible();
  const links = page.locator('#p-toolbar a[data-toolbar-tool]');
  await expect(links).toHaveCount(4);
  expect(await links.evaluateAll((els) => els.map((e) => e.getAttribute('data-toolbar-tool')))).toEqual(['opportunity-register', 'nodal-analysis', 'plan-your-job', 'apex-asset-intelligence']);
  await expect(links.nth(0)).toHaveAttribute('data-produced', '1');            // the run on the timeline came from it
  await expect(links.nth(1)).toHaveAttribute('data-produced', '0');
  await expect(links.nth(0)).toHaveAttribute('href', new URL('opportunity-register.html?project=' + PID, baseURL + '/').href);
  await expect(links.nth(1)).toHaveAttribute('href', new URL('nodal-analysis-tool.html?project=' + PID, baseURL + '/').href);
  await expect(links.nth(0)).not.toHaveAttribute('target', /.+/);
  // Wave 7 (S28): an external app does not read ?project=, so it opens as itself.
  await expect(links.nth(3)).toHaveAttribute('href', 'https://apex-app2.onrender.com/');
  await expect(links.nth(3)).toHaveAttribute('data-external', '1');
  await expect(links.nth(3)).toHaveAttribute('target', '_blank');
  await expect(links.nth(3)).toHaveAttribute('rel', /noopener/);
  await expect(links.nth(0)).toContainText('Opportunity Register');
  await expect(page.locator('#p-openin-menu')).toContainText('opens as itself');
  await page.keyboard.press('Escape');
  await expect(page.locator('#p-openin-menu')).toBeHidden();
  await expect(page.locator('#p-openin')).toBeFocused();
  // The header shows the country and stage.
  await expect(page.locator('#p-sub')).toContainText('Kazakhstan');
  await expect(page.locator('#p-stage')).toHaveValue('Qualified');
});

test('W7-AC3: Opportunity Register and APEX Reservoir 3D open from the toolbar with ?project= intact and no login wall', async ({ page }) => {
  await stubApi(page);
  const cat = JSON.parse(JSON.stringify(CATALOG));
  cat.tools.push(tool('apex-reservoir-3d', 'APEX Reservoir 3D', 'production', 'browser-tool', 'reservoir-simulator.html', { context: ['project'], param: 'project', toolbar: 40, live_version: null }));
  await page.route('**/api/catalog', (route) => json(route, cat));
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  for (const [id, file] of [['opportunity-register', 'opportunity-register.html'], ['apex-reservoir-3d', 'reservoir-simulator.html']]) {
    await page.goto('/hub/project.html?id=' + PID);
    await ready(page);
    await page.locator('#p-openin').click();
    await page.locator(`#p-toolbar a[data-toolbar-tool="${id}"]`).click();
    await page.waitForURL(new RegExp(file.replace('.', '\\.') + '\\?project=' + PID + '$'));
    expect(page.url(), id).not.toMatch(/admin\.html/);
    await expect(page.locator('html'), id + ' is not hidden by the legacy gate').not.toHaveAttribute('style', /display:\s*none/);
    expect(await page.evaluate(() => sessionStorage.getItem('atc_auth')), id).toBe('1');
  }
});

test('AC10: changing the stage patches the project, updates the header and puts the change on the timeline', async ({ page }) => {
  const patched = await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  // Stage history already on the timeline, newest first with the runs.
  const stages = page.locator('.hub-tl-item[data-kind="stage"]');
  await expect(stages).toHaveCount(2);
  await expect(stages.first()).toContainText('Qualified');
  await expect(stages.first()).toContainText('tom');
  await page.locator('#p-stage').selectOption('Technical review');
  await expect.poll(() => patched.length).toBe(1);
  expect(patched[0]).toEqual({ stage: 'Technical review' });
  await expect(page.locator('#p-stage')).toHaveValue('Technical review');
  await expect(page.locator('.hub-tl-item[data-kind="stage"]')).toHaveCount(3);
  await expect(page.locator('.hub-tl-item[data-kind="stage"]').first()).toContainText('Technical review');
  await expect(page.locator('.hub-tl-item[data-kind="stage"]').first()).toContainText('from Qualified');
  await expect(page.locator('#p-notices .hub-notice.ok')).toContainText('Stage is now Technical review');
});

test('AC10: an associate who may not change the stage gets the refusal as a readable notice and the select returns', async ({ page }) => {
  await stubApi(page, { patch: (route) => json(route, { error: { code: 'forbidden', message: 'you are not a member of project "kaz-brownfield"' } }, 403) });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator('#p-stage').selectOption('Negotiation');
  await expect(page.locator('#p-notices .hub-notice.bad')).toContainText('you are not a member of project');
  await expect(page.locator('#p-stage')).toHaveValue('Qualified');
});

test('AC10 / R6: the opportunity card sits inside the File disclosure, shows the register fields and edits them in place', async ({ page }) => {
  const patched = await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const card = page.locator('#p-opportunity');
  await expect(card).toBeHidden();                       // the File disclosure is closed until asked for
  await page.locator('#p-file-wrap > summary').click();
  await expect(card).toBeVisible();
  await expect(card.locator('[data-opp="plan"]')).toHaveText('16 → 22 kboe/d');
  await expect(card.locator('[data-opp="risk"]')).toContainText('Elevated 54');
  await expect(card.locator('[data-opp="owner"]')).toHaveText('Tom');
  await expect(card.locator('[data-opp="source"]')).toHaveText('Intermediary');
  await expect(card.locator('[data-opp="thesis"]')).toContainText('waterflood optimisation');
  await expect(card.locator('[data-opp="next"]')).toContainText('Validate ownership');
  await expect(card.locator('[data-opp="where"]')).toContainText('Kazakhstan · 47.1, 51.9');
  // W4-AC14: the counterparties, and the firm's lead labelled as such.
  await expect(card.locator('[data-opp="holder"]')).toHaveText('KazMunayGas');
  await expect(card.locator('[data-opp="government"]')).toHaveText('Ministry of Energy');
  await expect(card.locator('[data-opp="licence"]')).toHaveText('Production sharing');
  await expect(card.locator('[data-opp="partners"]')).toHaveText('Chevron, Lukoil');
  await expect(card).toContainText('Lead at the firm');
  await card.getByRole('button', { name: 'Edit' }).click();
  const form = card.locator('form');
  await expect(form).toBeVisible();
  await expect(form.locator('#op-current')).toHaveValue('16');
  await form.locator('#op-plan').fill('25');
  await form.locator('#op-risk').selectOption('red');
  await form.locator('#op-next').fill('Request the data room index');
  await form.locator('#op-lat').fill('47.2');
  await expect(form.locator('#op-holder')).toHaveValue('KazMunayGas');
  await form.locator('#op-government').fill('');
  await form.locator('#op-licence').selectOption('jv');
  await form.locator('#op-licence-note').fill('Empresa mixta, 60/40');
  await form.locator('#op-partners').fill('Chevron, Lukoil; Eni');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => patched.length).toBe(1);
  expect(patched[0]).toEqual({ country: 'KZ', lat: 47.2, lon: 51.9, register: { source: 'Intermediary', current: 16, plan: 25, risk: 'red', risk_score: 54, attractiveness: 76, owner: 'Tom', thesis: PROJECT.register.thesis, next: 'Request the data room index',
    holder: 'KazMunayGas', government: null, licence_type: 'jv', licence_note: 'Empresa mixta, 60/40', partners: ['Chevron', 'Lukoil', 'Eni'] } });
  await expect(card.locator('[data-opp="plan"]')).toHaveText('16 → 25 kboe/d');
  await expect(card.locator('[data-opp="government"]')).toHaveText('—');
  await expect(card.locator('[data-opp="licence"]')).toHaveText('Joint venture / empresa mixta · Empresa mixta, 60/40');
  await expect(card.locator('[data-opp="partners"]')).toHaveText('Chevron, Lukoil, Eni');
  await expect(card.locator('[data-opp="risk"]')).toContainText('High 54');
  await expect(form).toBeHidden();
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w2-project-toolbar.png') });
});

test('AC9: with no catalog the toolbar says so instead of vanishing; Spanish follows', async ({ page }) => {
  await stubApi(page);
  await page.route('**/api/catalog', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.route('**/hub/catalog.json', (route) => route.fulfill({ status: 500, body: '{}' }));   // and the static fallback
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator('#p-openin').click();
  await expect(page.locator('#p-openin-menu')).toContainText('The tool catalog is not available');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#p-openin-menu')).toContainText('El catálogo de herramientas no está disponible');
  await expect(page.locator('#p-openin')).toContainText('Abrir en herramienta');
  await expect(page.locator('#p-opportunity h3')).toHaveText('Oportunidad');
});
