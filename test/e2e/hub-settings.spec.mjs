// Wave 5, PR 4 (docs/vault-hub/wave5/05-markup.md §1.4, W5-AC14): the Connected apps card on Settings lists the
// apps connected through the Vault's OAuth and revokes one. The API is stubbed.
import { test, expect } from '@playwright/test';

const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('W5-AC14: Connected apps lists the live connections with client, host and dates; Revoke removes one; none left says how to connect', async ({ page }) => {
  let connections = [
    { id: '11111111-1111-4111-8111-111111111111', client: 'Claude', host: null, first_used: '2026-10-03T09:00:00.000Z', last_used: '2026-10-03T11:30:00.000Z', revoked: false, expires_at: '2026-11-02T09:00:00.000Z' },
    { id: '22222222-2222-4222-8222-222222222222', client: 'Claude Code', host: 'claude.ai', first_used: '2026-10-02T09:00:00.000Z', last_used: '2026-10-02T09:05:00.000Z', revoked: false, expires_at: null },
    { id: '33333333-3333-4333-8333-333333333333', client: 'Old', host: null, first_used: '2026-09-01T09:00:00.000Z', last_used: '2026-09-01T09:00:00.000Z', revoked: true, expires_at: null },
  ];
  const revoked = [];
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname, m = route.request().method();
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/me/connections' && m === 'GET') return json(route, { connections });
    const d = /^\/api\/me\/connections\/([^/]+)$/.exec(p);
    if (d && m === 'DELETE') { revoked.push(d[1]); connections = connections.filter((c) => c.id !== d[1]); return json(route, { id: d[1], revoked: true }); }
    if (p === '/api/settings/day-rates') return json(route, { error: { code: 'not_found', message: 'nothing saved' } }, 404);
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  await page.goto('/hub/settings.html');
  const list = page.locator('#connections-list .hub-connection');
  await expect(list).toHaveCount(2, { timeout: 10000 });
  await expect(list.nth(0)).toContainText('Claude · connected 3 Oct 2026 · last used 3 Oct 2026');
  await expect(list.nth(1)).toContainText('Claude Code · claude.ai');
  await expect(page.locator('#connections-empty')).toBeHidden();
  await list.nth(1).locator('[data-revoke]').click();
  await expect.poll(() => revoked.length).toBe(1);
  expect(revoked[0]).toBe('22222222-2222-4222-8222-222222222222');
  await expect(list).toHaveCount(1);
  await list.nth(0).locator('[data-revoke]').click();
  await expect(page.locator('#connections-empty')).toBeVisible();
  await expect(page.locator('#connections-empty')).toContainText('Add custom connector, URL https://www.alpha-technical-centre.com/mcp');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#h-connections')).toHaveText('Aplicaciones conectadas');
});

/* ── Wave 7 PR2 (R9, R8, W7-AC9): Settings is Settings ───────────────────────────────────────────────── */

const DAY_RATES = { key: 'day-rates', value: { rates: { Principal: 13500, Senior: 11000, 'Mid-level': 8000, Junior: 5500 }, swMult: 100, miscMult: 100, dataMult: 100, margin: 0, partners: [{ code: 'MP', name: 'Chris Hopkinson', role: 'Managing Partner', level: 'Principal' }, { code: 'RE', name: 'Anton Agafonov', role: 'Reservoir Engineer', level: 'Senior' }] }, updated_by: null, updated_at: null, defaults: true };

/** The Settings page seeded the way hub-health seeds it: a partner, defaults for the rates, no mailbox capture, no apps. */
async function seedSettings(page, { me = PARTNER, mailbox = { prompt: false, connected: false, configured: false } } = {}) {
  const log = { puts: [] };
  await page.route('**/api/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname, m = req.method();
    if (p === '/api/me') return json(route, me);
    if (p === '/api/me/connections') return json(route, { connections: [] });
    if (p === '/api/me/mailbox') return json(route, mailbox);
    if (p === '/api/settings/day-rates') {
      if (m === 'PUT') { const b = JSON.parse(req.postData()); log.puts.push(b); return json(route, { ...DAY_RATES, value: b.value, defaults: undefined }); }
      if (m === 'DELETE') return json(route, { deleted: true });
      return json(route, DAY_RATES);
    }
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return log;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const JARGON = /SETUP\.md|_KEY\b|\bAC\d+\b|\bM\d\d\b|\.json\b|\.md\b/;

test('R9: headed Settings, You (mailbox, apps, language) before Firm (rates, components, partners); the mailbox button is hidden, not disabled', async ({ page }) => {
  await seedSettings(page);
  await page.goto('/hub/settings.html');
  await ready(page);
  await expect(page.locator('h1')).toHaveText('Settings');
  await expect(page.locator('h1')).toHaveCount(1);
  // The order of the sections and of the cards inside them, as read down the page.
  const heads = await page.locator('main h2, main h3').evaluateAll((els) => els.filter((e) => !e.closest('[hidden]')).map((e) => e.textContent.trim()));
  const idx = (t) => heads.findIndex((h) => h.startsWith(t));
  for (const t of ['You', 'Your mailbox', 'Connected apps', 'Language', 'Firm', 'Weekly labour rates', 'Cost components', 'Partner assignment']) expect(idx(t), t + ' in ' + heads.join(' | ')).toBeGreaterThanOrEqual(0);
  expect(idx('You')).toBeLessThan(idx('Your mailbox'));
  expect(idx('Your mailbox')).toBeLessThan(idx('Connected apps'));
  expect(idx('Connected apps')).toBeLessThan(idx('Language'));
  expect(idx('Language')).toBeLessThan(idx('Firm'));
  expect(idx('Firm')).toBeLessThan(idx('Weekly labour rates'));
  expect(idx('Weekly labour rates')).toBeLessThan(idx('Cost components'));
  expect(idx('Cost components')).toBeLessThan(idx('Partner assignment'));
  const youBox = await page.locator('#sec-you').boundingBox(), firmBox = await page.locator('#sec-firm').boundingBox();
  expect(youBox.y).toBeLessThan(firmBox.y);
  // Mail capture off: the sentence in user language and no button at all.
  await expect(page.locator('#mailbox-off-text')).toHaveText('Mail capture is not switched on for this Vault yet. Ask Chris.');
  await expect(page.locator('#mailbox-connect')).toBeHidden();
  // Language is a 36 px segmented control wired to the same toggle as the sidebar.
  const seg = page.locator('#sec-language .hub-lang-seg');
  await expect(seg.locator('button')).toHaveCount(2);
  for (const b of await seg.locator('button').all()) { const box = await b.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(36); expect(box.width).toBeGreaterThanOrEqual(44); }
  await seg.locator('button[data-lang="es"]').click();
  await expect(page.locator('h1')).toHaveText('Ajustes');
  await expect(page.locator('aside .nav-lang button[data-lang="es"]')).toHaveClass(/active/);
  await seg.locator('button[data-lang="en"]').click();
  await expect(page.locator('h1')).toHaveText('Settings');
  // Partner assignment scrolls inside its wrap with a sticky first column; nothing is clipped at phone width.
  const wrap = page.locator('#sec-firm .hub-table-wrap').filter({ has: page.locator('.hub-partners') });
  await expect(wrap).toHaveCount(1);
  expect(await wrap.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  expect(await wrap.locator('tbody td').first().evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  // No file names, environment variable names or ids in what a person reads.
  expect(await page.locator('body').innerText()).not.toMatch(JARGON);
});

test('R9: Save and apply lives in a sticky footer that appears only when a field is dirty, saves with one PUT and goes away', async ({ page }) => {
  const log = await seedSettings(page);
  await page.goto('/hub/settings.html');
  await ready(page);
  const bar = page.locator('#save-bar');
  await expect(bar).toBeHidden();
  await page.locator('#r-senior').fill('12500');
  await expect(bar).toBeVisible();
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  const btn = bar.getByRole('button', { name: 'Save and apply' });
  const box = await btn.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await btn.click();
  await expect(page.locator('#save-status')).toContainText('Saved to the Vault');
  expect(log.puts).toHaveLength(1);
  expect(log.puts[0].value.rates.Senior).toBe(12500);
  await expect(bar).toBeHidden({ timeout: 8000 });
  // Editing a partner's name is dirty too; the implied day rates are figures with their unit.
  await page.locator('.partner-row[data-code="RE"] .p-name').fill('A. Agafonov');
  await expect(bar).toBeVisible();
  await expect(page.locator('#d-principal')).toHaveClass(/hub-num/);
  await expect(page.locator('#d-principal')).toContainText('2,700');
});

test('R9: an associate reads the rates with the form switched off and never sees the save bar', async ({ page }) => {
  await seedSettings(page, { me: { id: 'gs', name: 'Gabriela Sosa', email: 'gs@alpha-technical-centre.com', role: 'associate' } });
  await page.goto('/hub/settings.html');
  await ready(page);
  await expect(page.locator('#r-principal')).toBeDisabled();
  await expect(page.locator('#rates-readonly')).toContainText('Rates are set by a partner');
  await page.locator('#r-principal').focus();
  await expect(page.locator('#save-bar')).toBeHidden();
  await expect(page.locator('#sec-cost')).toBeHidden();
});

test('(settings) bilingual: every data-en has its data-es and no bare text', async ({ page }) => {
  await seedSettings(page);
  await page.goto('/hub/settings.html');
  await ready(page);
  const audit = await page.evaluate(() => {
    const missing = [...document.querySelectorAll('[data-en]')].filter((el) => !el.hasAttribute('data-es')).map((el) => el.outerHTML.slice(0, 80));
    const bare = [...document.body.querySelectorAll('*')].filter((el) => {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT', 'OPTION', 'TEXTAREA'].includes(el.tagName.toUpperCase()) || el.closest('svg, .nav-wordmark, .hub-av, .nav-lang, .hub-lang-seg, .mono, .hub-num, .p-role')) return false;
      if (el.children.length) return false;
      const t = el.textContent.trim();
      return /\p{L}{2,}/u.test(t) && !el.hasAttribute('data-en') && !el.closest('[data-en]');
    }).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
    return { missing, bare };
  });
  expect(audit.missing).toEqual([]);
  expect(audit.bare).toEqual([]);
});
