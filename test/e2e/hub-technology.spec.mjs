// M19: the technology register page (hub/technology.html).
// The API is stubbed with page.route from responses captured from the real API on the committed seed
// (test/e2e/fixtures/technology-register.json); the static server serves the page.
// Evidence: docs/vault-hub/evidence/m19-technology.png, m19-technology-match.png
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const F = JSON.parse(readFileSync(path.join(ROOT, 'test/e2e/fixtures/technology-register.json'), 'utf8'));
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stub(page) {
  const calls = [];
  await page.route(/unpkg\.com|openfreemap|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()), m = route.request().method();
    calls.push({ method: m, path: url.pathname, q: Object.fromEntries(url.searchParams), body: route.request().postData() });
    const p = url.pathname;
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/technology/applications') return json(route, F.applications);
    if (p === '/api/technology') return json(route, url.searchParams.get('status') === 'proposed' ? F.proposals : F.register);
    if (p === `/api/technology/${F.detail.id}`) return json(route, F.detail);
    if (/^\/api\/technology\/[0-9a-f-]{36}\/(confirm|reject)$/.test(p)) return json(route, { status: 'confirmed' });
    if (p === '/api/projects') return json(route, F.projects);
    if (p === '/api/projects/lagunillas-lake/technology/conditions') return m === 'POST' ? json(route, { project_id: 'lagunillas-lake' }, 201) : json(route, F.conditions);
    if (p === '/api/projects/lagunillas-lake/technology/match') return json(route, F.match);
    if (p === '/api/projects/lagunillas-lake/technology/suggestions') return json(route, { status: 'dismissed' }, 201);
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('the register lists confirmed entries ranked, re-ranks on weights and opens an entry', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/hub/technology.html?application=artificial-lift');
  await ready(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('h1')).toHaveText('Field technologies, ranked');
  const rows = page.locator('#tr-table tbody tr');
  await expect(rows).toHaveCount(F.register.count);
  await expect(rows.first()).toHaveAttribute('data-key', F.register.entries.find((e) => e.rank === 1).key);
  await expect(page.locator('.tr-chip[data-app="artificial-lift"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#n-proposals')).toHaveText(String(F.proposals.count));
  // weights travel to the API as w=
  await page.locator('#w-citation').fill('0');
  await expect.poll(() => calls.some((c) => c.path === '/api/technology' && c.q.w === '0.00,0.35,0.20,0.25')).toBe(true);
  // a row opens its evidence, providers and history
  await page.locator(`#tr-table tbody tr[data-key="${F.detail.key}"]`).click();
  const d = page.locator(`[data-detail="${F.detail.key}"]`);
  await expect(d).toBeVisible();
  await expect(d.locator('.tr-ev li').first()).toContainText(F.detail.record.evidence[0].tier);
  await expect(d.locator('h4').first()).toContainText(F.detail.name);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'm19-technology.png'), fullPage: true });
  const a11y = await new AxeBuilder({ page }).include('#main').withTags(['wcag2a', 'wcag2aa']).disableRules(['color-contrast']).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
});

test('project match screens the register, saves conditions and records a decision', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/hub/technology.html?project=lagunillas-lake&application=artificial-lift');
  await ready(page);
  await expect(page.locator('#tab-match')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#m-project')).toHaveValue('lagunillas-lake');
  await expect(page.locator('#c-depth_m')).toHaveValue('2500');
  const shown = F.match.entries.filter((e) => e.screen.verdict !== 'fail');
  await expect(page.locator('#tm-table tbody tr')).toHaveCount(shown.length);
  await page.locator('#m-failed').check();
  await expect(page.locator('#tm-table tbody tr')).toHaveCount(F.match.entries.length);
  await expect(page.locator('#tm-table tbody tr[data-verdict="fail"]').first()).toContainText(/exceeds|tolerates|not deployed/);
  const shortlisted = F.match.entries.find((e) => e.suggestion);
  await expect(page.locator(`#tm-table tr[data-key="${shortlisted.key}"] select`)).toHaveValue(shortlisted.suggestion.status);
  // save conditions
  await page.locator('#c-api').fill('22');
  await page.locator('#m-save').click();
  await expect.poll(() => calls.find((c) => c.method === 'POST' && c.path.endsWith('/conditions'))?.body).toContain('"api":22');
  // a decision posts the key and status
  const first = F.match.entries.find((e) => e.screen.verdict === 'pass');
  await page.locator(`#tm-table tr[data-key="${first.key}"] select`).selectOption('dismissed');
  await expect.poll(() => calls.find((c) => c.method === 'POST' && c.path.endsWith('/suggestions'))?.body).toContain(`"key":"${first.key}"`);
  await page.screenshot({ path: path.join(EVIDENCE, 'm19-technology-match.png'), fullPage: true });
});

test('proposals: a partner sees confirm and reject on a proposal', async ({ page }) => {
  await stub(page);
  await page.goto('/hub/technology.html?tab=proposals');
  await ready(page);
  await expect(page.locator('#pane-proposals')).toBeVisible();
  await expect(page.locator('#prop-wrap tbody tr')).toHaveCount(F.proposals.count);
});
