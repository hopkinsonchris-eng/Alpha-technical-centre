// Wave 5, PR 3 (docs/vault-hub/wave5/05-markup.md §1.3, W5-AC4, AC5, AC7): Write to… on the project page.
// The API is stubbed with page.route; the static server serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const ANA = { id: 'ana', name: 'Ana', email: 'ana@alpha-technical-centre.com', role: 'associate' };
const PID = 'hte-apure';
const DRAFT_ID = '00000000-0000-4000-8000-00000000d001', RUN = '00000000-0000-4000-8000-0000000000c1', LETTER = '00000000-0000-4000-8000-000000000056', FINDING = '00000000-0000-4000-8000-000000000a01';
const PROJECT = {
  id: PID, client_id: 'hte', name: 'High Tech Electronica', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'], contacts: [],
  created_at: '2026-09-30T09:00:00.000Z', closed_at: null, country: 'VE', lat: 7.6, lon: -70.9, stage: 'Initial screen', stage_history: [], register: { holder: 'Petrolera Zuata', partners: ['Chevron Venezuela'] },
};
const CONTACTS = { project_id: PID, client_id: 'hte', contacts: [
  { id: 'maria-fernandez', name: 'Ing. María Fernández', role: 'Gerente de Nuevos Negocios', emails: ['maria@zuata.example'], language: 'es', organisation: { id: 'zuata', name: 'Petrolera Zuata S.A.', kind: 'operator', counterparty: 'holder' }, last_contact: '2026-09-12T10:00:00.000Z' },
  { id: 'tom-reed', name: 'Tom Reed', role: 'CFO', emails: ['tom@hte.example'], language: 'en', organisation: { id: 'hte', name: 'High Tech Electronica', kind: 'client', counterparty: 'client' }, last_contact: null },
  { id: 'x-outsider', name: 'Someone Else', role: null, emails: [], language: 'en', organisation: { id: 'other-co', name: 'Other Co', kind: 'vendor', counterparty: null }, last_contact: null },
], counterparties: [{ kind: 'holder', name: 'Petrolera Zuata', organisation_id: 'zuata' }, { kind: 'partner', name: 'Chevron Venezuela', organisation_id: null }] };
const DRAFT = (tone) => ({ id: DRAFT_ID, draft: '', paragraphs: [
  tone === 'shorter' ? 'Estimada María: production at Guafita restarted on 30 September [doc:' + FINDING + '].' : 'Estimada María: further to our letter of 8 July 2026 (ATC-2026-0131) [doc:' + LETTER + '], production at Guafita restarted on 30 September [doc:' + FINDING + '].',
  'Our screening gives a technical potential of 41,000 bopd [run:' + RUN + '].',
  '[QUESTION FOR YOU: this sentence carries a figure with no record in scope to cite: "The pipeline repair cost USD 2.3 million."]',
  'We would welcome the repair report when convenient.',
], citations: ['doc:' + LETTER, 'doc:' + FINDING, 'run:' + RUN], questions: ['The pipeline repair cost USD 2.3 million.'], warnings: [], who_to_ask: [{ person: 'lars', last: '2026-09-20', on: 'opportunity-register' }],
  sources: [{ ref: 'doc:' + FINDING, title: 'PDVSA restarts Apure production after pipeline repair', why: 'research finding', snippet: 'PDVSA restarted Apure production this week after a pipeline repair.' }, { ref: 'run:' + RUN, title: 'Waterflood screen, base case', why: 'Our screening' }],
  context: { organisation: { id: 'zuata', name: 'Petrolera Zuata S.A.' }, contacts: [], dispatches: [{ item_id: LETTER, title: 'Letter ATC-2026-0131: clarification', direction: 'out', occurred_at: '2026-07-08T09:00:00.000Z', reference_no: 'ATC-2026-0131' }], contracts: [], runs: [{ id: RUN, title: 'Waterflood screen, base case', job: 'opportunity-register' }], lessons: [], sub_queries: [], letterhead: null } });
const ITEM = (id, title) => ({ id, type: 'note', title, created_at: '2026-10-01T12:30:00.000Z', authored_at: '2026-09-30T00:00:00.000Z', authors: ['research'], client_id: null, project_id: PID, asset_ids: [], organisation_ids: [], legal_tag: 'lt-public', origin: { source: 'research' }, storage_key: null, mime: null, content_hash: 'sha256:' + 'a'.repeat(64), version: 1, supersedes: null, cites: [], filing: {}, extracted: { kind: 'research', quote: 'PDVSA restarted Apure production this week after a pipeline repair.' }, stale: false, tags: [] });
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubApi(page, { me = PARTNER } = {}) {
  const calls = { drafts: [], reviews: [], renders: [], sent: [] };
  let timeline = [];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
    const body = () => (route.request().postData() ? JSON.parse(route.request().postData()) : {});
    if (p === '/api/me') return json(route, me);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/contacts') return json(route, CONTACTS);
    if (p === '/api/draft' && m === 'POST') { const b = body(); calls.drafts.push(b); return json(route, DRAFT(b.tone), 201); }
    if (p === '/api/items/' + DRAFT_ID + '/review' && m === 'PATCH') { calls.reviews.push(body()); return json(route, { id: DRAFT_ID, review: body() }); }
    if (p === '/api/render' && m === 'POST') { calls.renders.push(u.search); if (u.search.includes('pdf')) return json(route, { error: { code: 'error', message: 'Chromium not found' } }, 500); return route.fulfill({ status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': 'attachment; filename="ATC-2026-0152.docx"' }, body: Buffer.from('PK-docx') }); }
    if (p === '/api/items/' + DRAFT_ID + '/sent' && m === 'POST') { calls.sent.push(body()); timeline = [{ kind: 'item', ref: 'doc:' + DRAFT_ID, id: DRAFT_ID, at: '2026-10-03T10:00:00.000Z', title: 'Email draft: restart', type: 'note', version: 1, legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null, sent: { organisation: 'Petrolera Zuata S.A.', at: '2026-10-03T10:00:00.000Z' } }]; return json(route, { id: 'd-1', item_id: DRAFT_ID, direction: 'out', organisation_id: 'zuata', contact_ids: ['maria-fernandez'], channel: 'email', occurred_at: '2026-10-03T10:00:00.000Z', signed_by: 'chris' }, 201); }
    if (p === '/api/items/' + FINDING) return json(route, ITEM(FINDING, 'PDVSA restarts Apure production after pipeline repair'));
    if (p === '/api/items/' + LETTER) return json(route, { ...ITEM(LETTER, 'Letter ATC-2026-0131: clarification'), type: 'letter', extracted: {} });
    if (p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: timeline.length, entries: timeline });
    if (p === '/api/projects/' + PID + '/research') return json(route, { project_id: PID, runs: [], findings: [], enabled: true });
    for (const tail of ['/assets', '/vintages', '/lineage', '/stale', '/lessons', '/scorecard', '/basis']) if (p === '/api/projects/' + PID + tail) return json(route, { project_id: PID, assets: [], vintages: [], nodes: [], edges: [], runs: [], items: [], lessons: [], rules: [] });
    if (p === '/api/queue/review') return json(route, { items: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('W5-AC4/AC5/AC7: Write to… picks the recipient, shows what the draft does not know first, chips open the passage, the uncited sentence gates rendering, keep/drop and tone survive, save, render and mark as sent', async ({ page }) => {
  const calls = await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const btn = page.locator('#p-draft-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  const panel = page.locator('#p-draft');
  await expect(panel).toBeVisible();
  // Recipients: grouped by organisation with the counterparty role and the last contact; a counterparty without a contact is named.
  const to = panel.locator('#dr-to');
  await expect(to.locator('optgroup')).toHaveCount(3);
  await expect(to.locator('optgroup').first()).toHaveAttribute('label', 'Petrolera Zuata S.A. · current owner');
  await expect(to.locator('option[value="maria-fernandez"]')).toHaveText('Ing. María Fernández, Gerente de Nuevos Negocios · last contact 12 Sept 2026');
  await expect(panel.locator('#dr-nocontact [data-counterparty="partner"]')).toContainText('Chevron Venezuela (JV partner): no contact yet.');
  await to.selectOption('x-outsider');
  await expect(panel.locator('#dr-scope .hub-notice.warn')).toContainText('Other Co is not the client, the current owner, a partner or the government');
  await to.selectOption('maria-fernandez');
  await expect(panel.locator('#dr-scope .hub-notice')).toHaveCount(0);
  // Draft.
  await panel.locator('#dr-kind').selectOption('email');
  await panel.locator('#dr-lang').selectOption('es');
  await panel.locator('#dr-brief').fill('Tell her production restarted and ask for the pipeline repair report.');
  await panel.locator('#dr-go').click();
  await expect.poll(() => calls.drafts.length).toBe(1);
  expect(calls.drafts[0]).toEqual({ kind: 'email', project_id: PID, brief: 'Tell her production restarted and ask for the pipeline repair report.', language: 'es', organisation_id: 'zuata' });
  const result = panel.locator('#dr-result');
  await expect(result).toBeVisible();
  // What it does not know comes first, with who to ask.
  const unknown = result.locator('.hub-dr-unknown');
  await expect(unknown).toHaveAttribute('data-questions', '1');
  await expect(unknown.locator('li').first()).toContainText('The pipeline repair cost USD 2.3 million.');
  await expect(unknown.locator('li a')).toHaveText('Ask lars');
  expect(await result.evaluate((el) => el.firstElementChild.className)).toBe('hub-dr-unknown');
  // Chips: one per citation, naming the record; the uncited sentence is amber and undecided, so rendering is gated.
  const paras = result.locator('.hub-dr-para');
  await expect(paras).toHaveCount(4);
  await expect(paras.nth(0).locator('.hub-cite')).toHaveText(['Letter ATC-2026-0131: clarification', 'PDVSA restarts Apure production after pipeline repair']);
  await expect(paras.nth(2).locator('[data-uncited]')).toContainText('No record to cite: The pipeline repair cost USD 2.3 million.');
  await expect(result).toHaveAttribute('data-uncited', '1');
  await expect(result.locator('#dr-render')).toBeDisabled();
  await expect(result.locator('.hub-dr-source-list li[data-ref="doc:' + LETTER + '"] .hub-pill')).toHaveText('prior correspondence');
  // A chip opens the record panel with the passage at the top.
  await paras.nth(0).locator('.hub-cite').nth(1).click();
  const rp = page.locator('#record-panel');
  await expect(rp).toBeVisible();
  await expect(rp.locator('[data-passage]')).toContainText('PDVSA restarted Apure production this week after a pipeline repair.');
  await expect(rp.locator('#rp-title')).toHaveText('PDVSA restarts Apure production after pipeline repair');
  await page.keyboard.press('Escape');
  // Decide: keep with a note on the figure, keep the uncited sentence as my own words, drop the last paragraph.
  await paras.nth(1).locator('[data-decide="keep-note"]').click();
  await paras.nth(1).locator('input[data-note]').fill('check the unit');
  await paras.nth(2).locator('[data-decide="keep-note"]').click();
  await paras.nth(3).locator('[data-decide="drop"]').click();
  await expect(result).toHaveAttribute('data-uncited', '0');
  await expect(result.locator('#dr-render')).toBeEnabled();
  await expect(paras.nth(3)).toHaveAttribute('data-decision', 'drop');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w5-write-to.png'), fullPage: false });
  // Tone re-draft carries the previous draft; decisions reset for the new text.
  await result.locator('[data-tone="shorter"]').click();
  await expect.poll(() => calls.drafts.length).toBe(2);
  expect(calls.drafts[1].tone).toBe('shorter'); expect(calls.drafts[1].previous).toContain('further to our letter');
  await expect(result.locator('.hub-dr-para').nth(0)).toContainText('Estimada María: production at Guafita restarted');
  await expect(result.locator('#dr-render')).toBeDisabled();
  await result.locator('.hub-dr-para').nth(2).locator('[data-decide="drop"]').click();
  await result.locator('.hub-dr-para').nth(3).locator('[data-decide="drop"]').click();
  // Save the review, render the DOCX (PDF reports the missing renderer), mark as sent.
  await result.locator('#dr-save').click();
  await expect.poll(() => calls.reviews.length).toBe(1);
  expect(calls.reviews[0].decisions).toEqual(['keep', 'keep', 'drop', 'drop']);
  expect(calls.reviews[0].citations_opened).toBe(1);
  await result.locator('#dr-pdf').click();
  await expect(result.locator('#dr-status')).toContainText('PDF needs Chromium on the server');
  const dl = page.waitForEvent('download');
  await result.locator('#dr-render').click();
  expect((await dl).suggestedFilename()).toBe('ATC-2026-0152.docx');
  await expect(result).toHaveAttribute('data-rendered', 'ATC-2026-0152');
  await expect(result.locator('#dr-sent')).toBeEnabled();
  await result.locator('#dr-sent').click();
  await expect.poll(() => calls.sent.length).toBe(1);
  expect(calls.sent[0]).toEqual({ organisation_id: 'zuata', contact_ids: ['maria-fernandez'], channel: 'email' });
  await expect(result.locator('#dr-status')).toContainText('Sent to Ing. María Fernández, Petrolera Zuata S.A. on 3 Oct 2026');
  await expect(result.locator('#dr-render')).toBeDisabled();
  await expect(result.locator('#dr-save')).toBeDisabled();
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(panel.locator('h3')).toHaveText('Escribir a…');
  await expect(unknown.locator('h4')).toHaveText('Lo que este borrador no sabe');
});

test('W5-AC7: the timeline shows a sent draft as sent; an associate who cannot write the project sees no Write to… button', async ({ page }) => {
  await stubApi(page);
  await page.route('**/api/projects/' + PID + '/timeline', (route) => json(route, { project_id: PID, count: 1, entries: [{ kind: 'item', ref: 'doc:' + DRAFT_ID, id: DRAFT_ID, at: '2026-10-03T10:00:00.000Z', title: 'Email draft: restart', type: 'note', version: 1, legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null, sent: { organisation: 'Petrolera Zuata S.A.', at: '2026-10-03T10:00:00.000Z' } }] }));
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('.hub-tl-item[data-ref="doc:' + DRAFT_ID + '"] [data-sent]')).toHaveText('sent to Petrolera Zuata S.A.');
  await stubApi(page, { me: ANA });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('#p-draft-btn')).toHaveCount(0);
});
