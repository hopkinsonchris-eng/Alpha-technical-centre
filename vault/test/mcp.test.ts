import { test } from 'node:test';
process.env.VAULT_STORAGE_DIR ??= (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'vault-mcp-'));
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureSearch } from '../src/gateway/index.ts';
import { configureDraft } from '../src/api/draft.routes.ts';
import { setFirmDir } from '../src/jobs/lessons-index.ts';

const DOMAIN = 'alpha-technical-centre.com';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CLIENTS = ['a', 'b', 'c'];
const WORDS = ['cubiro', 'waterflood', 'boscan', 'polymer', 'npv10', 'royalty', 'carabobo', 'injector', 'viscosity', 'vintage'];
const RUN_A = '00000000-0000-4000-8000-00000000a001', RUN_FIRM = '00000000-0000-4000-8000-00000000f001';
const ITEM_A = '00000000-0000-4000-8000-00000000a101';

// The MCP endpoint authenticates from the environment (like the server at boot). DEV_USER_EMAIL stands in for Access.
delete process.env.CF_ACCESS_TEAM_DOMAIN;
process.env.NODE_ENV = 'test';
configureSearch({ embed: async (q) => Array.from({ length: 1024 }, (_, i) => (i === (q.length % 1024) ? 1 : 0)) });

/** Three clients (a, b, c), each with two projects and NDA chunks, plus public and firm chunks (copied from gateway.scope.test.ts, with real Access emails). */
async function seed(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db);
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('chris','chris@${DOMAIN}','Chris','partner'),('ana','ana@${DOMAIN}','Ana','associate'),('ben','ben@${DOMAIN}','Ben','associate')`);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','ANH'),('lt-firm','firm','first-party','ATC'),('lt-firm-po','firm','first-party','ATC')");
  await db.query("UPDATE legal_tags SET partners_only = true WHERE id = 'lt-firm-po'");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','Firm','lt-firm')");
  for (const c of CLIENTS) {
    await db.query('INSERT INTO organisations (id,name,kind) VALUES ($1,$2,$3)', [c, `Client ${c.toUpperCase()}`, 'client']);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ($1,'client-nda','second-party',$2,$3)", [`lt-${c}-nda`, c, c]);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ($1,'client-nda','second-party',$2,$3,'2020-01-01')", [`lt-${c}-expired`, c, c]);
    await db.query('INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,$2,$3,$4,$5::text[])', [`p-${c}-1`, c, `${c} one`, `lt-${c}-nda`, c === 'a' ? ['ana'] : []]);
    await db.query('INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,$2,$3,$4,$5::text[])', [`p-${c}-2`, c, `${c} two`, `lt-${c}-nda`, []]);
  }
  let n = 0;
  const put = async (tag: string, client: string | null, project: string, partnersOnly: boolean, current: boolean, expires: string | null) => {
    const text = `${WORDS[n % WORDS.length]} ${WORDS[(n * 3) % WORDS.length]} chunk ${n} of ${project}`;
    const vec = '[' + Array.from({ length: 1024 }, (_, i) => (i === n % 1024 ? 1 : 0)).join(',') + ']';
    await db.query('INSERT INTO chunks (item_id, run_id, ordinal, text, legal_tag, client_id, project_id, partners_only, expires_at, current, embedding) VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9::vector)', [n, text, tag, client, project, partnersOnly, expires, current, vec]);
    n++;
  };
  await db.query('ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_check'); // seeded chunks have no item/run
  for (let i = 0; i < 6; i++) { await put('lt-public', null, 'firm', false, true, null); await put('lt-firm', null, 'firm', false, true, null); }
  await put('lt-firm-po', null, 'firm', true, true, null); await put('lt-firm', null, 'firm', false, false, null); await put('lt-firm', null, 'firm', false, true, '2026-01-01');
  for (const c of CLIENTS) for (const p of [`p-${c}-1`, `p-${c}-2`]) for (let i = 0; i < 5; i++) await put(`lt-${c}-nda`, c, p, false, true, null);
  for (const c of CLIENTS) await put(`lt-${c}-expired`, c, `p-${c}-1`, false, true, null);

  // Structured records: a run and a stale note in p-a-1, a contact, and a firm run to cite as lesson evidence.
  const run = (id: string, project: string, tag: string, title: string, at: string, n: number) => db.query(
    "INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,client_id,legal_tag,title,record,input_hash,status) VALUES ($1,'opportunity-register','2.1.2','abc1234','chris',$2,$3,(SELECT client_id FROM projects WHERE id = $3),$4,$5,$6::jsonb,$7,'final')",
    [id, at, project, tag, title, JSON.stringify({ id, job: 'opportunity-register', title, outputs: { npv10: { value: 12.5, unit: 'MMUSD' } } }), `sha256:${String(n).repeat(64).slice(0, 64)}`]);
  await run(RUN_A, 'p-a-1', 'lt-a-nda', 'Client A screening', '2026-08-01T10:00:00Z', 1);
  await run(RUN_FIRM, 'firm', 'lt-firm', 'Firm benchmark', '2026-07-01T10:00:00Z', 2);
  await db.query("INSERT INTO items (id,type,title,created_at,project_id,client_id,legal_tag,origin,content_hash,version,stale) VALUES ($1,'note','Kick-off note','2026-09-10T09:30:00Z','p-a-1','a','lt-a-nda','{\"source\":\"upload\"}'::jsonb,$2,1,true)", [ITEM_A, 'sha256:' + '3'.repeat(64)]);
  await db.query("INSERT INTO contacts (id,organisation_id,name,role,emails) VALUES ('ct-a','a','Alicia Alonso','Asset manager','{alicia@client-a.example}')");
  await db.query("INSERT INTO project_contacts (project_id,contact_id) VALUES ('p-a-1','ct-a')");
  return db;
}

// /api authentication follows the same DEV_USER_EMAIL the MCP endpoint reads.
const devAuth = { allowedEmailDomain: DOMAIN, get devUserEmail() { return process.env.DEV_USER_EMAIL; } };
type Who = 'chris' | 'ana' | 'ben';
async function connect(db: Db, who: Who) {
  const app = await createApp({ db, auth: devAuth, version: 'test' });
  const fetchAs = (url: any, init: any) => { process.env.DEV_USER_EMAIL = `${who}@${DOMAIN}`; return app.request(url, init); };
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: fetchAs as any }));
  return { app, client, fetchAs };
}
const call = async (client: Client, name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
const mcpEvents = async (db: Db) => (await db.query<any>("SELECT action, scope, refs, detail, person_id FROM audit_events WHERE action LIKE 'mcp.%' ORDER BY id")).rows;

test('every tool is listed', async () => {
  const db = await seed(); const { client } = await connect(db, 'chris');
  const names = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(names, ['draft', 'file_item', 'get_item', 'get_lessons', 'get_project_context', 'get_run', 'get_tool_current', 'list_projects', 'list_runs', 'record_lesson', 'search_vault']);
  // W5-AC13: every tool carries a title and read/write hints.
  for (const t of (await client.listTools()).tools) { assert.ok(t.title, t.name + ' has a title'); assert.ok(t.annotations && typeof t.annotations.readOnlyHint === 'boolean', t.name + ' says whether it reads or writes'); }
  await client.close(); await db.close();
});

test('AC1: search_vault in project:A scope returns only A-scope hits', async () => {
  const db = await seed();
  const ana = await connect(db, 'ana'), chris = await connect(db, 'chris');
  for (const [who, c] of [['ana', ana.client], ['chris', chris.client]] as const) {
    const r = await call(c, 'search_vault', { q: 'chunk', scope: 'project:p-a-1', k: 50 });
    assert.ok(!r.isError, JSON.stringify(r));
    const hits = r.structuredContent.hits as any[];
    assert.ok(hits.length > 0);
    assert.equal(r.structuredContent.scope, 'project:p-a-1');
    for (const h of hits) {
      assert.ok(['lt-public', 'lt-firm', 'lt-a-nda', ...(who === 'chris' ? ['lt-firm-po'] : [])].includes(h.legal_tag), `${who}: leaked ${h.legal_tag}`);
      if (who === 'ana') assert.notEqual(h.legal_tag, 'lt-firm-po', 'partners-only chunk reached an associate');
    }
    assert.ok(hits.some(h => h.legal_tag === 'lt-a-nda'), 'client A hits are present');
    if (who === 'ana') assert.ok(hits.every(h => h.legal_tag !== 'lt-a-nda' || h.project_id === 'p-a-1'));
  }
  // Scope is mandatory and authorised: no scope, another client's project and a project the associate is not in are tool errors.
  assert.equal((await call(ana.client, 'search_vault', { q: 'chunk', scope: 'project:p-b-1' })).isError, true);
  assert.equal((await call(ana.client, 'search_vault', { q: 'chunk', scope: 'project:p-a-2' })).isError, true);
  assert.equal((await call(ana.client, 'search_vault', { q: 'chunk', scope: 'galaxy:1' })).isError, true);
  const noScope = await call(ana.client, 'search_vault', { q: 'chunk' });
  assert.equal(noScope.isError, true); assert.match(noScope.content[0].text, /scope/i);
  await ana.client.close(); await chris.client.close(); await db.close();
});

test('AC2: record_lesson creates a proposed lesson visible in GET /api/lessons?status=proposed', async () => {
  const db = await seed(); const { app, client } = await connect(db, 'ana');
  const r = await call(client, 'record_lesson', { lesson: { claim: 'State the datum in every tops table.', detail: 'One source used KB, the other MSL.', scope: 'discipline', scope_id: 'geology', disciplines: ['geology'], evidence: [`run:${RUN_FIRM}`], confidence: 0.7, status: 'confirmed', author: 'chris' } });
  assert.ok(!r.isError, JSON.stringify(r));
  assert.equal(r.structuredContent.status, 'proposed');
  assert.equal(r.structuredContent.author, 'ana');
  process.env.DEV_USER_EMAIL = `ana@${DOMAIN}`;
  const list: any = await (await app.request('/api/lessons?status=proposed')).json();
  assert.ok(list.lessons.some((l: any) => l.id === r.structuredContent.id && l.status === 'proposed'));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM lessons WHERE status = 'confirmed'")).rows[0].n, 0);
  // The route's own validation applies: unknown evidence is refused.
  const bad = await call(client, 'record_lesson', { lesson: { claim: 'x', scope: 'firm', evidence: ['run:00000000-0000-4000-8000-000000000999'], confidence: 0.5 } });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /evidence/);
  // get_lessons: a partner's confirmed lessons appear, proposals do not.
  const empty = await call(client, 'get_lessons', { scope: 'discipline:geology' });
  assert.equal(empty.structuredContent.count, 0);
  await client.close(); await db.close();
});

test('AC5: resources report lastModified matching the file, and the lessons resource returns its content', async () => {
  const db = await seed();
  const dir = mkdtempSync(path.join(tmpdir(), 'mcp-firm-'));
  const file = path.join(dir, 'LESSONS.md');
  writeFileSync(file, '# Firm lessons\n\n- Confirm the datum first.\n');
  const t = new Date('2026-03-04T05:06:07Z'); utimesSync(file, t, t);
  setFirmDir(dir);
  const { client } = await connect(db, 'chris');
  const listed = await client.listResources();
  const firm = listed.resources.find(r => r.uri === 'vault://lessons/firm.md')!;
  assert.equal(firm.annotations?.lastModified, statSync(file).mtime.toISOString());
  const read = await client.readResource({ uri: 'vault://lessons/firm.md' });
  const c: any = read.contents[0];
  assert.equal(c.text, readFileSync(file, 'utf8'));
  assert.equal(c._meta.lastModified, statSync(file).mtime.toISOString());
  assert.equal(c._meta.lastModified, '2026-03-04T05:06:07.000Z');

  const clFile = path.join(REPO, 'tools/opportunity-register/CHANGELOG.md');
  const cl = listed.resources.find(r => r.uri === 'vault://tools/opportunity-register/CHANGELOG.md');
  assert.equal(cl?.annotations?.lastModified, statSync(clFile).mtime.toISOString());
  const clRead: any = (await client.readResource({ uri: 'vault://tools/opportunity-register/CHANGELOG.md' })).contents[0];
  assert.equal(clRead.text, readFileSync(clFile, 'utf8'));
  assert.equal(clRead._meta.lastModified, statSync(clFile).mtime.toISOString());
  await assert.rejects(() => client.readResource({ uri: 'vault://tools/..%2F..%2Fpackage/CHANGELOG.md' }));
  await assert.rejects(() => client.readResource({ uri: 'vault://tools/nope/CHANGELOG.md' }), /no changelog|unknown/);

  // The project summary is generated, scope-checked and dated by the last activity.
  const sum: any = (await client.readResource({ uri: 'vault://projects/p-a-1/summary.md' })).contents[0];
  assert.equal(sum._meta.lastModified, '2026-09-10T09:30:00.000Z');
  assert.match(sum.text, /^# a one \(p-a-1\)/);
  assert.match(sum.text, /Client: Client A \(a\)/);
  assert.match(sum.text, /Runs: 1\b/); assert.match(sum.text, /Items: 1\b/);
  assert.match(sum.text, /Stale: 0 runs, 1 item\b/);
  assert.match(sum.text, /Alicia Alonso, Asset manager \(Client A\)/);
  assert.match(sum.text, /Last activity: 2026-09-10T09:30:00.000Z \(note "Kick-off note"\)/);
  assert.ok((await client.listResources()).resources.length >= 2);
  await client.close();

  const ana = await connect(db, 'ana'), ben = await connect(db, 'ben');
  assert.match(((await ana.client.readResource({ uri: 'vault://projects/p-a-1/summary.md' })).contents[0] as any).text, /Runs: 1/);
  await assert.rejects(() => ben.client.readResource({ uri: 'vault://projects/p-a-1/summary.md' }), /forbidden|not a member/);
  await assert.rejects(() => ana.client.readResource({ uri: 'vault://projects/p-b-1/summary.md' }), /forbidden|not a member/);
  const seen = (await ana.client.listResources()).resources.filter(r => r.uri.startsWith('vault://projects/')).map(r => r.uri);
  assert.deepEqual(seen, ['vault://projects/p-a-1/summary.md']);
  setFirmDir(null);
  await ana.client.close(); await ben.client.close(); await db.close();
});

test('AC4-style: get_tool_current equals GET /api/tools/:id/resolve', async () => {
  const db = await seed(); const { app, client } = await connect(db, 'chris');
  const r = await call(client, 'get_tool_current', { id: 'opportunity-register' });
  assert.ok(!r.isError, JSON.stringify(r));
  process.env.DEV_USER_EMAIL = `chris@${DOMAIN}`;
  const rest = await (await app.request('/api/tools/opportunity-register/resolve')).json();
  assert.deepEqual(r.structuredContent, rest);
  assert.deepEqual(JSON.parse(r.content[0].text), rest);
  assert.equal((await call(client, 'get_tool_current', { id: 'no-such-tool' })).isError, true);
  await client.close(); await db.close();
});

test('get_run and list_runs go through scope', async () => {
  const db = await seed();
  const ana = await connect(db, 'ana'), ben = await connect(db, 'ben');
  const run = await call(ana.client, 'get_run', { id: RUN_A });
  assert.equal(run.structuredContent.id, RUN_A); assert.equal(run.structuredContent.outputs.npv10.value, 12.5);
  assert.equal((await call(ben.client, 'get_run', { id: RUN_A })).isError, true, 'ben is not on project a');
  assert.equal((await call(ana.client, 'get_run', { id: '00000000-0000-4000-8000-000000000999' })).isError, true);
  const list = await call(ana.client, 'list_runs', { project: 'p-a-1', job: 'opportunity-register', since: '2026-01-01' });
  assert.deepEqual(list.structuredContent.runs.map((r: any) => r.id), [RUN_A]);
  assert.equal((await call(ana.client, 'list_runs', { project: 'p-a-1', since: '2026-09-01' })).structuredContent.runs.length, 0);
  assert.equal((await call(ben.client, 'list_runs', { project: 'p-a-1' })).isError, true);
  await ana.client.close(); await ben.client.close(); await db.close();
});

test('AC-auth: POST /mcp without Access is 401; GET is 405 when authenticated', async () => {
  const db = await seed();
  const app = await createApp({ db, auth: devAuth, version: 'test' });
  delete process.env.DEV_USER_EMAIL;
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
  const post = () => app.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(init) });
  const r = await post();
  assert.equal(r.status, 401);
  assert.equal(((await r.json()) as any).error.code, -32001);
  assert.equal((await app.request('/mcp')).status, 401);
  assert.equal((await app.request('/mcp', { headers: { 'cf-access-jwt-assertion': 'not-a-jwt' } })).status, 401);
  process.env.DEV_USER_EMAIL = `ana@${DOMAIN}`;
  assert.equal((await post()).status, 200);
  const g = await app.request('/mcp');
  assert.equal(g.status, 405); assert.equal(g.headers.get('allow'), 'POST');
  assert.equal(((await g.json()) as any).jsonrpc, '2.0');
  assert.equal((await app.request('/mcp', { method: 'DELETE' })).status, 405);
  await db.close();
});

test('every tool call writes exactly one mcp.<tool> audit event, without content', async () => {
  const db = await seed(); const { client } = await connect(db, 'ana');
  const calls: Array<[string, Record<string, unknown>]> = [
    ['search_vault', { q: 'waterflood boscan', scope: 'project:p-a-1' }],
    ['search_vault', { q: 'chunk', scope: 'project:p-b-1' }],          // refused: still exactly one event
    ['get_run', { id: RUN_A }],
    ['list_runs', { project: 'p-a-1' }],
    ['get_lessons', { scope: 'project:p-a-1' }],
    ['get_tool_current', { id: 'opportunity-register' }],
    ['record_lesson', { lesson: { claim: 'Check the datum.', scope: 'project', scope_id: 'p-a-1', evidence: [`run:${RUN_A}`], confidence: 0.6 } }],
  ];
  for (const [name, args] of calls) {
    const before = (await mcpEvents(db)).length;
    await call(client, name, args);
    const after = await mcpEvents(db);
    assert.equal(after.length, before + 1, `${name}: expected one new mcp.* event`);
    assert.equal(after.at(-1).action, `mcp.${name}`);
    assert.equal(after.at(-1).person_id, 'ana');
  }
  const ev = await mcpEvents(db);
  assert.equal(ev[0].scope, 'project:p-a-1');
  assert.match(ev[0].detail.query_hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(ev).includes('boscan'), 'the query text is never stored');
  assert.equal(ev[1].detail.status, 403);
  assert.equal(ev[2].refs[0], `run:${RUN_A}`);
  assert.equal(ev[6].detail.status, 200);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'lesson.create'")).rows[0].n, 1, 'the route handler audits its own event too');
  await client.close(); await db.close();
});

test('draft returns the DraftResult without the assembled context, and the draft can be rendered', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await seedFixture(db, path.join(HERE, 'fixtures/ac15/seed.json'));
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'orinoco-partnership'");
  configureDraft({ provider: null, search: {} });
  const { app, client } = await connect(db, 'chris');
  const bad = await call(client, 'draft', { kind: 'letter', project_id: 'nope', brief: 'Propose the scope of the evaluation.' });
  assert.equal(bad.isError, true);
  const r = await call(client, 'draft', { kind: 'letter', project_id: 'orinoco-partnership', organisation_id: 'petrolera-del-orinoco', brief: 'Propose the scope of a joint technical evaluation.' });
  assert.ok(!r.isError, JSON.stringify(r));
  const b = r.structuredContent;
  assert.ok(b.id && typeof b.draft === 'string' && Array.isArray(b.citations) && Array.isArray(b.sources) && Array.isArray(b.questions));
  assert.equal('context' in b, false);
  process.env.DEV_USER_EMAIL = `chris@${DOMAIN}`;
  const render = await app.request('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft_id: b.id }) });
  assert.equal(render.status, 200);
  const ev = (await mcpEvents(db)).filter(e => e.action === 'mcp.draft');
  assert.equal(ev.length, 2);
  assert.equal(ev[1].refs[0], `doc:${b.id}`);
  await client.close(); await db.close();
});

test('W5-AC13: list_projects, get_project_context, get_item and file_item work under scope; the filed note is a record of the project', async () => {
  const db = await seed();
  await db.query(`UPDATE projects SET register = '{"holder":"Client A Holdings","partners":["Partner Co"]}'::jsonb WHERE id = 'p-a-1'`);
  await db.query("INSERT INTO chunks (item_id, run_id, ordinal, text, legal_tag, client_id, project_id, partners_only, current, embedding) VALUES ($1, NULL, 0, 'Kick-off: agreed the data room index by Friday.', 'lt-a-nda', 'a', 'p-a-1', false, true, $2::vector)", [ITEM_A, '[' + Array.from({ length: 1024 }, (_, i) => (i === 7 ? 1 : 0)).join(',') + ']']);
  const ana = await connect(db, 'ana'), chris = await connect(db, 'chris');
  const la = await call(ana.client, 'list_projects', {}); const lc = await call(chris.client, 'list_projects', {});
  assert.deepEqual(la.structuredContent.projects.map((p: any) => p.id), ['p-a-1'], 'an associate sees the project she is a member of');
  assert.ok(lc.structuredContent.projects.length > la.structuredContent.projects.length);
  assert.match(lc.structuredContent.projects[0].hub_url, /\/hub\/project\.html\?id=/);
  const ctx = await call(chris.client, 'get_project_context', { project_id: 'p-a-1' });
  assert.ok(!ctx.isError, JSON.stringify(ctx));
  assert.match(ctx.structuredContent.markdown, /# a one \(p-a-1\)/); assert.match(ctx.structuredContent.markdown, /Current owner: Client A Holdings/); assert.match(ctx.structuredContent.markdown, /JV partners: Partner Co/);
  assert.equal(ctx.structuredContent.counterparties.holder, 'Client A Holdings');
  const other = await call(ana.client, 'get_project_context', { project_id: 'p-b-1' });
  assert.ok(other.isError, 'an invisible project is an error, not a summary');
  const it = await call(chris.client, 'get_item', { id: ITEM_A });
  assert.ok(!it.isError, JSON.stringify(it));
  assert.equal(it.structuredContent.title, 'Kick-off note'); assert.match(it.structuredContent.text, /data room index/); assert.equal(it.structuredContent.ref, 'doc:' + ITEM_A);
  const filed = await call(chris.client, 'file_item', { project_id: 'p-a-1', title: 'Call with Client A, 3 October', text: '# Call\n\nThey will send the index on Monday.', cites: ['doc:' + ITEM_A] });
  assert.ok(!filed.isError, JSON.stringify(filed));
  const ref: string = filed.structuredContent.ref;
  assert.match(ref, /^doc:[0-9a-f-]{36}$/);
  const row = (await db.query<any>("SELECT type, title, project_id, origin->>'source' AS source, authors FROM items WHERE id = $1", [ref.slice(4)])).rows[0];
  assert.equal(row.type, 'note'); assert.equal(row.project_id, 'p-a-1'); assert.equal(row.source, 'assistant'); assert.deepEqual(row.authors, ['chris']);
  const cites = (await db.query<any>('SELECT ref FROM item_cites WHERE item_id = $1', [ref.slice(4)])).rows.map((r: any) => r.ref);
  assert.deepEqual(cites, ['doc:' + ITEM_A]);
  const back = await call(chris.client, 'get_item', { id: ref.slice(4) });
  assert.match(back.structuredContent.title, /Call with Client A/);
  const denied = await call(ana.client, 'file_item', { project_id: 'p-b-1', title: 'Sneaky note', text: 'x' });
  assert.ok(denied.isError);
  const ev = (await db.query<any>("SELECT action, person_id, refs FROM audit_events WHERE action = 'mcp.file_item' AND person_id = 'chris' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(ev.person_id, 'chris'); assert.ok(ev.refs.includes(ref));
  await ana.client.close(); await chris.client.close(); await db.close();
});
