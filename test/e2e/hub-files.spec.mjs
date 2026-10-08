// Wave 8 PR 2 (docs/vault-hub/wave8/02-files-and-picker.md, W8-AC10, W8-AC14): the project page's Files tab. The tree
// built from GET /api/projects/:id/files: WorkDrive folders nested as in the path, hand uploads under "Uploaded", mail
// under "Mail", counts, a find box, type chips, and a row tap that opens the record panel. The API is stubbed with
// page.route; the static server serves the pages. No request ever goes to Supabase.
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const FILES = path.join(ROOT, 'test/e2e/fixtures/files');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'parker-creek';
const WD = 'Alpha technical / Parker Creek';
const TRACER = u(501), SHOW = u(502), SUMMARY = u(503), PETRA = u(504), PROD = u(505), MAIL = u(506);

const PROJECT = {
  id: PID, client_id: null, name: 'Parker Creek', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'],
  created_at: '2026-10-07T09:21:53.525Z', closed_at: null, contacts: [], country: 'US', lat: null, lon: null, stage: 'Initial screen',
  stage_history: [{ stage: 'Initial screen', at: '2026-10-07T09:21:53.525Z', by: 'chris' }], register: {},
};
const file = (id, name, p, extra = {}) => ({ id, name, title: name, path: p, source: 'zoho-workdrive', type: 'report', mime: 'application/pdf', size: 1234, version: 1, created_at: '2026-10-07T17:34:46.357Z', authored_at: null, ...extra });
const FILE_LIST = [
  file(PETRA, 'Frost 2 Openhole Logs.zip', `${WD}/Extracted_Petra`, { mime: 'application/zip', size: 60 * 1024 * 1024 }),
  file(SUMMARY, 'Reserves summary.xlsx', `${WD}/Reserves VDR`, { type: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', version: 2 }),
  file(TRACER, '06_8_2021_tracer.MAIN.pdf', `${WD}/Reserves VDR/Logs`),
  file(SHOW, 'SHOW #124-8.tiff', `${WD}/Reserves VDR/Logs`, { mime: 'image/tiff', size: null }),
  file(MAIL, 'RE: Frost well LAS files', null, { source: 'zoho-mail', type: 'email', mime: 'message/rfc822', size: null }),
  file(PROD, 'production.xlsx', null, { source: 'upload', type: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 20480 }),
];
// Wave 8 PR 3 (W8-AC16): where each file stands with the indexer, and the summary line.
const INDEX = {
  [PETRA]: { state: 'unsupported', chunks: 0 }, [SUMMARY]: { state: 'indexed', chunks: 14 }, [TRACER]: { state: 'waiting', chunks: 0, queue_position: 143, expected_at: '2026-10-08T14:30:00.000Z' },
  [SHOW]: { state: 'unsupported', chunks: 0 }, [MAIL]: { state: 'indexed', chunks: 2 }, [PROD]: { state: 'needs_ocr', chunks: 0 },
};
const INDEX_SUMMARY = { indexed: 2, waiting: 1, unsupported: 2, needs_ocr: 1, empty: 0, no_original: 0, queue_total: 610, per_run: 200, next_run_at: '2026-10-08T14:30:00.000Z' };
const FILES_BODY = { project_id: PID, count: FILE_LIST.length, generated_at: '2026-10-08T07:00:00.000Z', index: INDEX_SUMMARY, files: FILE_LIST.map((f) => ({ ...f, index: INDEX[f.id] })) };
const ITEM = (id) => {
  const f = FILE_LIST.find((x) => x.id === id);
  return { id, type: f.type, title: f.name, created_at: f.created_at, authored_at: null, authors: [], client_id: null, project_id: PID, asset_ids: [], organisation_ids: [], legal_tag: 'lt-firm',
    origin: { source: f.source, external_id: 'wd:' + id }, storage_key: 'originals/ab/' + id, mime: f.mime, content_hash: 'sha256:' + 'a'.repeat(64), version: f.version, supersedes: null, reference_no: null,
    filing: { method: 'path', confidence: 1, confirmed_by: null }, extracted: { filename: f.name, workdrive: f.path ? { path: f.path } : undefined, ...(INDEX[id].state === 'waiting' ? {} : { ingest: { status: INDEX[id].state === 'indexed' ? 'ok' : INDEX[id].state, version: f.version }, chunks: INDEX[id].chunks }) }, stale: false, tags: [], cites: [] };
};
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, over = {}) {
  const external = [];
  await page.route('**/*', (route) => {
    const u2 = new URL(route.request().url());
    if (/supabase\.co$/.test(u2.hostname) || /supabase/.test(u2.hostname)) { external.push(u2.href); return route.abort(); }
    return route.fallback();
  });
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (over[p]) return over[p](route);
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/files') return json(route, FILES_BODY);
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: 0, entries: [] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    const orig = /^\/api\/items\/([^/]+)\/original$/.exec(p);
    if (orig && orig[1] === TRACER) return route.fulfill({ status: 200, contentType: 'application/pdf', body: readFileSync(path.join(FILES, 'report.pdf')) });
    const ix = /^\/api\/items\/([^/]+)\/index$/.exec(p);
    if (ix && INDEX[ix[1]]) return json(route, { item_id: ix[1], version: 1, ...INDEX[ix[1]], ...(INDEX[ix[1]].state === 'waiting' ? { queue_total: 610 } : {}) });
    const it = /^\/api\/items\/([^/]+)$/.exec(p);
    if (it && FILE_LIST.some((x) => x.id === it[1])) return json(route, ITEM(it[1]));
    if (p.startsWith('/api/items/') && p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/projects') return json(route, { projects: [PROJECT] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return external;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
async function openFiles(page, lang = 'en', over) {
  const external = await stubApi(page, over);
  await page.goto('/hub/project.html?id=' + PID + '#files');
  await ready(page);
  if (lang === 'es') await page.locator('.nav-lang button[data-lang="es"]').click();
  return external;
}
const folder = (page, name) => page.locator(`#files details.hub-ft-folder[data-folder-name="${name}"]`);

test('W8-AC10: the Files tab counts the files and shows WorkDrive folders nested with counts, Uploaded and Mail after them, each row with its kind, version and size', async ({ page }) => {
  const external = await openFiles(page);
  const tab = page.locator('#tab-files');
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab.locator('.n')).toHaveText('6');
  await expect(page.locator('#panel-files')).toBeVisible();
  const tree = page.locator('#files');
  await expect(tree.locator('.hub-ft-folder')).toHaveCount(6);        // the root, Extracted_Petra, Reserves VDR, Logs, Uploaded, Mail
  const top = tree.locator(':scope > .hub-ft-tree > details.hub-ft-folder');
  expect(await top.evaluateAll((els) => els.map((e) => [e.dataset.folderName, e.dataset.count, e.open]))).toEqual([[WD, '4', true], ['Uploaded', '1', true], ['Mail', '1', true]]);
  const vdr = folder(page, 'Reserves VDR');
  await expect(vdr).toHaveAttribute('data-count', '3');
  expect(await vdr.evaluate((e) => e.open)).toBe(false);               // below the top level a folder starts closed
  await vdr.locator('> summary').click();
  await expect(folder(page, 'Logs')).toHaveAttribute('data-count', '2');
  await folder(page, 'Logs').locator('> summary').click();
  const tracer = tree.locator(`[data-file-id="${TRACER}"]`);
  await expect(tracer).toBeVisible();
  await expect(tracer).toHaveAttribute('data-kind', 'pdf');
  await expect(tracer).toContainText('06_8_2021_tracer.MAIN.pdf');
  await expect(tracer).toContainText('1.2 KB');
  await expect(tree.locator(`[data-file-id="${SUMMARY}"]`)).toContainText('v2');
  await expect(tree.locator(`[data-file-id="${PETRA}"]`)).toHaveAttribute('data-kind', 'other');
  await expect(tree.locator(`[data-file-id="${MAIL}"]`)).toHaveAttribute('data-kind', 'mail');
  await expect(tree.locator(`[data-file-id="${PROD}"]`)).toHaveAttribute('data-kind', 'sheet');
  // W8-AC14: nothing went to Supabase.
  expect(external).toEqual([]);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w8-files-tab.png'), fullPage: false });
});

test('W8-AC10: the find box keeps the rows whose name contains the term and hides empty folders; a type chip keeps one kind; clearing restores the tree', async ({ page }) => {
  await openFiles(page);
  const tree = page.locator('#files');
  await page.locator('#files-find').fill('tracer');
  await expect(tree.locator('[data-file-id]')).toHaveCount(1);
  await expect(tree.locator('.hub-ft-folder')).toHaveCount(3);        // root, Reserves VDR, Logs: every folder on the way, all open
  await expect(tree.locator(`[data-file-id="${TRACER}"]`)).toBeVisible();
  await expect(page.locator('#files-status')).toContainText('1 of 6');
  await page.locator('#files-find').fill('');
  await expect(tree.locator('[data-file-id]')).toHaveCount(6);
  await page.locator('#files-kinds button[data-kind="sheet"]').click();
  await expect(page.locator('#files-kinds button[data-kind="sheet"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await tree.locator('[data-file-id]').evaluateAll((els) => els.map((e) => e.dataset.fileId).sort())).toEqual([SUMMARY, PROD].sort());
  await page.locator('#files-kinds button[data-kind="sheet"]').click();
  await expect(tree.locator('[data-file-id]')).toHaveCount(6);
  await page.locator('#files-find').fill('nothing here');
  await expect(tree.locator('[data-file-id]')).toHaveCount(0);
  await expect(page.locator('#files .hub-empty')).toContainText('No file matches');
});

test('W8-AC10: a row tap opens the record panel on that document, with the viewer for a PDF', async ({ page }) => {
  await openFiles(page);
  await page.locator('#files-find').fill('tracer');
  await page.locator(`#files [data-file-id="${TRACER}"]`).click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + TRACER);
  await expect(panel.locator('#rp-title')).toHaveText('06_8_2021_tracer.MAIN.pdf');
  await expect(panel.locator('.hub-viewer[data-viewer="pdf"]')).toHaveCount(1);
});

test('W8-AC10 (ES): the tab, the groups, the chips and the status read in Spanish', async ({ page }) => {
  await openFiles(page, 'es');
  await expect(page.locator('#tab-files')).toContainText('Archivos');
  await expect(folder(page, 'Uploaded').locator('> summary')).toContainText('Subidos');
  await expect(folder(page, 'Mail').locator('> summary')).toContainText('Correo');
  await expect(page.locator('#files-kinds button[data-kind="sheet"]')).toHaveText('Hoja');
  await expect(page.locator('#files-find')).toHaveAttribute('placeholder', /Buscar/);
  await expect(page.locator('#files-status')).toContainText('6 archivos');
});

test('W8-AC10: when the route fails the tab says so and the rest of the page stands', async ({ page }) => {
  await openFiles(page, 'en', { ['/api/projects/' + PID + '/files']: (route) => json(route, { error: { code: 'error', message: 'boom' } }, 500) });
  await expect(page.locator('#panel-files .hub-notice')).toContainText('could not be listed');
  await expect(page.locator('#tab-files .n')).toHaveCount(0);
  await expect(page.locator('#p-body')).toBeVisible();
});

test('W8-AC16: the indexing line counts the states and names the next run; each row carries its state; a waiting file\'s panel says where it is in the queue and when', async ({ page }) => {
  await openFiles(page);
  const line = page.locator('#files-index');
  await expect(line).toContainText('2 of 6 indexed');
  await expect(line).toContainText('1 waiting');
  await expect(line).toContainText('2 unsupported');
  await expect(line).toContainText('1 needs OCR');
  await expect(line).toContainText('next run');
  await expect(line).toHaveAttribute('data-waiting', '1');
  await page.locator('#files-find').fill('');
  for (const f of [folder(page, 'Reserves VDR'), folder(page, 'Logs')]) if (!(await f.evaluate((e) => e.open))) await f.locator('> summary').click();
  const tree = page.locator('#files');
  await expect(tree.locator(`[data-file-id="${TRACER}"]`)).toHaveAttribute('data-index-state', 'waiting');
  await expect(tree.locator(`[data-file-id="${TRACER}"] [data-index-mark]`)).toContainText('waiting · 143rd');
  await expect(tree.locator(`[data-file-id="${PETRA}"] [data-index-mark]`)).toContainText('no text');
  await expect(tree.locator(`[data-file-id="${PROD}"] [data-index-mark]`)).toContainText('needs OCR');
  await expect(tree.locator(`[data-file-id="${SUMMARY}"] [data-index-mark]`)).toHaveCount(0);
  await tree.locator(`[data-file-id="${TRACER}"]`).click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  const wait = panel.locator('[data-index-wait]').first();          // in the view; the technical line repeats it
  await expect(wait).toBeVisible();
  await expect(wait).toContainText('143rd of 610');
  await expect(wait).toContainText('14:30');
  await expect(panel.locator('[data-index-now]')).toHaveCount(1);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(line).toContainText('2 de 6 indexados');
  await expect(wait).toContainText('143.º de 610');
});

