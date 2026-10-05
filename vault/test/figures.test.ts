// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.7, W7-AC15; data review 03 §5.1 S1): project_figures.
// One dated, unit-bearing figure per (project, asset, job, name) from the newest non-superseded run per job
// and from the register; unit, as_of and source_ref never null; a newer run replaces the row; a run that is
// superseded with nothing newer leaves its row marked; the register row carries its unit and provenance.
// Smoke tests written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-figures-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { refreshFigures } = await import('../src/jobs/figures.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ben: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const base = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown> = {}) => ({ ...base, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], asset_ids: [], project_id: 'fig-p', client_id: 'frontera', legal_tag: 'lt-frontera-nda-2026', ...o });
const rows = async (project = 'fig-p') => (await db.query<any>("SELECT project_id, asset_id, job, name, value::float AS value, unit, to_char(as_of,'YYYY-MM-DD') AS as_of, source_ref, provenance, run_status, superseded, stale FROM project_figures WHERE project_id = $1 ORDER BY job, name", [project])).rows;
const DOC = randomUUID();

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query(`INSERT INTO projects (id,client_id,name,default_legal_tag,members,stage,stage_history,register) VALUES ('fig-p','frontera','Figures project','lt-frontera-nda-2026','{chris}','Qualified',
    '[{"stage":"Initial screen","at":"2026-08-01T09:00:00Z","by":"chris"},{"stage":"Qualified","at":"2026-08-20T09:00:00Z","by":"chris"}]'::jsonb, '{"current": 16, "plan": 22}'::jsonb)`);
  await db.query("INSERT INTO items (id,type,title,created_at,project_id,client_id,legal_tag,origin,content_hash,version) VALUES ($1,'report','Operator annual report','2026-09-14T10:00:00Z','fig-p','frontera','lt-frontera-nda-2026','{\"source\":\"research\"}'::jsonb,$2,1)", [DOC, hashOf(DOC)]);
  partner = await appFor(`chris@${DOMAIN}`);
  ben = await appFor(`ben@${DOMAIN}`);
});
after(async () => { await db.close(); });

let first: string, second: string, third: string;

test('S1: the newest run per job and the register each give rows with unit, as_of and source_ref; an output without a unit is left out', async () => {
  const r1 = run({ created_at: '2026-09-01T10:00:00Z', title: 'Screen v1', outputs: { technical_potential_bopd: { value: 4200, unit: 'bopd' }, npv10: { value: 12.5, unit: 'MMUSD' }, wells: { value: 3 } } });
  assert.equal((await call(partner, 'POST', '/api/runs', r1)).status, 201);
  first = r1.id;
  const s = await refreshFigures(db, { projectId: 'fig-p', now: new Date('2026-09-20T12:00:00Z') });
  assert.equal(s.projects, 1);
  assert.equal(s.without_unit, 1, 'the unitless output is counted, never stored');
  const got = await rows();
  for (const f of got) { assert.ok(f.unit, `${f.name} has a unit`); assert.ok(f.as_of, `${f.name} has a date`); assert.ok(f.source_ref, `${f.name} has a source`); }
  const tp = got.find(f => f.job === 'opportunity-register' && f.name === 'technical_potential_bopd');
  assert.deepEqual(tp, { project_id: 'fig-p', asset_id: null, job: 'opportunity-register', name: 'technical_potential_bopd', value: 4200, unit: 'bopd', as_of: '2026-09-01', source_ref: `run:${first}`, provenance: 'run', run_status: 'draft', superseded: false, stale: false });
  assert.ok(got.find(f => f.name === 'npv10' && f.unit === 'MMUSD' && f.value === 12.5));
  assert.equal(got.find(f => f.name === 'wells'), undefined);
  // The register's current and plan: the Hub's unit, dated by the stage history (no source accepted yet).
  const cur = got.find(f => f.job === 'register' && f.name === 'current');
  assert.deepEqual(cur, { project_id: 'fig-p', asset_id: null, job: 'register', name: 'current', value: 16, unit: 'kboe/d', as_of: '2026-08-20', source_ref: 'register', provenance: 'register', run_status: null, superseded: false, stale: false });
  assert.equal(got.find(f => f.job === 'register' && f.name === 'plan')?.value, 22);
  assert.equal(got.length, 4);
});

test('S1: a newer run replaces the row (same key, new value, date and source); an output the newer run no longer gives is marked superseded', async () => {
  const r2 = run({ created_at: '2026-09-10T10:00:00Z', title: 'Screen v2', outputs: { technical_potential_bopd: { value: 5000, unit: 'bopd' } } });
  assert.equal((await call(partner, 'POST', '/api/runs', r2)).status, 201);
  second = r2.id;
  await refreshFigures(db, { projectId: 'fig-p' });
  const got = await rows();
  const tp = got.find(f => f.job === 'opportunity-register' && f.name === 'technical_potential_bopd')!;
  assert.equal(tp.value, 5000); assert.equal(tp.as_of, '2026-09-10'); assert.equal(tp.source_ref, `run:${second}`); assert.equal(tp.superseded, false);
  assert.equal(got.filter(f => f.name === 'technical_potential_bopd').length, 1, 'one row per key');
  const npv = got.find(f => f.name === 'npv10')!;
  assert.equal(npv.superseded, true);
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM project_figures_current WHERE project_id = 'fig-p' AND name = 'npv10'")).rows[0].n, 0, 'the current view hides it');
});

test('S1: supersession and stale are copied from the run; a job whose runs are all superseded keeps its row, marked', async () => {
  const r3 = run({ created_at: '2026-09-12T10:00:00Z', title: 'Screen v3', outputs: { technical_potential_bopd: { value: 6000, unit: 'bopd' } } });
  assert.equal((await call(partner, 'POST', `/api/runs/${second}/supersede`, r3)).status, 201);
  third = r3.id;
  await db.query('UPDATE runs SET stale = true WHERE id = $1', [third]);
  await refreshFigures(db, { projectId: 'fig-p' });
  let tp = (await rows()).find(f => f.job === 'opportunity-register' && f.name === 'technical_potential_bopd')!;
  assert.equal(tp.source_ref, `run:${third}`); assert.equal(tp.value, 6000); assert.equal(tp.stale, true); assert.equal(tp.superseded, false);
  // Every run of the job superseded (the row's status is the one mutable field): the figure stays, marked, out of the current view.
  await db.query("UPDATE runs SET status = 'superseded' WHERE id = ANY($1::uuid[])", [[first, third]]);
  await refreshFigures(db, { projectId: 'fig-p' });
  tp = (await rows()).find(f => f.job === 'opportunity-register' && f.name === 'technical_potential_bopd')!;
  assert.equal(tp.superseded, true); assert.equal(tp.source_ref, `run:${third}`);
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM project_figures_current WHERE project_id = 'fig-p' AND job = 'opportunity-register'")).rows[0].n, 0);
});

test('S1: an accepted research figure gives the register row provenance research, the document as source and the acceptance date', async () => {
  await db.query(`UPDATE projects SET register = register || $2::jsonb WHERE id = $1`, ['fig-p', JSON.stringify({ current: '4,200 bopd (2023)', current_kboed: 4.2, current_source: { item_id: DOC, quote: 'produced 4,200 bopd', accepted_by: 'chris', accepted_at: '2026-09-15T08:00:00Z' } })]);
  await refreshFigures(db, { projectId: 'fig-p' });
  const cur = (await rows()).find(f => f.job === 'register' && f.name === 'current')!;
  assert.equal(cur.value, 4.2); assert.equal(cur.unit, 'kboe/d'); assert.equal(cur.as_of, '2026-09-15'); assert.equal(cur.source_ref, `doc:${DOC}`); assert.equal(cur.provenance, 'research');
  // A register unit, when the register says one, is kept as given.
  await db.query(`UPDATE projects SET register = register || '{"plan_unit": "bopd"}'::jsonb WHERE id = $1`, ['fig-p']);
  await refreshFigures(db, { projectId: 'fig-p' });
  assert.equal((await rows()).find(f => f.job === 'register' && f.name === 'plan')!.unit, 'bopd');
});

test('S1: the nightly pass covers every project and records a job row; partners refresh one project on demand, associates cannot', async () => {
  const s = await refreshFigures(db);
  assert.ok(s.projects >= 2, 'firm and fig-p at least');
  assert.equal(s.rows, 3, 'the superseded figure, current and plan; npv10 is no longer derived');
  const job = (await db.query<any>("SELECT status, summary FROM jobs WHERE name = 'figures' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(job.status, 'ok'); assert.equal(job.summary.rows, s.rows);
  const r = await call(partner, 'POST', '/api/projects/fig-p/figures/refresh');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.project_id, 'fig-p');
  assert.ok(body.figures.every((f: any) => f.unit && f.as_of && f.source_ref));
  assert.ok(body.figures.some((f: any) => f.job === 'register' && f.name === 'current' && f.provenance === 'research'));
  assert.equal((await call(ben, 'POST', '/api/projects/fig-p/figures/refresh')).status, 403);
  assert.equal((await call(partner, 'POST', '/api/projects/nope/figures/refresh')).status, 404);
});
