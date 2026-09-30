import { test, expect } from '@playwright/test';

test('public homepage renders with the shared stylesheet', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/Alpha Technical Centre/);
  const navy = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--navy').trim());
  expect(navy.toUpperCase()).toBe('#0B1F3A');
});

test('the vault client loads as a module in the browser and works in local mode', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const { vault } = await import('/js/vault-client.js');
    const h1 = await vault.canonicalHash({ b: 1, a: [2, 1.0] });
    const h2 = await vault.canonicalHash({ a: [2, 1], b: 1 });
    return { mode: vault.mode(), same: h1 === h2, prefix: h1.slice(0, 7) };
  });
  expect(result.same).toBe(true);
  expect(result.prefix).toBe('sha256:');
});
