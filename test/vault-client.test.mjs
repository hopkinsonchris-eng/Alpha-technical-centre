/* Smoke tests for the Vault client library (M04), acceptance criteria 1-4.
 *
 * No browser and no server: fetch and localStorage are stubbed on globalThis,
 * and `document` is a tiny event target so the visibilitychange path can be driven.
 *
 *   node --test test/
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* ── shims (installed before the module is imported) ─────────────────── */

const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  },
});

const listeners = {};
const fakeDocument = {
  visibilityState: 'visible',
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  fire(type) { for (const fn of listeners[type] || []) fn({ type }); },
};
Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: fakeDocument });

const net = {
  calls: [],            // {method, path, body}
  meStatus: 401,        // what GET /api/me answers
  resolveVersion: '1.2.3',
  resolveStatus: 200,
  runsPosted: [],
  projects: [],         // what GET /api/projects answers
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
net.files = [];           // what GET /api/projects/:id/files answers
net.originalStatus = 200; // what GET /api/items/:id/original answers
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const path = String(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  net.calls.push({ method, path, body, credentials: init.credentials });
  // Wave 8 PR 2 (W8-AC12): the files of a project and the bytes of an original.
  const files = /^\/api\/projects\/([^/]+)\/files$/.exec(path);
  if (files) return json(200, { project_id: files[1], count: net.files.length, generated_at: '2026-10-08T07:00:00.000Z', files: net.files });
  const orig = /^\/api\/items\/([^/]+)\/original(\?.*)?$/.exec(path);
  if (orig) {
    if (net.originalStatus !== 200) return json(net.originalStatus, { error: { code: 'not_found', message: 'no original' } });
    return new Response(new Uint8Array([0x61, 0x2c, 0x31, 0x0a]), { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': "inline; filename*=UTF-8''production%20v2.csv" } });
  }
  if (path === '/api/me') return net.meStatus === 200 ? json(200, { id: 'chris', email: 'chris@example.com', name: 'Chris', role: 'partner' }) : json(net.meStatus, { error: { code: 'unauthorized', message: 'no' } });
  if (/^\/api\/tools\/[^/]+\/resolve$/.test(path)) {
    return net.resolveStatus === 200
      ? json(200, { entry: '/opportunity-register.html', modules: [], version: net.resolveVersion, commit: 'abc1234' })
      : json(net.resolveStatus, { error: { code: 'x', message: 'down' } });
  }
  if (method === 'POST' && path === '/api/runs') { net.runsPosted.push(body); return json(200, { id: body.id, deduplicated: false }); }
  if (path === '/api/projects') return json(200, { projects: net.projects });
  return json(404, { error: { code: 'not_found', message: 'nope' } });
};

const { vault } = await import('../js/vault-client.js');

/* ── fixtures ────────────────────────────────────────────────────────── */

const partialRun = (over = {}) => ({
  job: 'opportunity-register',
  project_id: 'firm',
  legal_tag: 'lt-firm-internal',
  inputs: [{ ref: 'ref:price_decks/brent-2026-09', kind: 'reference', version: 3 }],
  params: { discount: 0.1, wells: 4 },
  outputs: { npv10: { value: 12.5, unit: 'MMUSD' } },
  status: 'draft',
  ...over,
});
const runCalls = () => net.calls.filter((c) => c.path.startsWith('/api/runs'));

beforeEach(() => {
  store.clear();
  net.calls = []; net.runsPosted = [];
  net.meStatus = 401; net.resolveVersion = '1.2.3'; net.resolveStatus = 200; net.files = []; net.originalStatus = 200;
  fakeDocument.visibilityState = 'visible';
  vault.configure({ apiBase: '' });          // resets mode, person, resolve cache
});

/* ── AC1 canonicalHash ───────────────────────────────────────────────── */

describe('canonicalHash', () => {
  test('key order does not matter, at any depth', async () => {
    const a = await vault.canonicalHash({ b: 1, a: 2, n: { y: [1, { q: 1, p: 2 }], x: null } });
    const b = await vault.canonicalHash({ n: { x: null, y: [1, { p: 2, q: 1 }] }, a: 2, b: 1 });
    assert.equal(a, b);
    assert.match(a, /^sha256:[0-9a-f]{64}$/);
  });

  test('1.0 and 1 hash equal; different values differ; array order matters', async () => {
    assert.equal(await vault.canonicalHash({ v: 1.0 }), await vault.canonicalHash({ v: 1 }));
    assert.equal(await vault.canonicalHash(-0), await vault.canonicalHash(0));
    assert.notEqual(await vault.canonicalHash({ v: 1 }), await vault.canonicalHash({ v: 2 }));
    assert.notEqual(await vault.canonicalHash([1, 2]), await vault.canonicalHash([2, 1]));
  });

  test('matches an independently computed SHA-256', async () => {
    const { createHash } = await import('node:crypto');
    const expected = 'sha256:' + createHash('sha256').update('{"a":2,"b":[1,"x"]}').digest('hex');
    assert.equal(await vault.canonicalHash({ b: [1, 'x'], a: 2 }), expected);
  });

  test('NaN and Infinity throw, with the path', async () => {
    await assert.rejects(vault.canonicalHash({ a: NaN }), /\$\.a/);
    await assert.rejects(vault.canonicalHash({ a: [1, Infinity] }), /\$\.a\[1\]/);
    await assert.rejects(vault.canonicalHash(-Infinity));
  });
});

/* ── AC2 local mode queue, then flush ────────────────────────────────── */

describe('local mode queue', () => {
  test('saveRun queues, listRuns shows it as queued, flushQueue posts each once and empties', async () => {
    assert.equal(await vault.me(), null);
    assert.equal(vault.mode(), 'local');

    const r1 = await vault.saveRun(partialRun({ title: 'one' }));
    const r2 = await vault.saveRun(partialRun({ title: 'two', params: { discount: 0.12 } }));
    assert.equal(r1.queued, true);
    assert.equal(r2.queued, true);
    assert.equal(runCalls().length, 0, 'nothing posted while offline');

    const listed = await vault.listRuns({ project: 'firm' });
    assert.deepEqual(listed.map((r) => r.id).sort(), [r1.id, r2.id].sort());
    assert.ok(listed.every((r) => r.queued === true));
    assert.equal((await vault.listRuns({ project: 'other' })).length, 0);
    assert.equal(JSON.parse(store.get('vault_queue_v1')).length, 2);

    // The API comes back.
    net.meStatus = 200;
    const sent = await vault.flushQueue();
    assert.equal(sent, 2);
    assert.equal(vault.mode(), 'server');
    const posts = net.calls.filter((c) => c.method === 'POST' && c.path === '/api/runs');
    assert.equal(posts.length, 2, 'each queued run posted exactly once');
    assert.deepEqual(net.runsPosted.map((r) => r.id).sort(), [r1.id, r2.id].sort());
    for (const rec of net.runsPosted) {
      assert.equal(rec.author, 'chris');
      assert.equal(rec.tool_version, '1.2.3');
      assert.equal(rec.tool_commit, 'abc1234');
      assert.match(rec.input_hash, /^sha256:[0-9a-f]{64}$/);
    }
    assert.deepEqual(JSON.parse(store.get('vault_queue_v1')), []);

    assert.equal(await vault.flushQueue(), 0);
    assert.equal(net.calls.filter((c) => c.method === 'POST').length, 2, 'a second flush posts nothing');
  });

  test('in server mode saveRun fills author/version/hash and posts directly', async () => {
    net.meStatus = 200;
    const res = await vault.saveRun(partialRun());
    assert.equal(res.queued, false);
    assert.equal(res.deduplicated, false);
    const rec = net.runsPosted[0];
    assert.equal(rec.id, res.id);
    assert.equal(rec.author, 'chris');
    assert.equal(rec.tool_version, '1.2.3');
    assert.equal(rec.tool_commit, 'abc1234');
    assert.ok(!Number.isNaN(Date.parse(rec.created_at)));
    const p = partialRun();
    assert.equal(rec.input_hash, await vault.canonicalHash({ inputs: p.inputs, params: p.params, assumptions: {} }));
    assert.equal(store.get('vault_queue_v1'), undefined);
  });
});

/* ── AC3 client-side rejection ───────────────────────────────────────── */

describe('client-side validation', () => {
  test('a missing required field is rejected with its JSON path and no fetch call', async () => {
    net.meStatus = 200;                       // even with a reachable API, nothing is sent
    const bad = partialRun(); delete bad.project_id;
    await assert.rejects(vault.saveRun(bad), (e) => {
      assert.match(e.message, /\$\.project_id/);
      assert.equal(e.path, '$.project_id');
      return true;
    });
    assert.equal(net.calls.length, 0, 'zero network calls');
  });

  test('bad nested and formatted fields name their path too', async () => {
    await assert.rejects(vault.saveRun(partialRun({ legal_tag: 'firm' })), /\$\.legal_tag/);
    await assert.rejects(vault.saveRun(partialRun({ status: 'wip' })), /\$\.status/);
    await assert.rejects(vault.saveRun(partialRun({ inputs: [{ ref: 'x' }] })), /\$\.inputs\[0\]\.kind/);
    await assert.rejects(vault.saveRun(partialRun({ outputs: { npv: {} } })), /\$\.outputs\.npv\.value/);
    await assert.rejects(vault.saveRun(partialRun({ params: { x: NaN } })), /\$\.params\.x/);
    assert.equal(net.calls.length, 0);
    assert.equal(store.get('vault_queue_v1'), undefined, 'nothing queued');
  });
});

/* ── AC4 resolve cache and visibilitychange ──────────────────────────── */

describe('resolve', () => {
  const resolveFetches = () => net.calls.filter((c) => /\/resolve$/.test(c.path)).length;

  test('caches for the page lifetime, per tool id', async () => {
    const a = await vault.resolve('opportunity-register');
    const b = await vault.resolve('opportunity-register');
    assert.deepEqual(a, b);
    assert.equal(a.version, '1.2.3');
    assert.equal(resolveFetches(), 1);
    await vault.resolve('other-tool');
    assert.equal(resolveFetches(), 2);
  });

  test('refreshes on visibilitychange (and not while hidden)', async () => {
    assert.equal((await vault.resolve('opportunity-register')).version, '1.2.3');
    assert.equal(resolveFetches(), 1);

    net.resolveVersion = '1.3.0';
    fakeDocument.visibilityState = 'hidden';
    fakeDocument.fire('visibilitychange');
    assert.equal((await vault.resolve('opportunity-register')).version, '1.2.3', 'hidden tab does not refetch');
    assert.equal(resolveFetches(), 1);

    fakeDocument.visibilityState = 'visible';
    fakeDocument.fire('visibilitychange');
    assert.equal((await vault.resolve('opportunity-register')).version, '1.3.0');
    assert.equal(resolveFetches(), 2);
    assert.equal((await vault.resolve('opportunity-register')).version, '1.3.0');
    assert.equal(resolveFetches(), 2, 'cached again after the refresh');
  });

  test('a failed refresh keeps the last good answer; a failed first resolve is not cached', async () => {
    await vault.resolve('opportunity-register');
    net.resolveStatus = 503;
    fakeDocument.fire('visibilitychange');
    assert.equal((await vault.resolve('opportunity-register')).version, '1.2.3');

    await assert.rejects(vault.resolve('never-seen'));
    net.resolveStatus = 200;
    assert.equal((await vault.resolve('never-seen')).version, '1.2.3');
  });
});

/* ── wave 2: the project in the URL (?project=) is the context the Hub toolbar passes ── */

describe('pickProject reads ?project= from the URL (wave 2, AC9)', () => {
  const fakeElement = () => {
    const el = { children: [], textContent: '', style: {}, attrs: {}, listeners: {}, value: '', disabled: false,
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }, dispatchEvent() { return true; } };
    return el;
  };
  beforeEach(() => {
    net.meStatus = 200;
    net.projects = [{ id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield' }, { id: 'firm', name: 'ATC internal' }];
    fakeDocument.createElement = () => fakeElement();
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { pathname: '/nodal-analysis-tool.html', search: '' } });
  });

  test('without an element: the URL project wins over the remembered one and is remembered', async () => {
    globalThis.localStorage.setItem('vault_project_v1:/nodal-analysis-tool.html', 'firm');
    globalThis.location.search = '?project=kaz-brownfield';
    assert.equal(await vault.pickProject(null), 'kaz-brownfield');
    assert.equal(globalThis.localStorage.getItem('vault_project_v1:/nodal-analysis-tool.html'), 'kaz-brownfield');
    globalThis.location.search = '';
    assert.equal(await vault.pickProject(null), 'kaz-brownfield');      // now remembered
  });

  test('with an element: the select lands on the URL project when it is one the caller may see; an unknown id is ignored', async () => {
    globalThis.location.search = '?project=kaz-brownfield';
    const el = fakeElement();
    assert.equal(await vault.pickProject(el), 'kaz-brownfield');
    assert.equal(el.children[0].value, 'kaz-brownfield');
    globalThis.localStorage.clear();
    globalThis.location.search = '?project=no-such-project';
    const el2 = fakeElement();
    assert.equal(await vault.pickProject(el2), null);
    assert.equal(el2.children[0].value, '');
  });

  test('a malformed project parameter is ignored', async () => {
    globalThis.location.search = '?project=../x';
    assert.equal(await vault.pickProject(null), null);
  });
});

/* ── Wave 7 PR3 (03-data-hierarchy.md A10, §7.4 item 1): the asset from the URL, and no number without a unit ── */

describe('saveRun names the asset the page was opened with (wave 7, W7-AC14)', () => {
  beforeEach(() => {
    net.meStatus = 200;
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { pathname: '/nodal-analysis-tool.html', search: '' } });
  });

  test('?asset= beside ?project= becomes asset_ids on the saved run, without the page changing', async () => {
    globalThis.location.search = '?project=kaz-brownfield&asset=well:kz:tengiz-1';
    assert.equal(vault.pageAsset(), 'well:kz:tengiz-1');
    const res = await vault.saveRun(partialRun({ asset_ids: [] }));
    assert.equal(res.queued, false);
    assert.deepEqual(net.runsPosted[0].asset_ids, ['well:kz:tengiz-1']);
    const again = await vault.saveRun(partialRun());             // a page that sends no asset_ids at all
    assert.deepEqual(net.runsPosted[1].asset_ids, ['well:kz:tengiz-1']);
    assert.equal(again.queued, false);
  });

  test('an asset the page already names is kept and the URL asset joins it; without ?asset= nothing is added', async () => {
    globalThis.location.search = '?asset=well:kz:tengiz-1';
    await vault.saveRun(partialRun({ asset_ids: ['field:kz:tengiz'] }));
    assert.deepEqual(net.runsPosted[0].asset_ids, ['field:kz:tengiz', 'well:kz:tengiz-1']);
    await vault.saveRun(partialRun({ asset_ids: ['well:kz:tengiz-1'] }));
    assert.deepEqual(net.runsPosted[1].asset_ids, ['well:kz:tengiz-1'], 'not duplicated');
    globalThis.location.search = '';
    assert.equal(vault.pageAsset(), null);
    await vault.saveRun(partialRun({ asset_ids: [] }));
    assert.deepEqual(net.runsPosted[2].asset_ids, []);
    await vault.saveRun(partialRun());
    assert.equal(net.runsPosted[3].asset_ids, undefined, 'a record that never had asset_ids gains none');
  });

  test('a malformed asset parameter is ignored', async () => {
    globalThis.location.search = '?asset=../x';
    assert.equal(vault.pageAsset(), null);
    await vault.saveRun(partialRun({ asset_ids: [] }));
    assert.deepEqual(net.runsPosted[0].asset_ids, []);
    globalThis.location.search = '?asset=' + encodeURIComponent('well:kz:tengiz 1');
    assert.equal(vault.pageAsset(), null);
  });
});

describe('a numeric output must carry its unit (wave 7, §7.4)', () => {
  test('a number without a unit is refused with its path and nothing is sent or queued', async () => {
    net.meStatus = 200;
    await assert.rejects(vault.saveRun(partialRun({ outputs: { npv10: { value: 12.5 } } })), (e) => {
      assert.match(e.message, /\$\.outputs\.npv10\.unit/);
      assert.equal(e.code, 'invalid_run');
      assert.equal(e.path, '$.outputs.npv10.unit');
      return true;
    });
    await assert.rejects(vault.saveRun(partialRun({ outputs: { npv10: { value: 12.5, unit: '' } } })), /\$\.outputs\.npv10\.unit/);
    await assert.rejects(vault.saveRun(partialRun({ outputs: { ok: { value: 1, unit: 'bopd' }, bad: { value: 2 } } })), /\$\.outputs\.bad\.unit/);
    assert.equal(net.calls.length, 0);
    assert.equal(store.get('vault_queue_v1'), undefined, 'nothing queued');
  });

  test('a unitless output that is not a number is still accepted (a flag, a label, a ranking)', async () => {
    net.meStatus = 200;
    const res = await vault.saveRun(partialRun({ outputs: { risk: { value: 'amber' }, screened: { value: true }, npv10: { value: 12.5, unit: 'MMUSD' } } }));
    assert.equal(res.queued, false);
    assert.deepEqual(Object.keys(net.runsPosted[0].outputs), ['risk', 'screened', 'npv10']);
  });
});

/* ── wave 8 PR 2 (W8-AC12): the project's files and an original's bytes ── */

describe('files, readOriginal and pickItem (wave 8, W8-AC12)', () => {
  const ID = '00000000-0000-4000-8000-000000000505';
  const FILE = { id: ID, name: 'production.xlsx', title: 'production.xlsx', path: null, source: 'upload', type: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 20480, version: 2, created_at: '2026-10-07T17:34:46.357Z', authored_at: null };

  test('local mode: files answers [] and pickItem resolves null, with no request to the route', async () => {
    assert.deepEqual(await vault.files('parker-creek'), []);
    assert.equal(await vault.pickItem({ project: 'parker-creek' }), null);
    assert.equal(net.calls.filter((c) => c.path.includes('/files')).length, 0);
  });

  test('server mode: files reads GET /api/projects/:id/files and returns the rows', async () => {
    net.meStatus = 200; net.files = [FILE];
    const rows = await vault.files('parker-creek');
    assert.deepEqual(rows, [FILE]);
    assert.ok(net.calls.some((c) => c.method === 'GET' && c.path === '/api/projects/parker-creek/files'));
    await assert.rejects(vault.files(''), /projectId/);
  });

  test('readOriginal fetches the originals route with the session cookie and returns bytes, mime and the filename from the disposition', async () => {
    net.meStatus = 200;
    const o = await vault.readOriginal(ID);
    assert.deepEqual([...o.bytes], [0x61, 0x2c, 0x31, 0x0a]);
    assert.equal(o.mime, 'text/csv');
    assert.equal(o.filename, 'production v2.csv');
    assert.equal(o.id, ID);
    const call = net.calls.find((c) => c.path.startsWith('/api/items/' + ID + '/original'));
    assert.ok(call, 'the originals route was read');
    assert.equal(call.credentials, 'same-origin');
    const v = await vault.readOriginal(ID, { version: 1, filename: 'given.csv' });
    assert.equal(v.filename, 'given.csv');
    assert.equal(v.version, 1);
    assert.ok(net.calls.some((c) => c.path === '/api/items/' + ID + '/original?version=1'));
    await assert.rejects(vault.readOriginal('not-an-id'), /record id/);
    net.originalStatus = 404;
    await assert.rejects(vault.readOriginal(ID), (e) => { assert.equal(e.status, 404); return true; });
  });
});

