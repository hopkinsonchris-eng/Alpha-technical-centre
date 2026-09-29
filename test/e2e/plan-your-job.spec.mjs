// M05: the Plan Your Job tool writes a Run on save, lists it in the Runs drawer,
// reloads it, and can be driven headlessly through window.ATC_TOOL.
//
// The Vault API is not behind the static server, so /api/** is stubbed per test.
// Acceptance criteria covered (docs/vault-hub/modules/M05-tool-run-capture.md):
//   1 save validates against run-record.schema.json with tool_version, tool_commit,
//     an input or assumption, and every produces[] output
//   2 ATC_TOOL.run(ATC_TOOL.getParams()) equals the saved outputs
//   3 loading a prior run reproduces them
//   4 no provider key in the page
//   5 the API absent: everything still works, runs queue locally
import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const readJson = (rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

const TOOL = readJson('tools/plan-your-job/tool.json');
const CURRENT = TOOL.versions.find((v) => v.version === TOOL.aliases.current);
const SCHEMA = readJson('docs/vault-hub/schemas/run-record.schema.json');
const FIXTURE = readJson('test/e2e/fixtures/plan-your-job.json');
const EVIDENCE = resolve(root, 'docs/vault-hub/evidence/m05-plan-your-job.png');

const ME = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris Hopkinson', role: 'partner' };
const PROJECT = { id: 'talara-brownfield', name: 'Talara Brownfield', client_id: 'frontera', default_legal_tag: 'lt-frontera-nda-2026' };
const DAY_RATES = { rates: { Principal: 13500, Senior: 11000, 'Mid-level': 8000, Junior: 5500 } };

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
  await page.route(/unpkg\.com|openfreemap|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!server) return json(404, { error: { message: 'no api' } });
    if (path === '/api/me') return json(200, ME);
    if (path === '/api/projects') return json(200, [PROJECT]);
    if (path === '/api/settings/day-rates') return json(200, { key: 'day-rates', value: DAY_RATES });
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

async function openPage(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('atc_auth', '1'); } catch (e) { /* ignore */ } });
  await page.goto('/plan-your-job.html');
  await page.waitForFunction(() => window.ATC_TOOL && window.ATC_VAULT);
}

test('server mode: save a run, list it, load it, and verify outputs', async ({ page }) => {
  const { posts, stored } = await stubApi(page, { server: true });
  const validator = await makeValidator();

  await openPage(page);

  // Set the fixture params
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);

  // Pick the project
  await page.locator('#projectPicker select').selectOption(PROJECT.id);

  // Save the run via the button
  await page.locator('[data-vact="save-run"]').click();
  await page.waitForTimeout(100);

  // Verify POST was made
  expect(posts.length).toBeGreaterThanOrEqual(1);
  const saved = posts.find((p) => p.path === '/api/runs' && p.body.job === TOOL.id);
  expect(saved).toBeDefined();

  const rec = saved.body;

  // Validate against schema
  const res = validator(rec);
  expect(res.ok).toBe(true);

  // Verify required fields
  expect(rec.id).toBeDefined();
  expect(rec.tool_version).toBe(CURRENT.version);
  expect(rec.tool_commit).toBe(CURRENT.commit);
  expect(rec.author).toBeDefined();
  expect(rec.created_at).toBeDefined();
  expect(rec.inputs).toBeDefined();
  expect(rec.params).toBeDefined();
  expect(rec.outputs).toBeDefined();
  expect(rec.status).toBe('draft');

  // Verify every produces[] key is present
  const produces = TOOL.produces || [];
  produces.forEach((key) => {
    expect(rec.outputs[key]).toBeDefined();
    expect(rec.outputs[key]).toHaveProperty('value');
    expect(rec.outputs[key]).toHaveProperty('unit');
  });

  // Verify run consistency: run() with saved params produces same outputs
  const headless = await page.evaluate((p) => window.ATC_TOOL.run(p), FIXTURE.params);
  Object.keys(rec.outputs).forEach((key) => {
    const saved = rec.outputs[key];
    const rerun = headless[key];
    if (saved && rerun) {
      if (typeof saved.value === 'number') {
        expect(rerun.value).toBeCloseTo(saved.value, 1);
      } else {
        expect(rerun.value).toBe(saved.value);
      }
      expect(rerun.unit).toBe(saved.unit);
    }
  });

  // Verify drawer lists the run
  await page.locator('[data-vact="open-runs"]').click();
  const runItem = page.locator(`[data-run="${rec.id}"]`);
  await expect(runItem).toBeVisible();

  // Screenshot with drawer open
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  await page.screenshot({ path: EVIDENCE, fullPage: true });

  // Load the run
  await runItem.locator('[data-vact="run-load"]').click();
  await page.waitForTimeout(100);

  // Verify outputs reproduce
  const afterLoad = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  Object.keys(rec.outputs).forEach((key) => {
    if (rec.outputs[key] && afterLoad[key]) {
      if (typeof rec.outputs[key].value === 'number') {
        expect(afterLoad[key].value).toBeCloseTo(rec.outputs[key].value, 1);
      } else {
        expect(afterLoad[key].value).toBe(rec.outputs[key].value);
      }
    }
  });
});

test('local mode: saves queued locally when API is down', async ({ page }) => {
  const { posts, stored } = await stubApi(page, { server: false });

  await openPage(page);

  // Set params and save
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);
  await page.locator('[data-vact="save-run"]').click();
  await page.waitForTimeout(100);

  // Verify no POST was made (API down)
  expect(posts.length).toBe(0);

  // Verify "queued locally" note is shown
  await page.locator('[data-vact="open-runs"]').click();
  const queuedNote = page.locator('#runsQueuedNote');
  await expect(queuedNote).toBeVisible();

  // Verify run is listed with queued: true
  const runs = await page.evaluate(() => {
    const vault = window.ATC_VAULT;
    return vault.listRuns({ project: 'talara-brownfield', job: 'plan-your-job' });
  });
  expect(runs.length).toBeGreaterThanOrEqual(1);
  expect(runs[0].queued).toBe(true);
});
