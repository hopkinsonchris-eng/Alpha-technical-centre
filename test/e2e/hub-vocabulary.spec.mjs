// Wave 7 PR2 (R11, W7-AC10): no user-visible string on any Hub page contains a file name, an environment
// variable name, an acceptance-criterion id or a module id. Every page is opened against the seeded Vault
// (test/e2e/fixtures/hub-seed.mjs) and its rendered text is checked, including the record panel on Find and
// the country panel on Today. Pages built in parallel by builders D and E are listed too; a page that fails only
// because of a file F does not own is marked fixme with the reason, for the coordinator to enable at merge.
import { test, expect } from '@playwright/test';
import { seedHub, PAGES, ready, DOC } from './fixtures/hub-seed.mjs';

export const JARGON = /SETUP\.md|_KEY\b|\bAC\d+\b|\bM\d\d\b|\.json\b|\.md\b/;

/** Visible text: innerText of the body plus every title and aria-label a person can be shown. Text a tool quotes
 *  verbatim from its own release notes ([data-source-text]) is source material, not Hub copy, and is left out. */
const visibleText = (page) => page.evaluate(() => {
  const quoted = [...document.querySelectorAll('[data-source-text]')].map((el) => [el, el.style.display]);
  for (const [el] of quoted) el.style.display = 'none';
  const bits = [document.body.innerText];
  for (const [el, d] of quoted) el.style.display = d;
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
    if (el.closest('[hidden]')) continue;
    for (const a of ['title', 'aria-label', 'placeholder']) if (el.getAttribute(a)) bits.push(el.getAttribute(a));
  }
  return bits.join('\n');
});

const offenders = (text) => [...text.matchAll(new RegExp(JARGON.source, 'g'))].map((m) => {
  const i = m.index; return text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ');
});

for (const [name, p] of Object.entries(PAGES)) {
  test(`W7-AC10: ${name} shows no file name, environment variable, acceptance-criterion or module id (${p.owner})`, async ({ page }) => {
    await seedHub(page);
    await page.goto(p.url);
    await ready(page);
    if (name === 'find') {
      await expect(page.locator('#find-results .result')).toHaveCount(2);
      await page.locator('#find-results .result').first().locator('[data-open-record]').click();
      await expect(page.locator('#record-panel')).toHaveAttribute('data-ref', 'doc:' + DOC);
      await expect(page.locator('#record-panel .hub-rp-technical')).toHaveCount(1);   // the Technical disclosure, closed, holds the storage key
    }
    if (name === 'today') {
      const co = page.locator('#country-list [data-country="CO"]');
      if (await co.count()) { await co.click(); await expect(page.locator('#country-panel')).toBeVisible(); }
    }
    if (name === 'project') {
      const row = page.locator(`.hub-tl-item[data-ref="doc:${DOC}"] .hub-tl-title`);
      if (await row.count()) { await row.click(); await expect(page.locator('#record-panel')).toBeVisible(); }
    }
    const en = await visibleText(page);
    expect(offenders(en), 'English').toEqual([]);
    await page.locator('aside .nav-lang button[data-lang="es"]').click();
    const es = await visibleText(page);
    expect(offenders(es), 'Spanish').toEqual([]);
  });
}

test('W7-AC10: Find and Cost with the Vault down still say nothing in jargon', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"boom","message":"database down"}}' }));
  for (const url of ['/hub/search.html?q=polymer&scope=firm', '/hub/cost.html', '/hub/tool.html?id=opportunity-register', '/hub/analogues.html']) {
    await page.goto(url);
    await ready(page);
    expect(offenders(await visibleText(page)), url).toEqual([]);
  }
});
