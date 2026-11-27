import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { searchDiagnostics, searchHealthLines } from '../src/gateway/diagnostics.ts';
import { loadProjects } from '../src/gateway/index.ts';
import { recentSearchTimings, resetSearchTimings, startSearchTiming } from '../src/gateway/timings.ts';
import { paragraphs } from './fixtures/ingest/build.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import type { Person } from '../src/auth.ts';

let h: Harness;
before(async () => { h = await setup('vault-searchdiag-'); });
after(async () => { await h.db.close(); });

const P = 'orinoco-partnership';
const person = async (role: string): Promise<Person> => (await h.db.query<any>('SELECT id, email, name, role FROM people WHERE role = $1 ORDER BY id LIMIT 1', [role])).rows[0];

test('search health counts chunks, sizes the table, reads the server, plans both statements and lists stage timings', async () => {
  const body = paragraphs(40).join('\n\n');
  assert.equal((await h.upload([{ name: 'd1.md', bytes: body, type: 'text/markdown' }])).status, 201);
  const { runIngestSync } = await import('../src/jobs/ingest-sync.ts');
  const { FakeEmbedder } = await import('../src/ingest/embed.ts');
  await runIngestSync(h.db, { embedder: new FakeEmbedder() } as any).catch(() => undefined);
  resetSearchTimings();
  const res = await h.app.request(`/api/search?q=${encodeURIComponent('reservoir')}&scope=project:${P}`);
  assert.equal(res.status, 200);

  const partner = await person('partner');
  const d = await searchDiagnostics(h.db, P, partner, await loadProjects(h.db));
  assert.ok(!('error' in d.chunks), JSON.stringify(d.chunks));
  const n = (await h.db.query<any>('SELECT count(*)::int AS n, count(embedding)::int AS e FROM chunks')).rows[0];
  assert.equal((d.chunks as any).total, n.n);
  assert.equal((d.chunks as any).embedded, n.e);
  assert.ok(Array.isArray((d.chunks as any).by_project));
  assert.ok(!('error' in d.size), JSON.stringify(d.size));
  assert.ok((d.size as any).indexes.some((i: any) => i.name === 'chunks_tsv_idx' && i.method === 'gin'));
  assert.ok(!('error' in d.server), JSON.stringify(d.server));
  assert.match((d.server as any).postgres, /^\d+/);
  assert.ok((d.server as any).pgvector);
  assert.ok(d.plans && !('error' in d.plans), JSON.stringify(d.plans));
  assert.ok((d.plans as any).vector.length > 0 && (d.plans as any).lexical.length > 0);
  assert.ok(d.activity && !('error' in d.activity), JSON.stringify(d.activity));
  assert.ok(!('error' in d.largest_files), JSON.stringify(d.largest_files));
  assert.ok(!('error' in d.duplicates), JSON.stringify(d.duplicates));
  assert.equal(d.recent_searches.length, 1);
  assert.equal(d.recent_searches[0].stage, 'done');
  assert.equal(d.recent_searches[0].scope, `project:${P}`);
  assert.ok(d.recent_searches[0].lexical_ms != null && d.recent_searches[0].total_ms != null);
  const md = searchHealthLines(d).join('\n');
  assert.match(md, /## Search health/);
  assert.match(md, /Chunks \(firm-wide\): \d+/);
  assert.match(md, /Plan, vector query/);
  assert.doesNotMatch(md, /could not be read/);
});

test('firm-wide detail is for partners: an associate sees no other project, no running statements, no plans', async () => {
  const associate: Person = { id: 'assoc-x', email: 'assoc-x@alpha-technical-centre.com', name: 'Assoc', role: 'associate' };
  startSearchTiming('project:somewhere-else').done();
  const d = await searchDiagnostics(h.db, P, associate, await loadProjects(h.db));
  assert.equal((d.chunks as any).by_project, null);
  assert.equal(d.activity, null);
  assert.equal(d.plans, null);
  assert.ok(d.recent_searches.every(t => t.scope === `project:${P}`));
});

test('a search that has not finished shows the stage it is in; one that failed shows where', async () => {
  resetSearchTimings();
  const t = startSearchTiming('firm');
  let release!: () => void;
  const pending = t.stage('vector', () => new Promise<any[]>(r => { release = () => r([]); }), r => r.length);
  const [running] = recentSearchTimings();
  assert.equal(running.stage, 'vector');
  assert.ok(running.running_ms != null);
  release(); await pending; t.done();
  assert.equal(recentSearchTimings()[0].stage, 'done');
  const f = startSearchTiming('firm');
  await assert.rejects(f.stage('embed', async () => { throw new Error('voyage 500'); }).catch(e => { f.fail(e); throw e; }));
  assert.match(recentSearchTimings()[0].error ?? '', /^embed: voyage 500/);
});

test('get_project_context carries the search health section, in the markdown and as `search`', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { createApp } = await import('../src/app.ts');
  const app = await createApp({ db: h.db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', get devUserEmail() { return process.env.DEV_USER_EMAIL; } }, version: 'test' });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: ((url: any, init: any) => { process.env.DEV_USER_EMAIL = 'chris@alpha-technical-centre.com'; return app.request(url, init); }) as any }));
  const r = (await client.callTool({ name: 'get_project_context', arguments: { project_id: P } })) as any;
  assert.match(r.structuredContent.markdown, /## Index health[\s\S]*## Search health[\s\S]*Chunks \(firm-wide\)/);
  assert.ok(r.structuredContent.search.chunks.total >= 1);
  await client.close();
});
