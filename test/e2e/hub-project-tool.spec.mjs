// M07: the Hub project page (hub/project.html?id=) and tool page (hub/tool.html?id=).
// The API is stubbed with page.route; the static server serves the pages. Seed data mirrors
// the AC15 fixture (vault/test/fixtures/ac15/seed.json): its organisation, contacts, legal tag,
// NDA and dispatches, with a Llanos project whose 12 timeline records, 3 vintages and lineage
// are defined below. Expected numbers are calculated by hand in comments, not by the code under test.
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SEED = JSON.parse(readFileSync(path.join(ROOT, 'vault/test/fixtures/ac15/seed.json'), 'utf8'));
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };

const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'llanos-waterflood';
const TOOL_ID = 'opportunity-register';

/* ── seed: the Llanos project ─────────────────────────────────────────── */

const ORG = { ...SEED.organisation, contacts: SEED.contacts };
const PROJECT = {
  id: PID, client_id: SEED.organisation.id, name: 'Llanos Basin waterflood screening', status: 'active',
  default_legal_tag: SEED.legal_tag.id, asset_ids: ['basin:llanos', 'field:llanos:cubiro'], members: ['chris', 'geoscience'],
  created_at: '2026-06-02T09:00:00.000Z', closed_at: null, contacts: ['maria-fernandez'],
};

const R = { v1: u(101), v2: u(102), v3: u(103), yopal: u(104) };
const I = { basis: u(61), letterOut: u(56), sheet: u(62), paper: u(63), invoice: u(64), emailIn: u(51), emailOut: u(54), engagement: u(53) };
const NDA_LETTER = SEED.nda_item;

const runEntry = (id, at, title, ver, status, extra = {}) => ({
  kind: 'run', ref: 'run:' + id, id, at, title, job: TOOL_ID, tool_version: ver, status, legal_tag: SEED.legal_tag.id,
  stale: false, stale_reasons: [], supersedes: null, superseded_by: null, ...extra,
});
const itemEntry = (id, at, type, title, extra = {}) => ({
  kind: 'item', ref: 'doc:' + id, id, at, title, type, version: 1, reference_no: null, legal_tag: SEED.legal_tag.id,
  stale: false, stale_reasons: [], supersedes: null, superseded_by: null, ...extra,
});
const CITES_SUPERSEDED = [{ rule: 'CITES', ref: 'run:' + R.v2, detail: 'cited run superseded' }];

// 12 records of mixed types; `expected` is what the page must show for each: icon and stale state.
const TIMELINE = [
  runEntry(R.v3, '2026-09-28T14:12:00.000Z', 'Cubiro waterflood – base (re-run on 2.1.0)', '2.1.0', 'reviewed', { supersedes: R.v2 }),
  itemEntry(I.emailIn, '2026-09-25T11:04:00.000Z', 'email', 'RE: Cubiro water injection data request'),
  runEntry(R.yopal, '2026-09-19T15:30:00.000Z', 'Yopal sector sensitivity, injector spacing 20 / 30 / 40 acres', '2.0.0', 'reviewed',
    { stale: true, stale_reasons: [{ rule: 'R3', ref: 'ref:fiscal_terms/CO-2025', detail: 'input item superseded' }, { rule: 'R2', ref: 'run:' + R.v2, detail: 'input run superseded' }] }),
  itemEntry(I.letterOut, '2026-09-17T16:45:00.000Z', 'letter', 'Letter ATC-2026-0139 to Petrolera del Orinoco: interim results, Cubiro waterflood screening',
    { reference_no: 'ATC-2026-0139', stale: true, stale_reasons: CITES_SUPERSEDED }),
  itemEntry(I.sheet, '2026-09-15T10:20:00.000Z', 'spreadsheet', 'Cubiro_injectors_layout_v4.xlsx'),
  itemEntry(I.paper, '2026-09-10T13:12:00.000Z', 'paper', 'Waterflood performance and voidage management in Llanos Basin Cretaceous sandstones'),
  itemEntry(I.invoice, '2026-08-27T12:00:00.000Z', 'invoice', 'Invoice INV-2026-0061: milestone 2, interim evaluation', { reference_no: 'INV-2026-0061' }),
  itemEntry(I.basis, '2026-08-19T17:05:00.000Z', 'note', 'Basis note BN-LLA-02: interim evaluation, vintage 2', { stale: true, stale_reasons: CITES_SUPERSEDED }),
  itemEntry(I.emailOut, '2026-08-04T09:33:00.000Z', 'email', 'Data request list for Cubiro and Yopal sectors'),
  runEntry(R.v2, '2026-06-24T16:20:00.000Z', 'Cubiro waterflood – base (vintage 2)', '2.0.0', 'superseded', { supersedes: R.v1, superseded_by: R.v3 }),
  itemEntry(I.engagement, '2026-06-02T11:00:00.000Z', 'letter', 'Engagement letter EL-2026-014, signed both sides', { reference_no: 'ATC-2026-0103' }),
  runEntry(R.v1, '2026-03-18T15:02:00.000Z', 'Cubiro waterflood – base (vintage 1, pre-engagement screening)', '1.2.0', 'superseded', { superseded_by: R.v2 }),
];
const EXPECT_ICON = {
  [R.v3]: 'run', [I.emailIn]: 'email', [R.yopal]: 'run', [I.letterOut]: 'letter', [I.sheet]: 'spreadsheet', [I.paper]: 'paper',
  [I.invoice]: 'invoice', [I.basis]: 'note', [I.emailOut]: 'email', [R.v2]: 'run', [I.engagement]: 'letter', [R.v1]: 'run',
};
const EXPECT_STALE = new Set([R.yopal, I.letterOut, I.basis]);
const TL_SORTED = TIMELINE.slice().sort((a, b) => (a.at < b.at ? 1 : -1));

// Three vintages of one job. Headline outputs by hand:
//   vintage 1 (1.2.0)            1P 8.4   2P 14.1  3P 21.9  NPV10 142.7  RF 0.18
//   vintage 2 (2.0.0, breaking)  1P 9.6   2P 16.2  3P 24.8  NPV10 186.4  RF 0.21
//   vintage 3 (2.1.0)            1P 9.4   2P 16.0  3P 24.1  NPV10 171.1  RF 0.20
const out = (p1, p2, p3, npv, rf, method) => ({
  '1P': { value: p1, unit: 'MMbbl' }, '2P': { value: p2, unit: 'MMbbl' }, '3P': { value: p3, unit: 'MMbbl' },
  NPV10: { value: npv, unit: 'USD MM' }, RF: { value: rf }, method: { value: method },
});
const M1 = 'Analogue recovery factor on OOIP', M2 = 'Decline analysis plus material balance';
const OUT1 = out(8.4, 14.1, 21.9, 142.7, 0.18, M1), OUT2 = out(9.6, 16.2, 24.8, 186.4, 0.21, M2), OUT3 = out(9.4, 16.0, 24.1, 171.1, 0.2, M2);
// Deltas as the API returns them (delta_pct rounded to 2 dp), each worked out by hand.
const d = (previous, current, delta, delta_pct) => ({ previous, current, delta, delta_pct });
const DELTAS2 = {   // vintage 2 vs 1: +1.2/8.4 = 14.29 %, +2.1/14.1 = 14.89 %, +2.9/21.9 = 13.24 %, +43.7/142.7 = 30.62 %, +0.03/0.18 = 16.67 %
  '1P': d(8.4, 9.6, 1.2, 14.29), '2P': d(14.1, 16.2, 2.1, 14.89), '3P': d(21.9, 24.8, 2.9, 13.24), NPV10: d(142.7, 186.4, 43.7, 30.62), RF: d(0.18, 0.21, 0.03, 16.67),
  method: d(M1, M2, null, null),
};
const DELTAS3 = {   // vintage 3 vs 2: -0.2/9.6 = -2.08 %, -0.2/16.2 = -1.23 %, -0.7/24.8 = -2.82 %, -15.3/186.4 = -8.21 %, -0.01/0.21 = -4.76 %
  '1P': d(9.6, 9.4, -0.2, -2.08), '2P': d(16.2, 16.0, -0.2, -1.23), '3P': d(24.8, 24.1, -0.7, -2.82), NPV10: d(186.4, 171.1, -15.3, -8.21), RF: d(0.21, 0.2, -0.01, -4.76),
};
const vint = (id, at, ver, title, status, outputs, deltas, prev, sup) => ({
  run_id: id, ref: 'run:' + id, job: TOOL_ID, tool_version: ver, title, created_at: at, status, superseded: status === 'superseded',
  supersedes: sup, previous_run_id: prev, outputs, deltas,
});
const VINTAGES = [
  vint(R.v3, '2026-09-28T14:12:00.000Z', '2.1.0', 'Cubiro waterflood – base (re-run on 2.1.0)', 'reviewed', OUT3, DELTAS3, R.v2, R.v2),
  vint(R.v2, '2026-06-24T16:20:00.000Z', '2.0.0', 'Cubiro waterflood – base (vintage 2)', 'superseded', OUT2, DELTAS2, R.v1, R.v1),
  vint(R.v1, '2026-03-18T15:02:00.000Z', '1.2.0', 'Cubiro waterflood – base (vintage 1, pre-engagement screening)', 'superseded', OUT1, {}, null, null),
];
const HAND_DELTA_TEXT = {
  2: '1P +14.3% · 2P +14.9% · 3P +13.2% · NPV10 +30.6% · RF +16.7%',
  3: '1P −2.1% · 2P −1.2% · 3P −2.8% · NPV10 −8.2% · RF −4.8%',
};

// Lineage of ~12 nodes: reference sets and documents -> runs -> documents.
const node = (id, kind, label, extra = {}) => ({ id, kind, label, project_id: PID, stale: false, ...extra });
const LINEAGE = {
  project_id: PID,
  nodes: [
    node('ref:fiscal_terms/CO-2025', 'reference', 'fiscal_terms/CO-2025'),
    node('ref:fiscal_terms/CO-2026', 'reference', 'fiscal_terms/CO-2026'),
    node('ref:price_decks/brent-2026-06', 'reference', 'price_decks/brent-2026-06'),
    node('doc:' + I.sheet, 'item', 'Cubiro_injectors_layout_v4.xlsx', { type: 'spreadsheet' }),
    node('doc:' + I.paper, 'item', 'Waterflood performance and voidage management…', { type: 'paper' }),
    { id: 'doc:' + u(99), kind: 'item', restricted: true },
    node('run:' + R.v1, 'run', 'Cubiro waterflood – base (vintage 1)', { job: TOOL_ID, status: 'superseded' }),
    node('run:' + R.v2, 'run', 'Cubiro waterflood – base (vintage 2)', { job: TOOL_ID, status: 'superseded' }),
    node('run:' + R.v3, 'run', 'Cubiro waterflood – base (re-run on 2.1.0)', { job: TOOL_ID, status: 'reviewed' }),
    node('run:' + R.yopal, 'run', 'Yopal sector sensitivity', { job: TOOL_ID, status: 'reviewed', stale: true }),
    node('doc:' + I.basis, 'item', 'Basis note BN-LLA-02', { type: 'note', stale: true }),
    node('doc:' + I.letterOut, 'item', 'Letter ATC-2026-0139', { type: 'letter', stale: true }),
  ],
  edges: [
    { from: 'ref:price_decks/brent-2026-06', to: 'run:' + R.v1, type: 'input', role: 'price_deck' },
    { from: 'ref:price_decks/brent-2026-06', to: 'run:' + R.v2, type: 'input', role: 'price_deck' },
    { from: 'ref:price_decks/brent-2026-06', to: 'run:' + R.v3, type: 'input', role: 'price_deck' },
    { from: 'ref:fiscal_terms/CO-2025', to: 'run:' + R.v2, type: 'input' },
    { from: 'ref:fiscal_terms/CO-2025', to: 'run:' + R.yopal, type: 'input' },
    { from: 'ref:fiscal_terms/CO-2026', to: 'run:' + R.v3, type: 'input' },
    { from: 'doc:' + I.sheet, to: 'run:' + R.v2, type: 'input' },
    { from: 'doc:' + I.sheet, to: 'run:' + R.v3, type: 'input' },
    { from: 'doc:' + I.paper, to: 'run:' + R.v2, type: 'input' },
    { from: 'doc:' + u(99), to: 'run:' + R.v3, type: 'input' },
    { from: 'run:' + R.v1, to: 'run:' + R.v2, type: 'parent' },
    { from: 'run:' + R.v2, to: 'run:' + R.v3, type: 'parent' },
    { from: 'run:' + R.v2, to: 'run:' + R.v1, type: 'supersedes' },
    { from: 'run:' + R.v3, to: 'run:' + R.v2, type: 'supersedes' },
    { from: 'run:' + R.v2, to: 'doc:' + I.basis, type: 'cites' },
    { from: 'run:' + R.v2, to: 'doc:' + I.letterOut, type: 'cites' },
    { from: 'run:' + R.yopal, to: 'doc:' + I.letterOut, type: 'cites' },
  ],
};

// Run records (GET /api/runs): assumptions feed scorecard rule 2, tool_commit rule 1.
const rec = (id, project_id, title, ver, commit, status, at, extra = {}) => ({
  id, job: TOOL_ID, tool_version: ver, tool_commit: commit, author: 'chris', created_at: at, project_id, title, status, inputs: [], params: {}, outputs: {}, assumptions: {}, ...extra,
});
const RUNS = [
  rec(R.v3, PID, TIMELINE[0].title, '2.1.0', '3fa9c1e', 'reviewed', '2026-09-28T14:12:00Z', {
    outputs: OUT3,
    assumptions: {
      opex_usd_bbl: { value: 11.2, unit: 'USD/bbl', source: 'client-stated', provenance: 'client-stated' },
      kh_md: { value: 320, unit: 'mD', source: 'doc:' + I.sheet, provenance: 'measured' },
      voidage_replacement: { value: 1, source: 'analogue', provenance: 'assumed' },
    },
  }),
  rec(R.yopal, PID, 'Yopal sector sensitivity, injector spacing 20 / 30 / 40 acres', '2.0.0', 'b71d0a4', 'reviewed', '2026-09-19T15:30:00Z', {
    assumptions: { aquifer_strength: { value: 'moderate', source: 'analogue', provenance: 'analogue' } },
  }),
  rec(u(114), 'middle-magdalena', 'Magdalena infill: high price', '2.1.0', '3fa9c1e', 'reviewed', '2026-09-18T10:00:00Z'),
  rec(u(113), 'middle-magdalena', 'Magdalena infill: low price', '2.1.0', '3fa9c1e', 'draft', '2026-09-18T09:00:00Z'),
  rec(u(112), 'middle-magdalena', 'Magdalena infill: base case', '2.0.0', 'b71d0a4', 'reviewed', '2026-09-17T09:00:00Z'),
  rec(u(111), 'middle-magdalena', 'Magdalena infill: base case, rerun', '2.0.0', 'b71d0a4', 'draft', '2026-09-16T09:00:00Z'),
  rec(R.v2, PID, 'Cubiro waterflood – base (vintage 2)', '2.0.0', 'b71d0a4', 'superseded', '2026-06-24T16:20:00Z', { outputs: OUT2 }),
  rec(u(115), 'reconcavo', 'Recôncavo field ranking (legacy)', '1.2.0', '9c4e2d8', 'reviewed', '2026-03-11T09:00:00Z'),
  rec(R.v1, PID, 'Cubiro waterflood – base (vintage 1, pre-engagement screening)', '1.2.0', '9c4e2d8', 'superseded', '2026-03-18T15:02:00Z', { outputs: OUT1 }),
];
// Active (not superseded) runs per version: 2.1.0 has V3 + 2 Magdalena = 3; 2.0.0 has Yopal + 2 Magdalena = 3 (vintage 2 is superseded); 1.2.0 has 1 (vintage 1 is superseded).

const BASIS_ITEMS = [
  { id: I.basis, type: 'note', title: 'Basis note BN-LLA-02: interim evaluation, vintage 2', authored_at: '2026-08-19T17:05:00Z', reference_no: 'BN-LLA-02', version: 1, cites: ['run:' + R.v2, 'ref:fiscal_terms/CO-2025'], extracted: { kind: 'basis' }, stale: true },
  { id: u(65), type: 'note', title: 'Call note with Frontera about injector capacity', authored_at: '2026-09-25T12:00:00Z', version: 1, cites: [], extracted: {}, stale: false },
  { id: u(66), type: 'note', title: 'Delta memo, fiscal terms CO-2026', authored_at: '2026-09-01T16:00:00Z', version: 1, cites: ['ref:fiscal_terms/CO-2026'], extracted: { kind: 'basis' }, stale: false },
];
const LESSONS = [
  { id: u(201), claim: 'Cubiro injection is limited by CPF water handling at 8,500 bwpd; voidage replacement above that is not physical.', scope: 'project', scope_id: PID, status: 'confirmed', confidence: 0.9, evidence: ['email 2026-09-25', 'run:' + R.v3] },
  { id: u(202), claim: 'Test aquifer strength before assuming voidage replacement of 1.0 in a waterflood screening.', scope: 'discipline', status: 'proposed', confidence: 0.82, evidence: ['run:' + R.v2] },
];

const ORG_FILE = {
  organisation: SEED.organisation, contacts: SEED.contacts,
  contracts_in_force: [{ item_id: NDA_LETTER.id, type: 'nda', title: NDA_LETTER.title, reference_no: NDA_LETTER.reference_no, effective_date: '2026-02-14', expiry: '2028-02-13', parties: NDA_LETTER.extracted.parties, legal_tag: 'lt-firm', project_id: 'orinoco-partnership' }],
  // The two outbound letters of this project, with the acknowledgement dates of the AC15 dispatches.
  dispatches: [
    { ...SEED.dispatches[2], item_id: I.engagement, occurred_at: '2026-06-02T11:00:00.000Z', acknowledged_at: '2026-06-03T09:00:00.000Z', item: { id: I.engagement, title: TIMELINE[10].title, type: 'letter' } },
    { ...SEED.dispatches[5], item_id: I.letterOut, occurred_at: '2026-09-17T16:45:00.000Z', acknowledged_at: '2026-09-18T08:30:00.000Z', item: { id: I.letterOut, title: TIMELINE[3].title, type: 'letter' } },
  ],
  projects: [], open_invoices: [], generated_at: '2026-09-29T10:00:00.000Z',
};

/* ── seed: the tool ───────────────────────────────────────────────────── */

const TOOL = {
  id: TOOL_ID, name: 'Opportunity Register', description: 'Screens upstream opportunities, calculates technical potential and NPV10 per opportunity, and saves every calculation to the Vault as a Run.',
  owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry: 'opportunity-register.html', changelog: 'tools/opportunity-register/CHANGELOG.md',
  produces: ['technical_potential_bopd', 'npv10', 'irr'], consumes: ['price_deck', 'fiscal_terms'],
  versions: [   // deliberately not in order: the page must sort them
    { version: '2.0.0', released_at: '2026-06-09', commit: 'b71d0a4', status: 'deprecated', modules: ['js/potential.js', 'js/lifting.js'], breaking: true },
    { version: '2.1.0', released_at: '2026-09-22', commit: '3fa9c1e', status: 'approved', modules: ['js/potential.js', 'js/fiscal.js'], notes: 'Voidage capped at injector capacity; fiscal engine reads CO-2026 terms' },
    { version: '1.2.0', released_at: '2026-02-03', commit: '9c4e2d8', status: 'approved', modules: ['js/analogues.js'] },
  ],
  aliases: { current: '2.1.0', previous: '2.0.0' },
  releases: [
    { version: 'Unreleased', date: '', sections: {} },
    { version: '2.1.0', date: '2026-09-22', sections: { Changed: ['Voidage replacement is capped at the stated injector capacity.'], Fixed: ['Break-even price ignored the abandonment provision.'] } },
    { version: '2.0.0', date: '2026-06-09', sections: { Changed: ['BREAKING: lifting cost now depends on water cut. Runs made on 1.x are not comparable.'] } },
    { version: '1.2.0', date: '2026-02-03', sections: { Added: ['Analogue table extended to 14 plays.'] } },
  ],
};
const CATALOG = { tools: [TOOL], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

/* ── seed: a generated project with a 200-node lineage ───────────────── */

function generatedLineage(total = 200) {
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const nRef = 30, nRun = 60, nDoc = total - nRef - nRun;
  const nodes = [], edges = [];
  const refs = Array.from({ length: nRef }, (_, i) => 'ref:set/' + i);
  const runs = Array.from({ length: nRun }, (_, i) => 'run:' + u(1000 + i));
  const docs = Array.from({ length: nDoc }, (_, i) => 'doc:' + u(2000 + i));
  refs.forEach((id, i) => nodes.push({ id, kind: 'reference', label: id.slice(4) }));
  runs.forEach((id, i) => nodes.push({ id, kind: 'run', label: 'Generated run number ' + i + ' with a fairly long title that must be clipped', job: TOOL_ID, status: i % 9 === 0 ? 'superseded' : 'final', stale: i % 7 === 0 }));
  docs.forEach((id, i) => nodes.push({ id, kind: 'item', label: 'Document ' + i, type: ['letter', 'note', 'email', 'spreadsheet'][i % 4], stale: i % 11 === 0 }));
  runs.forEach((id, i) => {
    for (let k = 0; k < 2 + (i % 2); k++) edges.push({ from: refs[Math.floor(rnd() * nRef)], to: id, type: 'input' });
    if (i > 0 && rnd() < 0.3) edges.push({ from: runs[Math.floor(rnd() * i)], to: id, type: 'parent' });
    if (i % 10 === 5) edges.push({ from: id, to: runs[i - 1], type: 'supersedes' });
  });
  docs.forEach((id, i) => {
    edges.push({ from: runs[Math.floor(rnd() * nRun)], to: id, type: 'cites' });
    if (i % 5 === 0) edges.push({ from: runs[Math.floor(rnd() * nRun)], to: id, type: 'cites' });
    if (i % 8 === 0 && i > 0) edges.push({ from: docs[Math.floor(rnd() * i)], to: id, type: 'cites' });
  });
  edges.push({ from: runs[3], to: runs[4], type: 'parent' }, { from: runs[4], to: runs[3], type: 'parent' });   // a deliberate cycle
  return { project_id: 'gen-200', nodes, edges };
}
const GEN = generatedLineage();

/* ── the stub ─────────────────────────────────────────────────────────── */

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route, status, code, message) => json(route, { error: { code, message } }, status);

/** Stub /api/**. `over` maps a pathname to (url, route) => ... and wins over the defaults; a value of null answers 404. */
async function stubApi(page, over = {}) {
  const seen = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    seen.push(p + url.search);
    if (p in over) return over[p] === null ? err(route, 404, 'not_found', 'no route') : over[p](url, route);
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects') return json(route, { projects: [PROJECT, { id: 'middle-magdalena', name: 'Middle Magdalena infill screening' }, { id: 'reconcavo', name: 'Recôncavo late-life economics' }] });
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length, entries: TL_SORTED });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: VINTAGES });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, LINEAGE);
    if (p === '/api/projects/gen-200') return json(route, { id: 'gen-200', client_id: null, name: 'Generated lineage, 200 nodes', status: 'active', default_legal_tag: 'lt-firm', asset_ids: [], members: [], created_at: '2026-09-01T00:00:00.000Z', contacts: [] });
    if (p === '/api/projects/gen-200/timeline') return json(route, { project_id: 'gen-200', count: 0, entries: [] });
    if (p === '/api/projects/gen-200/vintages') return json(route, { project_id: 'gen-200', vintages: [] });
    if (p === '/api/projects/gen-200/lineage') return json(route, GEN);
    if (p === '/api/organisations/' + ORG.id) return json(route, ORG);
    if (p === '/api/organisations/' + ORG.id + '/file') return json(route, ORG_FILE);
    if (p === '/api/items') return json(route, { items: BASIS_ITEMS });
    if (p === '/api/lessons') return json(route, { lessons: LESSONS });
    if (p === '/api/runs') {
      const proj = url.searchParams.get('project'), job = url.searchParams.get('job');
      return json(route, { runs: RUNS.filter((r) => (!proj || r.project_id === proj) && (!job || r.job === job)) });
    }
    const one = p.match(/^\/api\/runs\/([0-9a-f-]{36})$/);
    if (one) { const r = RUNS.find((x) => x.id === one[1]); return r ? json(route, r) : err(route, 404, 'not_found', 'run not found'); }
    const item = p.match(/^\/api\/items\/([0-9a-f-]{36})$/);
    if (item) { const it = BASIS_ITEMS.find((x) => x.id === item[1]); return it ? json(route, it) : err(route, 404, 'not_found', 'item not found'); }
    if (p.match(/^\/api\/tools\/[^/]+\/resolve$/)) return json(route, { entry: 'opportunity-register.html', modules: ['js/potential.js'], version: '2.1.0', commit: '3fa9c1e' });
    return err(route, 404, 'not_found', 'no route');
  });
  return seen;
}

const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const openProject = async (page, over, query = 'id=' + PID) => { const seen = await stubApi(page, over); await page.goto('/hub/project.html?' + query); await ready(page); return seen; };
const openTool = async (page, over, id = TOOL_ID) => { const seen = await stubApi(page, over); await page.goto('/hub/tool.html?id=' + id); await ready(page); return seen; };
const tab = (page, key) => page.locator('#tab-' + key);
const gotoTab = async (page, key) => { await tab(page, key).click(); await expect(page.locator('#panel-' + key)).toBeVisible(); };

/* ── project page ─────────────────────────────────────────────────────── */

test('project: header shows client, legal tag and expiry, contacts, assets and status', async ({ page }) => {
  await openProject(page);
  await expect(page.locator('h1')).toHaveText('Llanos Basin waterflood screening');
  await expect(page.locator('#p-sub')).toContainText('Client Petrolera del Orinoco S.A.');
  await expect(page.locator('#p-sub [data-status="active"]')).toHaveText('Active');
  const card = page.locator('#p-file');
  await expect(card.locator('[data-legal-tag]')).toHaveText('lt-orinoco-nda-2026');
  await expect(card.locator('[data-expiry]')).toHaveAttribute('data-expiry', '2028-02-13');      // the AC15 NDA expiry
  await expect(card.locator('[data-expiry]')).toContainText('expires 2028-02-13');
  await expect(card.locator('[data-contact="maria-fernandez"]')).toContainText('Ing. María Fernández');
  await expect(card.locator('[data-contact="maria-fernandez"]')).toContainText('mfernandez@petroleradelorinoco.com');
  await expect(card.locator('[data-contact]')).toHaveCount(1);          // only the contact attached to the project
  await expect(card.locator('.hub-asset')).toContainText(['basin:llanos', 'field:llanos:cubiro']);
  await expect(card.locator('[data-member]')).toHaveCount(2);
  await expect(page).toHaveTitle(/Llanos Basin waterflood screening/);
  // the sidebar carries the open page's link only here
  await expect(page.locator('.hub-nav a[aria-current="page"]')).toHaveText('Project file');
  await expect(page.locator('.hub-nav a', { hasText: 'Tool page' })).toHaveCount(0);
  // KPIs: latest NPV10 171.1 (-8.2 % vs vintage 2), 4 active runs... 2 superseded, 3 stale, scorecard 4/6
  await expect(page.locator('[data-kpi="NPV10"]')).toContainText('171.1');
  await expect(page.locator('[data-kpi="NPV10"]')).toContainText('−8.2% vs vintage 2');
  await expect(page.locator('[data-kpi="2P"]')).toContainText('16');
  await expect(page.locator('.hub-kpi', { hasText: 'Active runs' })).toContainText('2 superseded');
  await expect(page.locator('.hub-kpi', { hasText: 'Stale records' })).toContainText('3');
  await expect(page.locator('.hub-kpi', { hasText: 'Scorecard' })).toContainText('4/6');
});

test('AC1: the timeline shows every seeded record exactly once, newest first, with the right icon and stale state', async ({ page }) => {
  await openProject(page);
  const rows = page.locator('.hub-tl-item');
  await expect(rows).toHaveCount(12);
  for (const e of TIMELINE) {
    const row = page.locator(`.hub-tl-item[data-ref="${e.ref}"]`);
    await expect(row, e.title).toHaveCount(1);
    await expect(row).toHaveAttribute('data-icon', EXPECT_ICON[e.id]);
    await expect(row.locator('.hub-tl-ico')).toHaveAttribute('data-icon', EXPECT_ICON[e.id]);
    await expect(row).toHaveAttribute('data-stale', String(EXPECT_STALE.has(e.id)));
    await expect(row.locator('.hub-tl-title')).toHaveText(e.title);
    await expect(row.locator('stale-badge')).toHaveCount(EXPECT_STALE.has(e.id) ? 1 : 0);
    await expect(row.locator('.hub-tl-why')).toHaveCount(EXPECT_STALE.has(e.id) ? 1 : 0);
  }
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-ref')))).toEqual(TL_SORTED.map((e) => e.ref));
  await expect(page.locator('.hub-tl-count')).toHaveText('12 of 12 records · newest first');

  // The badge carries the first stale reason on hover, and the same text is inline.
  const yopal = page.locator(`.hub-tl-item[data-ref="run:${R.yopal}"]`);
  await expect(yopal.locator('.hub-stale')).toHaveAttribute('title', 'input item superseded');
  await expect(yopal.locator('.hub-tl-why')).toContainText('Stale: input item superseded');
  await expect(yopal.locator('.hub-tl-why')).toContainText('+1 more');
  const letter = page.locator(`.hub-tl-item[data-ref="doc:${I.letterOut}"]`);
  await expect(letter.locator('.hub-stale')).toHaveAttribute('title', 'cited run superseded');
  await expect(letter).toContainText('ATC-2026-0139');
  // run status pills
  await expect(page.locator(`.hub-tl-item[data-ref="run:${R.v2}"] [data-status="superseded"]`)).toHaveText('Superseded');
  await expect(page.locator('#tl stale-badge')).toHaveCount(3);
});

test('timeline filters by type and by stale', async ({ page }) => {
  await openProject(page);
  const count = async (label, n, names) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.hub-tl-item'), label).toHaveCount(n);
    if (names) expect(await page.locator('.hub-tl-item').evaluateAll((els) => els.map((el) => el.getAttribute('data-icon')))).toEqual(names);
  };
  await count('Runs', 4);
  await count('Letters', 2, ['letter', 'letter']);
  await count('Emails', 2, ['email', 'email']);
  await count('Spreadsheets', 1);
  await count('Papers', 1);
  await count('Invoices', 1);
  await count('Other', 1, ['note']);
  await count('Stale only', 3);
  await expect(page.locator('.hub-tl-item[data-stale="false"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stale only' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hub-tl-count')).toHaveText('3 of 12 records · newest first');
  await count('All', 12);
});

test('AC2: the vintage table shows deltas against the previous vintage, the breaking version and the reasons', async ({ page }) => {
  await openProject(page);
  await gotoTab(page, 'vintages');
  const rows = page.locator('vintage-table tbody tr');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-run-id')))).toEqual([R.v3, R.v2, R.v1]);       // newest first
  const heads = await page.locator('vintage-table thead th').allTextContents();
  expect(heads).toEqual(['Vintage', 'Date', 'Tool version', '1P MMbbl', '2P MMbbl', '3P MMbbl', 'NPV10 USD MM', 'RF', 'Method', 'Delta vs previous', 'Reason']);

  const cell = (id, sel) => page.locator(`vintage-table tr[data-run-id="${id}"] ${sel}`);
  await expect(cell(R.v1, 'td').nth(1)).toHaveText('2026-03-18');
  await expect(cell(R.v2, 'td').nth(1)).toHaveText('2026-06-24');
  await expect(cell(R.v3, 'td').nth(1)).toHaveText('2026-09-28');
  await expect(cell(R.v3, '[data-tool-version]')).toHaveText('2.1.0');
  // outputs
  await expect(cell(R.v2, '[data-output="NPV10"]')).toHaveText('186.4');
  await expect(cell(R.v3, '[data-output="2P"]')).toHaveText('16');
  await expect(cell(R.v1, '[data-output="1P"]')).toHaveText('8.4');
  await expect(cell(R.v1, '[data-output="RF"]')).toHaveText('0.18');
  await expect(cell(R.v1, 'td').nth(8)).toHaveText(M1);
  await expect(cell(R.v3, 'td').nth(8)).toHaveText(M2);
  // the middle vintage is on the breaking version; the others are not
  await expect(cell(R.v2, '[data-breaking]')).toHaveText('Breaking');
  await expect(page.locator('vintage-table [data-breaking]')).toHaveCount(1);
  // deltas against the hand-calculated values
  await expect(cell(R.v1, '[data-delta]')).toHaveText('first vintage');
  await expect(cell(R.v2, '[data-delta]')).toHaveText(HAND_DELTA_TEXT[2]);
  await expect(cell(R.v3, '[data-delta]')).toHaveText(HAND_DELTA_TEXT[3]);
  await expect(cell(R.v3, '[data-delta-key="NPV10"]')).toHaveClass(/dn/);
  await expect(cell(R.v2, '[data-delta-key="NPV10"]')).toHaveClass(/up/);
  // reasons: superseded vintages name their successor, the current one shows a dash
  await expect(cell(R.v1, '[data-reason]')).toHaveText('Superseded by Cubiro waterflood – base (vintage 2)');
  await expect(cell(R.v2, '[data-reason]')).toHaveText('Superseded by Cubiro waterflood – base (re-run on 2.1.0)');
  await expect(cell(R.v3, '[data-reason]')).toHaveText('—');
});

test('AC2: the delta arithmetic itself (used when the API omits deltas) matches the hand-calculated values, stale reasons render', async ({ page }) => {
  await openProject(page);
  const r = await page.evaluate(async ({ v1, v2, v3, m }) => {
    const mod = await import('/hub/components/vintage-table.js');
    const o = (a, b, c, n, rf, me) => ({ '1P': { value: a, unit: 'MMbbl' }, '2P': { value: b, unit: 'MMbbl' }, '3P': { value: c, unit: 'MMbbl' }, NPV10: { value: n, unit: 'USD MM' }, RF: { value: rf }, method: { value: me } });
    const bare = (id, at, ver, outputs, sup, status = 'final') => ({ run_id: id, job: 'opportunity-register', tool_version: ver, title: id, created_at: at, status, superseded: status === 'superseded', supersedes: sup, outputs });
    const vs = [bare('c', '2026-09-28T00:00:00Z', '2.1.0', o(9.4, 16.0, 24.1, 171.1, 0.2, m[1]), 'b'), bare('b', '2026-06-24T00:00:00Z', '2.0.0', o(9.6, 16.2, 24.8, 186.4, 0.21, m[1]), 'a', 'superseded'), bare('a', '2026-03-18T00:00:00Z', '1.2.0', o(8.4, 14.1, 21.9, 142.7, 0.18, m[0]), null, 'superseded')];
    const d = mod.computeDeltas(vs[1].outputs, vs[0].outputs);
    const el = document.createElement('vintage-table');
    el.staleReasons = new Map([['c', 'input item superseded']]);
    el.breaking = new Set(['opportunity-register@2.0.0']);
    document.body.appendChild(el);
    el.vintages = vs;      // no `deltas` on any vintage: the table computes them
    const text = (id, sel) => el.querySelector(`tr[data-run-id="${id}"] ${sel}`).textContent;
    return {
      npvPct: d.NPV10.delta_pct, npvDelta: Math.round(d.NPV10.delta * 100) / 100, twoP: d['2P'].delta_pct, methodDelta: d.method,
      first: text('a', '[data-delta]'), second: text('b', '[data-delta]'), third: text('c', '[data-delta]'), reason: text('c', '[data-reason]'), pct: mod.fmtPct(-8.2082), zero: mod.fmtPct(0.01),
      sup: text('a', '[data-reason]'), supB: text('b', '[data-reason]'),
    };
  }, { v1: R.v1, v2: R.v2, v3: R.v3, m: [M1, M2] });
  expect(r.npvPct).toBe(-8.21);       // -15.3 / 186.4
  expect(r.npvDelta).toBe(-15.3);
  expect(r.twoP).toBe(-1.23);         // -0.2 / 16.2
  expect(r.methodDelta).toBeUndefined();   // vintages 2 and 3 use the same method: no change reported
  expect(r.first).toBe('first vintage');
  expect(r.second).toBe(HAND_DELTA_TEXT[2]);
  expect(r.third).toBe(HAND_DELTA_TEXT[3]);
  expect(r.pct).toBe('−8.2%');
  expect(r.zero).toBe('0.0%');
  expect(r.reason).toBe('Stale: input item superseded');
  expect(r.sup).toBe('Superseded by b');
  expect(r.supB).toBe('Superseded by c');
});

test('AC3: the lineage renders the seeded graph, stale nodes are outlined, clicking a node opens the record in the side panel', async ({ page }) => {
  await openProject(page);
  await gotoTab(page, 'lineage');
  const nodes = page.locator('.ln-node');
  await expect(nodes).toHaveCount(12);
  await expect(page.locator('.ln-edge')).toHaveCount(LINEAGE.edges.length);
  await expect(page.locator('.ln-node[data-state="stale"]')).toHaveCount(3);
  await expect(page.locator('.ln-node[data-state="superseded"]')).toHaveCount(2);          // the two runs a supersedes edge points at
  await expect(page.locator('.ln-node[data-kind="reference"]')).toHaveCount(3);
  await expect(page.locator('.ln-node[data-kind="restricted"]')).toHaveCount(1);
  await expect(page.locator('.ln-edge.bad').first()).toBeAttached();
  // Layered left to right: inputs before runs before the documents that cite them.
  const x = (id) => page.locator(`.ln-node[data-node="${id}"]`).evaluate((g) => g.getBoundingClientRect().left);
  expect(await x('ref:price_decks/brent-2026-06')).toBeLessThan(await x('run:' + R.v1));
  expect(await x('run:' + R.v1)).toBeLessThan(await x('run:' + R.v2));
  expect(await x('run:' + R.v2)).toBeLessThan(await x('run:' + R.v3));
  expect(await x('run:' + R.v2)).toBeLessThan(await x('doc:' + I.letterOut));

  await expect(page.locator('#record-panel')).toBeHidden();
  await page.locator(`.ln-node[data-node="run:${R.yopal}"]`).click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#rp-title')).toHaveText('Yopal sector sensitivity, injector spacing 20 / 30 / 40 acres');
  await expect(panel.locator('#rp-kind')).toHaveText('Run');
  await expect(panel.locator('.hub-json')).toContainText('"tool_commit": "b71d0a4"');
  await expect(panel.locator('.hub-json')).toContainText('"id": "' + R.yopal + '"');
  await expect(panel).toContainText('input item superseded');
  await expect(page.locator(`.ln-node[data-node="run:${R.yopal}"]`)).toHaveClass(/sel/);
  // a document node opens its item; the restricted node says so; Escape closes and returns focus
  await page.locator(`.ln-node[data-node="doc:${I.basis}"]`).click();
  await expect(panel.locator('#rp-title')).toHaveText('Basis note BN-LLA-02: interim evaluation, vintage 2');
  await expect(panel.locator('.hub-json')).toContainText('"reference_no": "BN-LLA-02"');
  await page.locator(`.ln-node[data-node="doc:${u(99)}"]`).click();
  await expect(panel).toContainText('outside your scope');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  // keyboard: Enter on a focused node opens it too
  await page.locator(`.ln-node[data-node="run:${R.v3}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(panel.locator('#rp-title')).toHaveText('Cubiro waterflood – base (re-run on 2.1.0)');
  await page.locator('#rp-close').click();
  await expect(panel).toBeHidden();
  // a timeline row opens the same panel
  await gotoTab(page, 'timeline');
  await page.locator(`.hub-tl-item[data-ref="run:${R.v3}"] .hub-tl-title`).click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.hub-json')).toContainText('"tool_version": "2.1.0"');
});

test('AC3: a generated lineage of 200 nodes lays out with no overlapping node rectangles', async ({ page }) => {
  await openProject(page, {}, 'id=gen-200');
  await gotoTab(page, 'lineage');
  await expect(page.locator('.ln-node')).toHaveCount(200);
  await expect(page.locator('.hub-legend')).toContainText('200 nodes');
  const r = await page.evaluate(() => {
    const svg = document.querySelector('svg.hub-lineage');
    const box = svg.getBoundingClientRect();
    const rects = [...document.querySelectorAll('.ln-node rect.ln-rect')].map((el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
    let overlaps = 0, outside = 0;
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      if (a.l < box.left - 0.5 || a.t < box.top - 0.5 || a.r > box.right + 0.5 || a.b > box.bottom + 0.5) outside++;
      for (let j = i + 1; j < rects.length; j++) { const c = rects[j]; if (a.l < c.r - 0.01 && c.l < a.r - 0.01 && a.t < c.b - 0.01 && c.t < a.b - 0.01) overlaps++; }
    }
    return { n: rects.length, overlaps, outside, w: box.width, h: box.height };
  });
  expect(r.n).toBe(200);
  expect(r.overlaps).toBe(0);
  expect(r.outside).toBe(0);
  expect(r.w).toBeGreaterThan(500);
  // The same check on the pure layout, plus the layering rule for every edge that is not part of the cycle.
  const L = await page.evaluate(async (g) => {
    const { layoutLineage } = await import('/hub/components/lineage-graph.js');
    const lay = layoutLineage(g.nodes, g.edges);
    const by = new Map(lay.nodes.map((p) => [p.id, p]));
    let overlaps = 0;
    for (let i = 0; i < lay.nodes.length; i++) for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i], b = lay.nodes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
    }
    const cyc = new Set([g.edges[g.edges.length - 1].from, g.edges[g.edges.length - 1].to]);
    const bad = g.edges.filter((e) => e.type !== 'supersedes' && !(cyc.has(e.from) && cyc.has(e.to)) && by.get(e.from).layer >= by.get(e.to).layer).length;
    const tallest = Math.max(...lay.nodes.map((p) => p.y + p.h));
    return { count: lay.nodes.length, overlaps, bad, tallest, height: lay.height, layers: lay.layers.length };
  }, GEN);
  expect(L.count).toBe(200);
  expect(L.overlaps).toBe(0);
  expect(L.bad).toBe(0);
  expect(L.tallest).toBeLessThanOrEqual(L.height);
  // Column packing keeps tall layers to at most 12 nodes per sub-column.
  expect(L.height).toBeLessThan(12 * 70 + 100);
  // Click still works at this size.
  await page.locator('.ln-node').nth(150).click();
  await expect(page.locator('#record-panel')).toBeVisible();
});

test('layout unit checks: chain, cycle, isolated nodes, empty graph', async ({ page }) => {
  await openProject(page);
  const r = await page.evaluate(async () => {
    const { layoutLineage } = await import('/hub/components/lineage-graph.js');
    const n = (id) => ({ id, kind: 'run', label: id });
    const chain = layoutLineage(['a', 'b', 'c'].map(n), [{ from: 'a', to: 'b', type: 'input' }, { from: 'b', to: 'c', type: 'cites' }, { from: 'c', to: 'a', type: 'supersedes' }, { from: 'x', to: 'a', type: 'input' }]);
    const cycle = layoutLineage(['a', 'b'].map(n), [{ from: 'a', to: 'b', type: 'input' }, { from: 'b', to: 'a', type: 'input' }]);
    const iso = layoutLineage(['a', 'b', 'c', 'd'].map(n), []);
    const wide = layoutLineage(Array.from({ length: 30 }, (_, i) => n('n' + i)), [], { maxPerColumn: 10 });
    const empty = layoutLineage([], []);
    const layerOf = (l, id) => l.nodes.find((p) => p.id === id).layer;
    return {
      chain: ['a', 'b', 'c'].map((id) => layerOf(chain, id)),
      cycle: ['a', 'b'].map((id) => layerOf(cycle, id)),
      isoLayers: iso.layers.length, isoCol: iso.nodes.map((p) => p.layer),
      wideCols: new Set(wide.nodes.map((p) => p.x)).size, wideMax: Math.max(...wide.nodes.map((p) => p.y)),
      empty: [empty.nodes.length, empty.layers.length],
    };
  });
  expect(r.chain).toEqual([0, 1, 2]);          // supersedes does not layer
  expect(r.cycle).toEqual([0, 1]);             // the closing edge is dropped
  expect(r.isoLayers).toBe(1);
  expect(r.isoCol).toEqual([0, 0, 0, 0]);
  expect(r.wideCols).toBe(3);                  // 30 nodes at 10 per sub-column
  expect(r.empty).toEqual([0, 0]);
});

test('basis notes: items of type note titled Basis... or extracted.kind basis; lessons in scope', async ({ page }) => {
  const seen = await openProject(page);
  await expect(tab(page, 'basis')).toContainText('2');
  await gotoTab(page, 'basis');
  const cards = page.locator('[data-basis-id]');
  await expect(cards).toHaveCount(2);                                           // the call note is neither titled Basis nor extracted.kind basis
  await expect(page.locator(`[data-basis-id="${I.basis}"]`)).toHaveAttribute('data-stale', 'true');
  await expect(page.locator(`[data-basis-id="${I.basis}"]`)).toContainText('cited run superseded');
  await expect(page.locator(`[data-basis-id="${u(66)}"]`)).toHaveAttribute('data-stale', 'false');
  await expect(page.locator(`[data-basis-id="${u(66)}"]`)).toContainText('Delta memo, fiscal terms CO-2026');
  await expect(page.locator('[data-basis-id]', { hasText: 'Call note' })).toHaveCount(0);
  expect(seen).toContain('/api/items?project=' + PID + '&type=note&limit=1000');

  await gotoTab(page, 'lessons');
  await expect(page.locator('[data-lesson-id]')).toHaveCount(2);
  await expect(page.locator(`[data-lesson-id="${u(201)}"]`)).toContainText('CPF water handling');
  await expect(page.locator(`[data-lesson-id="${u(202)}"]`)).toContainText('Proposed');
  expect(seen).toContain('/api/lessons?scope=project%3A' + PID);
});

test('scorecard: six rules computed from the loaded data, matching the mockup rule names', async ({ page }) => {
  await openProject(page);
  await gotoTab(page, 'scorecard');
  const rules = page.locator('[data-rule]');
  await expect(rules).toHaveCount(6);
  const names = await rules.locator('h3').allTextContents();
  expect(names).toEqual([
    '1. Every headline number traces to a run', '2. Every assumption carries a source and provenance', '3. No stale record in a delivered set',
    '4. Basis note current for the latest vintage', '5. Legal tag valid with more than 90 days left', '6. Every outbound letter has a dispatch and an acknowledgement',
  ]);
  const st = await rules.evaluateAll((els) => els.map((el) => el.getAttribute('data-status')));
  expect(st).toEqual(['pass', 'pass', 'fail', 'fail', 'pass', 'pass']);
  const rule = (n) => page.locator(`[data-rule="${n}"]`);
  await expect(rule(1)).toContainText('3 of 3 vintages link to a run id and a tool commit.');
  await expect(rule(2)).toContainText('4 of 4 assumptions sourced.');
  for (const part of ['1 measured', '1 client-stated', '1 analogue', '1 assumed']) await expect(rule(2)).toContainText(part);
  await expect(rule(3)).toContainText('3 delivered records are stale');
  await expect(rule(3)).toContainText('Yopal sector sensitivity');
  await expect(rule(4)).toContainText('none current for the latest vintage (2026-09-28)');
  await expect(rule(5)).toContainText('lt-orinoco-nda-2026 expires 2028-02-13');
  await expect(rule(6)).toContainText('2 letters, 2 dispatches, 2 acknowledged (latest 2026-09-18)');
  await expect(page.locator('[data-pass="4"]')).toContainText('4/6 rules pass');
  await expect(tab(page, 'scorecard')).toContainText('2 fail');
});

test('scorecard: rules whose data source is not built say "not yet measurable"; the lessons tab hides on 404 and 501', async ({ page }) => {
  for (const status of [404, 501]) {
    await page.unroute('**/api/**').catch(() => {});
    await stubApi(page, {
      '/api/lessons': (u_, r) => err(r, status, status === 404 ? 'not_found' : 'not_implemented', 'later'),
      '/api/runs': (u_, r) => err(r, 501, 'not_implemented', 'later'),
      ['/api/organisations/' + ORG.id + '/file']: null,
    });
    await page.goto('/hub/project.html?id=' + PID);
    await ready(page);
    await expect(page.locator('#tab-lessons')).toHaveCount(0);
    await expect(page.locator('#panel-lessons')).toBeHidden();
    await gotoTab(page, 'scorecard');
    for (const n of [2, 5, 6]) {
      await expect(page.locator(`[data-rule="${n}"]`)).toHaveAttribute('data-status', 'na');
      await expect(page.locator(`[data-rule="${n}"] .hub-pill`)).toHaveText('Not yet measurable');
    }
    for (const n of [1, 3, 4]) await expect(page.locator(`[data-rule="${n}"]`)).not.toHaveAttribute('data-status', 'na');
    await expect(page.locator('[data-expiry]')).toContainText('expiry not available');
    await expect(page.locator('[data-pass]')).toContainText('rules pass');
    await expect(page.locator('#notices .hub-notice')).toHaveCount(0);
  }
});

test('project errors: unknown project, no access, no id, Vault down', async ({ page }) => {
  await stubApi(page, { '/api/projects/nope': (u_, r) => err(r, 404, 'not_found', 'project "nope" not found'), '/api/projects/locked': (u_, r) => err(r, 403, 'forbidden', 'no') });
  await page.goto('/hub/project.html?id=nope'); await ready(page);
  await expect(page.locator('h1')).toHaveText('Project not found');
  await expect(page.locator('.hub-notice.bad')).toContainText('There is no project "nope"');
  await expect(page.locator('#p-body')).toBeHidden();
  await page.goto('/hub/project.html?id=locked'); await ready(page);
  await expect(page.locator('h1')).toHaveText('No access to this project');
  await page.goto('/hub/project.html'); await ready(page);
  await expect(page.locator('h1')).toHaveText('No project selected');
  const p2 = await page.context().newPage();
  await p2.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"error","message":"boom"}}' }));
  await p2.goto('/hub/project.html?id=' + PID); await p2.locator('body[data-ready="1"]').waitFor();
  await expect(p2.locator('h1')).toHaveText('The Vault is unreachable');
  await expect(p2.locator('.hub-notice.bad')).toContainText('boom');
});

test('a section that fails to load says so and leaves the others working', async ({ page }) => {
  await openProject(page, { ['/api/projects/' + PID + '/vintages']: (u_, r) => err(r, 500, 'error', 'db down'), ['/api/projects/' + PID + '/lineage']: (u_, r) => err(r, 500, 'error', 'db down') });
  await expect(page.locator('.hub-tl-item')).toHaveCount(12);
  await gotoTab(page, 'vintages');
  await expect(page.locator('#panel-vintages .hub-notice.warn')).toContainText('could not be loaded');
  await gotoTab(page, 'lineage');
  await expect(page.locator('#panel-lineage .hub-notice.warn')).toContainText('db down');
  await gotoTab(page, 'scorecard');
  await expect(page.locator('[data-rule="1"]')).toHaveAttribute('data-status', 'na');
});

/* ── tool page ────────────────────────────────────────────────────────── */

test('AC4: the tool page lists versions newest first and links each run', async ({ page }) => {
  await openTool(page);
  await expect(page.locator('h1')).toHaveText('Opportunity Register');
  await expect(page.locator('#t-label')).toHaveText('Tool · Browser tool');
  await expect(page.locator('[data-owner]')).toHaveText('chris');
  await expect(page.locator('.hub-nav a[aria-current="page"]')).toHaveText('Tool page');
  await expect(page.locator('.hub-nav a', { hasText: 'Project file' })).toHaveCount(0);
  await expect(page.locator('#t-actions [data-open]')).toContainText('Open current 2.1.0');
  await expect(page.locator('#t-actions [data-open]')).toHaveAttribute('href', /\/opportunity-register\.html$/);

  // manifest
  const mf = page.locator('#t-manifest');
  await expect(mf).toContainText('opportunity-register');
  await expect(mf).toContainText('browser-tool');
  await expect(mf).toContainText('tools/opportunity-register/CHANGELOG.md');
  await expect(mf.locator('.hub-asset')).toHaveText(['technical_potential_bopd', 'npv10', 'irr', 'price_deck', 'fiscal_terms']);
  await expect(mf).toContainText('current → 2.1.0 · previous → 2.0.0');
  await expect(page.locator('#t-path')).toHaveText('tools/opportunity-register/tool.json');

  // versions, descending, with status, breaking flag and notes
  const vrows = page.locator('[data-version-row]');
  expect(await vrows.evaluateAll((els) => els.map((el) => el.getAttribute('data-version-row')))).toEqual(['2.1.0', '2.0.0', '1.2.0']);
  const row = (v) => page.locator(`[data-version-row="${v}"]`);
  await expect(row('2.1.0')).toContainText('Approved');
  await expect(row('2.1.0')).toContainText('current');
  await expect(row('2.1.0')).toContainText('Voidage capped at injector capacity');
  await expect(row('2.0.0')).toContainText('Deprecated');
  await expect(row('2.0.0')).toContainText('previous');
  await expect(row('2.0.0').locator('.hub-pill.bad')).toHaveText(['Deprecated', 'Breaking']);
  await expect(row('2.1.0').locator('.hub-pill.bad')).toHaveCount(0);
  await expect(row('1.2.0')).toContainText('Analogue table extended to 14 plays.');    // notes fall back to the changelog
  await expect(row('2.1.0').locator('td').nth(7)).toHaveText('3');                     // active runs per version, by hand (see RUNS)
  await expect(row('2.0.0').locator('td').nth(7)).toHaveText('3');
  await expect(row('1.2.0').locator('td').nth(7)).toHaveText('1');

  // changelog
  const cl = page.locator('#t-changelog');
  await expect(cl.locator('h4')).toHaveCount(3);                                         // Unreleased is empty and skipped
  await expect(cl.locator('h4').first()).toContainText('[2.1.0] – 2026-09-22');
  await expect(cl.locator('[data-release="2.0.0"]')).toContainText('Breaking');
  await expect(cl).toContainText('Voidage replacement is capped at the stated injector capacity.');

  // runs grouped by version, descending; each run linked to its project record
  const groups = page.locator('[data-version-group]');
  expect(await groups.evaluateAll((els) => els.map((el) => el.getAttribute('data-version-group')))).toEqual(['2.1.0', '2.0.0', '1.2.0']);
  const perGroup = { '2.1.0': [u(114), u(113), R.v3].sort(), '2.0.0': [R.yopal, u(112), u(111), R.v2].sort(), '1.2.0': [u(115), R.v1].sort() };
  for (const [ver, ids] of Object.entries(perGroup)) {
    const got = await page.locator(`[data-version-group="${ver}"] tr[data-run-id]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-run-id')).sort());
    expect(got, ver).toEqual(ids);
  }
  const links = page.locator('[data-run-link]');
  await expect(links).toHaveCount(RUNS.length);
  for (const r of RUNS) {
    const a = page.locator(`[data-run-link="${r.id}"]`);
    await expect(a).toHaveCount(1);
    await expect(a).toHaveAttribute('href', `project.html?id=${r.project_id}&run=${r.id}`);
  }
  await expect(page.locator(`tr[data-run-id="${u(112)}"]`)).toContainText('Middle Magdalena infill screening');
  await expect(page.locator('[data-version-group="2.1.0"] .hub-pill.gold')).toHaveText('current');
  await expect(page.locator('[data-version-group="2.0.0"] .hub-pill.bad').first()).toHaveText('older than current');
});

test('tool page: runs on older versions are counted, Re-run all is inert until M08', async ({ page }) => {
  await openTool(page);
  const alert = page.locator('[data-older-count]');
  await expect(alert).toHaveAttribute('data-older-count', '4');                        // 3 on 2.0.0 + 1 on 1.2.0; the superseded runs do not count
  await expect(alert).toContainText('4 runs on older versions.');
  await expect(alert).toContainText('3 on 2.0.0 and 1 on 1.2.0.');
  await expect(alert).toContainText('Version 2.0.0 is marked breaking');
  const btn = alert.locator('button[data-action="rerun-all"]');
  await expect(btn).toHaveText('Re-run all 4');
  await expect(btn).toBeDisabled();
  await expect(alert.locator('.hub-rerun')).toHaveAttribute('title', 'available with M08');
  await expect(alert.locator('#rerun-hint')).toHaveText('available with M08');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(alert.locator('.hub-rerun')).toHaveAttribute('title', 'disponible con M08');
  await expect(btn).toHaveText('Volver a ejecutar las 4');
  await page.locator('.nav-lang button[data-lang="en"]').click();
  // bars: by version, older ones red
  const bars = page.locator('[data-version].hub-runbar');
  await expect(bars).toHaveCount(3);
  await expect(page.locator('.hub-runbar[data-version="2.1.0"] .num')).toHaveText('3');
  await expect(page.locator('.hub-runbar[data-version="2.0.0"] .hub-bar')).toHaveClass(/old/);
  await expect(page.locator('.hub-runbar[data-version="2.1.0"] .hub-bar')).not.toHaveClass(/old/);
  await expect(page.locator('#t-bars')).toContainText('7 active runs · 4 (57%) on versions older than current.');
});

test('tool page: nothing on an older version says so; a run link opens the project on that run', async ({ page }) => {
  await openTool(page, {
    '/api/runs': (u_, r) => json(r, { runs: RUNS.filter((x) => x.tool_version === '2.1.0' || x.status === 'superseded') }),
  });
  await expect(page.locator('[data-older-count]')).toHaveAttribute('data-older-count', '0');
  await expect(page.locator('[data-older-count]')).toContainText('Every active run is on 2.1.0.');
  await expect(page.locator('[data-older-count] button')).toHaveCount(0);
  await page.locator(`[data-run-link="${R.v3}"]`).click();
  await page.waitForURL(new RegExp('project\\.html\\?id=' + PID + '&run=' + R.v3));
  await ready(page);
  await expect(page.locator('#record-panel')).toBeVisible();
  await expect(page.locator('#rp-title')).toHaveText('Cubiro waterflood – base (re-run on 2.1.0)');
  await expect(page.locator(`.hub-tl-item[data-ref="run:${R.v3}"]`)).toHaveClass(/hilite/);
  await expect(page.locator('.hub-json')).toContainText('"tool_commit": "3fa9c1e"');
});

test('tool page: unknown tool, missing id, Vault down (catalog from hub/catalog.json, no runs)', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/tool.html?id=nope'); await ready(page);
  await expect(page.locator('h1')).toHaveText('Tool not found');
  await page.goto('/hub/tool.html'); await ready(page);
  await expect(page.locator('h1')).toHaveText('No tool selected');
  const p2 = await page.context().newPage();
  await p2.route('**/api/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await p2.goto('/hub/tool.html?id=' + TOOL_ID); await p2.locator('body[data-ready="1"]').waitFor();
  await expect(p2.locator('h1')).toHaveText('Opportunity Register');                    // from the static catalog
  await expect(p2.locator('.hub-notice.warn')).toContainText('hub/catalog.json');
  await expect(p2.locator('[data-version-row]').first()).toBeVisible();
  await expect(p2.locator('[data-older-count]')).toHaveCount(0);
  await expect(p2.locator('#t-runs')).toContainText('Runs are available when the Vault is reachable.');
});

/* ── both pages: bilingual, accessible, not indexable ─────────────────── */

function langAudit() {
  const missing = [...document.querySelectorAll('[data-en]')].filter((el) => !el.hasAttribute('data-es')).map((el) => el.outerHTML.slice(0, 80));
  const missingPh = [...document.querySelectorAll('[data-en-ph]')].filter((el) => !el.hasAttribute('data-es-ph')).map((el) => el.outerHTML.slice(0, 80));
  const bare = [...document.body.querySelectorAll('*')].filter((el) => {
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'INPUT'].includes(el.tagName.toUpperCase()) || el.closest('svg, .nav-wordmark, .hub-av, .nav-lang')) return false;
    if (el.children.length) return false;
    const t = el.textContent.trim();
    return /\p{L}{2,}/u.test(t) && !el.hasAttribute('data-en') && !el.closest('[data-en]');
  }).map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
  const svgText = [...document.querySelectorAll('svg text')].filter((el) => /\p{L}{2,}/u.test(el.textContent) && !(el.hasAttribute('data-en') && el.hasAttribute('data-es'))).map((el) => el.textContent.slice(0, 30));
  return { count: document.querySelectorAll('[data-en]').length, missing, missingPh, bare, svgText };
}

test('AC5: every text node has data-en and data-es on the project page, and the language toggle follows', async ({ page }) => {
  await openProject(page);
  await page.locator('.hub-tl-item .hub-tl-title').first().click();          // include the open record panel
  await expect(page.locator('#record-panel [data-highlights]')).toBeVisible();
  const en = await page.evaluate(langAudit);
  expect(en.count).toBeGreaterThan(200);
  expect(en.missing).toEqual([]);
  expect(en.missingPh).toEqual([]);
  expect(en.bare).toEqual([]);
  expect(en.svgText).toEqual([]);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#tab-timeline')).toContainText('Cronología');
  await expect(page.locator('#tab-vintages')).toContainText('Cifras principales');
  await expect(page.locator('#tab-lessons')).toContainText('Lecciones en alcance');
  await expect(page.locator('#crumb-tab')).toHaveText('Cronología');
  await expect(page.locator('#p-file')).toContainText('Etiqueta legal');
  await expect(page.locator('.hub-chips [data-filter="letter"]')).toHaveText('Cartas');
  await expect(page.locator('.hub-tl-count')).toHaveText('12 de 12 registros · más recientes primero');
  await expect(page.locator('#rp-close')).toHaveText('Cerrar');
  await expect(page.locator(`.hub-tl-item[data-ref="run:${R.yopal}"] .hub-stale`)).toHaveText('Obsoleta');
  await page.locator('#rp-close').click();
  await gotoTab(page, 'vintages');
  await expect(page.locator('vintage-table thead th').first()).toHaveText('Añada');
  await expect(page.locator(`vintage-table tr[data-run-id="${R.v2}"] [data-breaking]`)).toHaveText('Cambio incompatible');
  await expect(page.locator(`vintage-table tr[data-run-id="${R.v1}"] [data-reason]`)).toContainText('Reemplazada por');
  await gotoTab(page, 'lineage');
  await expect(page.locator('.ln-col').first()).toHaveText('Entradas');
  await expect(page.locator('.ln-tag-t').first()).toHaveText('OBSOLETO');
  await gotoTab(page, 'scorecard');
  await expect(page.locator('[data-rule="1"] h3')).toHaveText('1. Cada cifra principal se remonta a una ejecución');
  await expect(page.locator('[data-rule="6"] .hub-pill')).toHaveText('Cumple');
  const es = await page.evaluate(langAudit);
  expect(es.missing).toEqual([]);
  expect(es.bare).toEqual([]);
});

test('AC5: every text node has data-en and data-es on the tool page, and the language toggle follows', async ({ page }) => {
  await openTool(page);
  const en = await page.evaluate(langAudit);
  expect(en.count).toBeGreaterThan(150);
  expect(en.missing).toEqual([]);
  expect(en.missingPh).toEqual([]);
  expect(en.bare).toEqual([]);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(page.locator('#h-versions')).toHaveText('Historial de versiones');
  await expect(page.locator('#h-runs')).toHaveText('Ejecuciones por versión');
  await expect(page.locator('#t-manifest')).toContainText('Responsable');
  await expect(page.locator('[data-older-count]')).toContainText('4 ejecuciones en versiones anteriores.');
  await expect(page.locator('[data-older-count]')).toContainText('3 en 2.0.0 y 1 en 1.2.0.');
  await expect(page.locator('#t-actions [data-open]')).toContainText('Abrir versión actual');
  const es = await page.evaluate(langAudit);
  expect(es.missing).toEqual([]);
  expect(es.bare).toEqual([]);
});

async function axeCheck(page) {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test('AC5: axe finds no WCAG 2 A/AA violations on any tab of the project page, with and without the record panel', async ({ page }) => {
  await openProject(page);
  for (const key of ['timeline', 'vintages', 'lineage', 'basis', 'lessons', 'scorecard']) {
    await gotoTab(page, key);
    expect(await axeCheck(page), 'tab ' + key).toEqual([]);
  }
  await gotoTab(page, 'lineage');
  await page.locator(`.ln-node[data-node="run:${R.yopal}"]`).click();
  await expect(page.locator('#record-panel [data-highlights]')).toBeVisible();
  expect(await axeCheck(page), 'panel open').toEqual([]);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  expect(await axeCheck(page), 'Spanish').toEqual([]);
});

test('AC5: axe finds no WCAG 2 A/AA violations on the tool page', async ({ page }) => {
  await openTool(page);
  expect(await axeCheck(page)).toEqual([]);
  await page.locator('.nav-lang button[data-lang="es"]').click();
  expect(await axeCheck(page), 'Spanish').toEqual([]);
});

test('AC5: both pages are noindex, carry no analytics, are disallowed in robots.txt and absent from the sitemap', async ({ page, request }) => {
  for (const file of ['project.html', 'tool.html']) {
    await stubApi(page);
    await page.goto('/hub/' + file + '?id=x');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    const html = await (await request.get('/hub/' + file)).text();
    expect(html).not.toMatch(/googletagmanager|gtag\(|google-analytics|G-[A-Z0-9]{6,}/);
    for (const js of ['project.js', 'tool.js', 'components/timeline-list.js', 'components/vintage-table.js', 'components/lineage-graph.js', 'components/stale-badge.js']) {
      expect(await (await request.get('/hub/' + js)).text(), js).not.toMatch(/googletagmanager|gtag\(|sk-ant|api[_-]?key/i);
    }
  }
  expect(await (await request.get('/robots.txt')).text()).toMatch(/^Disallow: \/hub\/$/m);
  expect(await (await request.get('/sitemap.xml')).text()).not.toMatch(/\/hub\//);
});

/* ── screenshots (the evidence for the PR) ────────────────────────────── */

test('screenshots: project page and tool page', async ({ page }) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page);
  await expect(page.locator('.hub-tl-item')).toHaveCount(12);
  await page.screenshot({ path: path.join(EVIDENCE, 'm07-project.png'), fullPage: true });
  await openTool(page);
  await expect(page.locator('[data-run-link]')).toHaveCount(RUNS.length);
  await page.screenshot({ path: path.join(EVIDENCE, 'm07-tool.png'), fullPage: true });
});

/* ── Add documents (M09 upload from the project file) ─────────────────── */

test('add documents: files chosen on the project page go to POST /api/ingest/upload as multipart with the project id; each result is shown', async ({ page }) => {
  let ctype = '', body = '';
  await openProject(page, {
    '/api/ingest/upload': async (u_, r) => {
      ctype = r.request().headers()['content-type'] || '';
      body = r.request().postDataBuffer().toString('latin1');
      await new Promise((res) => setTimeout(res, 1200));   // indexing takes time: the page must say so meanwhile
      return json(r, { project_id: PID, results: [
        { filename: 'cubiro-basis.md', type: 'note', item_id: u(901), version: 1, status: 'ingested', ingest: 'ok', chunks: 3 },
        { filename: 'big-scan.pdf', type: 'document', item_id: u(902), version: 1, status: 'queued', error: 'larger than 5242880 bytes' },
        { filename: 'old.xlsx', type: 'spreadsheet', item_id: u(903), version: 2, status: 'unchanged', deduplicated: true, chunks: 12 },
      ] });
    },
  });
  const panel = page.locator('#p-upload');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Add documents');
  await expect(panel.locator('[data-upload-file]')).toHaveCount(0);

  await page.locator('#up-files').setInputFiles([
    { name: 'cubiro-basis.md', mimeType: 'text/markdown', buffer: Buffer.from('# Basis\n\nOOIP 120 MMbbl') },
    { name: 'big-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') },
    { name: 'old.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK fake') },
  ]);
  // While the request is in flight the panel says so, names the count, and the chooser is disabled.
  await expect(panel.locator('#up-progress')).toBeVisible();
  await expect(panel.locator('#up-progress')).toContainText('Uploading 3 files');
  await expect(panel.locator('#up-drop')).toHaveClass(/busy/);
  const rows = panel.locator('[data-upload-file]');
  await expect(rows).toHaveCount(3);
  await expect(panel.locator('#up-progress')).toBeHidden();
  await expect(panel.locator('#up-drop')).not.toHaveClass(/busy/);

  // What went over the wire: multipart, the project id, every file under "files".
  expect(ctype).toMatch(/^multipart\/form-data/);
  expect(body).toContain('name="project_id"\r\n\r\n' + PID);
  expect(body).toContain('name="files"; filename="cubiro-basis.md"');
  expect(body).toContain('name="files"; filename="big-scan.pdf"');
  expect(body).toContain('name="files"; filename="old.xlsx"');

  // What the person sees: one row per file with its outcome.
  await expect(rows.nth(0)).toContainText('cubiro-basis.md');
  await expect(rows.nth(0).locator('[data-status]')).toHaveAttribute('data-status', 'ingested');
  await expect(rows.nth(0)).toContainText('3 chunks');
  await expect(rows.nth(1).locator('[data-status]')).toHaveAttribute('data-status', 'queued');
  await expect(rows.nth(1)).toContainText('larger than 5242880 bytes');
  await expect(rows.nth(2).locator('[data-status]')).toHaveAttribute('data-status', 'unchanged');
  await expect(rows.nth(2)).toContainText('version 2');
  await expect(panel.getByRole('button', { name: 'Reload the project file' })).toBeVisible();
});

test('add documents: a refused upload (403) and a Vault outage each say so without breaking the page', async ({ page }) => {
  await openProject(page, { '/api/ingest/upload': (u_, r) => err(r, 403, 'forbidden', 'you are not a member of project "llanos-waterflood"') });
  const panel = page.locator('#p-upload');
  await page.locator('#up-files').setInputFiles([{ name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from('x') }]);
  await expect(panel.locator('.hub-notice.bad')).toContainText('you are not a member of project "llanos-waterflood"');
  await expect(panel.locator('[data-upload-file]')).toHaveCount(0);
  await expect(page.locator('#tl')).toBeVisible();   // the rest of the page is untouched

  await page.route('**/api/ingest/upload', (route) => route.abort('failed'));
  await page.locator('#up-files').setInputFiles([{ name: 'note2.md', mimeType: 'text/markdown', buffer: Buffer.from('y') }]);
  await expect(panel.locator('.hub-notice.bad').last()).toContainText('The Vault is unreachable');
});
