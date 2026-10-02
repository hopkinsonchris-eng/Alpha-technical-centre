// Wave 4, PR 2 (docs/vault-hub/wave4/05-markup.md §1.1–§1.2): the Hub side of research runs. The toolbar
// button shows progress and the result line (polling while a run is going); the Research tab lists
// findings by source with the query, a verbatim quote and [open] into the record panel; the Fields card
// and the queue page carry research proposals with Set as operator / File as fact / Not a fact; a person
// who cannot write sees no button. Smoke tests for W4-AC7 and the W4-AC8 evidence. The API is stubbed.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const ANA = { id: 'ana', name: 'Ana', email: 'ana@alpha-technical-centre.com', role: 'associate' };
const PID = 'hte-apure';
const F1 = '00000000-0000-4000-8000-000000000a01', F2 = '00000000-0000-4000-8000-000000000a02', F3 = '00000000-0000-4000-8000-000000000a03', F4 = '00000000-0000-4000-8000-000000000a04';

const PROJECT = {
  id: PID, client_id: 'hte', name: 'High Tech Electronica', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: ['field:ve:guafita'], members: ['chris'],
  created_at: '2026-09-30T09:00:00.000Z', closed_at: null, contacts: [], country: 'VE', lat: 7.6, lon: -70.9, stage: 'Initial screen',
  stage_history: [{ stage: 'Initial screen', at: '2026-09-30T09:00:00.000Z', by: 'chris' }], register: { thesis: 'Apure restart' },
};
const GUAFITA = { id: 'field:ve:guafita', kind: 'field', name: 'Guafita', parent_id: null, country: 'VE', operator: null, source_url: 'https://www.gem.wiki/Guafita_Oil_Field', lat: 7.6, lon: -70.9, location_source: 'gem', status: 'operating', created_by: 'chris', created_at: '2026-09-30T10:00:00.000Z', props: { gem: { unit_id: 'G100', release: 'March 2026' } }, dossier: [] };
const RUN_OK = { id: 7, status: 'stopped', started_at: '2026-10-01T12:25:00.000Z', finished_at: '2026-10-01T12:40:00.000Z', summary: {
  project_id: PID, status: 'stopped', findings: 6, proposals: { asset: 1, research: 2 }, fact_reads: 3, spend_gbp: 1.8, duration_ms: 15 * 60000, budget: { ms: 15 * 60000, gbp: 3 }, stopped_by: 'time',
  sources: { 'gem-wiki': { queries: 1, findings: 1, created: 1, updated: 0, unchanged: 0, skipped: '1 field without a Global Energy Monitor record' }, web: { queries: 3, findings: 1, created: 1, updated: 0, unchanged: 0, detail: '4 searches · 2 pages seen · 1 cited' }, gdelt: { queries: 3, findings: 2, created: 2, updated: 0, unchanged: 0 }, company: { queries: 2, findings: 0, created: 0, updated: 0, unchanged: 0, error: 'World Monitor timed out', skipped: 'needs World Monitor Pro (this endpoint is Pro-gated on the current plan)' }, 'company-signals': { queries: 0, findings: 1, created: 1, updated: 0, unchanged: 0 }, literature: { queries: 2, findings: 1, created: 1, updated: 0, unchanged: 0 } },
  not_reached: [{ source: 'gdelt', query: '"La Victoria" Venezuela', reason: 'time' }, { source: 'literature', query: 'Guafita field Venezuela reservoir', reason: 'time' }], warnings: [] } };
const F5 = '00000000-0000-4000-8000-000000000a05', F6 = '00000000-0000-4000-8000-000000000a06';
const FINDINGS = [
  { id: F5, type: 'note', title: 'Global Energy Monitor: Guafita', date: '2026-10-01T12:30:00.000Z', source: 'gem-wiki', url: 'https://www.gem.wiki/Guafita_Oil_Field_(Venezuela)', query: 'Guafita', quote: 'Guafita Oil Field is an operating oil field in Venezuela. | Project Details | Unit name Status Operator Guafita operating PDVSA 1984', asset_ids: ['field:ve:guafita'], legal_tag: 'lt-public', version: 1 },
  { id: F6, type: 'note', title: 'The Future of Venezuela\'s Oil Industry', date: '2026-10-01T12:30:00.000Z', source: 'web', url: 'https://eprinc.org/wp-content/uploads/2021/09/The-Future-of-Venezuelas-Oil-Industry.pdf', query: '"Guafita" Venezuela', quote: 'the Guafita field in Apure produced 12,400 barrels per day in 2024', asset_ids: ['field:ve:guafita'], legal_tag: 'lt-public', version: 1 },
  { id: F1, type: 'note', title: 'PDVSA restarts Apure production after pipeline repair', date: '2026-09-30T10:00:00.000Z', source: 'gdelt', url: 'https://www.reuters.com/x/apure', query: '"Guafita" Venezuela', quote: 'PDVSA restarts Apure production after pipeline repair (Reuters)', asset_ids: ['field:ve:guafita'], legal_tag: 'lt-public', version: 1 },
  { id: F2, type: 'note', title: 'The Guafita and La Victoria fields resume output', date: '2026-09-28T12:00:00.000Z', source: 'gdelt', url: 'https://www.elnacional.com/x/guafita', query: '"Guafita" Venezuela', quote: 'The Guafita and La Victoria fields in Apure state resumed production this week.', asset_ids: ['field:ve:guafita'], legal_tag: 'lt-public', version: 1 },
  { id: F3, type: 'note', title: 'PDVSA signs service contract for Guafita', date: '2026-09-29T08:00:00.000Z', source: 'company-signals', url: 'https://www.argusmedia.com/x/pdvsa', query: 'PDVSA', quote: 'PDVSA signs service contract for Guafita (news) — Argus', asset_ids: [], legal_tag: 'lt-public', version: 1 },
  { id: F4, type: 'paper', title: 'Waterflood performance of the Guafita reservoir, Apure basin', date: '2025-03-01T00:00:00.000Z', source: 'openalex', url: 'https://openalex.org/W1', query: 'Guafita field Venezuela reservoir', quote: 'Guafita field waterflood history match.', asset_ids: [], legal_tag: 'lt-public', version: 1 },
];
const ITEM = (f) => ({ id: f.id, type: f.type, title: f.title, created_at: '2026-10-01T12:30:00.000Z', authored_at: f.date, authors: ['research'], client_id: null, project_id: PID, asset_ids: f.asset_ids, legal_tag: 'lt-public', origin: { source: 'research', adapter: f.source, external_id: 'gdelt:' + f.url, url: f.url, fetched_at: '2026-10-01T12:30:00.000Z', query: f.query }, external_id: 'gdelt:' + f.url, content_hash: 'sha256:' + 'b'.repeat(64), version: 1, extracted: { kind: 'research', source: f.source, query: f.query, quote: f.quote, url: f.url }, tags: ['research', f.source], cites: [] });
const PROPOSALS = [
  { id: '20000000-0000-4000-8000-000000000001', kind: 'asset', status: 'open', created_at: '2026-10-01T12:31:00.000Z', payload: { project_id: PID, item_id: F2, item_version: 1, item_title: 'The Guafita and La Victoria fields resume output', name: 'La Victoria', kind: 'field', quote: 'The Guafita and La Victoria fields in Apure state resumed production this week.', anchor: null, source: 'dictionary', proposal: 'Field named in "The Guafita and La Victoria fields resume output": La Victoria', candidates: [] } },
  { id: '20000000-0000-4000-8000-000000000002', kind: 'research', status: 'open', created_at: '2026-10-01T12:31:00.000Z', payload: { project_id: PID, item_id: F1, item_title: 'PDVSA restarts Apure production after pipeline repair', fact_kind: 'operator', value: 'PDVSA', unit: null, year: null, quote: 'PDVSA restarts Apure production after pipeline repair', asset_id: 'field:ve:guafita', asset_name: 'Guafita', proposal: 'Operator: PDVSA' } },
  { id: '20000000-0000-4000-8000-000000000003', kind: 'research', status: 'open', created_at: '2026-10-01T12:31:00.000Z', payload: { project_id: PID, item_id: F3, item_title: 'PDVSA signs service contract for Guafita', fact_kind: 'production', value: '12,400', unit: 'bopd', year: 2026, quote: 'PDVSA signs service contract for Guafita (news) — Argus', asset_id: 'field:ve:guafita', asset_name: 'Guafita', proposal: 'Production: 12,400 bopd (2026)' } },
  { id: '20000000-0000-4000-8000-000000000004', kind: 'research', status: 'open', created_at: '2026-10-01T12:31:00.000Z', payload: { project_id: 'other', item_id: 'x', item_title: 'Elsewhere', fact_kind: 'operator', value: 'Nobody', quote: 'x', asset_id: null, asset_name: null, proposal: 'Operator: Nobody' } },
];
const LOCATION = { id: '20000000-0000-4000-8000-000000000005', kind: 'research', status: 'open', created_at: '2026-10-01T12:31:00.000Z', payload: { project_id: PID, item_id: null, item_title: null, fact_kind: 'location', value: '8.8778, -64.3669', unit: null, year: null, quote: 'Oficina (gem, VE) at 8.8778, -64.3669', asset_id: 'field:ve:oficina-norte', asset_name: 'OFICINA NORTE',
  candidate: { name: 'Oficina', kind: 'field', country: 'VE', lat: 8.8778, lon: -64.3669, source: 'gem', source_id: 'L100000305199', source_url: 'https://www.gem.wiki/Oficina_Oil_Field_(Venezuela)', detail: { unit_id: 'L100000305199', release: 'March 2026' } },
  proposal: 'Location for OFICINA NORTE: Oficina (gem) at 8.8778, -64.3669, an area match' } };
const OFICINA_NORTE = { id: 'field:ve:oficina-norte', kind: 'field', name: 'OFICINA NORTE', parent_id: null, country: 'VE', operator: null, source_url: null, lat: null, lon: null, location_source: null, status: null, created_by: 'chris', created_at: '2026-10-01T10:00:00.000Z', props: {}, dossier: [] };
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Stubs the API. `research` is the view GET answers; `onStart` answers the POST and may change what later GETs say. */
async function stubApi(page, { me = PARTNER, research, proposals = PROPOSALS, onStart, assets = [GUAFITA] } = {}) {
  const calls = { started: 0, decided: [], views: 0 };
  let view = research === undefined ? { project_id: PID, runs: [RUN_OK], findings: FINDINGS, enabled: true } : research;
  let queue = proposals.map((q) => ({ ...q }));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
    if (p === '/api/me') return json(route, me);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/assets' && m === 'GET') return json(route, { project_id: PID, assets });
    if (p === '/api/projects/' + PID + '/research' && m === 'GET') { calls.views++; if (typeof view === 'function') return view(route, calls); return view ? json(route, view) : json(route, { error: { code: 'not_found', message: 'no route' } }, 404); }
    if (p === '/api/projects/' + PID + '/research' && m === 'POST') { calls.started++; if (onStart) return onStart(route, calls, (v) => { view = v; }); return json(route, { project_id: PID, job_id: 8, state: 'queued' }, 202); }
    if (p === '/api/queue/review') return json(route, { items: queue });
    const dm = /^\/api\/queue\/review\/([^/]+)\/(accept|reject)$/.exec(p);
    if (dm && m === 'POST') {
      const b = route.request().postData() ? JSON.parse(route.request().postData()) : {}; calls.decided.push({ id: dm[1], verb: dm[2], body: b });
      const q = queue.find((x) => x.id === dm[1]);
      queue = queue.filter((x) => x.id !== dm[1]);
      if (dm[2] === 'accept' && q && q.payload.fact_kind === 'location') return json(route, { id: dm[1], status: 'accepted', asset: { ...OFICINA_NORTE, lat: q.payload.candidate.lat, lon: q.payload.candidate.lon, location_source: 'gem', props: { gem: q.payload.candidate.detail } }, dossier: ['00000000-0000-4000-8000-000000000b01'] });
      return json(route, { id: dm[1], status: dm[2] === 'accept' ? 'accepted' : 'rejected' });
    }
    for (const f of FINDINGS) { if (p === '/api/items/' + f.id) return json(route, ITEM(f)); if (p === '/api/items/' + f.id + '/versions') return json(route, { item_id: f.id, versions: [] }); }
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: 0, entries: [] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/projects') return json(route, { projects: [PROJECT] });
    if (p === '/api/organisations/hte') return json(route, { id: 'hte', name: 'High Tech Electronica', kind: 'client', country: 'VE' });
    if (p === '/api/organisations/hte/file') return json(route, { error: { code: 'not_found', message: 'no file' } }, 404);
    if (p === '/api/lessons') return json(route, { lessons: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('W4-AC7: the toolbar shows the last run line; the Research tab lists findings by source with the query and quote; open shows the record', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const btn = page.locator('#p-research-btn');
  await expect(btn).toHaveText('Research this project');
  await expect(btn).toBeEnabled();
  const status = page.locator('#p-research-status');
  await expect(status).toContainText('last run');
  await expect(status).toContainText('6 findings · 3 proposals · stopped at 15 min');
  await expect(status.locator('[data-run-status="stopped"]')).toHaveCount(1);
  // The tab carries the count and the panel groups the findings by source, newest first.
  const tab = page.locator('#tab-research');
  await expect(tab).toContainText('Research');
  await expect(tab.locator('.n')).toHaveText('6');
  await tab.click();
  const panel = page.locator('#panel-research');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#rs-summary')).toContainText('run of 1 Oct');
  await expect(panel.locator('#rs-summary')).toContainText('15 min, £1.80');
  await expect(panel.locator('#rs-summary')).toContainText('GDELT news 2');
  // What each source was asked and answered, errors and Pro gates included.
  const sources = panel.locator('#rs-sources li');
  await expect(sources).toHaveCount(6);
  await expect(sources.nth(0)).toContainText('Global Energy Monitor wiki: 1 query · 1 finding');
  await expect(sources.nth(0).locator('[data-skipped]')).toHaveText('1 field without a Global Energy Monitor record');
  await expect(sources.nth(1)).toContainText('Web search: 3 queries · 1 finding');
  await expect(sources.nth(1).locator('[data-detail]')).toHaveText('4 searches · 2 pages seen · 1 cited');
  await expect(sources.nth(2)).toContainText('World Monitor · GDELT news: 3 queries · 2 findings');
  await expect(sources.nth(3)).toContainText('World Monitor · company lookups: 2 queries · 0 findings');
  await expect(sources.nth(3).locator('[data-error]')).toHaveText('World Monitor timed out');
  await expect(sources.nth(3).locator('[data-skipped]')).toContainText('needs World Monitor Pro');
  const groups = panel.locator('.hub-research-group');
  await expect(groups).toHaveCount(5);
  // W4-AC11: the two added sources lead, in the order the run asks them.
  await expect(groups.nth(0)).toHaveAttribute('data-source', 'gem-wiki');
  await expect(groups.nth(0).locator('h4')).toContainText('Global Energy Monitor wiki');
  await expect(groups.nth(0).locator('li[data-finding="' + F5 + '"] [data-url]')).toHaveText('gem.wiki');
  await expect(groups.nth(1)).toHaveAttribute('data-source', 'web');
  await expect(groups.nth(1).locator('h4')).toContainText('Web search');
  await expect(groups.nth(1).locator('li[data-finding="' + F6 + '"] [data-quote]')).toContainText('12,400 barrels per day');
  await expect(groups.nth(1).locator('li[data-finding="' + F6 + '"] [data-url]')).toHaveText('eprinc.org');
  await expect(groups.nth(2)).toHaveAttribute('data-source', 'gdelt');
  await expect(groups.nth(2).locator('h4')).toContainText('World Monitor · GDELT news');
  await expect(groups.nth(2).locator('h4 .n')).toHaveText('2');
  await expect(groups.nth(3)).toHaveAttribute('data-source', 'company-signals');
  await expect(groups.nth(4)).toHaveAttribute('data-source', 'literature');
  const first = groups.nth(2).locator('li[data-finding]').first();
  await expect(first).toHaveAttribute('data-finding', F1);
  await expect(first.locator('.d')).toHaveText('30 Sept 2026');
  await expect(first.locator('b')).toHaveText('PDVSA restarts Apure production after pipeline repair');
  await expect(first.locator('[data-url]')).toHaveText('reuters.com');
  await expect(first.locator('[data-url]')).toHaveAttribute('href', 'https://www.reuters.com/x/apure');
  await expect(first.locator('[data-query]')).toHaveText('"Guafita" Venezuela');
  await expect(first.locator('[data-quote]')).toContainText('PDVSA restarts Apure production after pipeline repair (Reuters)');
  await expect(panel.locator('#rs-not-reached')).toContainText('Not reached: GDELT news for "La Victoria" Venezuela (time); Literature for Guafita field Venezuela reservoir (time).');
  // [open] shows the record in the panel.
  await first.locator('[data-open]').click();
  const rp = page.locator('#record-panel');
  await expect(rp).toBeVisible();
  await expect(rp).toHaveAttribute('data-ref', 'doc:' + F1);
  await expect(rp.locator('#rp-title')).toHaveText('PDVSA restarts Apure production after pipeline repair');
  await page.locator('#rp-close').click();
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#tab-research')).toContainText('Investigación');
  await expect(groups.nth(2).locator('h4')).toContainText('World Monitor · noticias GDELT');
  await expect(groups.nth(0).locator('h4')).toContainText('Wiki de Global Energy Monitor');
  await expect(btn).toHaveText('Investigar este proyecto');
});

test('W4-AC7: the button queues a run, shows progress while polling, and when the run finishes the status, the tab and the proposals refresh', async ({ page }) => {
  await page.addInitScript(() => { window.HUB_RESEARCH_POLL_MS = 150; });
  let phase = 0;
  const calls = await stubApi(page, {
    research: (route, c) => {
      if (phase === 0) return json(route, { project_id: PID, runs: [], findings: [], enabled: true });
      if (phase === 1) { phase = 2; return json(route, { project_id: PID, runs: [{ id: 8, status: 'running', started_at: new Date(Date.now() - 2 * 60000).toISOString(), finished_at: null, summary: { findings: 1, phase: 'literature' } }], findings: [FINDINGS[0]], enabled: true }); }
      return json(route, { project_id: PID, runs: [RUN_OK], findings: FINDINGS, enabled: true });
    },
    proposals: [],
    onStart: (route) => { phase = 1; return json(route, { project_id: PID, job_id: 8, state: 'queued' }, 202); },
  });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const status = page.locator('#p-research-status'), btn = page.locator('#p-research-btn');
  await expect(status).toHaveText('no research yet');
  await expect(page.locator('#tab-research .n')).toHaveText('0');
  await expect(page.locator('#fld-proposed')).toBeHidden();
  await btn.click();
  expect(calls.started).toBe(1);
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveText('Researching…');
  await expect(status).toContainText('queued · waiting to start');
  await expect(status.locator('.hub-spin')).toHaveCount(1);
  // The poll sees the run going, then finished.
  await expect(status).toContainText('running · 2 min · 1 findings · searching the literature');
  await expect(status).toContainText('last run 1 Oct', { timeout: 5000 });
  await expect(status).toContainText('6 findings · 3 proposals');
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveText('Research this project');
  await expect(page.locator('#tab-research .n')).toHaveText('6');
  await page.locator('#tab-research').click();
  await expect(page.locator('#panel-research li[data-finding]')).toHaveCount(6);
  expect(calls.views).toBeGreaterThanOrEqual(3);
});

test('W4-AC7: a finished run with nothing found says so and lists what each source answered', async ({ page }) => {
  await stubApi(page, { research: { project_id: PID, runs: [{ ...RUN_OK, status: 'ok', summary: { ...RUN_OK.summary, status: 'ok', findings: 0, proposals: { asset: 0, research: 0 }, stopped_by: null, not_reached: [], sources: { gdelt: { queries: 9, findings: 0, created: 0, updated: 0, unchanged: 0 }, literature: { queries: 9, findings: 0, created: 0, updated: 0, unchanged: 0 } } } }], findings: [], enabled: true }, proposals: [] });
  await page.goto('/hub/project.html?id=' + PID + '#research');
  await ready(page);
  await expect(page.locator('#p-research-status')).toContainText('0 findings · 0 proposals');
  await expect(page.locator('#rs-empty')).toContainText('Nothing found this run. The sources below say what was asked and what each answered.');
  await expect(page.locator('#rs-sources li')).toHaveCount(2);
  await expect(page.locator('#rs-sources li[data-source="literature"]')).toContainText('Literature: 9 queries · 0 findings');
});

test('W4-AC7: the Fields card shows research proposals; Set as operator and File as fact accept with apply, Not a fact rejects; a field named in a finding is an ordinary field proposal', async ({ page }) => {
  const calls = await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const block = page.locator('#fld-proposed');
  await expect(block).toBeVisible();
  await expect(block).toContainText('Proposed from documents and research');
  await expect(block.locator('li[data-proposal="20000000-0000-4000-8000-000000000001"]')).toContainText('La Victoria');
  const facts = page.locator('#fld-facts');
  await expect(facts).toContainText('Facts proposed from research');
  await expect(facts.locator('li[data-proposal]')).toHaveCount(2, 'only this project\'s facts');
  const op = facts.locator('li[data-fact-kind="operator"]');
  await expect(op.locator('b')).toHaveText('Operator: PDVSA');
  await expect(op).toContainText('about Guafita');
  await expect(op.locator('[data-quote]')).toContainText('“PDVSA restarts Apure production after pipeline repair” (PDVSA restarts Apure production after pipeline repair)');
  await expect(op.locator('[data-accept-fact]')).toHaveText('Set as operator');
  const prod = facts.locator('li[data-fact-kind="production"]');
  await expect(prod.locator('b')).toHaveText('Production: 12,400 bopd (2026)');
  await expect(prod.locator('[data-accept-fact]')).toHaveText('File as fact');
  // Set as operator: the field row now says PDVSA.
  await op.locator('[data-accept-fact]').click();
  await expect(op).toHaveCount(0);
  expect(calls.decided[0]).toEqual({ id: '20000000-0000-4000-8000-000000000002', verb: 'accept', body: { apply: true } });
  await expect(page.locator('#fld-notices .hub-notice.ok')).toContainText('Operator set: PDVSA.');
  await expect(page.locator('li[data-field="field:ve:guafita"]')).toContainText('PDVSA');
  // Not a fact: rejected, nothing written.
  await prod.locator('[data-reject]').click();
  await expect(prod).toHaveCount(0);
  expect(calls.decided[1]).toEqual({ id: '20000000-0000-4000-8000-000000000003', verb: 'reject', body: {} });
  await expect(page.locator('#fld-notices .hub-notice.ok')).toContainText('Not a fact');
  await expect(facts).toHaveCount(0);
});

test('a location the gazetteers proposed for a field attached by name is decided in the Fields card: Set location gives the field its coordinates and dossier', async ({ page }) => {
  const calls = await stubApi(page, { proposals: [LOCATION], assets: [GUAFITA, OFICINA_NORTE] });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const row = page.locator('#fld-facts li[data-fact-kind="location"]');
  await expect(row.locator('b')).toHaveText('Location for OFICINA NORTE: Oficina (gem) at 8.8778, -64.3669, an area match');
  await expect(row.locator('.hub-src')).toHaveAttribute('data-source', 'gem');
  await expect(row.locator('[data-coords]')).toHaveText('8.8778, -64.3669');
  await expect(row.locator('[data-accept-fact]')).toHaveText('Set location');
  await expect(row.locator('[data-reject]')).toHaveText('Not it');
  await expect(page.locator('li[data-field="field:ve:oficina-norte"]')).toContainText('no location');
  await row.locator('[data-accept-fact]').click();
  await expect(row).toHaveCount(0);
  expect(calls.decided[0]).toEqual({ id: LOCATION.id, verb: 'accept', body: { apply: true } });
  await expect(page.locator('#fld-notices .hub-notice.ok')).toContainText('Location set for OFICINA NORTE.');
  const field = page.locator('li[data-field="field:ve:oficina-norte"]');
  await expect(field.locator('[data-coords]')).toHaveText('8.8778, -64.3669');
  await expect(field.locator('.hub-src')).toHaveAttribute('data-source', 'gem');
  await expect(field.locator('[data-dossier]')).toHaveText('Dossier');
});

test('W4-AC7: the queue page lists research facts with their quote and project; Set as operator accepts with apply; Not a fact rejects', async ({ page }) => {
  const calls = await stubApi(page);
  await page.goto('/hub/queue.html');
  await ready(page);
  const rows = page.locator('#review-list .q-row');
  const op = page.locator('#review-list [data-kind="research"]').first();
  await expect(page.locator('#review-list')).toContainText('Fact from research: Operator: PDVSA');
  const opRow = page.locator('#review-list .q-row', { hasText: 'Operator: PDVSA' });
  await expect(opRow).toContainText('High Tech Electronica');
  await expect(opRow).toContainText('“PDVSA restarts Apure production after pipeline repair”');
  await expect(opRow.locator('[data-action="accept"]')).toHaveText('Set as operator');
  await expect(opRow.locator('[data-action="reject"]')).toHaveText('Not a fact');
  const prodRow = page.locator('#review-list .q-row', { hasText: 'Production: 12,400 bopd (2026)' });
  await expect(prodRow.locator('[data-action="accept"]')).toHaveText('File as fact');
  await opRow.locator('[data-action="accept"]').click();
  await expect(opRow).toHaveCount(0);
  expect(calls.decided[0]).toEqual({ id: '20000000-0000-4000-8000-000000000002', verb: 'accept', body: { apply: true } });
  await prodRow.locator('[data-action="reject"]').click();
  await expect(prodRow).toHaveCount(0);
  expect(calls.decided[1].verb).toBe('reject');
  void rows; void op;
});

test('W4-AC7: an associate who is not a member of a client project sees no button; switched off says so; a Vault without the route hides the tab', async ({ page }) => {
  await stubApi(page, { me: ANA });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('#p-research-btn')).toHaveCount(0);
  await expect(page.locator('#p-research-status')).toContainText('last run');
  await expect(page.locator('#tab-research')).toHaveCount(1);
  // Switched off.
  await stubApi(page, { research: { project_id: PID, runs: [], findings: [], enabled: false } });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('#p-research-btn')).toHaveCount(0);
  await expect(page.locator('#p-research-status')).toHaveText('research runs are switched off');
  // No route (an older Vault): no tab, no button, a plain note.
  await stubApi(page, { research: null });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(page.locator('#tab-research')).toHaveCount(0);
  await expect(page.locator('#p-research-btn')).toHaveCount(0);
  await expect(page.locator('#p-research-status')).toHaveText('research is not available on this Vault');
});

test('W4-AC8: evidence screenshots of the Research tab and the research proposals', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID + '#research');
  await ready(page);
  await expect(page.locator('#panel-research li[data-finding]')).toHaveCount(6);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('#panel-research').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w4-research-tab.png') });
  await page.locator('#fld-proposed').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w4-research-proposals.png') });
});
