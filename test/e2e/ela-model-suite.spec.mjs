// M05: the ELA New Law Model Suite writes a Run when the page saves its override set, lists it
// in the Runs drawer, reloads it, and can be driven headlessly through window.ATC_TOOL.
//
// The Vault API is not behind the static server, so /api/** is stubbed per test.
// Acceptance criteria covered (docs/vault-hub/modules/M05-tool-run-capture.md):
//   1 save validates against run-record.schema.json with tool_version, tool_commit,
//     an input or assumption, and every produces[] output
//   2 ATC_TOOL.run(ATC_TOOL.getParams()) equals the saved outputs
//   3 loading a prior run reproduces them
//   4 no provider key in the page
//   5 the API absent: everything still works, runs queue locally, localStorage untouched
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const readJson = (rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const TOOL = readJson('tools/ela-model-suite/tool.json');
const CURRENT = TOOL.versions.find((v) => v.version === TOOL.aliases.current);
const SCHEMA = readJson('docs/vault-hub/schemas/run-record.schema.json');
const FIXTURE = readJson('test/e2e/fixtures/ela-model-suite.json');
const EVIDENCE = resolve(root, 'docs/vault-hub/evidence/m05-ela-model-suite.png');
const FISCAL_REF = 'ref:fiscal_terms/ve/ela-2026';
const STORE_KEY = 'alphaEla.overrides.v2';

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
  await page.addInitScript(() => { try { sessionStorage.setItem('atc_auth', '1'); } catch (e) { /* ignore */ } });
  await page.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!server) return json(404, { error: { message: 'no api' } });
    if (path === '/api/me') return json(200, { user: ME });
    if (path === '/api/projects') return json(200, [PROJECT]);
    if (path === `/api/tools/${TOOL.id}/resolve`) {
      return json(200, { entry: TOOL.entry, modules: CURRENT.modules, version: CURRENT.version, commit: CURRENT.commit });
    }
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
  return { posts, stored };
}

async function openSuite(page) {
  await page.goto('/ela-model-suite.html');
  await page.waitForFunction(() => window.ATC_TOOL && window.ATC_VAULT && window.AlphaELA
    && document.querySelector('#projectPicker select'));
  await page.evaluate(() => window.ATC_TOOL.ready());
}

/** Puts the fixture case in the suite, then saves it through the page's own Save button. */
async function loadFixtureAndSave(page) {
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);
  await page.locator('#saveBtn').click();
}

test('the page carries the bridge script at the current tool version', async () => {
  const html = readFileSync(resolve(root, 'ela-model-suite.html'), 'utf8');
  expect(html).toContain(`<script type="module" src="js/ela-model-suite-bridge.js?v=${TOOL.aliases.current}"></script>`);
});

test('save writes a valid Run, run() reproduces it, the drawer lists, loads and supersedes it', async ({ page }) => {
  const validate = await makeValidator();
  const api = await stubApi(page, { server: true });
  await openSuite(page);
  expect(await page.evaluate(() => window.ATC_VAULT.mode())).toBe('server');

  // Project picker is mounted in the header and fed by /api/projects.
  await expect(page.locator('#ae-tools')).toBeVisible();
  const picker = page.locator('#projectPicker select');
  await expect(picker.locator(`option[value="${PROJECT.id}"]`)).toHaveCount(1);
  await picker.selectOption(PROJECT.id);
  await expect(page.locator('#saveBtn')).toBeVisible();
  await expect(page.locator('#runsBtn')).toBeVisible();

  // The fixture case reaches the page's own controls.
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);
  await expect(page.locator('#s-brent')).toHaveValue('65');
  await expect(page.locator('#s-capex')).toHaveValue('1.1');
  await expect(page.locator('#s-prefin')).toHaveValue('12');
  await expect(page.locator('#t-ph2')).not.toBeChecked();
  await expect(page.locator('#t-ph1b')).toBeChecked();
  await expect(page.locator('#ae-presnote')).toHaveText('Custom settings');
  expect(await page.evaluate(() => window.ATC_TOOL.getParams())).toEqual(FIXTURE.params);

  // The page's own headline (NPV at the case's 15% rate) is the same model run() uses at 10%.
  const chip = await page.evaluate((p) => {
    const M = window.AlphaELA.compute(p);
    return { npv15: Math.round(M.port.npv).toLocaleString('en-US'), shown: document.querySelector('#ae-chips').textContent };
  }, FIXTURE.params);
  expect(chip.shown).toContain(`$${chip.npv15}MM`);

  await page.locator('#saveBtn').click();
  await expect.poll(() => api.posts.length).toBe(1);

  // The page's own save ran first and is untouched: overrides and their sources are in localStorage.
  const local = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE_KEY);
  expect(local.ov).toEqual(FIXTURE.params.ov);
  expect(local.src).toEqual(FIXTURE.params.src);
  expect(Object.keys(local).sort()).toEqual(['ov', 'src', 'ts']);

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

  // Known case: the fixture pins the numbers.
  for (const key of TOOL.produces) {
    expect(rec.outputs[key].unit).toBe(FIXTURE.expected[key].unit);
    expect(rec.outputs[key].value).toBeCloseTo(FIXTURE.expected[key].value, 6);
  }

  // Model defaults the override set did not change are reported as assumptions, each marked as such.
  const assumptions = await page.evaluate(() => window.ATC_TOOL.getAssumptions());
  const names = Object.keys(assumptions);
  for (const kept of ['econ.discount_rate', 'econ.opex_multiplier', 'econ.gas_price_trevi', 'phase.1b', 'phase.3',
    'fiscal.royalty', 'fiscal.income_tax', 'fiscal.govt_baseline_decline', 'opex.govt_baseline_maintenance',
    'field.LL.plateau', 'field.TJ.prod_ramp', 'field.RM.capex.ph1']) expect(names, kept).toContain(kept);
  // What the case changed, or does not use, is not an assumption.
  for (const changed of ['econ.brent', 'econ.capex_multiplier', 'financing.prefin_cost', 'phase.2']) expect(names, changed).not.toContain(changed);
  expect(assumptions['field.TV.active'].value).toBe(false);                    // Trevi is off by default, and stayed off
  expect(names.filter((n) => n.startsWith('field.TV.'))).toEqual(['field.TV.active']);   // so nothing else about it is assumed
  expect(names.some((n) => n.includes('.capex.ph2') || n.includes('.capex.ph3'))).toBe(false);   // Phase 2 is off
  const years = (name) => assumptions[name].value.map((r) => r.year);
  expect(years('field.TJ.prod_ramp')).not.toContain(2027);                    // overridden, so not a default
  expect(years('field.TJ.prod_ramp')).toContain(2026);
  expect(years('field.LL.prod_ramp')).not.toContain(2026);
  expect(years('field.LL.prod_ramp')).not.toContain(2027);
  expect(years('field.RM.capex.ph1')).toEqual([2026]);                        // 2027 CAPEX is overridden
  for (const n of names) {
    expect(assumptions[n]).toMatchObject({ source: 'assumed', provenance: 'assumed' });
    expect(assumptions[n]).toHaveProperty('value');
  }
  expect(rec.assumptions).toEqual(assumptions);
  expect(await page.evaluate(() => window.ATC_TOOL.getInputs())).toEqual(rec.inputs);

  // AC2: headless run() equals what was saved.
  const rerun = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(rerun).toEqual(rec.outputs);

  // run() is computation only: it leaves the page, the state and the saved override set alone.
  const before = await page.evaluate(() => ({ html: document.querySelector('#alpha-ela').innerHTML, params: window.ATC_TOOL.getParams() }));
  const other = structuredClone(FIXTURE.params);
  other.case.brent = 95; other.ov.LL = { prod: {}, capex: {}, opex: {} };
  const otherOut = await page.evaluate((p) => window.ATC_TOOL.run(p), other);
  expect(otherOut.npv10.value).not.toBe(rec.outputs.npv10.value);
  const after = await page.evaluate(() => ({ html: document.querySelector('#alpha-ela').innerHTML, params: window.ATC_TOOL.getParams() }));
  expect(after.params).toEqual(before.params);
  expect(after.html).toBe(before.html);

  // The version badge shows the tool version the Vault resolved.
  await expect(page.locator('#toolVer')).toHaveAttribute('data-source', 'vault');
  await expect(page.locator('#toolVer')).toHaveText(`v${CURRENT.version}`);

  // Runs drawer.
  await page.locator('#runsBtn').click();
  const rows = page.locator('#runsList .ae-run');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(FIXTURE.name);
  await expect(rows.first()).toContainText(ME.id);
  await expect(rows.first()).toContainText(`v${CURRENT.version}`);
  await expect(rows.first()).toContainText('draft');
  await expect(rows.first()).toContainText('NPV at 10%');
  await expect(rows.first()).toContainText(Math.round(rec.outputs.npv10.value).toLocaleString('en-GB'));
  await expect(rows.first()).toContainText(`${(rec.outputs.irr.value * 100).toFixed(1)}%`);
  await expect(page.locator('#runsQueuedNote')).toBeHidden();
  await expect(rows.first().locator('[data-vact="run-load"]')).toBeVisible();
  await expect(rows.first().locator('[data-vact="run-supersede"]')).toBeVisible();

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  await page.waitForTimeout(450);   // let the drawer finish sliding in
  await page.screenshot({ path: EVIDENCE });

  // AC3: change the working state, then Load the run and get the same outputs back.
  await page.evaluate(() => {
    const p = window.ATC_TOOL.getParams();
    p.case.brent = 90; p.case.ph2 = true; p.ov.TJ.prod = {};
    window.ATC_TOOL.setParams(p);
  });
  const changed = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(changed.npv10.value).not.toBe(rec.outputs.npv10.value);
  await rows.first().locator('[data-vact="run-load"]').click();
  await expect(page.locator('#toast')).toContainText('Run loaded. The outputs reproduce exactly.');
  expect(await page.evaluate(() => window.ATC_TOOL.getParams())).toEqual(FIXTURE.params);
  await expect(page.locator('#s-brent')).toHaveValue('65');
  await expect(page.locator('#t-ph2')).not.toBeChecked();
  const reloaded = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(reloaded).toEqual(rec.outputs);

  // Supersede with the current case posts to the supersede route and points at the old run.
  await page.locator('#runsBtn').click();
  await page.locator('#runsList .ae-run [data-vact="run-supersede"]').first().click();
  await expect.poll(() => api.posts.length).toBe(2);
  expect(api.posts[1].path).toBe(`/api/runs/${rec.id}/supersede`);
  expect(api.posts[1].body.supersedes).toBe(rec.id);
  const v2 = validate(api.posts[1].body);
  expect(v2.ok, v2.errors).toBe(true);
  await expect(page.locator('#runsList .ae-rbadge', { hasText: 'superseded' })).toHaveCount(1);

  // AC4: no provider key anywhere in the page or its bridge.
  expect(await page.content()).not.toContain('sk-ant-');
  for (const f of ['ela-model-suite.html', 'js/ela-model-suite-bridge.js']) {
    expect(readFileSync(resolve(root, f), 'utf8')).not.toContain('sk-ant-');
  }
});

test('a case with no active field computes nothing, and an unset IRR is omitted rather than zero', async ({ page }) => {
  await stubApi(page, { server: true });
  await openSuite(page);
  const result = await page.evaluate((p) => {
    const none = structuredClone(p);
    Object.keys(none.case.on).forEach((k) => { none.case.on[k] = false; });
    return {
      none: window.ATC_TOOL.run(none),
      // Every field-year run at a loss: no sign change, so no IRR.
      loss: (() => {
        const q = structuredClone(p);
        q.case.brent = 5; q.case.ph2 = false;
        return window.ATC_TOOL.run(q);
      })(),
    };
  }, FIXTURE.params);
  expect(result.none).toEqual({});
  expect(result.loss.npv10.value).toBeLessThan(0);
  expect(result.loss).not.toHaveProperty('irr');
  expect(result.loss).toHaveProperty('government_take');
});

test('the case name in the title follows the presets and the Phase 1a / 1b choice', async ({ page }) => {
  await stubApi(page, { server: true });
  await openSuite(page);
  const names = await page.evaluate(() => {
    const c = window.ATC_TOOL.getParams().case;
    const f = (o) => window.AlphaELA.caseName(Object.assign({}, c, o));
    return [f({}), f({ ph3: false }), f({ ph2: false }), f({ ph2: false, ph1b: false }),
      f({ brent: 40, capex: 1.15, opex: 1.15, prefin: 0.12 }), f({ brent: 61 })];
  });
  expect(names).toEqual([
    'Base $70 · Ph1+2+3', 'Base $70 · Ph1+2', 'Base $70 · Ph1a+1b', 'Base $70 · Ph1a only',
    'Stress $40 · Ph1+2+3', 'Custom · Brent $61 · Ph1+2+3',
  ]);
});

test('local mode: the page still saves, the run is queued and the drawer says so', async ({ page }) => {
  await stubApi(page, { server: false });
  await openSuite(page);
  expect(await page.evaluate(() => window.ATC_VAULT.mode())).toBe('local');
  await expect(page.locator('#projectPicker select')).toBeDisabled();
  // Save and Runs are there without the Vault.
  await expect(page.locator('#saveBtn')).toBeVisible();
  await expect(page.locator('#runsBtn')).toBeVisible();

  await loadFixtureAndSave(page);

  // The page's own behaviour: overrides in localStorage, exactly as before.
  const local = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE_KEY);
  expect(local.ov).toEqual(FIXTURE.params.ov);
  expect(local.src).toEqual(FIXTURE.params.src);

  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vault_queue_v1') || '[]').length)).toBe(1);
  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('vault_queue_v1') || '[]'));
  expect(queue[0].record.job).toBe(TOOL.id);
  expect(queue[0].record.title).toBe(FIXTURE.name);
  expect(queue[0].record.project_id).toBe('firm');
  expect(queue[0].record.legal_tag).toBe('lt-firm');
  expect(queue[0].record.params).toEqual(FIXTURE.params);
  expect(queue[0].record.outputs).toEqual(await page.evaluate(() => window.ATC_TOOL.run()));
  await expect(page.locator('#toast')).toContainText('queued locally');

  // Badge falls back to the ?v token on the bridge script.
  await expect(page.locator('#toolVer')).toHaveAttribute('data-source', 'page');
  await expect(page.locator('#toolVer')).toHaveText(`v${TOOL.aliases.current}`);

  await page.locator('#runsBtn').click();
  await expect(page.locator('#runsQueuedNote')).toBeVisible();
  await expect(page.locator('#runsQueuedNote')).toContainText('Queued locally');
  await expect(page.locator('#runsList .ae-run')).toHaveCount(1);
  await expect(page.locator('#runsList .ae-run')).toContainText('queued locally');

  // A queued run loads back too.
  await page.evaluate(() => { const p = window.ATC_TOOL.getParams(); p.case.brent = 90; window.ATC_TOOL.setParams(p); });
  await page.locator('#runsList .ae-run [data-vact="run-load"]').click();
  await expect(page.locator('#toast')).toContainText('Run loaded. The outputs reproduce exactly.');
  expect(await page.evaluate(() => window.ATC_TOOL.getParams())).toEqual(FIXTURE.params);
  expect(await page.content()).not.toContain('sk-ant-');
});
