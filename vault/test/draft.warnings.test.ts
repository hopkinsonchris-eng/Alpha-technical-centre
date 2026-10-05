// Wave 7 PR3 (docs/vault-hub/wave7/03-data-hierarchy.md A6, §3.2 (i) and §7.4): the drafter warns when a letter
// cites a draft run or a run older than a newer document on the project; the context carries each run's asset_ids,
// created_at and outputs with units; and a cited sentence whose figure is not a value (and unit, when stated) of the
// cited run's outputs or assumptions becomes a question, so the model cannot quietly convert or invent a number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureDraft } from '../src/api/draft.routes.ts';
import { FakeProvider } from '../src/llm/provider.ts';
import { checkFigures } from '../src/llm/draft.ts';

const AUTH = { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' };
const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const json = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const H = (c: string) => 'sha256:' + c.repeat(64);
const P = 'orinoco-partnership';

const OUTPUTS = { operating_point_rate: { value: 897.7, unit: 'bopd' }, operating_point_bhp: { value: 3017.1, unit: 'psia' }, water_cut: { value: 0.25, unit: 'fraction' } };
const ASSUMPTIONS = { skin: { value: 3, source: 'client-stated', provenance: 'client-stated' }, oilGrad: { value: 0.34, unit: 'psi/ft', source: 'assumed', provenance: 'assumed' } };

async function setup(provider: FakeProvider | null) {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = $1", [P]);
  configureDraft({ provider, search: {} });
  return { db, app: await createApp({ db, auth: AUTH, version: 'test' }) };
}
async function insertRun(db: any, over: { id?: string; status?: string; created_at?: string; title?: string } = {}) {
  const id = over.id ?? randomUUID();
  const rec = { id, job: 'nodal-analysis', tool_version: '1.0.0', tool_commit: 'abc1234', author: 'chris', created_at: over.created_at ?? '2026-03-01T10:00:00Z', project_id: P, asset_ids: ['well:ve:guafita-1'],
    legal_tag: 'lt-orinoco-nda-2026', title: over.title ?? 'Guafita-1 nodal', inputs: [{ ref: 'tool:nodal-analysis', kind: 'manual' }], assumptions: ASSUMPTIONS, params: {}, outputs: OUTPUTS, input_hash: H(id[0]), status: over.status ?? 'draft' };
  await db.query('INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,asset_ids,legal_tag,title,record,input_hash,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11::jsonb,$12,$13)',
    [id, rec.job, rec.tool_version, rec.tool_commit, rec.author, rec.created_at, P, rec.asset_ids, rec.legal_tag, rec.title, JSON.stringify(rec), rec.input_hash, rec.status]);
  return id;
}
async function insertLetter(db: any, at: string) {
  const id = randomUUID();
  await db.query("INSERT INTO items (id,type,title,created_at,authored_at,project_id,legal_tag,origin,content_hash,version) VALUES ($1,'letter','Well test programme',$2,$2,$3,'lt-orinoco-nda-2026','{\"source\":\"upload\"}'::jsonb,$4,1)", [id, at, P, H('c')]);
  return id;
}

test('A6: warnings name a cited draft run and a run older than a newer document; the context carries assets, dates and units', async () => {
  let runId = '';
  const provider = new FakeProvider(() => `The operating point is 898 bopd at a bottom-hole pressure of 3,017 psia [run:${runId}].\n\nThe skin of 3 was stated by the client [run:${runId}].\n\nWe would welcome a call in October.`);
  const { db, app } = await setup(provider);
  runId = await insertRun(db, { status: 'draft', created_at: '2026-03-01T10:00:00Z' });
  const letter = await insertLetter(db, '2026-09-15T00:00:00Z');     // newer than the seed's letter of 8 July 2026, so it is the yardstick
  const r = await app.request('/api/draft', json({ kind: 'letter', project_id: P, organisation_id: 'petrolera-del-orinoco', brief: 'Report the nodal result for Guafita-1.', run_id: runId }));
  const b: any = await r.json();
  assert.equal(r.status, 201, JSON.stringify(b));
  assert.ok(b.warnings.includes(`cites draft run ${runId}`), JSON.stringify(b.warnings));
  assert.ok(b.warnings.includes(`cites run older than document ${letter}`), JSON.stringify(b.warnings));
  assert.equal(b.questions.length, 0, 'every figure matches the run');
  assert.ok(!b.draft.includes('[QUESTION FOR YOU'));
  const run = b.context.runs.find((x: any) => x.id === runId);
  assert.deepEqual(run.asset_ids, ['well:ve:guafita-1']);
  assert.equal(run.created_at.slice(0, 10), '2026-03-01');
  assert.equal(run.status, 'draft');
  assert.deepEqual(run.outputs.operating_point_rate, { value: 897.7, unit: 'bopd' });
  assert.equal(run.outputs.operating_point_bhp.unit, 'psia');
  assert.ok(run.newer_document, 'the document the run is older than'); assert.equal(run.newer_document.id, letter);
  const saved = (await db.query("SELECT extracted->'warnings' AS w FROM items WHERE id = $1", [b.id])).rows[0] as any;
  assert.ok(saved.w.includes(`cites draft run ${runId}`), 'the saved draft keeps the warnings');
  await db.close();
});

test('A6: a final run newer than every document raises neither warning', async () => {
  let runId = '';
  const provider = new FakeProvider(() => `The operating point is 897.7 bopd [run:${runId}].`);
  const { db, app } = await setup(provider);
  await insertLetter(db, '2026-05-01T00:00:00Z');
  runId = await insertRun(db, { status: 'final', created_at: '2026-09-01T10:00:00Z' });
  const b: any = await (await app.request('/api/draft', json({ kind: 'letter', project_id: P, brief: 'Report the nodal result for Guafita-1.', run_id: runId }))).json();
  assert.ok(!b.warnings.some((w: string) => /cites draft run|older than document/.test(w)), JSON.stringify(b.warnings));
  assert.equal(b.questions.length, 0);
  assert.equal(b.context.runs.find((x: any) => x.id === runId).newer_document, null);
  await db.close();
});

test('A6: a cited figure that is not in the run, or carries the wrong unit, turns the sentence into a question', async () => {
  let runId = '';
  const provider = new FakeProvider(() => `The operating point is 1,200 bopd [run:${runId}].\n\nThe bottom-hole pressure is 3017 bopd [run:${runId}].\n\nThe water cut is 25 % [run:${runId}].\n\nThe oil gradient is 0.34 psi/ft [run:${runId}].`);
  const { db, app } = await setup(provider);
  runId = await insertRun(db, { status: 'final', created_at: '2026-09-01T10:00:00Z' });
  const b: any = await (await app.request('/api/draft', json({ kind: 'letter', project_id: P, brief: 'Report the nodal result for Guafita-1.', run_id: runId }))).json();
  assert.equal(b.paragraphs.length, 4);
  assert.match(b.paragraphs[0], /^\[QUESTION FOR YOU: .*1,200.*\]$/, 'a figure the run does not carry');
  assert.match(b.paragraphs[1], /^\[QUESTION FOR YOU: .*3017 bopd.*\]$/, 'the right number with the wrong unit');
  assert.ok(!b.paragraphs[2].startsWith('[QUESTION'), 'a fraction quoted as a percentage is the same value');
  assert.ok(!b.paragraphs[3].startsWith('[QUESTION'), 'an assumption with its unit');
  assert.equal(b.questions.length, 2);
  assert.ok(b.warnings.some((w: string) => /2 sentence\(s\) quoted a figure that is not in the cited run/.test(w)), JSON.stringify(b.warnings));
  await db.close();
});

test('checkFigures: dates, reference numbers and citation ids are not figures; a doc-cited sentence is not checked; rounding to the shown precision passes', () => {
  const runs = new Map([[ 'r1', { outputs: OUTPUTS, assumptions: ASSUMPTIONS } ]]);
  const ok = checkFigures(['Further to our letter of 8 July 2026 (ATC-2026-0131), the rate is 898 bopd [run:r1].', 'The 2024 programme [doc:d1].', 'Pressure 3,017.1 psia, rate 0.9 kbopd [run:r1].', 'Rate 900 bopd [run:r1].'], runs);
  assert.equal(ok.paragraphs[0], 'Further to our letter of 8 July 2026 (ATC-2026-0131), the rate is 898 bopd [run:r1].');
  assert.equal(ok.paragraphs[1], 'The 2024 programme [doc:d1].');
  assert.match(ok.paragraphs[2], /^\[QUESTION FOR YOU/, 'kbopd is a conversion the run did not make');
  assert.match(ok.paragraphs[3], /^\[QUESTION FOR YOU/, '900 is not 897.7 at the precision shown');
  assert.deepEqual(ok.questions.length, 2);
});
