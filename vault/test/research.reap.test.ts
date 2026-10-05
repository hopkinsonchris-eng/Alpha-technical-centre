// Wave 7, PR 1 (docs/vault-hub/wave7/05-markup.md §1.6, S16): a research run that has passed its budget
// is reaped by the status route itself, not only by the next cron. GET reports it as failed with the
// reason "reaped"; POST on that project queues a fresh run instead of answering 409; a run still within
// its budget is left alone. Without a provider a run finishes at once with honest "skipped" lines.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-research-reap-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureGazetteers } = await import('../src/api/assets.routes.ts');
const { configureResearch } = await import('../src/api/research.routes.ts');
const { enqueueResearch, reapStaleRuns, runQueued, researchView } = await import('../src/research/run.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const jobs = async (pid: string) => (await db.query<any>("SELECT id, status, finished_at, summary FROM jobs WHERE name = 'research' AND summary->>'project_id' = $1 ORDER BY id", [pid])).rows;
/** A run that started `minutesAgo` and never finished: what a restart or a hung fetch leaves behind. */
const stuckRun = async (pid: string, minutesAgo: number) => (await db.query<{ id: number }>(
  "INSERT INTO jobs (name, status, started_at, summary) VALUES ('research', 'running', now() - ($2::int * interval '1 minute'), $1::jsonb) RETURNING id",
  [JSON.stringify({ project_id: pid, queued: false, status: 'ok', phase: 'literature', findings: 2, proposals: { asset: 0, research: 0 }, sources: { gdelt: { queries: 2, findings: 2, created: 2, updated: 0, unchanged: 0 } }, warnings: [], not_reached: [], budget: { ms: 15 * 60_000, gbp: 3 }, names: ['Llanos screen'] }), minutesAgo])).rows[0].id;

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('llanos-screen',NULL,'Llanos screen','prospect','lt-firm','CO','{chris}')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('talara-screen',NULL,'Talara screen','prospect','lt-firm','PE','{chris}')");
  configureGazetteers({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });
  configureResearch({ autorun: false, skipWorldMonitor: true, skipMiners: true, provider: null });
  partner = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
});
after(async () => { await db.close(); });

test('S16: the status route reaps a run past its budget and says so; POST then queues a fresh run instead of 409', async () => {
  const stale = await stuckRun('llanos-screen', 35);
  const g = await call(partner, 'GET', '/api/projects/llanos-screen/research');
  assert.equal(g.status, 200);
  const run = g.body.runs[0];
  assert.equal(run.id, stale);
  assert.equal(run.status, 'failed', 'a run past its budget is no longer reported as running');
  assert.equal(run.summary.reaped, true);
  assert.ok(run.finished_at, 'the reap stamps when the run was given up');
  assert.match(run.summary.warnings[0], /^reaped: did not finish within 20 minutes/);
  assert.equal(run.summary.findings, 2, 'what the run had filed before it stalled is kept');
  const row = (await jobs('llanos-screen')).find(j => j.id === stale)!;
  assert.equal(row.status, 'failed'); assert.ok(row.finished_at); assert.equal(row.summary.status, 'failed');
  // The button is no longer blocked: a POST queues a new run.
  const p = await call(partner, 'POST', '/api/projects/llanos-screen/research');
  assert.equal(p.status, 202, JSON.stringify(p.body));
  assert.equal(p.body.state, 'queued'); assert.notEqual(p.body.job_id, stale);
  const again = await call(partner, 'GET', '/api/projects/llanos-screen/research');
  assert.equal(again.body.runs[0].status, 'queued');
  assert.equal(again.body.runs[1].status, 'failed', 'the reaped run stays in the history, immutable');
  await db.query("DELETE FROM jobs WHERE id = $1", [p.body.job_id]);
});

test('S16: a run still inside its budget is left running and POST answers 409; a queued run is never reaped', async () => {
  const fresh = await stuckRun('talara-screen', 5);
  const g = await call(partner, 'GET', '/api/projects/talara-screen/research');
  assert.equal(g.body.runs[0].status, 'running');
  assert.equal(g.body.runs[0].summary.reaped, undefined);
  const busy = await call(partner, 'POST', '/api/projects/talara-screen/research');
  assert.equal(busy.status, 409); assert.equal(busy.body.error.job_id, fresh);
  await db.query("DELETE FROM jobs WHERE id = $1", [fresh]);
  const queued = (await db.query<{ id: number }>("INSERT INTO jobs (name, status, started_at, summary) VALUES ('research', 'running', now() - interval '45 minutes', $1::jsonb) RETURNING id", [JSON.stringify({ project_id: 'talara-screen', queued: true, names: [] })])).rows[0].id;
  const q = await call(partner, 'GET', '/api/projects/talara-screen/research');
  assert.equal(q.body.runs[0].status, 'queued', 'a job waiting to start is not a stuck run');
  await db.query("DELETE FROM jobs WHERE id = $1", [queued]);
});

test('S16: the queue reaps before it enqueues, and reapStaleRuns is scoped to one project when asked', async () => {
  const a = await stuckRun('llanos-screen', 40), b = await stuckRun('talara-screen', 40);
  const reaped = await reapStaleRuns(db, { projectId: 'talara-screen' });
  assert.deepEqual(reaped, [b]);
  assert.equal((await jobs('llanos-screen')).find(j => j.id === a)!.status, 'running', 'the other project is untouched by a scoped reap');
  const r = await enqueueResearch(db, 'llanos-screen', 'chris', ['Cubiro']);
  assert.equal(r.state, 'queued', 'a stale run does not count as running at the queue');
  assert.equal((await jobs('llanos-screen')).find(j => j.id === a)!.status, 'failed');
  await db.query("DELETE FROM jobs WHERE id = ANY($1::bigint[])", [[a, b, r.job_id]]);
});

test('S16: without a provider a queued run finishes at once with its honest skipped lines, never sits running', async () => {
  const r = await enqueueResearch(db, 'llanos-screen', 'chris');
  const t0 = Date.now();
  const done = await runQueued(db, { skipWorldMonitor: true, minerAdapters: [], provider: null, budgetMs: 15 * 60_000, budgetGbp: 1, log: () => {} });
  assert.ok(Date.now() - t0 < 10_000, 'the run does not wait on anything');
  const mine = done.find(d => d.project_id === 'llanos-screen')!;
  assert.equal(mine.status, 'ok'); assert.equal(mine.phase, 'done'); assert.ok(mine.finished_at);
  assert.match(mine.sources.web?.skipped ?? '', /no assistant configured/);
  assert.ok(!/[A-Z]{3,}_[A-Z_]+/.test(JSON.stringify(mine.sources)), 'no environment variable names in what the Hub shows: ' + JSON.stringify(mine.sources));
  const view = await researchView(db, 'llanos-screen');
  assert.equal(view.runs[0].id, r.job_id); assert.equal(view.runs[0].status, 'ok');
  await db.query("DELETE FROM jobs WHERE id = $1", [r.job_id]);
});
