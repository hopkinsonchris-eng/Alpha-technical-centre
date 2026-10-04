// Wave 2, PR 1 (docs/vault-hub/wave2/05-markup.md §1.2, AC13 and AC14): the record
// panel is a highlights strip, related cards and a closed Details disclosure, never a
// raw dump; below 1200 px it is a bottom sheet that never squeezes the page.
// The API is stubbed with page.route; the static server serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'kaz-brownfield';
const DOC = u(301), DOC_V1 = u(300), RUN = u(401), RUN_OLD = u(400), LETTER = u(302);

const PROJECT = {
  id: PID, client_id: null, name: 'Western Kazakhstan Brownfield', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'],
  created_at: '2026-09-01T09:00:00.000Z', closed_at: null, contacts: [], country: 'KZ', lat: 47.1, lon: 51.9, stage: 'Qualified',
  stage_history: [{ stage: 'Initial screen', at: '2026-09-01T09:00:00.000Z', by: 'chris' }, { stage: 'Qualified', at: '2026-09-20T09:00:00.000Z', by: 'chris' }], register: {},
};
const TIMELINE = [
  { kind: 'run', ref: 'run:' + RUN, id: RUN, at: '2026-09-28T14:12:00.000Z', title: 'Waterflood screen, base case', job: 'opportunity-register', tool_version: '2.2.0', status: 'final', legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: RUN_OLD, superseded_by: null },
  { kind: 'item', ref: 'doc:' + LETTER, at: '2026-09-29T10:00:00.000Z', id: LETTER, title: 'Letter ATC-2026-0150: screening results', type: 'letter', version: 1, reference_no: 'ATC-2026-0150', legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null, superseded_by: null },
  { kind: 'item', ref: 'doc:' + DOC, id: DOC, at: '2026-09-30T18:25:25.436Z', title: 'ATC_Parker_Creek_Phase1_SOW_RevC sk copy.docx', type: 'report', version: 2, reference_no: null, legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: DOC_V1, superseded_by: null },
  { kind: 'run', ref: 'run:' + RUN_OLD, id: RUN_OLD, at: '2026-09-10T14:12:00.000Z', title: 'Waterflood screen, first pass', job: 'opportunity-register', tool_version: '2.1.0', status: 'superseded', legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null, superseded_by: RUN },
];
// What the API returns for the document the partner opened on the first live day (the raw shape behind the old JSON dump).
const ITEM = {
  id: DOC, type: 'report', title: 'ATC_Parker_Creek_Phase1_SOW_RevC sk copy.docx', created_at: '2026-09-30T18:25:25.436Z', authored_at: null, authors: [], client_id: null,
  project_id: PID, asset_ids: [], legal_tag: 'lt-firm', origin: { source: 'upload', fetched_at: '2026-09-30T18:25:24.942Z', external_id: 'upload:atc_parker_creek_phase1_sow_revc sk copy.docx' },
  storage_key: 'originals/ba/bae50dead7c45cca3e6ebf6d64bfe5b2132412cb7c5caf634c48d2045fe33645', content_hash: 'sha256:bae50dead7c45cca3e6ebf6d64bfe5b2132412cb7c5caf634c48d2045fe33645',
  version: 2, supersedes: DOC_V1, cites: ['run:' + RUN], filing: { method: 'manual', by: 'chris' },
  extracted: { text_chars: 20512, chunks: 14, format: 'docx', pages: 9, ingest: { version: 2, status: 'ok', at: '2026-09-30T18:25:40.000Z' } },
  stale: false, tags: [], organisation_ids: [], reference_no: null, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const RUN_RECORD = {
  id: RUN, job: 'opportunity-register', tool_version: '2.2.0', tool_commit: '3fa9c1e', author: 'chris', created_at: '2026-09-28T14:12:00Z', project_id: PID, legal_tag: 'lt-firm',
  title: 'Waterflood screen, base case', status: 'final', supersedes: RUN_OLD, input_hash: 'sha256:' + 'a'.repeat(64),
  inputs: [{ ref: 'ref:price_decks/brent-2026-06', kind: 'reference' }, { ref: 'doc:' + DOC, kind: 'item' }],
  outputs: { technical_potential_bopd: { value: 12400, unit: 'bopd' }, npv10: { value: 58.3, unit: 'USD MM' }, irr: { value: 0.21 }, method: { value: 'Analogue recovery factor' } },
  assumptions: {},
};
const LINEAGE = {
  project_id: PID,
  nodes: [
    { id: 'ref:price_decks/brent-2026-06', kind: 'reference', label: 'price_decks/brent-2026-06' },
    { id: 'doc:' + DOC_V1, kind: 'item', label: 'SOW RevB', type: 'report', project_id: PID, stale: false },
    { id: 'doc:' + DOC, kind: 'item', label: 'ATC_Parker_Creek_Phase1_SOW_RevC sk copy.docx', type: 'report', project_id: PID, stale: false },
    { id: 'run:' + RUN_OLD, kind: 'run', label: 'Waterflood screen, first pass', job: 'opportunity-register', status: 'superseded', project_id: PID, stale: false },
    { id: 'run:' + RUN, kind: 'run', label: 'Waterflood screen, base case', job: 'opportunity-register', status: 'final', project_id: PID, stale: false },
    { id: 'doc:' + LETTER, kind: 'item', label: 'Letter ATC-2026-0150', type: 'letter', project_id: PID, stale: false },
  ],
  edges: [
    { from: 'ref:price_decks/brent-2026-06', to: 'run:' + RUN, type: 'input', role: 'price_deck' },
    { from: 'doc:' + DOC, to: 'run:' + RUN, type: 'input' },
    { from: 'run:' + RUN, to: 'run:' + RUN_OLD, type: 'supersedes' },
    { from: 'doc:' + DOC, to: 'doc:' + DOC_V1, type: 'supersedes' },
    { from: 'run:' + RUN, to: 'doc:' + DOC, type: 'cites' },
    { from: 'run:' + RUN, to: 'doc:' + LETTER, type: 'cites' },
  ],
};
const VERSIONS = { item_id: DOC, versions: [{ version: 2, content_hash: ITEM.content_hash, storage_key: ITEM.storage_key, created_at: '2026-09-30T18:25:25.436Z' }, { version: 1, content_hash: 'sha256:' + 'b'.repeat(64), storage_key: 'originals/bb/x', created_at: '2026-09-12T10:00:00.000Z' }] };
const CATALOG = { tools: [{ id: 'opportunity-register', name: 'Opportunity Register', owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry: 'opportunity-register.html', versions: [{ version: '2.2.0', released_at: '2026-09-22', commit: '3fa9c1e' }], aliases: { current: '2.2.0' }, releases: [], hub: { context: ['project'], param: 'project', toolbar: 10, live_version: null } }], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

// Wave 5: three more originals the viewer can show (a one-page PDF, a PNG, a two-sheet workbook) and one it cannot (no original).
const PDF = u(311), PNG = u(312), XLS = u(313), NONE = u(314);
const FILES = path.join(ROOT, 'test/e2e/fixtures/files');
const item = (id, title, type, mime, format, extra = {}) => ({ ...ITEM, id, title, type, mime, storage_key: 'originals/aa/' + id.replace(/-/g, ''), version: 1, supersedes: null, cites: [],
  extracted: { text_chars: 100, chunks: 1, format, ingest: { version: 2, status: 'ok', at: '2026-10-02T10:00:00.000Z' } }, ...extra });
const EXTRA = {
  [PDF]: item(PDF, 'Guafita field report.pdf', 'report', 'application/pdf', 'pdf'),
  [PNG]: item(PNG, 'Field map.png', 'image', 'image/png', 'png'),
  [XLS]: item(XLS, 'production.xlsx', 'spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'),
  [NONE]: item(NONE, 'Scan uploaded before durable storage.pdf', 'scan', 'application/pdf', 'pdf', { extracted: { ingest: { version: 2, status: 'no_original' } } }),
};
const BYTES = { [PDF]: ['report.pdf', 'application/pdf'], [PNG]: ['map.png', 'image/png'], [XLS]: ['production.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] };
const EXTRA_TL = Object.values(EXTRA).map((it, i) => ({ kind: 'item', ref: 'doc:' + it.id, id: it.id, at: '2026-10-0' + (2 + i % 2) + 'T0' + (9 - i) + ':00:00.000Z', title: it.title, type: it.type, version: 1, legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null }));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page) {
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const orig = /^\/api\/items\/([^/]+)\/original$/.exec(p);
    if (orig) { const b = BYTES[orig[1]]; return b ? route.fulfill({ status: 200, contentType: b[1], body: readFileSync(path.join(FILES, b[0])) }) : json(route, { error: { code: 'no_original', message: 'missing' } }, 404); }
    if (p.startsWith('/api/items/') && EXTRA[p.split('/')[3]] && p.split('/').length === 4) return json(route, EXTRA[p.split('/')[3]]);
    if (p.startsWith('/api/items/') && EXTRA[p.split('/')[3]] && p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length + EXTRA_TL.length, entries: [...TIMELINE, ...EXTRA_TL] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, LINEAGE);
    if (p === '/api/items/' + DOC) return json(route, ITEM);
    if (p === '/api/items/' + DOC + '/versions') return json(route, VERSIONS);
    if (p === '/api/runs/' + RUN) return json(route, RUN_RECORD);
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [RUN_RECORD] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
async function openProject(page) { await stubApi(page); await page.goto('/hub/project.html?id=' + PID); await ready(page); }
const openDoc = (page) => page.locator(`.hub-tl-item[data-ref="doc:${DOC}"] .hub-tl-title`).click();

test('AC13: a document opens as highlights and related cards; the raw record sits inside a closed Details disclosure', async ({ page }) => {
  await openProject(page);
  await openDoc(page);
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#rp-kind')).toHaveText('Document');
  await expect(panel.locator('#rp-title')).toHaveText('ATC_Parker_Creek_Phase1_SOW_RevC sk copy.docx');

  // Highlights: type, project, legal tag, version, ingested, chunks, stale. In order, as a definition list.
  const hl = panel.locator('[data-highlights]');
  await expect(hl).toBeVisible();
  const terms = await hl.locator('dt').allTextContents();
  expect(terms).toEqual(['Type', 'Project', 'Legal tag', 'Version', 'Ingested', 'Indexed', 'Stale']);
  await expect(hl.locator('[data-h="type"]')).toHaveText('Report');
  await expect(hl.locator('[data-h="project"] a')).toHaveText('Western Kazakhstan Brownfield');
  await expect(hl.locator('[data-h="project"] a')).toHaveAttribute('href', '/hub/project.html?id=' + PID);
  await expect(hl.locator('[data-h="legal_tag"]')).toHaveText('lt-firm');
  await expect(hl.locator('[data-h="version"]')).toHaveText('v2 · supersedes v1');
  await expect(hl.locator('[data-h="ingested"]')).toContainText('30 Sept 2026');
  await expect(hl.locator('[data-h="ingested"]')).toContainText('upload');
  await expect(hl.locator('[data-h="indexed"]')).toHaveText('14 chunks · 9 pages · 20,512 characters');
  await expect(hl.locator('[data-h="stale"]')).toHaveText('No');

  // Related cards: versions, cites, cited by, and the original.
  const rel = panel.locator('[data-related]');
  await expect(rel).toHaveCount(4);
  const kinds = await rel.evaluateAll((els) => els.map((e) => e.getAttribute('data-related')));
  expect(kinds).toEqual(['versions', 'cites', 'cited-by', 'original']);
  await expect(panel.locator('[data-related="versions"]')).toContainText('2 versions');
  await expect(panel.locator('[data-related="versions"] li')).toHaveCount(2);
  await expect(panel.locator('[data-related="versions"] li').first()).toContainText('v2');
  await expect(panel.locator('[data-related="versions"] li').first()).toContainText('30 Sept 2026');
  await expect(panel.locator('[data-related="cites"] li')).toHaveCount(1);
  await expect(panel.locator('[data-related="cites"] li button')).toHaveText('Waterflood screen, base case');
  await expect(panel.locator('[data-related="cited-by"] li')).toHaveCount(1);     // the run that used this document as an input (lineage)
  await expect(panel.locator('[data-related="cited-by"] li')).toContainText('Waterflood screen, base case');
  await expect(panel.locator('[data-related="original"]')).toContainText('docx');
  await expect(panel.locator('[data-related="original"]')).toContainText('sha256:bae50dea');

  // The raw record is still there, but closed, and holds the exact fields.
  const det = panel.locator('details.hub-rp-details');
  await expect(det).toHaveCount(1);
  expect(await det.evaluate((d) => d.open)).toBe(false);
  await expect(panel.locator('.hub-json')).toBeHidden();
  await det.locator('summary').click();
  await expect(panel.locator('.hub-json')).toBeVisible();
  await expect(panel.locator('.hub-json')).toContainText('"storage_key": "originals/ba/');
  // No "JSON summary" heading anywhere.
  await expect(panel).not.toContainText('JSON summary');

  // A related card pivots: clicking the cited run opens that run in the same panel.
  await panel.locator('[data-related="cites"] li button').click();
  await expect(panel.locator('#rp-kind')).toHaveText('Run');
  await expect(panel.locator('#rp-title')).toHaveText('Waterflood screen, base case');
});

test('AC13: a run opens with its job, status, headline outputs, inputs and supersession', async ({ page }) => {
  await openProject(page);
  await page.locator(`.hub-tl-item[data-ref="run:${RUN}"] .hub-tl-title`).click();
  const panel = page.locator('#record-panel');
  const hl = panel.locator('[data-highlights]');
  const terms = await hl.locator('dt').allTextContents();
  expect(terms).toEqual(['Tool', 'Status', 'Headline', 'Inputs', 'Legal tag', 'Stale']);
  await expect(hl.locator('[data-h="tool"] a')).toHaveText('opportunity-register@2.2.0');
  await expect(hl.locator('[data-h="tool"] a')).toHaveAttribute('href', '/hub/tool.html?id=opportunity-register');
  await expect(hl.locator('[data-h="status"] .hub-pill')).toHaveText('Final');
  await expect(hl.locator('[data-h="headline"]')).toHaveText('technical potential bopd 12,400 bopd · npv10 58.3 USD MM · irr 0.21');
  await expect(hl.locator('[data-h="inputs"]')).toHaveText('2');
  const kinds = await panel.locator('[data-related]').evaluateAll((els) => els.map((e) => e.getAttribute('data-related')));
  expect(kinds).toEqual(['project', 'inputs', 'supersedes', 'cited-by']);
  await expect(panel.locator('[data-related="inputs"] li')).toHaveCount(2);
  await expect(panel.locator('[data-related="inputs"] li').first()).toContainText('price_decks/brent-2026-06');
  await expect(panel.locator('[data-related="supersedes"]')).toContainText('Waterflood screen, first pass');
  await expect(panel.locator('[data-related="cited-by"] li')).toHaveCount(2);     // the SOW and the letter cite this run
  expect(await panel.locator('details.hub-rp-details').evaluate((d) => d.open)).toBe(false);
});

test('AC14: on an iPad the panel is a bottom sheet over the page; the page keeps its full width; Escape closes and returns focus', async ({ page }) => {
  for (const [w, h] of [[1024, 768], [1366, 1024]]) {
    await page.setViewportSize({ width: w, height: h });
    await openProject(page);
    const trigger = page.locator(`.hub-tl-item[data-ref="doc:${DOC}"] .hub-tl-title`);
    await trigger.click();
    const panel = page.locator('#record-panel');
    await expect(panel).toBeVisible();
    const pb = await panel.boundingBox();
    const main = await page.locator('.hub-main').boundingBox();
    const side = await page.locator('.hub-side').boundingBox();
    if (w < 1200) {
      // Sheet: full width, anchored to the bottom, at most 85 % of the height; the page underneath is untouched.
      expect(pb.width).toBe(w);
      expect(Math.round(pb.y + pb.height)).toBe(h);
      expect(pb.height).toBeLessThanOrEqual(0.85 * h + 1);
      expect(Math.round(main.width)).toBe(w - Math.round(side.width));
      await expect(page.locator('#record-scrim')).toBeVisible();
    } else {
      // Side panel: the main column makes room and still has space for the text.
      expect(Math.round(pb.x)).toBe(w - 520);
      expect(Math.round(main.x + main.width)).toBeLessThanOrEqual(w - 520 + 1);
    }
    // Nothing on the page behind is squeezed into a one-character column.
    const widths = await page.locator('.hub-kv dd, .hub-tl-body, .hub-people').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => ({ what: e.className || e.parentElement.className, width: e.getBoundingClientRect().width })));
    for (const x of widths) expect(x.width, `${w}x${h} ${x.what}`).toBeGreaterThanOrEqual(240);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.locator('#record-scrim')).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test('AC14: the sheet closes when the scrim is tapped, and the panel is bilingual', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProject(page);
  await page.locator('.nav-lang button[data-lang="es"]').click();         // the sheet would cover the language switch
  await openDoc(page);
  await expect(page.locator('#record-panel [data-highlights] dt').first()).toHaveText('Tipo');
  await expect(page.locator('#record-panel details.hub-rp-details summary')).toHaveText('Registro completo');
  await page.locator('#record-scrim').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#record-panel')).toBeHidden();
});

test('AC18: evidence screenshot of the record sheet on an iPad-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProject(page);
  await openDoc(page);
  await expect(page.locator('#record-panel [data-highlights]')).toBeVisible();
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w2-record-sheet-ipad.png') });
});

test('W5-AC3: the View card shows a PDF on canvas, an image inline, a workbook as tables with sheet tabs, a Word file as a download, and says when the original is missing', async ({ page }) => {
  await openProject(page);
  const panel = page.locator('#record-panel');
  page.on('console', (m) => { if (m.type() === 'error') console.log('[browser]', m.text()); });
  const open = async (id) => { await page.locator(`.hub-tl-item[data-ref="doc:${id}"] .hub-tl-title`).click(); await expect(panel.locator('[data-view]')).toBeVisible(); };
  // PDF: the viewer reports its page count once PDF.js has rendered the first page.
  await open(PDF);
  const pdf = panel.locator('.hub-viewer[data-viewer="pdf"]');
  await expect(pdf).toHaveAttribute('data-pages', '1', { timeout: 15000 });
  await expect(pdf).toHaveAttribute('data-state', 'ready');
  await expect(pdf.locator('.hub-viewer-page canvas')).toHaveCount(1);
  await expect(pdf.locator('[data-page-counter]')).toHaveText('Page 1 of 1');
  await expect(pdf.locator('.hub-viewer-download')).toHaveAttribute('href', '/api/items/' + PDF + '/original?download=1');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w5-viewer-pdf.png') });
  // Image.
  await open(PNG);
  const img = panel.locator('.hub-viewer[data-viewer="image"] img');
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', '/api/items/' + PNG + '/original');
  await expect(panel.locator('.hub-viewer[data-viewer="image"]')).toHaveAttribute('data-state', 'ready');
  // Workbook: a tab per sheet, the first sheet as a table with the header row.
  await open(XLS);
  const sheet = panel.locator('.hub-viewer[data-viewer="sheet"]');
  await expect(sheet).toHaveAttribute('data-state', 'ready', { timeout: 15000 });
  await expect(sheet.locator('.hub-viewer-tab')).toHaveText(['Production', 'Monthly']);
  await expect(sheet.locator('table[data-sheet="Production"] thead th')).toHaveText(['Well', 'Rate bopd', 'Water cut']);
  await expect(sheet.locator('table[data-sheet="Production"] tbody tr')).toHaveCount(2);
  await sheet.locator('.hub-viewer-tab[data-sheet="Monthly"]').click();
  await expect(sheet.locator('table[data-sheet="Monthly"] tbody tr')).toHaveCount(1);
  await page.screenshot({ path: path.join(EVIDENCE, 'w5-viewer-sheet.png') });
  // Word: download only; the text stays as before.
  await open(DOC);
  const other = panel.locator('.hub-viewer[data-viewer="other"]');
  await expect(other).toHaveAttribute('data-state', 'download');
  await expect(other.locator('.hub-viewer-download')).toHaveAttribute('href', '/api/items/' + DOC + '/original?download=1');
  // No original.
  await open(NONE);
  await expect(panel.locator('[data-view]')).toContainText('Original missing');
  await expect(panel.locator('.hub-viewer')).toHaveCount(0);
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(panel.locator('[data-view] h4')).toHaveText('Ver');
});
