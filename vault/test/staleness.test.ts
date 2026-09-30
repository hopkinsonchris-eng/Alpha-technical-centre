import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { computeStaleness, breakingBetween, cmpSemver } from '../src/jobs/staleness.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (c: string) => 'sha256:' + c.repeat(64);

async function seed(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris','chris@alpha-technical-centre.com','Chris','partner')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ('lt-old','client-nda','second-party','frontera','Frontera','2020-01-01')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag) VALUES ('llanos','frontera','Llanos','lt-firm')");
  const manifest = { id: 'opportunity-register', aliases: { current: '2.0.0' }, versions: [{ version: '2.0.0', breaking: false }, { version: '1.5.0', breaking: false }, { version: '1.0.0' }] };
  await db.query('INSERT INTO tools (id, manifest) VALUES ($1,$2::jsonb)', ['opportunity-register', JSON.stringify(manifest)]);
  const run = async (n: number, v: string, extra: Partial<{ status: string; tag: string }> = {}) =>
    db.query("INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,legal_tag,record,input_hash,status) VALUES ($1::uuid,'opportunity-register',$2,'abc1234','chris',now(),'llanos',$3,'{}'::jsonb,$4,$5)", [U(n), v, extra.tag ?? 'lt-firm', H(String(n % 10)), extra.status ?? 'final']);
  await run(1, '1.5.0'); await run(2, '2.0.0'); await run(3, '2.0.0');
  // run 3 depends on run 1; item 11 (letter) cites run 1; item 12 cites run 2; item 13 is a reference set used by run 2
  await db.query("INSERT INTO run_inputs (run_id, ref, kind, version, hash) VALUES ($1::uuid,$2,'run','1.5.0',$3)", [U(3), `run:${U(1)}`, H('1')]);
  const item = async (n: number, type: string, hash: string, supersedes: string | null = null) =>
    db.query("INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version,supersedes) VALUES ($1::uuid,$2,$3,now(),'llanos','lt-firm','{\"source\":\"upload\"}'::jsonb,$4,1,$5::uuid)", [U(n), type, `item ${n}`, hash, supersedes]);
  await item(11, 'letter', H('b')); await item(12, 'letter', H('c')); await item(13, 'reference-set', H('d'));
  await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1::uuid,$2)', [U(11), `run:${U(1)}`]);
  await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1::uuid,$2)', [U(12), `run:${U(2)}`]);
  await db.query("INSERT INTO run_inputs (run_id, ref, kind, version, hash) VALUES ($1::uuid,$2,'reference','1',$3)", [U(2), `doc:${U(13)}`, H('d')]);
  return db;
}

test('semver and breakingBetween', () => {
  assert.ok(cmpSemver('2.0.0', '1.9.9') > 0); assert.equal(cmpSemver('1.2.3', '1.2.3'), 0);
  const m = { aliases: { current: '2.1.0' }, versions: [{ version: '2.1.0' }, { version: '2.0.0', breaking: true }, { version: '1.5.0' }] };
  assert.deepEqual(breakingBetween(m, '1.5.0'), { current: '2.1.0', breaking: '2.0.0' });
  assert.deepEqual(breakingBetween(m, '2.0.0'), { current: '2.1.0', breaking: null });
  assert.deepEqual(breakingBetween(m, '2.1.0'), { current: '2.1.0', breaking: null });
});

test('a non-breaking promotion makes nothing stale', async () => {
  const db = await seed();
  const s = await computeStaleness(db, new Date('2026-09-29T00:00:00Z'));
  assert.equal(s.runs_stale, 0); assert.equal(s.items_stale, 0);
  await db.close();
});

test('AC4: promoting to a breaking version marks exactly the dependent set stale, with rule ids', async () => {
  const db = await seed();
  await db.query("UPDATE tools SET manifest = jsonb_set(jsonb_set(manifest, '{aliases,current}', '\"2.1.0\"'), '{versions}', '[{\"version\":\"2.1.0\"},{\"version\":\"2.0.0\",\"breaking\":true},{\"version\":\"1.5.0\"}]')");
  const s = await computeStaleness(db, new Date('2026-09-29T00:00:00Z'));
  const runs = (await db.query('SELECT id::text AS id, stale, stale_reasons FROM runs ORDER BY id')).rows;
  const byId = Object.fromEntries(runs.map((r: any) => [r.id, r]));
  assert.equal(byId[U(1)].stale, true, 'run 1 on 1.5.0 crosses breaking 2.0.0');
  assert.equal(byId[U(1)].stale_reasons[0].rule, 'R1');
  assert.equal(byId[U(2)].stale, false, 'run 2 on 2.0.0 does not cross a breaking version');
  assert.equal(byId[U(3)].stale, true, 'run 3 depends on stale run 1');
  assert.equal(byId[U(3)].stale_reasons[0].rule, 'R2');
  const items = Object.fromEntries((await db.query('SELECT id::text AS id, stale, stale_reasons FROM items')).rows.map((r: any) => [r.id, r]));
  assert.equal(items[U(11)].stale, true, 'letter cites stale run 1'); assert.equal(items[U(11)].stale_reasons[0].rule, 'CITES');
  assert.equal(items[U(12)].stale, false); assert.equal(items[U(13)].stale, false);
  assert.equal(s.runs_stale, 2); assert.equal(s.items_stale, 1);
  assert.deepEqual(s.by_project, { llanos: { runs: 2, items: 1 } });
  await db.close();
});

test('R3: a changed reference set marks the run and its citing letter stale; superseded runs are skipped', async () => {
  const db = await seed();
  await db.query("INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version,supersedes) VALUES ($1::uuid,'reference-set','item 13 v2',now(),'llanos','lt-firm','{\"source\":\"upload\"}'::jsonb,$2,2,$3::uuid)", [U(14), H('e'), U(13)]);
  await db.query("UPDATE runs SET status='superseded' WHERE id=$1::uuid", [U(1)]);
  const s = await computeStaleness(db, new Date('2026-09-29T00:00:00Z'));
  const runs = Object.fromEntries((await db.query('SELECT id::text AS id, stale, stale_reasons FROM runs')).rows.map((r: any) => [r.id, r]));
  assert.equal(runs[U(2)].stale, true); assert.equal(runs[U(2)].stale_reasons[0].rule, 'R3');
  assert.equal(runs[U(1)].stale, false, 'superseded runs are not evaluated');
  assert.equal(runs[U(3)].stale, true, 'run 3 depends on a superseded run'); assert.equal(runs[U(3)].stale_reasons[0].rule, 'R2');
  const items = Object.fromEntries((await db.query('SELECT id::text AS id, stale FROM items')).rows.map((r: any) => [r.id, r]));
  assert.equal(items[U(12)].stale, true, 'letter citing run 2');
  assert.equal(items[U(11)].stale, true, 'letter citing superseded run 1');
  assert.ok(s.runs_stale >= 2);
  await db.close();
});

test('R4: an expired legal tag hides the run and reports it separately', async () => {
  const db = await seed();
  await db.query("UPDATE runs SET legal_tag='lt-old' WHERE id=$1::uuid", [U(2)]);
  const s = await computeStaleness(db, new Date('2026-09-29T00:00:00Z'));
  assert.equal(s.expired, 1);
  const r = (await db.query('SELECT hidden, stale, stale_reasons FROM runs WHERE id=$1::uuid', [U(2)])).rows[0];
  assert.equal(r.hidden, true); assert.equal(r.stale, false); assert.equal(r.stale_reasons[0].rule, 'R4');
  await db.close();
});

test('running twice changes nothing the second time', async () => {
  const db = await seed();
  await db.query("UPDATE tools SET manifest = jsonb_set(jsonb_set(manifest, '{aliases,current}', '\"2.1.0\"'), '{versions}', '[{\"version\":\"2.1.0\"},{\"version\":\"2.0.0\",\"breaking\":true},{\"version\":\"1.5.0\"}]')");
  const a = await computeStaleness(db); const snapA = (await db.query('SELECT id::text, stale, stale_reasons FROM runs ORDER BY id')).rows;
  const b = await computeStaleness(db); const snapB = (await db.query('SELECT id::text, stale, stale_reasons FROM runs ORDER BY id')).rows;
  assert.deepEqual(a, b); assert.deepEqual(snapA, snapB);
  await db.close();
});
