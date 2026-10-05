// Wave 7 PR3 (docs/vault-hub/wave7/03-data-hierarchy.md §7.3, S9; 05-markup.md W7-AC15): the advisory age flags
// G1 to G6 are computed nightly into runs.age_flags and items.age_flags (G3, G5 and G6 belong to briefs, projects
// and milestones, which carry no flag column: they are reported in the job summary). None of them touches `stale`,
// so the exact stale set of AC4 holds with the age pass in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { computeAgeFlags, computeStaleness, runStalenessJob } from '../src/jobs/staleness.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (c: string) => 'sha256:' + c.repeat(64);
const NOW = new Date('2026-10-05T12:00:00Z');

async function seed(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris','chris@alpha-technical-centre.com','Chris','partner')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-firm','firm','first-party','ATC'), ('lt-public','public','public','ATC')");
  await db.query(`INSERT INTO projects (id,client_id,name,default_legal_tag,country,register) VALUES
    ('llanos','frontera','Llanos','lt-firm','CO','{"current":"12 kboe/d","plan":"15 kboe/d"}'::jsonb),
    ('sourced','frontera','Sourced','lt-firm','CO','{"current":"9 kboe/d","current_source":{"item_id":null,"accepted_at":"2026-09-01T00:00:00Z"}}'::jsonb),
    ('quiet','frontera','Quiet','lt-firm','PE','{}'::jsonb)`);
  const manifest = { id: 'opportunity-register', aliases: { current: '2.0.0' }, versions: [{ version: '2.0.0', breaking: false }, { version: '1.5.0', breaking: false }, { version: '1.0.0' }] };
  await db.query('INSERT INTO tools (id, manifest) VALUES ($1,$2::jsonb)', ['opportunity-register', JSON.stringify(manifest)]);
  const run = (n: number, job: string, status: string, at: string, v = '2.0.0') =>
    db.query("INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,legal_tag,record,input_hash,status) VALUES ($1::uuid,$2,$3,'abc1234','chris',$4,'llanos','lt-firm','{}'::jsonb,$5,$6)", [U(n), job, v, at, H(String(n)), status]);
  await run(1, 'opportunity-register', 'draft', '2026-01-10T00:00:00Z', '1.5.0');   // old draft, a newer run on the job, older than the letter
  await run(2, 'opportunity-register', 'final', '2026-06-01T00:00:00Z');            // older than the letter, final
  await run(3, 'opportunity-register', 'draft', '2026-09-25T00:00:00Z');            // newer than the letter, young
  await run(4, 'financial-model', 'final', '2026-09-01T00:00:00Z');                 // newer than the letter
  await run(5, 'financial-model', 'draft', '2026-02-01T00:00:00Z');                 // old draft; run 4 is newer on its job
  await db.query("INSERT INTO run_inputs (run_id, ref, kind, version, hash) VALUES ($1::uuid,$2,'run','1.5.0',$3)", [U(3), `run:${U(1)}`, H('1')]);
  const item = (n: number, type: string, at: string, extracted: Record<string, unknown> = {}, assets: string[] = [], tag = 'lt-firm') =>
    db.query("INSERT INTO items (id,type,title,created_at,authored_at,project_id,asset_ids,legal_tag,origin,content_hash,version,extracted) VALUES ($1::uuid,$2,$3,$4,$4,'llanos',$5::text[],$6,'{\"source\":\"upload\"}'::jsonb,$7,1,$8::jsonb)", [U(n), type, `item ${n}`, at, assets, tag, H(String(n % 10)), JSON.stringify(extracted)]);
  await item(11, 'letter', '2026-07-01T00:00:00Z');                                            // the newest foreground document
  await item(12, 'note', '2026-09-30T00:00:00Z', { kind: 'research', quote: 'x' }, [], 'lt-public');   // background: never the yardstick
  await item(13, 'note', '2026-10-01T00:00:00Z', { kind: 'draft', draft: 'y' });                 // a draft is not a delivered document
  await db.query("INSERT INTO assets (id,kind,name,country,props) VALUES ('field:llanos:rubiales','field','Rubiales','CO','{\"gem\":{\"unit_id\":\"G200\",\"release\":\"September 2026\"}}'::jsonb), ('field:llanos:quifa','field','Quifa','CO','{\"gem\":{\"unit_id\":\"G201\",\"release\":\"September 2026\"}}'::jsonb)");
  await item(14, 'note', '2026-04-01T00:00:00Z', { kind: 'dossier', asset_id: 'field:llanos:rubiales', source: 'gem', release: 'March 2026' }, ['field:llanos:rubiales'], 'lt-public');
  await item(15, 'note', '2026-10-01T00:00:00Z', { kind: 'dossier', asset_id: 'field:llanos:quifa', source: 'gem', release: 'September 2026' }, ['field:llanos:quifa'], 'lt-public');
  await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1::uuid,$2)', [U(11), `run:${U(1)}`]);
  await db.query("INSERT INTO country_briefs (country, language, scope_hash, source_hash, body, created_by, created_at, max_age_days) VALUES ('CO','en','s','h','{}'::jsonb,'chris','2026-05-01T00:00:00Z',90), ('CO','es','s','h','{}'::jsonb,'chris','2026-09-20T00:00:00Z',90), ('PE','en','s','h','{}'::jsonb,'chris','2026-01-01T00:00:00Z',365)");
  await db.query("INSERT INTO project_milestones (id, project_id, kind, title, due_at, created_by) VALUES ($1,'llanos','reply_due','Reply from ANH','2026-09-15',$4), ($2,'llanos','deadline','Done one','2026-09-01',$4), ($3,'quiet','deadline','Not yet','2026-12-01',$4)", [U(31), U(32), U(33), 'chris']);
  await db.query('UPDATE project_milestones SET done_at = now() WHERE id = $1', [U(32)]);
  return db;
}
const runs = async (db: Db) => Object.fromEntries((await db.query<any>('SELECT id::text AS id, stale, stale_reasons, age_flags FROM runs ORDER BY id')).rows.map((r: any) => [r.id, r]));
const items = async (db: Db) => Object.fromEntries((await db.query<any>('SELECT id::text AS id, stale, age_flags FROM items ORDER BY id')).rows.map((r: any) => [r.id, r]));

test('W7-AC15: G1 and G2 land on runs, G4 on dossiers, G3, G5 and G6 in the summary; stale is never set by age', async () => {
  const db = await seed();
  const s = await computeAgeFlags(db, NOW);
  const r = await runs(db);
  const rules = (x: any) => x.age_flags.map((f: any) => f.rule).sort();
  assert.deepEqual(rules(r[U(1)]), ['G1', 'G2']);
  const g1 = r[U(1)].age_flags.find((f: any) => f.rule === 'G1');
  assert.equal(g1.ref, `doc:${U(11)}`); assert.match(g1.detail, /older than item 11, 2026-07-01: check its inputs/);
  const g2 = r[U(1)].age_flags.find((f: any) => f.rule === 'G2');
  assert.equal(g2.ref, `run:${U(3)}`, 'the newest run on the same job'); assert.match(g2.detail, /draft superseded in practice/);
  assert.deepEqual(rules(r[U(2)]), ['G1'], 'final, so G2 does not apply');
  assert.deepEqual(rules(r[U(3)]), [], 'newer than the letter and young');
  assert.deepEqual(rules(r[U(4)]), [], 'newer than the letter');
  assert.deepEqual(rules(r[U(5)]), ['G1', 'G2']);
  for (const n of [1, 2, 3, 4, 5]) { assert.equal(r[U(n)].stale, false, `run ${n} stale untouched`); assert.deepEqual(r[U(n)].stale_reasons, []); }
  const it = await items(db);
  assert.deepEqual(it[U(14)].age_flags.map((f: any) => f.rule), ['G4']);
  assert.equal(it[U(14)].age_flags[0].ref, 'asset:field:llanos:rubiales'); assert.match(it[U(14)].age_flags[0].detail, /GEM release moved: refresh dossier/);
  assert.deepEqual(it[U(15)].age_flags, [], 'a dossier of the current release');
  assert.deepEqual(it[U(11)].age_flags, []);
  for (const n of [11, 12, 13, 14, 15]) assert.equal(it[U(n)].stale, false);
  assert.equal(s.runs_flagged, 3); assert.equal(s.items_flagged, 1);
  assert.deepEqual(s.G3.map(b => [b.country, b.language]), [['CO', 'en']], 'the brief past its max age; the young one and the one with a long age are not');
  assert.equal(s.G3[0].max_age_days, 90); assert.equal(s.G3[0].created_at.slice(0, 10), '2026-05-01');
  assert.deepEqual(s.G5, ['llanos'], 'a register current with no source; sourced and empty registers are not flagged');
  assert.deepEqual(s.G6.map(m => m.id), [U(31)]); assert.equal(s.G6[0].project_id, 'llanos'); assert.equal(s.G6[0].due_at, '2026-09-15');
  await db.close();
});

test('AC4 exactness: the stale set is the same with and without the age pass, and each pass leaves the other\'s flags alone', async () => {
  const db = await seed();
  await db.query("UPDATE tools SET manifest = jsonb_set(jsonb_set(manifest, '{aliases,current}', '\"2.1.0\"'), '{versions}', '[{\"version\":\"2.1.0\"},{\"version\":\"2.0.0\",\"breaking\":true},{\"version\":\"1.5.0\"}]')");
  const a = await computeStaleness(db, NOW);
  const snapA = (await db.query('SELECT id::text AS id, stale, stale_reasons FROM runs ORDER BY id')).rows;
  await computeAgeFlags(db, NOW);
  const b = await computeStaleness(db, NOW);
  const snapB = (await db.query('SELECT id::text AS id, stale, stale_reasons FROM runs ORDER BY id')).rows;
  assert.deepEqual(a, b); assert.deepEqual(snapA, snapB);
  const r = await runs(db);
  assert.equal(r[U(1)].stale, true, 'run 1 on 1.5.0 crosses breaking 2.0.0'); assert.equal(r[U(1)].stale_reasons[0].rule, 'R1');
  assert.equal(r[U(3)].stale, true); assert.equal(r[U(3)].stale_reasons[0].rule, 'R2');
  assert.equal(r[U(2)].stale, false); assert.equal(r[U(4)].stale, false); assert.equal(r[U(5)].stale, false);
  assert.ok(r[U(1)].age_flags.length === 2, 'staleness did not reset the age flags');
  const it = await items(db);
  assert.equal(it[U(11)].stale, true, 'the letter cites stale run 1'); assert.deepEqual(it[U(14)].age_flags.map((f: any) => f.rule), ['G4']);
  await db.close();
});

test('the nightly job runs both passes and records the age summary; a second run changes nothing', async () => {
  const db = await seed();
  const s1 = await runStalenessJob(db, NOW);
  assert.ok(s1.age, 'the summary carries the age pass'); assert.equal(s1.age!.runs_flagged, 3); assert.equal(s1.runs_stale, 0);
  const snap1 = (await db.query('SELECT id::text AS id, stale, age_flags FROM runs ORDER BY id')).rows;
  const s2 = await runStalenessJob(db, NOW);
  assert.deepEqual(s1, s2);
  assert.deepEqual(snap1, (await db.query('SELECT id::text AS id, stale, age_flags FROM runs ORDER BY id')).rows);
  const job = (await db.query<any>("SELECT status, summary FROM jobs WHERE name = 'nightly-staleness' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(job.status, 'ok'); assert.equal(job.summary.age.items_flagged, 1);
  // A run that gains a newer sibling loses its G2 flag the night the sibling is superseded (recomputed from scratch).
  await db.query("UPDATE runs SET status = 'superseded' WHERE id = $1::uuid", [U(3)]);
  await db.query("UPDATE runs SET status = 'superseded' WHERE id = $1::uuid", [U(2)]);
  await runStalenessJob(db, NOW);
  assert.deepEqual((await runs(db))[U(1)].age_flags.map((f: any) => f.rule), ['G1'], 'no newer live run on the job any more');
  await db.query('INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,legal_tag,record,input_hash,status) VALUES ($1::uuid,\'opportunity-register\',\'2.0.0\',\'abc1234\',\'chris\',now(),\'llanos\',\'lt-firm\',\'{}\'::jsonb,$2,\'final\')', [randomUUID(), H('9')]);
  await runStalenessJob(db, NOW);
  assert.deepEqual((await runs(db))[U(1)].age_flags.map((f: any) => f.rule).sort(), ['G1', 'G2']);
  await db.close();
});
