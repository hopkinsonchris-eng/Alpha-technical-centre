// Wave 8 PR 2 (docs/vault-hub/wave8/02-files-and-picker.md, W8-AC13, W8-AC14): ELA Studio opens a spreadsheet from
// the Vault. With the Vault reachable and a project chosen, "Open from Vault" shows the picker with that project's
// spreadsheets and CSVs in their folders; the choice goes through the studio's own import; the run saved next cites
// the document. With the Vault unreachable the button is absent. No request goes to Supabase.
// The Vault API is stubbed per test; the XLSX library from the CDN is replaced by a CSV-reading stand-in.
import { test, expect } from '@playwright/test';

const ME = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris Hopkinson', role: 'partner' };
const PROJECT = { id: 'lago-phase-1', name: 'Lago Phase 1', client_id: 'summa', default_legal_tag: 'lt-summa-nda-2026' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CSV_ID = u(601), XLSX_ID = u(602), PDF_ID = u(603);
const WD = 'Alpha technical / Lago';
const file = (id, name, p, extra = {}) => ({ id, name, title: name, path: p, source: 'zoho-workdrive', type: 'report', mime: 'application/pdf', size: 1234, version: 1, created_at: '2026-10-07T17:34:46.357Z', authored_at: null, ...extra });
const FILES = [
  file(CSV_ID, 'well counts.csv', `${WD}/Well data`, { type: 'spreadsheet', mime: 'text/csv', version: 3 }),
  file(XLSX_ID, 'type curves.xlsx', `${WD}/Well data`, { type: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  file(PDF_ID, 'Field study.pdf', `${WD}`),
];
const CSV = 'Activity class,N\nGas-lift restoration (valve/mandrel),300\nESP rehabilitation program,42\n';
const FAKE_XLSX = `window.XLSX = {
  read(bin) { return { SheetNames: ['Sheet1'], Sheets: { Sheet1: String(bin) } }; },
  utils: { sheet_to_json(sheet) { return String(sheet).split(/\\r?\\n/).filter(Boolean).map((l) => l.split(',').map((v) => (v !== '' && !isNaN(Number(v)) ? Number(v) : v))); } },
};`;

async function stubApi(page, { server }) {
  const posts = [];
  const external = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_XLSX }));
  await page.route('**/*', (route) => {
    const h = new URL(route.request().url()).hostname;
    if (/supabase/.test(h)) { external.push(route.request().url()); return route.abort(); }
    return route.fallback();
  });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!server) return json(404, { error: { message: 'no api' } });
    if (path === '/api/me') return json(200, { user: ME });
    if (path === '/api/projects') return json(200, [PROJECT]);
    if (path === `/api/projects/${PROJECT.id}/files`) return json(200, { project_id: PROJECT.id, count: FILES.length, generated_at: '2026-10-08T07:00:00.000Z', files: FILES });
    if (path === `/api/items/${CSV_ID}/original`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': "inline; filename*=UTF-8''well%20counts.csv" }, body: CSV });
    if (/^\/api\/tools\/[^/]+\/resolve$/.test(path)) return json(200, { entry: 'ela-studio/index.html', modules: [], version: '1.0.1', commit: 'abc1234' });
    if (path === '/api/scenarios' && req.method() === 'POST') return json(201, { id: 'scn-1', name: JSON.parse(req.postData()).name });
    if (path === '/api/scenarios') return json(200, []);
    if (path === '/api/runs' && req.method() === 'POST') { const body = JSON.parse(req.postData()); posts.push(body); return json(201, { id: body.id, deduplicated: false }); }
    if (path === '/api/runs') return json(200, []);
    return json(404, { error: { message: 'not stubbed' } });
  });
  return { posts, external };
}

async function openStudio(page) {
  await page.goto('/ela-studio/index.html');
  await page.waitForFunction(() => window.ATC_TOOL && window.ATC_VAULT && window.ELAStore && document.querySelector('#projectPicker select') && document.querySelector('#curScen'));
}
const classN = (page, name) => page.evaluate((n) => (window.ATC_TOOL.getParams().classes.find((c) => c.name === n) || {}).N, name);

test('W8-AC13: Open from Vault lists the project\'s spreadsheets in their folders, feeds the choice to the studio\'s import, and the next saved run cites the document', async ({ page }) => {
  const api = await stubApi(page, { server: true });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await openStudio(page);
  const btn = page.locator('#btnVaultOpen');
  await expect(btn).toBeHidden();                                    // no project chosen yet
  await page.locator('#projectPicker select').selectOption(PROJECT.id);
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Open from Vault');
  const before = await classN(page, 'Gas-lift restoration (valve/mandrel)');
  expect(before).not.toBe(300);

  await btn.click();
  const picker = page.locator('[data-vault-picker="' + PROJECT.id + '"]');
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-file-id]')).toHaveCount(2);          // the PDF is not a spreadsheet
  await expect(picker.locator(`[data-file-id="${PDF_ID}"]`)).toHaveCount(0);
  await expect(picker.locator('details[data-folder-name="Well data"]')).toHaveAttribute('data-count', '2');
  await expect(picker.locator(`[data-file-id="${CSV_ID}"]`)).toContainText('v3');
  await picker.locator('[data-vault-picker-find]').fill('counts');
  await expect(picker.locator('[data-file-id]')).toHaveCount(1);
  await picker.locator(`[data-file-id="${CSV_ID}"]`).click();
  await expect(picker).toHaveCount(0);

  await expect.poll(() => classN(page, 'Gas-lift restoration (valve/mandrel)')).toBe(300);
  expect(await classN(page, 'ESP rehabilitation program')).toBe(42);
  expect(dialogs.some((m) => /Imported data for 2 activity classes/.test(m))).toBe(true);
  expect(await page.evaluate(() => window.ATC_TOOL.getImported())).toEqual({ ref: 'doc:' + CSV_ID, version: 3, name: 'well counts.csv' });
  await expect(page.locator('#toast')).toContainText('well counts.csv');

  // The run saved next carries the document as an input, beside the fiscal terms and the tool itself.
  await page.locator('#btnSave').click();
  await expect(page.locator('#saveModal')).toHaveClass(/show/);
  await page.locator('#saveName').fill('With Vault counts');
  await page.locator('#saveConfirm').click();
  await expect.poll(() => api.posts.length).toBe(1);
  const inputs = api.posts[0].inputs;
  expect(inputs).toContainEqual({ ref: 'doc:' + CSV_ID, kind: 'document', version: 3, role: 'import' });
  expect(inputs.some((i) => i.ref === 'tool:ela-studio')).toBe(true);
  expect(api.posts[0].project_id).toBe(PROJECT.id);
  expect(api.external).toEqual([]);                                       // W8-AC14
});

test('W8-AC13: Cancel leaves the studio as it was, and a device import replaces the Vault citation', async ({ page }) => {
  await stubApi(page, { server: true });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await openStudio(page);
  await page.locator('#projectPicker select').selectOption(PROJECT.id);
  await page.locator('#btnVaultOpen').click();
  const picker = page.locator('[data-vault-picker="' + PROJECT.id + '"]');
  await expect(picker).toBeVisible();
  await picker.locator('[data-vault-picker-cancel]').click();
  await expect(picker).toHaveCount(0);
  expect(await page.evaluate(() => window.ATC_TOOL.getImported())).toBe(null);
  await page.locator('#btnVaultOpen').click();
  await page.locator(`[data-vault-picker] [data-file-id="${CSV_ID}"]`).click();
  await expect.poll(() => page.evaluate(() => window.ATC_TOOL.getImported() && window.ATC_TOOL.getImported().ref)).toBe('doc:' + CSV_ID);
  await page.locator('#fileInput').setInputFiles({ name: 'local.csv', mimeType: 'text/csv', buffer: Buffer.from('Activity class,N\nESP rehabilitation program,7\n') });
  await expect.poll(() => page.evaluate(() => window.ATC_TOOL.getImported())).toBe(null);
  expect(await classN(page, 'ESP rehabilitation program')).toBe(7);
});

test('W8-AC13: with the Vault unreachable the button is absent and the studio is unchanged', async ({ page }) => {
  await stubApi(page, { server: false });
  await openStudio(page);
  expect(await page.evaluate(() => window.ELAStore.mode())).toBe('local');
  await expect(page.locator('#btnVaultOpen')).toBeHidden();
  await expect(page.locator('#btnImport')).toBeVisible();
});
