// M05: the Financial Model writes a Run on save, lists it in the Runs drawer,
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

const TOOL = readJson('tools/financial-model/tool.json');
const CURRENT = TOOL.versions.find((v) => v.version === TOOL.aliases.current);
const SCHEMA = readJson('docs/vault-hub/schemas/run-record.schema.json');
const FIXTURE = readJson('test/e2e/fixtures/financial-model.json');
const EVIDENCE = resolve(root, 'docs/vault-hub/evidence/m05-financial-model.png');

const ME = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris Hopkinson', role: 'partner' };
const PROJECT = { id: 'test-project', name: 'Test Project', client_id: 'test-client', default_legal_tag: 'lt-test-internal' };

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
      return { ok: !missing.length, errors: `missing ${missing} (ajv unavailable)` };
    };
  }
}

/** Stubs /api/**. server:false answers 404 everywhere. */
async function stubApi(page, { server }) {
  const posts = [];
  const stored = [];
  await page.route(/unpkg\.com|openfreemap|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!server) return json(404, { error: { message: 'no api' } });
    if (path === '/api/me') return json(200, ME);
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

async function openPage(page) {
  await page.goto('/financial-modelling.html');
  await page.waitForFunction(() => window.ATC_TOOL && window.ATC_VAULT && document.querySelector('#runsBtn'));
}

test('save writes a valid Run, run() reproduces it, the drawer lists, loads and supersedes it', async ({ page }) => {
  const validate = await makeValidator();
  const api = await stubApi(page, { server: true });
  await openPage(page);

  // Project picker is mounted in the header and fed by /api/projects.
  const picker = page.locator('#projectPicker select');
  await expect(picker.locator(`option[value="${PROJECT.id}"]`)).toHaveCount(1);
  await picker.selectOption(PROJECT.id);

  // Set the fixture params
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);

  // Click save run
  await page.locator('#saveRunBtn').click();
  await expect.poll(() => api.posts.length).toBe(1);

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
  expect(rec.inputs.length + Object.keys(rec.assumptions || {}).length).toBeGreaterThan(0);
  for (const key of TOOL.produces) {
    expect(rec.outputs, `output ${key}`).toHaveProperty(key);
    expect(typeof rec.outputs[key].value).toBe('number');
    expect(rec.outputs[key].unit).toBeTruthy();
  }

  // AC2: headless run() equals what was saved.
  const rerun = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(rerun).toEqual(rec.outputs);

  // Runs drawer.
  await page.locator('#runsBtn').click();
  const rows = page.locator('#runsList .run');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(ME.id);
  await expect(rows.first()).toContainText(`v${CURRENT.version}`);
  await expect(rows.first()).toContainText('draft');
  await expect(page.locator('#runsQueuedNote')).toBeHidden();
  await expect(rows.first().locator('[data-vact="run-load"]')).toBeVisible();
  await expect(rows.first().locator('[data-vact="run-supersede"]')).toBeVisible();

  mkdirSync(dirname(EVIDENCE), { recursive: true });
  await page.waitForTimeout(450);   // let the drawer finish sliding in
  await page.screenshot({ path: EVIDENCE });

  // AC3: change the working state, then Load the run and get the same outputs back.
  await page.evaluate(() => {
    const p = window.ATC_TOOL.getParams();
    p.brent = 85;
    window.ATC_TOOL.setParams(p);
  });
  const changed = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(changed).not.toEqual(rec.outputs);
  await rows.first().locator('[data-vact="run-load"]').click();
  await page.waitForTimeout(100);  // wait for async loadRunAction to complete
  const reloaded = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(reloaded).toEqual(rec.outputs);
  expect(await page.evaluate(() => window.ATC_TOOL.getParams().brent)).toBe(FIXTURE.params.brent);

  // Supersede with the current inputs posts to the supersede route and points at the old run.
  await page.locator('#runsBtn').click();
  await page.locator('#runsList .run [data-vact="run-supersede"]').first().click();
  await expect.poll(() => api.posts.length).toBe(2);
  expect(api.posts[1].path).toBe(`/api/runs/${rec.id}/supersede`);
  expect(api.posts[1].body.supersedes).toBe(rec.id);
  const v2 = validate(api.posts[1].body);
  expect(v2.ok, v2.errors).toBe(true);
  await expect(page.locator('#runsList .badge', { hasText: 'superseded' })).toHaveCount(1);

  // AC4: no provider key anywhere in the page.
  expect(await page.content()).not.toContain('sk-ant-');
});

test('local mode: the run is queued and the drawer says so', async ({ page }) => {
  await stubApi(page, { server: false });
  await openPage(page);
  // Save is available offline: the client queues the run and syncs later.
  await expect(page.locator('#saveRunBtn')).toBeVisible();
  await expect(page.locator('#runsBtn')).toBeVisible();
  await page.evaluate((p) => window.ATC_TOOL.setParams(p), FIXTURE.params);
  await page.waitForTimeout(200);
  await page.locator('#saveRunBtn').click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('vault_queue_v1') || '[]').length)).toBe(1);
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('vault_queue_v1') || '[]')[0]);
  const rec = queued.record || queued.run || queued;
  expect(rec.job).toBe('financial-model');
  expect(Object.keys(rec.outputs)).toEqual(expect.arrayContaining(['npv10', 'irr', 'payback_year']));
  await page.locator('#runsBtn').click();
  await expect(page.getByText(/queued locally/i).first()).toBeVisible();
});
