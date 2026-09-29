import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { FakeProvider, type LlmRequest } from '../src/llm/provider.ts';
import { claimSimilarity, parseDreamJson, runDream, toCandidate } from '../src/jobs/dream.ts';
import { setFirmDir } from '../src/jobs/lessons-index.ts';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-09-29T12:00:00Z');
const WEEK = '2026-09-26T09:00:00Z', OLD = '2026-03-01T09:00:00Z';
const RUN = U(201), OLD_RUN = U(202), DELTA = U(203), MAIL = U(204), DRAFT = U(205), TRANSCRIPT = U(206), P3_RUN = U(207), P1_RUN = U(208), P2_RUN = U(209);
const dir = mkdtempSync(path.join(tmpdir(), 'dream-'));
setFirmDir(dir);
const CLAIM = 'Extra-heavy screening must use measured viscosity at reservoir temperature because analogue values understate it.';
const CLAIM_NEAR = 'Extra-heavy screening must use measured viscosity at reservoir temperature because analogue values understate it badly.';

async function setup(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'orinoco-partnership'");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('p1','Project one','lt-firm'),('p2','Project two','lt-firm'),('p3','Project three','lt-firm')");
  const run = (id: string, project: string, tag: string, n: number, at: string) => db.query(
    "INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,legal_tag,title,record,input_hash,status) VALUES ($1,'opportunity-register','2.1.2','abc1234','chris',$2,$3,$4,$5,$6::jsonb,$7,'final')",
    [id, at, project, tag, `Screening ${n}`, JSON.stringify({ outputs: { potential: { value: 41000, unit: 'bopd' } } }), `sha256:${String(n).repeat(64).slice(0, 64)}`]);
  await run(RUN, 'orinoco-partnership', 'lt-orinoco-nda-2026', 1, WEEK);
  await run(OLD_RUN, 'orinoco-partnership', 'lt-orinoco-nda-2026', 2, OLD);
  await run(P3_RUN, 'p3', 'lt-firm', 3, WEEK);
  await run(P1_RUN, 'p1', 'lt-firm', 4, OLD);
  await run(P2_RUN, 'p2', 'lt-firm', 5, OLD);
  const item = (id: string, type: string, title: string, extracted: unknown, n: number, at = WEEK, project = 'orinoco-partnership', tag = 'lt-orinoco-nda-2026') => db.query(
    "INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version,extracted) VALUES ($1,$2,$3,$4,$5,$6,'{\"source\":\"upload\"}'::jsonb,$7,1,$8::jsonb)",
    [id, type, title, at, project, tag, `sha256:${String(n).repeat(64).slice(0, 64)}`, JSON.stringify(extracted)]);
  await item(DELTA, 'note', 'Re-run delta: screening 2.1.1 to 2.1.2', { kind: 'rerun-delta', of: OLD_RUN, rerun: RUN, summary: 'Viscosity input changed from 3 cP to 6 cP; potential fell 18%.', causes: ['tool 2.1.1 to 2.1.2'] }, 6);
  await item(MAIL, 'email', 'Re: viscosity data from the operator', { summary: 'Operator confirms measured viscosity of 6 cP at reservoir temperature.' }, 7);
  await item(DRAFT, 'note', 'Draft letter to operator', { kind: 'draft', brief: 'Follow up on viscosity', draft: 'We propose measured viscosity for the evaluation.' }, 8);
  await item(TRANSCRIPT, 'transcript', 'Claude Code session: screening review', { text: 'Assistant and Chris agreed the analogue viscosity understated the case.' }, 9);
  await item(U(210), 'email', 'Old mail outside the window', { summary: 'Should not be read.' }, 10, OLD);
  return db;
}

const lessonRow = (db: Db, id: string) => db.query<any>('SELECT * FROM lessons WHERE id = $1', [id]).then(r => r.rows[0]);
function seedLesson(db: Db, id: string, over: Record<string, unknown> = {}, cols: { status?: string; tag?: string } = {}) {
  const rec = { id, claim: CLAIM, scope: 'project', scope_id: 'orinoco-partnership', disciplines: ['reservoir'], evidence: [`run:${OLD_RUN}`], author: 'chris', created_at: OLD, status: cols.status ?? 'confirmed', confidence: 0.7,
    legal_tag: cols.tag ?? 'lt-orinoco-nda-2026', sanitised: false, recurrence: 1, last_confirmed: cols.status === 'proposed' ? null : '2026-09-01T00:00:00Z', valid_to: null, superseded_by: null, ...over };
  return db.query('INSERT INTO lessons (id, record, scope, scope_id, legal_tag, status, created_at, last_confirmed) VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8)',
    [id, JSON.stringify(rec), rec.scope, rec.scope_id, rec.legal_tag, rec.status, rec.created_at, rec.last_confirmed]);
}
const reply = (by: (project: string, req: LlmRequest) => unknown) => new FakeProvider((req) => JSON.stringify(by(/PROJECT: (\S+)/.exec(req.messages[0].content)![1], req)));
const orinoco = (lessons: unknown[]) => (p: string) => ({ lessons: p === 'orinoco-partnership' ? lessons : [] });
const queue = (db: Db, kind = 'lesson') => db.query<any>('SELECT id, kind, payload, status FROM review_queue WHERE kind = $1 ORDER BY created_at, id', [kind]).then(r => r.rows);

test('claim similarity is normalised token Jaccard', () => {
  assert.equal(claimSimilarity('Use measured viscosity.', 'use  MEASURED viscosity'), 1);
  assert.equal(claimSimilarity('a b c d', 'e f g h'), 0);
  assert.ok(claimSimilarity(CLAIM, CLAIM_NEAR) >= 0.8 && claimSimilarity(CLAIM, CLAIM_NEAR) < 1);
  assert.ok(claimSimilarity(CLAIM, 'Check the NDA covers the exchange before sending data.') < 0.3);
});

test('parseDreamJson accepts fenced or padded JSON and rejects anything else', () => {
  assert.equal(parseDreamJson('```json\n{"lessons":[]}\n```').length, 0);
  assert.equal(parseDreamJson('Here you go: {"lessons":[{"claim":"x"}]}').length, 1);
  assert.throws(() => parseDreamJson('no json here'));
  assert.throws(() => parseDreamJson('{"lessons":"nope"}'));
});

test('toCandidate drops refs that are not in the input, clamps confidence and rejects malformed lessons', () => {
  const inp = { project_id: 'p3', client_id: null, allowed: new Set([`run:${RUN}`]) };
  const ok = toCandidate({ claim: 'c', scope: 'project', evidence: [`run:${RUN}`, `run:${U(9)}`], confidence: 7 }, inp, new Set(['p3']), new Set());
  assert.deepEqual(ok.cand?.evidence, [`run:${RUN}`]); assert.equal(ok.fabricated, 1); assert.equal(ok.cand?.confidence, 1); assert.equal(ok.cand?.scope_id, 'p3');
  assert.equal(toCandidate({ claim: 'c', scope: 'project', evidence: [`run:${U(9)}`], confidence: 0.5 }, inp, new Set(['p3']), new Set()).drop, 'no_evidence');
  assert.equal(toCandidate({ claim: '', scope: 'project', evidence: [`run:${RUN}`], confidence: 0.5 }, inp, new Set(['p3']), new Set()).drop, 'invalid');
  assert.equal(toCandidate({ claim: 'c', scope: 'project', evidence: [`run:${RUN}`] }, inp, new Set(['p3']), new Set()).drop, 'invalid');
  assert.equal(toCandidate({ claim: 'c', scope: 'project', scope_id: 'zzz', evidence: [`run:${RUN}`], confidence: 0.5 }, inp, new Set(['p3']), new Set()).drop, 'scope');
  assert.equal(toCandidate({ claim: 'c', scope: 'galaxy', evidence: [`run:${RUN}`], confidence: 0.5 }, inp, new Set(['p3']), new Set()).drop, 'invalid');
});

test('AC1: on a seeded week the dream proposes a lesson with evidence, reading runs, deltas, correspondence, drafts and transcripts', async () => {
  const db = await setup();
  await seedLesson(db, U(300), { claim: 'Unrelated: confirm the NDA covers the exchange.', scope: 'firm', scope_id: null, evidence: [`run:${P1_RUN}`] }, { tag: 'lt-firm' });
  const seen: LlmRequest[] = [];
  const provider = reply((p, req) => {
    seen.push(req);
    return orinoco([
      { claim: CLAIM, detail: 'Intended: screen with analogues. Happened: 3 cP used. Why: no measured data. Next: ask the operator first.', scope: 'project', scope_id: 'orinoco-partnership', disciplines: ['Reservoir'], evidence: [`run:${RUN}`, `doc:${DELTA}`, `transcript:${TRANSCRIPT}`, `run:${U(999)}`], confidence: 0.82 },
      { claim: 'A lesson that cites only a fabricated record.', scope: 'project', evidence: [`doc:${U(998)}`], confidence: 0.9 },
    ])(p);
  });
  const s = await runDream(db, provider, { now: NOW, firmDir: dir });
  assert.equal(s.status, 'ok', s.error ?? ''); assert.equal(s.calls, 2, 'one call per project with activity: orinoco-partnership and p3');
  assert.deepEqual(s.input, { runs: 2, deltas: 1, correspondence: 1, drafts: 1, transcripts: 1 });
  assert.equal(s.proposed, 1); assert.equal(s.fabricated_refs, 2); assert.equal(s.dropped.no_evidence, 1);

  const rows = (await db.query<any>("SELECT * FROM lessons WHERE status = 'proposed'")).rows;
  assert.equal(rows.length, 1);
  const l = rows[0].record;
  assert.match(l.author, /^dream:\d+$/); assert.equal(l.author, `dream:${s.job_id}`);
  assert.deepEqual(l.evidence, [`run:${RUN}`, `doc:${DELTA}`, `transcript:${TRANSCRIPT}`], 'the fabricated ref was dropped');
  assert.equal(l.legal_tag, 'lt-orinoco-nda-2026', 'tag = union of the evidence tags');
  assert.deepEqual(l.disciplines, ['reservoir']); assert.equal(l.status, 'proposed'); assert.equal(l.recurrence, 1); assert.equal(l.confidence, 0.82);
  const q = await queue(db);
  assert.equal(q.length, 1); assert.equal(q[0].payload.type, 'new'); assert.equal(q[0].payload.lesson_id, l.id); assert.equal(q[0].payload.claim, undefined, 'an NDA lesson text is not copied into the unscoped queue');

  // The prompt carried everything from the week, the existing lessons in scope, and nothing from outside the window.
  const user = seen[0].messages[0].content;
  for (const needle of [`[run:${RUN}]`, `[doc:${DELTA}]`, 'Viscosity input changed', `[doc:${MAIL}]`, 'Operator confirms measured viscosity', `[doc:${DRAFT}]`, 'Follow up on viscosity', `[doc:${TRANSCRIPT}]`, 'analogue viscosity understated', `[lesson:${U(300)}]`, 'PROJECT: orinoco-partnership']) assert.ok(user.includes(needle), needle);
  assert.ok(!user.includes('Should not be read') && !user.includes(OLD_RUN.slice(-4) + ']'));
  assert.match(seen[0].system, /STRICT JSON/); assert.match(seen[0].system, /"lessons"/);

  const job = (await db.query<any>("SELECT status, summary FROM jobs WHERE name = 'weekly-dream'")).rows[0];
  assert.equal(job.status, 'ok'); assert.equal(job.summary.proposed, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'llm.dream'")).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'lesson.dream'")).rows[0].n, 1);
  assert.ok(readFileSync(path.join(dir, 'LESSONS.md'), 'utf8').includes('Unrelated: confirm the NDA'), 'the job refreshes the core index');

  // Running the same week again proposes nothing new.
  const again = await runDream(db, provider, { now: NOW, firmDir: dir });
  assert.equal(again.proposed, 0); assert.equal(again.updates, 0); assert.equal(again.duplicates_skipped, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 2);
  await db.close();
});

test('AC1: a duplicate of a confirmed lesson is merged as a proposed update, not duplicated; the confirmed lesson is untouched until a partner confirms', async () => {
  const db = await setup();
  await seedLesson(db, U(301));
  const before = await lessonRow(db, U(301));
  const provider = reply(orinoco([{ claim: CLAIM_NEAR, scope: 'project', scope_id: 'orinoco-partnership', disciplines: ['reservoir'], evidence: [`run:${RUN}`], confidence: 0.9 }]) as any);
  const s = await runDream(db, provider, { now: NOW, firmDir: dir });
  assert.equal(s.status, 'ok', s.error ?? ''); assert.equal(s.updates, 1); assert.equal(s.proposed, 0);
  assert.deepEqual(await lessonRow(db, U(301)), before, 'a confirmed lesson is never modified by the job');
  const all = (await db.query<any>('SELECT id, status, record FROM lessons ORDER BY created_at, id')).rows;
  assert.equal(all.length, 2); assert.equal(all.filter(r => r.status === 'proposed').length, 1);
  const upd = all.find(r => r.status === 'proposed');
  assert.equal(upd.record.claim, CLAIM_NEAR);
  assert.deepEqual(upd.record.evidence, [`run:${OLD_RUN}`, `run:${RUN}`], 'evidence is merged, old first');
  assert.equal(upd.record.confidence, 0.9);
  const q = await queue(db);
  assert.equal(q.length, 1); assert.equal(q[0].payload.type, 'update'); assert.equal(q[0].payload.supersedes, U(301)); assert.equal(q[0].payload.lesson_id, upd.id);
  assert.ok(q[0].payload.similarity >= 0.8);

  // Idempotent, and the same words with no new evidence add nothing.
  assert.equal((await runDream(db, provider, { now: NOW, firmDir: dir })).updates, 0);
  const same = reply(orinoco([{ claim: CLAIM, scope: 'project', scope_id: 'orinoco-partnership', evidence: [`run:${RUN}`], confidence: 0.5 }]) as any);
  assert.equal((await runDream(db, same, { now: NOW, firmDir: dir })).duplicates_skipped, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 2);

  // A partner's confirmation of the update retires the old lesson (superseded_by), never deleting it.
  const app = await createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' }, version: 'test' });
  const r = await app.request(`/api/lessons/${upd.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200, await r.clone().text());
  const old = await lessonRow(db, U(301));
  assert.equal(old.status, 'invalidated'); assert.equal(old.superseded_by, upd.id); assert.ok(old.valid_to);
  assert.equal((await queue(db))[0].status, 'accepted');
  await db.close();
});

test('a lesson the model says contradicts an existing one is flagged with both ids; unknown ids are ignored', async () => {
  const db = await setup();
  await seedLesson(db, U(302), { claim: 'Analogue viscosity is adequate for first-pass screening of extra-heavy plays.' });
  const provider = reply(orinoco([{ claim: 'Never rely on analogue viscosity for extra-heavy screening; measure it.', scope: 'project', scope_id: 'orinoco-partnership', evidence: [`run:${RUN}`], confidence: 0.7, contradicts: [`lesson:${U(302)}`, U(777)] }]) as any);
  const before = await lessonRow(db, U(302));
  const s = await runDream(db, provider, { now: NOW, firmDir: dir });
  assert.equal(s.proposed, 1); assert.equal(s.contradictions, 1);
  const q = await queue(db);
  const c = q.find(x => x.payload.type === 'contradiction');
  assert.ok(c);
  const mine = (await db.query<any>("SELECT id FROM lessons WHERE status = 'proposed'")).rows[0].id;
  assert.deepEqual(c.payload.lesson_ids, [mine, U(302)]); assert.equal(c.payload.contradicts, U(302));
  assert.deepEqual(await lessonRow(db, U(302)), before);
  // Rejecting the new proposal settles its queue rows, including the contradiction.
  const app = await createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' }, version: 'test' });
  assert.equal((await app.request(`/api/lessons/${mine}/reject`, { method: 'POST' })).status, 200);
  assert.ok((await queue(db)).every(x => x.status === 'rejected'));
  await db.close();
});

test('recurrence: a project-scope lesson seen on a third distinct project is proposed for firm scope, unsanitised', async () => {
  const db = await setup();
  const at = (id: number, project: string, evidence: string, over: Record<string, unknown> = {}) => seedLesson(db, U(id), { scope_id: project, evidence: [evidence], ...over }, { tag: 'lt-firm' });
  await at(310, 'p1', `run:${P1_RUN}`); await at(311, 'p2', `run:${P2_RUN}`);
  const p3 = reply((p) => ({ lessons: p === 'p3' ? [{ claim: CLAIM, detail: 'Seen again.', scope: 'project', scope_id: 'p3', disciplines: ['reservoir'], evidence: [`run:${P3_RUN}`], confidence: 0.75 }] : [] }));
  const s = await runDream(db, p3, { now: NOW, firmDir: dir });
  assert.equal(s.status, 'ok', s.error ?? ''); assert.equal(s.proposed, 1); assert.equal(s.promotions, 1);
  const proposed = (await db.query<any>("SELECT record FROM lessons WHERE status = 'proposed' ORDER BY (record->>'scope')")).rows.map(r => r.record);
  assert.deepEqual(proposed.map(l => l.scope), ['firm', 'project']);
  const firm = proposed[0];
  assert.equal(firm.scope_id, null); assert.equal(firm.sanitised, false); assert.equal(firm.recurrence, 3); assert.deepEqual(firm.evidence, [`run:${P3_RUN}`]);
  assert.equal(firm.claim, CLAIM);
  const rq = (await queue(db)).find(x => x.payload.type === 'recurrence');
  assert.ok(rq); assert.equal(rq.payload.lesson_id, firm.id); assert.deepEqual(rq.payload.projects, ['p1', 'p2', 'p3']); assert.equal(rq.payload.sanitised, false); assert.equal(rq.payload.recurrence, 3);
  assert.equal((await runDream(db, p3, { now: NOW, firmDir: dir })).promotions, 0, 'not promoted twice');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM lessons WHERE scope = 'firm' AND status = 'proposed'")).rows[0].n, 1);
  await db.close();

  // Two projects are not enough.
  const db2 = await setup();
  await seedLesson(db2, U(312), { scope_id: 'p1', evidence: [`run:${P1_RUN}`] }, { tag: 'lt-firm' });
  const s2 = await runDream(db2, p3, { now: NOW, firmDir: dir });
  assert.equal(s2.proposed, 1); assert.equal(s2.promotions, 0);
  assert.equal((await db2.query("SELECT count(*)::int AS n FROM lessons WHERE scope = 'firm'")).rows[0].n, 0);
  await db2.close();
});

test('an NDA lesson of another client never reaches a project prompt', async () => {
  const db = await setup();
  await seedLesson(db, U(320), { claim: 'Secret client insight about the Faja.', scope: 'firm', scope_id: null }, { tag: 'lt-orinoco-nda-2026' });
  const seen: string[] = [];
  const provider = reply((p, req) => { seen.push(req.messages[0].content); return { lessons: [] }; });
  await db.query("UPDATE runs SET created_at = $1 WHERE id = $2", [WEEK, P3_RUN]);
  await runDream(db, provider, { now: NOW, firmDir: dir });
  const p3prompt = seen.find(s => s.includes('PROJECT: p3'))!;
  assert.ok(p3prompt && !p3prompt.includes('Secret client insight'));
  assert.ok(seen.find(s => s.includes('PROJECT: orinoco-partnership'))!.includes('Secret client insight'), 'the owning client sees it');
  await db.close();
});

test('no provider, or a broken model reply: the job still queues re-confirmations and refreshes the index, and reports the failure', async () => {
  const db = await setup();
  await seedLesson(db, U(330), { claim: 'Old confirmed lesson.', last_confirmed: '2025-06-01T00:00:00Z', scope: 'firm', scope_id: null }, { tag: 'lt-firm' });
  const none = await runDream(db, null, { now: NOW, firmDir: dir });
  assert.equal(none.status, 'ok'); assert.equal(none.llm, false); assert.equal(none.calls, 0); assert.equal(none.reconfirm_queued, 1);
  await db.query("UPDATE review_queue SET status = 'accepted'");
  const broken = await runDream(db, new FakeProvider(() => 'sorry, I cannot do that'), { now: NOW, firmDir: dir });
  assert.equal(broken.status, 'failed'); assert.match(broken.error!, /orinoco-partnership: the model did not return a JSON object/);
  assert.equal(broken.reconfirm_queued, 1, 'still ran after the failure');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM jobs WHERE name = 'weekly-dream' AND status = 'failed'")).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 1);
  await db.close();
});
