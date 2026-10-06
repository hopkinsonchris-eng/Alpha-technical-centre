// Wave 7 PR2 (docs/vault-hub/wave7/05-markup.md §1.3, W7-AC6 header part, R1, R6, R12): the project header is
// the stateline component in 'full' size, directly under the H1, built from the project row plus the newest
// timeline entry; every token is a link that lands on the thing it names; three actions sit right-aligned and
// Archive lives in an overflow menu behind a confirm sheet. The tab strip is sticky under the stateline and the
// file is one disclosure. The API is stubbed with page.route; the static server serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'llanos-waterflood';
const EMAIL = u(501), LETTER = u(502), RUN = u(601), RUN_OLD = u(600);

const PROJECT = {
  id: PID, client_id: 'frontera', name: 'Llanos Basin waterflood screening', status: 'active', default_legal_tag: 'lt-frontera-nda-2026', asset_ids: [], members: ['chris', 'ana'],
  created_at: '2026-09-01T09:00:00.000Z', closed_at: null, contacts: ['jorge-ruiz'], country: 'CO', lat: 4.3, lon: -72.9, stage: 'Technical review',
  stage_history: [{ stage: 'Initial screen', at: '2026-09-01T09:00:00.000Z', by: 'chris' }, { stage: 'Technical review', at: '2026-09-12T10:00:00.000Z', by: 'chris' }],
  register: { source: 'Client', owner: 'Chris', next: 'Issue screening letter to Frontera by 10 Oct', thesis: 'Mature Cubiro and Castilla fields with waterflood upside.', holder: 'Frontera Energy', government: 'ANH', current: 3200, plan: 5400 },
};
const ORG = { id: 'frontera', name: 'Frontera Energy Corp.', kind: 'client', contacts: [{ id: 'jorge-ruiz', name: 'Jorge Ruiz', role: 'VP Subsurface', emails: ['jruiz@fronteraenergy.com'], language: 'en' }] };
const ORG_FILE = { organisation: ORG, contracts_in_force: [{ type: 'nda', legal_tag: 'lt-frontera-nda-2026', expiry: '2027-03-31', reference_no: 'NDA-2026-07' }], dispatches: [] };
const CONTACTS = { project_id: PID, client_id: 'frontera', contacts: [{ id: 'jorge-ruiz', name: 'Jorge Ruiz', role: 'VP Subsurface', emails: ['jruiz@fronteraenergy.com'], language: 'en', organisation: { id: 'frontera', name: 'Frontera Energy Corp.', kind: 'client', counterparty: 'client' }, last_contact: '2026-10-05T09:06:00.000Z' }], counterparties: [] };
const TIMELINE = [
  { kind: 'item', ref: 'doc:' + EMAIL, id: EMAIL, at: '2026-10-05T09:06:00.000Z', title: 'RE: Cubiro screening letter', type: 'email', version: 1, legal_tag: 'lt-frontera-nda-2026', stale: false, stale_reasons: [], supersedes: null, superseded_by: null },
  { kind: 'item', ref: 'doc:' + LETTER, id: LETTER, at: '2026-10-01T13:54:00.000Z', title: 'Letter ATC-2026-0142 to Frontera: Cubiro screening', type: 'letter', version: 1, reference_no: 'ATC-2026-0142', legal_tag: 'lt-frontera-nda-2026', stale: true, stale_reasons: ['cited run superseded'], supersedes: null, superseded_by: null },
  { kind: 'run', ref: 'run:' + RUN, id: RUN, at: '2026-09-28T14:12:00.000Z', title: 'Cubiro screen, base case', job: 'nodal-analysis', tool_version: '1.2.0', status: 'final', legal_tag: 'lt-frontera-nda-2026', stale: false, stale_reasons: [], supersedes: RUN_OLD, superseded_by: null },
  { kind: 'run', ref: 'run:' + RUN_OLD, id: RUN_OLD, at: '2026-09-10T14:12:00.000Z', title: 'Cubiro screen, first pass', job: 'nodal-analysis', tool_version: '1.1.0', status: 'superseded', legal_tag: 'lt-frontera-nda-2026', stale: false, stale_reasons: [], supersedes: null, superseded_by: RUN },
];
const tool = (id, name, entry, toolbar) => ({ id, name, owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry, produces: [], versions: [{ version: '1.0.0', released_at: '2026-09-01', commit: 'abc1234' }], aliases: { current: '1.0.0' }, releases: [], hub: { context: ['project'], param: 'project', toolbar, live_version: null } });
const CATALOG = { tools: [tool('opportunity-register', 'Opportunity Register', 'opportunity-register.html', 10), tool('nodal-analysis', 'Nodal Analysis', 'nodal-analysis-tool.html', 20), tool('plan-your-job', 'Plan Your Job', 'plan-your-job.html', 60)], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
const ITEM = (id, title, type) => ({ id, type, title, created_at: '2026-10-05T09:06:00.000Z', authored_at: null, authors: [], client_id: 'frontera', project_id: PID, asset_ids: [], organisation_ids: ['frontera'], legal_tag: 'lt-frontera-nda-2026', origin: { source: 'mail' }, storage_key: 'originals/aa/' + id.replace(/-/g, ''), mime: 'message/rfc822', content_hash: 'sha256:' + 'a'.repeat(64), version: 1, supersedes: null, cites: [], filing: {}, extracted: { text_chars: 300, chunks: 1, format: 'eml', ingest: { version: 2, status: 'ok', at: '2026-10-05T09:07:00.000Z' } }, stale: false, tags: [] });

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, { project = PROJECT, delayProject = 0 } = {}) {
  const patched = [];
  let current = project;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname; const m = route.request().method();
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) {
      if (m === 'PATCH') {
        const b = JSON.parse(route.request().postData()); patched.push(b);
        const noted = b.status === 'archived' ? { status_before_archive: current.status } : {};     // the Vault notes the status at archive time (S14)
        current = { ...current, ...b, register: { ...current.register, ...noted, ...(b.register || {}) } };
        // The Vault (migration 008) returns stage_changed_at with the new history entry; without it the page would say "since today" and the test would drift with the calendar.
        if (b.stage && b.stage !== project.stage) { current.stage_changed_at = '2026-10-05T11:00:00.000Z'; current.stage_history = [...project.stage_history, { stage: b.stage, at: '2026-10-05T11:00:00.000Z', by: 'chris' }]; }
        return json(route, current);
      }
      if (delayProject) await new Promise((r) => setTimeout(r, delayProject));
      return json(route, current);
    }
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length, entries: TIMELINE });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/projects/' + PID + '/contacts') return json(route, CONTACTS);
    if (p === '/api/projects/' + PID + '/assets') return json(route, { project_id: PID, assets: [{ id: 'field:co:cubiro', name: 'Cubiro', kind: 'field', dossier: [] }, { id: 'field:co:castilla', name: 'Castilla', kind: 'field', dossier: [] }] });
    if (p === '/api/projects/' + PID + '/research') return json(route, { project_id: PID, runs: [], findings: [], enabled: true });
    if (p === '/api/organisations/frontera') return json(route, ORG);
    if (p === '/api/organisations/frontera/file') return json(route, ORG_FILE);
    if (p === '/api/items/' + EMAIL) return json(route, ITEM(EMAIL, 'RE: Cubiro screening letter', 'email'));
    if (p === '/api/items/' + LETTER) return json(route, { ...ITEM(LETTER, 'Letter ATC-2026-0142 to Frontera: Cubiro screening', 'letter'), mime: 'text/plain', stale: true });
    if (p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/queue/review') return json(route, { items: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return patched;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const open = async (page, opts) => { const patched = await stubApi(page, opts); await page.goto('/hub/project.html?id=' + PID); await ready(page); return patched; };
const sl = (page) => page.locator('#p-stateline [data-stateline="full"]');
const token = (page, t) => sl(page).locator('[data-token="' + t + '"]');

test('W7-AC6: the header is the stateline component in full size, directly under the H1, with every token linking to what it names', async ({ page }) => {
  await open(page);
  const line = sl(page);
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute('data-project', PID);
  await expect(line).toHaveAttribute('data-stage', 'Technical review');
  // Directly under the H1: the stateline host is the H1's next element.
  expect(await page.locator('h1#p-title').evaluate((h) => h.nextElementSibling && h.nextElementSibling.id)).toBe('p-stateline');
  // The stage token holds the stage select (it opens as a native popover) and says since when.
  const stage = token(page, 'stage');
  await expect(stage).toContainText('since 12 Sept 2026');
  await expect(stage.locator('#p-stage')).toHaveValue('Technical review');
  // Next, Last, NDA, counts: each a link into the page at the thing it names.
  await expect(token(page, 'next')).toContainText('Issue screening letter to Frontera by 10 Oct');
  await expect(token(page, 'next')).toContainText('Chris');
  await expect(token(page, 'next')).toHaveAttribute('href', /#next$/);
  await expect(token(page, 'last')).toContainText('RE: Cubiro screening letter');
  await expect(token(page, 'last')).toContainText('5 Oct');
  await expect(token(page, 'last')).toHaveAttribute('href', new RegExp('#rec=doc(:|%3A)' + EMAIL + '$'));
  await expect(token(page, 'nda')).toHaveText('NDA to 31 Mar 2027');
  await expect(token(page, 'nda')).toHaveAttribute('href', /#file$/);
  await expect(token(page, 'runs')).toHaveText('1 run');
  await expect(token(page, 'runs')).toHaveAttribute('href', /#tab-runs$/);
  await expect(token(page, 'docs')).toHaveText('2 docs');
  await expect(token(page, 'docs')).toHaveAttribute('href', /#tab-docs$/);
  await expect(token(page, 'stale')).toHaveText('1 stale');
  await expect(token(page, 'stale')).toHaveAttribute('href', /#stale$/);
  // No Playfair below the H1: the stateline is Barlow Condensed.
  expect(await line.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Barlow Condensed/);
  // The crumb names the project.
  await expect(page.locator('.hub-crumb')).toContainText('Llanos Basin waterflood screening');
});

test('W7-AC6: each token lands on the thing it names: stage focuses the select, next opens the register editor on Next step, last opens the record, NDA opens the File disclosure, counts select the timeline with the filter', async ({ page }) => {
  await open(page);
  // #next → the File disclosure opens, the register editor opens on the Next step field.
  await token(page, 'next').click();
  await expect(page.locator('#p-file-wrap')).toHaveAttribute('open', '');
  await expect(page.locator('#op-next')).toBeVisible();
  await expect(page.locator('#op-next')).toBeFocused();
  await expect(page.locator('#op-next')).toHaveValue('Issue screening letter to Frontera by 10 Oct');
  // #rec=doc:<id> → the record panel opens on that record and the row is highlighted.
  await token(page, 'last').click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + EMAIL);
  await expect(panel.locator('#rp-title')).toHaveText('RE: Cubiro screening letter');
  await expect(page.locator('.hub-tl-item[data-id="' + EMAIL + '"]')).toHaveClass(/hilite/);
  await page.keyboard.press('Escape');
  // #file → the File disclosure is open and focused.
  await page.locator('#p-file-wrap').evaluate((d) => { d.open = false; });
  await token(page, 'nda').click();
  await expect(page.locator('#p-file-wrap')).toHaveAttribute('open', '');
  await expect(page.locator('#p-file-wrap > summary')).toBeFocused();
  await expect(page.locator('#p-file [data-legal-tag]')).toHaveText('lt-frontera-nda-2026');
  // #tab-runs / #tab-docs / #stale → the timeline tab with its filter pressed.
  await page.locator('#tab-lineage').click();
  await expect(page.locator('#panel-timeline')).toBeHidden();
  await token(page, 'runs').click();
  await expect(page.locator('#tab-timeline')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tl [data-filter="run"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hub-tl-item')).toHaveCount(2);
  await token(page, 'docs').click();
  await expect(page.locator('#tl [data-filter="docs"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hub-tl-item')).toHaveCount(2);
  await expect(page.locator('.hub-tl-item[data-kind="run"]')).toHaveCount(0);
  await token(page, 'stale').click();
  await expect(page.locator('#tl [data-filter="stale"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hub-tl-item')).toHaveCount(1);
  // #stage → the stage select is focused (the palette's "Change stage" does the same).
  await token(page, 'stage').click();
  await expect(page.locator('#p-stage')).toBeFocused();
});

test('W7-AC6: the stateline re-renders after a stage change and after a register edit', async ({ page }) => {
  const patched = await open(page);
  await page.locator('#p-stage').selectOption('Commercial review');
  await expect.poll(() => patched.length).toBe(1);
  await expect(sl(page)).toHaveAttribute('data-stage', 'Commercial review');
  await expect(token(page, 'stage')).toContainText('since 5 Oct 2026');
  await expect(page.locator('.hub-tl-item[data-kind="stage"]').first()).toContainText('Commercial review');
  // The register editor saves and the Next token follows.
  await token(page, 'next').click();
  await page.locator('#op-next').fill('Send the NDA amendment');
  await page.locator('#p-opportunity form').getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => patched.length).toBe(2);
  await expect(token(page, 'next')).toContainText('Send the NDA amendment');
});

test('R1: three actions right-aligned (Write to… primary, Research, Open in tool ▾ with the producing tools first); Archive in the … overflow behind a confirm sheet; Restore stays', async ({ page }) => {
  const patched = await open(page);
  const actions = page.locator('#p-toolbar');
  const write = actions.locator('#p-draft-btn'), research = actions.locator('#p-research-btn'), openIn = actions.locator('#p-openin'), more = actions.locator('#p-more');
  await expect(write).toHaveClass(/btn-primary/);
  await expect(research).toBeVisible();
  await expect(openIn).toContainText('Open in tool');
  // Order on screen: Write to…, Research, Open in tool, …
  const xs = await Promise.all([write, research, openIn, more].map((l) => l.boundingBox().then((b) => b.x)));
  expect(xs[0]).toBeLessThan(xs[1]); expect(xs[1]).toBeLessThan(xs[2]); expect(xs[2]).toBeLessThan(xs[3]);
  // Right-aligned: the overflow button ends at the content's right edge.
  const content = await page.locator('.hub-head').boundingBox();
  const mb = await more.boundingBox();
  expect(Math.round(mb.x + mb.width)).toBeGreaterThanOrEqual(Math.round(content.x + content.width) - 2);
  // The menu: the tool that produced this project's runs first, then the rest in toolbar order; the legacy gate is armed on open.
  await expect(page.locator('#p-openin-menu')).toBeHidden();
  await openIn.click();
  const menu = page.locator('#p-openin-menu');
  await expect(menu).toBeVisible();
  const links = menu.locator('a[data-toolbar-tool]');
  expect(await links.evaluateAll((els) => els.map((e) => e.getAttribute('data-toolbar-tool')))).toEqual(['nodal-analysis', 'opportunity-register', 'plan-your-job']);
  await expect(links.first()).toHaveAttribute('href', /nodal-analysis-tool\.html\?project=llanos-waterflood(&asset=field%3Aco%3Acubiro)?$/);   // wave 7 PR3 (W7-AC14): the first attached field rides along
  await expect(links.first()).toHaveAttribute('data-produced', '1');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // Archive: in the overflow, with a confirm sheet; nothing is patched until confirmed.
  await expect(page.locator('#p-archive')).toBeHidden();
  await more.click();
  const archive = page.locator('#p-archive');
  await expect(archive).toBeVisible();
  await expect(archive).toHaveText('Archive project');
  await archive.click();
  const sheet = page.locator('#p-archive-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Nothing is deleted');
  expect(patched).toEqual([]);
  await sheet.locator('#p-archive-cancel').click();
  await expect(sheet).toBeHidden();
  expect(patched).toEqual([]);
  await more.click(); await archive.click();
  await sheet.locator('#p-archive-confirm').click();
  await expect.poll(() => patched).toEqual([{ status: 'archived' }]);
  await expect(page.locator('#p-archived')).toBeVisible();
  // Restore stays as a plain action and returns the prior status.
  const restore = page.locator('#p-archive');
  await expect(restore).toBeVisible();
  await expect(restore).toHaveText('Restore project');
  await restore.click();
  await expect.poll(() => patched.length).toBe(2);
  expect(patched[1]).toEqual({ status: 'active' });
  await expect(page.locator('#p-archived')).toBeHidden();
});

test('R6: the tab strip is sticky under the stateline, Add documents opens the drop zone as a sheet, the whole page is a drop target; the File disclosure holds the tag, contacts, team and a compact Fields row', async ({ page }) => {
  await open(page);
  const tabs = page.locator('#p-tabs-wrap');
  expect(await tabs.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  expect(await page.locator('#p-tabs').evaluate((el) => getComputedStyle(el).scrollSnapType)).toMatch(/x/);
  await expect(tabs.locator('#p-add-docs')).toContainText('Add documents');
  await expect(page.locator('#p-upload')).toBeHidden();
  await tabs.locator('#p-add-docs').click();
  await expect(page.locator('#p-upload')).toBeVisible();
  await expect(page.locator('#up-drop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#p-upload')).toBeHidden();
  // Dragging a file over the page outlines the whole page.
  await page.dispatchEvent('#panel-timeline', 'dragover', { dataTransfer: await page.evaluateHandle(() => { const dt = new DataTransfer(); return dt; }) });
  await expect(page.locator('body')).toHaveClass(/is-dragover/);
  await page.dispatchEvent('body', 'dragleave');
  // The File disclosure: closed by default, one line, holding the tag, contacts, team and the Fields row.
  const file = page.locator('#p-file-wrap');
  expect(await file.evaluate((d) => d.open)).toBe(false);
  const fb = await file.boundingBox();
  expect(fb.height).toBeLessThanOrEqual(64);
  await expect(file.locator('summary')).toContainText('File');
  await expect(file.locator('summary')).toContainText('lt-frontera-nda-2026');
  await file.locator('summary').click();
  await expect(page.locator('#p-file [data-contact="jorge-ruiz"]')).toBeVisible();
  await expect(page.locator('#p-file [data-member]')).toHaveCount(2);
  const fields = page.locator('#p-fields');
  await expect(fields).toBeVisible();
  await expect(fields.locator('li[data-field] b')).toHaveText(['Cubiro', 'Castilla']);
  for (const li of await fields.locator('li[data-field]').all()) expect((await li.boundingBox()).height, 'a compact row').toBeLessThanOrEqual(44);
  await expect(fields.locator('#fld-add-btn')).toContainText('Add field');
  // The timeline rows: one tappable block at least 44 px tall, the date on one line, the type as a mono prefix, a pill on the right for every kind.
  const row = page.locator('.hub-tl-item[data-id="' + LETTER + '"]');
  const rb = await row.boundingBox();
  expect(rb.height).toBeGreaterThanOrEqual(44);
  await expect(row.locator('.hub-tl-date')).toHaveText('1 Oct · 13:54');
  expect((await row.locator('.hub-tl-date').boundingBox()).height).toBeLessThan(30);
  await expect(row.locator('.hub-tl-type')).toHaveText('letter');
  await expect(row.locator('.hub-tl-side .hub-pill')).toHaveCount(1);
  // Tapping the row (not just the title text) opens the record.
  await row.click({ position: { x: Math.round(rb.width * 0.45), y: 4 } });
  await expect(page.locator('#record-panel')).toHaveAttribute('data-ref', 'doc:' + LETTER);
  // Idea D: the KPI figures are tabular Barlow Condensed with the unit in small caps after them.
  const num = page.locator('#p-kpis .hub-num').first();
  expect(await num.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Barlow Condensed/);
  expect(await num.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  await expect(page.locator('#p-kpis .hub-unit').first()).toBeAttached();
  expect(await page.locator('#p-kpis .hub-kpi .v').evaluateAll((els) => els.map((e) => getComputedStyle(e).fontFamily).some((f) => /Playfair/.test(f)))).toBe(false);
});

test('R12: a skeleton of the stateline, the tab strip and three rows while the project loads; the 404 offers Back to Today and Find a project', async ({ page }) => {
  await stubApi(page, { delayProject: 1500 });
  await page.goto('/hub/project.html?id=' + PID);
  const sk = page.locator('#p-skeleton');
  await expect(sk).toBeVisible();
  await expect(sk.locator('.hub-sk-stateline')).toHaveCount(1);
  await expect(sk.locator('.hub-sk-tabs')).toHaveCount(1);
  await expect(sk.locator('.hub-sk-row')).toHaveCount(3);
  await ready(page);
  await expect(sk).toBeHidden();
  await stubApi(page);
  await page.route('**/api/projects/nope', (route) => json(route, { error: { code: 'not_found', message: 'project "nope" not found' } }, 404));
  await page.goto('/hub/project.html?id=nope');
  await ready(page);
  await expect(page.locator('#p-skeleton')).toBeHidden();
  await expect(page.locator('#notices a[href="/hub/index.html"]')).toHaveText('Back to Today');
  await expect(page.locator('#notices a[href="/hub/search.html"]')).toHaveText('Find a project');
});

test('evidence: the stateline header at desktop, iPad landscape, iPad portrait and phone', async ({ page }) => {
  mkdirSync(EVIDENCE, { recursive: true });
  for (const [name, w, h] of [['desk', 1440, 900], ['ipadl', 1024, 768], ['ipadp', 820, 1180], ['phone', 390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    // Stage, next and last readable without scrolling at every size.
    for (const t of ['stage', 'next', 'last']) {
      const b = await token(page, t).boundingBox();
      expect(b, name + ' ' + t).not.toBeNull();
      expect(b.y + b.height, name + ' ' + t + ' above the fold').toBeLessThanOrEqual(h);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name + ' no horizontal scroll').toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE, 'w7-stateline-' + name + '.png') });
  }
});
