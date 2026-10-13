// Wave 9 (docs/vault-hub/wave9/01-project-folders.md, W9-AC11): the project page's Files tab opens on the project's
// folders — the twelve numbered folders, a folder per attached field and well, the APEX apps with their runs — and keeps
// the source folders one tap away. A row says how the record got there (Rule, AI 92%, Filed by…); an unsorted row
// carries the AI's suggestion with its quote and an Accept; Move to files it anywhere; each folder lists what it expects
// with a tick or a gap, and a partner may mark a gap not applicable. The Queues page lists the doubtful filings across
// projects. The API is stubbed with page.route; the static server serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const ASSOCIATE = { id: 'ana', name: 'Ana', email: 'ana@alpha-technical-centre.com', role: 'associate' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'parker-creek';
const WD = 'Alpha technical / Parker Creek';
const LOGS = u(701), JOA = u(702), INV = u(703), SCAN = u(704), GDELT = u(705), CPR = u(706), RUN = u(790);

const PROJECT = {
  id: PID, client_id: null, name: 'Parker Creek', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: ['f-pc', 'w-frost2', 'w-a1'], members: ['chris', 'ana'],
  created_at: '2026-10-07T09:21:53.525Z', closed_at: null, contacts: [], country: 'US', lat: null, lon: null, stage: 'Initial screen',
  stage_history: [{ stage: 'Initial screen', at: '2026-10-07T09:21:53.525Z', by: 'chris' }], register: {},
};
const leaf = (key, en, es, extra = {}) => ({ key, n: null, en, es, partners_only: false, asset_id: null, app_id: null, count: 0, expects: [], children: [], ...extra });
const top = (key, n, en, es, extra = {}) => ({ ...leaf(key, en, es, extra), n });
const exp = (kind, en, es, met, waived = false) => ({ kind, en, es, met, waived });

/** The body of GET /api/projects/:id/folders as the Vault answers it, with the records in `where` (id → folder). */
function foldersBody(who = PARTNER, where = {}) {
  const partner = who.role === 'partner';
  const file = (id, name, folder, filing, extra = {}) => ({ id, name, title: name, path: extra.path ?? null, source: extra.source ?? 'zoho-workdrive', type: extra.type ?? 'report', mime: extra.mime ?? 'application/pdf', size: 2048, version: 1, created_at: '2026-10-08T09:00:00.000Z', authored_at: null, folder: where[id] ?? folder, filing, suggestion: extra.suggestion ?? null });
  const KIND_EN = { 'well-log': 'Well logs', news: 'News', invoice: 'Invoice', joa: 'Joint operating agreement', 'reserves-report': 'Reserves report', 'facilities-description': 'Facilities description' };
  const rule = (kind, reason) => ({ method: 'rule', doc_kind: kind, kind_en: KIND_EN[kind], confidence: 1, quote: null, reason, filed_by: 'vault', filed_at: '2026-10-08T09:05:00.000Z' });
  const files = [
    file(LOGS, 'Frost 2 Openhole Logs.zip', 'subsurface/wells/w-frost2', rule('well-log', 'Named as well logs; about Frost 2'), { path: WD + '/Extracted_Petra', mime: 'application/zip' }),
    file(CPR, 'Parker Creek CPR 2025.pdf', 'subsurface/fields/f-pc', { method: 'model', doc_kind: 'reserves-report', confidence: 0.92, quote: 'Competent Person’s Report', reason: 'A reserves report for the field', filed_by: 'vault', filed_at: '2026-10-08T09:05:00.000Z' }, { path: WD + '/Reserves VDR' }),
    file(SCAN, 'Scan_0042.pdf', 'unsorted', { method: 'model', doc_kind: 'facilities-description', confidence: 0.61, quote: 'tank battery and flow lines', reason: 'Describes surface facilities', filed_by: 'vault', filed_at: '2026-10-08T09:05:00.000Z' },
      { path: WD + '/Misc', suggestion: where[SCAN] ? null : { queue_id: u(801), folder: 'facilities', doc_kind: 'facilities-description', confidence: 0.61 } }),
    file(GDELT, 'Permian output hits a record', 'research/news', rule('news', 'Research: gdelt'), { source: 'research', type: 'note', mime: null }),
    ...(partner ? [
      file(JOA, 'Parker Creek Joint Operating Agreement.pdf', 'legal', { method: 'manual', doc_kind: 'joa', kind_en: 'Joint operating agreement', confidence: null, quote: null, reason: 'Filed by Chris Hopkinson', filed_by: 'chris', filed_at: '2026-10-08T10:00:00.000Z' }, { type: 'contract' }),
      file(INV, 'Invoice 0042.pdf', 'financial', rule('invoice', 'Record type: invoice'), { type: 'invoice', source: 'upload' }),
    ] : []),
  ];
  const at = (k) => files.filter((f) => f.folder === k).length;
  const wells = [leaf('subsurface/wells/w-frost2', 'Frost 2', 'Frost 2', { asset_id: 'w-frost2', count: at('subsurface/wells/w-frost2'), expects: [exp('well-log', 'Well logs', 'Registros de pozo', true), exp('end-of-well-report', 'End of well report', 'Informe final de pozo', false)] }),
    leaf('subsurface/wells/w-a1', 'Smith A-1', 'Smith A-1', { asset_id: 'w-a1', count: 0, expects: [exp('well-log', 'Well logs', 'Registros de pozo', false), exp('end-of-well-report', 'End of well report', 'Informe final de pozo', false)] })];
  const fields = [leaf('subsurface/fields/f-pc', 'Parker Creek', 'Parker Creek', { asset_id: 'f-pc', count: at('subsurface/fields/f-pc'), expects: [exp('reserves-report', 'Reserves report', 'Informe de reservas', true)] })];
  const sub = [leaf('subsurface/basin', 'Basin & regional', 'Cuenca y regional'), leaf('subsurface/fields', 'Fields', 'Campos', { count: 1, children: fields }), leaf('subsurface/reservoirs', 'Reservoirs', 'Yacimientos'),
    leaf('subsurface/wells', 'Wells', 'Pozos', { count: wells.reduce((s, w) => s + w.count, 0), children: wells }), leaf('subsurface/seismic', 'Seismic & geophysics', 'Sísmica y geofísica', { expects: [exp('seismic-survey', 'Seismic survey', 'Levantamiento sísmico', false)] })];
  const apps = [leaf('apex/apex-3d-model', 'APEX 3D Model', 'APEX 3D Model', { app_id: 'apex-3d-model', count: 1 }), leaf('apex/nodal-analysis', 'APEX Nodal Analysis', 'APEX Nodal Analysis', { app_id: 'nodal-analysis' })];
  const research = [leaf('research/papers', 'Papers', 'Artículos'), leaf('research/news', 'News & web', 'Noticias y web', { count: at('research/news') }), leaf('research/companies', 'Company intelligence', 'Inteligencia de empresas')];
  const folders = [
    top('unsorted', '00', 'Unsorted', 'Sin clasificar', { count: at('unsorted') }),
    ...(partner ? [top('legal', '01', 'Legal', 'Legal', { partners_only: true, count: at('legal'), expects: [exp('nda', 'NDA', 'NDA', false), exp('joa', 'Joint operating agreement', 'Acuerdo de operación conjunta', true)] })] : []),
    top('government', '02', 'Government & regulatory', 'Gobierno y regulación', { expects: [exp('licence-psc', 'Licence or PSC', 'Licencia o contrato de producción compartida', false), exp('work-programme', 'Work programme', 'Programa de trabajo', false)] }),
    top('commercial', '03', 'Commercial & contracts', 'Comercial y contratos'),
    ...(partner ? [top('financial', '04', 'Financial', 'Finanzas', { partners_only: true, count: at('financial') })] : []),
    top('subsurface', '05', 'Subsurface', 'Subsuelo', { count: sub.reduce((s, x) => s + x.count, 0), children: sub }),
    top('facilities', '06', 'Facilities & infrastructure', 'Instalaciones e infraestructura', { count: at('facilities'), expects: [exp('facilities-description', 'Facilities description', 'Descripción de instalaciones', false)] }),
    top('hse', '07', 'HSE', 'SSA', { expects: [exp('environmental-assessment', 'Environmental assessment', 'Evaluación ambiental', false)] }),
    top('apex', '08', 'APEX apps', 'Aplicaciones APEX', { count: 1, children: apps }),
    top('research', '09', 'Papers & research', 'Artículos e investigación', { count: at('research/news'), children: research }),
    top('correspondence', '10', 'Correspondence', 'Correspondencia'),
    top('deliverables', '11', 'Deliverables', 'Entregables'),
  ];
  const runs = [{ id: RUN, job: 'apex-3d-model', tool_version: '1.121.0', title: 'Parker Creek static model, P50', created_at: '2026-10-09T12:00:00.000Z', status: 'final', asset_ids: ['f-pc'], folder: 'apex/apex-3d-model', current: true }];
  return { project_id: PID, generated_at: '2026-10-13T09:00:00.000Z', partner, folders, files, runs, unsorted: at('unsorted'), waiting: files.filter((f) => f.suggestion).length };
}
const FILES_BODY = { project_id: PID, count: 1, generated_at: '2026-10-08T07:00:00.000Z', files: [{ id: LOGS, name: 'Frost 2 Openhole Logs.zip', title: 'Frost 2 Openhole Logs.zip', path: WD + '/Extracted_Petra', source: 'zoho-workdrive', type: 'report', mime: 'application/zip', size: 2048, version: 1, created_at: '2026-10-08T09:00:00.000Z', authored_at: null }] };
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, who = PARTNER, opts = {}) {
  const posts = [];
  const where = {};
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() === 'POST') {
      const body = req.postDataJSON ? req.postDataJSON() : null;
      posts.push({ path: p, body });
      if (p === '/api/projects/' + PID + '/folders/file') { where[body.item_id] = body.folder; return json(route, { item_id: body.item_id, filing_id: u(900), folder: body.folder }); }
      if (p === '/api/folders/proposals/' + u(801) + '/accept') { where[SCAN] = (body && body.folder) || 'facilities'; return json(route, { id: u(801), status: 'accepted' }); }
      if (p === '/api/folders/proposals/' + u(801) + '/reject') return json(route, { id: u(801), status: 'rejected' });
      if (p === '/api/projects/' + PID + '/folders/waive') return json(route, { project_id: PID, ...body });
      return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
    }
    if (p === '/api/me') return json(route, who);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/folders') { const b = foldersBody(who, where); if (opts.extra) { b.files.push(...opts.extra); b.unsorted += opts.extra.length; b.folders[0].count += opts.extra.length; } return json(route, b); }
    if (p === '/api/projects/' + PID + '/files') return json(route, FILES_BODY);
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: 0, entries: [] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/folders/proposals') {
      const open = !where[SCAN];
      return json(route, { proposals: open ? [{ id: u(801), project_id: PID, project_name: 'Parker Creek', item_id: SCAN, title: 'Scan_0042.pdf', type: 'report', folder: 'facilities', folder_label: '06 Facilities & infrastructure', doc_kind: 'facilities-description', confidence: 0.61, quote: 'tank battery and flow lines', reason: 'Describes surface facilities', created_at: '2026-10-08T09:05:00.000Z' }] : [],
        options: { [PID]: [{ key: 'government', label: '02 Government & regulatory' }, { key: 'facilities', label: '06 Facilities & infrastructure' }, { key: 'subsurface/wells/w-a1', label: '05 Subsurface › Wells › Smith A-1' }] } });
    }
    if (p === '/api/queue/filing') return json(route, { items: [] });
    if (p === '/api/queue/review') return json(route, { items: [] });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/projects') return json(route, { projects: [PROJECT] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return posts;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
async function openFolders(page, who = PARTNER, lang = 'en', opts = {}) {
  const posts = await stubApi(page, who, opts);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  if (lang === 'es') await page.locator('.nav-lang button[data-lang="es"]').click();
  // 13 Oct 2026: the WorkDrive tree is the default; Project folders is one tap away.
  if (opts.stayOnSource !== true) await page.locator('#files-view [data-view="folders"]').click();
  return posts;
}
const node = (page, key) => page.locator(`#files-folders details[data-folder-key="${key}"]`);
const open = async (page, key) => { const d = node(page, key); if (!(await d.evaluate((e) => e.open))) await d.locator('> summary').click(); };

test('W9-AC11: the Files tab opens on the project folders: twelve numbered folders with counts, a folder per field and well, the apps with their runs, each row saying how it got there', async ({ page }) => {
  await openFolders(page, PARTNER, 'en', { stayOnSource: true });
  await expect(page.locator('#tab-files')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#files-view')).toBeVisible();
  // The WorkDrive tree people know is what opens; Project folders is the second button.
  await expect(page.locator('#files-view [data-view="source"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#files')).toBeVisible();
  await page.locator('#files-view [data-view="folders"]').click();
  await expect(page.locator('#files-view [data-view="folders"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#files-folders')).toBeVisible();
  await expect(page.locator('#files')).toBeHidden();
  const tops = page.locator('#files-folders .hub-ft-tree > details');
  expect(await tops.evaluateAll((els) => els.map((e) => e.querySelector('summary .hub-ft-name').textContent))).toEqual([
    '00 Unsorted', '01 Legal', '02 Government & regulatory', '03 Commercial & contracts', '04 Financial', '05 Subsurface',
    '06 Facilities & infrastructure', '07 HSE', '08 APEX apps', '09 Papers & research', '10 Correspondence', '11 Deliverables']);
  await expect(node(page, 'legal')).toHaveAttribute('data-partners-only', '');
  await expect(node(page, 'subsurface')).toHaveAttribute('data-count', '2');
  await open(page, 'subsurface'); await open(page, 'subsurface/wells'); await open(page, 'subsurface/wells/w-frost2');
  const logs = page.locator(`#files-folders [data-file-id="${LOGS}"]`);
  await expect(logs).toBeVisible();
  await expect(logs.locator('[data-filing="rule"]')).toHaveText('Rule');
  await expect(logs).toContainText('Well logs');
  await open(page, 'subsurface/fields'); await open(page, 'subsurface/fields/f-pc');
  await expect(page.locator(`#files-folders [data-file-id="${CPR}"] [data-filing="model"]`)).toHaveText('AI 92%');
  await open(page, 'legal');
  await expect(page.locator(`#files-folders [data-file-id="${JOA}"] [data-filing="manual"]`)).toHaveText('Filed by chris');
  await expect(page.locator(`#files-folders [data-file-id="${JOA}"] .hub-fd-kind`)).toHaveText('Joint operating agreement');
  await open(page, 'apex'); await open(page, 'apex/apex-3d-model');
  await expect(page.locator(`#files-folders [data-run-id="${RUN}"]`)).toContainText('Parker Creek static model, P50');
  await expect(node(page, 'apex/nodal-analysis')).toHaveAttribute('data-count', '0');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('#panel-files').screenshot({ path: path.join(EVIDENCE, 'w9-project-folders.png') });
});

test('W9-AC11: an unsorted record carries the AI\'s suggestion and quote; Accept files it there; Move to files anything anywhere', async ({ page }) => {
  const posts = await openFolders(page);
  await open(page, 'unsorted');
  const scan = page.locator(`#files-folders [data-file-id="${SCAN}"]`);
  await expect(scan).toBeVisible();
  await expect(scan.locator('[data-suggestion="facilities"]')).toContainText('06 Facilities & infrastructure (61%)');
  await expect(scan).toContainText('“tank battery and flow lines”');
  await expect(page.locator('#folders-status')).toContainText('1 unsorted');
  await scan.locator(`[data-accept="${u(801)}"]`).click();
  await expect.poll(() => posts.map((p) => p.path)).toContain('/api/folders/proposals/' + u(801) + '/accept');
  await expect(node(page, 'unsorted')).toHaveAttribute('data-count', '0');
  await expect(node(page, 'facilities')).toHaveAttribute('data-count', '1');
  // Move to: the news item goes to Basin & regional.
  await open(page, 'research'); await open(page, 'research/news');
  await expect(page.locator('#files-folders select')).toHaveCount(0);   // no dropdown until a row asks for one
  await page.locator(`#files-folders [data-move-open="${GDELT}"]`).click();
  const sel = page.locator(`#files-folders [data-move="${GDELT}"]`);
  await expect(sel.locator('option[value="subsurface/wells/w-a1"]')).toHaveText('05 Subsurface › Wells › Smith A-1');
  await sel.selectOption('subsurface/basin');
  await expect.poll(() => posts.find((p) => p.path.endsWith('/folders/file'))?.body).toEqual({ item_id: GDELT, folder: 'subsurface/basin' });
  await expect(node(page, 'research')).toHaveAttribute('data-count', '0');
});

test('W9-AC11: each folder lists what it expects with a tick or a gap; a partner marks a gap not applicable; an associate sees neither Legal nor Financial nor the button', async ({ page, browser }) => {
  const posts = await openFolders(page);
  await open(page, 'legal');
  const legal = page.locator('#files-folders [data-checklist="legal"]');
  await expect(legal.locator('[data-expect="joa"]')).toHaveAttribute('data-state', 'met');
  await expect(legal.locator('[data-expect="nda"]')).toHaveAttribute('data-state', 'missing');
  await expect(node(page, 'legal').locator('> summary [data-gaps]')).toHaveText('1 missing');
  await legal.locator('[data-expect="nda"] [data-waive]').click();
  await expect.poll(() => posts.find((p) => p.path.endsWith('/folders/waive'))?.body).toEqual({ folder: 'legal', expect: 'nda', waived: true });

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await openFolders(p2, ASSOCIATE);
  await expect(node(p2, 'legal')).toHaveCount(0);
  await expect(node(p2, 'financial')).toHaveCount(0);
  await open(p2, 'government');
  await expect(p2.locator('#files-folders [data-checklist="government"] [data-expect="licence-psc"]')).toHaveAttribute('data-state', 'missing');
  await expect(p2.locator('#files-folders [data-waive]')).toHaveCount(0);
  await ctx.close();
});

test('W9-AC11: Source folders is the WorkDrive tree as before and the default; a choice of Project folders is remembered', async ({ page }) => {
  await openFolders(page, PARTNER, 'en', { stayOnSource: true });
  await expect(page.locator('#files')).toBeVisible();
  await expect(page.locator('#files-folders')).toBeHidden();
  await expect(page.locator('#files [data-file-id]')).toHaveCount(1);
  await page.locator('#files-view [data-view="folders"]').click();
  await page.reload(); await ready(page);
  await expect(page.locator('#files-view [data-view="folders"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#files-folders')).toBeVisible();
  await page.locator('#files-view [data-view="source"]').click();
  await page.reload(); await ready(page);
  await expect(page.locator('#files')).toBeVisible();
});

test('13 Oct 2026: six thousand files not yet sorted: the page says sorting is in progress, shows fifty at a time and builds no dropdown until asked', async ({ page }) => {
  const extra = Array.from({ length: 6000 }, (_, i) => ({ id: u(100000 + i), name: `PC_${String(i).padStart(4, '0')}.tif`, title: `PC_${i}.tif`, path: WD + '/Reserves VDR', source: 'zoho-workdrive', type: 'image', mime: 'image/tiff', size: 1000, version: 1, created_at: '2026-10-08T09:00:00.000Z', authored_at: null, folder: 'unsorted', filing: null, suggestion: null }));
  const t0 = Date.now();
  await openFolders(page, PARTNER, 'en', { extra });
  await expect(page.locator('#files-folders [data-pending]')).toContainText('6,000 files have not been looked at yet');
  await expect(page.locator('#files-folders [data-pending]')).toContainText('nothing for you to do');
  expect(await page.locator('#files-folders [data-file-id]').count(), 'closed folders build no rows').toBe(0);
  await open(page, 'unsorted');
  await expect(page.locator('#files-folders [data-file-id]')).toHaveCount(50);
  await expect(page.locator('#files-folders [data-more="unsorted"]')).toContainText('Show 50 more (5,951 left)');
  expect(await page.locator('#files-folders select').count()).toBe(0);
  await page.locator('#files-folders [data-more="unsorted"]').click();
  await expect(page.locator('#files-folders [data-file-id]')).toHaveCount(100);
  expect(Date.now() - t0, 'the tab stays quick').toBeLessThan(15000);
});

test('W9-AC11: in Spanish every folder, badge and control reads in Spanish', async ({ page }) => {
  await openFolders(page, PARTNER, 'es');
  await expect(page.locator('#files-view [data-view="folders"]')).toHaveText('Carpetas del proyecto');
  await expect(node(page, 'unsorted').locator('> summary .hub-ft-name')).toHaveText('00 Sin clasificar');
  await open(page, 'unsorted');
  await expect(node(page, 'subsurface').locator('> summary .hub-ft-name')).toHaveText('05 Subsuelo');
  const scan = page.locator(`#files-folders [data-file-id="${SCAN}"]`);
  await expect(scan.locator('[data-suggestion]')).toContainText('La IA sugiere');
  await expect(scan.locator('[data-accept]')).toHaveText('Aceptar');
  await expect(scan.locator('[data-filing="model"]')).toHaveText('IA 61%');
});

test('W9-AC11: the Queues page lists files waiting for a folder; Accept, Choose folder and Leave unsorted each post', async ({ page }) => {
  const posts = await stubApi(page);
  await page.goto('/hub/queue.html');
  await ready(page);
  const card = page.locator(`[data-folder-proposal="${u(801)}"]`);
  await expect(page.locator('#sec-folders')).toBeVisible();
  await expect(page.locator('#n-folders')).toHaveText('1');
  await expect(card).toContainText('Scan_0042.pdf');
  await expect(card).toContainText('06 Facilities & infrastructure (61%)');
  await expect(card).toContainText('“tank battery and flow lines”');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('#sec-folders').screenshot({ path: path.join(EVIDENCE, 'w9-folder-queue.png') });
  await card.locator('[data-folder-choose]').selectOption('subsurface/wells/w-a1');
  await expect.poll(() => posts.find((p) => p.path.endsWith('/accept'))?.body).toEqual({ folder: 'subsurface/wells/w-a1' });
  await expect(card).toHaveCount(0);
});

test('W9-AC11: Leave unsorted rejects the suggestion', async ({ page }) => {
  const posts = await stubApi(page);
  await page.goto('/hub/queue.html');
  await ready(page);
  await page.locator(`[data-folder-reject="${u(801)}"]`).click();
  await expect.poll(() => posts.map((p) => p.path)).toContain('/api/folders/proposals/' + u(801) + '/reject');
});
