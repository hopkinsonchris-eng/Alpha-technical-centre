import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { setFirmDir } from '../src/jobs/lessons-index.ts';
import { runDream } from '../src/jobs/dream.ts';
import { FakeProvider } from '../src/llm/provider.ts';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NDA_RUN = U(101), FIRM_RUN = U(102), OTHER_RUN = U(103), NDA_DOC = U(104), FIRM_DOC = U(105);
const DOMAIN = 'alpha-technical-centre.com';
const dir = mkdtempSync(path.join(tmpdir(), 'lessons-api-'));
setFirmDir(dir);
const index = () => readFileSync(path.join(dir, 'LESSONS.md'), 'utf8');

async function setup() {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  // chris (partner) and ana (associate) are on the Orinoco project; ben (associate) is not.
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'),('ben','ben@alpha-technical-centre.com','Ben','associate') ON CONFLICT DO NOTHING");
  await db.query("UPDATE projects SET members = '{chris,ana}' WHERE id = 'orinoco-partnership'");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda','client-nda','second-party','frontera','Frontera')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('llanos','frontera','Llanos','lt-frontera-nda','{chris}')");
  const run = (id: string, project: string, tag: string, n: number) => db.query(
    "INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,project_id,legal_tag,title,record,input_hash,status) VALUES ($1,'opportunity-register','2.1.2','abc1234','chris',now(),$2,$3,$4,'{}'::jsonb,$5,'final')", [id, project, tag, `run ${n}`, `sha256:${String(n).repeat(64).slice(0, 64)}`]);
  await run(NDA_RUN, 'orinoco-partnership', 'lt-orinoco-nda-2026', 1);
  await run(FIRM_RUN, 'firm', 'lt-firm', 2);
  await run(OTHER_RUN, 'llanos', 'lt-frontera-nda', 3);
  const doc = (id: string, project: string, tag: string, n: number) => db.query(
    "INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version) VALUES ($1,'note',$2,now(),$3,$4,'{\"source\":\"upload\"}'::jsonb,$5,1)", [id, `note ${n}`, project, tag, `sha256:${String(n).repeat(64).slice(0, 64)}`]);
  await doc(NDA_DOC, 'orinoco-partnership', 'lt-orinoco-nda-2026', 4);
  await doc(FIRM_DOC, 'firm', 'lt-firm', 5);
  const as = async (who: string) => { const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `${who}@${DOMAIN}` }, version: 'test' }); return (p: string, body?: unknown) => app.request(p, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); };
  return { db, chris: await as('chris'), ana: await as('ana'), ben: await as('ben') };
}
const lesson = (over: Record<string, unknown> = {}) => ({ claim: 'Screen extra-heavy plays with measured viscosity, not analogue values.', scope: 'discipline', scope_id: 'reservoir', disciplines: ['reservoir'], evidence: [`run:${FIRM_RUN}`], confidence: 0.8, ...over });
const j = async (r: Response) => (await r.json()) as any;

test('POST /api/lessons validates against the lesson schema and the evidence', async () => {
  const { db, ana } = await setup();
  const bad = async (body: unknown, status: number, path?: string) => { const r = await ana('/api/lessons', body); assert.equal(r.status, status, JSON.stringify(await r.clone().json())); if (path) assert.equal((await j(r)).error.path, path); };
  await bad({ ...lesson(), claim: undefined }, 400, '/claim');
  await bad(lesson({ claim: 'x'.repeat(401) }), 400, '/claim');
  await bad(lesson({ evidence: [] }), 400, '/evidence');
  await bad(lesson({ scope: 'galaxy' }), 400, '/scope');
  await bad(lesson({ confidence: 1.5 }), 400, '/confidence');
  await bad(lesson({ colour: 'red' }), 400, '/colour');
  await bad(lesson({ status: 'invalidated' }), 400, '/status');
  await bad(lesson({ evidence: ['file:abc'] }), 400, '/evidence/0');
  await bad(lesson({ evidence: [`run:${U(999)}`] }), 400, '/evidence/0');
  await bad(lesson({ scope: 'firm', scope_id: 'x' }), 400, '/scope_id');
  await bad(lesson({ scope: 'project', scope_id: undefined }), 400, '/scope_id');
  await bad(lesson({ scope: 'project', scope_id: 'nope' }), 400, '/scope_id');
  await bad(lesson({ scope: 'client', scope_id: 'nope' }), 400, '/scope_id');
  const ok = await ana('/api/lessons', lesson());
  assert.equal(ok.status, 201);
  const b = await j(ok);
  assert.equal(b.status, 'proposed'); assert.equal(b.author, 'ana'); assert.equal(b.legal_tag, 'lt-firm'); assert.equal(b.recurrence, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 1);
  // Client-supplied server fields are ignored: cannot post a confirmed lesson, choose the author or lower the tag.
  const sneaky = await j(await ana('/api/lessons', lesson({ status: 'confirmed', author: 'chris', legal_tag: 'lt-public', id: U(7), confirmed_by: 'chris' })));
  assert.equal(sneaky.status, 'proposed'); assert.equal(sneaky.author, 'ana'); assert.equal(sneaky.legal_tag, 'lt-firm'); assert.notEqual(sneaky.id, U(7)); assert.equal(sneaky.confirmed_by, null);
  await db.close();
});

test('the legal tag is the union of the evidence records tags and never lower', async () => {
  const { db, chris } = await setup();
  const tag = async (evidence: string[], over: Record<string, unknown> = {}) => { const r = await chris('/api/lessons', lesson({ scope: 'project', scope_id: 'orinoco-partnership', ...over, evidence })); assert.equal(r.status, 201, JSON.stringify(await r.clone().json())); return (await j(r)).legal_tag; };
  assert.equal(await tag([`run:${FIRM_RUN}`]), 'lt-firm');
  assert.equal(await tag([`run:${NDA_RUN}`]), 'lt-orinoco-nda-2026');
  assert.equal(await tag([`run:${FIRM_RUN}`, `doc:${NDA_DOC}`, `doc:${FIRM_DOC}`]), 'lt-orinoco-nda-2026', 'firm + nda evidence is nda');
  // An external assistant-session transcript carries no vault tag: the project default applies.
  assert.equal(await tag(['transcript:session_01abc'], { scope: 'project', scope_id: 'llanos' }), 'lt-frontera-nda');
  // Evidence from two clients cannot carry any single tag.
  const both = await chris('/api/lessons', lesson({ scope: 'project', scope_id: 'orinoco-partnership', evidence: [`run:${NDA_RUN}`, `run:${OTHER_RUN}`] }));
  assert.equal(both.status, 409); assert.equal((await j(both)).error.code, 'legal_tag_conflict');
  await db.close();
});

test('AC3: an NDA-evidenced lesson cannot be firm-wide unless a partner confirms it sanitised (403)', async () => {
  const { db, chris, ana, ben } = await setup();
  const nda = (over: Record<string, unknown> = {}) => lesson({ scope: 'firm', scope_id: null, evidence: [`run:${NDA_RUN}`], ...over });
  for (const [who, body] of [[chris, nda()], [chris, nda({ sanitised: true })], [ana, nda({ sanitised: true, status: 'confirmed' })], [ana, nda()], [chris, nda({ scope: 'discipline', scope_id: 'reservoir' })]] as const) {
    const r = await who('/api/lessons', body);
    assert.equal(r.status, 403, JSON.stringify(await r.clone().json()));
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 0, 'nothing was stored');
  // The same lesson at project scope is fine; it stays under the client's tag and out of the firm index.
  const proj = await j(await chris('/api/lessons', nda({ scope: 'project', scope_id: 'orinoco-partnership', status: 'confirmed' })));
  assert.equal(proj.status, 'confirmed'); assert.equal(proj.legal_tag, 'lt-orinoco-nda-2026');
  assert.ok(!index().includes(proj.id), 'NDA-tagged lessons never enter LESSONS.md');
  assert.equal((await j(await ben('/api/lessons?scope=project:orinoco-partnership'))).count, 0, 'an associate outside the project does not see it');
  assert.equal((await ben(`/api/lessons/${proj.id}`)).status, 403);
  assert.equal((await j(await ana('/api/lessons?scope=project:orinoco-partnership'))).count, 1, 'a project member does');
  // A partner confirming it as sanitised is the one route: the tag drops to lt-firm and it enters the index.
  const ok = await chris('/api/lessons', nda({ sanitised: true, status: 'confirmed', claim: 'Extra-heavy screening: use measured viscosity.' }));
  assert.equal(ok.status, 201); const okb = await j(ok);
  assert.equal(okb.legal_tag, 'lt-firm'); assert.equal(okb.sanitised, true);
  assert.ok(index().includes(`(lesson:${okb.id}, firm)`));
  assert.equal((await ben(`/api/lessons/${okb.id}`)).status, 200);
  // A machine proposal (as the dream writes it) may sit unsanitised at firm scope, but confirming it is refused until a partner sanitises it.
  const id = U(300);
  await db.query(`INSERT INTO lessons (id, record, scope, scope_id, legal_tag, status, created_at) VALUES ($1, $2::jsonb, 'firm', NULL, 'lt-orinoco-nda-2026', 'proposed', now())`,
    [id, JSON.stringify({ id, claim: 'Recurring issue seen on three projects.', scope: 'firm', scope_id: null, evidence: [`run:${NDA_RUN}`], author: 'dream:1', created_at: new Date().toISOString(), status: 'proposed', confidence: 0.6, legal_tag: 'lt-orinoco-nda-2026', sanitised: false, recurrence: 3 })]);
  assert.equal((await chris(`/api/lessons/${id}/confirm`, {})).status, 403);
  assert.equal((await ana(`/api/lessons/${id}/confirm`, {})).status, 403, 'partner-only');
  const done = await chris(`/api/lessons/${id}/confirm`, { sanitised: true, claim: 'A recurring issue: measure viscosity before screening.' });
  assert.equal(done.status, 200); const d = await j(done);
  assert.equal(d.status, 'confirmed'); assert.equal(d.legal_tag, 'lt-firm'); assert.equal(d.confirmed_by, 'chris');
  assert.ok(index().includes('A recurring issue: measure viscosity before screening. (lesson:' + id));
  await db.close();
});

test('AC2: confirming regenerates LESSONS.md within the same request; only a partner may confirm', async () => {
  const { db, chris, ana } = await setup();
  const created = await j(await ana('/api/lessons', lesson({ disciplines: ['reservoir'] })));
  assert.ok(!existsSync(path.join(dir, 'LESSONS.md')) || !index().includes(created.id), 'a proposal is not in the index');
  assert.equal((await ana(`/api/lessons/${created.id}/confirm`, {})).status, 403);
  const r = await chris(`/api/lessons/${created.id}/confirm`, {});
  assert.equal(r.status, 200); const b = await j(r);
  assert.equal(b.status, 'confirmed'); assert.ok(b.last_confirmed); assert.equal(b.index.changed, true);
  const md = index();
  assert.ok(md.includes(`- ${created.claim} (lesson:${created.id}, discipline:reservoir)`), md);
  assert.ok(JSON.parse(readFileSync(path.join(dir, 'lessons.json'), 'utf8')).lessons.some((l: any) => l.id === created.id));
  // A partner's own confirmed post does the same.
  const own = await j(await chris('/api/lessons', lesson({ claim: 'Confirm the datum before comparing well tops.', scope: 'firm', scope_id: null, disciplines: ['geology'], status: 'confirmed' })));
  assert.ok(index().includes(`(lesson:${own.id}, firm)`)); assert.ok(index().includes('## geology'));
  await db.close();
});

test('AC5: invalidate keeps the lesson readable by id, hides it from the list and from the index, and never deletes', async () => {
  const { db, chris, ana } = await setup();
  const a = await j(await chris('/api/lessons', lesson({ status: 'confirmed' })));
  const b = await j(await chris('/api/lessons', lesson({ claim: 'Use measured viscosity when it exists; analogue values understate it.', status: 'confirmed' })));
  assert.equal((await j(await ana('/api/lessons'))).count, 2);
  assert.equal((await ana(`/api/lessons/${a.id}/invalidate`, {})).status, 403);
  assert.equal((await chris(`/api/lessons/${a.id}/invalidate`, { superseded_by: U(999) })).status, 400);
  assert.equal((await chris(`/api/lessons/${a.id}/invalidate`, { superseded_by: a.id })).status, 400);
  const r = await chris(`/api/lessons/${a.id}/invalidate`, { superseded_by: b.id, reason: 'refined' });
  assert.equal(r.status, 200); const inv = await j(r);
  assert.equal(inv.status, 'invalidated'); assert.equal(inv.superseded_by, b.id); assert.ok(inv.valid_to);
  assert.ok(!index().includes(a.id) && index().includes(b.id), 'the index was rewritten in the same request');
  const list = await j(await ana('/api/lessons'));
  assert.deepEqual(list.lessons.map((l: any) => l.id), [b.id]);
  const byId = await ana(`/api/lessons/${a.id}`);
  assert.equal(byId.status, 200); const got = await j(byId);
  assert.equal(got.status, 'invalidated'); assert.equal(got.superseded_by, b.id);
  assert.deepEqual((await j(await ana(`/api/lessons/${b.id}`))).supersedes, [a.id]);
  assert.deepEqual((await j(await chris('/api/lessons?status=invalidated'))).lessons.map((l: any) => l.id), [a.id]);
  assert.equal((await chris(`/api/lessons/${a.id}/invalidate`, {})).status, 409);
  assert.equal((await chris(`/api/lessons/${a.id}/confirm`, {})).status, 409, 'an invalidated lesson cannot be revived');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM lessons')).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'lesson.invalidate'")).rows[0].n, 5, 'every attempt is audited');
  await db.close();
});

test('reject retires a proposal; proposals are visible to partners and their author only', async () => {
  const { db, chris, ana, ben } = await setup();
  const p = await j(await ana('/api/lessons', lesson()));
  assert.equal((await j(await chris('/api/lessons?status=proposed'))).count, 1);
  assert.equal((await j(await ana('/api/lessons?status=proposed'))).count, 1);
  assert.equal((await j(await ben('/api/lessons?status=proposed'))).count, 0);
  assert.equal((await ben(`/api/lessons/${p.id}`)).status, 403);
  assert.equal((await ana(`/api/lessons/${p.id}/reject`, {})).status, 403);
  const r = await chris(`/api/lessons/${p.id}/reject`, { reason: 'too vague' });
  assert.equal(r.status, 200); assert.equal((await j(r)).status, 'invalidated');
  assert.equal((await j(await chris('/api/lessons?status=proposed'))).count, 0);
  assert.equal((await chris(`/api/lessons/${p.id}/reject`, {})).status, 409);
  const c = await j(await chris('/api/lessons', lesson({ status: 'confirmed' })));
  assert.equal((await chris(`/api/lessons/${c.id}/reject`, {})).status, 409, 'a confirmed lesson is invalidated, not rejected');
  assert.equal((await chris('/api/lessons?status=bogus')).status, 400);
  assert.equal((await chris('/api/lessons?scope=galaxy:1')).status, 400);
  assert.equal((await chris('/api/lessons/not-a-uuid')).status, 404);
  assert.equal((await chris(`/api/lessons/${U(998)}`)).status, 404);
  await db.close();
});

test('scope filter: firm | discipline | client | project | tool, with optional cascade', async () => {
  const { db, chris } = await setup();
  const mk = async (over: Record<string, unknown>) => (await j(await chris('/api/lessons', lesson({ status: 'confirmed', ...over, claim: `claim ${JSON.stringify(over)}` })))).id;
  const firm = await mk({ scope: 'firm', scope_id: null });
  const disc = await mk({ scope: 'discipline', scope_id: 'reservoir' });
  const tool = await mk({ scope: 'tool', scope_id: 'opportunity-register' });
  const proj = await mk({ scope: 'project', scope_id: 'orinoco-partnership' });
  const cli = await mk({ scope: 'client', scope_id: 'petrolera-del-orinoco' });
  const ids = async (q: string) => (await j(await chris(`/api/lessons?${q}`))).lessons.map((l: any) => l.id).sort();
  assert.deepEqual(await ids('scope=firm'), [firm]);
  assert.deepEqual(await ids('scope=discipline:reservoir'), [disc]);
  assert.deepEqual(await ids('scope=discipline:geology'), []);
  assert.deepEqual(await ids('scope=tool:opportunity-register'), [tool]);
  assert.deepEqual(await ids('scope=client:petrolera-del-orinoco'), [cli]);
  assert.deepEqual(await ids('scope=project:orinoco-partnership'), [proj]);
  assert.deepEqual(await ids('scope=project:orinoco-partnership&cascade=true'), [firm, cli, proj].sort());
  assert.equal((await ids('')).length, 5);
  await db.close();
});

test('AC4: a lesson unconfirmed for 13 months ranks below an equal one confirmed last week and is queued for re-confirmation by the job', async () => {
  const { db, chris } = await setup();
  const old = await j(await chris('/api/lessons', lesson({ claim: 'Old lesson about viscosity.', status: 'confirmed' })));
  const fresh = await j(await chris('/api/lessons', lesson({ claim: 'Fresh lesson about viscosity.', status: 'confirmed' })));
  const monthsAgo = (m: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString(); };
  const set = async (id: string, when: string) => db.query("UPDATE lessons SET last_confirmed = $2::timestamptz, record = jsonb_set(record, '{last_confirmed}', to_jsonb($3::text)) WHERE id = $1", [id, when, when]);
  await set(old.id, monthsAgo(13));
  await set(fresh.id, new Date(Date.now() - 7 * 86_400_000).toISOString());
  const list = (await j(await chris('/api/lessons'))).lessons;
  assert.deepEqual(list.map((l: any) => l.id), [fresh.id, old.id], 'equal confidence: the decayed lesson ranks below');
  assert.equal(list[0].decay, 1); assert.ok(list[1].decay < 1 && list[1].decay > 0.1); assert.ok(list[1].rank < list[0].rank);
  assert.equal(list[0].confidence, list[1].confidence);
  // A lesson at 11 months has not started to decay.
  await set(old.id, monthsAgo(11));
  assert.equal((await j(await chris(`/api/lessons/${old.id}`))).decay, 1);
  await set(old.id, monthsAgo(13));

  const queue = async () => (await j(await chris('/api/queue/review?kind=reconfirm-lesson'))).items;
  assert.equal((await queue()).length, 0);
  const s = await runDream(db, new FakeProvider(() => '{"lessons":[]}'), { firmDir: dir });
  assert.equal(s.status, 'ok'); assert.equal(s.reconfirm_queued, 1);
  const q = await queue();
  assert.equal(q.length, 1); assert.equal(q[0].payload.lesson_id, old.id); assert.equal(q[0].kind, 'reconfirm-lesson');
  await runDream(db, new FakeProvider(() => '{"lessons":[]}'), { firmDir: dir });
  assert.equal((await queue()).length, 1, 'the job does not queue the same lesson twice');
  // Re-confirming resets the decay and settles the queue row.
  const r = await chris(`/api/lessons/${old.id}/confirm`, {});
  assert.equal(r.status, 200); assert.equal((await j(r)).decay, 1);
  assert.equal((await queue()).length, 0);
  assert.equal((await j(await chris('/api/queue/review?kind=reconfirm-lesson&status=accepted'))).items.length, 1);
  assert.equal((await runDream(db, new FakeProvider(() => '{"lessons":[]}'), { firmDir: dir })).reconfirm_queued, 0);
  await db.close();
});
