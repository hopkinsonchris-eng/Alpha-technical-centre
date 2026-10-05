// Wave 6, PR 1 (docs/vault-hub/wave6/05-markup.md §1.1, §1.2; W6-AC1, W6-AC3): the Connect card on Today and the
// Your mailbox card on Settings. The API is stubbed with page.route; Zoho's consent page is a stubbed URL.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const SERVICE = { id: 'apex-asset-intelligence', name: 'APEX', email: 'apex@alpha-technical-centre.com', role: 'service' };
const ANA = { id: 'ana', name: 'Ana', email: 'ana@alpha-technical-centre.com', role: 'associate' };
const ZOHO = 'https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=1000.X&scope=ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE&redirect_uri=https%3A%2F%2Fwww.alpha-technical-centre.com%2Foauth%2Fzoho%2Fcallback&access_type=offline&prompt=consent&state=abc.def';
const CONNECTED = { id: '11111111-1111-4111-8111-111111111111', address: 'chris@alpha-technical-centre.com', provider: 'zoho-mail', status: 'connected', privacy: 'all', scopes: ['ZohoMail.accounts.READ', 'ZohoMail.folders.READ', 'ZohoMail.messages.READ', 'ZohoMail.messages.CREATE'], can_send: true, connected_at: '2026-10-04T09:00:00.000Z', last_poll_at: new Date(Date.now() - 120000).toISOString(), last_error: null, history: { window_days: 180, done_at: '2026-10-05T03:00:00.000Z', cursor: null } };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stub(page, { me = PARTNER, mailbox = { configured: true, connected: false, prompt: true, connection: null, counts: null, firm_domains: ['alpha-technical-centre.com'] } } = {}) {
  const calls = { connect: 0, patch: [], put: [], firm: [], del: 0 };
  let state = mailbox;
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname, m = route.request().method();
    const body = () => (route.request().postData() ? JSON.parse(route.request().postData()) : {});
    if (p === '/api/me') return json(route, me);
    if (p === '/api/me/mailbox' && m === 'GET') return json(route, state);
    if (p === '/api/me/mailbox/connect' && m === 'POST') { calls.connect++; return json(route, { url: ZOHO, scopes: [] }); }
    if (p === '/api/me/mailbox' && m === 'PATCH') { const b = body(); calls.patch.push(b); if (b.privacy) state = { ...state, connection: { ...state.connection, privacy: b.privacy } }; return json(route, { ...b, applied: { hidden: 3, originals_purged: 4 }, connection: state.connection }); }
    if (p === '/api/me/mailbox' && m === 'DELETE') { calls.del++; state = { configured: true, connected: false, prompt: true, connection: null, counts: null, firm_domains: ['alpha-technical-centre.com'] }; return json(route, { id: CONNECTED.id, revoked: true, revoked_at_zoho: true, withdrawn: { hidden: 12 } }); }
    if (p === '/api/me/mailbox/rules' && m === 'GET') return json(route, { personal: [{ kind: 'blocked', pattern: 'family@example.com' }], firm: [{ kind: 'protected', pattern: 'partnerfirm.example' }, { kind: 'blocked', pattern: 'recruiter.example' }], inherent: { protected: ['alpha-technical-centre.com'] } });
    if (p === '/api/me/mailbox/rules' && m === 'PUT') { calls.put.push(body()); return json(route, { personal: body().blocked.map((x) => ({ kind: 'blocked', pattern: x.toLowerCase() })) }); }
    if (p === '/api/mail/rules' && m === 'PUT') { calls.firm.push(body()); return json(route, { firm: [] }); }
    if (p === '/api/catalog') return json(route, { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc' });
    if (p === '/api/settings/day-rates') return json(route, { error: { code: 'not_found', message: 'nothing saved' } }, 404);
    if (p === '/api/me/connections') return json(route, { connections: [] });
    if (p === '/api/projects' || p === '/api/countries' || p === '/api/items' || p === '/api/runs') return json(route, { projects: [], countries: [], items: [], runs: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  // Zoho's consent page, stubbed: proves the browser was sent to the authorize URL.
  await page.route('https://accounts.zoho.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Zoho consent</title><h1>Zoho consent page</h1>' }));
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('W6-AC1: a partner without a connection sees the Connect card on Today; Connect goes to Zoho; the return shows Connected; Not now hides it; a service person and someone already connected see no card', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const card = page.locator('#sec-mailbox');
  await expect(card).toBeVisible();
  await expect(card.locator('h3')).toHaveText('Connect your mailbox');
  await expect(card.locator('#mailbox-connect')).toContainText('chris@alpha-technical-centre.com');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w6-connect-card.png'), fullPage: false });
  await card.locator('#mailbox-connect').click();
  await page.waitForURL(/accounts\.zoho\.com\/oauth\/v2\/auth/);
  expect(calls.connect).toBe(1);
  expect(page.url()).toContain('scope=ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE');
  expect(page.url()).toContain('access_type=offline');
  // Back from Zoho.
  await stub(page, { mailbox: { configured: true, connected: true, prompt: false, connection: CONNECTED, counts: { messages: 0, filed: 0, waiting: 0, hidden_internal: 0, hidden_bulk: 0 }, firm_domains: [] } });
  await page.goto('/hub/index.html?mailbox=connected');
  await ready(page);
  await expect(page.locator('[data-mailbox-notice="connected"]')).toContainText('Mailbox connected.');
  await expect(page).toHaveURL(/\/hub\/index\.html$/);
  await expect(page.locator('#sec-mailbox')).toBeHidden();
  // Not now.
  const calls2 = await stub(page);
  await page.goto('/hub/index.html');
  await ready(page);
  await page.locator('#mailbox-later').click();
  await expect.poll(() => calls2.patch.length).toBe(1);
  expect(calls2.patch[0]).toEqual({ prompt_hidden_days: 30 });
  await expect(page.locator('#sec-mailbox')).toBeHidden();
  // A service person: the API says no prompt.
  await stub(page, { me: SERVICE, mailbox: { configured: true, connected: false, prompt: false, connection: null, counts: null, firm_domains: [] } });
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#sec-mailbox')).toBeHidden();
  // Spanish.
  await stub(page);
  await page.goto('/hub/index.html');
  await ready(page);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#h-mailbox')).toHaveText('Conecte su buzón');
});

test('W6-AC3: Your mailbox on Settings shows the connection, what is held, the privacy level with a confirm, the rules (firm rules for partners), the export and Disconnect', async ({ page }) => {
  const calls = await stub(page, { mailbox: { configured: true, connected: true, prompt: false, connection: CONNECTED, counts: { messages: 1412, filed: 963, waiting: 31, hidden_internal: 418, hidden_bulk: 2107 }, firm_domains: ['alpha-technical-centre.com'] } });
  await page.goto('/hub/settings.html');
  const sec = page.locator('#sec-mailbox');
  await expect(sec).toHaveAttribute('data-mailbox', 'connected', { timeout: 10000 });
  await expect(sec.locator('[data-h="address"]')).toHaveText('chris@alpha-technical-centre.com');
  await expect(sec.locator('[data-h="status"]')).toContainText('Connected · since 4 Oct 2026');
  await expect(sec.locator('[data-h="polled"]')).toContainText('2 min ago');
  await expect(sec.locator('[data-h="history"]')).toContainText('180 days, done 5 Oct 2026');
  await expect(sec.locator('[data-h="send"]')).toContainText('from this address');
  await expect(sec.locator('[data-mailbox-held]')).toHaveText('Held from this mailbox: 1412 messages · 963 filed · 31 waiting · 418 internal (hidden) · 2107 bulk (hidden)');
  await expect(sec.locator('#mailbox-privacy input[value="all"]')).toBeChecked();
  await expect(sec.locator('#mailbox-blocked')).toHaveValue('family@example.com');
  await expect(sec.locator('#firm-rules')).toBeVisible();
  await expect(sec.locator('#firm-protected')).toHaveValue('partnerfirm.example');
  await expect(sec.locator('#firm-blocked')).toHaveValue('recruiter.example');
  await expect(sec.locator('#firm-inherent')).toContainText('alpha-technical-centre.com and everyone at the firm');
  await page.screenshot({ path: path.join(EVIDENCE, 'w6-your-mailbox.png'), fullPage: false });
  // Privacy: cancel keeps the level; confirm sends it.
  page.once('dialog', (d) => d.dismiss());
  await sec.locator('#mailbox-privacy input[value="subjects"]').check();
  await expect(sec.locator('#mailbox-privacy input[value="all"]')).toBeChecked();
  expect(calls.patch.length).toBe(0);
  page.once('dialog', (d) => d.accept());
  await sec.locator('#mailbox-privacy input[value="subjects"]').check();
  await expect.poll(() => calls.patch.length).toBe(1);
  expect(calls.patch[0]).toEqual({ privacy: 'subjects' });
  await expect(sec.locator('#mailbox-privacy-status')).toHaveText('Saved. 3 hidden, 4 originals removed.');
  await expect(sec.locator('#mailbox-privacy input[value="subjects"]')).toBeChecked();
  // Rules.
  await sec.locator('#mailbox-blocked').fill('family@example.com\nMyBank.com');
  await sec.locator('#mailbox-rules-save').click();
  await expect.poll(() => calls.put.length).toBe(1);
  expect(calls.put[0]).toEqual({ blocked: ['family@example.com', 'MyBank.com'] });
  await expect(sec.locator('#mailbox-blocked')).toHaveValue('family@example.com\nmybank.com');
  await sec.locator('#firm-blocked').fill('recruiter.example\nspam.example');
  await sec.locator('#firm-rules-save').click();
  await expect.poll(() => calls.firm.length).toBe(1);
  expect(calls.firm[0]).toEqual({ protected: ['partnerfirm.example'], blocked: ['recruiter.example', 'spam.example'] });
  // Export goes to the download route.
  await sec.locator('#export-contact').fill('maria-fernandez');
  const nav = page.waitForRequest((r) => r.url().includes('/api/contacts/maria-fernandez/export?download=1'));
  await sec.locator('#mailbox-export button').click();
  await nav;
  await page.goto('/hub/settings.html');
  await expect(sec).toHaveAttribute('data-mailbox', 'connected', { timeout: 10000 });
  // Disconnect: cancel, then confirm.
  page.once('dialog', (d) => d.dismiss());
  await sec.locator('#mailbox-disconnect').click();
  expect(calls.del).toBe(0);
  page.once('dialog', (d) => d.accept());
  await sec.locator('#mailbox-disconnect').click();
  await expect.poll(() => calls.del).toBe(1);
  await expect(sec).toHaveAttribute('data-mailbox', 'off');
  await expect(sec.locator('#mailbox-off-text')).toHaveText('No mailbox is connected.');
  await expect(sec.locator('#mailbox-connect')).toBeEnabled();
});

test('W6-AC3: an associate sees no firm rules; a server without the Zoho client says so and disables Connect', async ({ page }) => {
  await stub(page, { me: ANA, mailbox: { configured: true, connected: true, prompt: false, connection: { ...CONNECTED, address: 'ana@alpha-technical-centre.com', can_send: false }, counts: { messages: 0, filed: 0, waiting: 0, hidden_internal: 0, hidden_bulk: 0 }, firm_domains: [] } });
  await page.goto('/hub/settings.html');
  const sec = page.locator('#sec-mailbox');
  await expect(sec).toHaveAttribute('data-mailbox', 'connected', { timeout: 10000 });
  await expect(sec.locator('#firm-rules')).toBeHidden();
  await expect(sec.locator('[data-h="send"]')).toContainText('not granted');
  await stub(page, { mailbox: { configured: false, connected: false, prompt: false, connection: null, counts: null, firm_domains: [] } });
  await page.goto('/hub/settings.html');
  await expect(sec).toHaveAttribute('data-mailbox', 'off', { timeout: 10000 });
  await expect(sec.locator('#mailbox-off-text')).toHaveText('Mail capture is not switched on for this Vault yet. Ask Chris.');   // wave 7 (S34): no file names in the copy
  await expect(sec.locator('#mailbox-connect')).toBeDisabled();
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(sec.locator('#h-mailbox')).toHaveText('Su buzón');
});
