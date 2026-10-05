// Wave 7 PR2 (F): one seeded Vault for the cross-page specs (vocabulary, touch), stubbed through page.route
// the way hub-health.spec.mjs seeds: a partner, two client projects and the internal one, a timeline with runs and
// documents, Find hits, default day rates, no mailbox capture, no apps, a cost report, evaluations and scorecards.
// Nothing here talks to a live Vault; the static server serves the pages.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CATALOG = JSON.parse(readFileSync(path.join(ROOT, 'hub/catalog.json'), 'utf8'));
export const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
export const PID = 'llanos-screen';
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const DOC = u(902), RUN = u(911);
const NOW = Date.now(), DAY = 864e5;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const today = new Date().toISOString().slice(0, 10);

export const PROJECTS = [
  { id: PID, client_id: 'frontera', name: 'Llanos waterflood screen', status: 'active', default_legal_tag: 'lt-frontera-nda-2026', asset_ids: [], members: ['chris'], created_at: iso(30 * DAY), closed_at: null,
    contacts: ['john-smith'], country: 'CO', lat: 4.1, lon: -72.9, stage: 'Technical review', stage_history: [{ stage: 'Initial screen', at: iso(30 * DAY), by: 'chris' }, { stage: 'Technical review', at: iso(12 * DAY), by: 'chris' }],
    register: { source: 'Alpha', current: 12, plan: 18, risk: 'amber', risk_score: 48, owner: 'Chris', holder: 'Frontera Energy', next: 'Issue screening letter to Frontera' },
    last_activity_at: iso(2 * 3600e3), run_count: 2, item_count: 2, stale_count: 1 },
  { id: 'talara-redevelopment', client_id: 'petroperu', name: 'Talara redevelopment', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'], created_at: iso(20 * DAY), closed_at: null,
    contacts: [], country: 'PE', lat: -4.6, lon: -81.3, stage: 'Qualified', stage_history: [{ stage: 'Qualified', at: iso(20 * DAY), by: 'chris' }], register: {}, last_activity_at: iso(5 * DAY), run_count: 1, item_count: 2, stale_count: 0 },
  { id: 'firm', client_id: null, name: 'ATC internal', status: 'active', default_legal_tag: 'lt-firm', asset_ids: [], members: [], created_at: iso(300 * DAY), closed_at: null,
    contacts: [], country: null, lat: null, lon: null, stage: 'Initial screen', stage_history: [], register: {}, last_activity_at: iso(300 * DAY), run_count: 0, item_count: 3, stale_count: 0 },
];
const ORGS = [{ id: 'frontera', name: 'Frontera Energy', kind: 'client', country: 'CO' }, { id: 'petroperu', name: 'Petroperú', kind: 'operator', country: 'PE' }];
const cproj = (p) => ({ id: p.id, name: p.name, status: p.status, stage: p.stage, client_id: p.client_id, client_name: p.client_id === 'frontera' ? 'Frontera Energy' : 'Petroperú', lat: p.lat, lon: p.lon, last_run_at: iso(2 * DAY), attention: { stale: p.stale_count, filing: 0, expiring_days: null }, assets: [] });
const COUNTRIES = {
  countries: [
    { code: 'CO', name: { en: 'Colombia', es: 'Colombia' }, projects: [cproj(PROJECTS[0])], counts: { projects: 1, stale: 1, filing: 0, expiring: 0 }, risk: null },
    { code: 'PE', name: { en: 'Peru', es: 'Perú' }, projects: [cproj(PROJECTS[1])], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
  ],
  unplaced: [], generated_at: iso(0), world_monitor: { status: 'not_connected', reason: 'not connected', notes: [] },
};
const REG_TOOL = CATALOG.tools.find((t) => t.id === 'opportunity-register');
const CURRENT = REG_TOOL.aliases.current;
const run = (id, ver, status, msAgo, title) => ({ id, job: 'opportunity-register', tool_version: ver, tool_commit: 'abc1234', author: 'chris', created_at: iso(msAgo), project_id: PID, legal_tag: 'lt-firm', title, status, supersedes: null, inputs: [], outputs: { technical_potential_bopd: { value: 12400, unit: 'bopd' } }, assumptions: {}, params: {}, stale: false, stale_reasons: [] });
export const RUNS = [run(RUN, CURRENT, 'final', 2 * DAY, 'Cubiro screen, base case'), run(u(912), '2.0.0', 'draft', 9 * DAY, 'Cubiro screen, sensitivity A')];
export const PAPER_ITEM = {
  id: DOC, type: 'paper', title: 'Polymer flooding in heavy oil reservoirs of the Llanos basin', created_at: iso(6 * DAY), authored_at: '2021-03-01T00:00:00.000Z', authors: ['A. Gómez', 'B. Ruiz'], client_id: null, project_id: PID, asset_ids: [], legal_tag: 'lt-public',
  origin: { source: 'upload' }, storage_key: 'originals/aa/paper', content_hash: 'sha256:' + 'd'.repeat(64), version: 1, supersedes: null, cites: [], filing: { method: 'tool' }, extracted: {}, stale: false, tags: [], organisation_ids: [], reference_no: null, mime: 'application/pdf',
};
const TIMELINE = [
  ...RUNS.map((r) => ({ kind: 'run', ref: 'run:' + r.id, id: r.id, at: r.created_at, title: r.title, job: r.job, tool_version: r.tool_version, status: r.status, legal_tag: 'lt-firm', stale: r.stale, stale_reasons: r.stale_reasons, supersedes: null, superseded_by: null })),
  { kind: 'item', ref: 'doc:' + DOC, id: DOC, at: PAPER_ITEM.created_at, title: PAPER_ITEM.title, type: 'paper', version: 1, reference_no: null, legal_tag: 'lt-public', stale: false, stale_reasons: [], supersedes: null, superseded_by: null },
];
const CONTACTS = { project_id: PID, client_id: 'frontera', contacts: [{ id: 'john-smith', name: 'John Smith', role: 'Subsurface manager', emails: ['john.smith@frontera.example'], language: 'en', organisation: { id: 'frontera', name: 'Frontera Energy', kind: 'client', counterparty: 'client' }, last_contact: iso(3 * DAY), relationship: null }], counterparties: [] };
export const HITS = [
  { ref: 'doc:' + DOC, item_id: DOC, run_id: null, version: 1, ordinal: 0, anchor: null, project_id: PID, stale: false, authors: ['chris'], legal_tag: 'lt-public', type: 'paper', title: PAPER_ITEM.title, snippet: '## Page 1\nPolymer injection improved sweep by 12 % over waterflood.', date: iso(6 * DAY) },
  { ref: 'run:' + RUN, item_id: null, run_id: RUN, version: 1, ordinal: 0, anchor: null, project_id: PID, stale: false, authors: ['chris'], legal_tag: 'lt-firm', type: 'run', title: 'Cubiro screen, base case', snippet: 'Technical potential 12,400 bopd.', date: iso(2 * DAY) },
];
const DAY_RATES = { key: 'day-rates', value: { rates: { Principal: 13500, Senior: 11000, 'Mid-level': 8000, Junior: 5500 }, swMult: 100, miscMult: 100, dataMult: 100, margin: 0, partners: [{ code: 'MP', name: 'Chris Hopkinson', role: 'Managing Partner', level: 'Principal' }] }, updated_by: null, updated_at: null, defaults: true };
const COST = {
  from: today.slice(0, 8) + '01', to: today, currency: 'USD',
  llm: { calls: 42, tokens_in: 1_100_000, tokens_cached: 200_000, tokens_out: 150_000, cost_usd: 12.5, cache_hit_rate: 0.18, unpriced_calls: 0 },
  features: [{ feature: 'draft', label: 'Drafting', calls: 40, tokens_in: 1_000_000, tokens_cached: 200_000, tokens_out: 140_000, cost_usd: 12, cache_hit_rate: 0.2, budget_usd: 25 }, { feature: 'tool', label: 'Tool assistant', calls: 2, tokens_in: 100_000, tokens_cached: 0, tokens_out: 10_000, cost_usd: 0.5, cache_hit_rate: null, budget_usd: null }],
  weekly: [{ week: today.slice(0, 8) + '01', calls: 20, tokens_in: 1, tokens_cached: 0, tokens_out: 1, cost_usd: 6, by_feature: {} }, { week: today.slice(0, 8) + '08', calls: 22, tokens_in: 1, tokens_cached: 0, tokens_out: 1, cost_usd: 6.5, by_feature: {} }],
  infrastructure: { lines: [{ key: 'render', label: 'Render', plan: 'Web service, starter', usd_month: 7 }, { key: 'supabase', label: 'Supabase', plan: 'Pro', usd_month: 25 }], total_usd: 32, ceiling_usd: 60, source: 'settings', ignored: [] },
  total_usd: 44.5, budgets: { draft: 25 }, budget_month: today.slice(0, 7), alerts: [],
};
const evalRun = (date, f, p) => ({ date, questions: 26, k: 5, thresholds: { faithfulness: 0.85, context_precision: 0.7 }, metrics: { faithfulness: f, context_precision: p, context_recall: 0.9, response_relevancy: 0.6 }, leaks: 0, passed: true });
const RULES = [{ n: 1, id: 'tool-version', name: 'Every final run uses the current tool version' }, { n: 2, id: 'basis-note', name: 'Every evaluation has a basis note' }];
const SCORECARDS = { as_of: iso(0), rules: RULES, summary: { green: 1, amber: 0, red: 0, grey: 0 }, projects: [{ id: PID, name: PROJECTS[0].name, client_id: 'frontera', client_name: 'Frontera Energy', status: 'active', rag: 'green', pass: 2, fail: 0, not_measurable: 0, rules: RULES.map((r) => ({ n: r.n, id: r.id, status: 'pass' })) }] };

const packSection = (section, title, status, builtAgo, headline, sentences, sources) => ({ section, title, version: 1, status, stale_reason: null, built_at: iso(builtAgo), ttl_days: 90, due_at: new Date(NOW - builtAgo + 90 * DAY).toISOString().slice(0, 10), body: { headline, sentences, questions: [], changed_since: [] }, sources });
const PACK_SRC = { id: 'chambers-oil-gas', url: 'https://practiceguides.chambers.com/practice-guides/oil-gas-2026/colombia', licence: 'Chambers and Partners, free to read', attribution: 'Chambers Global Practice Guides, Oil & Gas 2026, Colombia', fetched_at: iso(DAY), item_id: u(930), reachable: true };
export const PACK_CO = {
  country: 'CO', assembled_at: iso(DAY), spend_gbp: 0.9, job: { id: 5, status: 'ok', started_at: iso(DAY) }, counts: { built: 2, fresh: 2, due: 0, stale: 0, unreachable: 0, empty: 8 },
  sections: [
    packSection('legal', { en: 'Legal framework', es: 'Marco legal' }, 'fresh', DAY, { en: 'The ANH awards acreage under the 2003 concession regime.', es: 'La ANH adjudica áreas bajo el régimen de concesión de 2003.' }, [{ en: 'The ANH awards acreage under the 2003 concession regime.', es: 'La ANH adjudica áreas bajo el régimen de concesión de 2003.', cites: ['doc:' + u(930)] }], [PACK_SRC]),
    packSection('fiscal', { en: 'Fiscal terms', es: 'Términos fiscales' }, 'fresh', DAY, { en: 'Royalty 8 to 25 % on a sliding scale by production.', es: 'Regalía del 8 al 25 % en escala móvil según la producción.' }, [{ en: 'Royalty runs from 8 to 25 % on a sliding scale by production.', es: 'La regalía va del 8 al 25 % en escala móvil según la producción.', cites: ['doc:' + u(930)] }], [PACK_SRC]),
  ],
};

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Seed every route the Hub pages ask for. Returns the log of requests that were answered 404. */
export async function seedHub(page) {
  const log = { notFound: [] };
  await page.route('**/api/**', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    const rs = /^\/api\/tools\/([^/]+)\/resolve$/.exec(p);
    if (rs) { const t = CATALOG.tools.find((x) => x.id === rs[1]); return t ? json(route, { id: t.id, version: t.aliases.current, entry: t.entry }) : json(route, { error: { code: 'not_found', message: 'no tool' } }, 404); }
    if (p === '/api/projects') return json(route, { projects: PROJECTS });
    if (p === '/api/clients') return json(route, { clients: [{ id: 'frontera', name: 'Frontera Energy', project_ids: [PID] }] });
    if (p === '/api/organisations') return json(route, { organisations: ORGS });
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (/^\/api\/countries\/[A-Z]{2}\/intel$/.test(p)) return json(route, { country: p.split('/')[3], name: { en: 'Country', es: 'País' }, world_monitor: { status: 'not_connected', reason: 'not connected' }, sections: {} });
    // Wave 7 PR5 (W7-AC19): Colombia has a pack with two sections drafted, so the project page shows the card and its rows; the rest never built.
    if (/^\/api\/countries\/[A-Z]{2}\/pack$/.test(p)) return json(route, p.split('/')[3] === 'CO' ? PACK_CO : { country: p.split('/')[3], assembled_at: null, sections: [], counts: { built: 0, fresh: 0, due: 0, stale: 0, unreachable: 0, empty: 10 }, job: null, spend_gbp: 0 });
    if (p === '/api/me/mailbox') return json(route, { prompt: false, connected: false, configured: false });
    if (p === '/api/me/activity') return json(route, { since: iso(DAY), counts: { records: 0 }, projects: [], brief_available: false });
    if (p === '/api/me/connections') return json(route, { connections: [] });
    if (p.startsWith('/api/queue')) return json(route, { items: [], count: 0 });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    if (p === '/api/runs') return json(route, { runs: RUNS });
    if (p === '/api/runs/' + RUN) return json(route, RUNS[0]);
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/items/' + DOC) return json(route, PAPER_ITEM);
    if (/^\/api\/items\/[^/]+\/versions$/.test(p)) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/projects/' + PID) return json(route, PROJECTS[0]);
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length, entries: TIMELINE });
    if (p === '/api/projects/' + PID + '/contacts') return json(route, CONTACTS);
    if (p === '/api/projects/' + PID + '/research') return json(route, { enabled: false, findings: [], runs: [] });
    if (p.startsWith('/api/projects/' + PID + '/')) return json(route, { project_id: PID, assets: [], vintages: [], nodes: [], edges: [], runs: [], items: [], lessons: [], rules: [], findings: [], enabled: false });
    if (p === '/api/organisations/frontera') return json(route, { ...ORGS[0], contacts: [] });
    if (p === '/api/organisations/frontera/file') return json(route, { organisation: ORGS[0], contracts_in_force: [], dispatches: [] });
    if (p === '/api/search') return json(route, { hits: HITS, scope: url.searchParams.get('scope'), took_ms: 3 });
    if (p === '/api/search/people') return json(route, { people: [{ person_id: 'chris', name: 'Chris Hopkinson', role: 'partner', last_at: iso(2 * DAY), count: 2, refs: [] }] });
    if (p === '/api/settings/day-rates') return m === 'GET' ? json(route, DAY_RATES) : json(route, { ...DAY_RATES, value: JSON.parse(req.postData() || '{}').value, defaults: undefined });
    if (p === '/api/cost') return json(route, COST);
    if (p === '/api/eval/results') return json(route, { results: [evalRun('2026-09-15', 0.92, 0.76), evalRun('2026-09-29', 0.94, 0.78)] });
    if (p === '/api/scorecards') return json(route, SCORECARDS);
    if (p === '/api/analogues') return json(route, { rows: [], scope: url.searchParams.get('scope') });
    log.notFound.push(m + ' ' + p);
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return log;
}

/** The Hub pages, with the address each spec opens and whether the page sets data-ready. */
export const PAGES = {
  today: { url: '/hub/index.html', owner: 'E' },
  project: { url: '/hub/project.html?id=' + PID, owner: 'D' },
  queue: { url: '/hub/queue.html', owner: 'E' },
  find: { url: '/hub/search.html?q=polymer&scope=project:' + PID, owner: 'F' },
  settings: { url: '/hub/settings.html', owner: 'F' },
  cost: { url: '/hub/cost.html', owner: 'F' },
  analogues: { url: '/hub/analogues.html', owner: 'F' },
  tool: { url: '/hub/tool.html?id=opportunity-register', owner: 'F' },
};

export const ready = (page) => page.locator('body[data-ready="1"]').waitFor({ timeout: 15000 });
