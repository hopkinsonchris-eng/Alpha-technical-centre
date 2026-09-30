// M16: the analogue table page (hub/analogues.html) and the Register's analogue badge.
// The API is stubbed with page.route; the static server (python3 -m http.server) serves the pages.
// Evidence: docs/vault-hub/evidence/m16-analogues.png
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence/m16-analogues.png');
const FIXTURE = JSON.parse(readFileSync(path.join(ROOT, 'test/e2e/fixtures/opportunity-register.json'), 'utf8'));
const OPP_ID = FIXTURE.params.opportunity.id;
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };

const n = (value, provenance = 'reported') => ({ value, provenance });
const row = (id, asset, provenance, body) => ({ id, source_ref: `${provenance === 'paper' ? 'doc' : 'run'}:${id}`, asset_id: asset, as_of: '2026-06-01', legal_tag: 'lt-firm', provenance, ...body });
const U = (i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
const base = { environment: 'onshore', lithology: 'clastic', fluid_type: 'black-oil', drive_mechanism: 'waterflood', country: 'CO' };

const ROWS = [
  row(U(1), 'field:llanos:cubiro', 'own-evaluation', { ...base, depth_m: n(2900, 'measured'), porosity_frac: n(0.17, 'measured'), permeability_md: n(320, 'measured'), recovery_factor_frac: n(0.20, 'calculated'), eur_per_well_mbbl: n(330, 'calculated') }),
  row(U(2), 'field:llanos:yopal-sector', 'own-evaluation', { ...base, depth_m: n(2750, 'measured'), porosity_frac: n(0.18, 'measured'), permeability_md: n(290, 'measured'), recovery_factor_frac: n(0.21, 'calculated'), eur_per_well_mbbl: n(340, 'calculated') }),
  row(U(3), 'field:llanos:chichimene', 'regulator', { ...base, fluid_type: 'heavy-oil', drive_mechanism: 'water-drive', depth_m: n(2600), porosity_frac: n(0.19), permeability_md: n(450), recovery_factor_frac: n(0.22), eur_per_well_mbbl: n(310) }),
  row(U(4), 'field:magdalena-media:la-cira-infantas', 'paper', { ...base, country: 'CO', depth_m: n(1500), porosity_frac: n(0.20), permeability_md: n(400), recovery_factor_frac: n(0.19), eur_per_well_mbbl: n(150) }),
  row(U(5), 'field:maracaibo:lagunillas', 'paper', { ...base, country: 'VE', fluid_type: 'heavy-oil', depth_m: n(1000), porosity_frac: n(0.30), permeability_md: n(1500), recovery_factor_frac: n(0.25), eur_per_well_mbbl: n(180) }),
  row(U(6), 'field:neuquen:loma-campana', 'regulator', { environment: 'onshore', lithology: 'shale', fluid_type: 'volatile-oil', drive_mechanism: 'solution-gas', country: 'AR', depth_m: n(2700), porosity_frac: n(0.08), permeability_md: n(0.0005), recovery_factor_frac: n(0.09), eur_per_well_mbbl: n(520) }),
  row(U(7), `run:${U(7)}`, 'own-evaluation', { ...base, country: undefined, depth_m: n(1800, 'measured'), permeability_md: n(25, 'analogue') }),
  row(U(8), '=cmd|calc', 'client-stated', { ...base, depth_m: n(2820, 'client-stated'), porosity_frac: n(0.17, 'client-stated'), permeability_md: n(310, 'client-stated') }),
];

const SIMILAR = {
  scope: 'firm', k: 10, population: ROWS.length, target: ROWS[0],
  hits: [
    { row: ROWS[1], source_ref: ROWS[1].source_ref, legal_tag: 'lt-firm', distance: 0.09, shared: 8, drivers: [{ property: 'depth_m', kind: 'numeric', a: 2900, b: 2750, dissimilarity: 0.1, share: 0.6 }], contributions: [] },
    { row: ROWS[2], source_ref: ROWS[2].source_ref, legal_tag: 'lt-public', distance: 0.14, shared: 8, drivers: [{ property: 'fluid_type', kind: 'categorical', a: 'black-oil', b: 'heavy-oil', dissimilarity: 1, share: 0.5 }, { property: 'drive_mechanism', kind: 'categorical', a: 'waterflood', b: 'water-drive', dissimilarity: 1, share: 0.4 }], contributions: [] },
    { row: ROWS[3], source_ref: ROWS[3].source_ref, legal_tag: 'lt-public', distance: 0.23, shared: 8, drivers: [{ property: 'depth_m', kind: 'numeric', a: 2900, b: 1500, dissimilarity: 0.5, share: 0.7 }], contributions: [] },
  ],
};

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Stubs /api/**; returns the list of analogue requests made. */
async function stub(page, over = {}) {
  const calls = [];
  await page.route(/unpkg\.com|openfreemap|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/analogues')) calls.push({ path: url.pathname, q: Object.fromEntries(url.searchParams) });
    if (over[url.pathname]) return over[url.pathname](url, route);
    if (url.pathname === '/api/me') return json(route, PARTNER);
    if (url.pathname === '/api/analogues') return json(route, { scope: url.searchParams.get('scope'), count: ROWS.length, counts: {}, rows: ROWS });
    if (url.pathname === '/api/analogues/similar') return json(route, SIMILAR);
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('the table lists every row with provenance, filters, sorts and marks the Vault reachable', async ({ page }) => {
  await stub(page);
  await page.goto('/hub/analogues.html');
  await ready(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('h1')).toHaveText('Analogue table');
  await expect(page.locator('#an-table tbody tr')).toHaveCount(ROWS.length);
  await expect(page.locator('#row-count')).toHaveText(`${ROWS.length} of ${ROWS.length} rows shown`);
  await expect(page.locator('#vault-state')).toHaveText('Vault reachable');
  await expect(page.locator('#me-name')).toHaveText(PARTNER.name);
  // provenance is on every row, and a dot marks each number's provenance
  await expect(page.locator('#an-table tbody tr [data-provenance]')).toHaveCount(ROWS.length);
  await expect(page.locator('tr[data-asset="field:llanos:cubiro"] .pv-measured').first()).toHaveAttribute('aria-label', 'measured');
  await expect(page.locator('tr[data-asset="field:llanos:cubiro"] td').nth(6)).toContainText('20%');
  // provenance chips
  await page.locator('.an-chip[data-prov="paper"]').click();
  await expect(page.locator('#an-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.an-chip[data-prov="paper"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.an-chip[data-prov=""]').click();
  // country, lithology, drive
  await page.locator('#f-country').selectOption('VE');
  await expect(page.locator('#an-table tbody tr')).toHaveCount(1);
  await page.locator('#f-country').selectOption('');
  await page.locator('#f-lith').selectOption('shale');
  await expect(page.locator('#an-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#an-table tbody tr').first()).toHaveAttribute('data-asset', 'field:neuquen:loma-campana');
  await page.locator('#f-lith').selectOption('');
  await page.locator('#f-drive').selectOption('solution-gas');
  await expect(page.locator('#an-table tbody tr')).toHaveCount(1);
  await page.locator('#f-drive').selectOption('');
  // sort by permeability: descending first, then ascending; rows without a value sort last
  await page.locator('.an-sort[data-sort="k"]').click();
  const ks = async () => page.locator('#an-table tbody tr td:nth-child(6)').evaluateAll((tds) => tds.map((t) => Number(t.getAttribute('data-value'))));
  const desc = await ks();
  expect(desc[0]).toBe(1500);
  await page.locator('.an-sort[data-sort="k"]').click();
  const asc = await ks();
  expect(asc[0]).toBe(0.0005);
  expect(asc.at(-1)).toBe(1500);
  await page.locator('.an-sort[data-sort="k"]').click();
  await page.locator('.an-sort[data-sort="asset"]').click();
  await expect(page.locator('#an-table tbody tr').first()).toHaveAttribute('data-asset', '=cmd|calc');
});

test('similar to this lists the k nearest with distance and the properties that drove it', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/hub/analogues.html');
  await ready(page);
  await page.locator('tr[data-asset="field:llanos:cubiro"] [data-similar]').click();
  await expect(page.locator('#sec-similar')).toBeVisible();
  const req = calls.find((c) => c.path === '/api/analogues/similar');
  expect(req.q).toMatchObject({ scope: 'firm', asset: 'field:llanos:cubiro', k: '10' });
  await expect(page.locator('#sim-target')).toHaveText('field:llanos:cubiro');
  await expect(page.locator('#sim-title')).toHaveText('· 3 nearest analogues');
  const tiles = page.locator('#sim-tiles .an-tile');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.first()).toContainText('Yopal sector');
  await expect(tiles.first().locator('[data-distance]')).toHaveText('0.09');
  await expect(tiles.nth(1)).toContainText('Differs mainly in Fluid (black-oil vs heavy-oil), Drive (waterflood vs water-drive)');
  const dists = await tiles.locator('[data-distance]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-distance'))));
  expect(dists).toEqual([...dists].sort((a, b) => a - b));
  // the table gains a distance column value and is ordered by it
  await expect(page.locator('tr[data-asset="field:llanos:yopal-sector"] td:nth-child(9)')).toHaveText('0.09');
  await expect(page.locator('#an-table tbody tr').first()).toHaveAttribute('data-asset', 'field:llanos:yopal-sector');
  // a row with no field id is sent as a row, not as an asset
  await page.locator('#sim-close').click();
  await expect(page.locator('#sec-similar')).toBeHidden();
  await page.locator(`tr[data-row-id="${U(7)}"] [data-similar]`).click();
  await expect.poll(() => calls.filter((c) => c.path === '/api/analogues/similar').length).toBe(2);
  const second = calls.filter((c) => c.path === '/api/analogues/similar')[1];
  expect(second.q.asset).toBeUndefined();
  expect(JSON.parse(second.q.row).id).toBe(U(7));
  // k selector re-runs the query
  await page.locator('#sim-k').selectOption('5');
  await expect.poll(() => calls.filter((c) => c.path === '/api/analogues/similar').length).toBe(3);
  expect(calls.filter((c) => c.path === '/api/analogues/similar')[2].q.k).toBe('5');
});

test('the scope selector is sent with every request and remembered for the Find page', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/hub/analogues.html');
  await ready(page);
  expect(calls[0].q.scope).toBe('firm');
  await page.locator('#scope-kind').selectOption('client');
  await page.locator('#scope-id').fill('frontera');
  await page.locator('#scope-form button[type="submit"]').click();
  await expect.poll(() => calls.filter((c) => c.path === '/api/analogues').length).toBe(2);
  expect(calls.filter((c) => c.path === '/api/analogues')[1].q.scope).toBe('client:frontera');
  expect(await page.evaluate(() => localStorage.getItem('atc-hub-find-scope'))).toBe('client:frontera');
  await page.reload();
  await ready(page);
  await expect(page.locator('#scope-kind')).toHaveValue('client');
  await expect(page.locator('#scope-id')).toHaveValue('frontera');
  expect(calls.filter((c) => c.path === '/api/analogues').at(-1).q.scope).toBe('client:frontera');
  // a client scope with no id is not sent
  await page.locator('#scope-id').fill('');
  const before = calls.length;
  await page.locator('#scope-form button[type="submit"]').click();
  await expect(page.locator('#notices')).toContainText('Check the scope');
  expect(calls.length).toBe(before);
});

test('CSV export downloads the filtered rows with provenance columns and a formula guard', async ({ page }) => {
  await stub(page);
  await page.goto('/hub/analogues.html');
  await ready(page);
  await page.locator('.an-chip[data-prov="own-evaluation"]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-csv').click()]);
  expect(download.suggestedFilename()).toMatch(/^analogues-firm-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync(await download.path(), 'utf8');
  const lines = text.trim().split('\r\n');
  expect(lines.length).toBe(1 + 3);                          // header + three own evaluations
  const head = lines[0].split(',');
  expect(head.slice(0, 8)).toEqual(['id', 'source_ref', 'asset_id', 'basin_id', 'country', 'as_of', 'legal_tag', 'provenance']);
  expect(head).toContain('permeability_md'); expect(head).toContain('permeability_md_provenance');
  expect(lines.slice(1).every((l) => l.includes(',own-evaluation,'))).toBe(true);
  expect(text).toContain(',320,,,measured');
  // all rows, including the one whose asset id starts with "=": the cell is quoted as text, never a formula
  await page.locator('.an-chip[data-prov=""]').click();
  const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('#export-csv').click()]);
  const all = readFileSync(await d2.path(), 'utf8');
  expect(all.trim().split('\r\n').length).toBe(1 + ROWS.length);
  expect(all).toContain("'=cmd|calc");
});

test('failures are said plainly: 403 outside scope, 400 bad scope, Vault unreachable', async ({ page }) => {
  await stub(page, { '/api/analogues': (u, r) => json(r, { error: { code: 'forbidden', message: 'not a member of project p-b-1' } }, 403) });
  await page.goto('/hub/analogues.html');
  await ready(page);
  await expect(page.locator('#notices')).toContainText('Outside your scope');
  await expect(page.locator('#notices')).toContainText('not a member of project p-b-1');
  await expect(page.locator('#an-table')).toHaveCount(0);

  const p2 = await page.context().newPage();
  await p2.route('**/api/**', (r) => r.abort());
  await p2.goto('/hub/analogues.html');
  await p2.locator('body[data-ready="1"]').waitFor();
  await expect(p2.locator('#notices')).toContainText('The Vault is unreachable');
  await expect(p2.locator('#vault-state')).toHaveText('Vault unreachable');
});

test('every text node carries data-en and data-es, and the language toggle switches the page', async ({ page }) => {
  await stub(page);
  await page.goto('/hub/analogues.html');
  await ready(page);
  await page.locator('tr[data-asset="field:llanos:cubiro"] [data-similar]').click();
  await expect(page.locator('#sim-tiles .an-tile')).toHaveCount(3);
  const missing = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.querySelector('.hub-app'), NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const s = t.nodeValue.trim();
      if (!s || /^[\s·—0-9.,%:()\-/]+$/.test(s)) continue;
      const el = t.parentElement;
      if (['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      // data values (ids, numbers, names from the Vault) are the same in both languages; labels must be bilingual
      if (el.closest('[data-en]') || el.closest('.an-id, .mono, .hub-chip-tag, b, h4, .an-rank, td, .an-desc, .an-why, #me-role, #status-strip, .hub-nav-group, .nav-wordmark, .hub-av, .nav-lang')) continue;
      out.push(s);
    }
    return out;
  });
  expect(missing).toEqual([]);
  const untranslated = await page.evaluate(() => [...document.querySelectorAll('[data-en]')].filter((e) => !e.hasAttribute('data-es')).map((e) => e.getAttribute('data-en')));
  expect(untranslated).toEqual([]);
  await page.locator('.nav-lang [data-lang="es"]').click();
  await expect(page.locator('h1')).toHaveText('Tabla de análogos');
  await expect(page.locator('#export-csv')).toHaveText('Exportar CSV');
  await expect(page.locator('.an-chip').first()).toHaveText('Toda procedencia');
  await expect(page.locator('#sim-tiles .an-tile').nth(1)).toContainText('Difiere sobre todo en Fluido');
  await expect(page.locator('#row-count')).toContainText('filas');
});

test('evidence: the analogue page, with the similar panel open', async ({ page }) => {
  await stub(page);
  await page.goto('/hub/analogues.html');
  await ready(page);
  await page.locator('tr[data-asset="field:llanos:cubiro"] [data-similar]').click();
  await expect(page.locator('#sim-tiles .an-tile')).toHaveCount(3);
  await page.evaluate(() => window.scrollTo(0, 0));
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  await page.screenshot({ path: EVIDENCE, fullPage: true });
});

/* ── AC4: the Register with the loader enabled shows the analogue count badge ── */

const OVERLAY_BODY = (play) => ({
  play_type: play, scope: 'firm', n_rows: 12, min_n: 3, insufficient: [], excluded: {}, provenance: { 'own-evaluation': 7, paper: 5 },
  inputs: {
    'rock.k': { property: 'permeability_md', path: 'rock.k', unit: 'md', low: 8.2, mid: 35, high: 147, n: 12, provenance: { measured: 7, reported: 5 } },
    'rock.hFt': { property: 'net_pay_m', path: 'rock.hFt', unit: 'ft', low: 60.4, mid: 103.3, high: 168.3, n: 12, provenance: { measured: 7, reported: 5 } },
    'rock.phi': { property: 'porosity_frac', path: 'rock.phi', unit: 'fraction', low: 0.091, mid: 0.135, high: 0.188, n: 12, provenance: { measured: 7, reported: 5 } },
    'wells.spacingAcres': { property: 'well_spacing_acres', path: 'wells.spacingAcres', unit: 'acres', low: 46, mid: 70, high: 94, n: 4, provenance: { reported: 4 } },
  },
});

async function openRegister(page, query) {
  await page.route(/unpkg\.com|openfreemap|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const asked = [];
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/analogues/defaults') { asked.push(Object.fromEntries(url.searchParams)); return json(route, OVERLAY_BODY(url.searchParams.get('play_type'))); }
    return json(route, { error: { message: 'not stubbed' } }, 404);
  });
  await page.addInitScript(() => { try { sessionStorage.setItem('atc_auth', '1'); } catch (e) { /* ignore */ } });
  await page.goto('/opportunity-register.html' + query);
  await page.waitForFunction(() => window.ATCP && document.querySelector('#modeChip') && document.querySelector('#modeChip').textContent !== 'Loading register');
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);
  await page.locator('.apex-tab[data-tab="register"]').click();
  await page.locator(`tr[data-open="${OPP_ID}"]`).click();
  await expect(page.locator('#dTitle')).toHaveText(FIXTURE.params.opportunity.name);
  return asked;
}

test('AC4: with the loader enabled the Register badge reads analogue (n=12); without it, unchanged', async ({ page }) => {
  const asked = await openRegister(page, '?analogues=firm');
  const badge = page.locator('#detail .stat', { hasText: 'Inputs' }).locator('.prov').first();
  await expect(badge).toHaveText('analogue (n=12)');
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((q) => q.scope === 'firm')).toBe(true);
  expect(asked.map((q) => q.play_type)).toContain('onshore-clastic-waterflood');
  // the loader changed no default: PLAYS is exactly as it was
  const k = await page.evaluate(() => ATCP.PLAYS['carbonate-waterflood'].rock.k);
  expect(k).toEqual([10, 40, 150]);
  const overlay = await page.evaluate(() => ATCP.activeOverlay('carbonate-waterflood'));
  expect(overlay.rock.k).toEqual([8.2, 35, 147]);
  expect(overlay.wells.spacingAcres).toBe(70);
  expect(overlay.meta).toMatchObject({ n: 12, provenance: { 'own-evaluation': 7, paper: 5 } });
});

test('AC4: the badge is unchanged when the loader is not enabled', async ({ page }) => {
  const asked = await openRegister(page, '');
  await expect(page.locator('#detail .stat', { hasText: 'Inputs' }).locator('.prov').first()).toHaveText('mixed');
  expect(asked).toEqual([]);
});

test('AC4: the loader falls back silently when the Vault has nothing or is down', async ({ page }) => {
  await page.route(/unpkg\.com|openfreemap|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":{"code":"forbidden","message":"no"}}' }));
  await page.addInitScript(() => { try { sessionStorage.setItem('atc_auth', '1'); } catch (e) { /* ignore */ } });
  await page.goto('/opportunity-register.html?analogues=firm');
  await page.waitForFunction(() => window.ATCP && document.querySelector('#modeChip') && document.querySelector('#modeChip').textContent !== 'Loading register');
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);
  await page.locator('.apex-tab[data-tab="register"]').click();
  await page.locator(`tr[data-open="${OPP_ID}"]`).click();
  await expect(page.locator('#detail .stat', { hasText: 'Inputs' }).locator('.prov').first()).toHaveText('mixed');
  const r = await page.evaluate(async () => [await ATCP.loadVaultDefaults('carbonate-waterflood', 'firm'), await ATCP.loadVaultDefaults('', 'firm'), await ATCP.loadVaultDefaults('x', '')]);
  expect(r).toEqual([null, null, null]);
});
