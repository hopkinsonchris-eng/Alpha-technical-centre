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
