// Wave 7 PR3 (docs/vault-hub/wave7/03-data-hierarchy.md §7.2, G7; 05-markup.md W7-AC15): a reference set is an item
// whose external_id is the reference id, so a run that consumed `ref:price_decks/<id>` goes stale (R3) when a new
// version of the deck lands, whether the version bumps the same row or a new row supersedes it. The letter that
// cites the run follows. A reference nobody has filed stales nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { computeStaleness } from '../src/jobs/staleness.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (c: string) => 'sha256:' + c.repeat(64);
const DECK = 'price_decks/brent-2026-09';

async function seed(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris','chris@alpha-technical-centre.com','Chris','partner')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag) VALUES ('firm',NULL,'ATC internal','lt-firm'), ('llanos','frontera','Llanos','lt-firm')");
  // The deck, filed the way seedMaster files vault/reference/*.json: project firm, origin tool, external_id = the reference id.
  await db.query(`INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,external_id,content_hash,version)
                  VALUES ($1::uuid,'reference-set',$2,now(),'firm','lt-firm',$3::jsonb,$2,$4,1)`, [U(13), DECK, JSON.stringify({ source: 'tool', external_id: DECK }), H('d')]);
  const run = async (n: number, inputs: { ref: string; kind: string; version: string | null; hash: string | null }[]) => {
    await db.query("INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,legal_tag,record,input_hash,status) VALUES ($1::uuid,'financial-model','1.0.0','abc1234','chris',now(),'llanos','lt-firm','{}'::jsonb,$2,'final')", [U(n), H(String(n))]);
    for (const i of inputs) await db.query('INSERT INTO run_inputs (run_id, ref, kind, version, hash) VALUES ($1::uuid,$2,$3,$4,$5)', [U(n), i.ref, i.kind, i.version, i.hash]);
  };
  await run(1, [{ ref: `ref:${DECK}`, kind: 'reference', version: '1', hash: H('d') }]);          // hash recorded
  await run(2, [{ ref: `ref:${DECK}`, kind: 'reference', version: '1', hash: null }]);            // version only
  await run(3, [{ ref: 'ref:price_decks/nobody-filed-this', kind: 'reference', version: '1', hash: H('z') }]);
  await run(4, [{ ref: `run:${U(1)}`, kind: 'run', version: null, hash: null }]);                 // depends on run 1
  await db.query("INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version) VALUES ($1::uuid,'letter','letter',now(),'llanos','lt-firm','{\"source\":\"upload\"}'::jsonb,$2,1)", [U(11), H('b')]);
  await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1::uuid,$2)', [U(11), `run:${U(1)}`]);
  return db;
}
const state = async (db: Db) => Object.fromEntries((await db.query<any>('SELECT id::text AS id, stale, stale_reasons FROM runs')).rows.map((r: any) => [r.id, r]));

test('an unchanged deck stales nothing, and a reference nobody filed stales nothing', async () => {
  const db = await seed();
  const s = await computeStaleness(db, new Date('2026-10-05T00:00:00Z'));
  assert.equal(s.runs_stale, 0); assert.equal(s.items_stale, 0);
  const runs = await state(db);
  for (const n of [1, 2, 3, 4]) assert.equal(runs[U(n)].stale, false, `run ${n}`);
  await db.close();
});

test('W7-AC15: a new version of the deck on the same row stales the runs that consumed it (R3) and the letter that cites one', async () => {
  const db = await seed();
  await db.query('UPDATE items SET content_hash = $2, version = 2 WHERE id = $1::uuid', [U(13), H('e')]);
  await db.query('INSERT INTO item_versions (item_id, version, content_hash) VALUES ($1::uuid, 2, $2)', [U(13), H('e')]);
  const s = await computeStaleness(db, new Date('2026-10-05T00:00:00Z'));
  const runs = await state(db);
  assert.equal(runs[U(1)].stale, true, 'the run that recorded the old hash');
  assert.equal(runs[U(1)].stale_reasons[0].rule, 'R3'); assert.equal(runs[U(1)].stale_reasons[0].ref, `ref:${DECK}`);
  assert.match(runs[U(1)].stale_reasons[0].detail, /changed/);
  assert.equal(runs[U(2)].stale, true, 'the run that recorded only the version');
  assert.equal(runs[U(2)].stale_reasons[0].rule, 'R3'); assert.match(runs[U(2)].stale_reasons[0].detail, /version 1.*now 2/);
  assert.equal(runs[U(3)].stale, false, 'an unfiled reference is not a change');
  assert.equal(runs[U(4)].stale, true, 'the dependent run follows (R2)'); assert.equal(runs[U(4)].stale_reasons[0].rule, 'R2');
  const letter = (await db.query<any>('SELECT stale, stale_reasons FROM items WHERE id = $1::uuid', [U(11)])).rows[0];
  assert.equal(letter.stale, true); assert.equal(letter.stale_reasons[0].rule, 'CITES');
  assert.equal(s.runs_stale, 3); assert.equal(s.items_stale, 1);
  await db.close();
});

test('W7-AC15: a new deck row that supersedes the old one stales the consumer too', async () => {
  const db = await seed();
  await db.query(`INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,external_id,content_hash,version,supersedes)
                  VALUES ($1::uuid,'reference-set',$2,now(),'firm','lt-firm',$3::jsonb,$2,$4,2,$5::uuid)`, [U(14), DECK, JSON.stringify({ source: 'tool', external_id: DECK }), H('f'), U(13)]);
  await computeStaleness(db, new Date('2026-10-05T00:00:00Z'));
  const runs = await state(db);
  assert.equal(runs[U(1)].stale, true); assert.equal(runs[U(1)].stale_reasons[0].rule, 'R3');
  assert.equal(runs[U(2)].stale, true);
  await db.close();
});

test('the reference sets seedMaster files are the ones the rule resolves: a run that consumed the ANH terms at another hash is stale', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  const terms = (await db.query<any>("SELECT id::text AS id, external_id, content_hash FROM items WHERE type = 'reference-set' AND external_id = 'fiscal_terms/co/anh-e-and-p-2026'")).rows[0];
  assert.ok(terms, 'seedMaster filed the reference set');
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera','client')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag) VALUES ('llanos','frontera','Llanos','lt-firm')");
  await db.query("INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,legal_tag,record,input_hash,status) VALUES ($1::uuid,'financial-model','1.0.0','abc1234','chris',now(),'llanos','lt-firm','{}'::jsonb,$2,'final'), ($3::uuid,'financial-model','1.0.0','abc1234','chris',now(),'llanos','lt-firm','{}'::jsonb,$4,'final')", [U(21), H('1'), U(22), H('2')]);
  await db.query("INSERT INTO run_inputs (run_id, ref, kind, version, hash) VALUES ($1::uuid,'ref:fiscal_terms/co/anh-e-and-p-2026','reference','1',$2), ($3::uuid,'ref:fiscal_terms/co/anh-e-and-p-2026','reference','1',$4)", [U(21), H('0'), U(22), terms.content_hash]);
  await computeStaleness(db, new Date('2026-10-05T00:00:00Z'));
  const runs = await state(db);
  assert.equal(runs[U(21)].stale, true, 'recorded a hash the current terms no longer carry');
  assert.equal(runs[U(22)].stale, false, 'recorded the current hash');
  await db.close();
});
