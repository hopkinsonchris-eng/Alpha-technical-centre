// M05: APEX Reservoir 3D run capture. The page saves a Run, lists it in the Runs
// drawer, reproduces it headlessly, and holds no provider key.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/reservoir-simulator.json', import.meta.url), 'utf8'));
const tool = JSON.parse(readFileSync(new URL('../../tools/apex-reservoir-3d/tool.json', import.meta.url), 'utf8'));
const current = tool.versions.find((v) => v.version === tool.aliases.current);
const RESOLVE = { entry: tool, modules: [], version: current.version, commit: current.commit };
const REQUIRED = ['id', 'job', 'tool_version', 'tool_commit', 'author', 'created_at', 'project_id', 'legal_tag', 'inputs', 'params', 'outputs', 'input_hash', 'status'];

// The 3D view is not under test and the CDN is not reachable from every runner, so three.js is
// answered with a permissive stand-in. The engine, Save and the advisor do not depend on it.
const THREE_STUB = `(function(){
  function stub(){
    var f = function(){};
    return new Proxy(f, {
      get: function(t, k){
        if (k === Symbol.toPrimitive) return function(){ return 0; };
        if (k === 'then') return undefined;
        if (k === 'domElement') { if (!t.__c) t.__c = document.createElement('canvas'); return t.__c; }
        if (!(k in t)) t[k] = stub();
        return t[k];
      },
      set: function(t, k, v){ t[k] = v; return true; },
      apply: function(){ return stub(); },
      construct: function(){ return stub(); }
    });
  }
  window.THREE = stub();
})();`;
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Pre-existing static assets of the page (fonts, three.js, analytics). They are not the
// Vault, not an API and not a provider; everything else must stay on the static server.
const STATIC_ASSET_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'www.googletagmanager.com']);

async function prepare(page, { serverMode }) {
  const captured = [];
  const llmCalls = [];
  const outside = [];
  const pageErrors = [];
  const origin = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:8010').host;
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    if (u.host !== origin && !STATIC_ASSET_HOSTS.has(u.host)) outside.push(req.url());
  });
  await page.addInitScript(() => { try { sessionStorage.setItem('atc_auth', '1'); localStorage.clear(); } catch (e) { /* ignore */ } });
  await page.route('https://cdnjs.cloudflare.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: THREE_STUB }));
  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.googletagmanager.com']) {
    await page.route(`https://${host}/**`, (route) => route.abort());
  }
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (pathname === '/api/me') return serverMode ? json(route, 200, { id: 'chris', name: 'Chris', role: 'partner' }) : json(route, 404, { error: 'not found' });
    if (!serverMode) return json(route, 404, { error: 'not found' });
    if (pathname === '/api/projects') return json(route, 200, [{ id: 'proj-demo', name: 'Demo field study', default_legal_tag: 'lt-demo-client' }]);
    if (pathname === '/api/tools/apex-reservoir-3d/resolve') return json(route, 200, RESOLVE);
    if (pathname === '/api/llm') { llmCalls.push(req.postDataJSON()); return json(route, 501, { error: 'not implemented' }); }
    if (pathname === '/api/runs' && req.method() === 'POST') {
      const body = req.postDataJSON();
      captured.push(body);
      return json(route, 201, { id: body.id, deduplicated: false });
    }
    if (pathname === '/api/runs' && req.method() === 'GET') return json(route, 200, captured);
    if (pathname.startsWith('/api/runs/')) {
      const run = captured.find((r) => pathname === `/api/runs/${r.id}`);
      return run ? json(route, 200, run) : json(route, 404, { error: 'not found' });
    }
    return json(route, 404, { error: 'not found' });
  });
  return { captured, llmCalls, outside, pageErrors };
}

async function openPage(page) {
  await page.goto('/reservoir-simulator.html');
  await page.waitForFunction(() => window.ATC_TOOL && document.readyState === 'complete');
}

async function loadFixture(page) {
  await page.evaluate((f) => window.ATC_TOOL.setParams(f), fixture);
}

test('Save captures a valid Run, the drawer lists it, run() reproduces it', async ({ page }) => {
  const { captured, outside, pageErrors } = await prepare(page, { serverMode: true });
  await openPage(page);
  await expect(page.locator('#toolVersionChip')).toContainText(`v${current.version}`);
  await expect(page.locator('#vaultProject select')).toBeVisible();
  await page.locator('#vaultProject select').selectOption('proj-demo');
  await loadFixture(page);

  await page.locator('#saveRunBtn').click();
  await expect.poll(() => captured.length).toBe(1);
  const run = captured[0];

  for (const k of REQUIRED) expect(run[k], `field ${k}`).toBeDefined();
  expect(run.job).toBe('apex-reservoir-3d');
  expect(run.tool_version).toBe(current.version);
  expect(run.tool_commit).toBe(current.commit);
  expect(run.status).toBe('draft');
  expect(run.project_id).toBe('proj-demo');
  expect(run.legal_tag).toBe('lt-demo-client');
  expect(run.legal_tag).toMatch(/^lt-[a-z0-9-]{3,64}$/);
  expect(run.input_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(run.inputs.length).toBeGreaterThanOrEqual(1);
  expect(run.inputs[0]).toEqual({ ref: 'tool:apex-reservoir-3d', kind: 'manual' });
  expect(Object.keys(run.assumptions).length).toBeGreaterThan(0);
  for (const a of Object.values(run.assumptions)) expect(a).toMatchObject({ source: 'assumed', provenance: 'assumed' });
  for (const key of tool.produces) {
    expect(run.outputs[key], `output ${key}`).toBeDefined();
    expect(run.outputs[key].value).not.toBeNull();
  }
  expect(run.outputs.cum_oil_np.value).toBeGreaterThan(0);
  expect(run.params.P.ni).toBe(fixture.P.ni);
  expect(run.params.WELLS).toHaveLength(fixture.WELLS.length);
  expect(run.outputs.cum_oil_np.high).toBeGreaterThanOrEqual(run.outputs.cum_oil_np.low);

  // AC2/AC3: headless run of the saved params reproduces the saved outputs.
  const again = await page.evaluate(() => window.ATC_TOOL.run(window.ATC_TOOL.getParams()));
  expect(again).toEqual(run.outputs);
  const fromSaved = await page.evaluate((p) => window.ATC_TOOL.run(p), run.params);
  expect(fromSaved).toEqual(run.outputs);

  // The drawer lists it.
  await page.locator('#runsBtn').click();
  await expect(page.locator('#runsDrawer')).toHaveClass(/open/);
  await expect(page.locator('#runsList .run-item')).toHaveCount(1);
  await expect(page.locator('#runsList .run-item').first()).toContainText('APEX Reservoir 3D');
  await expect(page.locator('#runsQueuedNote')).toBeHidden();

  // Load re-applies the params and the re-run reproduces the outputs.
  await page.evaluate(() => window.ATC_TOOL.setParams({ P: { ni: 6, nj: 6, nk: 3 } }));
  await page.locator('#runsList [data-action="load"]').first().click();
  await expect(page.locator('#runsMsg')).toHaveAttribute('data-reproduced', 'true');
  const params = await page.evaluate(() => window.ATC_TOOL.getParams());
  expect(params.P.ni).toBe(fixture.P.ni);
  const inputs = await page.evaluate(() => window.ATC_TOOL.getInputs());
  expect(inputs).toContainEqual({ ref: `run:${run.id}`, kind: 'run', role: 'seed_model' });

  await page.screenshot({ path: 'docs/vault-hub/evidence/m05-reservoir-simulator.png' });
  expect(outside, 'requests that left the static server').toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('no provider key or direct provider call in the page; the advisor degrades on 501', async ({ page, request }) => {
  const { llmCalls, outside, pageErrors } = await prepare(page, { serverMode: true });
  for (const path of ['/reservoir-simulator.html', '/js/vault-client.js']) {
    const src = await (await request.get(path)).text();
    for (const banned of ['sk-ant-', 'api.anthropic.com', 'CLAUDE_KEY_STORE']) expect(src, `${path} contains ${banned}`).not.toContain(banned);
  }
  await openPage(page);
  await loadFixture(page);
  await page.locator('#runBtn').click();
  await expect(page.locator('#statusChip')).toHaveText('Complete', { timeout: 20_000 });
  await expect.poll(() => llmCalls.length).toBeGreaterThanOrEqual(1);
  expect(llmCalls[0]).toMatchObject({ purpose: 'simulator-advice', scope: expect.stringMatching(/^project:/) });
  expect(Array.isArray(llmCalls[0].messages)).toBe(true);
  await expect(page.locator('#aiClaudeBody')).toContainText('AI advisor is available once the Vault assistant is connected');
  await expect(page.locator('#aiClaudeBody')).not.toContainText(/error|✕/i);
  // No key UI remains.
  await expect(page.getByText('API Key')).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.getClaudeKey + typeof window.setClaudeKey)).toBe('undefinedundefined');
  expect(outside, 'requests that left the static server').toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('local mode: the advisor sends nothing and Save queues with the queued note', async ({ page }) => {
  const { outside, pageErrors } = await prepare(page, { serverMode: false });
  const llmPosts = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('request', (req) => { if (req.url().includes('/api/llm')) llmPosts.push(req.url()); });
  await openPage(page);
  await loadFixture(page);
  await page.locator('#saveRunBtn').click();
  await expect(page.locator('#vaultNote')).toContainText('Queued locally');
  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('vault_queue_v1') || '[]'));
  expect(queue).toHaveLength(1);
  expect(queue[0].record.job).toBe('apex-reservoir-3d');
  expect(queue[0].record.project_id).toBe('firm');
  expect(queue[0].record.legal_tag).toBe('lt-firm');

  await page.locator('#runsBtn').click();
  await expect(page.locator('#runsQueuedNote')).toBeVisible();
  await expect(page.locator('#runsQueuedNote')).toContainText('Queued locally');
  await expect(page.locator('#runsList .run-item')).toHaveCount(1);
  await expect(page.locator('#runsList .run-tag.queued')).toBeVisible();

  await page.locator('#runsClose').click();
  await page.locator('#runBtn').click();
  await expect(page.locator('#statusChip')).toHaveText('Complete', { timeout: 20_000 });
  await expect(page.locator('#aiClaudeBody')).toContainText('AI advisor is available once the Vault assistant is connected');
  expect(llmPosts).toEqual([]);
  expect(outside, 'requests that left the static server').toEqual([]);
  expect(pageErrors).toEqual([]);
});
