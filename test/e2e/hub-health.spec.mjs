// Wave 7 PR1 (docs/vault-hub/wave7/05-markup.md §3 W7-AC4, P69): the ten daily-use checks that must
// hold on every push. The Vault is seeded through page.route the way the other hub specs do it, so CI
// runs this without a live Vault: two client projects and the internal `firm` project, two contacts,
// runs on an older tool version, a field dossier and a paper, a research run stopped at its budget,
// no drafting provider. Screenshots land under docs/vault-hub/wave7/evidence/ at 1440×900.
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const CATALOG = JSON.parse(readFileSync(path.join(ROOT, 'hub/catalog.json'), 'utf8'));
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'llanos-screen';
const DOSSIER = u(901), PAPER = u(902), RUN_CUR = u(911), RUN_OLD_A = u(912), RUN_OLD_B = u(913), RUN_SUP = u(914);
const NOW = Date.now(), DAY = 864e5;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const REG_TOOL = CATALOG.tools.find((t) => t.id === 'opportunity-register');
const CURRENT = REG_TOOL.aliases.current;

const PROJECTS = [
  { id: PID, client_id: 'frontera', name: 'Llanos waterflood screen', status: 'active', default_legal_tag: 'lt-firm', asset_ids: ['field:co:rubiales'], members: ['chris'], created_at: iso(30 * DAY), closed_at: null,
    contacts: ['john-smith'], country: 'CO', lat: 4.1, lon: -72.9, stage: 'Technical review', stage_history: [{ stage: 'Initial screen', at: iso(30 * DAY), by: 'chris' }, { stage: 'Technical review', at: iso(12 * DAY), by: 'chris' }],
    register: { source: 'Alpha', current: 12, plan: 18, risk: 'amber', risk_score: 48, owner: 'Chris', holder: 'Frontera Energy', next: 'Issue screening letter to Frontera' },
    last_activity_at: iso(2 * 3600e3), run_count: 4, item_count: 6, stale_count: 1 },
  { id: 'talara-redevelopment', client_id: 'petroperu', name: 'Talara redevelopment', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'], created_at: iso(20 * DAY), closed_at: null,
    contacts: [], country: 'PE', lat: -4.6, lon: -81.3, stage: 'Qualified', stage_history: [{ stage: 'Qualified', at: iso(20 * DAY), by: 'chris' }], register: {}, last_activity_at: iso(5 * DAY), run_count: 1, item_count: 2, stale_count: 0 },
  { id: 'firm', client_id: null, name: 'ATC internal', status: 'active', default_legal_tag: 'lt-firm', asset_ids: [], members: [], created_at: iso(300 * DAY), closed_at: null,
    contacts: [], country: null, lat: null, lon: null, stage: 'Initial screen', stage_history: [], register: {}, last_activity_at: iso(300 * DAY), run_count: 0, item_count: 3, stale_count: 0 },
];
const ORGS = [{ id: 'frontera', name: 'Frontera Energy', kind: 'client', country: 'CO' }, { id: 'petroperu', name: 'Petroperú', kind: 'operator', country: 'PE' }];
const CONTACTS = {
  project_id: PID, client_id: 'frontera',
  contacts: [
    { id: 'john-smith', name: 'John Smith', role: 'Subsurface manager', emails: ['john.smith@frontera.example'], language: 'en', organisation: { id: 'frontera', name: 'Frontera Energy', kind: 'client', counterparty: 'client' }, last_contact: iso(3 * DAY), relationship: null },
    { id: 'maria-fernandez', name: 'María Fernández', role: 'Legal counsel', emails: ['mfernandez@frontera.example'], language: 'es', organisation: { id: 'frontera', name: 'Frontera Energy', kind: 'client', counterparty: 'client' }, last_contact: null, relationship: null },
  ],
  counterparties: [{ kind: 'holder', name: 'Frontera Energy', organisation_id: 'frontera' }],
};
const cproj = (p) => ({ id: p.id, name: p.name, status: p.status, stage: p.stage, client_id: p.client_id, client_name: p.client_id === 'frontera' ? 'Frontera Energy' : 'Petroperú', lat: p.lat, lon: p.lon, last_run_at: iso(2 * DAY), attention: { stale: p.stale_count, filing: 0, expiring_days: null }, assets: [] });
const COUNTRIES = {
  countries: [
    { code: 'CO', name: { en: 'Colombia', es: 'Colombia' }, projects: [cproj(PROJECTS[0])], counts: { projects: 1, stale: 1, filing: 0, expiring: 0 }, risk: null },
    { code: 'PE', name: { en: 'Peru', es: 'Perú' }, projects: [cproj(PROJECTS[1])], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
  ],
  unplaced: [],                                   // the server leaves the internal project out (S4)
  generated_at: iso(0), world_monitor: { status: 'not_connected', reason: 'not connected', notes: [] },
};
const run = (id, ver, status, msAgo, title) => ({ id, job: 'opportunity-register', tool_version: ver, tool_commit: 'abc1234', author: 'chris', created_at: iso(msAgo), project_id: PID, legal_tag: 'lt-firm', title, status, supersedes: null, inputs: [], outputs: { technical_potential_bopd: { value: 12400, unit: 'bopd' } }, assumptions: {}, params: {}, stale: false, stale_reasons: [] });
const RUNS = [
  run(RUN_CUR, CURRENT, 'final', 2 * DAY, 'Cubiro screen, base case'),
  run(RUN_OLD_A, '2.0.0', 'draft', 9 * DAY, 'Cubiro screen, sensitivity A'),
  run(RUN_OLD_B, '1.1.1', 'reviewed', 14 * DAY, 'Cubiro screen, first pass'),
  { ...run(RUN_SUP, '1.1.0', 'superseded', 20 * DAY, 'Cubiro screen, draft zero'), stale: true, stale_reasons: [{ rule: 'R3', detail: 'superseded' }] },
];
const DOSSIER_ITEM = {
  id: DOSSIER, type: 'note', title: 'Field dossier: Rubiales', created_at: iso(8 * DAY), authored_at: null, authors: ['chris'], client_id: null, project_id: PID, asset_ids: ['field:co:rubiales'], legal_tag: 'lt-public',
  origin: { source: 'gem', external_id: 'gem:rubiales', fetched_at: iso(8 * DAY), url: 'https://www.gem.wiki/Rubiales_Oil_Field' }, storage_key: null, content_hash: 'sha256:' + 'c'.repeat(64), version: 1, supersedes: null, cites: [], filing: { method: 'tool' },
  extracted: { kind: 'dossier', asset_id: 'field:co:rubiales', asset_name: 'Rubiales', source: 'gem', source_url: 'https://www.gem.wiki/Rubiales_Oil_Field', summary: 'Rubiales: operating oil field in Meta, Colombia. Source: Global Energy Monitor.',
    owners: ['Ecopetrol 100 %'], status: 'operating', lat: 3.86, lon: -71.46, country: 'CO', attribution: 'Global Energy Monitor, CC BY 4.0' },
  stale: false, tags: ['dossier', 'gem'], organisation_ids: [], reference_no: null, mime: null,
};
const PAPER_ITEM = {
  id: PAPER, type: 'paper', title: 'Polymer flooding in heavy oil reservoirs of the Llanos basin', created_at: iso(6 * DAY), authored_at: '2021-03-01T00:00:00.000Z', authors: ['A. Gómez', 'B. Ruiz'], client_id: null, project_id: PID, asset_ids: [], legal_tag: 'lt-public',
  origin: { source: 'semantic-scholar', external_id: 'ss:1234', fetched_at: iso(6 * DAY), url: 'https://www.semanticscholar.org/paper/1234' }, storage_key: 'originals/aa/paper', content_hash: 'sha256:' + 'd'.repeat(64), version: 1, supersedes: null, cites: [], filing: { method: 'tool' },
  extracted: { doi: '10.2118/12345-MS', abstract_chars: 160, manifest: { url: 'https://api.semanticscholar.org/graph/v1/paper/1234', fetched_at: iso(6 * DAY), sha256: 'e'.repeat(64), rows: 1 } },
  stale: false, tags: ['miner:semantic-scholar', 'doi:10.2118/12345-MS'], organisation_ids: [], reference_no: null, mime: 'application/json',
};
const PAPER_ORIGINAL = { title: PAPER_ITEM.title, abstract: 'Polymer injection in the Rubiales heavy-oil field improved sweep by 12 % over waterflood in the pilot pattern, with viscosity targets of 20 to 30 cP at reservoir temperature.', doi: '10.2118/12345-MS', authors: PAPER_ITEM.authors, authored_at: PAPER_ITEM.authored_at };
const TIMELINE = [
  ...RUNS.map((r) => ({ kind: 'run', ref: 'run:' + r.id, id: r.id, at: r.created_at, title: r.title, job: r.job, tool_version: r.tool_version, status: r.status, legal_tag: 'lt-firm', stale: r.stale, stale_reasons: r.stale_reasons, supersedes: null, superseded_by: null })),
  { kind: 'item', ref: 'doc:' + DOSSIER, id: DOSSIER, at: DOSSIER_ITEM.created_at, title: DOSSIER_ITEM.title, type: 'note', version: 1, reference_no: null, legal_tag: 'lt-public', stale: false, stale_reasons: [], supersedes: null, superseded_by: null },
  { kind: 'item', ref: 'doc:' + PAPER, id: PAPER, at: PAPER_ITEM.created_at, title: PAPER_ITEM.title, type: 'paper', version: 1, reference_no: null, legal_tag: 'lt-public', stale: false, stale_reasons: [], supersedes: null, superseded_by: null },
];
const RESEARCH = {
  enabled: true, findings: [],
  // The shape the status route gives a run reaped past its budget (builder C): failed, reaped, the reason first in the warnings.
  runs: [{ id: u(950), status: 'failed', started_at: iso(40 * 60e3), finished_at: iso(25 * 60e3), summary: { reaped: true, warnings: ['reaped: ran past its 15 min budget'], budget: { ms: 900000, gbp: 2 }, findings: 2, duration_ms: 900000, spend_gbp: 0, sources: { literature: { queries: 2, findings: 2 } }, proposals: { asset: 0, research: 0 } } }],
};
const DAY_RATES = { key: 'day-rates', value: { rates: { Principal: 13500, Senior: 11000, 'Mid-level': 8000, Junior: 5500 }, swMult: 100, miscMult: 100, dataMult: 100, margin: 0, partners: [{ code: 'MP', name: 'Chris Hopkinson', role: 'Managing Partner', level: 'Principal' }] }, updated_by: null, updated_at: null, defaults: true };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** The seeded Vault. Returns the log of what the page asked for, so a check can say "no 404 was answered". */
async function seed(page, { rerun, draft } = {}) {
  const log = { patched: [], reruns: [], notFound: [] };
  const state = { projects: JSON.parse(JSON.stringify(PROJECTS)) };
  const project = () => state.projects.find((p) => p.id === PID);
  await page.route('**/api/**', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
    if (p === '/api/health') return json(route, { ok: true, version: '0.7.0', migrations: 7, backend: 'pg' });
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/search') return json(route, { hits: [], scope: url.searchParams.get('scope'), took_ms: 1 });
    if (p === '/api/catalog') return json(route, CATALOG);
    const rs = /^\/api\/tools\/([^/]+)\/resolve$/.exec(p);
    if (rs) { const t = CATALOG.tools.find((x) => x.id === rs[1]); return t ? json(route, { id: t.id, version: t.aliases.current, entry: t.entry }) : json(route, { error: { code: 'not_found', message: 'no tool' } }, 404); }
    if (p === '/api/projects') return json(route, { projects: state.projects });
    if (p === '/api/organisations') return json(route, { organisations: ORGS });
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (/^\/api\/countries\/[A-Z]{2}\/intel$/.test(p)) return json(route, { country: p.split('/')[3], name: { en: 'Country', es: 'País' }, world_monitor: { status: 'not_connected', reason: 'not connected' }, sections: {} });
    // Wave 7 PR5 (W7-AC19): the pack route answers for every country; nothing assembled yet in this seed.
    if (/^\/api\/countries\/[A-Z]{2}\/pack$/.test(p)) return json(route, { country: p.split('/')[3], assembled_at: null, sections: [], counts: { built: 0, fresh: 0, due: 0, stale: 0, unreachable: 0, empty: 10 }, job: null, spend_gbp: 0 });
    // Wave 7 PR6 (W7-AC22): the round watch answers with nothing due and nothing proposed, so the Deadlines card reads zero in one line.
    if (p === '/api/rounds') return json(route, { countries: [], deadlines: [], proposed: 0 });
    if (p === '/api/me/mailbox') return json(route, { prompt: false, connected: false, configured: false });
    if (p === '/api/me/activity') return json(route, { since: iso(DAY), counts: { records: 0 }, projects: [], brief_available: false });
    if (p === '/api/queue/filing') return json(route, { items: [] });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    if (p === '/api/queue/review') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: RUNS });
    if (/^\/api\/projects\/[^/]+\/stale$/.test(p)) return json(route, { runs: [], items: [] });
    if (p === '/api/projects/' + PID) {
      if (m === 'PATCH') {
        const b = JSON.parse(req.postData()); log.patched.push(b);
        const cur = project();
        const reg = { ...cur.register, ...(b.register || {}) };
        // What the Vault does (S14): archiving remembers the status; leaving archived forgets it.
        if (b.status === 'archived' && cur.status !== 'archived') reg.status_before_archive = cur.status;
        if (b.status && b.status !== 'archived' && cur.status === 'archived') delete reg.status_before_archive;
        Object.assign(cur, b, { register: reg });
        return json(route, cur);
      }
      return json(route, project());
    }
    // Wave 7 PR3 (W7-AC12): the standing route, in the shape builder G serves, from the same seed.
    if (p === '/api/projects/' + PID + '/standing') return json(route, { project: { id: PID, name: project().name, status: project().status, stage: project().stage, stage_since: project().stage_history[project().stage_history.length - 1].at, country: 'CO', client_id: 'frontera' }, next: { title: 'Issue screening letter to Frontera', due_at: null, owner: 'Chris', ref: null }, figures: [], open: { proposals: {}, filing: 0, questions_in_drafts: 0, unanswered_inbound: 0, unacknowledged_dispatches: 0 }, counterparties: [], deadlines: [], since: null, stale_counts: { runs: 0, items: 0 }, last_activity: null });
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length, entries: TIMELINE });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/projects/' + PID + '/contacts') return json(route, CONTACTS);
    if (p === '/api/projects/' + PID + '/research') return json(route, RESEARCH);
    if (p === '/api/projects/' + PID + '/assets') return json(route, { project_id: PID, assets: [] });
    if (p === '/api/organisations/frontera') return json(route, { ...ORGS[0], contacts: [] });
    if (p === '/api/organisations/frontera/file') return json(route, { organisation: ORGS[0], contracts_in_force: [], dispatches: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/items/' + DOSSIER) return json(route, DOSSIER_ITEM);
    if (p === '/api/items/' + PAPER) return json(route, PAPER_ITEM);
    if (p === '/api/items/' + PAPER + '/original') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAPER_ORIGINAL) });
    if (/^\/api\/items\/[^/]+\/versions$/.test(p)) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/settings/day-rates') return m === 'GET' ? json(route, DAY_RATES) : json(route, { ...DAY_RATES, value: JSON.parse(req.postData()).value, updated_by: 'chris', updated_at: iso(0), defaults: undefined });
    if (p === '/api/me/connections') return json(route, { connections: [] });
    if (p === '/api/draft' && m === 'POST') return draft ? draft(route) : json(route, { error: { code: 'not_configured', message: 'The drafting assistant is not connected. Ask Chris.' } }, 503);
    const rr = /^\/api\/runs\/([^/]+)\/rerun$/.exec(p);
    if (rr && m === 'POST') { log.reruns.push(rr[1]); return rerun ? rerun(route, rr[1]) : json(route, { error: { code: 'runner_unavailable', message: 'SITE_ORIGIN is not configured' } }, 503); }
    log.notFound.push(m + ' ' + p);
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return log;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

/** Console errors and page errors, ignoring resources the sandbox cannot fetch (fonts, CDNs). */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|net::ERR_|ERR_NAME_NOT_RESOLVED/.test(msg.text())) errors.push('console: ' + msg.text()); });
  return errors;
}
const sidebar = (page) => page.locator('aside.hub-side').evaluate((el) => el.outerHTML.replace(/ aria-current="page"/g, ''));

for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`check 1 (${vp.width}×${vp.height}): Today loads with no console error, no 404 and no firm row; the intel card stays hidden without World Monitor`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = watchErrors(page);
    const log = await seed(page);
    await page.goto('/hub/index.html');
    await ready(page);
    expect(errors).toEqual([]);
    expect(log.notFound).toEqual([]);
    await expect(page.locator('#register [data-register-row]')).toHaveCount(2);
    await expect(page.locator('[data-register-row="firm"]')).toHaveCount(0);
    await expect(page.locator('#sec-projects')).toHaveCount(0);                      // My projects is gone (S2)
    await expect(page.locator('#country-unplaced')).toBeHidden();
    // Wave 7 PR2 (idea C): the strip is live and the sidebar carries no Vault footer.
    await expect(page.locator('#hub-strip')).toHaveAttribute('data-state', 'synced');
    await expect(page.locator('.hub-side-foot')).toHaveCount(0);
    await page.locator('#register [data-country="CO"]').click();
    await expect(page.locator('#country-panel')).toBeVisible();
    await expect(page.locator('#country-intel')).toBeHidden();                       // S9
    await expect(page.locator('#country-intel')).toHaveAttribute('data-state', 'not_connected');
    await expect(page.locator('#country-panel [data-country-project] .hub-stateline[data-stateline="row"]')).toHaveCount(1);   // W7-AC6
    await expect(page.locator('[data-tool-id]')).toHaveCount(0);                     // the catalog lives on the Tools index now (R4)
    if (vp.width === 1440) { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: path.join(EVIDENCE, 'w7-clearance-today.png') }); }
  });
}

test('check 1b: the Tools index (hub/tool.html without an id) lists the catalog with the PR1 removals still applied', async ({ page }) => {
  const errors = watchErrors(page);
  const log = await seed(page);
  await page.goto('/hub/tool.html');
  await ready(page);
  expect(errors).toEqual([]);
  expect(log.notFound).toEqual([]);
  await expect(page.locator('h1')).toHaveText('Tools');
  const cards = page.locator('[data-tool-id]');
  await expect(cards.first()).toBeVisible();
  await expect(page.locator('.hub-pill', { hasText: 'Version unverified' })).toHaveCount(0);   // S6
  await expect(page.locator('[data-tool-id="insight-radar"] a[data-open]')).toHaveCount(0);  // S7
  await expect(page.locator('[data-tool-id="apex-3d-model"] a[data-open]')).toHaveAttribute('href', /apex-3d-model/);   // the card still links the app (W7-AC5)
  await expect(page.locator('[data-tool-id="opportunity-register"] a[data-open]')).toHaveAttribute('href', /opportunity-register\.html$/);
  // R11: the catalog's source is said in plain words, never as a file name.
  await expect(page.locator('body')).not.toContainText('catalog.json');
});

test('check 2: the sidebar is identical on every page and marks the current page from data-page', async ({ page }) => {
  await seed(page);
  const pages = ['index.html', 'project.html?id=' + PID, 'queue.html', 'search.html', 'settings.html', 'tool.html?id=opportunity-register', 'cost.html', 'analogues.html'];
  const expectCurrent = { 'index.html': 'Today', ['project.html?id=' + PID]: 'Projects', 'queue.html': 'Queues', 'search.html': 'Find', 'settings.html': 'Settings', 'cost.html': 'Settings' };
  let first = null;
  for (const p of pages) {
    await page.goto('/hub/' + p);
    await expect(page.locator('aside.hub-side nav a')).toHaveCount(5);
    const html = await sidebar(page);
    if (first === null) first = html; else expect(html, p).toBe(first);
    const labels = await page.locator('aside.hub-side nav a span[data-en]').allTextContents();
    expect(labels, p).toEqual(['Today', 'Projects', 'Queues', 'Find', 'Settings']);
    const cur = page.locator('aside.hub-side nav a[aria-current="page"]');
    if (expectCurrent[p]) await expect(cur, p).toHaveText(expectCurrent[p]); else await expect(cur, p).toHaveCount(0);
  }
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('aside.hub-side nav a', { hasText: 'Projects' })).toHaveAttribute('href', '/hub/index.html#register');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('aside.hub-side').screenshot({ path: path.join(EVIDENCE, 'w7-clearance-nav.png') });
});

for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`check 3 (${vp.width}×${vp.height}): a project opens cold with stage, next and last visible without scrolling`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = watchErrors(page);
    const log = await seed(page);
    await page.goto('/hub/project.html?id=' + PID);
    await ready(page);
    expect(errors).toEqual([]);
    expect(log.notFound).toEqual([]);
    await expect(page.locator('#p-stage')).toHaveValue('Technical review');
    await expect(page.locator('#p-stateline [data-token="next"]')).toContainText('Issue screening letter to Frontera');
    await expect(page.locator('#p-stateline [data-token="last"]')).toContainText('Cubiro screen, base case');
    for (const sel of ['#p-stage', '#p-stateline [data-token="next"]', '#p-stateline [data-token="last"]']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, sel).not.toBeNull();
      expect(box.y + box.height, sel + ' is above the fold').toBeLessThanOrEqual(vp.height);
    }
  });
}

test('check 4: Restore returns the prior status, not Prospect', async ({ page }) => {
  const log = await seed(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('#p-sub [data-status]')).toHaveAttribute('data-status', 'active');
  await page.locator('#p-more').click();               // Archive lives in the … overflow (wave 7 R1)
  await page.locator('#p-archive').click();            // asks to confirm in a sheet
  await page.locator('#p-archive-confirm').click();    // confirms
  await expect(page.locator('#p-sub [data-status]')).toHaveAttribute('data-status', 'archived');
  await expect(page.locator('#p-archive')).toHaveText('Restore project');
  await page.locator('#p-archive').click();
  await expect(page.locator('#p-sub [data-status]')).toHaveAttribute('data-status', 'active');
  expect(log.patched).toEqual([{ status: 'archived' }, { status: 'active' }]);
});

test('check 5: the header contacts are the list Write to… uses', async ({ page }) => {
  await seed(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const header = page.locator('#p-file [data-contact]');
  await expect(header).toHaveCount(2);
  expect(await header.evaluateAll((els) => els.map((e) => e.getAttribute('data-contact')))).toEqual(['john-smith', 'maria-fernandez']);
  await expect(header.nth(1)).toContainText('María Fernández');
  await expect(header.nth(1)).toContainText('Frontera Energy');
  await page.locator('#p-draft-btn').click();
  const opts = page.locator('#dr-to option[value]:not([value=""])');
  await expect(opts).toHaveCount(2);
  expect(await opts.evaluateAll((els) => els.map((e) => e.value))).toEqual(['john-smith', 'maria-fernandez']);
});

test('check 6: Settings answers 200, is headed Settings, sets data-ready, keeps the rates under Plan Your Job and saves with one PUT', async ({ page }) => {
  const errors = watchErrors(page);
  const log = await seed(page);
  const calls = [];
  page.on('request', (r) => { if (/\/api\/settings\//.test(r.url())) calls.push(r.method()); });
  await page.goto('/hub/settings.html');
  await ready(page);
  expect(errors).toEqual([]);
  expect(log.notFound.filter((x) => /settings/.test(x))).toEqual([]);
  await expect(page.locator('h1')).toHaveText('Settings');
  await expect(page.locator('#sec-plan-your-job')).toContainText('Plan Your Job');
  await expect(page.locator('#sec-plan-your-job #r-principal')).toHaveValue('13500');
  await expect(page.locator('#sec-cost a[href="/hub/cost.html"]')).toBeVisible();        // Cost & health lives here for partners (S40)
  await expect(page.locator('#mailbox-off-text')).toHaveText('Mail capture is not switched on for this Vault yet. Ask Chris.');
  await page.locator('#r-senior').fill('12500');
  await page.getByRole('button', { name: 'Save and apply' }).click();
  await expect(page.locator('#save-status')).toContainText('Saved to the Vault');
  expect(calls.filter((m) => m !== 'GET')).toEqual(['PUT']);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-clearance-settings.png') });
});

test('check 7: the tool page offers a Re-run for each run on an older version, and shows the server\'s reason when it answers 503', async ({ page }) => {
  const log = await seed(page);
  await page.goto('/hub/tool.html?id=opportunity-register');
  await ready(page);
  const alert = page.locator('[data-older-count]');
  await expect(alert).toHaveAttribute('data-older-count', '2');
  const older = page.locator('#t-older');
  const rows = older.locator('[data-rerun-run]');
  await expect(rows).toHaveCount(2);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-rerun-run')))).toEqual([RUN_OLD_A, RUN_OLD_B]);
  await expect(alert).not.toContainText('M08');
  const all = alert.locator('button[data-action="rerun-all"]');
  await expect(all).toBeEnabled();
  await rows.nth(1).locator('button[data-action="rerun"]').click();
  await expect.poll(() => log.reruns).toEqual([RUN_OLD_B]);
  await expect(older.locator('[data-rerun-reason]')).toContainText('SITE_ORIGIN is not configured');
  await expect(older.locator('[data-rerun-reason]')).toContainText('not available on this server');
});

test('check 7b: a successful re-run links the new run and a 503 on Re-run all stops after the first', async ({ page }) => {
  const made = [];
  const log = await seed(page, { rerun: (route, id) => { const nid = u(990 + made.length); made.push(nid); return json(route, { id: nid, deduplicated: false, note_id: u(980), queue_id: u(970), delta: { changes: [], unchanged: [], spread: {}, review_required: false, summary: 'No change.', explanation_source: 'rule', causes: [] } }, 201); } });
  await page.goto('/hub/tool.html?id=opportunity-register');
  await ready(page);
  await page.locator('button[data-action="rerun-all"]').click();
  await expect.poll(() => log.reruns.length).toBe(2);
  expect(log.reruns).toEqual([RUN_OLD_A, RUN_OLD_B]);
  const done = page.locator('[data-rerun-run] [data-rerun-done]');
  await expect(done).toHaveCount(2);
  await expect(done.nth(0)).toHaveAttribute('href', '/hub/project.html?id=' + PID + '&run=' + made[0]);
});

test('check 8: a research run past its budget reads reaped, and the button is offered again', async ({ page }) => {
  await seed(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const status = page.locator('#p-research-status [data-run-status]');
  await expect(status).toHaveAttribute('data-run-status', 'failed');
  await expect(status).toContainText('reaped');
  await expect(page.locator('#p-research-btn')).toBeEnabled();
});

test('check 9: Write to… without a provider refuses clearly and renders no draft', async ({ page }) => {
  await seed(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator('#p-draft-btn').click();
  const panel = page.locator('#p-draft');
  await expect(panel.locator('#dr-to option[value="john-smith"]')).toHaveCount(1);
  await panel.locator('#dr-to').selectOption('john-smith');
  await panel.locator('#dr-brief').fill('Tell him the waterflood screen result and ask for the injector list.');
  await panel.locator('#dr-go').click();
  await expect(panel.locator('#dr-notices .hub-notice.bad')).toBeVisible();
  await expect(panel.locator('#dr-notices .hub-notice.bad')).toContainText(/not connected|assistant provider/);
  await expect(panel.locator('#dr-result')).toBeHidden();
});

test('check 10: a field dossier shows its facts as a key-value card; a paper shows its abstract', async ({ page }) => {
  await seed(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator(`.hub-tl-item[data-ref="doc:${DOSSIER}"] .hub-tl-title`).click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  const facts = panel.locator('[data-view] [data-dossier]');
  await expect(facts).toBeVisible();
  await expect(facts.locator('[data-fact="owners"]')).toContainText('Ecopetrol 100 %');
  await expect(facts.locator('[data-fact="status"]')).toContainText('operating');
  await expect(facts.locator('[data-fact="lat"]')).toContainText('3.86');
  await expect(facts.locator('a[href="https://www.gem.wiki/Rubiales_Oil_Field"]')).toHaveCount(1);
  await expect(panel.locator('[data-view]')).not.toContainText('Filed without an original');
  await page.locator('#rp-close').click();
  await page.locator(`.hub-tl-item[data-ref="doc:${PAPER}"] .hub-tl-title`).click();
  await expect(panel).toBeVisible();
  const paper = panel.locator('[data-view] [data-paper]');
  await expect(paper).toBeVisible();
  await expect(paper.locator('[data-paper-abstract]')).toContainText('improved sweep by 12 %');
  await expect(paper).toContainText('A. Gómez, B. Ruiz');
  await expect(paper).toContainText('2021');
  await expect(paper.locator('a[href="https://doi.org/10.2118/12345-MS"]')).toHaveCount(1);
});
