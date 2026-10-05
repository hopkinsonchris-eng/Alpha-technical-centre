// M10: the Hub queue page. The API is stubbed with page.route; the static server (python3 -m http.server,
// started by playwright.config.mjs) serves the pages. Filing, lesson proposals and the review queue are
// exercised through what the page sends, not through what the stub says.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence/m10-queue.png');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route, status, message = 'no') => json(route, { error: { code: 'x', message } }, status);

const PROJECTS = [
  { id: 'llanos-waterflood', name: 'Llanos Basin waterflood screening', client_name: 'Frontera Energy' },
  { id: 'middle-magdalena', name: 'Middle Magdalena infill screening', client_name: 'Ecopetrol' },
  { id: 'talara-brownfield', name: 'Talara brownfield redevelopment', client_name: 'Costa Norte Petróleos' },
  { id: 'firm', name: 'ATC internal', client_name: null },
];
const FILING = [
  { id: 'f1', item_id: 'i1', status: 'open', subject: 'RE: Cubiro water injection data request', from: 'Jorge Salazar', from_address: 'jorge.salazar@andinolabs.co', date: '2026-09-28T14:20:00Z', attachments: 2, direction: 'in',
    suggestions: [{ project_id: 'llanos-waterflood', project_name: 'Llanos Basin waterflood screening', confidence: 0.78 }, { project_id: 'middle-magdalena', project_name: 'Middle Magdalena infill screening', confidence: 0.41 }] },
  { id: 'f2', item_id: 'i2', status: 'open', subject: 'Updated PVT report, Cubiro-14 sample', from: 'Laboratorio Andino', from_address: 'lab@laboratorioandino.co', date: '2026-09-27T09:05:00Z', attachments: 1, direction: 'in',
    suggestions: [{ project_id: 'llanos-waterflood', project_name: 'Llanos Basin waterflood screening', confidence: 0.71 }] },
  { id: 'f3', item_id: 'i3', status: 'open', subject: 'Re: Introduction', from: 'chris@alpha-technical-centre.com', from_address: 'chris@alpha-technical-centre.com', date: '2026-09-26T16:45:00Z', attachments: 0, direction: 'out', suggestions: [] },
];
const LESSONS = [
  { id: 'l1', statement: 'Test aquifer strength before assuming voidage replacement of 1.0 in a waterflood screening.', discipline: 'reservoir-engineering', confidence: 0.82 },
  { id: 'l2', statement: 'Ask for the royalty sliding-scale table before modelling fiscal terms.', discipline: 'commercial', confidence: 0.7 },
];
const REVIEW = [
  { id: 'o1', kind: 'organisation', status: 'open', payload: { name: 'Andinolabs', domain: 'andinolabs.co', sender_email: 'jorge.salazar@andinolabs.co', sender_name: 'Jorge Salazar', subject: 'RE: Cubiro water injection data request' } },
  { id: 'n1', kind: 'nda-expiry', status: 'open', payload: { proposal: 'Set the expiry of lt-orinoco-nda-2026 (client petrolera-del-orinoco) to 2028-02-13', item_title: 'Mutual NDA ATC / Petrolera del Orinoco', current_expires_at: null, proposed_expires_at: '2028-02-13', evidence: 'This Agreement expires two years after the Effective Date.' } },
  { id: 'r1', kind: 'rerun-delta', status: 'open', payload: { summary: 'NPV10 -8.2% after fiscal terms CO-2026 update' } },
];

/** Stub /api/**. handlers: [[method, regex, fn(url, route, match)]]; anything else is 404. Records every request. */
async function stub(page, handlers) {
  const calls = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = req.postData(); }
    calls.push({ method: req.method(), path: url.pathname + url.search, body });
    for (const [method, re, fn] of handlers) {
      const m = re.exec(url.pathname);
      if (method === req.method() && m) return fn(url, route, m);
    }
    return err(route, 404, 'no route');
  });
  return calls;
}
const base = () => [
  ['GET', /^\/api\/me$/, (u, r) => json(r, PARTNER)],
  ['GET', /^\/api\/projects$/, (u, r) => json(r, { projects: PROJECTS })],
];
const full = () => [
  ...base(),
  ['GET', /^\/api\/queue\/filing$/, (u, r) => json(r, { items: FILING })],
  ['GET', /^\/api\/lessons$/, (u, r) => { expect(u.searchParams.get('status')).toBe('proposed'); return json(r, { lessons: LESSONS }); }],
  ['GET', /^\/api\/queue\/review$/, (u, r) => json(r, { items: REVIEW })],
];
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const open = async (page, handlers, query = '') => { const calls = await stub(page, handlers); await page.goto('/hub/queue.html' + query); await ready(page); return calls; };

test('the three sections render from the API, with the filing queue first and counts', async ({ page }) => {
  await open(page, full());
  await expect(page.locator('h1')).toHaveText('Queues');
  await expect(page.locator('#me-name')).toHaveText('Chris Hopkinson');
  await expect(page.locator('#filing-list .q-row')).toHaveCount(3);
  await expect(page.locator('#lessons-list .q-row')).toHaveCount(2);
  await expect(page.locator('#review-list .q-row')).toHaveCount(2);        // NDA expiry + organisation; the re-run delta belongs to Today
  await expect(page.locator('#n-filing')).toHaveText('3');
  const row = page.locator('[data-queue-id="f1"]');
  await expect(row).toContainText('RE: Cubiro water injection data request');
  await expect(row).toContainText('Jorge Salazar');
  await expect(row).toContainText('2 attachments');
  await expect(row.locator('[data-assign="llanos-waterflood"]')).toContainText('Llanos Basin waterflood screening · 78 %');
  await expect(row.locator('[data-assign]')).toHaveCount(2);
  await expect(page.locator('[data-queue-id="f3"] .hub-pill')).toContainText('Sent by us');
  await expect(page.locator('[data-queue-id="f3"] [data-assign]')).toHaveCount(0);
  // the assign list holds the projects but not the internal firm project
  await expect(row.locator('select option')).toHaveText(['Choose a project…', 'Llanos Basin waterflood screening', 'Middle Magdalena infill screening', 'Talara brownfield redevelopment']);
  // the section order: filing, lessons, review
  const order = await page.locator('main section').evaluateAll((els) => els.map((e) => e.id));
  expect(order).toEqual(['sec-filing', 'sec-lessons', 'sec-review']);
});

test('assign: a suggestion files the message, the row goes, the page says what happened', async ({ page }) => {
  const h = full().filter((x) => !(x[0] === 'GET' && String(x[1]).includes('filing')));
  h.push(['GET', /^\/api\/queue\/filing$/, (u, r) => json(r, { items: FILING })]);
  h.push(['POST', /^\/api\/queue\/filing\/([^/]+)\/assign$/, (u, r, m) => json(r, { id: m[1], status: 'assigned', item_id: 'i1', project_id: 'llanos-waterflood', contacts: [{ contact_id: 'jorge-salazar', organisation_id: 'andinolabs', created: true }], dispatch_ids: [] })]);
  const calls = await open(page, h);
  await page.locator('[data-queue-id="f1"] [data-assign="llanos-waterflood"]').click();
  await expect(page.locator('[data-queue-id="f1"]')).toHaveCount(0);
  await expect(page.locator('#filing-list .q-row')).toHaveCount(2);
  await expect(page.locator('#n-filing')).toHaveText('2');
  await expect(page.locator('#live')).toContainText('Filed to Llanos Basin waterflood screening; the sender is now one of its contacts.');
  const post = calls.find((c) => c.method === 'POST');
  expect(post.path).toBe('/api/queue/filing/f1/assign');
  expect(post.body).toEqual({ project_id: 'llanos-waterflood' });
});

test('assign from the list of projects, and "not a project email" keeps it in the firm inbox', async ({ page }) => {
  const h = [...full(),
    ['POST', /^\/api\/queue\/filing\/([^/]+)\/assign$/, (u, r, m) => json(r, { id: m[1], status: 'assigned', project_id: 'talara-brownfield', contacts: [] })],
    ['POST', /^\/api\/queue\/filing\/([^/]+)\/dismiss$/, (u, r, m) => json(r, { id: m[1], status: 'dismissed', project_id: 'firm' })]];
  const calls = await open(page, h);
  const row = page.locator('[data-queue-id="f2"]');
  await row.getByRole('button', { name: 'Assign' }).click();          // nothing chosen: nothing sent
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  await row.locator('select').selectOption('talara-brownfield');
  await row.getByRole('button', { name: 'Assign' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('Filed to Talara brownfield redevelopment.');
  expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toEqual([['/api/queue/filing/f2/assign', { project_id: 'talara-brownfield' }]]);

  await page.locator('[data-queue-id="f3"]').getByRole('button', { name: 'Not a project email' }).click();
  await expect(page.locator('[data-queue-id="f3"]')).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('Kept in the firm inbox');
  expect(calls.filter((c) => c.method === 'POST').pop().path).toBe('/api/queue/filing/f3/dismiss');
  await page.locator('[data-queue-id="f1"] [data-action="dismiss"]').click();
  await expect(page.locator('#filing-list .q-row')).toHaveCount(0);
  await expect(page.locator('#filing-list .hub-empty')).toContainText('Nothing waiting.');
  await expect(page.locator('#n-filing')).toHaveText('0');
});

test('a failed assign leaves the row, says so, and lets the person try again; a row someone else resolved just goes', async ({ page }) => {
  let n = 0;
  const h = [...full(), ['POST', /^\/api\/queue\/filing\/([^/]+)\/assign$/, (u, r, m) => {
    n++;
    if (m[1] === 'f2') return err(r, 409, 'already assigned');
    return n === 1 ? err(r, 500, 'database is busy') : json(r, { id: m[1], status: 'assigned', project_id: 'llanos-waterflood', contacts: [] });
  }]];
  await open(page, h);
  const row = page.locator('[data-queue-id="f1"]');
  await row.locator('[data-assign="llanos-waterflood"]').click();
  await expect(row.locator('.q-msg')).toContainText('Not done. database is busy');
  await expect(row.getByRole('button', { name: 'Assign' })).toBeEnabled();
  await row.locator('[data-assign="llanos-waterflood"]').click();
  await expect(row).toHaveCount(0);
  await page.locator('[data-queue-id="f2"] [data-assign]').first().click();
  await expect(page.locator('[data-queue-id="f2"]')).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('already dealt with');
});

test('lessons: accept and reject go to the lessons API', async ({ page }) => {
  const h = [...full(), ['POST', /^\/api\/lessons\/([^/]+)\/(confirm|reject)$/, (u, r, m) => json(r, { id: m[1], status: m[2] === 'confirm' ? 'confirmed' : 'invalidated' })]];
  const calls = await open(page, h);
  await page.locator('[data-lesson-id="l1"]').getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('[data-lesson-id="l1"]')).toHaveCount(0);
  await page.locator('[data-lesson-id="l2"]').getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('#lessons-list .hub-empty')).toBeVisible();
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/lessons/l1/confirm', '/api/lessons/l2/reject']);
});

test('review queue: accepting an organisation adds it to the registry first (a duplicate still counts), NDA expiries and rejections go to the review API', async ({ page }) => {
  let orgStatus = 201;
  const h = [...full(),
    ['POST', /^\/api\/organisations$/, (u, r) => (orgStatus === 201 ? json(r, { id: 'andinolabs' }, 201) : err(r, 409, 'possible duplicate'))],
    ['POST', /^\/api\/queue\/review\/([^/]+)\/(accept|reject)$/, (u, r, m) => json(r, { id: m[1], status: m[2] === 'accept' ? 'accepted' : 'rejected' })]];
  const calls = await open(page, h);
  const org = page.locator('[data-review-id="o1"]');
  await expect(org).toContainText('New organisation: Andinolabs');
  await expect(org).toContainText('andinolabs.co');
  await expect(org).toContainText('jorge.salazar@andinolabs.co');
  await org.locator('[data-org-name]').fill('Andino Labs S.A.S.');
  await org.locator('[data-org-kind]').selectOption('vendor');
  await org.getByRole('button', { name: 'Add to registry' }).click();
  await expect(org).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('Organisation added to the registry.');
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts.map((c) => c.path)).toEqual(['/api/organisations', '/api/queue/review/o1/accept']);
  expect(posts[0].body).toEqual({ name: 'Andino Labs S.A.S.', kind: 'vendor', identifiers: { domains: ['andinolabs.co'] } });

  const nda = page.locator('[data-review-id="n1"]');
  await expect(nda).toContainText('Set the expiry of lt-orinoco-nda-2026');
  await expect(nda).toContainText('This Agreement expires two years after the Effective Date.');
  await nda.getByRole('button', { name: 'Reject' }).click();
  await expect(nda).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'POST').pop().path).toBe('/api/queue/review/n1/reject');
  await expect(page.locator('#review-list .hub-empty')).toBeVisible();
});

test('a duplicate organisation (409) is treated as already in the registry; a partners-only refusal is explained', async ({ page }) => {
  const h = [...full(),
    ['POST', /^\/api\/organisations$/, (u, r) => err(r, 409, 'possible duplicate organisation')],
    ['POST', /^\/api\/queue\/review\/o1\/accept$/, (u, r) => err(r, 403, 'accepting is restricted to partners')],
    ['POST', /^\/api\/queue\/review\/n1\/accept$/, (u, r) => json(r, { id: 'n1', status: 'accepted' })]];
  const calls = await open(page, h);
  await page.locator('[data-review-id="o1"]').getByRole('button', { name: 'Add to registry' }).click();
  await expect(page.locator('[data-review-id="o1"] .q-msg')).toContainText('Only partners can decide this.');
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/organisations', '/api/queue/review/o1/accept']);
  await page.locator('[data-review-id="n1"]').getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('[data-review-id="n1"]')).toHaveCount(0);
});

test('?kind=rerun-delta adds that kind to the review section', async ({ page }) => {
  await open(page, full(), '?kind=rerun-delta');
  await expect(page.locator('#review-list .q-row')).toHaveCount(3);
  await expect(page.locator('[data-review-id="r1"]')).toContainText('NPV10 -8.2% after fiscal terms CO-2026 update');
});

for (const status of [404, 501]) {
  test(`sections whose endpoint answers ${status} are hidden, with no error`, async ({ page }) => {
    const h = [...base(),
      ['GET', /^\/api\/queue\/filing$/, (u, r) => json(r, { items: FILING })],
      ['GET', /^\/api\/lessons$/, (u, r) => err(r, status)],
      ['GET', /^\/api\/queue\/review$/, (u, r) => err(r, status)]];
    await open(page, h);
    await expect(page.locator('#sec-lessons')).toBeHidden();
    await expect(page.locator('#sec-review')).toBeHidden();
    await expect(page.locator('#sec-filing')).toBeVisible();
    await expect(page.locator('.hub-notice')).toHaveCount(0);
  });
}

test('with the filing queue not built the page still opens; with the Vault down it says so', async ({ page }) => {
  await open(page, [...base(), ['GET', /^\/api\/queue\/filing$/, (u, r) => err(r, 501)], ['GET', /^\/api\/lessons$/, (u, r) => json(r, { lessons: LESSONS })]]);
  await expect(page.locator('#sec-filing')).toBeHidden();
  await expect(page.locator('#sec-lessons')).toBeVisible();

  const page2 = await page.context().newPage();
  await page2.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' }));
  await page2.goto('/hub/queue.html');
  await ready(page2);
  await expect(page2.locator('#filing-list .hub-notice.bad')).toContainText('Could not load this queue.');
  await expect(page2.locator('#sec-lessons')).toBeHidden();
  await expect(page2.locator('#sec-review')).toBeHidden();
});

test('an empty queue says nothing is waiting', async ({ page }) => {
  await open(page, [...base(), ['GET', /^\/api\/queue\/filing$/, (u, r) => json(r, { items: [] })], ['GET', /^\/api\/lessons$/, (u, r) => json(r, { lessons: [] })], ['GET', /^\/api\/queue\/review$/, (u, r) => json(r, { items: [] })]]);
  for (const id of ['#filing-list', '#lessons-list', '#review-list']) await expect(page.locator(id + ' .hub-empty')).toContainText('Nothing waiting.');
});

test('every element with data-en also has data-es, and the text follows the language toggle', async ({ page }) => {
  await open(page, full());
  const check = () => page.evaluate(() => {
    const missing = [...document.querySelectorAll('[data-en]')].filter((el) => !el.hasAttribute('data-es')).map((el) => el.outerHTML.slice(0, 80));
    const missingPh = [...document.querySelectorAll('[data-en-ph]')].filter((el) => !el.hasAttribute('data-es-ph')).map((el) => el.outerHTML.slice(0, 80));
    const bare = [...document.body.querySelectorAll('*')].filter((el) => {
      if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT', 'TEXTAREA'].includes(el.tagName.toUpperCase()) || el.closest('svg, .nav-wordmark, .hub-av, .nav-lang')) return false;
      if (el.children.length) return false;
      const t = el.textContent.trim();
      return /\p{L}{2,}/u.test(t) && !el.hasAttribute('data-en') && !el.closest('[data-en]');
    }).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
    return { count: document.querySelectorAll('[data-en]').length, missing, missingPh, bare };
  });
  const en = await check();
  expect(en.count).toBeGreaterThan(60);
  expect(en.missing).toEqual([]);
  expect(en.missingPh).toEqual([]);
  expect(en.bare).toEqual([]);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('h1')).toHaveText('Colas');
  await expect(page.locator('#h-filing')).toHaveText('Cola de archivo');
  await expect(page.locator('#h-lessons')).toHaveText('Propuestas de lecciones');
  await expect(page.locator('[data-queue-id="f1"] [data-action="assign"]')).toHaveText('Asignar');
  await expect(page.locator('[data-queue-id="f1"] [data-action="dismiss"]')).toHaveText('No es un correo de proyecto');
  await expect(page.locator('[data-review-id="o1"] [data-action="accept"]')).toHaveText('Añadir al registro');
  expect((await check()).missing).toEqual([]);
});

test('accessibility: axe finds no WCAG 2 A/AA violations on the seeded page', async ({ page }) => {
  await open(page, full());
  let AxeBuilder;
  try { ({ default: AxeBuilder } = await import('@axe-core/playwright')); } catch (e) { AxeBuilder = null; }
  if (!AxeBuilder) {
    // Fallback if axe cannot be installed: every control has an accessible name, every select a label, one main landmark.
    await expect(page.locator('main')).toHaveCount(1);
    for (const sel of ['button', 'select', 'input[type="text"]']) {
      const n = await page.locator(sel).count();
      for (let i = 0; i < n; i++) await expect(page.locator(sel).nth(i)).toHaveAccessibleName(/.+/);
    }
    return;
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('not indexable: noindex meta, no analytics snippet, listed in robots.txt, absent from the sitemap', async ({ page, request }) => {
  await page.goto('/hub/queue.html');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  const html = await (await request.get('/hub/queue.html')).text();
  expect(html).not.toMatch(/googletagmanager|gtag\(/);
  expect(await (await request.get('/robots.txt')).text()).toMatch(/^Disallow: \/hub\/$/m);
  expect(await (await request.get('/sitemap.xml')).text()).not.toMatch(/queue\.html/);
});

test('screenshot of the seeded queue page', async ({ page }) => {
  await open(page, [...full(), ['GET', /^\/api\/queue\/review$/, (u, r) => json(r, { items: REVIEW.slice(0, 2) })]]);
  await expect(page.locator('#filing-list .q-row')).toHaveCount(3);
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  await page.screenshot({ path: EVIDENCE, fullPage: true });
});

/* ── wave 3, PR 2: fields named in documents (W3-AC5, queue side) ── */

const ASSET_ROW = { id: 'a1', kind: 'asset', status: 'open', payload: { project_id: 'llanos-waterflood', item_id: 'i9', item_version: 1, item_title: 'Data room index', name: 'Guafita', kind: 'field', quote: 'Current production comes from the Guafita and La Victoria fields.', anchor: 'page 3', source: 'dictionary',
  candidates: [{ name: 'Guafita', kind: 'field', country: 'VE', lat: 7.98, lon: -69.12, source: 'gem', source_id: 'G100', source_url: 'https://www.gem.wiki/Guafita_Oil_Field', confidence: 1, asset_id: 'field:ve:guafita', detail: null }] } };
const BARE_ROW = { id: 'a2', kind: 'asset', status: 'open', payload: { project_id: 'llanos-waterflood', item_id: 'i9', item_version: 1, item_title: 'Data room index', name: 'Nowhere', kind: 'field', quote: 'Nowhere Field is a name no gazetteer knows.', anchor: 'page 3', source: 'model', candidates: [] } };

test('a field named in a document is a review row with its quote and project; Attach accepts with the first candidate (or the name alone); Not a field rejects', async ({ page }) => {
  const h = full().filter((x) => !(x[0] === 'GET' && String(x[1]).includes('review')));
  h.push(['GET', /^\/api\/queue\/review$/, (u, r) => json(r, { items: [...REVIEW, ASSET_ROW, BARE_ROW] })]);
  h.push(['POST', /^\/api\/queue\/review\/([^/]+)\/(accept|reject)$/, (u, r, m) => json(r, { id: m[1], status: m[2] === 'accept' ? 'accepted' : 'rejected' })]);
  const calls = await open(page, h);
  await expect(page.locator('#review-list .q-row')).toHaveCount(4);
  const row = page.locator('[data-review-id="a1"]');
  await expect(row).toHaveAttribute('data-kind', 'asset');
  await expect(row).toContainText('Field named in a document: Guafita');
  await expect(row.locator('[data-proposal-project]')).toHaveText('Llanos Basin waterflood screening');
  await expect(row.locator('[data-proposal-project]')).toHaveAttribute('href', '/hub/project.html?id=llanos-waterflood#p-fields');
  await expect(row).toContainText('Data room index · page 3');
  await expect(row.locator('.q-quote')).toContainText('Current production comes from the Guafita and La Victoria fields.');
  await expect(row.locator('[data-first-candidate="gem:G100"]')).toContainText('Accept attaches Guafita (gem, 7.98, -69.12)');
  await row.getByRole('button', { name: 'Attach' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('Field attached to the project; its dossier is filed.');
  const bare = page.locator('[data-review-id="a2"]');
  await expect(bare).toContainText('No gazetteer match: Accept attaches the name without a location.');
  await bare.getByRole('button', { name: 'Not a field' }).click();
  await expect(bare).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('Rejected.');
  expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toEqual([
    ['/api/queue/review/a1/accept', { asset_id: 'field:ve:guafita' }],
    ['/api/queue/review/a2/reject', {}],
  ]);
  await expect(page.locator('#n-review')).toHaveText('2');
});

test('W6-AC5: rows the capture marked ready sit in a Ready group with Accept all; the rest need a decision; Accept all files them in one call', async ({ page }) => {
  const rows = [
    { ...FILING[0], id: 'f1', group: 'ready' },
    { ...FILING[1], id: 'f2', group: 'ready' },
    { ...FILING[2], id: 'f3', group: 'review' },
  ];
  const h = full().filter((x) => !(x[0] === 'GET' && String(x[1]).includes('filing')));
  h.push(['GET', /^\/api\/queue\/filing$/, (u, r) => json(r, { items: rows })]);
  h.push(['POST', /^\/api\/queue\/filing\/accept-ready$/, (u, r) => json(r, { filed: [{ id: 'f1', item_id: 'i1', project_id: 'llanos-waterflood' }, { id: 'f2', item_id: 'i2', project_id: 'llanos-waterflood' }], skipped: [] })]);
  const calls = await open(page, h);
  const list = page.locator('#filing-list');
  await expect(list.locator('.q-group-head[data-group="ready"]')).toContainText('2 messages with one clear project');
  await expect(list.locator('.q-row[data-group="ready"]')).toHaveCount(2);
  await expect(list.locator('.q-group-head[data-group="review"]')).toContainText('Needs a decision');
  await expect(list.locator('.q-row[data-group="review"]')).toHaveCount(1);
  await expect(page.locator('#n-filing')).toHaveText('3');
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  await page.locator('#sec-filing').screenshot({ path: path.join(path.dirname(EVIDENCE), 'w6-ready-group.png') });
  await page.locator('#filing-accept-ready').click();
  await expect(list.locator('.q-row')).toHaveCount(1);
  await expect(page.locator('#n-filing')).toHaveText('1');
  await expect(page.locator('#live')).toContainText('2 messages filed.');
  const post = calls.find((c) => c.method === 'POST');
  expect(post.path).toBe('/api/queue/filing/accept-ready');
  expect(post.body).toEqual({ ids: ['f1', 'f2'] });
  await expect(list.locator('.q-group-head[data-group="ready"]')).toHaveCount(0);
});

// ── Wave 7 PR3 (H7, W7-AC16 Hub side): a project from a filing row ────────────────────────────────────────────
const EVIDENCE7 = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const ASSOCIATE = { id: 'ana', name: 'Ana Pérez', email: 'ana@alpha-technical-centre.com', role: 'associate' };

test('W7-AC16 (Hub): a partner creates a project from a received message: the sheet prefills the name, id, organisation and country; Create posts to the Vault, the row goes and the new project is linked', async ({ page }) => {
  const rows = [FILING[0], { ...FILING[1], organisation: { id: 'laboratorio-andino', name: 'Laboratorio Andino S.A.S.', country: 'CO' } }, FILING[2]];
  const h = full().filter((x) => !(x[0] === 'GET' && String(x[1]).includes('filing')));
  h.push(['GET', /^\/api\/queue\/filing$/, (u, r) => json(r, { items: rows })]);
  h.push(['POST', /^\/api\/queue\/filing\/([^/]+)\/create-project$/, (u, r, m) => {
    const b = JSON.parse(r.request().postData());
    return json(r, { project: { id: b.id, name: b.name, status: 'prospect', country: b.country || 'CO', origin_ref: 'doc:i' + m[1].slice(1), register: { holder: 'Laboratorio Andino S.A.S.' }, contacts: ['lab-andino'], organisations: [{ organisation_id: 'laboratorio-andino', name: 'Laboratorio Andino S.A.S.', role: 'holder' }] }, assigned: { id: m[1], status: 'assigned', project_id: b.id, contacts: [{ contact_id: 'lab-andino', organisation_id: 'laboratorio-andino', created: true }] } }, 201);
  }]);
  const calls = await open(page, h);
  // Received rows offer it; the one the firm sent does not.
  await expect(page.locator('[data-queue-id="f1"] [data-action="create-project"]')).toHaveText('Create a project from this');
  await expect(page.locator('[data-queue-id="f2"] [data-action="create-project"]')).toHaveCount(1);
  await expect(page.locator('[data-queue-id="f3"] [data-action="create-project"]')).toHaveCount(0);
  // The sheet, prefilled from the message: the subject without its RE:, the id from it, the organisation the row names with its country.
  const row = page.locator('[data-queue-id="f2"]');
  await row.locator('[data-action="create-project"]').click();
  const sheet = row.locator('[data-create-sheet="f2"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-create-name]')).toHaveValue('Updated PVT report, Cubiro-14 sample');
  await expect(sheet.locator('[data-create-id]')).toHaveValue('updated-pvt-report-cubiro-14-sample');
  await expect(sheet.locator('[data-create-org]')).toHaveValue('Laboratorio Andino S.A.S.');
  await expect(sheet.locator('[data-create-org]')).toHaveAttribute('data-organisation-id', 'laboratorio-andino');
  await expect(sheet.locator('[data-create-country]')).toHaveValue('CO');
  await expect(sheet.locator('[data-create-country] option[value="CO"]')).toHaveText('Colombia');
  // A row without an organisation on it guesses the name from the sender's domain and leaves the country to the Vault.
  const row1 = page.locator('[data-queue-id="f1"]');
  await row1.locator('[data-action="create-project"]').click();
  await expect(row1.locator('[data-create-org]')).toHaveValue('Andinolabs');
  await expect(row1.locator('[data-create-country]')).toHaveValue('');
  await expect(row1.locator('[data-create-name]')).toHaveValue('Cubiro water injection data request');
  mkdirSync(EVIDENCE7, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(EVIDENCE7, 'w7-create-from-queue.png'), fullPage: false });
  await row1.locator('[data-action="create-project-cancel"]').click();
  await expect(row1.locator('[data-create-sheet]')).toHaveCount(0);
  // The name can be changed; the id follows until edited by hand.
  await sheet.locator('[data-create-name]').fill('Cubiro-14 PVT review');
  await expect(sheet.locator('[data-create-id]')).toHaveValue('cubiro-14-pvt-review');
  await sheet.locator('[data-action="create-project-go"]').click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('#filing-list .q-row')).toHaveCount(2);
  await expect(page.locator('#n-filing')).toHaveText('2');
  await expect(page.locator('#live')).toContainText('Project created and the message filed to it');
  await expect(page.locator('#live [data-created-project="cubiro-14-pvt-review"]')).toHaveAttribute('href', '/hub/project.html?id=cubiro-14-pvt-review');
  const post = calls.find((c) => c.method === 'POST');
  expect(post.path).toBe('/api/queue/filing/f2/create-project');
  expect(post.body).toEqual({ name: 'Cubiro-14 PVT review', id: 'cubiro-14-pvt-review', country: 'CO', organisation_id: 'laboratorio-andino' });
  // The new project joins the assign list of the rows still waiting.
  await expect(page.locator('[data-queue-id="f1"] select option', { hasText: 'Cubiro-14 PVT review' })).toHaveCount(1);
});

test('W7-AC16 (Hub): an unknown sender is said so with the way out; an associate sees no Create a project', async ({ page }) => {
  const h = [...full(), ['POST', /^\/api\/queue\/filing\/([^/]+)\/create-project$/, (u, r) => json(r, { error: { code: 'unknown_organisation', message: 'the sender is not in the registry yet' } }, 409)]];
  await open(page, h);
  const row = page.locator('[data-queue-id="f1"]');
  await row.locator('[data-action="create-project"]').click();
  await row.locator('[data-action="create-project-go"]').click();
  await expect(row.locator('.q-msg.bad')).toContainText('The sender is not in the registry yet.');
  await expect(row).toHaveCount(1);
  await expect(page.locator('#filing-list .q-row')).toHaveCount(3);
  // An associate: no such action on any row.
  const asAna = full().filter((x) => !(x[0] === 'GET' && String(x[1]).includes('me$')));
  asAna.unshift(['GET', /^\/api\/me$/, (u, r) => json(r, ASSOCIATE)]);
  await open(page, asAna);
  await expect(page.locator('#filing-list .q-row')).toHaveCount(3);
  await expect(page.locator('[data-action="create-project"]')).toHaveCount(0);
});
