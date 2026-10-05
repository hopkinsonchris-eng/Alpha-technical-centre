// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.3, §1.7; 03-data-hierarchy.md §5.3 H1 to H8): data that flows on the
// project page. The "Where it stands" strip sits directly below the stateline and reads GET /api/projects/:id/standing
// (W7-AC12 Hub part); the stateline's tokens read the dated facts (next.due_at, stage_changed_at, legal_tag_expiry); the
// timeline shows Foreground first with Background collapsed and the type prefix reading `kind` (W7-AC13); the Fields row
// carries counts that open the asset panel, Add field creates a well under a field, the nodal link carries the field
// (W7-AC14); every number carries unit · as-of · source (W7-AC15, H4); the run panel marks a run reviewed or final
// (W7-AC11); the stage select shows since and Won offers Active (H8). The API is stubbed with page.route.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const MEMBER = { id: 'ana', name: 'Ana Pérez', email: 'ana@alpha-technical-centre.com', role: 'associate' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'llanos-waterflood';
const EMAIL = u(501), LETTER = u(502), DRAFT = u(503), FINDING = u(504), RUN = u(601), RUN_OLD = u(600), RUN_REG = u(602), WELL_RUN = u(603), CITING = u(505);
const CUBIRO = 'field:co:cubiro', CASTILLA = 'field:co:castilla', WELL = 'well:co:cubiro-14';

const PROJECT = {
  id: PID, client_id: 'frontera', name: 'Llanos Basin waterflood screening', status: 'prospect', default_legal_tag: 'lt-frontera-nda-2026', asset_ids: [CUBIRO, CASTILLA], members: ['chris', 'ana'],
  created_at: '2026-09-01T09:00:00.000Z', closed_at: null, contacts: ['jorge-ruiz'], country: 'CO', lat: 4.3, lon: -72.9, stage: 'Technical review',
  stage_history: [{ stage: 'Initial screen', at: '2026-09-01T09:00:00.000Z', by: 'chris' }, { stage: 'Technical review', at: '2026-09-12T10:00:00.000Z', by: 'chris' }],
  // Wave 7 PR3: the column beats the history (G's route writes both; a backfill may differ), and the project carries its tag's expiry.
  stage_changed_at: '2026-09-14T08:00:00.000Z', legal_tag_expiry: '2027-02-28', origin_ref: 'doc:' + EMAIL,
  register: { source: 'Client', owner: 'Chris', next: 'Issue screening letter to Frontera', thesis: 'Mature Cubiro and Castilla fields with waterflood upside.', holder: 'Frontera Energy', government: 'ANH', current: '3,200 bopd (2025)', current_kboed: 3.2, plan: 5.4 },
};
const STANDING = {
  project: { id: PID, name: PROJECT.name, status: 'prospect', stage: 'Technical review', stage_since: '2026-09-14T08:00:00.000Z', country: 'CO', client_id: 'frontera' },
  next: { title: 'Issue screening letter to Frontera', due_at: '2026-10-10', owner: 'Chris', ref: null },
  figures: [
    { job: 'nodal-analysis', name: 'technical_potential_bopd', value: 12400, unit: 'bopd', as_of: '2026-09-28', source_ref: 'run:' + RUN, provenance: 'run', run_status: 'draft', stale: false, asset_id: CUBIRO },
    { job: 'opportunity-register', name: 'npv10_musd', value: 171.1, unit: 'MUSD', as_of: '2026-09-20', source_ref: 'run:' + RUN_REG, provenance: 'run', run_status: 'final', stale: true, asset_id: null },
    { job: 'register', name: 'current', value: 3.2, unit: 'kboe/d', as_of: '2025-12-31', source_ref: 'register', provenance: 'register', run_status: null, stale: false, asset_id: null },
    { job: 'register', name: 'plan', value: 5.4, unit: 'kboe/d', as_of: '2026-09-01', source_ref: 'register', provenance: 'register', run_status: null, stale: false, asset_id: null },
  ],
  open: { proposals: { asset: 2, organisation: 0, research: 1, round: 0 }, filing: 1, questions_in_drafts: 1, unanswered_inbound: 1, unacknowledged_dispatches: 0 },
  counterparties: [{ organisation_id: 'frontera', name: 'Frontera Energy Corp.', role: 'holder', last_contact_at: '2026-10-05T09:06:00.000Z', last_contact_by: 'Jorge Ruiz' }, { organisation_id: 'anh', name: 'ANH', role: 'government', last_contact_at: null, last_contact_by: null }],
  deadlines: [{ kind: 'reply_due', title: 'Reply to Frontera on the data room', due_at: '2026-10-03', ref: 'doc:' + EMAIL, overdue: true }, { kind: 'expiry', title: 'NDA with Frontera', due_at: '2027-02-28', ref: 'tag:lt-frontera-nda-2026', overdue: false }],
  since: { opened_at: '2026-10-01T08:00:00.000Z', runs: 2, items: 3, mail: 5 },
  stale_counts: { runs: 1, items: 1 },
  last_activity: { title: 'RE: Cubiro screening letter', at: '2026-10-05T09:06:00.000Z', ref: 'doc:' + EMAIL },
};
const ORG = { id: 'frontera', name: 'Frontera Energy Corp.', kind: 'client', contacts: [{ id: 'jorge-ruiz', name: 'Jorge Ruiz', role: 'VP Subsurface', emails: ['jruiz@fronteraenergy.com'], language: 'en' }] };
const ORG_FILE = { organisation: ORG, contracts_in_force: [{ type: 'nda', legal_tag: 'lt-frontera-nda-2026', expiry: '2027-03-31', reference_no: 'NDA-2026-07' }], dispatches: [] };
const CONTACTS = { project_id: PID, client_id: 'frontera', contacts: [{ id: 'jorge-ruiz', name: 'Jorge Ruiz', role: 'VP Subsurface', emails: ['jruiz@fronteraenergy.com'], language: 'en', organisation: { id: 'frontera', name: 'Frontera Energy Corp.', kind: 'client', counterparty: 'client' }, last_contact: '2026-10-05T09:06:00.000Z' }], counterparties: [] };
const entry = (o) => ({ stale: false, stale_reasons: [], supersedes: null, superseded_by: null, legal_tag: 'lt-frontera-nda-2026', ...o });
const TIMELINE = [
  entry({ kind: 'item', ref: 'doc:' + EMAIL, id: EMAIL, at: '2026-10-05T09:06:00.000Z', title: 'RE: Cubiro screening letter', type: 'email', version: 1, class: 'foreground' }),
  entry({ kind: 'item', ref: 'doc:' + DRAFT, id: DRAFT, at: '2026-10-02T10:00:00.000Z', title: 'Email draft: screening letter', type: 'note', version: 1, record_kind: 'draft', class: 'background', sent: { organisation: 'Frontera Energy Corp.', at: '2026-10-02T10:00:00.000Z' } }),
  entry({ kind: 'item', ref: 'doc:' + LETTER, id: LETTER, at: '2026-10-01T13:54:00.000Z', title: 'Letter ATC-2026-0142 to Frontera: Cubiro screening', type: 'letter', version: 1, reference_no: 'ATC-2026-0142', stale: true, stale_reasons: ['cited run superseded'], class: 'foreground' }),
  entry({ kind: 'item', ref: 'doc:' + FINDING, id: FINDING, at: '2026-09-30T08:00:00.000Z', title: 'Frontera Energy announces Cubiro infill campaign', type: 'note', version: 1, record_kind: 'research', class: 'background', legal_tag: 'lt-public' }),
  entry({ kind: 'run', ref: 'run:' + RUN, id: RUN, at: '2026-09-28T14:12:00.000Z', title: 'Cubiro-14 ESP nodal, base case', job: 'nodal-analysis', tool_version: '1.2.0', status: 'draft', class: 'foreground', supersedes: RUN_OLD }),
  entry({ kind: 'run', ref: 'run:' + RUN_REG, id: RUN_REG, at: '2026-09-20T14:12:00.000Z', title: 'Llanos screen, vintage 3', job: 'opportunity-register', tool_version: '2.2.0', status: 'final', stale: true, stale_reasons: ['price deck superseded'], class: 'foreground' }),
  // No class from the Vault: the page's own rule puts a superseded run in the background.
  entry({ kind: 'run', ref: 'run:' + RUN_OLD, id: RUN_OLD, at: '2026-09-10T14:12:00.000Z', title: 'Cubiro-14 ESP nodal, first pass', job: 'nodal-analysis', tool_version: '1.1.0', status: 'superseded', superseded_by: RUN }),
];
const tool = (id, name, entry, toolbar) => ({ id, name, owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry, produces: [], versions: [{ version: '1.0.0', released_at: '2026-09-01', commit: 'abc1234' }], aliases: { current: '1.0.0' }, releases: [], hub: { context: ['project'], param: 'project', toolbar, live_version: null } });
const CATALOG = { tools: [tool('opportunity-register', 'Opportunity Register', 'opportunity-register.html', 10), tool('nodal-analysis', 'Nodal Analysis', 'nodal-analysis-tool.html', 20), tool('reservoir-simulator', 'Reservoir Simulator', 'reservoir-simulator.html', 30)], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
const RUN_RECORD = {
  id: RUN, job: 'nodal-analysis', tool_version: '1.2.0', tool_commit: '3fa9c1e', author: 'chris', created_at: '2026-09-28T14:12:00Z', project_id: PID, legal_tag: 'lt-frontera-nda-2026', asset_ids: [WELL],
  title: 'Cubiro-14 ESP nodal, base case', status: 'draft', supersedes: RUN_OLD, input_hash: 'sha256:' + 'a'.repeat(64), inputs: [{ ref: 'ref:price_decks/brent-2026-06', kind: 'reference' }],
  outputs: { technical_potential_bopd: { value: 12400, unit: 'bopd' }, operating_point_bhp: { value: 1850, unit: 'psi' }, method: { value: 'Vogel IPR, ESP curve' } },
  assumptions: { oil_price: { value: 70, unit: 'USD/bbl', source: 'ref:price_decks/brent-2026-06', provenance: 'reference' } },
  cited_by: [{ ref: 'doc:' + CITING, title: 'Letter ATC-2026-0145 to Frontera: Cubiro-14 result' }],
  // The Vault's own state of the run sits under facets.vault (the Tier A record forbids it top level): stale from the engine, age flags advisory.
  facets: { vault: { _producer: 'atc-vault', stale: false, stale_reasons: [], age_flags: [{ rule: 'G1', ref: 'doc:' + EMAIL, detail: 'older than RE: Cubiro screening letter, 5 Oct 2026: check its inputs' }], reviewed_at: null } },
};
const VINTAGES = [{ run_id: RUN_REG, ref: 'run:' + RUN_REG, job: 'opportunity-register', tool_version: '2.2.0', title: 'Llanos screen, vintage 3', created_at: '2026-09-20T14:12:00.000Z', status: 'final', superseded: false, supersedes: null, previous_run_id: null, outputs: { npv10_musd: { value: 171.1, unit: 'MUSD' }, '2p_mmbbl': { value: 16, unit: 'MMbbl' } }, deltas: {} }];
const ASSETS = [
  { id: CUBIRO, name: 'Cubiro', kind: 'field', parent_id: null, country: 'CO', operator: 'Frontera Energy', lat: 4.9, lon: -72.1, location_source: 'gem', dossier: [] },
  { id: CASTILLA, name: 'Castilla', kind: 'field', parent_id: null, country: 'CO', operator: 'Ecopetrol', lat: 3.9, lon: -73.6, location_source: 'gem', dossier: [] },
];
const FILES = {
  [CUBIRO]: { asset: ASSETS[0], runs: [{ id: RUN, job: 'nodal-analysis', title: 'Cubiro-14 ESP nodal, base case', status: 'draft', created_at: '2026-09-28T14:12:00Z' }, { id: WELL_RUN, job: 'nodal-analysis', title: 'Cubiro-9 nodal', status: 'reviewed', created_at: '2026-09-15T10:00:00Z' }], items: [{ id: LETTER, type: 'letter', title: 'Letter ATC-2026-0142 to Frontera: Cubiro screening', created_at: '2026-10-01T13:54:00Z' }], analogues: [{ id: 'ar-1', asset_id: CUBIRO, play_type: 'waterflood', provenance: 'own evaluation' }], dossier: [], children: [{ id: WELL, name: 'Cubiro-14', kind: 'well', parent_id: CUBIRO }] },
  [CASTILLA]: { asset: ASSETS[1], runs: [], items: [], analogues: [], dossier: [], children: [] },
};
const ITEM = (id, title, type, extra) => ({ id, type, title, created_at: '2026-10-05T09:06:00.000Z', authored_at: null, authors: [], client_id: 'frontera', project_id: PID, asset_ids: [], organisation_ids: ['frontera'], legal_tag: 'lt-frontera-nda-2026', origin: { source: 'mail' }, storage_key: 'originals/aa/' + id.replace(/-/g, ''), mime: 'message/rfc822', content_hash: 'sha256:' + 'a'.repeat(64), version: 1, supersedes: null, cites: [], filing: {}, extracted: { text_chars: 300, chunks: 1, format: 'eml', ingest: { version: 2, status: 'ok', at: '2026-10-05T09:07:00.000Z' } }, stale: false, tags: [], ...(extra || {}) });

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, { me = PARTNER, project = PROJECT, standing = STANDING, files = FILES, statusDenied = false } = {}) {
  const calls = { patched: [], status: [], standing: 0, vintages: 0, attached: [], similar: 0 };
  let current = { ...project };
  let runStatus = RUN_RECORD.status;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname; const m = route.request().method();
    if (p === '/api/me') return json(route, me);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) {
      if (m === 'PATCH') {
        const b = JSON.parse(route.request().postData()); calls.patched.push(b);
        current = { ...current, ...b, register: { ...current.register, ...(b.register || {}) } };
        if (b.stage && b.stage !== current.stage_history[current.stage_history.length - 1].stage) { current.stage_history = [...current.stage_history, { stage: b.stage, at: '2026-10-05T11:00:00.000Z', by: 'chris' }]; current.stage_changed_at = '2026-10-05T11:00:00.000Z'; }
        return json(route, current);
      }
      return json(route, current);
    }
    if (p === '/api/projects/' + PID + '/standing') { calls.standing++; return standing ? json(route, { ...standing, figures: standing.figures.map((f) => (f.source_ref === 'run:' + RUN ? { ...f, run_status: runStatus } : f)) }) : json(route, { error: { code: 'not_found', message: 'no route' } }, 404); }
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: TIMELINE.length, entries: TIMELINE.map((e) => (e.id === RUN ? { ...e, status: runStatus } : e)) });
    if (p === '/api/projects/' + PID + '/vintages') { calls.vintages++; return json(route, { project_id: PID, vintages: VINTAGES }); }
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/projects/' + PID + '/contacts') return json(route, CONTACTS);
    if (p === '/api/projects/' + PID + '/assets' && m === 'GET') return json(route, { project_id: PID, assets: ASSETS });
    if (p === '/api/projects/' + PID + '/assets' && m === 'POST') {
      const b = JSON.parse(route.request().postData()); calls.attached.push(b);
      const c = b.create || {};
      const asset = { id: 'well:co:' + String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), kind: c.kind, name: c.name, parent_id: c.parent_id || null, country: c.country || null, operator: null, lat: null, lon: null, location_source: null, created_by: 'chris', created_at: '2026-10-05T10:00:00.000Z', props: {} };
      return json(route, { asset, attached: true, already: false, created: true, dossier: [] }, 201);
    }
    if (p === '/api/projects/' + PID + '/research') return json(route, { project_id: PID, runs: [], findings: [], enabled: true });
    const af = /^\/api\/assets\/([^/]+)\/file$/.exec(p);
    if (af) { const id = decodeURIComponent(af[1]); return files && files[id] ? json(route, files[id]) : json(route, { error: { code: 'not_found', message: 'no file' } }, 404); }
    if (p === '/api/assets/locate') return json(route, { candidates: [], unavailable: [] });
    if (p === '/api/analogues/similar') { calls.similar++; return json(route, { hits: [{ row: { id: 'ar-2', asset_id: 'field:co:castilla', play_type: 'waterflood' }, distance: 0.42, drivers: [] }], target: CUBIRO }); }
    if (p === '/api/runs/' + RUN + '/status' && m === 'POST') {
      const b = JSON.parse(route.request().postData()); calls.status.push(b);
      if (statusDenied || (me.role !== 'partner' && b.status === 'final')) return json(route, { error: { code: 'forbidden', message: 'final is for partners' } }, 403);
      const previous = runStatus; runStatus = b.status;
      return json(route, { id: RUN, status: runStatus, previous_status: previous, changed: previous !== runStatus, reviewed_by: me.id, reviewed_at: '2026-10-05T11:00:00.000Z', record_hash: 'sha256:' + 'b'.repeat(64), analogue: null });
    }
    if (p === '/api/runs/' + RUN) return json(route, { ...RUN_RECORD, status: runStatus });
    if (p === '/api/runs/' + RUN_REG) return json(route, { ...RUN_RECORD, id: RUN_REG, job: 'opportunity-register', title: 'Llanos screen, vintage 3', status: 'final', supersedes: null, asset_ids: [], cited_by: [], facets: { vault: { stale: true, stale_reasons: ['price deck superseded'], age_flags: [], reviewed_at: null } }, outputs: VINTAGES[0].outputs });
    if (p === '/api/organisations/frontera') return json(route, ORG);
    if (p === '/api/organisations/frontera/file') return json(route, ORG_FILE);
    if (p === '/api/items/' + EMAIL) return json(route, ITEM(EMAIL, 'RE: Cubiro screening letter', 'email'));
    if (p === '/api/items/' + CITING) return json(route, ITEM(CITING, 'Letter ATC-2026-0145 to Frontera: Cubiro-14 result', 'letter', { mime: 'text/plain', cites: ['run:' + RUN] }));
    if (p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/queue/review') return json(route, { items: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [{ ...RUN_RECORD, status: runStatus }] });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const open = async (page, opts) => { const calls = await stubApi(page, opts); await page.goto('/hub/project.html?id=' + PID); await ready(page); return calls; };
const sl = (page) => page.locator('#p-stateline [data-stateline="full"]');
const token = (page, t) => sl(page).locator('[data-token="' + t + '"]');
const strip = (page) => page.locator('#p-standing');

test('W7-AC12 (Hub): "Where it stands" sits directly below the stateline: figures with unit, as-of and a status pill that opens the run; open decisions as chips; counterparties with last contact; deadlines with overdue in red; since you opened', async ({ page }) => {
  await open(page);
  const st = strip(page);
  await expect(st).toBeVisible();
  await expect(st).toHaveAttribute('data-standing', 'ready');
  expect(await page.locator('#p-stateline').evaluate((h) => h.nextElementSibling && h.nextElementSibling.id)).toBe('p-standing');
  // The figure per job: value in tabular figures, its unit, as-of, the status pill.
  const nodal = st.locator('[data-figure="nodal-analysis:technical_potential_bopd"]');
  await expect(nodal.locator('.hub-num')).toHaveText('12,400');
  await expect(nodal.locator('.hub-unit')).toHaveText('bopd');
  await expect(nodal.locator('.hub-asof')).toContainText('as of 28 Sept 2026');
  await expect(nodal.locator('[data-open-source="run:' + RUN + '"]')).toHaveText('Draft');
  await expect(nodal).toContainText('Nodal Analysis');
  const npv = st.locator('[data-figure="opportunity-register:npv10_musd"]');
  await expect(npv.locator('.hub-num')).toHaveText('171.1');
  await expect(npv.locator('[data-status="final"]')).toHaveText('Final');
  await expect(npv.locator('[data-stale]')).toHaveText('stale');
  const cur = st.locator('[data-figure="register:current"]');
  await expect(cur.locator('.hub-num')).toHaveText('3.2');
  await expect(cur.locator('.hub-unit')).toHaveText('kboe/d');
  await expect(cur.locator('.hub-asof')).toContainText('as of 31 Dec 2025');
  await expect(cur.locator('[data-status="unsourced"]')).toHaveText('unsourced');
  // The pill opens the run.
  await nodal.locator('[data-open-source="run:' + RUN + '"]').click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'run:' + RUN);
  await page.keyboard.press('Escape');
  // Open decisions as chips, each a link to the queue or into the file.
  await expect(st.locator('[data-open="proposals:asset"]')).toHaveText('2 fields proposed');
  await expect(st.locator('[data-open="proposals:asset"]')).toHaveAttribute('href', '/hub/queue.html');
  await expect(st.locator('[data-open="proposals:organisation"]')).toHaveCount(0);
  await expect(st.locator('[data-open="proposals:research"]')).toHaveText('1 fact from research');
  await expect(st.locator('[data-open="filing"]')).toHaveText('1 message to file');
  await expect(st.locator('[data-open="questions"]')).toHaveText('1 question in a draft');
  await expect(st.locator('[data-open="unanswered"]')).toHaveText('1 reply overdue');
  await expect(st.locator('[data-open="unanswered"]')).toHaveClass(/bad/);
  await expect(st.locator('[data-open="dispatches"]')).toHaveCount(0);
  // Counterparties with their last contact.
  const fr = st.locator('[data-organisation="frontera"]');
  await expect(fr).toContainText('Frontera Energy Corp.');
  await expect(fr).toContainText('holder');
  await expect(fr).toContainText('Jorge Ruiz');
  await expect(fr).toContainText('5 Oct 2026');
  await expect(st.locator('[data-organisation="anh"]')).toContainText('no contact yet');
  // Deadlines: the overdue one in red, the NDA expiry not.
  const reply = st.locator('[data-deadline="reply_due"]');
  await expect(reply).toHaveAttribute('data-overdue', 'true');
  await expect(reply).toHaveClass(/is-overdue/);
  await expect(reply).toContainText('overdue');
  // Red: the Hub's --bad token, the colour every failing thing wears.
  expect(await reply.evaluate((el) => { const t = document.createElement('span'); t.style.color = 'var(--bad)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return [getComputedStyle(el).color, c]; })).toEqual(expect.arrayContaining([expect.stringMatching(/^rgb\(/)]));
  expect(await reply.evaluate((el) => { const t = document.createElement('span'); t.style.color = 'var(--bad)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return getComputedStyle(el).color === c && c !== getComputedStyle(document.querySelector('#p-title')).color; })).toBe(true);
  await expect(st.locator('[data-deadline="expiry"]')).toHaveAttribute('data-overdue', 'false');
  await expect(st.locator('[data-deadline="expiry"]')).toContainText('28 Feb 2027');
  // Since you opened.
  await expect(st.locator('[data-standing-group="since"]')).toContainText('2 runs, 3 documents, 5 emails');
  // Every text node is bilingual: the Spanish reads the same facts.
  await page.locator('aside .nav-lang button[data-lang="es"]').click();
  await expect(st.locator('[data-open="unanswered"]')).toHaveText('1 respuesta atrasada');
  await expect(st.locator('[data-standing-group="since"]')).toContainText('2 ejecuciones, 3 documentos, 5 correos');
  await page.locator('aside .nav-lang button[data-lang="en"]').click();
  // The toggle rewrites bilingual text nodes: every chip built beside one must survive it (the KPI tile's as-of chip once did not).
  await expect(nodal.locator('.hub-asof')).toContainText('as of 28 Sept 2026');
  await expect(page.locator('[data-kpi="npv10_musd"] .hub-asof')).toContainText('as of 20 Sept 2026');
  await expect(page.locator('[data-kpi="npv10_musd"] [data-open-source="run:' + RUN_REG + '"]')).toHaveText('Final');
  // Evidence: the page as it opens cold, the stateline and the strip at the top.
  mkdirSync(EVIDENCE, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(strip(page)).toHaveAttribute('data-standing', 'ready');
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-standing.png'), fullPage: false });
});

test('H1: the stateline reads the dated facts: Next says by when from next.due_at, the stage says since from stage_changed_at, the NDA token reads legal_tag_expiry', async ({ page }) => {
  await open(page);
  await expect(token(page, 'next')).toContainText('Issue screening letter to Frontera');
  await expect(token(page, 'next')).toContainText('by 10 Oct 2026');
  await expect(token(page, 'next')).toHaveAttribute('data-due', '2026-10-10');
  await expect(token(page, 'next')).toContainText('Chris');
  await expect(token(page, 'stage')).toContainText('since 14 Sept 2026');     // the column, not the 12 Sept history entry
  await expect(token(page, 'stage')).toHaveAttribute('data-since', '2026-09-14');
  await expect(token(page, 'nda')).toHaveText('NDA to 28 Feb 2027');         // the project's own expiry, not the client file's 31 Mar
  await expect(token(page, 'last')).toContainText('RE: Cubiro screening letter');
  await expect(token(page, 'stale')).toHaveText('2 stale');
});

test('the strip and the tokens degrade on a Vault without the standing route: nothing is shown, nothing breaks, the stateline falls back to the history and the client file', async ({ page }) => {
  await open(page, { standing: null, project: { ...PROJECT, stage_changed_at: undefined, legal_tag_expiry: undefined } });
  await expect(strip(page)).toBeHidden();
  await expect(strip(page)).toHaveAttribute('data-standing', 'unavailable');
  await expect(token(page, 'stage')).toContainText('since 12 Sept 2026');
  await expect(token(page, 'nda')).toHaveText('NDA to 31 Mar 2027');
  await expect(token(page, 'next')).toContainText('Issue screening letter to Frontera');
  await expect(token(page, 'next')).not.toContainText(' by ');
});

test('W7-AC13 (Hub): Foreground by default, "Background (n)" collapsed from the entries\' class (superseded runs by the page\'s own rule), the type prefix reads the record kind, Stale only stays', async ({ page }) => {
  await open(page);
  const tl = page.locator('#tl');
  // Four background rows: the sent draft and the research finding (class from the Vault), the superseded run (the page's rule) and the older stage change.
  await expect(tl).toHaveAttribute('data-background', '4');
  const toggle = tl.locator('[data-background-toggle]');
  await expect(toggle).toHaveText(/Background \(4\)/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.hub-tl-item[data-id="' + DRAFT + '"]')).toBeHidden();
  await expect(page.locator('.hub-tl-item[data-id="' + FINDING + '"]')).toBeHidden();
  await expect(page.locator('.hub-tl-item[data-id="' + RUN_OLD + '"]')).toBeHidden();
  await expect(page.locator('.hub-tl-item[data-id="' + RUN_OLD + '"]')).toHaveAttribute('data-class', 'background');
  await expect(page.locator('.hub-tl-item[data-kind="stage"][data-class="background"]')).toHaveCount(1);
  await expect(page.locator('.hub-tl-item[data-id="' + EMAIL + '"]')).toBeVisible();
  await expect(page.locator('.hub-tl-item[data-id="' + RUN + '"]')).toBeVisible();
  await expect(page.locator('.hub-tl-item[data-kind="stage"][data-class="foreground"]')).toBeVisible();
  // The foot still counts every record; the order in the list is unchanged (newest first).
  await expect(tl.locator('.hub-tl-count')).toHaveText('9 of 9 records · newest first');
  // Open the background: the rows show in their place, in date order, with the type prefix reading the record's kind.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.hub-tl-item[data-id="' + DRAFT + '"]')).toBeVisible();
  await expect(page.locator('.hub-tl-item[data-id="' + DRAFT + '"] .hub-tl-type')).toHaveText('draft');
  await expect(page.locator('.hub-tl-item[data-id="' + DRAFT + '"]')).toHaveAttribute('data-record-kind', 'draft');
  await expect(page.locator('.hub-tl-item[data-id="' + FINDING + '"] .hub-tl-type')).toHaveText('research');
  await expect(page.locator('.hub-tl-item[data-id="' + EMAIL + '"] .hub-tl-type')).toHaveText('email');
  const order = await page.locator('.hub-tl-item').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
  expect(order.indexOf(EMAIL)).toBeLessThan(order.indexOf(DRAFT));
  expect(order.indexOf(DRAFT)).toBeLessThan(order.indexOf(LETTER));
  mkdirSync(EVIDENCE, { recursive: true });
  await tl.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-background.png'), fullPage: false });
  // Stale only: the two stale records, whatever their class.
  await tl.locator('[data-filter="stale"]').click();
  await expect(page.locator('.hub-tl-item')).toHaveCount(2);
  await expect(page.locator('.hub-tl-item[data-id="' + LETTER + '"]')).toBeVisible();
  await expect(page.locator('.hub-tl-item[data-id="' + RUN_REG + '"]')).toBeVisible();
  await expect(tl.locator('[data-background-toggle]')).toHaveCount(0);
});

test('W7-AC14 (Hub): the Fields row shows counts that open the asset panel listing runs, documents, analogues and wells with Find similar; Add field picks a kind and a parent; the nodal link carries the first field', async ({ page }) => {
  const calls = await open(page);
  await page.locator('#p-file-wrap').evaluate((d) => { d.open = true; });
  const cub = page.locator('li[data-field="' + CUBIRO + '"]');
  const counts = cub.locator('[data-field-counts]');
  await expect(counts).toHaveText('2 runs · 1 document · 1 analogue · 1 well');
  await expect(counts).toHaveAttribute('data-wells', '1');
  await expect(page.locator('li[data-field="' + CASTILLA + '"] [data-field-counts]')).toHaveText('0 runs · 0 documents · 0 analogues · 0 wells');
  await counts.click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'asset:' + CUBIRO);
  await expect(panel.locator('#rp-kind')).toHaveText('Field');
  await expect(panel.locator('#rp-title')).toHaveText('Cubiro');
  await expect(panel.locator('[data-asset-list="runs"] li[data-ref]')).toHaveCount(2);
  await expect(panel.locator('[data-asset-list="runs"] li[data-ref="run:' + RUN + '"]')).toContainText('Draft');
  await expect(panel.locator('[data-asset-list="items"] li[data-ref="doc:' + LETTER + '"]')).toContainText('Letter ATC-2026-0142');
  await expect(panel.locator('[data-asset-list="analogues"] li')).toContainText('waterflood');
  await expect(panel.locator('[data-asset-list="children"] li[data-child="' + WELL + '"]')).toContainText('Cubiro-14');
  await expect(panel.locator('[data-asset-list="children"] li[data-child="' + WELL + '"] .hub-kind')).toHaveText('well');
  await panel.locator('[data-action="find-similar"]').click();
  await expect(panel.locator('[data-asset-list="similar"] li')).toHaveCount(1);
  await expect(panel.locator('[data-asset-list="similar"] li')).toContainText('field:co:castilla');
  expect(calls.similar).toBe(1);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-asset-panel.png'), fullPage: false });
  // A run in the panel pivots to the run's own panel.
  await panel.locator('[data-asset-list="runs"] [data-pivot="run:' + RUN + '"]').click();
  await expect(panel).toHaveAttribute('data-ref', 'run:' + RUN);
  await page.keyboard.press('Escape');
  // Add field: a kind picker (basin, block, field, reservoir, well) and a parent picker from the project's assets; a well goes under Cubiro.
  await page.locator('#fld-add-btn').click();
  const kind = page.locator('#fld-kind'), parent = page.locator('#fld-parent');
  await expect(kind.locator('option')).toHaveText(['Basin', 'Block', 'Field', 'Reservoir', 'Well']);
  await expect(parent.locator('option')).toHaveText(['No parent (top level)', 'Cubiro (field)', 'Castilla (field)']);
  await kind.selectOption('well');
  await expect(parent).toHaveValue(CUBIRO);                                   // a well sits under a field by default
  await page.locator('#fld-q').fill('Cubiro-14');
  await page.locator('#fld-add').getByRole('button', { name: 'Search' }).click();
  await page.locator('#fld-manual').click();
  await expect.poll(() => calls.attached.length).toBe(1);
  expect(calls.attached[0]).toEqual({ create: { name: 'Cubiro-14', kind: 'well', country: 'CO', parent_id: CUBIRO } });
  await expect(page.locator('#fld-notices .hub-notice.ok')).toContainText('Cubiro-14 attached under Cubiro.');
  await expect(page.locator('li[data-field="well:co:cubiro-14"]')).toHaveAttribute('data-parent', CUBIRO);
  // The nodal and simulator links carry &asset=<first field> beside ?project=; the register link does not.
  await page.locator('#p-openin').click();
  const nodal = page.locator('#p-openin-menu [data-toolbar-tool="nodal-analysis"]');
  await expect(nodal).toHaveAttribute('href', new RegExp('project=' + PID));
  await expect(nodal).toHaveAttribute('href', /asset=field%3Aco%3Acubiro/);
  await expect(page.locator('#p-openin-menu [data-toolbar-tool="reservoir-simulator"]')).toHaveAttribute('href', /asset=field%3Aco%3Acubiro/);
  await expect(page.locator('#p-openin-menu [data-toolbar-tool="opportunity-register"]')).not.toHaveAttribute('href', /asset=/);
});

test('H4 / W7-AC15 (Hub): every number carries unit · as-of · source: the register\'s current (read from current_kboed when current is text) and plan, the KPI tile, the run panel\'s outputs', async ({ page }) => {
  await open(page);
  await page.locator('#p-file-wrap').evaluate((d) => { d.open = true; });
  const cur = page.locator('[data-register-figure="current"]'), plan = page.locator('[data-register-figure="plan"]');
  await expect(cur.locator('.hub-num')).toHaveText('3.2');
  await expect(cur.locator('.hub-unit')).toHaveText('kboe/d');
  await expect(cur.locator('.hub-asof')).toContainText('as of 31 Dec 2025');
  await expect(cur.locator('[data-status="unsourced"]')).toHaveText('unsourced');
  await expect(plan.locator('.hub-num')).toHaveText('5.4');
  await expect(plan.locator('.hub-asof')).toContainText('as of 1 Sept 2026');
  // The register chip opens the editor on the figure.
  await cur.locator('[data-open-source="register"]').click();
  await expect(page.locator('#op-current')).toBeFocused();
  await expect(page.locator('#op-current')).toHaveValue('3.2');
  // The KPI tile: the vintage's date and the run's status pill, which opens the run.
  const kpi = page.locator('[data-kpi="npv10_musd"]');
  await expect(kpi.locator('.hub-num').first()).toHaveText('171.1');
  await expect(kpi.locator('.hub-unit').first()).toHaveText('MUSD');
  await expect(kpi.locator('.hub-asof')).toContainText('as of 20 Sept 2026');
  await expect(kpi.locator('[data-open-source="run:' + RUN_REG + '"]')).toHaveText('Final');
  await kpi.locator('[data-open-source="run:' + RUN_REG + '"]').click();
  await expect(page.locator('#record-panel')).toHaveAttribute('data-ref', 'run:' + RUN_REG);
  await page.keyboard.press('Escape');
  // The run panel: each output row carries its unit, the as-of date and the status chip; the age flag shows without touching stale.
  await page.locator('.hub-tl-item[data-id="' + RUN + '"] .hub-tl-title').click();
  const panel = page.locator('#record-panel');
  const row = panel.locator('[data-outputs] tr[data-output="technical_potential_bopd"]');
  await expect(row.locator('.hub-unit')).toHaveText('bopd');
  await expect(row.locator('.hub-rp-asof')).toContainText('28 Sept 2026');
  await expect(row.locator('.hub-rp-asof [data-status="draft"]')).toHaveText('Draft');
  await expect(panel.locator('[data-outputs] thead')).toContainText('As of · source');
  await expect(panel.locator('[data-age-flags] li[data-age-rule="G1"]')).toContainText('older than RE: Cubiro screening letter');
  await expect(panel.locator('[data-age-flags] li[data-age-rule="G1"] [data-pivot="doc:' + EMAIL + '"]')).toHaveText('RE: Cubiro screening letter');
  await expect(panel.locator('[data-m="stale"]')).toHaveCount(0);                // an age flag is advisory, never the stale badge
  await page.keyboard.press('Escape');
  // A run the engine marked stale (under facets.vault) does wear the badge.
  await page.locator('.hub-tl-item[data-id="' + RUN_REG + '"] .hub-tl-title').click();
  await expect(panel.locator('[data-m="stale"]')).toContainText('price deck superseded');
});

test('W7-AC11 (Hub): a partner marks the run reviewed then final from the run panel; the pill follows and the headline numbers are re-fetched; the Cited by card reads the server\'s item_cites', async ({ page }) => {
  const calls = await open(page);
  await page.locator('.hub-tl-item[data-id="' + RUN + '"] .hub-tl-title').click();
  const panel = page.locator('#record-panel');
  await expect(panel.locator('[data-m="status"]')).toHaveText('Draft');
  await expect(panel.locator('[data-related="cited-by"] h4')).toHaveText('Cited by');
  await expect(panel.locator('[data-related="cited-by"] [data-pivot="doc:' + CITING + '"]')).toHaveText('Letter ATC-2026-0145 to Frontera: Cubiro-14 result');
  const before = { standing: calls.standing, vintages: calls.vintages };
  await panel.locator('[data-action="mark-reviewed"]').click();
  await expect.poll(() => calls.status.length).toBe(1);
  expect(calls.status[0]).toEqual({ status: 'reviewed' });
  await expect(panel.locator('[data-m="status"]')).toHaveText('Reviewed');
  await expect(panel.locator('[data-status-done="reviewed"]')).toBeVisible();
  await expect(panel.locator('[data-action="mark-reviewed"]')).toBeHidden();
  await expect.poll(() => calls.standing).toBe(before.standing + 1);
  await expect.poll(() => calls.vintages).toBe(before.vintages + 1);
  // The strip's pill and the timeline's pill follow the row's status.
  await expect(strip(page).locator('[data-figure="nodal-analysis:technical_potential_bopd"] [data-open-source="run:' + RUN + '"]')).toHaveText('Reviewed');
  await expect(page.locator('.hub-tl-item[data-id="' + RUN + '"] [data-status="reviewed"]')).toHaveText('Reviewed');
  await panel.locator('[data-action="mark-final"]').click();
  await expect.poll(() => calls.status.length).toBe(2);
  expect(calls.status[1]).toEqual({ status: 'final' });
  await expect(panel.locator('[data-m="status"]')).toHaveText('Final');
  await expect(panel.locator('[data-action="mark-final"]')).toBeHidden();
  await expect(panel.locator('[data-status-done="final"]')).toContainText('counts in the headline numbers');
  // The Cited by pivot opens the letter.
  await panel.locator('[data-related="cited-by"] [data-pivot="doc:' + CITING + '"]').click();
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + CITING);
});

test('W7-AC11 (Hub): a member sees Mark reviewed only; the Vault\'s refusal of final is shown as the reason', async ({ page }) => {
  await open(page, { me: MEMBER });
  await page.locator('.hub-tl-item[data-id="' + RUN + '"] .hub-tl-title').click();
  const panel = page.locator('#record-panel');
  await expect(panel.locator('[data-action="mark-reviewed"]')).toBeVisible();
  await expect(panel.locator('[data-action="mark-final"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A partner whose Vault refuses (say the run is in another partner's scope) reads the reason, not a silent failure.
  await open(page, { statusDenied: true });
  await page.locator('.hub-tl-item[data-id="' + RUN + '"] .hub-tl-title').click();
  await panel.locator('[data-action="mark-final"]').click();
  await expect(panel.locator('[data-status-reason="403"]')).toContainText('only a partner marks a run final');
  await expect(panel.locator('[data-m="status"]')).toHaveText('Draft');
});

test('H8: the stage select says since when; choosing Won offers to set the status Active, Lost or Closed offers Closed, and nothing changes until tapped', async ({ page }) => {
  const calls = await open(page);
  await expect(token(page, 'stage')).toContainText('since 14 Sept 2026');
  await page.locator('#p-stage').selectOption('Won');
  await expect.poll(() => calls.patched.length).toBe(1);
  expect(calls.patched[0]).toEqual({ stage: 'Won' });
  await expect(token(page, 'stage')).toContainText('since 5 Oct 2026');
  const offer = page.locator('#p-notices [data-offer-status="active"]');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('Won: make it an active job?');
  await expect(page.locator('#p-sub [data-status]')).toHaveAttribute('data-status', 'prospect');
  await offer.locator('[data-set-status="active"]').click();
  await expect.poll(() => calls.patched.length).toBe(2);
  expect(calls.patched[1]).toEqual({ status: 'active' });
  await expect(page.locator('#p-sub [data-status]')).toHaveAttribute('data-status', 'active');
  await expect(offer).toHaveCount(0);
  // Lost offers Closed; Not now leaves the status alone.
  await page.locator('#p-stage').selectOption('Lost');
  await expect.poll(() => calls.patched.length).toBe(3);
  const closeOffer = page.locator('#p-notices [data-offer-status="closed"]');
  await expect(closeOffer).toBeVisible();
  await closeOffer.locator('[data-set-status=""]').click();
  await expect(closeOffer).toHaveCount(0);
  expect(calls.patched.length).toBe(3);
  await expect(page.locator('#p-sub [data-status]')).toHaveAttribute('data-status', 'active');
});
