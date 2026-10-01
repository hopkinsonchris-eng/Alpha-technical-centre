// Wave 4, PR 1 (docs/vault-hub/wave4/05-markup.md §1.3, §1.5): the research routes and triggers.
// POST queues a run (202), extends a queued one, answers 409 while one runs and 501 when switched
// off; GET lists runs and findings; a project the caller cannot see is 404 (W4-AC5). Creating a
// project with a country and attaching a field queue one run between them, and a placeholder
// project queues nothing (W4-AC6). Runs are never started in-process here: the test runs the queue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-research-routes-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureGazetteers } = await import('../src/api/assets.routes.ts');
const { configureResearch } = await import('../src/api/research.routes.ts');
const { runQueued, researchEnabled } = await import('../src/research/run.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>, ana: typeof partner;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const jobs = async (pid: string) => (await db.query<any>("SELECT id, status, summary FROM jobs WHERE name = 'research' AND summary->>'project_id' = $1 ORDER BY id", [pid])).rows;

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('ven-barinas',NULL,'Barinas–Apure Cluster','prospect','lt-firm','VE','{chris}')");
  configureGazetteers({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });
  configureResearch({ autorun: false, skipWorldMonitor: true, skipMiners: true, provider: null });
  partner = await appFor(`chris@${DOMAIN}`); ana = await appFor(`ana@${DOMAIN}`);
});
after(async () => { await db.close(); delete process.env.RESEARCH_ENABLED; });

test('W4-AC5: POST queues a run, a second POST extends it, a running job answers 409, GET shows the runs', async () => {
  const r = await call(partner, 'POST', '/api/projects/ven-barinas/research');
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.project_id, 'ven-barinas'); assert.equal(r.body.state, 'queued'); assert.equal(typeof r.body.job_id, 'number');
  const again = await call(partner, 'POST', '/api/projects/ven-barinas/research');
  assert.equal(again.status, 202); assert.equal(again.body.state, 'extended'); assert.equal(again.body.job_id, r.body.job_id);
  assert.equal((await jobs('ven-barinas')).length, 1, 'one open run per project');
  let g = await call(partner, 'GET', '/api/projects/ven-barinas/research');
  assert.equal(g.status, 200); assert.equal(g.body.enabled, true); assert.equal(g.body.runs[0].status, 'queued'); assert.deepEqual(g.body.findings, []);
  // While the job runs (no longer queued) a POST is refused with the job id.
  await db.query("UPDATE jobs SET summary = summary || '{\"queued\":false}'::jsonb WHERE id = $1", [r.body.job_id]);
  const busy = await call(partner, 'POST', '/api/projects/ven-barinas/research');
  assert.equal(busy.status, 409); assert.equal(busy.body.error.code, 'research_running'); assert.equal(busy.body.error.job_id, r.body.job_id);
  g = await call(partner, 'GET', '/api/projects/ven-barinas/research');
  assert.equal(g.body.runs[0].status, 'running');
  await db.query("UPDATE jobs SET status = 'ok', finished_at = now(), summary = summary || '{\"status\":\"ok\"}'::jsonb WHERE id = $1", [r.body.job_id]);
  g = await call(partner, 'GET', '/api/projects/ven-barinas/research');
  assert.equal(g.body.runs[0].status, 'ok');
  const audit = (await db.query<any>("SELECT scope, detail FROM audit_events WHERE action = 'project.research' ORDER BY id LIMIT 1")).rows[0];
  assert.equal(audit.scope, 'project:ven-barinas'); assert.equal(audit.detail.state, 'queued');
});

test('W4-AC5: a project the caller cannot see is 404 for both verbs; an unknown project is 404', async () => {
  const no = await call(ana, 'POST', '/api/projects/orinoco-partnership/research');
  assert.equal(no.status, 404);
  const noGet = await call(ana, 'GET', '/api/projects/orinoco-partnership/research');
  assert.equal(noGet.status, 404);
  assert.equal((await call(partner, 'POST', '/api/projects/nope/research')).status, 404);
  assert.equal((await jobs('orinoco-partnership')).length, 0);
});

test('W4-AC6: creating a project with a country queues a run; attaching a field extends it with the field name; a placeholder queues nothing', async () => {
  const c = await call(partner, 'POST', '/api/projects', { id: 'hte-ve', name: 'High Tech Electronica', country: 'VE' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  let j = await jobs('hte-ve');
  assert.equal(j.length, 1); assert.equal(j[0].summary.queued, true); assert.deepEqual(j[0].summary.names, ['High Tech Electronica']); assert.equal(j[0].summary.requested_by, 'chris');
  const a = await call(partner, 'POST', '/api/projects/hte-ve/assets', { create: { name: 'Guafita', kind: 'field', lat: 7.6, lon: -70.9, location_source: 'manual' } });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  j = await jobs('hte-ve');
  assert.equal(j.length, 1, 'the attach extends the queued run rather than opening a second');
  assert.deepEqual(j[0].summary.names, ['High Tech Electronica', 'Guafita']);
  // Attaching the same field again changes nothing.
  await call(partner, 'POST', '/api/projects/hte-ve/assets', { asset_id: a.body.asset.id });
  assert.deepEqual((await jobs('hte-ve'))[0].summary.names, ['High Tech Electronica', 'Guafita']);
  // A placeholder without a country queues nothing; the same placeholder with a country does.
  assert.equal((await call(partner, 'POST', '/api/projects', { id: 'blank-1', name: 'New project' })).status, 201);
  assert.equal((await jobs('blank-1')).length, 0);
  assert.equal((await call(partner, 'POST', '/api/projects', { id: 'blank-2', name: 'New project', country: 'CO' })).status, 201);
  assert.equal((await jobs('blank-2')).length, 1);
  // The queue runs what was queued (sources switched off here) and finishes each job.
  const done = await runQueued(db, { skipWorldMonitor: true, skipMiners: true, provider: null, budgetMs: 60_000, budgetGbp: 1 });
  assert.ok(done.length >= 2);
  assert.ok(done.every(d => d.status === 'ok'), JSON.stringify(done.map(d => [d.project_id, d.status, d.warnings])));
  assert.equal((await jobs('hte-ve'))[0].status, 'ok');
  const g = await call(partner, 'GET', '/api/projects/hte-ve/research');
  assert.equal(g.body.runs[0].status, 'ok'); assert.equal(g.body.runs[0].summary.findings, 0);
  // A stuck run (started, never finished) is failed and re-queued once by the next sweep.
  await db.query("INSERT INTO jobs (name, status, started_at, summary) VALUES ('research', 'running', now() - interval '30 minutes', $1::jsonb)", [JSON.stringify({ project_id: 'blank-2', queued: false, names: [] })]);
  const swept = await runQueued(db, { skipWorldMonitor: true, skipMiners: true, provider: null, budgetMs: 60_000, budgetGbp: 1 });
  assert.equal(swept.length, 1); assert.equal(swept[0].project_id, 'blank-2');
  const rows = await jobs('blank-2');
  assert.ok(rows.some(r => r.status === 'failed' && /20 minutes/.test(r.summary.error)));
  assert.equal(rows.filter(r => r.status === 'running').length, 0);
});

test('W4-AC5: RESEARCH_ENABLED=false answers 501 and the triggers do nothing', async () => {
  process.env.RESEARCH_ENABLED = 'false';
  assert.equal(researchEnabled(), false);
  const r = await call(partner, 'POST', '/api/projects/ven-barinas/research');
  assert.equal(r.status, 501); assert.match(r.body.error.message, /RESEARCH_ENABLED/);
  const g = await call(partner, 'GET', '/api/projects/ven-barinas/research');
  assert.equal(g.status, 200); assert.equal(g.body.enabled, false);
  assert.equal((await call(partner, 'POST', '/api/projects', { id: 'off-1', name: 'Switched off', country: 'VE' })).status, 201);
  assert.equal((await jobs('off-1')).length, 0);
  delete process.env.RESEARCH_ENABLED;
  assert.equal(researchEnabled(), true);
});
