// Wave 7 PR1 (S30, S18, W7-AC2): Find is trustworthy. A query that matches nothing returns nothing (no hit at the
// reciprocal-rank floor), and a record filed in another client's project never appears in a project or client
// scope however it is tagged: firm-tagged records travel firm-wide only in firm scope and through the firm's own
// internal project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { FakeEmbedder, vectorLiteral } from '../src/ingest/embed.ts';
import { hybridSearch } from '../src/gateway/search.ts';
import { loadProjects, resolveScope } from '../src/gateway/index.ts';
import type { Person } from '../src/auth.ts';

const DOMAIN = 'alpha-technical-centre.com';
const fake = new FakeEmbedder();
const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const CHRIS: Person = { id: 'chris', email: `chris@${DOMAIN}`, name: 'Chris', role: 'partner' };
const ANA: Person = { id: 'ana', email: `ana@${DOMAIN}`, name: 'Ana', role: 'associate' };

interface Seed { db: Db; ids: Record<string, string>; get(person: string, url: string): Promise<{ status: number; body: any }> }

/**
 * Client A's project (ana is a member) and client B's project. Every record mentions "cubiro" so lexical search
 * finds all of them; the scope alone decides what comes back. Project B holds the S30 case: a firm-tagged
 * document (talara-basis-note) that used to leak into every scope.
 */
async function seed(): Promise<Seed> {
  const db = await openDb(undefined); await migrate(db);
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('chris','chris@${DOMAIN}','Chris','partner'),('ana','ana@${DOMAIN}','Ana','associate')`);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','ANH'),('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','ATC internal','lt-firm')");
  for (const c of ['a', 'b']) {
    await db.query('INSERT INTO organisations (id,name,kind) VALUES ($1,$2,$3)', [c, `Client ${c.toUpperCase()}`, 'client']);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ($1,'client-nda','second-party',$2,$3)", [`lt-${c}-nda`, c, c]);
    await db.query('INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,$2,$3,$4,$5::text[])', [`p-${c}`, c, `Project ${c}`, `lt-${c}-nda`, c === 'a' ? ['ana'] : []]);
  }
  await db.query("INSERT INTO projects (id,name,default_legal_tag,members) VALUES ('internal-x','Internal study','lt-firm','{ana}')");
  const ids: Record<string, string> = {};
  const item = async (key: string, o: { title: string; text: string; tag: string; client: string | null; project: string; type?: string }) => {
    const id = randomUUID();
    await db.query(`INSERT INTO items (id,type,title,created_at,authors,client_id,project_id,legal_tag,origin,content_hash,version) VALUES ($1,$2,$3,now(),'{chris}',$4,$5,$6,'{"source":"test"}'::jsonb,$7,1)`,
      [id, o.type ?? 'report', o.title, o.client, o.project, o.tag, 'sha256:' + hex(id)]);
    const [emb] = await fake.embed([o.text]);
    await db.query('INSERT INTO chunks (item_id, item_version, ordinal, text, legal_tag, client_id, project_id, embedding) VALUES ($1,1,0,$2,$3,$4,$5,$6::vector)', [id, o.text, o.tag, o.client, o.project, vectorLiteral(emb)]);
    ids[key] = id;
  };
  const run = async (key: string, o: { title: string; text: string; tag: string; client: string | null; project: string }) => {
    const id = randomUUID();
    await db.query(`INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,client_id,project_id,legal_tag,title,record,input_hash,status) VALUES ($1,'nodal','1.0.0','abc1234','chris',now(),$2,$3,$4,$5,'{"outputs":{}}'::jsonb,$6,'final')`,
      [id, o.client, o.project, o.tag, o.title, 'sha256:' + hex(id)]);
    const [emb] = await fake.embed([o.text]);
    await db.query('INSERT INTO chunks (run_id, ordinal, text, legal_tag, client_id, project_id, embedding) VALUES ($1,0,$2,$3,$4,$5,$6::vector)', [id, o.text, o.tag, o.client, o.project, vectorLiteral(emb)]);
    ids[key] = id;
  };
  await item('a-nda', { title: 'Cubiro waterflood pattern study', text: 'Cubiro waterflood pattern study for client A', tag: 'lt-a-nda', client: 'a', project: 'p-a' });
  await item('a-firm', { title: 'Cubiro well list', text: 'Cubiro well list filed as firm record in project A', tag: 'lt-firm', client: null, project: 'p-a', type: 'spreadsheet' });
  await item('b-nda', { title: 'Cubiro analogue for client B', text: 'Cubiro analogue screening for client B', tag: 'lt-b-nda', client: 'b', project: 'p-b' });
  await item('talara', { title: 'talara-basis-note.pdf', text: 'Guafita field report with Cubiro analogue, filed as firm record in project B', tag: 'lt-firm', client: null, project: 'p-b' });
  await run('b-firm-run', { title: 'Cubiro nodal for B', text: 'Cubiro nodal run for client B filed firm', tag: 'lt-firm', client: null, project: 'p-b' });
  await item('lesson', { title: 'Lesson: Cubiro voidage', text: 'Cubiro lesson: derive voidage from injector capacity', tag: 'lt-firm', client: null, project: 'firm', type: 'lesson' });
  await item('paper', { title: 'Cubiro public paper', text: 'Cubiro public paper on mature field waterfloods', tag: 'lt-public', client: null, project: 'firm', type: 'paper' });
  await item('x-firm', { title: 'Cubiro internal study note', text: 'Cubiro internal study note of project X', tag: 'lt-firm', client: null, project: 'internal-x', type: 'note' });
  const apps = new Map<string, Awaited<ReturnType<typeof createApp>>>();
  return {
    db, ids,
    async get(person, url) {
      if (!apps.has(person)) apps.set(person, await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `${person}@${DOMAIN}` }, version: 'test' }));
      const r = await apps.get(person)!.request(url);
      return { status: r.status, body: await r.json() };
    },
  };
}

const found = (r: { body: any }) => r.body.hits.map((h: any) => h.item_id ?? h.run_id).sort();
const pick = (ids: Record<string, string>, ...keys: string[]) => keys.map(k => ids[k]).sort();

test('S30: a query that matches nothing returns [] in every scope, with the vector branch active', async () => {
  const { db, get } = await seed();
  for (const q of ['xyzzy', 'anything', 'zzzz qqqq']) for (const scope of ['project:p-a', 'client:a', 'firm', 'public', 'project:internal-x']) {
    const r = await get('chris', `/api/search?q=${encodeURIComponent(q)}&scope=${scope}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.hits, [], `"${q}" in ${scope} returned ${JSON.stringify(r.body.hits.map((h: any) => h.title))}`);
  }
  assert.ok((await get('chris', '/api/search?q=cubiro&scope=project:p-a')).body.hits.length > 0, 'a real term still finds its records');
  await db.close();
});

test('the floor: a vector-only hit counts when it is close, never because it is the nearest of a far-away list', async () => {
  const { db, ids } = await seed();
  const projects = await loadProjects(db);
  const scope = resolveScope('project:p-a', CHRIS, projects);
  // A query whose embedding is the chunk's own: distance 0, no lexical match. It is a hit.
  const near = async (_q: string) => (await fake.embed(['Cubiro well list filed as firm record in project A']))[0];
  const close = await hybridSearch(db, 'qqqq', scope, CHRIS, projects, { embed: near });
  assert.deepEqual(close.map(h => h.item_id), [ids['a-firm']]);
  // A one-hot query vector is far from everything (cosine distance 1): nothing is a hit, however few candidates exist.
  const far = async (_q: string) => Array.from({ length: 1024 }, (_, i) => (i === 7 ? 1 : 0));
  assert.deepEqual(await hybridSearch(db, 'qqqq', scope, CHRIS, projects, { embed: far }), []);
  // Lexical matches are never dropped by the vector floor.
  const lex = await hybridSearch(db, 'cubiro', scope, CHRIS, projects, { embed: far }, { k: 50 });
  assert.ok(lex.length >= 4, `lexical hits survive: ${lex.length}`);
  await db.close();
});

test('S18/S30: a record of project B never appears in project A\'s or client A\'s scope, whatever its tag; firm knowledge still does', async () => {
  const { db, ids, get } = await seed();
  const inA = pick(ids, 'a-nda', 'a-firm', 'lesson', 'paper');
  for (const [who, scope] of [['ana', 'project:p-a'], ['chris', 'project:p-a'], ['chris', 'client:a']]) {
    const r = await get(who, `/api/search?q=cubiro&scope=${scope}&k=50`);
    assert.equal(r.status, 200);
    assert.deepEqual(found(r), inA, `${who} in ${scope}`);
  }
  // Project B's firm-tagged document and run are found where they belong: in project B and firm-wide in firm scope.
  assert.deepEqual(found(await get('chris', '/api/search?q=cubiro&scope=project:p-b&k=50')), pick(ids, 'b-nda', 'talara', 'b-firm-run', 'lesson', 'paper'));
  assert.deepEqual(found(await get('chris', '/api/search?q=cubiro&scope=firm&k=50')), pick(ids, 'a-firm', 'talara', 'b-firm-run', 'lesson', 'paper', 'x-firm'));
  assert.deepEqual(found(await get('ana', '/api/search?q=cubiro&scope=public&k=50')), pick(ids, 'paper'));
  // An internal project without a client sees its own firm records and the firm's, not another project's.
  assert.deepEqual(found(await get('ana', '/api/search?q=cubiro&scope=project:internal-x&k=50')), pick(ids, 'x-firm', 'lesson', 'paper'));
  // The structured run helper applies the same predicate.
  const runs = (r: { body: any }) => r.body.runs.map((x: any) => x.id);
  assert.deepEqual(runs(await get('chris', '/api/search/runs?scope=project:p-a')), []);
  assert.deepEqual(runs(await get('chris', '/api/search/runs?scope=client:a')), []);
  assert.deepEqual(runs(await get('chris', '/api/search/runs?scope=project:p-b')), [ids['b-firm-run']]);
  assert.deepEqual(runs(await get('chris', '/api/search/runs?scope=firm')), [ids['b-firm-run']]);
  // Who worked a topic in project A names nobody for project B's records.
  const who = await get('ana', '/api/search/people?q=cubiro&scope=project:p-a');
  assert.ok(who.body.people.every((p: any) => p.refs.every((ref: string) => !ref.endsWith(ids['talara']) && !ref.endsWith(ids['b-firm-run']))));
  await db.close();
});

test('the predicate narrows only project and client scope: an associate\'s own project keeps firm and public records', async () => {
  const { db, ids } = await seed();
  const projects = await loadProjects(db);
  const scope = resolveScope('project:p-a', ANA, projects);
  const hits = await hybridSearch(db, 'cubiro', scope, ANA, projects, {}, { k: 50 });
  assert.deepEqual(hits.map(h => h.item_id).sort(), pick(ids, 'a-nda', 'a-firm', 'lesson', 'paper'));
  assert.ok(hits.every(h => h.project_id === 'p-a' || h.project_id === 'firm'));
  await db.close();
});
