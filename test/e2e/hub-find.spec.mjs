// M12: Hub Find page. The API is stubbed with page.route; the static server (python3 -m http.server,
// started by playwright.config.mjs) serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence/m12-find.png');

const DAY = 864e5;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const PROJECT = 'llanos-waterflood';
const SCOPE = 'project:' + PROJECT;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route, status, code, message) => json(route, { error: { code, message } }, status);

const hit = (o) => ({ item_id: null, run_id: null, version: 1, ordinal: 0, anchor: null, project_id: PROJECT, stale: false, authors: [], legal_tag: 'lt-frontera-nda-2026', ...o });
const HITS = [
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000001', item_id: '00000000-0000-4000-8000-000000000001', type: 'paper', title: 'Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones', snippet: '…Voidage replacement ratios below 0.8 correlated with early water breakthrough in 7 of 11 waterflood patterns; gains were <0.5 elsewhere.…', legal_tag: 'lt-onepetro-sub-2026', date: ago(19), authors: ['gs'] }),
  hit({ ref: 'run:00000000-0000-4000-8000-000000000002', run_id: '00000000-0000-4000-8000-000000000002', type: 'run', title: 'Cubiro waterflood: base (re-run on 2.1.0)', snippet: '…Voidage replacement capped at injector capacity of 8,500 bwpd. Waterflood recovery factor 0.20 on OOIP; NPV10 USD 171.1 MM.…', date: ago(2), authors: ['chris'] }),
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000003', item_id: '00000000-0000-4000-8000-000000000003', type: 'letter', title: 'Letter ATC-2026-0139 to Frontera: interim results, Cubiro waterflood screening', snippet: '…The waterflood screening supports an incremental 2P of 16.2 MMbbl, provided a voidage replacement close to 1.0 can be sustained.…', date: ago(12), stale: true, authors: ['chris', 'cm'] }),
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000004', item_id: '00000000-0000-4000-8000-000000000004', type: 'email', title: 'RE: Cubiro water injection data request', snippet: '…Current injection is 6,400 bwpd across 6 injectors, so full voidage replacement is not possible before the 2027 expansion.…', date: ago(4), authors: ['gs', 'chris'] }),
  hit({ ref: 'doc:00000000-0000-4000-8000-000000000005', item_id: '00000000-0000-4000-8000-000000000005', type: 'spreadsheet', title: 'Cubiro_injectors_layout_v4.xlsx', snippet: '…Injector-producer pairs, cumulative injection and voidage balance by pattern. 6 injectors, 14 producers.…', date: ago(400), authors: ['cm'] }),
];
const PEOPLE = [
  { person_id: 'chris', name: 'Chris Hopkinson', role: 'partner', last_at: ago(2), count: 3, refs: [] },
  { person_id: 'gs', name: 'Gabriela Sosa', role: 'associate', last_at: ago(4), count: 2, refs: [] },
  { person_id: 'cm', name: 'Carlos Mora', role: 'associate', last_at: ago(12), count: 2, refs: [] },
];

/** Stub /api/**; `calls` records every search request. */
async function stub(page, over = {}) {
  const calls = { search: [], people: [] };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (over[p]) return over[p](url, route, calls);
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/projects') return json(route, { projects: [{ id: PROJECT, name: 'Llanos Basin waterflood screening', client_id: 'frontera' }, { id: 'orinoco-partnership', name: 'Orinoco partnership', client_id: 'pdo' }] });
    if (p === '/api/clients') return json(route, { clients: [{ id: 'frontera', name: 'Frontera Energy', project_ids: [PROJECT] }] });
    if (p === '/api/catalog') return json(route, { tools: [] });
    if (p === '/api/search') {
      calls.search.push(url.searchParams);
      if (!url.searchParams.get('scope')) return err(route, 400, 'scope_required', 'scope is required');
      if (!url.searchParams.get('q')) return err(route, 400, 'query_required', 'q is required');
      if (url.searchParams.get('scope') === 'project:forbidden') return err(route, 403, 'forbidden', 'not a member of project forbidden');
      return json(route, { hits: HITS, scope: url.searchParams.get('scope'), took_ms: 41 });
    }
    if (p === '/api/search/people') { calls.people.push(url.searchParams); return json(route, { people: PEOPLE, scope: url.searchParams.get('scope'), took_ms: 30 }); }
    return err(route, 404, 'not_found', 'no route');
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const results = (page) => page.locator('#find-results .result');
const openPage = async (page, qs = '') => { await page.goto('/hub/search.html' + qs); await ready(page); };

test('results render with type icon, highlighted snippet, source path, legal tag and who-worked chips; the address carries q and scope', async ({ page }) => {
  const calls = await stub(page);
  await openPage(page, '?q=' + encodeURIComponent('waterflood voidage') + '&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  expect(calls.search).toHaveLength(1);
  expect(calls.search[0].get('q')).toBe('waterflood voidage');
  expect(calls.search[0].get('scope')).toBe(SCOPE);
  expect(calls.people[0].get('scope')).toBe(SCOPE);
  await expect(page.locator('#find-scope')).toHaveValue(SCOPE);
  await expect(page.locator('#find-count')).toContainText('5 results for “waterflood voidage” in Llanos Basin waterflood screening');

  const first = results(page).nth(0);
  await expect(first.locator('.r-ico svg')).toHaveCount(1);
  await expect(first.locator('.r-title a')).toContainText('Waterflood performance and voidage management');
  await expect(first.locator('.r-title a')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT + '&doc=00000000-0000-4000-8000-000000000001');
  await expect(first.locator('.r-title mark')).toHaveText(['Waterflood', 'voidage']);
  await expect(first.locator('.snip mark')).toHaveText(['Voidage', 'waterflood']);
  await expect(first.locator('.snip')).toContainText('<0.5', { useInnerText: true });   // a "<" in the Vault's text is text, never markup
  await expect(first.locator('.r-meta .r-when')).toHaveText(/^\d{1,2} \w{3,4} \d{4}$/);
  await expect(page.locator('#find-results .find-group[data-project="' + PROJECT + '"] .find-group-name')).toHaveText('Llanos Basin waterflood screening');
  await expect(first.locator('[data-legal-tag="lt-onepetro-sub-2026"]')).toBeVisible();
  await expect(first.locator('.hub-pill')).toHaveText('Paper');
  await expect(first.locator('.find-av')).toHaveCount(1);

  const run = results(page).nth(1);
  await expect(run).toHaveAttribute('data-type', 'run');
  await expect(run.locator('.r-title a')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT + '&run=00000000-0000-4000-8000-000000000002');
  await expect(results(page).nth(2).locator('.hub-stale')).toHaveText('Stale');
  await expect(results(page).nth(2).locator('.find-av')).toHaveCount(2);

  // Who worked this: chips from /api/search/people, in the order the API gave (most recent first).
  await expect(page.locator('#find-who .find-who-chip')).toHaveCount(3);
  await expect(page.locator('#find-who .find-who-chip').first()).toContainText('Chris Hopkinson');
  await expect(page.locator('#find-who .find-who-chip').nth(1)).toContainText('Gabriela Sosa');

  expect(new URL(page.url()).searchParams.get('q')).toBe('waterflood voidage');
  expect(new URL(page.url()).searchParams.get('scope')).toBe(SCOPE);
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  await page.screenshot({ path: EVIDENCE, fullPage: true });
});

// Wave 7 PR1 (S31, S32, W7-AC2): a document hit links to the project page with ?doc= and the record panel opens on it;
// run hits are in the same list with their own chip (the Vault indexes runs, so they arrive as ordinary hits of type run).
test('W7-AC2: a document hit opens the project page on that record; run hits have their own chip and link with ?run=', async ({ page }) => {
  const DOC = '00000000-0000-4000-8000-000000000001', RUN = '00000000-0000-4000-8000-000000000002';
  const project = { id: PROJECT, client_id: 'frontera', name: 'Llanos Basin waterflood screening', status: 'active', default_legal_tag: 'lt-frontera-nda-2026', asset_ids: [], members: ['chris'], contacts: [], created_at: '2026-09-30T09:00:00.000Z', closed_at: null, country: 'CO', stage: 'Initial screen', stage_history: [], register: {} };
  const timeline = { project_id: PROJECT, count: 2, entries: [
    { kind: 'item', ref: 'doc:' + DOC, id: DOC, at: ago(19), title: 'Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones', type: 'paper', version: 1, legal_tag: 'lt-onepetro-sub-2026', stale: false, stale_reasons: [], supersedes: null },
    { kind: 'run', ref: 'run:' + RUN, id: RUN, at: ago(2), title: 'Cubiro waterflood: base (re-run on 2.1.0)', job: 'nodal', tool_version: '2.1.0', status: 'final', legal_tag: 'lt-frontera-nda-2026', stale: false, stale_reasons: [], supersedes: null },
  ] };
  const item = { id: DOC, type: 'paper', title: 'Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones', created_at: ago(19), authored_at: ago(19), authors: ['gs'], client_id: 'frontera', project_id: PROJECT, asset_ids: [], organisation_ids: [], legal_tag: 'lt-onepetro-sub-2026', origin: { source: 'upload' }, storage_key: null, mime: 'application/pdf', content_hash: 'sha256:' + 'a'.repeat(64), version: 1, supersedes: null, cites: [], filing: {}, extracted: {}, stale: false, tags: [] };
  const empty = { project_id: PROJECT, assets: [], vintages: [], nodes: [], edges: [], runs: [], items: [], lessons: [], rules: [], findings: [], enabled: false };
  await stub(page, {
    ['/api/projects/' + PROJECT]: (u, r) => json(r, project),
    ['/api/projects/' + PROJECT + '/timeline']: (u, r) => json(r, timeline),
    ['/api/items/' + DOC]: (u, r) => json(r, item),
    ['/api/items/' + DOC + '/versions']: (u, r) => json(r, { item_id: DOC, versions: [] }),
    ...Object.fromEntries(['/assets', '/vintages', '/lineage', '/stale', '/lessons', '/scorecard', '/basis', '/research', '/standing', '/contacts'].map((t) => ['/api/projects/' + PROJECT + t, (u, r) => json(r, empty)])),
    '/api/countries': (u, r) => json(r, { countries: [] }), '/api/items': (u, r) => json(r, { items: [] }), '/api/runs': (u, r) => json(r, { runs: [] }),
  });
  await openPage(page, '?q=waterflood&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  // Every document hit carries doc=<item_id>; the run hit carries run=<run_id>; neither carries the other.
  const docLinks = page.locator('#find-results .result:not([data-type="run"]) .r-title a');
  await expect(docLinks).toHaveCount(4);
  for (const href of await docLinks.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
    expect(href).toMatch(new RegExp('^/hub/project\\.html\\?id=' + PROJECT + '&doc=00000000-0000-4000-8000-00000000000[0-9]$'));
  }
  const runChip = page.locator('#find-types .find-chip[data-type="run"]');
  await expect(runChip).toHaveText('Runs (1)');
  await runChip.click();
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toHaveAttribute('data-type', 'run');
  await expect(results(page).first().locator('.r-title a')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT + '&run=' + RUN);
  await page.locator('#find-types .find-chip[data-type="all"]').click();
  // Following the document link lands on the project page with the record panel open on that document.
  await results(page).first().locator('.r-title a').click();
  await expect(page).toHaveURL(new RegExp('project\\.html\\?id=' + PROJECT + '&doc=' + DOC));
  await page.locator('body[data-ready="1"]').waitFor();
  const rp = page.locator('#record-panel');
  await expect(rp).toBeVisible();
  await expect(rp.locator('#rp-title')).toHaveText('Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones');
  await expect(page.locator('.hub-tl-item[data-id="' + DOC + '"]')).toHaveClass(/hilite/);
});

// Wave 7 PR2 (R2, W7-AC6 Find part): a missing scope is a neutral state. The header form on every page carries
// a hidden scope, so the page rarely sees none; when it does, it searches the firm and says so in one muted
// line, never a red error. A chosen scope is still remembered and ?scope= still wins.
test('R2: no scope is a neutral state, the search runs in the firm, one muted line says so, the choice is remembered', async ({ page }) => {
  const calls = await stub(page);
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('e2e-cleared')) { localStorage.removeItem('atc-hub-find-scope'); sessionStorage.setItem('e2e-cleared', '1'); } } catch (e) { /* */ } });
  await openPage(page, '?q=' + encodeURIComponent('waterflood voidage'));
  await expect(results(page)).toHaveCount(5);
  await expect(page.locator('#find-scope')).toHaveValue('firm');
  await expect(page.locator('#find-scope option')).toHaveText([
    'Project: Llanos Basin waterflood screening', 'Project: Orinoco partnership', 'Client: Frontera Energy (all projects)',
    'Firm: lessons, templates, firm-tagged', 'Public: regulators, papers, feeds',
  ]);
  expect(calls.search.map((s) => s.get('scope'))).toEqual(['firm']);
  // One neutral line, no alert, no invalid select, no error colour, nothing that reads as SQL.
  await expect(page.locator('#notices [role="alert"]')).toHaveCount(0);
  await expect(page.locator('#find-scope')).not.toHaveAttribute('aria-invalid', 'true');
  const pred = page.locator('#scope-pred');
  await expect(pred).toHaveAttribute('data-scope-state', 'default');
  await expect(pred).toContainText('Searching the firm. Change scope ▾');
  await expect(pred).not.toContainText('scope =');
  const color = await pred.evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe('rgb(165, 48, 31)');                              // not --bad
  await expect(page.locator('.find-state')).toHaveCount(0);                 // no "Choose a scope" state card
  // "Change scope" takes the person to the select.
  await pred.getByRole('button', { name: /Change scope/ }).click();
  await expect(page.locator('#find-scope')).toBeFocused();

  await page.locator('#find-scope').selectOption('client:frontera');
  await expect(results(page)).toHaveCount(5);
  expect(calls.search.map((s) => s.get('scope'))).toEqual(['firm', 'client:frontera']);
  await expect(pred).toHaveAttribute('data-scope-state', 'chosen');
  await expect(pred).toContainText('Across every Frontera Energy project you may see, plus firm and public records.');
  expect(new URL(page.url()).searchParams.get('scope')).toBe('client:frontera');

  // A fresh visit without ?scope= restores the remembered scope; ?scope= wins over it.
  await page.goto('/hub/search.html?q=waterflood');
  await ready(page);
  await expect(page.locator('#find-scope')).toHaveValue('client:frontera');
  await expect(results(page)).toHaveCount(5);
  await page.goto('/hub/search.html?q=waterflood&scope=' + encodeURIComponent(SCOPE));
  await ready(page);
  await expect(page.locator('#find-scope')).toHaveValue(SCOPE);
  await expect(pred).toHaveText('Inside Llanos Basin waterflood screening, plus firm and public records.');
  await page.locator('#find-scope').selectOption('public');
  await expect(pred).toContainText('Public records only');
});

// Wave 7 PR2 (W7-AC6 Find part, R2): results are grouped under the project they belong to, each group headed by the
// stateline card so the same facts read the same as on the project page and Today; every hit has Open record, which
// opens the record panel in place, beside the project link that carries ?doc= or ?run=.
test('W7-AC6: hits are grouped under a stateline card per project; Open record opens the panel in place', async ({ page }) => {
  const DOC = '00000000-0000-4000-8000-000000000001', RUN = '00000000-0000-4000-8000-000000000002';
  const project = { id: PROJECT, client_id: 'frontera', name: 'Llanos Basin waterflood screening', status: 'active', default_legal_tag: 'lt-frontera-nda-2026', asset_ids: [], members: ['chris'], contacts: [], created_at: ago(30), closed_at: null, country: 'CO', stage: 'Technical review', stage_history: [{ stage: 'Technical review', at: ago(12), by: 'chris' }], register: { next: 'Issue screening letter', owner: 'Chris' }, last_activity_at: ago(2), run_count: 3, item_count: 6, stale_count: 1 };
  const item = { id: DOC, type: 'paper', title: 'Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones', created_at: ago(19), authored_at: ago(19), authors: ['gs'], client_id: 'frontera', project_id: PROJECT, asset_ids: [], organisation_ids: [], legal_tag: 'lt-onepetro-sub-2026', origin: { source: 'upload' }, storage_key: null, mime: 'application/pdf', content_hash: 'sha256:' + 'a'.repeat(64), version: 1, supersedes: null, cites: [], filing: {}, extracted: {}, stale: false, tags: [] };
  const runRec = { id: RUN, job: 'nodal', tool_version: '2.1.0', tool_commit: 'abc1234', author: 'chris', created_at: ago(2), project_id: PROJECT, legal_tag: 'lt-frontera-nda-2026', title: 'Cubiro waterflood: base (re-run on 2.1.0)', status: 'final', supersedes: null, inputs: [], outputs: { npv10_musd: { value: 171.1, unit: 'MUSD' } }, assumptions: {}, params: {}, stale: false, stale_reasons: [] };
  const other = { ...HITS[4], ref: 'doc:00000000-0000-4000-8000-000000000009', item_id: '00000000-0000-4000-8000-000000000009', project_id: 'orinoco-partnership', title: 'Orinoco injectors', snippet: '## Page 1\nVoidage in Orinoco.' };
  const fetched = [];
  await stub(page, {
    '/api/projects': (u, r) => json(r, { projects: [project, { id: 'orinoco-partnership', name: 'Orinoco partnership', client_id: 'pdo', stage: 'Qualified', register: {}, run_count: 0, item_count: 1, stale_count: 0 }] }),
    '/api/search': (u, r) => json(r, { hits: [...HITS, other], scope: u.searchParams.get('scope'), took_ms: 4 }),
    ['/api/items/' + DOC]: (u, r) => { fetched.push('item'); return json(r, item); },
    ['/api/items/' + DOC + '/versions']: (u, r) => json(r, { item_id: DOC, versions: [] }),
    ['/api/runs/' + RUN]: (u, r) => { fetched.push('run'); return json(r, runRec); },
  });
  await openPage(page, '?q=waterflood&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(6);
  // One group per project, in order of first appearance, each headed by the card-size stateline from the same component.
  const groups = page.locator('#find-results .find-group');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute('data-project', PROJECT);
  await expect(groups.nth(1)).toHaveAttribute('data-project', 'orinoco-partnership');
  await expect(groups.nth(0).locator('.result')).toHaveCount(5);
  await expect(groups.nth(1).locator('.result')).toHaveCount(1);
  const sl = groups.nth(0).locator('[data-stateline="card"]');
  await expect(sl).toHaveCount(1);
  await expect(sl).toHaveAttribute('data-project', PROJECT);
  await expect(sl.locator('[data-token="stage"]')).toContainText('Technical review');
  await expect(sl.locator('[data-token="next"]')).toContainText('Issue screening letter');
  await expect(sl.locator('[data-token="runs"]')).toHaveText('3 runs');
  await expect(sl.locator('[data-token="stale"]')).toHaveText('1 stale');
  await expect(sl.locator('[data-token="stage"]')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT + '#stage');
  await expect(groups.nth(0).locator('.find-group-name')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT);
  // Markdown heading markers from the chunker never reach the page.
  await expect(groups.nth(1).locator('.snip')).toHaveText('Voidage in Orinoco.');
  await expect(groups.nth(1).locator('.snip')).not.toContainText('#');
  // Every hit keeps its project link with ?doc= / ?run= and gains Open record.
  const first = results(page).nth(0);
  await expect(first.locator('.r-title a')).toHaveAttribute('href', '/hub/project.html?id=' + PROJECT + '&doc=' + DOC);
  await expect(first.locator('[data-open-record]')).toHaveText('Open record');
  await expect(page.locator('#record-panel')).toBeHidden();
  await first.locator('[data-open-record]').click();
  const rp = page.locator('#record-panel');
  await expect(rp).toBeVisible();
  await expect(rp).toHaveAttribute('data-ref', 'doc:' + DOC);
  await expect(rp.locator('#rp-title')).toHaveText('Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones');
  await expect(rp.locator('[data-meta]')).toBeVisible();                                 // R5: a meta line, then the record
  await expect(rp.locator('.hub-rp-technical summary')).toHaveText('Technical');          // the raw record sits last, closed
  expect(fetched).toEqual(['item']);
  expect(page.url()).toContain('/hub/search.html');                                     // in place, not the project page
  // A run hit opens the run; Escape closes the panel and the focus goes back to the trigger.
  await results(page).nth(1).locator('[data-open-record]').click();
  await expect(rp).toHaveAttribute('data-ref', 'run:' + RUN);
  await expect(rp.locator('#rp-title')).toHaveText('Cubiro waterflood: base (re-run on 2.1.0)');
  await expect(rp.locator('[data-m="status"][data-status]')).toHaveAttribute('data-status', 'final');   // R5: the status pill on the run's meta line
  await page.keyboard.press('Escape');
  await expect(rp).toBeHidden();
  await expect(results(page).nth(1).locator('[data-open-record]')).toBeFocused();
  // No file names, module ids or acceptance-criterion ids anywhere on the page.
  expect(await page.locator('body').innerText()).not.toMatch(/SETUP\.md|_KEY\b|\bAC\d+\b|\bM\d\d\b|\.json\b|\.md\b/);
});

test('a query is needed too: an empty query shows the prompt and sends nothing', async ({ page }) => {
  const calls = await stub(page);
  await openPage(page, '?scope=public');
  await expect(page.locator('#find-results')).toContainText('Enter a query');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#find-results')).toContainText('Enter a query');
  expect(calls.search).toHaveLength(0);
});

test('filters by type and by date narrow the hits already returned; empty state when nothing matches', async ({ page }) => {
  await stub(page);
  await openPage(page, '?q=waterflood&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  const chips = page.locator('#find-types .find-chip');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(chips).toContainText(['All types (5)', 'Runs (1)', 'Letters (1)', 'Emails (1)', 'Spreadsheets & data (1)', 'Papers (1)']);
  await expect(page.locator('#find-types .find-chip[data-type="lesson"]')).toHaveCount(0);   // no lessons among the hits

  await page.locator('#find-types [data-type="letter"]').click();
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toHaveAttribute('data-type', 'letter');
  await expect(page.locator('#find-types [data-type="letter"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#find-count')).toContainText('1 result for');

  // Date: the spreadsheet is 400 days old; the paper 19 days; the run 2 days.
  await page.locator('#find-types [data-type="all"]').click();
  await page.locator('#find-date').selectOption('30');
  await expect(results(page)).toHaveCount(4);
  await expect(page.locator('#find-results')).not.toContainText('Cubiro_injectors_layout_v4.xlsx');
  await expect(page.locator('#find-types [data-type="spreadsheet"]')).toHaveCount(0);
  await page.locator('#find-types [data-type="paper"]').click();
  await expect(results(page)).toHaveCount(1);
  await page.locator('#find-date').selectOption('365');
  await expect(results(page)).toHaveCount(1);
  await page.locator('#find-types [data-type="all"]').click();
  await expect(results(page)).toHaveCount(4);
  await page.locator('#find-date').selectOption('any');
  await expect(results(page)).toHaveCount(5);

  // Empty state: a search that returns nothing.
  await page.unroute('**/api/**');
  await stub(page, { '/api/search': (u, r) => json(r, { hits: [], scope: SCOPE, took_ms: 3 }), '/api/search/people': (u, r) => json(r, { people: [] }) });
  await page.locator('#find-q').fill('zzzz');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#find-results')).toContainText('No results');
  await expect(page.locator('#find-results')).toContainText('widen the scope');
  await expect(page.locator('#find-count')).toContainText('0 results for');
  await expect(page.locator('#find-who')).toBeHidden();
});

test('error states: a scope the caller may not search, a refused request and an unreachable Vault', async ({ page }) => {
  await stub(page);
  await openPage(page, '?q=waterflood&scope=project:forbidden');
  await expect(page.locator('#find-scope')).toHaveValue('project:forbidden');
  await expect(page.locator('#notices [role="alert"]')).toContainText('Outside your scope');
  await expect(page.locator('#notices [role="alert"]')).toContainText('not a member of project forbidden');
  await expect(results(page)).toHaveCount(0);

  await page.unroute('**/api/**');
  await stub(page, { '/api/search': (u, r) => err(r, 500, 'error', 'boom'), '/api/search/people': (u, r) => err(r, 500, 'error', 'boom') });
  await page.locator('#find-scope').selectOption('public');
  await expect(page.locator('#notices [role="alert"]')).toContainText('The Vault is unreachable');
  await expect(page.locator('#find-results')).toContainText('The Vault is unreachable');
});

test('bilingual: every data-en has its data-es, no bare text, and the toggle keeps highlights and results', async ({ page }) => {
  await stub(page);
  await openPage(page, '?q=waterflood%20voidage&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  const audit = () => page.evaluate(() => {
    const missing = [...document.querySelectorAll('[data-en]')].filter((el) => !el.hasAttribute('data-es')).map((el) => el.outerHTML.slice(0, 80));
    const missingPh = [...document.querySelectorAll('[data-en-ph]')].filter((el) => !el.hasAttribute('data-es-ph')).map((el) => el.outerHTML.slice(0, 80));
    const bare = [...document.body.querySelectorAll('*')].filter((el) => {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT'].includes(el.tagName.toUpperCase()) || el.closest('svg, .nav-wordmark, .hub-av, .nav-lang')) return false;
      if (el.children.length) return false;
      const t = el.textContent.trim();
      // Vault text containing "<" is set without data attributes on purpose (main.js would render such a value as HTML).
      return /\p{L}{2,}/u.test(t) && !t.includes('<') && !el.hasAttribute('data-en') && !el.closest('[data-en]');
    }).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
    return { count: document.querySelectorAll('[data-en]').length, missing, missingPh, bare, marks: document.querySelectorAll('.result mark').length };
  });
  const en = await audit();
  expect(en.count).toBeGreaterThan(80);
  expect(en.missing).toEqual([]); expect(en.missingPh).toEqual([]); expect(en.bare).toEqual([]);
  expect(en.marks).toBeGreaterThan(8);

  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('h1')).toHaveText('Buscar en el Vault');
  await expect(page.locator('label[for="find-scope"]')).toContainText('Alcance');
  await expect(page.locator('#find-q')).toHaveAttribute('placeholder', /voidage de inyección/);
  await expect(page.locator('#find-types [data-type="all"]')).toContainText('Todos los tipos (5)');
  await expect(results(page).first().locator('.hub-pill')).toHaveText('Artículo');
  await expect(results(page).first().locator('[data-open-record]')).toHaveText('Abrir registro');
  await expect(page.locator('#find-count')).toContainText('resultados para');
  const es = await audit();
  expect(es.missing).toEqual([]); expect(es.bare).toEqual([]);
  expect(es.marks).toBe(en.marks);                     // highlights survive the language switch

  // A new search after switching renders in Spanish straight away.
  await page.locator('#find-scope').selectOption('firm');
  await expect(page.locator('#find-count')).toContainText('resultados para');
  await expect(results(page).first().locator('.hub-pill')).toHaveText('Artículo');
});

test('accessibility: axe finds no WCAG 2 A/AA violations (results, empty, scope error, Spanish)', async ({ page }) => {
  await stub(page);
  const axe = async (label) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), label).toEqual([]);
  };
  await openPage(page, '?q=waterflood%20voidage&scope=' + encodeURIComponent(SCOPE));
  await expect(results(page)).toHaveCount(5);
  await axe('results');
  await page.locator('#find-types [data-type="letter"]').click();
  await axe('filtered');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await axe('spanish');
  await page.locator('.nav-lang button[data-lang="en"]').click();
  // The neutral no-scope state (R2) and the record panel open from a hit (W7-AC6).
  await page.goto('/hub/search.html?q=waterflood');
  await ready(page);
  await expect(results(page)).toHaveCount(5);
  await axe('neutral scope');
  await results(page).first().locator('[data-open-record]').click();
  await expect(page.locator('#record-panel')).toBeVisible();
  await axe('record panel');
});

test('not indexable: noindex meta, listed in robots.txt, absent from the sitemap, no keys in the page', async ({ page, request }) => {
  await page.goto('/hub/search.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  const html = await (await request.get('/hub/search.html')).text();
  const js = await (await request.get('/hub/search.js')).text();
  expect(html + js).not.toMatch(/googletagmanager|gtag\(|VOYAGE|api\.voyageai|sk-ant/i);
  expect(await (await request.get('/robots.txt')).text()).toMatch(/^Disallow: \/hub\/$/m);
  expect(await (await request.get('/sitemap.xml')).text()).not.toMatch(/\/hub\//);
});
