import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { FakeProvider } from '../src/llm/provider.ts';
import { draft, decompose, checkCitations, assembleContext } from '../src/llm/draft.ts';
import { runInputHash } from '../src/hash.ts';
import type { Person } from '../src/auth.ts';

const PARTNER: Person = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris', role: 'partner' };
const SEED_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const SEED = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
const RUN_ID = '00000000-0000-4000-8000-0000000000c1';

async function seed(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED_PATH);
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'orinoco-partnership'");
  const rec: any = { id: RUN_ID, job: 'opportunity-register', tool_version: '2.1.2', tool_commit: 'd8a4835', author: 'chris', created_at: '2026-09-24T10:00:00Z', project_id: 'orinoco-partnership', client_id: 'petrolera-del-orinoco', legal_tag: 'lt-orinoco-nda-2026', title: 'Extra-heavy screening, 8 analogues', inputs: [{ ref: 'tool:opportunity-register', kind: 'manual' }], params: { play: 'faja' }, outputs: { technical_potential_bopd: { value: 41000, unit: 'bopd' } }, status: 'final' };
  rec.input_hash = runInputHash(rec);
  await db.query('INSERT INTO runs (id, job, tool_version, tool_commit, author, created_at, client_id, project_id, legal_tag, title, record, input_hash, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)', [rec.id, rec.job, rec.tool_version, rec.tool_commit, rec.author, rec.created_at, rec.client_id, rec.project_id, rec.legal_tag, rec.title, JSON.stringify(rec), rec.input_hash, rec.status]);
  await db.query("INSERT INTO lessons (id, record, scope, scope_id, legal_tag, status, created_at, last_confirmed) VALUES ('00000000-0000-4000-8000-0000000000d1', '{\"claim\":\"Venezuelan counterparties: state that activity is subject to sanctions authorisations.\"}'::jsonb, 'firm', NULL, 'lt-firm', 'confirmed', now(), now())");
  return db;
}

test('decompose yields at most six distinct sub-queries', () => {
  const q = decompose('Follow up our capabilities statement. Propose the scope of a joint evaluation; confirm the NDA covers the exchange and mention sanctions authorisations. Ask for a call in October.', ['Petrolera del Orinoco S.A.']);
  assert.ok(q.length >= 3 && q.length <= 6);
  assert.equal(q[0], 'Petrolera del Orinoco S.A.');
});

test('checkCitations: uncited figures become questions, foreign citations are removed', () => {
  const allowed = new Set(['run:a', 'doc:b']);
  const r = checkCitations(['Recovery was 12% [run:a]. NPV10 fell 8% last year. We met on 4 May [doc:zz].', 'Thank you for your letter.'], allowed);
  assert.deepEqual(r.citations, ['run:a']);
  assert.equal(r.questions.length, 2);
  assert.match(r.paragraphs[0], /QUESTION FOR YOU/);
  assert.ok(!r.paragraphs[0].includes('[doc:zz]'));
  assert.equal(r.paragraphs[1], 'Thank you for your letter.');
  assert.ok(r.warnings.some(w => /outside scope/.test(w)));
});

test('AC15 context: a letter to the prospective partner assembles all six dispatches, the NDA, the run and the lesson from the Vault alone', async () => {
  const db = await seed();
  const ctx = await assembleContext(db, PARTNER, { kind: 'letter', project_id: 'orinoco-partnership', brief: 'Propose the scope of a joint technical evaluation of extra-heavy oil options.', organisation_id: 'petrolera-del-orinoco' }, {});
  assert.equal(ctx.dispatches!.length, 6);
  assert.deepEqual(ctx.dispatches!.map(d => d.reference_no ?? d.their_reference), ['ATC-2026-0098', 'PDO-GC-2026-014', 'ATC-2026-0103', 'ATC-2026-0117', 'PDO-PR-2026-088', 'ATC-2026-0131']);
  assert.equal(ctx.contracts!.length, 1); assert.equal(ctx.contracts![0].type, 'nda'); assert.equal(ctx.contracts![0].extracted.expiry, '2028-02-13');
  assert.equal(ctx.runs.length, 1); assert.equal(ctx.lessons.length, 1);
  assert.ok(ctx.contacts!.some(c => c.name === 'Ing. María Fernández'));
  assert.ok(ctx.letterhead, 'current letterhead asset resolved');
  await db.close();
});

test('AC9/AC15 draft: every factual sentence cites a record in scope; a fabricated id is removed and the sentence questioned', async () => {
  const db = await seed();
  const provider = new FakeProvider((req) => {
    const user = req.messages[0].content;
    const run = /\[run:([0-9a-f-]{36})\]/.exec(user)![1];
    const nda = /nda "[^"]+" [^\[]*\[doc:([0-9a-f-]{36})\]/.exec(user)![1];
    const lesson = /\[lesson:([0-9a-f-]{36})\]/.exec(user)![1];
    return [
      `Further to our clarification letter of 8 July 2026 (ATC-2026-0131) [doc:00000000-0000-4000-8000-000000000056], we propose the scope of a joint evaluation.`,
      `Our screening of eight analogue fields gives a technical potential of 41,000 bopd [run:${run}], within the NDA in force until 13 February 2028 [doc:${nda}].`,
      `Any activity is subject to sanctions authorisations [lesson:${lesson}]. Comparable projects reached 60,000 bopd in 2019 [run:99999999-9999-4999-8999-999999999999].`,
      `We would welcome a call in the week of 12 October.`,
    ].join('\n\n');
  });
  const r = await draft(db, PARTNER, { kind: 'letter', project_id: 'orinoco-partnership', brief: 'Propose the scope of a joint technical evaluation.', organisation_id: 'petrolera-del-orinoco' }, provider, {});
  assert.ok(r.citations.includes(`run:${RUN_ID}`));
  assert.ok(r.citations.some(c => c.startsWith('doc:')));
  assert.ok(r.citations.some(c => c.startsWith('lesson:')));
  assert.ok(!r.draft.includes('99999999-9999'), 'fabricated citation removed');
  assert.equal(r.questions.length, 2, 'the fabricated-id sentence and the uncited date sentence are questioned');
  assert.ok(r.warnings.some(w => /outside scope/.test(w)));
  assert.ok(r.usage && r.usage.output > 0);
  // Every remaining sentence with a digit carries an allowed citation or is a question.
  for (const p of r.paragraphs) for (const s of p.split(/(?<=[.!?])\s+/)) if (/\d/.test(s)) assert.ok(/\[(run|doc|lesson):/.test(s) || /QUESTION FOR YOU/.test(s), s);
  await db.close();
});

test('wave 7 (S19): without a provider the drafter refuses with 503 instead of a silent template', async () => {
  const db = await seed();
  await assert.rejects(draft(db, PARTNER, { kind: 'email', project_id: 'orinoco-partnership', brief: 'Chase the data room index.', organisation_id: 'petrolera-del-orinoco', language: 'es' }, null, {}), (e: any) => e.status === 503 && e.code === 'not_configured');
  await db.close();
});

test('an associate outside the project cannot draft for it', async () => {
  const db = await seed();
  await assert.rejects(draft(db, { id: 'ana', email: 'ana@alpha-technical-centre.com', name: 'Ana', role: 'associate' }, { kind: 'email', project_id: 'orinoco-partnership', brief: 'x' }, null, {}), (e: any) => e.status === 403);
  await db.close();
});

test('W5-AC6: the drafter reads the register counterparties, falls back to the holder as the organisation, and offers research findings as sources', async () => {
  const db = await seed();
  await db.query(`UPDATE projects SET register = '{"holder":"Petrolera del Orinoco","government":"MinPetróleo / PDVSA","licence_type":"jv","partners":["Chevron Venezuela"]}'::jsonb WHERE id = 'orinoco-partnership'`);
  const fid = '00000000-0000-4000-8000-0000000000f1';
  await db.query(`INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, external_id, content_hash, version, extracted, tags)
                  VALUES ($1,'note','PDVSA restarts Apure production after pipeline repair','2026-10-01T10:00:00Z','2026-09-30T00:00:00Z','{research}','orinoco-partnership','lt-public',
                          '{"source":"research","external_id":"gdelt:1","url":"https://reuters.example/apure"}'::jsonb,'gdelt:1','sha256:f1',1,
                          '{"kind":"research","source":"gdelt","query":"\\"Guafita\\" Venezuela","quote":"PDVSA restarted Apure production this week after a pipeline repair.","url":"https://reuters.example/apure"}'::jsonb,'{research,gdelt}')`, [fid]);
  const { assembleContext: build, userPrompt } = await import('../src/llm/draft.ts');
  // No organisation named: the register holder is matched to the organisation by name.
  const req = { kind: 'email' as const, project_id: 'orinoco-partnership', brief: 'Tell them Apure production restarted and ask for the pipeline repair report.' };
  const ctx = await build(db, PARTNER, req, {});
  assert.equal(ctx.organisation?.id, 'petrolera-del-orinoco', 'the holder "Petrolera del Orinoco" is the organisation');
  assert.ok(ctx.sources.some(s => s.ref === `doc:${fid}` && /pipeline repair/.test(s.snippet ?? '')), 'the finding that matches the brief is a source: ' + JSON.stringify(ctx.sources.map(s => s.ref)));
  const prompt = userPrompt(req, ctx);
  assert.match(prompt, /COUNTERPARTIES: current owner Petrolera del Orinoco; government MinPetróleo \/ PDVSA; licence joint venture; partners Chevron Venezuela/);
  assert.ok(!/call the ministry|ZEBRAWORD/.test(prompt));
  // Tone and a previous draft travel into the prompt so a re-draft keeps the content.
  const p2 = userPrompt({ ...req, tone: 'shorter', previous: 'Dear María, production restarted [doc:x].' }, ctx);
  assert.match(p2, /REWRITE THE PREVIOUS DRAFT: shorter/); assert.match(p2, /PREVIOUS DRAFT:\nDear María/);
  await db.close();
});
