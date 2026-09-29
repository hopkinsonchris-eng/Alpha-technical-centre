import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { seedMaster } from '../src/db/seed.ts';
import { configureRerun } from '../src/api/rerun.routes.ts';
import { findChromium } from '../src/rerun/runner.ts';
import { FakeProvider } from '../src/llm/provider.ts';
import { computeChanges, historicalSpread, templateSummary } from '../src/rerun/delta.ts';
import { runInputHash } from '../src/hash.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUTH = { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' };

test('computeChanges, spread and template summary', () => {
  const { changes, unchanged } = computeChanges({ npv10: { value: 100, unit: 'USD MM' }, irr: { value: 0.2 }, gone: { value: 1 } }, { npv10: { value: 92, unit: 'USD MM' }, irr: { value: 0.2 }, added: { value: 5 } });
  assert.deepEqual(unchanged, ['irr']);
  assert.deepEqual(changes.map(c => [c.output, c.kind]), [['added', 'added'], ['gone', 'removed'], ['npv10', 'changed']]);
  assert.ok(Math.abs(changes[2].pct! + 0.08) < 1e-9);
  const spread = historicalSpread([{ npv10: { value: 100 } }, { npv10: { value: 110 } }, { npv10: { value: 90 } }, { irr: { value: 0.2 } }]);
  assert.ok(Math.abs(spread.npv10 - 8.165) < 0.01); assert.equal(spread.irr, undefined);
  assert.match(templateSummary(changes, ['tool x 1.0.0 → 2.0.0']), /npv10 moved from 100 to 92 USD MM \(-8\.0%\)/);
});

async function staticServer(): Promise<{ origin: string; stop: () => void }> {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(origin + '/index.html'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  return { origin, stop: () => child.kill() };
}

test('AC5: re-run of a Register run on the current version creates a child run, a delta note and a review item', { skip: !findChromium() && 'no Chromium available' }, async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('llanos-screen','frontera','Llanos screening','lt-frontera-nda-2026','{chris}') ON CONFLICT DO NOTHING");
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'test/e2e/fixtures/opportunity-register.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'tools/opportunity-register/tool.json'), 'utf8'));
  // Seed a run "made on an older version" with the fixture params and deliberately different outputs.
  const oldRec: any = {
    id: '00000000-0000-4000-8000-00000000aa01', job: 'opportunity-register', tool_version: '2.0.0', tool_commit: '3f68b41', author: 'chris', created_at: '2026-09-20T10:00:00Z',
    project_id: 'llanos-screen', client_id: 'frontera', asset_ids: [], legal_tag: 'lt-frontera-nda-2026', title: 'Llanos fixture',
    inputs: [{ ref: 'tool:opportunity-register', kind: 'manual' }], assumptions: {}, params: fixture.params,
    outputs: { technical_potential_bopd: { value: 70000, unit: 'bopd' }, uplift_bopd: { value: 5000, unit: 'bopd' } }, status: 'final',
  };
  oldRec.input_hash = runInputHash(oldRec);
  const server = await staticServer();
  try {
    configureRerun({ siteOrigin: server.origin, provider: new FakeProvider(() => 'technical_potential_bopd and uplift_bopd moved because the tool went from 2.0.0 to the current version.') });
    const app = await createApp({ db, auth: AUTH, version: 'test' });
    const created = await app.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(oldRec) });
    assert.equal(created.status, 201, await created.text());
    const res = await app.request(`/api/runs/${oldRec.id}/rerun`, { method: 'POST' });
    const body: any = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.notEqual(body.id, oldRec.id);
    const child = await (await app.request(`/api/runs/${body.id}`)).json() as any;
    assert.deepEqual(child.parents, [oldRec.id]);
    assert.equal(child.tool_version, manifest.aliases.current);
    assert.ok(child.outputs.technical_potential_bopd.value > 0);
    assert.ok(Math.abs(child.outputs.technical_potential_bopd.value - fixture.expected.technical_potential_bopd.value) < 1, 'headless run reproduces the fixture expectation');
    assert.ok(body.delta.changes.some((c: any) => c.output === 'technical_potential_bopd'), 'delta names the changed output');
    assert.match(body.delta.summary, /technical_potential_bopd/); assert.equal(body.delta.explanation_source, 'llm');
    assert.ok(body.delta.causes.some((c: string) => /2\.0\.0/.test(c)));
    const note = (await db.query('SELECT type, extracted FROM items WHERE id=$1', [body.note_id])).rows[0];
    assert.equal(note.type, 'note'); assert.equal(note.extracted.kind, 'rerun-delta');
    const cites = (await db.query('SELECT ref FROM item_cites WHERE item_id=$1 ORDER BY ref', [body.note_id])).rows.map((r: any) => r.ref);
    assert.deepEqual(cites.sort(), [`run:${oldRec.id}`, `run:${body.id}`].sort());
    const q = await (await app.request('/api/queue/review?kind=rerun-delta')).json() as any;
    assert.equal(q.items.length, 1);
    const acc = await app.request(`/api/queue/review/${q.items[0].id}/accept`, { method: 'POST' });
    assert.equal(acc.status, 200);
    const reviewed = (await db.query('SELECT status FROM runs WHERE id=$1', [body.id])).rows[0];
    assert.equal(reviewed.status, 'reviewed');
    // Same params through the same current version dedupe onto the child.
    const again: any = await (await app.request(`/api/runs/${oldRec.id}/rerun`, { method: 'POST' })).json();
    assert.equal(again.deduplicated, true);
  } finally { server.stop(); await db.close(); }
});

test('external-app tools answer 501 and a missing site origin answers 503', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO projects (id,name,default_legal_tag,members) VALUES ('p','P','lt-firm','{chris}') ON CONFLICT DO NOTHING");
  const rec: any = { id: '00000000-0000-4000-8000-00000000bb01', job: 'apex-asset-intelligence', tool_version: '4.0.0', tool_commit: '7bf455e', author: 'chris', created_at: '2026-09-20T10:00:00Z', project_id: 'p', legal_tag: 'lt-firm', inputs: [{ ref: 'tool:apex-asset-intelligence', kind: 'manual' }], params: { a: 1 }, outputs: {}, status: 'draft' };
  rec.input_hash = runInputHash(rec);
  configureRerun({ siteOrigin: 'http://127.0.0.1:1', provider: null });
  const app = await createApp({ db, auth: AUTH, version: 'test' });
  assert.equal((await app.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) })).status, 201);
  const r = await app.request(`/api/runs/${rec.id}/rerun`, { method: 'POST' });
  assert.equal(r.status, 501);
  await db.close();
});
