// Wave 8 (docs/vault-hub/wave8/01-risk-lens.md): the risk lens on Today. The API is stubbed with page.route; the
// static server serves the pages and the geo file. W8-AC1 to W8-AC8, written before the code.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };

const proj = (id, name, extra = {}) => ({
  id, name, status: 'prospect', stage: 'Qualified', client_id: null, client_name: null, lat: null, lon: null, last_run_at: null,
  attention: { stale: 0, filing: 0, expiring_days: null }, assets: [], near: null, ...extra,
});
const NEAR = (events, fatalities, nearest) => ({ events, fatalities, nearest_km: nearest, radius_km: 200, window_days: 30, as_of: '2026-10-06T09:00:00.000Z' });
const COUNTRIES = {
  countries: [
    { code: 'EG', name: { en: 'Egypt', es: 'Egipto' }, risk: { score: 66.2, level: null, trend: 'falling', band: 'amber', computed_at: '2026-10-01T08:00:00.000Z', fetched_at: '2026-10-06T09:00:00.000Z', sanctions_active: false, sanctions_count: 0, delta_7d: -1.5, delta_30d: -4, since: '2026-09-05' },
      ports: [{ id: 'EGSUZ', name: 'Suez', lat: 29.97, lon: 32.55, tanker_calls_30d: 60, trend_pct: 2.5, import_dwt: 1, export_dwt: 2, anomaly: false }], chokepoint: { primary: { id: 'suez', name: 'Suez Canal', score: 0.9 }, vulnerability_index: 0.7, fetched_at: '2026-10-01T08:20:00.000Z' },
      projects: [proj('egy-onshore', 'Egypt Onshore Gas Hub', { lat: 30.5, lon: 30.2, stage: 'Negotiation' })], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 } },
    { code: 'KZ', name: { en: 'Kazakhstan', es: 'Kazajistán' }, risk: { score: 31, level: 'caution', trend: 'stable', band: 'green', computed_at: '2026-10-01T08:00:00.000Z', fetched_at: '2026-10-06T09:00:00.000Z', sanctions_active: false, sanctions_count: 0, delta_7d: null, delta_30d: null, since: null },
      ports: [], chokepoint: null, projects: [proj('kaz-brownfield', 'Western Kazakhstan Brownfield', { lat: 47.1, lon: 51.9, near: NEAR(0, 0, null) })], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 } },
    { code: 'VE', name: { en: 'Venezuela', es: 'Venezuela' }, risk: { score: 71.4, level: 'reconsider travel', trend: 'rising', band: 'red', computed_at: '2026-10-01T08:00:00.000Z', fetched_at: '2026-10-06T09:00:00.000Z', sanctions_active: true, sanctions_count: 212, delta_7d: 5, delta_30d: -10, since: '2026-09-05' },
      ports: [{ id: 'VEJOT', name: 'José Terminal', lat: 10.07, lon: -64.73, tanker_calls_30d: 41, trend_pct: 8.1, import_dwt: 0, export_dwt: 2500000, anomaly: true }, { id: 'VEPLC', name: 'Puerto La Cruz', lat: 10.2, lon: -64.6, tanker_calls_30d: 18, trend_pct: -12.5, import_dwt: 100000, export_dwt: 950000, anomaly: false }],
      chokepoint: { primary: { id: 'panama', name: 'Panama Canal', score: 0.62 }, vulnerability_index: 0.41, fetched_at: '2026-10-01T08:20:00.000Z' },
      projects: [proj('ven-barinas', 'Barinas–Apure Cluster', { lat: 8.1, lon: -69.3, stage: 'Technical review', status: 'active', near: NEAR(1, 0, 184) })], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 } },
  ],
  unplaced: [],
  world_risk: [
    { code: 'VE', score: 71.4, band: 'red', trend: 'rising', held: true }, { code: 'KZ', score: 31, band: 'green', trend: 'stable', held: true }, { code: 'EG', score: 66.2, band: 'amber', trend: 'falling', held: true },
    { code: 'BR', score: 22.3, band: 'green', trend: 'stable', held: false }, { code: 'IR', score: 81, band: 'red', trend: 'rising', held: false }, { code: 'RU', score: 74, band: 'red', trend: 'stable', held: false },
    { code: 'CN', score: 45, band: 'amber', trend: 'stable', held: false }, { code: 'US', score: 28, band: 'green', trend: 'stable', held: false }, { code: 'AU', score: 12, band: 'green', trend: 'stable', held: false },
  ],
  near: { radius_km: 200, window_days: 30 },
  generated_at: '2026-10-06T09:00:00.000Z',
  world_monitor: { status: 'live', notes: [] },
};
const PROJECTS = { projects: [
  { id: 'egy-onshore', name: 'Egypt Onshore Gas Hub', status: 'prospect', client_id: null, default_legal_tag: 'lt-firm', country: 'EG', lat: 30.5, lon: 30.2, stage: 'Negotiation', stage_history: [], register: { risk: 'amber', risk_score: 59 }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', status: 'prospect', client_id: null, default_legal_tag: 'lt-firm', country: 'KZ', lat: 47.1, lon: 51.9, stage: 'Qualified', stage_history: [], register: { risk: 'amber', risk_score: 54 }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'ven-barinas', name: 'Barinas–Apure Cluster', status: 'active', client_id: null, default_legal_tag: 'lt-firm', country: 'VE', lat: 8.1, lon: -69.3, stage: 'Technical review', stage_history: [], register: { risk: 'red', risk_score: 78, risks: { Technical: 38, Commercial: 66 } }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z' },
] };
const cell = (score, status, source, as_of, evidence) => ({ score, status, source, as_of, evidence });
const TABLE = {
  columns: ['geopolitical', 'sanctions', 'security', 'technical', 'commercial'],
  rows: [
    { project_id: 'ven-barinas', name: 'Barinas–Apure Cluster', country: 'VE', country_name: { en: 'Venezuela', es: 'Venezuela' }, stage: 'Technical review', status: 'active', band: 'red', overall: 75, execution: { risk: 'red', risk_score: 78 }, delta_7d: 5, delta_30d: -10, since: '2026-09-05',
      cells: { geopolitical: cell(71.4, 'live', 'World Monitor instability index', '2026-10-01T08:00:00.000Z', 'World Monitor scores Venezuela 71.4 of 100, rising, advisory reconsider travel. The column is the score itself.'),
        sanctions: cell(87, 'live', 'World Monitor sanctions (OFAC)', '2026-10-06T09:00:00.000Z', '212 designated entities under active OFAC programmes name Venezuela: 40, plus 20 per decade of entities, capped at 100.'),
        security: cell(18, 'live', 'ACLED via World Monitor', '2026-10-06T09:00:00.000Z', '1 event and 0 fatalities within 200 km of the project point in the last 30 days, the nearest 184 km away: 10, plus 8 per event and 3 per fatality, capped at 100.'),
        technical: cell(38, 'entered', 'project register', null, 'Technical 38 as entered on the project\'s register.'), commercial: cell(66, 'entered', 'project register', null, 'Commercial 66 as entered on the project\'s register.') } },
    { project_id: 'egy-onshore', name: 'Egypt Onshore Gas Hub', country: 'EG', country_name: { en: 'Egypt', es: 'Egipto' }, stage: 'Negotiation', status: 'prospect', band: 'amber', overall: 31, execution: { risk: 'amber', risk_score: 59 }, delta_7d: -1.5, delta_30d: -4, since: '2026-09-05',
      cells: { geopolitical: cell(66.2, 'live', 'World Monitor instability index', '2026-10-01T08:00:00.000Z', 'World Monitor scores Egypt 66.2 of 100, falling.'), sanctions: cell(5, 'live', 'World Monitor sanctions (OFAC)', '2026-10-06T09:00:00.000Z', 'No active OFAC designations name Egypt: 5.'),
        security: cell(21, 'live', 'ACLED via World Monitor', '2026-10-06T09:00:00.000Z', '1 event and 1 fatality country-wide (the project has no point yet) in the last 30 days: 10, plus 8 per event and 3 per fatality, capped at 100.'),
        technical: cell(null, 'missing', 'project register', null, 'Technical is not entered on this project\'s register; no feed can supply it.'), commercial: cell(null, 'missing', 'project register', null, 'Commercial is not entered on this project\'s register; no feed can supply it.') } },
    { project_id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', country: 'KZ', country_name: { en: 'Kazakhstan', es: 'Kazajistán' }, stage: 'Qualified', status: 'prospect', band: 'green', overall: 15, execution: { risk: 'amber', risk_score: 54 }, delta_7d: null, delta_30d: null, since: null,
      cells: { geopolitical: cell(31, 'live', 'World Monitor instability index', '2026-10-01T08:00:00.000Z', 'World Monitor scores Kazakhstan 31 of 100, stable, advisory caution.'), sanctions: cell(5, 'live', 'World Monitor sanctions (OFAC)', '2026-10-06T09:00:00.000Z', 'No active OFAC designations name Kazakhstan: 5.'),
        security: cell(10, 'live', 'ACLED via World Monitor', '2026-10-06T09:00:00.000Z', '0 events and 0 fatalities within 200 km of the project point in the last 30 days: 10, plus 8 per event and 3 per fatality, capped at 100.'),
        technical: cell(null, 'missing', 'project register', null, 'Technical is not entered.'), commercial: cell(null, 'missing', 'project register', null, 'Commercial is not entered.') } },
  ],
  radius_km: 200, window_days: 30, generated_at: '2026-10-06T09:00:00.000Z', world_monitor: { status: 'live', notes: [] },
};
const SHOCK = { country: 'VE', chokepoint: { id: 'panama', name: 'Panama Canal', score: 0.62 }, disruption_pct: 50, shock: { chokepoint_id: 'panama', disruption_pct: 50, crude_loss_kbd: 12.5, cover_days: 21, assessment: 'manageable', products: [], data_available: true, coverage: 'partial', limitations: [] }, world_monitor: { status: 'live', notes: [] } };
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, over = {}) {
  const leaks = [];
  await page.route('**/*worldmonitor.app/**', (route) => { leaks.push(route.request().url()); return route.abort(); });
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname;
    if (over[p]) return over[p](u, route);
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (p === '/api/projects') return json(route, PROJECTS);
    if (p === '/api/organisations') return json(route, { organisations: [] });
    if (p === '/api/risk/table') return json(route, TABLE);
    if (p === '/api/risk/shock') return json(route, u.searchParams.get('country') === 'VE' ? SHOCK : { country: u.searchParams.get('country'), chokepoint: null, disruption_pct: 50, shock: null, world_monitor: { status: 'live', notes: [] } });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return leaks;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const globeReady = (page) => page.locator('#sec-globe[data-globe="ready"]').waitFor();
/** The canvas as pixels, so a drawn change (a halo, a tint) can be asserted without reading the canvas API. */
const pixels = async (page) => page.locator('#globe').screenshot();
const differ = (a, b) => { if (a.length !== b.length) return true; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n > a.length * 0.002; };
/** The page's globe instance, exposed on the section for these tests. */
const globeState = (page, fn) => page.evaluate((src) => { const g = document.querySelector('#sec-globe').__globe; return (new Function('g', 'return (' + src + ')(g)'))(g); }, fn.toString());

test.use({ reducedMotion: 'reduce' });

test('W8-AC1: a held country wears a halo in its band colour and a trend chevron; the legend names the scale; the layer starts on Opportunities', async ({ page }) => {
  const leaks = await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  const sec = page.locator('#sec-globe');
  await expect(sec).toHaveAttribute('data-layer', 'opportunity');
  await expect(sec).toHaveAttribute('data-world-risk', '9');
  const legend = page.locator('#globe-legend');
  await expect(legend).toBeVisible();
  await expect(legend.locator('dt')).toHaveText('World Monitor instability');
  await expect(legend.locator('dd')).toHaveCount(8);
  await expect(legend).toContainText('sanctions');
  await expect(legend).toContainText('export port');
  expect(await globeState(page, (g) => g.riskOf('VE'))).toEqual({ band: 'red', score: 71.4, trend: 'rising', sanctions: true, held: true });
  expect(await globeState(page, (g) => g.riskOf('IR'))).toEqual({ band: 'red', score: 81, trend: 'rising', sanctions: false, held: false });
  expect(await globeState(page, (g) => g.layer)).toBe('opportunity');
  // The halo is drawn: with the risk map cleared the canvas changes around Venezuela.
  await page.locator('#register [data-country="VE"]').click();
  await page.locator('#country-back').click();
  await page.waitForTimeout(300);
  const withHalo = await pixels(page);
  await globeState(page, (g) => g.setRisk(new Map()));
  await page.waitForTimeout(100);
  const without = await pixels(page);
  expect(differ(withHalo, without)).toBe(true);
  expect(leaks).toEqual([]);
});

test('W8-AC2: Risk heat tints every tracked country; the choice is remembered; Opportunities restores the plain land', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page); await globeReady(page);
  const sec = page.locator('#sec-globe');
  const plain = await pixels(page);
  await page.locator('#globe-layer button[data-layer="risk"]').click();
  await expect(sec).toHaveAttribute('data-layer', 'risk');
  await expect(page.locator('#globe-layer button[data-layer="risk"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#globe-layer button[data-layer="opportunity"]')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(150);
  const tinted = await pixels(page);
  expect(differ(plain, tinted)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('hub.globe.layer'))).toBe('risk');
  await page.reload();
  await ready(page); await globeReady(page);
  await expect(sec).toHaveAttribute('data-layer', 'risk');
  await page.locator('#globe-layer button[data-layer="opportunity"]').click();
  await expect(sec).toHaveAttribute('data-layer', 'opportunity');
  await page.waitForTimeout(150);
  const back = await pixels(page);
  expect(differ(back, tinted)).toBe(true);
});

test('W8-AC3: the country panel says the trend and the change, the export ports with their tanker calls, the chokepoint and the shock figure; the register head carries the trend', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html?country=VE');
  await ready(page); await globeReady(page);
  const risk = page.locator('#country-risk');
  await expect(risk).toContainText('World Monitor 71');
  await expect(risk.locator('.hub-rag')).toHaveAttribute('data-risk', 'red');
  await expect(risk.locator('.hub-risk-trend')).toHaveAttribute('data-trend', 'rising');
  await expect(risk.locator('.hub-risk-trend')).toContainText('▲');
  await expect(risk.locator('.hub-risk-trend')).toContainText('+5 in 7 d · −10 in 30 d');
  await expect(risk).toContainText('advisory: reconsider travel');
  const trade = page.locator('#country-trade');
  await expect(trade).toBeVisible();
  await expect(trade).toContainText('Export: José Terminal 41 tanker calls (+8 %) anomaly · Puerto La Cruz 18 tanker calls (−12 %)');
  await expect(trade.locator('[data-port="VEJOT"] .anomaly')).toHaveCount(1);
  await expect(trade).toContainText('via Panama Canal (exposure 0.62)');
  await expect(trade).toHaveAttribute('data-trade-state', 'shock');
  await expect(trade.locator('[data-shock="12.5"]')).toContainText('half of Panama Canal lost: 12.5 kb/d of crude, 21 days of cover · manageable');
  // Events near the asset ride on the project row in the panel.
  await expect(page.locator('#country-panel [data-country-project="ven-barinas"] .hub-flag.near')).toHaveText('1 event · 200 km');
  // Kazakhstan: no ports, no chokepoint, nothing near: the line stays hidden and no near flag shows.
  await page.locator('#country-back').click();
  await expect(page.locator('#register [data-country="VE"] .hub-risk-n')).toHaveText('World Monitor 71');
  await expect(page.locator('#register [data-country="VE"] .hub-risk-trend')).toContainText('▲ +5 in 7 d · −10 in 30 d');
  await expect(page.locator('#register [data-register-row="ven-barinas"] .hub-flag.near')).toHaveText('1 event · 200 km');
  await expect(page.locator('#register [data-register-row="kaz-brownfield"] .hub-flag.near')).toHaveCount(0);
  await page.locator('#register [data-country="KZ"]').click();
  await expect(trade).toBeHidden();
  await expect(page.locator('#country-risk .hub-risk-trend')).toHaveCount(0);
  // Spanish: the same facts in Spanish words.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await page.locator('#country-back').click();
  await page.locator('#register [data-country="VE"]').click();
  await expect(trade).toContainText('Exportación: José Terminal 41 escalas de petroleros');
  await expect(trade).toContainText('la mitad de Panama Canal perdida: 12.5 kb/d de crudo, 21 días de cobertura');
});

test('W8-AC4: the risk table shows the five columns on the one scale, the overall, the 30-day change and the execution risk apart; a cell opens its evidence', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const sec = page.locator('#sec-risk');
  await expect(sec).toBeVisible();
  await expect(sec).toHaveAttribute('data-risk', 'ready');
  await expect(page.locator('#risk-count')).toHaveText('3');
  const heads = page.locator('#risk-table thead th');
  await expect(heads).toHaveText(['Opportunity', 'Geopolitical', 'Sanctions', 'Security', 'Technical', 'Commercial', 'Overall', '30 d', 'Our execution risk']);
  await expect(page.locator('#risk-table thead th.live')).toHaveCount(3);
  const rows = page.locator('#risk-table tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-risk-row', 'ven-barinas');
  await expect(rows.nth(0)).toHaveAttribute('data-band', 'red');
  const ve = rows.nth(0);
  await expect(ve.locator('[data-cell="geopolitical"]')).toHaveText('71.4');
  await expect(ve.locator('[data-cell="sanctions"]')).toHaveText('87');
  await expect(ve.locator('[data-cell="security"]')).toHaveText('18');
  await expect(ve.locator('[data-cell="technical"]')).toHaveText('38');
  await expect(ve.locator('[data-cell="overall"]')).toHaveText('75');
  await expect(ve.locator('td.delta')).toHaveText('−10');
  await expect(ve.locator('td.delta .down')).toHaveCount(1);
  await expect(ve.locator('[data-risk-tag]')).toHaveText('our execution risk Red 78');
  await expect(ve.locator('td.nm')).toContainText('Venezuela · Technical review');
  await expect(ve.locator('td.nm a')).toHaveAttribute('href', /project\.html\?id=ven-barinas/);
  // The scale: 87 is redder than 18, which is greener than 38.
  const bg = async (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
  const rgb = (s) => s.match(/\d+/g).map(Number);
  const [r87, r18, r38] = await Promise.all([bg('[data-risk-row="ven-barinas"] [data-cell="sanctions"]'), bg('[data-risk-row="ven-barinas"] [data-cell="security"]'), bg('[data-risk-row="ven-barinas"] [data-cell="technical"]')]);
  expect(rgb(r87)[0]).toBeGreaterThan(rgb(r18)[0]); expect(rgb(r18)[1]).toBeGreaterThan(rgb(r38)[1]);
  // Missing and unavailable cells say so in words and carry no colour.
  const eg = rows.nth(1);
  await expect(eg.locator('[data-cell="technical"]')).toHaveText('not entered');
  await expect(eg.locator('[data-cell="technical"]')).toHaveAttribute('data-status', 'missing');
  await expect(page.locator('[data-risk-row="kaz-brownfield"] td.delta')).toHaveText('—');
  // A cell opens its evidence: the source, the as-of time and the formula in words.
  const ev = page.locator('#risk-evidence');
  await expect(ev).toBeHidden();
  await ve.locator('[data-cell="sanctions"]').click();
  await expect(ev).toBeVisible();
  await expect(ev).toHaveAttribute('data-evidence-for', 'ven-barinas:sanctions');
  await expect(ev).toContainText('Barinas–Apure Cluster · Sanctions 87 · World Monitor sanctions (OFAC) · as of 6 Oct 2026');
  await expect(ev).toContainText('212 designated entities under active OFAC programmes name Venezuela: 40, plus 20 per decade of entities, capped at 100.');
  await expect(ve.locator('[data-cell="sanctions"]')).toHaveAttribute('aria-expanded', 'true');
  await ve.locator('[data-cell="overall"]').click();
  await expect(ev).toContainText('Overall 75 · the register rule');
  await expect(ev).toContainText('mean of the three highest columns');
  await ve.locator('[data-cell="overall"]').click();
  await expect(ev).toBeHidden();
  await expect(page.locator('#risk-foot')).toContainText('World Monitor live · events within 200 km over 30 days');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('#globe-layer button[data-layer="risk"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(EVIDENCE, 'wave8-risk-lens.png'), fullPage: false });
  await ve.locator('[data-cell="sanctions"]').click();
  await page.locator('#sec-risk').screenshot({ path: path.join(EVIDENCE, 'wave8-risk-table.png') });
});

test('W8-AC5: without World Monitor the live columns say unavailable and the entered ones stand; without the route the section stays hidden; no browser request reaches worldmonitor.app', async ({ page }) => {
  const OFF = JSON.parse(JSON.stringify(TABLE));
  OFF.world_monitor = { status: 'not_connected', reason: 'not connected', notes: [] };
  for (const row of OFF.rows) for (const k of ['geopolitical', 'sanctions', 'security']) row.cells[k] = cell(null, 'unavailable', row.cells[k].source, null, 'not connected');
  const leaks = await stubApi(page, { '/api/risk/table': (u, r) => json(r, OFF) });
  await page.goto('/hub/index.html');
  await ready(page);
  const ve = page.locator('[data-risk-row="ven-barinas"]');
  await expect(ve.locator('[data-cell="geopolitical"]')).toHaveText('n/a');
  await expect(ve.locator('[data-cell="geopolitical"]')).toHaveAttribute('data-status', 'unavailable');
  await expect(ve.locator('[data-cell="technical"]')).toHaveText('38');
  await expect(page.locator('#risk-foot')).toHaveAttribute('data-wm', 'not_connected');
  await expect(page.locator('#risk-foot')).toContainText('not connected');
  expect(leaks).toEqual([]);
  await page.route('**/api/risk/table', (r) => json(r, { error: { code: 'not_found', message: 'no route' } }, 404));
  await page.reload();
  await ready(page);
  await expect(page.locator('#sec-risk')).toBeHidden();
  await expect(page.locator('#sec-risk')).toHaveAttribute('data-risk', 'no-route');
});
