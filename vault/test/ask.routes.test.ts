// Wave 8 PR 4 (docs/vault-hub/wave8/03-indexing-and-ask.md, W8-AC17): POST /api/projects/:id/ask answers from the
// project's indexed passages in the caller's scope, through the citation checker, with the sources it drew on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-ask-'));

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureAsk } = await import('../src/api/ask.routes.ts');
const { FakeProvider } = await import('../src/llm/provider.ts');
const { keywords } = await import('../src/llm/ask.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (rel: string) => JSON.parse(readFileSync(path.join(FIX, rel), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const PID = 'ask-demo';
const json = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let member: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email }, version: 'test' });
let A = '', B = '', C = '';
const prompts: string[] = [];

async function item(title: string, type: string, text: string, partnersOnly = false) {
  const fd = new FormData();
  fd.append('item', JSON.stringify({ project_id: PID, type, title, origin: { source: 'zoho-workdrive', external_id: `wd:${title}` }, extracted: { filename: title }, authored_at: '2019-11-02T00:00:00Z' }));
  fd.append('original', new Blob(['%PDF ' + title], { type: 'application/pdf' }), title);
  const r = await partner.request('/api/items', { method: 'POST', body: fd });
  const t = await r.text(); assert.equal(r.status, 201, t);
  const id = JSON.parse(t).id as string;
  await db.query(`INSERT INTO chunks (item_id, item_version, ordinal, text, legal_tag, project_id, partners_only, current) VALUES ($1, 1, 0, $2, 'lt-firm', $3, $4, true)`, [id, text, PID, partnersOnly]);
  await db.query(`UPDATE items SET extracted = extracted || '{"ingest":{"status":"ok","version":1},"chunks":1}'::jsonb WHERE id = $1`, [id]);
  return id;
}

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, fixture('ac15/seed.json'));
  await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag, members, country) VALUES ($1, NULL, 'Ask demo', 'prospect', 'lt-firm', '{ana.perez}', 'US')`, [PID]);
  partner = await appFor(`chris@${DOMAIN}`);
  member = await appFor(`ana.perez@${DOMAIN}`);
  A = await item('Frost field re-perforation review 2019.pdf', 'report', 'The 2019 re-perforation campaign restored production in 7 of 9 wells, an average of 42 bopd per well.');
  B = await item('Frost 2 cement bond log.pdf', 'report', 'The cement bond log on Frost 2 showed channelling in the lower zone before the re-perforation of that well.');
  C = await item('Campaign invoice.pdf', 'invoice', 'The re-perforation campaign invoice totalled 1.2 MMUSD for the nine wells.', true);
  const provider = new FakeProvider((req) => {
    const content = req.messages[0].content;
    prompts.push(content);
    const ids = [...content.matchAll(/\[doc:([0-9a-f-]{36})\]/g)].map(m => m[1]);
    const a = ids.includes(A) ? A : ids[0];
    return `Re-perforations succeeded in 7 of 9 wells, restoring 42 bopd per well on average [doc:${a}].\n\nThe campaign cost 1.2 MMUSD.\n\nNothing in the passages names the operator of the campaign.`;
  });
  configureAsk({ provider, search: {} });
});
after(async () => { configureAsk({ provider: undefined as any, search: undefined as any }); await db.close(); });

test('keywords: the content words of a question, stop words and short words dropped, in both languages', () => {
  assert.deepEqual(keywords('How successful have re-perforations been historically?'), ['re-perforations']);
  assert.deepEqual(keywords('Which wells were re-perforated in the 2019 campaign and what did it cost?'), ['wells', 're-perforated', '2019', 'campaign', 'cost']);
  assert.deepEqual(keywords('¿Qué éxito han tenido las reperforaciones en los pozos?'), ['éxito', 'tenido', 'reperforaciones', 'pozos']);
});

test('W8-AC17: the answer cites passages in scope, an uncited figure becomes a question, the sources are listed with their counts, and the audit row carries the refs', async () => {
  const r = await partner.request(`/api/projects/${PID}/ask`, json({ question: 'How successful was the re-perforation campaign?' }));
  const b: any = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b));
  assert.equal(b.project_id, PID); assert.equal(b.language, 'en');
  assert.equal(b.answer.length, 2, JSON.stringify(b.answer));
  assert.match(b.answer[0], /7 of 9 wells.*\[doc:/);
  assert.match(b.answer[1], /^Nothing in the passages/);
  assert.equal(b.questions.length, 1); assert.match(b.questions[0], /1\.2 MMUSD/);
  assert.deepEqual(b.citations, [`doc:${A}`]);
  assert.deepEqual(b.sources.map((s: any) => [s.id, s.name, s.type, s.cited]), [[A, 'Frost field re-perforation review 2019.pdf', 'report', 1]]);
  assert.ok(b.passages >= 2, `passages ${b.passages}`);
  assert.ok(b.warnings.some((w: string) => /turned into questions/.test(w)));
  assert.equal(b.model, 'fake-1');
  assert.ok(prompts.at(-1)!.includes('invoice totalled 1.2 MMUSD'), 'a partner reads the partners-only passage');
  const audit = (await db.query<any>(`SELECT scope, refs, detail FROM audit_events WHERE action = 'project.ask' ORDER BY at DESC LIMIT 1`)).rows[0];
  assert.equal(audit.scope, `project:${PID}`);
  assert.ok(audit.refs.includes(`doc:${A}`) && audit.refs.includes(`project:${PID}`));
  assert.equal(audit.detail.citations, 1); assert.equal(audit.detail.questions, 1); assert.ok(audit.detail.question_hash.startsWith('sha256:'));
  const ledger = (await db.query<any>(`SELECT tokens_in, tokens_out, refs FROM audit_events WHERE action = 'llm.ask' ORDER BY at DESC LIMIT 1`)).rows[0];
  assert.ok(ledger && ledger.tokens_in > 0 && ledger.tokens_out > 0, 'the model call is in the ledger');
});

test('W8-AC17: a member never receives a partners-only passage; Spanish is asked for in Spanish', async () => {
  const r = await member.request(`/api/projects/${PID}/ask`, json({ question: '¿Qué éxito tuvo la campaña de re-perforation?', language: 'es' }));
  const b: any = await r.json();
  assert.equal(r.status, 200, JSON.stringify(b));
  assert.equal(b.language, 'es');
  const prompt = prompts.at(-1)!;
  assert.ok(!prompt.includes('invoice totalled'), 'the partners-only passage is absent for an associate');
  assert.ok(prompt.includes('7 of 9 wells'), 'the firm-wide passage is present');
  assert.ok(!b.sources.some((s: any) => s.id === C));
});

test('W8-AC17: 400 for an empty question, 404 for a project outside scope or unknown, 503 without a provider, and no model call when nothing matches', async () => {
  assert.equal((await partner.request(`/api/projects/${PID}/ask`, json({ question: '   ' }))).status, 400);
  assert.equal((await partner.request(`/api/projects/${PID}/ask`, json({}))).status, 400);
  assert.equal((await member.request('/api/projects/orinoco-partnership/ask', json({ question: 'x' }))).status, 404);
  assert.equal((await partner.request('/api/projects/no-such/ask', json({ question: 'x' }))).status, 404);
  const n = prompts.length;
  const none = await partner.request(`/api/projects/${PID}/ask`, json({ question: 'zzzz qqqq' }));
  const nb: any = await none.json();
  assert.equal(none.status, 200); assert.equal(nb.passages, 0); assert.deepEqual(nb.answer, []); assert.equal(prompts.length, n, 'no model call without passages');
  assert.ok(nb.warnings[0].includes('no indexed passage'));
  configureAsk({ provider: null });
  const off = await partner.request(`/api/projects/${PID}/ask`, json({ question: 'How successful was the re-perforation campaign?' }));
  assert.equal(off.status, 503);
  assert.equal(((await off.json()) as any).error.code, 'not_configured');
});
