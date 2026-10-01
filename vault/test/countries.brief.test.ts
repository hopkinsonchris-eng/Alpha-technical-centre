// Wave 2, PR 4 (docs/vault-hub/wave2/05-markup.md §1.6, Option A): the country brief.
// POST /api/countries/:code/brief writes a cited brief from what the Vault holds for the
// country, within the caller's scope, cached per legal scope and regenerated when a
// source changes. Smoke tests for AC16, written before the implementation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-brief-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureBrief } = await import('../src/api/countries.routes.ts');
const { FakeProvider } = await import('../src/llm/provider.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const baseRun = fixture('run-record/valid-1.json');
const run = (o: Record<string, unknown>) => ({ ...baseRun, id: randomUUID(), input_hash: hashOf(randomUUID()), inputs: [], ...o });

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ben: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const post = async (a: typeof partner, url: string, body: unknown = {}) => {
  const r = await a.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const DOC = randomUUID();
let calls = 0;
/** Cites the first run and the first document it is given, adds an uncited figure and an out-of-scope citation. */
const provider = new FakeProvider((req) => {
  calls++;
  const u = req.messages[0].content;
  const runRef = /\[run:([0-9a-f-]{36})\]/.exec(u)?.[1];
  const docRef = /\[doc:([0-9a-f-]{36})\]/.exec(u)?.[1];
  return [
    `Situation. Alpha holds one opportunity in this country at the Commercial review stage [run:${runRef}].`,
    `The waterflood screen gives 12,400 bopd of technical potential [run:${runRef}] and the data room index lists 60 producers [doc:${docRef}].`,
    'An unsupported figure of 99 MMbbl appears here with no record behind it.',
    'A claim with a foreign citation [doc:00000000-0000-4000-8000-000000009999].',
  ].join('\n\n');
});

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('frontera','Frontera Energy','client','CO')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera Energy')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,lat,lon,stage,members) VALUES ('kaz-brownfield',NULL,'Western Kazakhstan Brownfield','prospect','lt-firm','KZ',47.1,51.9,'Commercial review','{chris}')");
  await db.query("INSERT INTO projects (id,client_id,name,status,default_legal_tag,country,members) VALUES ('egy-onshore','frontera','Egypt Onshore Gas Hub','prospect','lt-frontera-nda-2026','EG','{chris}')");
  partner = await appFor(`chris@${DOMAIN}`);
  ben = await appFor(`ben@${DOMAIN}`);
  const r = run({ project_id: 'kaz-brownfield', client_id: null, legal_tag: 'lt-firm', status: 'final', title: 'Waterflood screen', outputs: { technical_potential_bopd: { value: 12400, unit: 'bopd' } } });
  assert.equal((await partner.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) })).status, 201);
  await db.query("INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version) VALUES ($1,'spreadsheet','Data room index',now(),'kaz-brownfield','lt-firm','{\"source\":\"upload\"}'::jsonb,$2,1)", [DOC, hashOf(DOC)]);
  const e = run({ project_id: 'egy-onshore', client_id: 'frontera', legal_tag: 'lt-frontera-nda-2026', status: 'final', title: 'Gas hub screen', outputs: { npv10: { value: 58.3, unit: 'USD MM' } } });
  assert.equal((await partner.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) })).status, 201);
});
after(async () => { await db.close(); });

test('AC16: without a provider the brief answers 501 with the same wording as the assistant', async () => {
  configureBrief({ provider: null });
  const r = await post(partner, '/api/countries/KZ/brief');
  assert.equal(r.status, 501);
  assert.match(r.body.error.message, /no LLM provider configured/);
});

test('AC16: a bad code is 400; a country with nothing in scope is 404', async () => {
  configureBrief({ provider });
  assert.equal((await post(partner, '/api/countries/kz/brief')).status, 400);
  assert.equal((await post(partner, '/api/countries/XX/brief')).status, 400);
  const r = await post(partner, '/api/countries/BR/brief');
  assert.equal(r.status, 404);
  assert.match(r.body.error.message, /no projects in Brazil/);
});

test('AC16: the brief cites only records in scope, turns uncited figures into questions, and is cached until a source changes', async () => {
  configureBrief({ provider });
  calls = 0;
  const r = await post(partner, '/api/countries/KZ/brief');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.country, 'KZ');
  assert.deepEqual(b.name, { en: 'Kazakhstan', es: 'Kazajistán' });
  assert.equal(b.cached, false);
  assert.equal(b.model, 'fake-1');
  assert.equal(b.paragraphs.length, 4);
  assert.match(b.paragraphs[1], /12,400 bopd of technical potential \[run:/);
  assert.match(b.paragraphs[2], /^\[QUESTION FOR YOU:/);
  assert.ok(!b.paragraphs[3].includes('[doc:00000000-0000-4000-8000-000000009999]'), 'the foreign citation is stripped');
  assert.equal(b.citations.length, 2);
  assert.ok(b.citations.some((c: string) => c.startsWith('run:')) && b.citations.some((c: string) => c === `doc:${DOC}`));
  assert.ok(b.sources.some((s: any) => s.ref === `doc:${DOC}` && s.title === 'Data room index'));
  assert.ok(b.sources.some((s: any) => s.ref.startsWith('run:') && s.project_id === 'kaz-brownfield'));
  assert.ok(b.warnings.some((w: string) => /outside scope/.test(w)));
  assert.equal(b.questions.length, 1);
  assert.deepEqual(b.projects.map((p: any) => p.id), ['kaz-brownfield']);
  assert.match(b.generated_at, /^\d{4}-/);
  assert.equal(calls, 1);
  const audit = (await db.query<any>("SELECT scope, detail FROM audit_events WHERE action = 'country.brief' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audit.scope, 'firm');
  assert.equal(audit.detail.country, 'KZ');
  assert.equal(audit.detail.cached, false);
  const spend = (await db.query<any>("SELECT tokens_in, detail FROM audit_events WHERE action = 'llm.brief' ORDER BY id DESC LIMIT 1")).rows[0];   // token spend, like llm.draft
  assert.ok(spend.tokens_in > 0);
  assert.equal(spend.detail.country, 'KZ');

  // Same sources: served from the cache, the provider is not asked again.
  const again = await post(partner, '/api/countries/KZ/brief');
  assert.equal(again.status, 200);
  assert.equal(again.body.cached, true);
  assert.equal(again.body.paragraphs[1], b.paragraphs[1]);
  assert.equal(calls, 1);

  // A new run in the country changes the source set: regenerated.
  const r2 = run({ project_id: 'kaz-brownfield', client_id: null, legal_tag: 'lt-firm', status: 'reviewed', title: 'Sensitivity', outputs: { npv10: { value: 40, unit: 'USD MM' } } });
  assert.equal((await partner.request('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r2) })).status, 201);
  const fresh = await post(partner, '/api/countries/KZ/brief');
  assert.equal(fresh.body.cached, false);
  assert.equal(calls, 2);
  // Spanish is a separate brief.
  const es = await post(partner, '/api/countries/KZ/brief', { language: 'es' });
  assert.equal(es.body.cached, false);
  assert.equal(calls, 3);
});

test('AC16: a cached brief is served only to a caller whose scope covers every tag it was built from', async () => {
  configureBrief({ provider });
  calls = 0;
  const r = await post(partner, '/api/countries/EG/brief');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(calls, 1);
  const row = (await db.query<any>("SELECT tags FROM country_briefs WHERE country = 'EG' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.ok(row.tags.includes('lt-frontera-nda-2026'));
  // Ben sees no project in Egypt: nothing is served, cached or not.
  const b = await post(ben, '/api/countries/EG/brief');
  assert.equal(b.status, 404);
  assert.equal(calls, 1);
  // Nothing was written to items: a brief never widens a scope.
  const notes = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE origin->>'source' = 'assistant'")).rows[0].n;
  assert.equal(notes, 0);
});
