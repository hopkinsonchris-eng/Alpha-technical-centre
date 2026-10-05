// Wave 2, PR 1 (docs/vault-hub/wave2/05-markup.md §1.2, AC13 and AC14) and wave 7 PR2 (wave7/05-markup.md §1.4, R5,
// W7-AC8): the record panel shows the record. Title, one meta line, then the content (the viewer for PDFs and images,
// the extracted text for mail, letters, text, DOCX and CSV with the Find term highlighted), an actions row (Open
// original, Download, Write a reply, Cite), then Versions and a closed Technical disclosure holding the hash, the
// storage key, the chunks and the raw JSON. Below 1200 px it is a bottom sheet that never squeezes the page.
// The API is stubbed with page.route; the static server serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const EVIDENCE7 = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'kaz-brownfield';
const DOC = u(301), DOC_V1 = u(300), RUN = u(401), RUN_OLD = u(400), LETTER = u(302), EMAIL = u(303), NEW_RUN = u(402);

const PROJECT = {
  id: PID, client_id: null, name: 'Western Kazakhstan Brownfield', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'],
  created_at: '2026-09-01T09:00:00.000Z', closed_at: null, contacts: [], country: 'KZ', lat: 47.1, lon: 51.9, stage: 'Qualified',
  stage_history: [{ stage: 'Initial screen', at: '2026-09-01T09:00:00.000Z', by: 'chris' }, { stage: 'Qualified', at: '2026-09-20T09:00:00.000Z', by: 'chris' }], register: {},
};
const CONTACTS = { project_id: PID, client_id: null, contacts: [{ id: 'aigerim', name: 'Aigerim Bekova', role: 'Subsurface lead', emails: ['aigerim@kmg.example'], language: 'en', organisation: { id: 'kmg', name: 'KazMunayGas', kind: 'operator', counterparty: 'holder' }, last_contact: '2026-10-01T09:00:00.000Z' }], counterparties: [] };
const TIMELINE = [
  { kind: 'item', ref: 'doc:' + EMAIL, id: EMAIL, at: '2026-10-01T09:00:00.000Z', title: 'RE: Waterflood screen, questions on the price deck', type: 'email', version: 1, legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null, superseded_by: null },
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
const DOC_TEXT = '# Scope of work, phase 1\n\nThe Parker Creek phase 1 scope covers the waterflood screen and the price deck sensitivity.\n\nDeliverables: a screening letter and a basis note.';
const LETTER_ITEM = { ...ITEM, id: LETTER, type: 'letter', title: 'Letter ATC-2026-0150: screening results', created_at: '2026-09-29T10:00:00.000Z', version: 1, supersedes: null, cites: ['run:' + RUN], reference_no: 'ATC-2026-0150', mime: 'text/plain',
  storage_key: 'originals/cc/' + 'c'.repeat(64), content_hash: 'sha256:' + 'c'.repeat(64), extracted: { text_chars: 410, chunks: 1, format: 'txt', ingest: { version: 2, status: 'ok', at: '2026-09-29T10:01:00.000Z' } } };
const LETTER_TEXT = 'Dear Ms Bekova,\n\nFurther to our call, the waterflood screen gives a technical potential of 12,400 bopd at the base-case price deck.\n\nWe would welcome the production history for the three pilot wells.\n\nYours sincerely,\nChris Hopkinson';
const EMAIL_ITEM = { ...ITEM, id: EMAIL, type: 'email', title: 'RE: Waterflood screen, questions on the price deck', created_at: '2026-10-01T09:00:00.000Z', version: 1, supersedes: null, cites: [], organisation_ids: ['kmg'], mime: 'message/rfc822', origin: { source: 'mail', external_id: 'mail:9981' },
  storage_key: 'originals/dd/' + 'd'.repeat(64), content_hash: 'sha256:' + 'd'.repeat(64), extracted: { text_chars: 380, chunks: 1, format: 'eml', from: 'aigerim@kmg.example', thread_id: 'thread-77', ingest: { version: 2, status: 'ok', at: '2026-10-01T09:01:00.000Z' } } };
const EMAIL_TEXT = 'Dear Chris,\n\nThank you for the screening letter. Which price deck did the base case use, and is the pilot sensitivity on Brent or on a flat deck?\n\nRegards,\nAigerim';
const RUN_RECORD = {
  id: RUN, job: 'opportunity-register', tool_version: '2.2.0', tool_commit: '3fa9c1e', author: 'chris', created_at: '2026-09-28T14:12:00Z', project_id: PID, legal_tag: 'lt-firm',
  title: 'Waterflood screen, base case', status: 'final', supersedes: RUN_OLD, input_hash: 'sha256:' + 'a'.repeat(64),
  inputs: [{ ref: 'ref:price_decks/brent-2026-06', kind: 'reference' }, { ref: 'doc:' + DOC, kind: 'item' }],
  outputs: { technical_potential_bopd: { value: 12400, unit: 'bopd' }, npv10: { value: 58.3, unit: 'USD MM' }, irr: { value: 0.21 }, method: { value: 'Analogue recovery factor' } },
  assumptions: { oil_price: { value: 70, unit: 'USD/bbl', source: 'ref:price_decks/brent-2026-06', provenance: 'reference' }, recovery_factor: { value: 0.32, source: 'analogue set 4', provenance: 'analogue' }, opex: { value: 12, unit: 'USD/bbl', provenance: 'assumed' } },
};
const RUN_OLD_RECORD = { ...RUN_RECORD, id: RUN_OLD, tool_version: '2.1.0', title: 'Waterflood screen, first pass', status: 'superseded', supersedes: null, created_at: '2026-09-10T14:12:00Z',
  outputs: { technical_potential_bopd: { value: 11800, unit: 'bopd' }, npv10: { value: 48.1, unit: 'USD MM' }, irr: { value: 0.19 } } };
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
const CATALOG = { tools: [{ id: 'opportunity-register', name: 'Opportunity Register', owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry: 'opportunity-register.html', produces: ['technical_potential_bopd', 'npv10', 'irr'], versions: [{ version: '2.2.0', released_at: '2026-09-22', commit: '3fa9c1e' }], aliases: { current: '2.2.0' }, releases: [], hub: { context: ['project'], param: 'project', toolbar: 10, live_version: null } }], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

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
const TEXTS = { [DOC]: DOC_TEXT, [LETTER]: LETTER_TEXT, [EMAIL]: EMAIL_TEXT };
const ITEMS = { [DOC]: ITEM, [LETTER]: LETTER_ITEM, [EMAIL]: EMAIL_ITEM, ...EXTRA };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page) {
  const calls = { text: [], rerun: [] };
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url()); const p = url.pathname; const m = route.request().method();
    const orig = /^\/api\/items\/([^/]+)\/original$/.exec(p);
    if (orig) { const b = BYTES[orig[1]]; return b ? route.fulfill({ status: 200, contentType: b[1], body: readFileSync(path.join(FILES, b[0])) }) : json(route, { error: { code: 'no_original', message: 'missing' } }, 404); }
    const it = /^\/api\/items\/([^/]+)$/.exec(p);
    if (it && ITEMS[it[1]]) {
      const rec = ITEMS[it[1]];
      if (url.searchParams.get('text') === '1') { calls.text.push(it[1]); return json(route, { ...rec, extracted: { ...rec.extracted, text: TEXTS[it[1]] || '' } }); }
      return json(route, rec);
    }
    if (it && it[1] === DOC_V1) return json(route, { ...ITEM, id: DOC_V1, version: 1, supersedes: null, title: 'SOW RevB' });
    if (p.startsWith('/api/items/') && p.endsWith('/versions')) return json(route, p.split('/')[3] === DOC ? VERSIONS : { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length + EXTRA_TL.length, entries: [...TIMELINE, ...EXTRA_TL] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, LINEAGE);
    if (p === '/api/projects/' + PID + '/contacts') return json(route, CONTACTS);
    if (p === '/api/projects/' + PID + '/research') return json(route, { project_id: PID, runs: [], findings: [], enabled: true });
    if (p === '/api/runs/' + RUN) return json(route, RUN_RECORD);
    if (p === '/api/runs/' + RUN_OLD) return json(route, RUN_OLD_RECORD);
    if (p === '/api/runs/' + RUN + '/rerun' && m === 'POST') { calls.rerun.push(RUN); return json(route, { id: NEW_RUN, parents: [RUN], changes: 2 }, 201); }
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [RUN_RECORD] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
async function openProject(page, query = '') { const calls = await stubApi(page); await page.goto('/hub/project.html?id=' + PID + query); await ready(page); return calls; }
const openDoc = (page, id = DOC) => page.locator(`.hub-tl-item[data-ref="doc:${id}"] .hub-tl-title`).click();

test('AC13 / R5: a document opens as a title, one meta line, its content and actions; versions and the raw record sit last, the JSON inside a closed Technical disclosure', async ({ page }) => {
  await openProject(page);
  await openDoc(page);
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#rp-kind')).toHaveText('Document');
  await expect(panel.locator('#rp-title')).toHaveText('ATC_Parker_Creek_Phase1_SOW_RevC sk copy.docx');
  // No UA focus rectangle on the title: the gold ring is on the panel.
  await expect(panel.locator('#rp-title')).toBeFocused();
  expect(await panel.locator('#rp-title').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  // One meta line: type · version · date · legal tag.
  const meta = panel.locator('[data-meta]');
  await expect(meta).toHaveCount(1);
  await expect(meta).toHaveText(/Report · v2 · 30 Sept 2026 · lt-firm/);
  // The order of the panel: meta, content, actions, related (versions, cites, used by), Technical.
  const order = await panel.locator('#rp-body > *').evaluateAll((els) => els.map((e) => e.getAttribute('data-part') || e.tagName.toLowerCase()));
  expect(order).toEqual(['meta', 'view', 'actions', 'related', 'technical']);
  // A DOCX: the extracted text, in Barlow at 15 px.
  const text = panel.locator('[data-view] [data-text]');
  await expect(text).toContainText('The Parker Creek phase 1 scope covers the waterflood screen');
  expect(await text.evaluate((el) => [getComputedStyle(el).fontFamily, getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight])).toEqual([expect.stringMatching(/Barlow/), '15px', '22.5px']);
  // Actions: Open original, Download, Cite (no reply for a report).
  const actions = panel.locator('[data-actions]');
  await expect(actions.locator('[data-action="open"]')).toHaveAttribute('href', '/api/items/' + DOC + '/original');
  await expect(actions.locator('[data-action="download"]')).toHaveAttribute('href', '/api/items/' + DOC + '/original?download=1');
  await expect(actions.locator('[data-action="cite"]')).toHaveText('Cite');
  await expect(actions.locator('[data-action="reply"]')).toHaveCount(0);
  // Related cards: versions, cites, used by.
  const rel = panel.locator('[data-related]');
  expect(await rel.evaluateAll((els) => els.map((e) => e.getAttribute('data-related')))).toEqual(['versions', 'cites', 'cited-by']);
  await expect(panel.locator('[data-related="versions"]')).toContainText('2 versions');
  await expect(panel.locator('[data-related="versions"] li')).toHaveCount(2);
  await expect(panel.locator('[data-related="versions"] li').first()).toContainText('v2');
  await expect(panel.locator('[data-related="versions"] li').first()).toContainText('30 Sept 2026');
  await expect(panel.locator('[data-related="cites"] li button')).toHaveText('Waterflood screen, base case');
  await expect(panel.locator('[data-related="cited-by"] li')).toContainText('Waterflood screen, base case');
  // Technical: closed; holds the format, hash, storage key, chunks and the JSON. Nothing of it above the content.
  const det = panel.locator('details.hub-rp-details[data-technical]');
  await expect(det).toHaveCount(1);
  expect(await det.evaluate((d) => d.open)).toBe(false);
  await expect(det.locator('summary')).toHaveText('Technical');
  await expect(panel.locator('.hub-json')).toBeHidden();
  await det.locator('summary').click();
  await expect(det).toContainText('docx');
  await expect(det).toContainText('sha256:bae50dea');
  await expect(det).toContainText('originals/ba/');
  await expect(det).toContainText('14 chunks · 9 pages · 20,512 characters');
  await expect(panel.locator('.hub-json')).toBeVisible();
  await expect(panel.locator('.hub-json')).toContainText('"storage_key": "originals/ba/');
  await expect(panel).not.toContainText('JSON summary');
  await expect(panel).not.toContainText('Full record');
  // A related card pivots: clicking the cited run opens that run in the same panel.
  await panel.locator('[data-related="cites"] li button').click();
  await expect(panel.locator('#rp-kind')).toHaveText('Run');
  await expect(panel.locator('#rp-title')).toHaveText('Waterflood screen, base case');
});

test('W7-AC8: an email and a letter show their extracted text; opened from Find the term is highlighted and the first match scrolled into view; Write a reply opens Write to… on the thread; Cite copies [doc:<id>]', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const calls = await openProject(page, '&doc=' + EMAIL + '&q=price+deck');
  const panel = page.locator('#record-panel');
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + EMAIL);
  await expect(panel.locator('[data-meta]')).toHaveText(/Email · v1 · 1 Oct 2026 · lt-firm/);
  const text = panel.locator('[data-view] [data-text]');
  await expect(text).toContainText('Which price deck did the base case use');
  expect(calls.text).toContain(EMAIL);
  // The Find term is highlighted (every word), the first match is the anchor and is in view.
  const marks = text.locator('mark');
  await expect(marks).toHaveCount(2);
  await expect(marks.first()).toHaveText('price deck');
  await expect(marks.first()).toHaveAttribute('data-anchor', '');
  expect(await marks.first().evaluate((m) => { const r = m.getBoundingClientRect(), b = m.closest('.hub-panel-body').getBoundingClientRect(); return r.top >= b.top && r.bottom <= b.bottom; })).toBe(true);
  // Line breaks survive as paragraphs; nothing is rendered as markup.
  expect(await text.locator('p').count()).toBeGreaterThanOrEqual(3);
  // Write a reply: Write to… opens as an email to the sender's contact, with the thread named in the brief.
  await panel.locator('[data-actions] [data-action="reply"]').click();
  const draft = page.locator('#p-draft');
  await expect(draft).toBeVisible();
  await expect(draft).toHaveAttribute('data-reply', EMAIL);
  await expect(draft.locator('#dr-kind')).toHaveValue('email');
  await expect(draft.locator('#dr-to')).toHaveValue('aigerim');
  await expect(draft.locator('#dr-brief')).toHaveValue(/Reply to "RE: Waterflood screen, questions on the price deck"/);
  await draft.locator('#dr-close').click();
  await expect(draft).toBeHidden();
  // The letter: its text, and Cite copies the reference.
  await openDoc(page, LETTER);
  await expect(panel.locator('[data-meta]')).toHaveText(/Letter · v1 · 29 Sept 2026 · lt-firm/);
  await expect(panel.locator('[data-view] [data-text]')).toContainText('technical potential of 12,400 bopd');
  await expect(panel.locator('[data-view] [data-text] mark')).toHaveCount(0);        // not opened from Find
  await panel.locator('[data-actions] [data-action="cite"]').click();
  await expect(panel.locator('[data-actions] [data-action="cite"]')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('[doc:' + LETTER + ']');
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(panel.locator('[data-meta]')).toContainText('Carta');
  await expect(panel.locator('details.hub-rp-details summary')).toHaveText('Técnico');
  mkdirSync(EVIDENCE7, { recursive: true });
  await page.locator('.nav-lang button[data-lang="en"]').click();
  await page.screenshot({ path: path.join(EVIDENCE7, 'w7-record-desk.png') });
});

test('W7-AC8: a run opens with its outputs as a two-column table using the manifest labels and units, assumptions with provenance dots, inputs as links, and Open in tool, Re-run, Compare with previous', async ({ page }) => {
  const calls = await openProject(page);
  await page.locator(`.hub-tl-item[data-ref="run:${RUN}"] .hub-tl-title`).click();
  const panel = page.locator('#record-panel');
  await expect(panel.locator('[data-meta]')).toContainText('Final');
  await expect(panel.locator('[data-meta] a[data-m="tool"]')).toHaveText('Opportunity Register 2.2.0');
  await expect(panel.locator('[data-meta] a[data-m="tool"]')).toHaveAttribute('href', '/hub/tool.html?id=opportunity-register');
  await expect(panel.locator('[data-meta]')).toContainText('28 Sept 2026');
  // Outputs: in the manifest's order, a label per key, the figure tabular with the unit in small caps after it.
  const rows = panel.locator('table[data-outputs] tbody tr');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((trs) => trs.map((tr) => [tr.querySelector('th').textContent, tr.querySelector('.hub-num').textContent, (tr.querySelector('.hub-unit') || {}).textContent || '']))).toEqual([
    ['Technical potential', '12,400', 'bopd'], ['NPV10', '58.3', 'USD MM'], ['IRR', '0.21', ''],
  ]);
  expect(await rows.first().locator('.hub-num').evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  await expect(panel.locator('[data-outputs-method]')).toContainText('Analogue recovery factor');
  // Assumptions with a provenance dot each.
  const as = panel.locator('table[data-assumptions] tbody tr');
  await expect(as).toHaveCount(3);
  expect(await as.evaluateAll((trs) => trs.map((tr) => tr.querySelector('[data-provenance]').getAttribute('data-provenance')))).toEqual(['reference', 'analogue', 'assumed']);
  await expect(as.first()).toContainText('Oil price');
  await expect(as.first().locator('.hub-num')).toHaveText('70');
  await expect(as.first().locator('.hub-unit')).toHaveText('USD/bbl');
  await expect(panel.locator('[data-legend] [data-provenance="reference"]')).toHaveCount(1);
  // Inputs as links: the document pivots, the reference set is named.
  const inputs = panel.locator('[data-inputs] li');
  await expect(inputs).toHaveCount(2);
  await expect(inputs.nth(0)).toContainText('price_decks/brent-2026-06');
  await expect(inputs.nth(1).locator('button[data-pivot]')).toHaveText('ATC_Parker_Creek_Phase1_SOW_RevC sk copy.docx');
  // Actions.
  const actions = panel.locator('[data-actions]');
  await expect(actions.locator('a[data-action="open-tool"]')).toHaveAttribute('href', /opportunity-register\.html\?project=kaz-brownfield&run=/);
  await expect(actions.locator('[data-action="rerun"]')).toHaveText('Re-run');
  await expect(actions.locator('[data-action="compare"]')).toHaveText('Compare with previous');
  // Compare with previous: a table of this run against the one it supersedes, with signed deltas.
  await actions.locator('[data-action="compare"]').click();
  const cmp = panel.locator('table[data-compare] tbody tr');
  await expect(cmp).toHaveCount(3);
  await expect(cmp.nth(1)).toContainText('NPV10');
  expect(await cmp.nth(1).locator('td').evaluateAll((tds) => tds.map((t) => t.textContent.trim()))).toEqual(['48.1 USD MM', '58.3 USD MM', '+10.2 (+21%)']);
  await expect(cmp.nth(1).locator('[data-delta]')).toHaveAttribute('data-delta', 'up');
  // Re-run: posts once and links the new run.
  await actions.locator('[data-action="rerun"]').click();
  await expect.poll(() => calls.rerun.length).toBe(1);
  await expect(actions.locator('[data-rerun-done]')).toHaveAttribute('href', '/hub/project.html?id=' + PID + '&run=' + NEW_RUN);
  await expect(actions.locator('[data-rerun-done]')).toContainText('2 changed');
  // Related: supersession and who quotes it; the raw record behind Technical.
  expect(await panel.locator('[data-related]').evaluateAll((els) => els.map((e) => e.getAttribute('data-related')))).toEqual(['supersedes', 'cited-by']);
  await expect(panel.locator('[data-related="supersedes"]')).toContainText('Waterflood screen, first pass');
  await expect(panel.locator('[data-related="cited-by"] li')).toHaveCount(2);
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

test('AC14: the sheet closes when the scrim is tapped, and the panel is bilingual; evidence of the sheet on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProject(page);
  await page.locator('.nav-lang button[data-lang="es"]').click();         // the sheet would cover the language switch
  await openDoc(page);
  await expect(page.locator('#record-panel [data-meta]')).toContainText('Informe');
  await expect(page.locator('#record-panel details.hub-rp-details summary')).toHaveText('Técnico');
  await page.locator('#record-scrim').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#record-panel')).toBeHidden();
  await page.locator('.nav-lang button[data-lang="en"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await openProject(page);
  await openDoc(page, LETTER);
  await expect(page.locator('#record-panel [data-view] [data-text]')).toBeVisible();
  mkdirSync(EVIDENCE7, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE7, 'w7-record-phone.png') });
});

test('AC18: evidence screenshot of the record sheet on an iPad-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openProject(page);
  await openDoc(page);
  await expect(page.locator('#record-panel [data-meta]')).toBeVisible();
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w2-record-sheet-ipad.png') });
});

test('W5-AC3: the content shows a PDF on canvas, an image inline, a workbook as tables with sheet tabs, and says when the original is missing', async ({ page }) => {
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
  await expect(panel.locator('[data-actions] [data-action="download"]')).toHaveAttribute('href', '/api/items/' + PDF + '/original?download=1');
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
  // Word: the extracted text, with Download beside it.
  await open(DOC);
  await expect(panel.locator('[data-view] [data-text]')).toContainText('Deliverables: a screening letter');
  await expect(panel.locator('[data-actions] [data-action="download"]')).toHaveAttribute('href', '/api/items/' + DOC + '/original?download=1');
  // No original.
  await open(NONE);
  await expect(panel.locator('[data-view]')).toContainText('Original missing');
  await expect(panel.locator('.hub-viewer')).toHaveCount(0);
});
