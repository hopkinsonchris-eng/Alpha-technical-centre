// Wave 7 PR3 (docs/vault-hub/wave7/05-markup.md §1.7, W7-AC12): get_project_context and the
// vault://projects/{id}/summary.md resource carry the standing (stage and since, next action, figures with units,
// deadlines, counterparties), the same shape GET /api/projects/:id/standing returns. Written before the implementation.
import { test } from 'node:test';
process.env.VAULT_STORAGE_DIR ??= (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'vault-mcp-standing-'));
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';

const DOMAIN = 'alpha-technical-centre.com';
const RUN_A = '00000000-0000-4000-8000-00000000a001';

delete process.env.CF_ACCESS_TEAM_DOMAIN;
process.env.NODE_ENV = 'test';

async function seed(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db);
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('chris','chris@${DOMAIN}','Chris','partner'),('ana','ana@${DOMAIN}','Ana','associate'),('ben','ben@${DOMAIN}','Ben','associate')`);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','ANH'),('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','Firm','lt-firm')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('a','Client A','client'), ('anh','ANH','regulator')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ('lt-a-nda','client-nda','second-party','a','a','2027-06-30')");
  await db.query(`INSERT INTO projects (id,client_id,name,default_legal_tag,members,country,stage,stage_history,register,created_at) VALUES ('p-a-1','a','a one','lt-a-nda','{ana}','CO','Qualified',
    '[{"stage":"Initial screen","at":"2026-08-01T09:00:00Z","by":"chris"},{"stage":"Qualified","at":"2026-08-20T09:00:00Z","by":"chris"}]'::jsonb,
    '{"holder":"Client A Holdings","partners":["Partner Co"],"next":"Agree the data room index","current":16,"plan":22}'::jsonb,'2026-08-01T09:00:00Z')`);
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('p-a-2','a','a two','lt-a-nda','{}')");
  await db.query("INSERT INTO project_organisations (project_id,organisation_id,role) VALUES ('p-a-1','anh','government')");
  await db.query(
    "INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,client_id,legal_tag,title,record,input_hash,status) VALUES ($1,'opportunity-register','2.1.2','abc1234','chris','2026-08-01T10:00:00Z','p-a-1','a','lt-a-nda','Client A screening',$2::jsonb,$3,'final')",
    [RUN_A, JSON.stringify({ id: RUN_A, job: 'opportunity-register', title: 'Client A screening', outputs: { npv10: { value: 12.5, unit: 'MMUSD' } } }), 'sha256:' + '1'.repeat(64)]);
  await db.query("INSERT INTO project_milestones (id,project_id,kind,title,due_at,owner,created_by) VALUES ($1,'p-a-1','next_action','Agree the data room index','2026-10-20','ana','chris'), ($2,'p-a-1','reply_due','Reply from ANH on the licence map','2026-09-30',NULL,'chris')", [randomUUID(), randomUUID()]);
  return db;
}

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

test('W7-AC12: get_project_context carries the standing, equal to the route\'s answer; the summary resource says the same in words', async () => {
  const db = await seed();
  const chris = await connect(db, 'chris');
  const ctx = await call(chris.client, 'get_project_context', { project_id: 'p-a-1' });
  assert.ok(!ctx.isError, JSON.stringify(ctx));
  const st = ctx.structuredContent.standing;
  assert.ok(st, 'the tool returns a standing block');
  assert.deepEqual(Object.keys(st), ['project', 'next', 'figures', 'open', 'counterparties', 'deadlines', 'since', 'stale_counts', 'last_activity']);
  // Parity with the route for the same caller: the two differ only in `since`, which moves with every read.
  const res = await chris.fetchAs('/api/projects/p-a-1/standing', { method: 'GET' });
  assert.equal(res.status, 200);
  const route: any = await res.json();
  const strip = ({ since: _s, ...rest }: any) => rest;
  assert.deepEqual(strip(st), strip(route));
  assert.equal(st.project.stage, 'Qualified'); assert.equal(st.project.stage_since, '2026-08-20T09:00:00.000Z');
  assert.deepEqual(st.next, { title: 'Agree the data room index', due_at: '2026-10-20', owner: 'ana', ref: null });
  assert.ok(st.figures.some((f: any) => f.name === 'npv10' && f.unit === 'MMUSD' && f.as_of === '2026-08-01' && f.run_status === 'final'));
  assert.ok(st.figures.some((f: any) => f.job === 'register' && f.name === 'current' && f.unit === 'kboe/d'));
  assert.deepEqual(st.deadlines.map((d: any) => [d.kind, d.due_at, d.overdue]), [['reply_due', '2026-09-30', true], ['next_action', '2026-10-20', false], ['expiry', '2027-06-30', false]]);
  assert.deepEqual(st.counterparties.map((c: any) => [c.organisation_id, c.role]), [['anh', 'government']]);
  // The markdown the model reads says the same, with units.
  const md: string = ctx.structuredContent.markdown;
  assert.match(md, /## Standing/);
  assert.match(md, /Stage: Qualified since 2026-08-20/);
  assert.match(md, /Next: Agree the data room index \(due 2026-10-20, ana\)/);
  assert.match(md, /npv10: 12\.5 MMUSD \(as of 2026-08-01, final, run:00000000-0000-4000-8000-00000000a001\)/);
  assert.match(md, /current: 16 kboe\/d \(as of 2026-08-20, register\)/);
  assert.match(md, /Reply from ANH on the licence map: 2026-09-30 \(overdue\)/);
  assert.match(md, /ANH \(government\)/);
  assert.match(md, /Current owner: Client A Holdings/, 'the register text stays');
  // The resource carries the same section.
  const sum: any = (await chris.client.readResource({ uri: 'vault://projects/p-a-1/summary.md' })).contents[0];
  assert.match(sum.text, /## Standing/); assert.match(sum.text, /npv10: 12\.5 MMUSD/); assert.match(sum.text, /Stage: Qualified since 2026-08-20/);
  await chris.client.close();

  const ana = await connect(db, 'ana'), ben = await connect(db, 'ben');
  const mine = await call(ana.client, 'get_project_context', { project_id: 'p-a-1' });
  assert.ok(!mine.isError); assert.equal(mine.structuredContent.standing.project.stage, 'Qualified');
  const other = await call(ben.client, 'get_project_context', { project_id: 'p-a-1' });
  assert.ok(other.isError, 'an associate without the tag gets an error, not a standing');
  await assert.rejects(() => ben.client.readResource({ uri: 'vault://projects/p-a-1/summary.md' }), /forbidden|not a member/);
  await ana.client.close(); await ben.client.close(); await db.close();
});
