// Wave 7 PR6 (O) (docs/vault-hub/wave7/05-markup.md §1.9, W7-AC22 Hub part; 04-step-changes.md P2): the round watch.
// Today carries "Deadlines in the next 90 days" among the counters for the countries of the person's active and prospect
// projects, one tappable row per confirmed event (country, round, stage, date, "in N days", overdue in red) with the source
// page as a chip that opens the stored original in the record panel, or the page itself in a new tab; the proposals still
// waiting are one line to the queue. The globe rings a country with an open round and the country panel says which round
// and when. The review queue lists proposals of kind `round` with the verbatim quote; Accept confirms, Reject dismisses,
// through the queue's existing calls. What came in gets one line when a confirmed deadline moved since the person last
// looked. The API is stubbed with page.route against the shapes in vault/src/rounds/types.ts; the static server serves
// the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const MEMBER = { id: 'ana', name: 'Ana Pérez', email: 'ana@alpha-technical-centre.com', role: 'associate' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const DAY = 864e5;
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const ymd = (daysFromNow) => new Date(NOW + daysFromNow * DAY).toISOString().slice(0, 10);
/** The date as the Hub's shared formatter prints it ("7 Oct 2026"). */
const shortDate = (daysFromNow) => new Date(ymd(daysFromNow) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const ANP = u(801), QUOTE_ITEM = u(802);
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

/* ── the projects: Brazil active, Colombia prospect, Venezuela active, Peru archived ── */
const cproj = (id, name, lat, lon, status = 'active') => ({ id, name, status, stage: 'Technical review', client_id: null, client_name: null, lat, lon, last_run_at: null, attention: { stale: 0, filing: 0, expiring_days: null }, assets: [] });
const tproj = (id, name, code, lat, lon, status = 'active') => ({ id, name, status, client_id: null, default_legal_tag: 'lt-firm', country: code, lat, lon, stage: 'Technical review', stage_history: [{ stage: 'Technical review', at: '2026-09-22T12:00:00.000Z', by: 'chris' }], register: { next: 'Next step', owner: 'Chris' }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z', last_activity_at: iso(2 * DAY), run_count: 1, item_count: 2, stale_count: 0 });
const COUNTRIES = {
  countries: [
    { code: 'BR', name: { en: 'Brazil', es: 'Brasil' }, projects: [cproj('reconcavo', 'Recôncavo late-life economics', -12.5, -38.5)], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
    { code: 'CO', name: { en: 'Colombia', es: 'Colombia' }, projects: [cproj('llanos', 'Llanos waterflood', 4.1, -72.9, 'prospect')], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
    { code: 'VE', name: { en: 'Venezuela', es: 'Venezuela' }, projects: [cproj('barinas', 'Barinas cluster', 8.1, -69.3)], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
  ],
  unplaced: [], generated_at: iso(0), world_monitor: { status: 'not_connected', notes: [] },
};
const PROJECTS = [tproj('reconcavo', 'Recôncavo late-life economics', 'BR', -12.5, -38.5), tproj('llanos', 'Llanos waterflood', 'CO', 4.1, -72.9, 'prospect'), tproj('barinas', 'Barinas cluster', 'VE', 8.1, -69.3), tproj('talara', 'Talara redevelopment', 'PE', -4.6, -81.3, 'archived')];

/* ── the round events (vault/src/rounds/types.ts RoundEvent) ── */
const ANP_URL = 'https://www.gov.br/anp/pt-br/rodadas-anp/oferta-permanente';
const ANH_URL = 'https://www.anh.gov.co/es/hidrocarburos/oportunidades-disponibles/proceso-permanente-de-asignacion-de-areas/';
const PERU_URL = 'https://www.perupetro.com.pe/wps/portal/corporativo/PerupetroSite/promocion';
const QUOTE_BR = 'The fifth concession cycle receives bids on ' + new Date(ymd(2) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + ' at the ANP auditorium in Rio de Janeiro.';
const ev = (id, country, round, stage, days, over) => ({
  id, country, round, stage, event_date: days === null ? null : ymd(days), title: round + ': ' + stage, quote: 'Quote for ' + round + '.',
  source_item: null, source_url: ANP_URL, read_at: iso(DAY), status: 'confirmed', confirmed_by: 'chris', confirmed_at: iso(10 * DAY), created_at: iso(12 * DAY), days, ...(over || {}),
});
const E_BR_BID = ev(u(101), 'BR', '5th Concession Cycle, Permanent Offer', 'bid_deadline', 2, { source_item: ANP, quote: QUOTE_BR, read_at: iso(0), confirmed_at: iso(3600e3), created_at: iso(2 * 3600e3) });
const E_BR_OLD = ev(u(100), 'BR', '5th Concession Cycle, Permanent Offer', 'bid_deadline', -5, { status: 'superseded', confirmed_at: iso(20 * DAY), created_at: iso(22 * DAY), read_at: iso(21 * DAY) });
const E_BR_DATA = ev(u(102), 'BR', 'Open Acreage 2026', 'data_package', 45, { confirmed_at: iso(20 * DAY), created_at: iso(21 * DAY), read_at: iso(21 * DAY) });
const E_CO_QUAL = ev(u(103), 'CO', 'Permanent Process for the Assignment of Areas', 'qualification', -3, { source_url: ANH_URL, read_at: iso(5 * DAY) });
const E_PE_BID = ev(u(104), 'PE', 'Lote 207 convocation', 'bid_deadline', 20, { source_url: PERU_URL });
const VIEW = () => ({
  countries: [
    { country: 'BR', name: 'Brazil', open: true, events: [E_BR_OLD, E_BR_BID, E_BR_DATA] },
    { country: 'CO', name: 'Colombia', open: false, events: [E_CO_QUAL] },
    { country: 'PE', name: 'Peru', open: true, events: [E_PE_BID] },
    { country: 'VE', name: 'Venezuela', open: false, events: [] },
  ],
  deadlines: [E_CO_QUAL, E_BR_BID, E_PE_BID, E_BR_DATA],      // soonest first, as the Vault sorts them; Peru's project is archived so the Hub leaves it out
  proposed: 2,
});
const EMPTY = (proposed = 0) => ({ countries: [{ country: 'BR', name: 'Brazil', open: false, events: [] }], deadlines: [], proposed });
/** The stored original behind the Brazil chip: the ANP page fetched today, indexed, served as text. */
const ORIGINAL = {
  id: ANP, type: 'feed-snapshot', title: 'ANP, Oferta Permanente', created_at: iso(0), authored_at: null, authors: [], client_id: null, project_id: 'firm', asset_ids: [], organisation_ids: [], legal_tag: 'lt-public',
  origin: { source: 'round-watch', external_id: ANP_URL, fetched_at: iso(0) }, storage_key: 'originals/ee/' + 'e'.repeat(64), content_hash: 'sha256:' + 'e'.repeat(64), version: 3, supersedes: null, cites: [], filing: { method: 'job' }, mime: 'text/html',
  extracted: { kind: 'round-page', text_chars: 300, chunks: 2, format: 'html', text: 'Oferta Permanente de Concessão, fifth cycle.\n\n' + QUOTE_BR + '\n\nThe schedule replaces the one published in September.', ingest: { version: 2, status: 'ok', at: iso(0) } }, stale: false, tags: [],
};
/* ── the review-queue rows of kind round (the proposal as the payload) ── */
const Q_BR = { id: 'q1', kind: 'round', status: 'open', payload: { country: 'BR', round: '5th Concession Cycle, Permanent Offer', stage: 'bid_deadline', event_date: ymd(2), title: '5th Concession Cycle: bid deadline', quote: QUOTE_BR, source_item: ANP, source_url: ANP_URL, read_at: iso(0) } };
const Q_CO = { id: 'q2', kind: 'round', status: 'open', payload: { country: 'CO', round: 'Permanent Process for the Assignment of Areas', stage: 'announced', event_date: null, title: 'PPAA announced', quote: 'The ANH announces the opening of a new cycle of the Permanent Process.', source_item: null, source_url: ANH_URL, read_at: iso(DAY) } };
const Q_ORG = { id: 'o1', kind: 'organisation', status: 'open', payload: { name: 'Andinolabs', domain: 'andinolabs.co', sender_email: 'jorge@andinolabs.co', sender_name: 'Jorge Salazar', subject: 'RE: data request' } };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Stub Today and the queue. `rounds` is the RoundsView (null answers 404, 'off' answers 501) or a function of the
 * request url; `review` the review-queue rows. Returns the log: every /api/rounds request's search, the review posts.
 */
async function stub(page, { me = PARTNER, rounds = VIEW(), review = [Q_BR, Q_CO, Q_ORG], since = iso(DAY), activity } = {}) {
  const log = { rounds: [], posts: [] };
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url()); const p = url.pathname; const m = route.request().method();
    if (p === '/api/me') return json(route, me);
    if (p === '/api/health') return json(route, { ok: true, version: '0.7.0', migrations: 10, backend: 'pg' });
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (p === '/api/projects') return json(route, { projects: PROJECTS });
    if (p === '/api/organisations') return json(route, { organisations: [] });
    if (p === '/api/me/mailbox') return json(route, { prompt: false, connected: false, configured: false });
    if (p === '/api/me/activity') return json(route, activity || { since, counts: { records: 0 }, projects: [], brief_available: false });
    if (/^\/api\/countries\/[A-Z]{2}\/intel$/.test(p)) return json(route, { country: p.split('/')[3], name: { en: 'Country', es: 'País' }, world_monitor: { status: 'not_connected', reason: 'not connected' }, sections: {} });
    if (/^\/api\/countries\/[A-Z]{2}\/pack$/.test(p)) return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
    if (p === '/api/rounds') {
      log.rounds.push(url.search);
      const v = typeof rounds === 'function' ? rounds(url) : rounds;
      if (v === null) return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
      if (v === 'off') return json(route, { error: { code: 'not_implemented', message: 'the round watch is not configured' } }, 501);
      return json(route, v);
    }
    const qr = /^\/api\/queue\/review\/([^/]+)\/(accept|reject)$/.exec(p);
    if (qr && m === 'POST') { log.posts.push([qr[1], qr[2], route.request().postData()]); return json(route, { id: qr[1], status: qr[2] === 'accept' ? 'accepted' : 'rejected' }); }
    if (p === '/api/queue/review') return json(route, { items: url.searchParams.get('kind') === 'rerun-delta' ? [] : review });   // Today's re-run counter asks by kind
    if (p === '/api/queue/filing') return json(route, { items: [] });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/items/' + ANP) return json(route, ORIGINAL);
    if (p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return log;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const globeReady = (page) => page.locator('#sec-globe[data-globe="ready"]').waitFor();
const card = (page) => page.locator('#card-deadlines');
const rows = (page) => card(page).locator('[data-deadline]');
/** The computed colour of a CSS token on the root, to compare with an element's colour. */
const tokenColour = (page, token) => page.evaluate((t) => { const s = document.createElement('span'); s.style.color = 'var(' + t + ')'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; }, token);

test('W7-AC22 (Today): the Deadlines card sits among the counters with one tappable row per confirmed event in the next 90 days for the countries of the active and prospect projects, soonest first: country, round, stage, date and "in N days", the overdue one in red; one fetch; the proposals waiting are one line to the queue', async ({ page }) => {
  const log = await stub(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const c = card(page);
  await expect(c).toBeVisible();
  expect(await c.evaluate((el) => el.closest('#sec-counters .hub-counters') !== null)).toBe(true);
  await expect(c).toHaveAttribute('data-rounds', 'ready');
  await expect(c).not.toHaveAttribute('data-empty', /.+/);
  await expect(c.locator('h3')).toHaveText('Deadlines in the next 90 days');
  await expect(c.locator('.hub-counter-head .hub-num')).toHaveText('3');
  // One fetch, for confirmed events within 90 days; the countries are the Hub's to filter (Peru's project is archived).
  expect(log.rounds).toEqual(['?within=90&status=confirmed']);
  await expect(rows(page)).toHaveCount(3);
  expect(await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-deadline')))).toEqual([E_CO_QUAL.id, E_BR_BID.id, E_BR_DATA.id]);
  expect(await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-country')))).toEqual(['CO', 'BR', 'BR']);
  // The Brazil bid deadline: country, round, the stage label from the shared list, the date through the shared formatter, the days as a figure.
  const br = c.locator('[data-deadline="' + E_BR_BID.id + '"]');
  await expect(br.locator('.hub-dl-country')).toHaveText('Brazil');
  await expect(br.locator('.hub-dl-round')).toHaveText('5th Concession Cycle, Permanent Offer');
  await expect(br.locator('.hub-dl-stage')).toHaveText('Bid deadline');
  await expect(br.locator('.hub-dl-date')).toHaveText(shortDate(2));
  await expect(br.locator('.hub-dl-days')).toHaveText('in 2 days');
  await expect(br.locator('.hub-dl-days .hub-num')).toHaveText('2');
  await expect(br.locator('.hub-dl-days')).not.toHaveAttribute('data-overdue', /.+/);
  // The overdue one, in the bad red.
  const co = c.locator('[data-deadline="' + E_CO_QUAL.id + '"]');
  await expect(co.locator('.hub-dl-stage')).toHaveText('Qualification');
  await expect(co.locator('.hub-dl-days')).toHaveText('3 days overdue');
  await expect(co.locator('.hub-dl-days')).toHaveAttribute('data-overdue', '1');
  expect(await co.locator('.hub-dl-days').evaluate((el) => getComputedStyle(el).color)).toBe(await tokenColour(page, '--bad'));
  expect(await br.locator('.hub-dl-days').evaluate((el) => getComputedStyle(el).color)).not.toBe(await tokenColour(page, '--bad'));
  // The data package in 45 days, and nothing from Peru.
  await expect(c.locator('[data-deadline="' + E_BR_DATA.id + '"] .hub-dl-days')).toHaveText('in 45 days');
  await expect(c).not.toContainText('Lote 207');
  // The proposals waiting: one line to the queue, the count as a figure.
  const prop = c.locator('[data-rounds-proposed]');
  await expect(prop).toHaveText('2 round dates to confirm');
  await expect(prop.locator('.hub-num')).toHaveText('2');
  await expect(prop).toHaveAttribute('href', '/hub/queue.html?kind=round');
  // Every row is one tap of at least 44 px; the chip a comfortable 28 at the desk (36 below 1024 px, asserted with the touch checks).
  for (const r of await rows(page).locator('.hub-dl-main').all()) expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(44);
  for (const ch of await rows(page).locator('.hub-dl-src').all()) expect((await ch.boundingBox()).height).toBeGreaterThanOrEqual(28);
  // Spanish follows: the title, the stage from the shared list, the days.
  await page.locator('aside .nav-lang button[data-lang="es"]').click();
  await expect(c.locator('h3')).toHaveText('Plazos en los próximos 90 días');
  await expect(br.locator('.hub-dl-stage')).toHaveText('Plazo de ofertas');
  await expect(br.locator('.hub-dl-days')).toHaveText('en 2 días');
  await expect(co.locator('.hub-dl-days')).toHaveText('3 días de retraso');
  await expect(br.locator('.hub-dl-country')).toHaveText('Brasil');
  await expect(prop).toHaveText('2 fechas de ronda por confirmar');
  await page.locator('aside .nav-lang button[data-lang="en"]').click();
  // Bilingual: every text node in the card carries both languages.
  const bare = await c.evaluate((el) => [...el.querySelectorAll('*')].filter((x) => !x.children.length && /\p{L}{2,}/u.test(x.textContent) && !x.hasAttribute('data-en') && !x.closest('[data-en]') && !x.closest('svg')).map((x) => x.tagName + ':' + x.textContent.trim().slice(0, 40)));
  expect(bare).toEqual([]);
  expect(await c.evaluate((el) => [...el.querySelectorAll('[data-en]')].filter((x) => !x.hasAttribute('data-es')).length)).toBe(0);
  // No jargon in what the person reads (W7-AC10).
  const text = await c.evaluate((el) => [el.innerText, ...[...el.querySelectorAll('[title], [aria-label]')].map((x) => (x.getAttribute('title') || '') + ' ' + (x.getAttribute('aria-label') || ''))].join('\n'));
  expect(text).not.toMatch(/SETUP\.md|_KEY\b|\bAC\d+\b|\bM\d\d\b|\.json\b|\.md\b/);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await c.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-deadlines.png') });
});

test('W7-AC22 (Today): the source chip is the host and the day the page was read; with a stored original it opens the record panel on it with the quote highlighted, without one it opens the page in a new tab; the row itself opens the country on the globe', async ({ page }) => {
  await stub(page);
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  const br = card(page).locator('[data-deadline="' + E_BR_BID.id + '"]');
  const chip = br.locator('.hub-dl-src');
  await expect(chip).toHaveText('gov.br · read ' + shortDate(0));
  await expect(chip).toHaveAttribute('data-item', ANP);
  expect(await chip.evaluate((el) => el.tagName)).toBe('BUTTON');
  await chip.click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + ANP);
  await expect(panel.locator('#rp-title')).toHaveText('ANP, Oferta Permanente');
  await expect(panel.locator('[data-passage]')).toContainText(QUOTE_BR);
  const marks = panel.locator('[data-text] mark');
  expect(await marks.count()).toBeGreaterThan(0);
  await expect(marks.first()).toHaveAttribute('data-anchor', '');
  await page.locator('#rp-close').click();
  await expect(panel).toBeHidden();
  await chip.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  // Without a stored original the chip is the page itself, in a new tab.
  const co = card(page).locator('[data-deadline="' + E_CO_QUAL.id + '"]');
  const link = co.locator('.hub-dl-src');
  expect(await link.evaluate((el) => el.tagName)).toBe('A');
  await expect(link).toHaveAttribute('href', ANH_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveText('anh.gov.co · read ' + shortDate(-5));
  // The row is the door to the country: the panel opens on Brazil and says which round and when.
  await br.locator('.hub-dl-main').click();
  await expect(page.locator('#sec-globe')).toHaveAttribute('data-country', 'BR');
  await expect(page).toHaveURL(/country=BR/);
  await expect(page.locator('#country-panel')).toBeVisible();
  await expect(page.locator('#country-round')).toContainText('5th Concession Cycle, Permanent Offer');
});

test('W7-AC22 (Today): with nothing due the card collapses to one line with the count; proposals still show as the line to the queue; when the Vault has no rounds route the card stays out of sight and the four counters are as they were', async ({ page }) => {
  await stub(page, { rounds: EMPTY(0) });
  await page.goto('/hub/index.html');
  await ready(page);
  const c = card(page);
  await expect(c).toBeVisible();
  await expect(c).toHaveAttribute('data-empty', '1');
  await expect(c.locator('.hub-counter-head .hub-num')).toHaveText('0');
  await expect(rows(page)).toHaveCount(0);
  await expect(c.locator('[data-rounds-proposed]')).toHaveCount(0);
  expect((await c.boundingBox()).height, 'one line').toBeLessThan(64);
  await expect(c).not.toContainText('Nothing waiting');
  await expect(page.locator('#sec-counters [data-empty="1"]')).toHaveCount(5);
  // Proposals waiting but nothing confirmed yet: the line to the queue under the one-line head.
  await stub(page, { rounds: EMPTY(3) });
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(c).toHaveAttribute('data-empty', '1');
  await expect(c.locator('[data-rounds-proposed]')).toHaveText('3 round dates to confirm');
  await expect(c.locator('[data-rounds-proposed]')).toHaveAttribute('href', '/hub/queue.html?kind=round');
  // No route: hidden, no notice, the four counters untouched.
  for (const rounds of [null, 'off']) {
    await stub(page, { rounds });
    await page.goto('/hub/index.html');
    await ready(page);
    await expect(c).toBeHidden();
    await expect(c).toHaveAttribute('data-rounds', 'unavailable');
    await expect(page.locator('#sec-counters [data-empty="1"]')).toHaveCount(4);
    await expect(page.locator('.hub-notice')).toHaveCount(0);
  }
});

test('W7-AC22 (globe): a country with an open round wears a ring, named in the hover; the country panel says the round and its next date, "No open round" without one, and nothing when the Vault has no rounds route', async ({ browser }) => {
  // Reduced motion: the globe stands still and flights are instant, so two screenshots compare.
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const log = await stub(page);
  await page.goto('/hub/index.html?country=BR');
  await ready(page); await globeReady(page);
  await expect(page.locator('#sec-globe')).toHaveAttribute('data-rings', 'BR,PE');
  await page.waitForTimeout(300);
  const ringed = await page.locator('#globe').screenshot();
  // The panel line: the round, the stage, the date and the days, from one fetch for the chosen country.
  const line = page.locator('#country-round');
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('data-round-state', 'open');
  await expect(line).toHaveText('Round: 5th Concession Cycle, Permanent Offer · bid deadline ' + shortDate(2) + ' (in 2 days)');
  await expect(line.locator('.hub-num')).toHaveText('2');
  expect(log.rounds.filter((s) => /country=BR/.test(s))).toHaveLength(1);
  expect(log.rounds.filter((s) => /country=BR/.test(s))[0]).toBe('?country=BR&status=confirmed');
  // The hover names the ring.
  const box = await page.locator('#globe').boundingBox();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  await expect(page.locator('#globe-tip')).toHaveText('Brazil · Open licence round');
  await page.mouse.move(box.x + 2, box.y + 2);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-globe-ring.png') });
  // Spanish follows in the line and the hover.
  await page.locator('aside .nav-lang button[data-lang="es"]').click();
  await expect(line).toContainText('Ronda: 5th Concession Cycle, Permanent Offer · plazo de ofertas');
  await expect(line).toContainText('(en 2 días)');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  await expect(page.locator('#globe-tip')).toHaveText('Brasil · Ronda de licencias abierta');
  await page.locator('aside .nav-lang button[data-lang="en"]').click();
  // A country without an open round says so; one the Vault has no route for shows nothing.
  await page.locator('#country-back').click();
  await page.locator('#register [data-country="VE"]').click();
  await expect(page.locator('#country-panel')).toBeVisible();
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('data-round-state', 'none');
  await expect(line).toHaveText('No open round');
  await page.locator('#country-back').click();
  await page.locator('#register [data-country="CO"]').click();
  await expect(line).toHaveText('No open round');                     // a past qualification date is not an open round
  // The same globe without rings draws differently.
  const page2 = await ctx.newPage();
  const noRings = VIEW(); for (const c of noRings.countries) c.open = false;
  await stub(page2, { rounds: noRings });
  await page2.goto('/hub/index.html?country=BR');
  await ready(page2); await globeReady(page2);
  await expect(page2.locator('#sec-globe')).not.toHaveAttribute('data-rings', /.+/);
  await page2.waitForTimeout(300);
  const plain = await page2.locator('#globe').screenshot();
  expect(Buffer.compare(ringed, plain)).not.toBe(0);
  await expect(page2.locator('#country-round')).toHaveText('No open round');
  // No rounds route: the line stays out of sight.
  const page3 = await ctx.newPage();
  await stub(page3, { rounds: null });
  await page3.goto('/hub/index.html?country=BR');
  await ready(page3); await globeReady(page3);
  await expect(page3.locator('#country-panel')).toBeVisible();
  await expect(page3.locator('#country-round')).toBeHidden();
  await expect(page3.locator('#sec-globe')).not.toHaveAttribute('data-rings', /.+/);
  await ctx.close();
});

test('W7-AC22 (queue): proposals of kind round are rows with the country, the round, the stage, the date, the verbatim quote and the source chip; Confirm the date accepts and Not a round date rejects through the queue\'s calls; the chip opens the original', async ({ page }) => {
  const log = await stub(page);
  await page.goto('/hub/queue.html');
  await ready(page);
  await expect(page.locator('#review-list .q-row')).toHaveCount(3);
  const row = page.locator('[data-review-id="q1"]');
  await expect(row).toHaveAttribute('data-kind', 'round');
  await expect(row.locator('.t')).toContainText('Round date: 5th Concession Cycle, Permanent Offer');
  await expect(row.locator('.hub-dl-country')).toHaveText('Brazil');
  await expect(row.locator('.hub-dl-stage')).toHaveText('Bid deadline');
  await expect(row.locator('.hub-dl-date')).toHaveText(shortDate(2));
  await expect(row.locator('.hub-dl-days')).toHaveText('in 2 days');
  await expect(row.locator('blockquote.q-quote')).toHaveText(QUOTE_BR);
  const chip = row.locator('.hub-dl-src');
  await expect(chip).toHaveText('gov.br · read ' + shortDate(0));
  const ok = row.locator('[data-action="accept"]'), no = row.locator('[data-action="reject"]');
  await expect(ok).toHaveText('Confirm the date');
  await expect(no).toHaveText('Not a round date');
  // The row without a date or an original: the stage alone, the chip a link to the page.
  const row2 = page.locator('[data-review-id="q2"]');
  await expect(row2.locator('.hub-dl-stage')).toHaveText('Round announced');
  await expect(row2.locator('.hub-dl-date')).toHaveCount(0);
  await expect(row2.locator('.hub-dl-src')).toHaveAttribute('href', ANH_URL);
  await expect(row2.locator('.hub-dl-src')).toHaveAttribute('target', '_blank');
  // The chip opens the stored original in the record panel, here on the queue page too.
  await chip.click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + ANP);
  await expect(panel.locator('[data-passage]')).toContainText(QUOTE_BR);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('#rp-close').click();
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#sec-review').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-queue-round.png') });
  // Spanish on the controls.
  await page.locator('aside .nav-lang button[data-lang="es"]').click();
  await expect(ok).toHaveText('Confirmar la fecha');
  await expect(no).toHaveText('No es una fecha de ronda');
  await expect(row.locator('.hub-dl-stage')).toHaveText('Plazo de ofertas');
  await page.locator('aside .nav-lang button[data-lang="en"]').click();
  // Accept and reject go through the review queue's own calls.
  await ok.click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('Round date confirmed; it now counts on Today.');
  await row2.locator('[data-action="reject"]').click();
  await expect(row2).toHaveCount(0);
  await expect(page.locator('#live')).toContainText('Not a round date; nothing was recorded.');
  expect(log.posts.map((p) => p.slice(0, 2))).toEqual([['q1', 'accept'], ['q2', 'reject']]);
  await expect(page.locator('#n-review')).toHaveText('1');
  // A member sees the rows and the controls too.
  await stub(page, { me: MEMBER });
  await page.goto('/hub/queue.html?kind=round');
  await ready(page);
  await expect(page.locator('[data-review-id="q1"] [data-action="accept"]')).toHaveText('Confirm the date');
});

test('W7-AC22 (What came in): a confirmed deadline that moved since the person last looked is one line linking to the Deadlines card, from the same fetch; older confirmations and first-time dates are not called moves', async ({ page }) => {
  const log = await stub(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const lines = page.locator('#card-activity [data-activity-round]');
  await expect(lines).toHaveCount(1);
  const br = page.locator('#card-activity [data-activity-round="BR"]');
  await expect(br).toHaveText('Brazil: bid deadline moved to ' + shortDate(2));
  await expect(br.locator('a')).toHaveAttribute('href', '/hub/index.html#card-deadlines');
  await expect(page.locator('#card-activity')).not.toHaveAttribute('data-empty', '1');
  expect(log.rounds).toHaveLength(1);
  await page.locator('aside .nav-lang button[data-lang="es"]').click();
  await expect(br).toContainText('Brasil: plazo de ofertas pasó al');
  await page.locator('aside .nav-lang button[data-lang="en"]').click();
  // Looked after the confirmation: nothing to say. A newly confirmed date with no earlier one is a first date, not a move.
  await stub(page, { since: iso(60e3) });
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#card-activity [data-activity-round]')).toHaveCount(0);
  const first = VIEW(); first.countries[0].events = [E_BR_BID, E_BR_DATA];
  await stub(page, { rounds: first });
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(page.locator('#card-activity [data-activity-round="BR"]')).toHaveText('Brazil: bid deadline confirmed for ' + shortDate(2));
});

for (const vp of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`W7-AC22 (touch, ${vp.width}×${vp.height}): every control in the Deadlines card and the round rows is at least 36 px, the row taps 44, with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize(vp);
    await stub(page);
    await page.goto('/hub/index.html');
    await ready(page);
    const c = card(page);
    await expect(rows(page)).toHaveCount(3);
    for (const el of await c.locator('a[href], button').all()) {
      const b = await el.boundingBox();
      expect(b.height, await el.evaluate((e) => e.outerHTML.slice(0, 60))).toBeGreaterThanOrEqual(36);
    }
    for (const r of await rows(page).locator('.hub-dl-main').all()) expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('/hub/queue.html');
    await ready(page);
    const row = page.locator('[data-review-id="q1"]');
    for (const el of await row.locator('a[href], button').all()) expect((await el.boundingBox()).height).toBeGreaterThanOrEqual(36);
    expect((await row.locator('[data-action="accept"]').boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
