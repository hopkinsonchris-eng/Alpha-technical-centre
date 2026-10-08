// Wave 8 PR 4 (docs/vault-hub/wave8/03-indexing-and-ask.md, W8-AC18): Ask this project. A button beside Research opens a
// sheet; the question goes to POST /api/projects/:id/ask; the answer's citations are chips that open the record panel;
// the questions section appears only when there are questions; the sources list opens the panel too; a 503 reads as
// "not connected"; Spanish on request. The API is stubbed with page.route; no request leaves for the model provider.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'parker-creek';
const REPORT = u(701), LOG = u(702);
const PROJECT = {
  id: PID, client_id: null, name: 'Parker Creek', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'],
  created_at: '2026-10-07T09:21:53.525Z', closed_at: null, contacts: [], country: 'US', lat: null, lon: null, stage: 'Initial screen',
  stage_history: [{ stage: 'Initial screen', at: '2026-10-07T09:21:53.525Z', by: 'chris' }], register: {},
};
const ANSWER = {
  project_id: PID, question: 'How successful have re-perforations been?', language: 'en', model: 'fake-1', passages: 18,
  answer: [
    `Re-perforations succeeded in 7 of 9 wells in the 2019 campaign, restoring an average of 42 bopd per well [doc:${REPORT}].`,
    `The two failures were both in the lower zone, where the cement bond log showed channelling [doc:${LOG}]. The later 2021 attempt on Frost 2 was not repeated [doc:${REPORT}].`,
  ],
  questions: ['What did the 2019 campaign cost per well? (the files give no figure)'],
  citations: [`doc:${REPORT}`, `doc:${LOG}`],
  sources: [
    { ref: `doc:${REPORT}`, id: REPORT, name: 'Frost field re-perforation review 2019.pdf', type: 'report', date: '2019-11-02T00:00:00.000Z', cited: 2 },
    { ref: `doc:${LOG}`, id: LOG, name: 'Frost 2 cement bond log.pdf', type: 'report', date: '2019-06-14T00:00:00.000Z', cited: 1 },
  ],
  warnings: ['1 sentence(s) had no citation and were turned into questions for you'],
  usage: { input: 9000, cached: 0, output: 400 },
};
const ITEM = (id, title) => ({ id, type: 'report', title, created_at: '2026-10-07T17:34:46.357Z', authored_at: null, authors: [], client_id: null, project_id: PID, asset_ids: [], organisation_ids: [], legal_tag: 'lt-firm',
  origin: { source: 'zoho-workdrive' }, storage_key: 'originals/ab/' + id, mime: 'application/pdf', content_hash: 'sha256:' + 'a'.repeat(64), version: 1, supersedes: null, reference_no: null, filing: { method: 'path' },
  extracted: { filename: title, ingest: { status: 'ok', version: 1 }, chunks: 12 }, stale: false, tags: [], cites: [] });
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubApi(page, { ask } = {}) {
  const asked = []; const external = [];
  await page.route('**/*', (route) => {
    const h = new URL(route.request().url()).hostname;
    if (/anthropic|openai|voyageai|supabase/.test(h)) { external.push(route.request().url()); return route.abort(); }
    return route.fallback();
  });
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname; const m = route.request().method();
    if (p === '/api/projects/' + PID + '/ask' && m === 'POST') { const b = JSON.parse(route.request().postData()); asked.push(b); return ask ? ask(route, b) : json(route, { ...ANSWER, question: b.question, language: b.language || 'en' }); }
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/files') return json(route, { project_id: PID, count: 0, generated_at: '2026-10-08T07:00:00.000Z', index: { indexed: 0, waiting: 0, unsupported: 0, needs_ocr: 0, empty: 0, no_original: 0, queue_total: 0, per_run: 200, next_run_at: '2026-10-08T14:30:00.000Z' }, files: [] });
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: 0, entries: [] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/projects/' + PID + '/research') return json(route, { project_id: PID, runs: [], findings: [], enabled: true });
    if (p === '/api/items/' + REPORT) return json(route, ITEM(REPORT, 'Frost field re-perforation review 2019.pdf'));
    if (p === '/api/items/' + LOG) return json(route, ITEM(LOG, 'Frost 2 cement bond log.pdf'));
    if (p.startsWith('/api/items/') && p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p.startsWith('/api/items/') && p.endsWith('/index')) return json(route, { item_id: p.split('/')[3], version: 1, state: 'indexed', chunks: 12 });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/projects') return json(route, { projects: [PROJECT] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return { asked, external };
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('W8-AC18: Ask this project opens a sheet; the answer cites as chips that open the record panel; the questions and the sources are listed; nothing leaves for the provider', async ({ page }) => {
  const api = await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const btn = page.locator('#p-ask-btn');
  await expect(btn).toBeVisible();
  await expect(page.locator('#p-ask')).toBeHidden();
  await btn.click();
  const sheet = page.locator('#p-ask');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#ask-q')).toBeFocused();
  await page.locator('#ask-q').fill('How successful have re-perforations been?');
  await page.locator('#ask-go').click();
  await expect.poll(() => api.asked.length).toBe(1);
  expect(api.asked[0]).toEqual({ question: 'How successful have re-perforations been?', language: 'en' });
  const answer = sheet.locator('#ask-answer');
  await expect(answer.locator('p')).toHaveCount(2);
  await expect(answer).toContainText('7 of 9 wells');
  await expect(answer).not.toContainText('[doc:');
  const chips = answer.locator('[data-cite]');
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toHaveText('1');
  await expect(chips.nth(1)).toHaveText('2');
  await expect(chips.nth(0)).toHaveAttribute('data-cite', 'doc:' + REPORT);
  await expect(sheet.locator('#ask-questions li')).toHaveCount(1);
  await expect(sheet.locator('#ask-questions')).toContainText('cost per well');
  const sources = sheet.locator('#ask-sources li');
  await expect(sources).toHaveCount(2);
  await expect(sources.nth(0)).toContainText('Frost field re-perforation review 2019.pdf');
  await expect(sources.nth(0)).toContainText('cited twice');
  await expect(sources.nth(1)).toContainText('cited once');
  await expect(sheet.locator('#ask-meta')).toContainText('18 passages');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w8-ask.png'), fullPage: false });
  // A chip opens the record panel on the cited document.
  await chips.nth(1).click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + LOG);
  await expect(panel.locator('#rp-title')).toHaveText('Frost 2 cement bond log.pdf');
  expect(api.external).toEqual([]);
});

test('W8-AC18: a source row opens the panel; an answer without questions hides that section; Escape closes the sheet', async ({ page }) => {
  await stubApi(page, { ask: (route, b) => json(route, { ...ANSWER, question: b.question, questions: [], warnings: [] }) });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator('#p-ask-btn').click();
  await page.locator('#ask-q').fill('Which wells were re-perforated?');
  await page.keyboard.press('Control+Enter');
  const sheet = page.locator('#p-ask');
  await expect(sheet.locator('#ask-sources li')).toHaveCount(2);
  await expect(sheet.locator('#ask-questions')).toBeHidden();
  await sheet.locator('#ask-sources li').nth(0).locator('button').click();
  await expect(page.locator('#record-panel')).toHaveAttribute('data-ref', 'doc:' + REPORT);
  await page.keyboard.press('Escape');                                  // closes the panel first
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('W8-AC18: 503 reads as not connected, 400 as the message; Spanish on request', async ({ page }) => {
  let status = 503;
  await stubApi(page, { ask: (route) => json(route, status === 503 ? { error: { code: 'not_configured', message: 'The drafting assistant is not connected. Ask Chris.' } } : { error: { code: 'invalid', message: 'question is required' } }, status) });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator('#p-ask-btn').click();
  await page.locator('#ask-q').fill('Anything?');
  await page.locator('#ask-go').click();
  await expect(page.locator('#ask-status')).toContainText('not connected');
  status = 400;
  await page.locator('#ask-go').click();
  await expect(page.locator('#ask-status')).toContainText('question is required');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#p-ask-btn')).toContainText('Preguntar');
  await expect(page.locator('#ask-go')).toContainText('Preguntar');
});

test('W8-AC18 (ES): the question goes with language es and the sections read in Spanish', async ({ page }) => {
  const api = await stubApi(page, { ask: (route, b) => json(route, { ...ANSWER, question: b.question, language: b.language, answer: [`Las reperforaciones tuvieron éxito en 7 de 9 pozos [doc:${REPORT}].`], questions: [], warnings: [] }) });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await page.locator('#p-ask-btn').click();
  await page.locator('#ask-q').fill('¿Qué éxito han tenido las reperforaciones?');
  await page.locator('#ask-go').click();
  await expect.poll(() => api.asked.length).toBe(1);
  expect(api.asked[0].language).toBe('es');
  await expect(page.locator('#ask-answer')).toContainText('7 de 9 pozos');
  await expect(page.locator('#ask-sources-h')).toHaveText('Fuentes');
  await expect(page.locator('#ask-sources li').nth(0)).toContainText('citado 2 veces');
});
