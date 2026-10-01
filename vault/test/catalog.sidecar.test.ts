// Wave 2, PR 1: the Hub sidecar tools/<id>/hub.json (docs/vault-hub/wave2/hub-sidecar.md)
// is merged into the catalog as `hub`, and external apps' live versions are read
// from their version_url. Smoke tests for AC8, written before the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, liveVersions, type Catalog } from '../src/catalog.ts';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const FIX = path.join(HERE, 'fixtures/tool-manifest');
const fixture = (n: string) => JSON.parse(readFileSync(path.join(FIX, `${n}.json`), 'utf8'));

function rootWith(tools: { json: any; hub?: unknown; hubText?: string }[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sidecar-'));
  for (const t of tools) {
    const dir = path.join(root, 'tools', t.json.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'tool.json'), JSON.stringify(t.json, null, 2));
    if (t.hubText !== undefined) writeFileSync(path.join(dir, 'hub.json'), t.hubText);
    else if (t.hub !== undefined) writeFileSync(path.join(dir, 'hub.json'), JSON.stringify(t.hub, null, 2));
  }
  return root;
}

const SIDE = { context: ['project'], param: 'project', toolbar: 10, version_url: 'https://apex-app2.onrender.com/version.json' };

test('AC8: a sidecar is merged as `hub`; a tool without one has hub: null; the manifest itself is untouched', () => {
  const root = rootWith([{ json: fixture('valid-1'), hub: SIDE }, { json: fixture('valid-2') }]);
  const cat = buildCatalog(root);
  const reg = cat.tools.find(t => t.id === 'opportunity-register')!;
  const apex = cat.tools.find(t => t.id === 'apex-asset-intelligence')!;
  assert.deepEqual(reg.hub, { ...SIDE, live_version: null });
  assert.equal(apex.hub, null);
  assert.deepEqual(Object.keys(reg).filter(k => !['releases', 'hub'].includes(k)).sort(), Object.keys(fixture('valid-1')).sort());
  rmSync(root, { recursive: true });
});

test('AC8: an invalid sidecar is refused naming the file and the path', () => {
  const cases: [unknown, RegExp][] = [
    [{ context: 'project' }, /hub\.json.*\/context/],
    [{ context: ['planet'] }, /hub\.json.*\/context\/0/],
    [{ context: ['project'], toolbar: 1.5 }, /hub\.json.*\/toolbar/],
    [{ context: ['project'], param: '' }, /hub\.json.*\/param/],
    [{ version_url: 'http://insecure.example/version.json' }, /hub\.json.*\/version_url/],
    [{ context: ['project'], extra: true }, /hub\.json.*\/extra/],
  ];
  for (const [hub, re] of cases) {
    const root = rootWith([{ json: fixture('valid-1'), hub }]);
    assert.throws(() => buildCatalog(root), re, JSON.stringify(hub));
    rmSync(root, { recursive: true });
  }
  const broken = rootWith([{ json: fixture('valid-1'), hubText: '{ nope' }]);
  assert.throws(() => buildCatalog(broken), /tools\/opportunity-register\/hub\.json: invalid JSON/);
  rmSync(broken, { recursive: true });
});

test('AC8: every shipped sidecar is valid and every tool that takes a project declares it', () => {
  const cat = buildCatalog(REPO);
  const withContext = cat.tools.filter(t => t.hub && (t.hub.context ?? []).includes('project')).map(t => t.id);
  for (const id of ['opportunity-register', 'nodal-analysis', 'financial-model', 'apex-reservoir-3d', 'ela-model-suite', 'plan-your-job']) assert.ok(withContext.includes(id), id + ' should take a project');
  for (const id of ['apex-3d-model', 'apex-asset-intelligence']) {
    const t = cat.tools.find(x => x.id === id)!;
    assert.ok(t.hub && /^https:\/\//.test(t.hub.version_url ?? ''), id + ' should publish a version_url');
  }
});

test('AC8: liveVersions reads each version_url with a timeout; failures and bad bodies give null', async () => {
  const root = rootWith([
    { json: fixture('valid-2'), hub: { version_url: 'https://apex-app2.onrender.com/version.json' } },         // ok
    { json: { ...fixture('valid-3'), id: 'slow-app' }, hub: { version_url: 'https://slow.example/version.json' } },   // never answers
    { json: { ...fixture('valid-3'), id: 'bad-app' }, hub: { version_url: 'https://bad.example/version.json' } },    // not JSON
    { json: fixture('valid-1') },                                                                                   // no sidecar
  ]);
  const cat = buildCatalog(root);
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith('https://apex-app2')) return new Response(JSON.stringify({ version: '4.2.0', released_at: '2026-09-12' }), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://bad')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
    return await new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  }) as unknown as typeof fetch;
  const t0 = Date.now();
  const out = await liveVersions(cat, { fetch: fetchImpl, timeoutMs: 200, now: () => new Date('2026-10-01T08:00:00Z') });
  assert.ok(Date.now() - t0 < 1500, 'the slow app must not hold the others');
  assert.deepEqual(calls.sort(), ['https://apex-app2.onrender.com/version.json', 'https://bad.example/version.json', 'https://slow.example/version.json']);
  assert.deepEqual(out.get('apex-asset-intelligence'), { version: '4.2.0', released_at: '2026-09-12', checked_at: '2026-10-01T08:00:00.000Z' });
  assert.equal(out.get('slow-app'), null);
  assert.equal(out.get('bad-app'), null);
  assert.equal(out.has('opportunity-register'), false);
  // Bad shapes: a version that is not a string, or an empty one.
  const bad = (async () => new Response(JSON.stringify({ version: 42 }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const o2 = await liveVersions(cat, { fetch: bad, timeoutMs: 200 });
  assert.equal(o2.get('apex-asset-intelligence'), null);
  rmSync(root, { recursive: true });
});

test('AC8: GET /api/catalog carries hub.live_version once the refresh has run; ?live=wait waits for it', async () => {
  const root = rootWith([{ json: fixture('valid-2'), hub: { version_url: 'https://apex-app2.onrender.com/version.json' } }, { json: fixture('valid-1'), hub: { context: ['project'] } }]);
  process.env.CATALOG_ROOT_DIR = root;
  const db = await openDb(undefined);
  await migrate(db);
  const fetchImpl = (async () => new Response(JSON.stringify({ version: '4.3.1', released_at: '2026-09-30' }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const app = await createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' }, fetch: fetchImpl });
  const r = await app.request('/api/catalog?live=wait');
  assert.equal(r.status, 200);
  const cat = (await r.json()) as Catalog;
  const apex = cat.tools.find(t => t.id === 'apex-asset-intelligence')!;
  assert.equal(apex.hub?.live_version?.version, '4.3.1');
  assert.equal(apex.hub?.live_version?.released_at, '2026-09-30');
  const reg = cat.tools.find(t => t.id === 'opportunity-register')!;
  assert.deepEqual(reg.hub, { context: ['project'], live_version: null });
  await db.close();
  delete process.env.CATALOG_ROOT_DIR;
  rmSync(root, { recursive: true });
});
