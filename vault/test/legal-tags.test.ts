// Wave 7 PR1 (S1, S18, W7-AC1): a partner creates a client's NDA tag through the API, a project is created under it,
// and confidentiality is structural from then on: an associate without the tag sees neither the project nor its
// records in Find, in Write to… sources or through the connector. A firm-tagged record filed in one client's project
// is no longer a source for another client's letter (S18).
import { test } from 'node:test';
process.env.VAULT_STORAGE_DIR ??= (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'vault-legal-tags-'));
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { FakeEmbedder, vectorLiteral } from '../src/ingest/embed.ts';
import { assembleContext } from '../src/llm/draft.ts';
import type { Person } from '../src/auth.ts';

const DOMAIN = 'alpha-technical-centre.com';
const TAG = 'lt-frontera-nda-2026';
const PROJECT = 'llanos-screen';
const fake = new FakeEmbedder();
const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const CHRIS: Person = { id: 'chris', email: `chris@${DOMAIN}`, name: 'Chris', role: 'partner' };
const BEN: Person = { id: 'ben', email: `ben@${DOMAIN}`, name: 'Ben', role: 'associate' };

delete process.env.CF_ACCESS_TEAM_DOMAIN;
process.env.NODE_ENV = 'test';

interface Seed { db: Db; call(person: string, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> }

/** Two clients. Petroperú's project (talara) was created the old way, under lt-firm (the S1 situation); ben is on it. */
async function seed(): Promise<Seed> {
  const db = await openDb(undefined); await migrate(db);
  for (const [id, role] of [['chris', 'partner'], ['ana', 'associate'], ['ben', 'associate']]) await db.query('INSERT INTO people (id,email,name,role) VALUES ($1,$2,$3,$4)', [id, `${id}@${DOMAIN}`, id[0].toUpperCase() + id.slice(1), role]);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','ANH'),('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','ATC internal','lt-firm')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client'),('petroperu','Petroperú','client'),('anh','ANH','regulator')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('talara','petroperu','Talara redevelopment','lt-firm','{ben}')");
  const apps = new Map<string, Awaited<ReturnType<typeof createApp>>>();
  return {
    db,
    async call(person, method, url, body) {
      if (!apps.has(person)) apps.set(person, await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `${person}@${DOMAIN}` }, version: 'test' }));
      const r = await apps.get(person)!.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    },
  };
}

/** An item with one chunk, the way ingest would leave it. */
async function item(db: Db, o: { title: string; text: string; tag: string; client: string | null; project: string; type?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO items (id,type,title,created_at,authors,client_id,project_id,legal_tag,origin,content_hash,version) VALUES ($1,$2,$3,now(),'{chris}',$4,$5,$6,'{"source":"test"}'::jsonb,$7,1)`,
    [id, o.type ?? 'report', o.title, o.client, o.project, o.tag, 'sha256:' + hex(id)]);
  const [emb] = await fake.embed([o.text]);
  await db.query('INSERT INTO chunks (item_id, item_version, ordinal, text, legal_tag, client_id, project_id, embedding) VALUES ($1,1,0,$2,$3,$4,$5,$6::vector)', [id, o.text, o.tag, o.client, o.project, vectorLiteral(emb)]);
  return id;
}

async function connectMcp(db: Db, who: string) {
  const devAuth = { allowedEmailDomain: DOMAIN, get devUserEmail() { return process.env.DEV_USER_EMAIL; } };
  const app = await createApp({ db, auth: devAuth, version: 'test' });
  const fetchAs = (url: any, init: any) => { process.env.DEV_USER_EMAIL = `${who}@${DOMAIN}`; return app.request(url, init); };
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: fetchAs as any }));
  return client;
}

test('POST /api/legal-tags: partners only, the id shape is checked, the client must exist, a duplicate is 409, the call is audited', async () => {
  const { db, call } = await seed();
  const body = { id: TAG, name: 'Frontera NDA 2026', client_id: 'frontera', expires_at: '2027-03-31' };
  assert.equal((await call('ana', 'POST', '/api/legal-tags', body)).status, 403);
  let r = await call('chris', 'POST', '/api/legal-tags', { ...body, id: 'LT-Frontera' });
  assert.equal(r.status, 400); assert.equal(r.body.error.path, '/id');
  r = await call('chris', 'POST', '/api/legal-tags', { ...body, id: 'frontera-nda' });
  assert.equal(r.status, 400); assert.equal(r.body.error.path, '/id');
  r = await call('chris', 'POST', '/api/legal-tags', { ...body, client_id: 'nobody' });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'unknown_organisation');
  r = await call('chris', 'POST', '/api/legal-tags', { ...body, client_id: undefined });
  assert.equal(r.status, 400); assert.equal(r.body.error.path, '/client_id');
  r = await call('chris', 'POST', '/api/legal-tags', { ...body, expires_at: '2020-01-01' });
  assert.equal(r.status, 400); assert.equal(r.body.error.path, '/expires_at');
  r = await call('chris', 'POST', '/api/legal-tags', { ...body, expires_at: 'next year' });
  assert.equal(r.status, 400); assert.equal(r.body.error.path, '/expires_at');
  r = await call('chris', 'POST', '/api/legal-tags', { ...body, name: '' });
  assert.equal(r.status, 400); assert.equal(r.body.error.path, '/name');

  r = await call('chris', 'POST', '/api/legal-tags', body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.id, TAG);
  assert.equal(r.body.classification, 'client-nda');
  assert.equal(r.body.data_type, 'second-party');
  assert.equal(r.body.client_id, 'frontera');
  assert.equal(r.body.expires_at, '2027-03-31');
  assert.equal(r.body.originator, 'Frontera Energy');
  assert.equal(r.body.name, 'Frontera NDA 2026');
  const row = (await db.query<any>("SELECT classification, client_id, to_char(expires_at,'YYYY-MM-DD') AS expires_at, notes FROM legal_tags WHERE id = $1", [TAG])).rows[0];
  assert.equal(row.classification, 'client-nda'); assert.equal(row.client_id, 'frontera'); assert.equal(row.expires_at, '2027-03-31'); assert.equal(row.notes, 'Frontera NDA 2026');

  r = await call('chris', 'POST', '/api/legal-tags', body);
  assert.equal(r.status, 409);
  const ev = (await db.query<any>("SELECT * FROM audit_events WHERE action = 'legal_tag.create' ORDER BY id")).rows;
  const ok = ev.find((e: any) => e.detail.status === 201);
  assert.ok(ok, 'the creation is audited');
  assert.equal(ok.person_id, 'chris'); assert.equal(ok.scope, 'client:frontera'); assert.deepEqual(ok.refs, [`tag:${TAG}`]);
  assert.ok(ev.some((e: any) => e.detail.status === 403 && e.person_id === 'ana'), 'the refusal is audited too');
  await db.close();
});

test('GET /api/legal-tags lists the tags the caller may use: a client tag only to partners and to members of that client\'s projects', async () => {
  const { db, call } = await seed();
  await call('chris', 'POST', '/api/legal-tags', { id: TAG, name: 'Frontera NDA 2026', client_id: 'frontera', expires_at: '2027-03-31' });
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ('lt-old-nda','client-nda','second-party','frontera','Frontera Energy','2020-01-01')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,notes) VALUES ('lt-frontera-nda-2026-ab12cd34','client-nda','second-party','frontera','Frontera Energy','derived: union of lt-frontera-nda-2026, lt-firm')");
  const ids = (r: any) => r.body.tags.map((t: any) => t.id).sort();
  const chris = await call('chris', 'GET', '/api/legal-tags');
  assert.equal(chris.status, 200);
  assert.deepEqual(ids(chris), ['lt-firm', TAG, 'lt-public'].sort(), 'expired and derived tags are never offered');
  const tag = chris.body.tags.find((t: any) => t.id === TAG);
  assert.equal(tag.name, 'Frontera NDA 2026'); assert.equal(tag.client_id, 'frontera'); assert.equal(tag.expires_at, '2027-03-31');
  const ana = await call('ana', 'GET', '/api/legal-tags');
  assert.deepEqual(ids(ana), ['lt-firm', 'lt-public']);
  assert.deepEqual(ids(await call('chris', 'GET', '/api/legal-tags?client=frontera')), [TAG]);
  // Once ana is on a Frontera project she may file under its tag.
  await call('chris', 'POST', '/api/projects', { id: PROJECT, name: 'Llanos screen', client_id: 'frontera', default_legal_tag: TAG, members: ['chris', 'ana'] });
  assert.deepEqual(ids(await call('ana', 'GET', '/api/legal-tags')), ['lt-firm', TAG, 'lt-public'].sort());
  assert.deepEqual(ids(await call('ben', 'GET', '/api/legal-tags')), ['lt-firm', 'lt-public']);
  await db.close();
});

test('W7-AC1: a project under the new tag is invisible to an associate without it: the project, Find, Write to… sources and the connector', async () => {
  const { db, call } = await seed();
  assert.equal((await call('chris', 'POST', '/api/legal-tags', { id: TAG, name: 'Frontera NDA 2026', client_id: 'frontera', expires_at: '2027-03-31' })).status, 201);
  const created = await call('chris', 'POST', '/api/projects', { id: PROJECT, name: 'Llanos screen', client_id: 'frontera', default_legal_tag: TAG, members: ['chris'] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.default_legal_tag, TAG);
  // Records of the Frontera project: one under the NDA tag, one firm-tagged (filed the old way), and the firm's own lesson.
  const nda = await item(db, { title: 'Guafita injector capacity note', text: 'Guafita injector capacity 8500 bwpd across six injectors', tag: TAG, client: 'frontera', project: PROJECT });
  const firmInFrontera = await item(db, { title: 'catalog.json', text: 'Guafita injector capacity screening catalog entry for Frontera', tag: 'lt-firm', client: null, project: PROJECT, type: 'note' });
  const lesson = await item(db, { title: 'Lesson: Guafita-type injector capacity', text: 'Guafita lesson: derive voidage from injector capacity', tag: 'lt-firm', client: null, project: 'firm', type: 'lesson' });

  // The project itself: not for ben, not in his list.
  const forBen = await call('ben', 'GET', `/api/projects/${PROJECT}`);
  assert.ok(forBen.status === 403 || forBen.status === 404, `ben got ${forBen.status}`);
  assert.ok(!(await call('ben', 'GET', '/api/projects')).body.projects.some((p: any) => p.id === PROJECT));
  assert.ok((await call('chris', 'GET', '/api/projects')).body.projects.some((p: any) => p.id === PROJECT));

  // Find in firm scope returns none of its NDA items, whoever asks (firm-tagged records stay firm-wide there, by definition);
  // in talara's scope the firm-tagged Frontera record stays out too.
  for (const who of ['ben', 'chris']) {
    const r = await call(who, 'GET', '/api/search?q=Guafita&scope=firm&k=50');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.hits.map((h: any) => h.item_id).sort(), [lesson, firmInFrontera].sort(), `${who} in firm scope sees the firm-tagged records, never the NDA one`);
  }
  const talara = await call('ben', 'GET', '/api/search?q=Guafita&scope=project:talara&k=50');
  assert.deepEqual(talara.body.hits.map((h: any) => h.item_id), [lesson], 'another client\'s records never reach Talara\'s scope, firm-tagged or not');
  assert.equal((await call('ben', 'GET', `/api/search?q=Guafita&scope=project:${PROJECT}`)).status, 403);
  const own = await call('chris', 'GET', `/api/search?q=Guafita&scope=project:${PROJECT}&k=50`);
  assert.deepEqual(own.body.hits.map((h: any) => h.item_id).sort(), [nda, firmInFrontera, lesson].sort());

  // Write to… sources: ben's letter for Talara cites neither Frontera record (S18); the firm lesson is fair game.
  // The brief's first clause is the retrieval sub-query (lexical: every word must match); all three records carry those words.
  const brief = 'Guafita injector capacity; confirm the figure.';
  const ctx = await assembleContext(db, BEN, { kind: 'letter', project_id: 'talara', brief }, {});
  const refs = ctx.sources.map(s => s.ref);
  assert.ok(!refs.includes(`doc:${nda}`) && !refs.includes(`doc:${firmInFrontera}`), `another client's records are not sources: ${refs.join(', ')}`);
  assert.ok(refs.includes(`doc:${lesson}`), `firm knowledge is: ${refs.join(', ')}`);
  const ours = await assembleContext(db, CHRIS, { kind: 'letter', project_id: PROJECT, brief }, {});
  const ourRefs = ours.sources.map(s => s.ref);
  assert.ok(ourRefs.includes(`doc:${nda}`) && ourRefs.includes(`doc:${firmInFrontera}`) && ourRefs.includes(`doc:${lesson}`), `the project's own records are sources for its own letter: ${ourRefs.join(', ')}`);

  // The connector: list_projects omits the project for ben and names it for chris.
  const ben = await connectMcp(db, 'ben');
  const benList = JSON.parse((await ben.callTool({ name: 'list_projects', arguments: {} }) as any).content[0].text);
  assert.ok(!benList.projects.some((p: any) => p.id === PROJECT), 'list_projects omits it');
  await ben.close();
  const chris = await connectMcp(db, 'chris');
  const chrisList = JSON.parse((await chris.callTool({ name: 'list_projects', arguments: {} }) as any).content[0].text);
  assert.ok(chrisList.projects.some((p: any) => p.id === PROJECT));
  await chris.close();
  await db.close();
});
