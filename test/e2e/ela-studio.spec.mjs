// M05: the ELA Scenario Studio writes a Run when a scenario is saved, lists it in the
// Runs drawer, reloads it, and can be driven headlessly through window.ATC_TOOL.
//
// The Vault API is not behind the static server, so /api/** is stubbed per test.
// Acceptance criteria covered (docs/vault-hub/modules/M05-tool-run-capture.md):
//   1 save validates against run-record.schema.json with tool_version, tool_commit,
//     an input or assumption, and every produces[] output
//   2 ATC_TOOL.run(ATC_TOOL.getParams()) equals the saved outputs
//   3 loading a prior run reproduces them
//   4 no provider key in the page
//   5 the API absent: everything still works, runs queue locally, ELAStore stays local
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const readJson = (rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const TOOL = readJson('tools/ela-studio/tool.json');
const CURRENT = TOOL.versions.find((v) => v.version === TOOL.aliases.current);
const SCHEMA = readJson('docs/vault-hub/schemas/run-record.schema.json');
const FIXTURE = readJson('test/e2e/fixtures/ela-studio.json');
const EVIDENCE = resolve(root, 'docs/vault-hub/evidence/m05-ela-studio.png');
const FISCAL_REF = 'ref:fiscal_terms/ve/ela-2026';

const ME = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris Hopkinson', role: 'partner' };
const PROJECT = { id: 'lago-phase-1', name: 'Lago Phase 1', client_id: 'summa', default_legal_tag: 'lt-summa-nda-2026' };

/** ajv from vault/node_modules when it is installed; otherwise a required-fields check. */
async function makeValidator() {
  try {
    const { default: Ajv2020 } = await import('../../vault/node_modules/ajv/dist/2020.js');
    const { default: addFormats } = await import('../../vault/node_modules/ajv-formats/dist/index.js');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(SCHEMA);
    return (rec) => ({ ok: !!validate(rec), errors: JSON.stringify(validate.errors || []) });
  } catch (e) {
    return (rec) => {
      const missing = SCHEMA.required.filter((k) => rec[k] === undefined || rec[k] === null);
      const extra = Object.keys(rec).filter((k) => !(k in SCHEMA.properties));
      return { ok: !missing.length && !extra.length, errors: `missing ${missing} extra ${extra} (ajv unavailable)` };
    };
  }
}

/** Stubs /api/**. server:false answers 404 everywhere, as the static server does. */
async function stubApi(page, { server }) {
  const posts = [];       // every body POSTed to /api/runs or /api/runs/:id/supersede
  const stored = [];      // what GET /api/runs returns
  const scenarios = [];   // what ELAStore POSTed to /api/scenarios
  await page.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!server) return json(404, { error: { message: 'no api' } });
    if (path === '/api/me') return json(200, { user: ME });   // ELAStore reads .user; the Vault client accepts either shape
    if (path === '/api/projects') return json(200, [PROJECT]);
    if (path === `/api/tools/${TOOL.id}/resolve`) {
      return json(200, { entry: TOOL.entry, modules: CURRENT.modules, version: CURRENT.version, commit: CURRENT.commit });
    }
    if (path === '/api/scenarios' && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      scenarios.push(body);
      return json(201, { id: `scn-${scenarios.length}`, name: body.name });
    }
    if (path === '/api/scenarios' && req.method() === 'GET') return json(200, []);
    if (path === '/api/runs' && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      posts.push({ path, body }); stored.push(body);
      return json(201, { id: body.id, deduplicated: false });
    }
    const sup = /^\/api\/runs\/([^/]+)\/supersede$/.exec(path);
    if (sup && req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      posts.push({ path, body });
      stored.forEach((r) => { if (r.id === sup[1]) r.status = 'superseded'; });
      stored.push(body);
      return json(201, { id: body.id, deduplicated: false });
    }
    if (path === '/api/runs' && req.method() === 'GET') return json(200, stored);
    const one = /^\/api\/runs\/([^/]+)$/.exec(path);
    if (one && req.method() === 'GET') {
      const hit = stored.find((r) => r.id === one[1]);
      return hit ? json(200, hit) : json(404, { error: { message: 'no such run' } });
    }
    return json(404, { error: { message: 'not stubbed' } });
  });
  return { posts, stored, scenarios };
}

async function openStudio(page) {
  await page.goto('/ela-studio/index.html');
  await page.waitForFunction(() => window.ATC_TOOL && window.ATC_VAULT && window.ELAStore
    && document.querySelector('#projectPicker select') && document.querySelector('#curScen'));
}

/** Puts the fixture scenario in the studio, then saves it through the studio's own Save dialog. */
async function loadFixtureAndSave(page) {
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);
  await page.locator('#btnSave').click();
  await expect(page.locator('#saveModal')).toHaveClass(/show/);
  await page.locator('#saveName').fill(FIXTURE.name);
  await page.locator('#saveConfirm').click();
  await expect(page.locator('#saveModal')).not.toHaveClass(/show/);
  await expect(page.locator('#curScen')).toHaveText(FIXTURE.name);
}

test('save writes a valid Run, run() reproduces it, the drawer lists, loads and supersedes it', async ({ page }) => {
  const validate = await makeValidator();
  const api = await stubApi(page, { server: true });
  await openStudio(page);
  expect(await page.evaluate(() => window.ELAStore.mode())).toBe('server');

  // Project picker is mounted in the header and fed by /api/projects.
  const picker = page.locator('#projectPicker select');
  await expect(picker.locator(`option[value="${PROJECT.id}"]`)).toHaveCount(1);
  await picker.selectOption(PROJECT.id);

  await loadFixtureAndSave(page);
  await expect.poll(() => api.posts.length).toBe(1);

  // ELAStore did its own job first: the scenario went to /api/scenarios, unchanged.
  expect(api.scenarios).toHaveLength(1);
  expect(api.scenarios[0].name).toBe(FIXTURE.name);
  expect(api.scenarios[0].state).toEqual(FIXTURE.params);

  // AC1: the POST body is a valid RunRecord carrying what tool.json says.
  const rec = api.posts[0].body;
  expect(api.posts[0].path).toBe('/api/runs');
  const verdict = validate(rec);
  expect(verdict.ok, verdict.errors).toBe(true);
  expect(rec.job).toBe(TOOL.id);
  expect(rec.tool_version).toBe(CURRENT.version);
  expect(rec.tool_commit).toBe(CURRENT.commit);
  expect(rec.author).toBe(ME.id);
  expect(rec.project_id).toBe(PROJECT.id);
  expect(rec.legal_tag).toBe(PROJECT.default_legal_tag);
  expect(rec.status).toBe('draft');
  expect(rec.title).toBe(FIXTURE.name);
  expect(rec.params).toEqual(FIXTURE.params);
  expect(rec.inputs.length + Object.keys(rec.assumptions || {}).length).toBeGreaterThan(0);
  expect(rec.inputs).toEqual([
    { ref: FISCAL_REF, kind: 'reference', role: 'fiscal_terms' },
    { ref: `tool:${TOOL.id}`, kind: 'manual' },
  ]);
  for (const key of TOOL.produces) expect(rec.outputs, `output ${key}`).toHaveProperty(key);
  expect(Object.keys(rec.outputs).sort()).toEqual([...TOOL.produces].sort());

  // Known scenario: the fixture pins the numbers.
  expect(rec.outputs.npv10.unit).toBe('MMUSD');
  expect(rec.outputs.npv10.value).toBeCloseTo(FIXTURE.expected.npv10.value, 6);
  expect(rec.outputs.production_profile.unit).toBe('bopd');
  const profile = rec.outputs.production_profile.value;
  expect(profile).toHaveLength(FIXTURE.expected.production_profile.value.length);
  profile.forEach((row, i) => {
    const want = FIXTURE.expected.production_profile.value[i];
    expect(row.year).toBe(want.year);
    expect(row.bopd).toBeCloseTo(want.bopd, 6);
  });

  // Engine defaults the scenario did not override are reported as assumptions, each marked as such.
  const assumptions = await page.evaluate(() => window.ATC_TOOL.getAssumptions());
  const names = Object.keys(assumptions);
  expect(names).toContain('econ.discount');
  expect(names).toContain('econ.royalty');
  expect(names).toContain('class.gas-lift-restoration-valve-mandrel.ps');
  for (const overridden of ['econ.brent', 'econ.capexMult', 'crews', 'phaseCap']) expect(names).not.toContain(overridden);
  expect(names.some((n) => n.startsWith('class.tubing-light-recompletion'))).toBe(false);   // no wells, nothing assumed
  for (const n of names) {
    expect(assumptions[n]).toMatchObject({ source: 'assumed', provenance: 'assumed' });
    expect(assumptions[n]).toHaveProperty('value');
  }
  expect(rec.assumptions).toEqual(assumptions);
  expect(await page.evaluate(() => window.ATC_TOOL.getInputs())).toEqual(rec.inputs);

  // AC2: headless run() equals what was saved.
  const rerun = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(rerun).toEqual(rec.outputs);

  // The version badge shows the tool version the Vault resolved.
  await expect(page.locator('#toolVer')).toHaveAttribute('data-source', 'vault');
  await expect(page.locator('#toolVer')).toHaveText(`v${CURRENT.version}`);

  // Runs drawer.
  await page.locator('#runsBtn').click();
  const rows = page.locator('#runsList .run');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(FIXTURE.name);
  await expect(rows.first()).toContainText(ME.id);
  await expect(rows.first()).toContainText(`v${CURRENT.version}`);
  await expect(rows.first()).toContainText('draft');
  await expect(rows.first()).toContainText('NPV at 10%');
  await expect(rows.first()).toContainText(Math.round(rec.outputs.npv10.value).toLocaleString('en-GB'));
  await expect(page.locator('#runsQueuedNote')).toBeHidden();
  await expect(rows.first().locator('[data-vact="run-load"]')).toBeVisible();
  await expect(rows.first().locator('[data-vact="run-supersede"]')).toBeVisible();

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  await page.waitForTimeout(450);   // let the drawer finish sliding in
  await page.screenshot({ path: EVIDENCE });

  // AC3: change the working state, then Load the run and get the same outputs back.
  await page.evaluate(() => {
    const p = window.ATC_TOOL.getParams();
    p.econ.brent = 90; p.crews = 4;
    window.ATC_TOOL.setParams(p);
  });
  const changed = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(changed.npv10.value).not.toBe(rec.outputs.npv10.value);
  await rows.first().locator('[data-vact="run-load"]').click();
  await expect(page.locator('#toast')).toContainText('Run loaded. The outputs reproduce exactly.');
  await expect(page.locator('#curScen')).toHaveText(FIXTURE.name);
  expect(await page.evaluate(() => window.ATC_TOOL.getParams())).toEqual(FIXTURE.params);
  const reloaded = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(reloaded).toEqual(rec.outputs);

  // Supersede with the current scenario posts to the supersede route and points at the old run.
  await page.locator('#runsBtn').click();
  await page.locator('#runsList .run [data-vact="run-supersede"]').first().click();
  await expect.poll(() => api.posts.length).toBe(2);
  expect(api.posts[1].path).toBe(`/api/runs/${rec.id}/supersede`);
  expect(api.posts[1].body.supersedes).toBe(rec.id);
  const v2 = validate(api.posts[1].body);
  expect(v2.ok, v2.errors).toBe(true);
  await expect(page.locator('#runsList .badge', { hasText: 'superseded' })).toHaveCount(1);

  // AC4: no provider key anywhere in the page or its bridge.
  expect(await page.content()).not.toContain('sk-ant-');
  for (const f of ['ela-studio/index.html', 'ela-studio/vault-bridge.js']) {
    expect(readFileSync(resolve(root, f), 'utf8')).not.toContain('sk-ant-');
  }
});

test('a scenario that overrides the fiscal terms cites no fiscal reference', async ({ page }) => {
  await stubApi(page, { server: true });
  await openStudio(page);
  const inputs = await page.evaluate((p) => {
    const custom = structuredClone(p); custom.econ.royalty = 0.2;
    return window.ATC_TOOL.getInputs(custom);
  }, FIXTURE.params);
  expect(inputs).toEqual([{ ref: `tool:${TOOL.id}`, kind: 'manual' }]);
});

test('local mode: the scenario still saves, ELAStore stays local, the run is queued and the drawer says so', async ({ page }) => {
  await stubApi(page, { server: false });
  await openStudio(page);
  await expect(page.locator('#projectPicker select')).toBeDisabled();

  await loadFixtureAndSave(page);

  // ELAStore's own behaviour: local mode, scenario in localStorage.
  expect(await page.evaluate(() => window.ELAStore.mode())).toBe('local');
  const stored = await page.evaluate((name) => ({
    scenario: JSON.parse(localStorage.getItem('ela_scenarios_v1') || '{}')[name],
    queue: JSON.parse(localStorage.getItem('vault_queue_v1') || '[]'),
  }), FIXTURE.name);
  expect(stored.scenario.state).toEqual(FIXTURE.params);

  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vault_queue_v1') || '[]').length)).toBe(1);
  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('vault_queue_v1') || '[]'));
  expect(queue[0].record.job).toBe(TOOL.id);
  expect(queue[0].record.title).toBe(FIXTURE.name);
  expect(queue[0].record.project_id).toBe('firm');
  expect(queue[0].record.legal_tag).toBe('lt-firm');
  expect(queue[0].record.outputs).toEqual(await page.evaluate(() => window.ATC_TOOL.run()));

  // Badge falls back to the ?v token on the bridge script.
  await expect(page.locator('#toolVer')).toHaveAttribute('data-source', 'page');
  await expect(page.locator('#toolVer')).toHaveText(`v${TOOL.aliases.current}`);

  await page.locator('#runsBtn').click();
  await expect(page.locator('#runsQueuedNote')).toBeVisible();
  await expect(page.locator('#runsQueuedNote')).toContainText('Queued locally');
  await expect(page.locator('#runsList .run')).toHaveCount(1);
  await expect(page.locator('#runsList .run')).toContainText('queued locally');

  // A queued run loads back too.
  await page.evaluate(() => { const p = window.ATC_TOOL.getParams(); p.econ.brent = 90; window.ATC_TOOL.setParams(p); });
  await page.locator('#runsList .run [data-vact="run-load"]').click();
  await expect(page.locator('#toast')).toContainText('Run loaded. The outputs reproduce exactly.');
  expect(await page.evaluate(() => window.ATC_TOOL.getParams())).toEqual(FIXTURE.params);
  expect(await page.content()).not.toContain('sk-ant-');
});
