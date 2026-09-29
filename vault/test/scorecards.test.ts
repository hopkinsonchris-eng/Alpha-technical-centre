// M17 AC3: the six scorecard rules give the expected pass / fail / not-measurable on a fixture, per person's scope.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { scorecard, scorecards, RULES } from '../src/scorecards.ts';
import type { Person } from '../src/auth.ts';

const DOMAIN = 'alpha-technical-centre.com';
const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const hex = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');
const CHRIS: Person = { id: 'chris', email: `chris@${DOMAIN}`, name: 'Chris', role: 'partner' };
const ANA: Person = { id: 'ana', email: `ana@${DOMAIN}`, name: 'Ana', role: 'associate' };
const BOB: Person = { id: 'bob', email: `bob@${DOMAIN}`, name: 'Bob', role: 'associate' };

let db: Db;
const id = {} as Record<string, string>;
const uid = (k: string) => (id[k] = randomUUID());

async function item(k: string, o: { project: string; type?: string; title?: string; tag?: string; ageDays?: number; stale?: boolean; extracted?: object; cites?: string[]; tags?: string[]; dispatch?: 'in' | 'out' }) {
  const i = uid(k);
  await db.query(`INSERT INTO items (id,type,title,created_at,authored_at,authors,client_id,project_id,legal_tag,origin,content_hash,version,stale,extracted,tags)
                  VALUES ($1,$2,$3,$4,$4,'{chris}','c1',$5,$6,'{"source":"test"}'::jsonb,$7,1,$8,$9::jsonb,$10::text[])`,
    [i, o.type ?? 'report', o.title ?? k, ago(o.ageDays ?? 1), o.project, o.tag ?? 'lt-c1-nda', hex(i), !!o.stale, JSON.stringify(o.extracted ?? {}), o.tags ?? []]);
  for (const c of o.cites ?? []) await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1,$2)', [i, c]);
  if (o.dispatch) await db.query("INSERT INTO dispatches (id,item_id,direction,organisation_id,channel,occurred_at,recorded_by) VALUES ($1,$2,$3,'c1','post',$4,'test')", [randomUUID(), i, o.dispatch, ago(o.ageDays ?? 1)]);
  return i;
}
async function run(k: string, o: { project: string; job: string; version: string; status?: string; tag?: string }) {
  const r = uid(k);
  await db.query(`INSERT INTO runs (id,job,tool_version,tool_commit,author,created_at,client_id,project_id,legal_tag,title,record,input_hash,status)
                  VALUES ($1,$2,$3,'abc1234','chris',$4,'c1',$5,$6,$7,'{}'::jsonb,$8,$9)`, [r, o.job, o.version, ago(5), o.project, o.tag ?? 'lt-c1-nda', k, hex(r), o.status ?? 'final']);
  return r;
}

before(async () => {
  db = await openDb(undefined); await migrate(db);
  for (const [p, role] of [['chris', 'partner'], ['ana', 'associate'], ['bob', 'associate']]) await db.query('INSERT INTO people (id,email,name,role) VALUES ($1,$2,$3,$4)', [p, `${p}@${DOMAIN}`, p, role]);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','ATC internal','lt-firm')");
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('c1','Client One','client')");
  // Tags: p-mixed's expires in 20 days (no renewal note yet), p-clean's in 25 days (with a note), p-hidden's is far off, p-empty's has no expiry.
  const tag = (t: string, exp: string | null) => db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ($1,'client-nda','second-party','c1','Client One',$2)", [t, exp]);
  await tag('lt-c1-nda', ahead(20)); await tag('lt-c1-soon', ahead(25)); await tag('lt-c1-far', ahead(400)); await tag('lt-c1-open', null);
  const proj = (p: string, name: string, t: string, members: string[]) => db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,'c1',$2,$3,$4::text[])", [p, name, t, members]);
  await proj('p-mixed', 'Alpha mixed', 'lt-c1-nda', ['ana']);
  await proj('p-clean', 'Bravo clean', 'lt-c1-soon', ['ana']);
  await proj('p-hidden', 'Charlie partners-only', 'lt-c1-far', ['ana']);
  await proj('p-empty', 'Delta empty', 'lt-c1-open', ['ana']);
  const tools: [string, object][] = [['opportunity-register', { produces: ['npv10_usd_mm'], aliases: { current: '2.0.0' } }], ['nodal-analysis', { produces: ['operating_rate_bopd'], aliases: { current: '1.1.0' } }]];
  for (const [t, m] of tools) await db.query('INSERT INTO tools (id, manifest) VALUES ($1,$2::jsonb)', [t, JSON.stringify({ id: t, ...m })]);

  // p-mixed: R1 fails (a final nodal run on 1.0.0), R2 passes, R3 fails, R4 fails, R5 passes, R6 fails.
  const opp = await run('mixed-opp', { project: 'p-mixed', job: 'opportunity-register', version: '2.0.0' });
  await run('mixed-nodal', { project: 'p-mixed', job: 'nodal-analysis', version: '1.0.0' });
  await run('mixed-draft-old', { project: 'p-mixed', job: 'nodal-analysis', version: '0.9.0', status: 'draft' });   // drafts are not held to the rule
  await item('mixed-basis', { project: 'p-mixed', type: 'note', title: 'Basis note: base case', extracted: { kind: 'basis' }, cites: [`run:${opp}`] });
  await item('mixed-letter-bare', { project: 'p-mixed', type: 'letter', title: 'Letter with no run', dispatch: 'out' });
  await item('mixed-letter-ok', { project: 'p-mixed', type: 'letter', title: 'Letter with a run', dispatch: 'out', cites: [`run:${opp}`] });
  await item('mixed-letter-in', { project: 'p-mixed', type: 'letter', title: 'Letter received', dispatch: 'in' });   // inbound: not ours to cite runs
  await item('mixed-stale-old', { project: 'p-mixed', title: 'Old stale report', ageDays: 10, stale: true });
  await item('mixed-stale-new', { project: 'p-mixed', title: 'Fresh stale report', ageDays: 2, stale: true });
  await item('mixed-fresh', { project: 'p-mixed', title: 'Current report', ageDays: 10 });

  // p-clean: everything passes; its tag expires within 30 days but a renewal note covers it.
  const opp2 = await run('clean-opp', { project: 'p-clean', job: 'opportunity-register', version: '2.0.0', tag: 'lt-c1-soon' });
  await run('clean-nodal', { project: 'p-clean', job: 'nodal-analysis', version: '1.1.0', tag: 'lt-c1-soon' });
  await item('clean-basis', { project: 'p-clean', tag: 'lt-c1-soon', type: 'note', title: 'Basis note', extracted: { kind: 'basis' }, cites: [`run:${opp2}`] });
  await item('clean-letter', { project: 'p-clean', tag: 'lt-c1-soon', type: 'letter', dispatch: 'out', cites: [`run:${opp2}`] });
  await item('clean-renewal', { project: 'p-clean', tag: 'lt-c1-soon', type: 'note', title: 'Renewal note for the NDA', extracted: { kind: 'renewal', legal_tag: 'lt-c1-soon' } });

  // p-hidden: a stale NDA (partners-only type), old. Partners see it; an associate does not, so the rule differs by person.
  await item('hidden-nda', { project: 'p-hidden', tag: 'lt-c1-far', type: 'nda', title: 'Mutual NDA', ageDays: 30, stale: true });

  // mail capture and the nightly job have run; an unfiled message for p-mixed waits 1 day (fine) and one for p-empty waits 5 days.
  await db.query("INSERT INTO audit_events (person_id, action, scope, detail) VALUES ('job:nightly-staleness','staleness.run','firm','{}'::jsonb)");
  const mail = async (k: string, days: number, suggested: string) => {
    const i = await item(k, { project: 'firm', tag: 'lt-firm', type: 'email', title: `Mail ${k}`, ageDays: days });
    await db.query('INSERT INTO filing_queue (id,item_id,suggestions,status,created_at) VALUES ($1,$2,$3::jsonb,$4,$5)', [randomUUID(), i, JSON.stringify([{ project_id: suggested, confidence: 0.6 }]), 'open', ago(days)]);
  };
  await mail('mail-fresh', 1, 'p-mixed'); await mail('mail-old', 5, 'p-empty');
});
after(async () => { await db.close(); });

const status = (s: Awaited<ReturnType<typeof scorecard>>) => s.rules.map(r => r.status).join(' ');
const ref = (k: string, kind = 'run') => `${kind}:${id[k]}`;

test('the six rules carry the names of the M17 spec, in order', async () => {
  assert.deepEqual(RULES.map(r => r.name), [
    'Every final run uses the current tool version', 'Every evaluation has a basis note', 'Every letter cites at least one run',
    'No stale document older than 7 days', 'No unfiled correspondence older than 3 days', 'Legal tags not expiring within 30 days without a renewal note',
  ]);
  const s = await scorecard(db, CHRIS, 'p-clean');
  assert.deepEqual(s.rules.map(r => r.name), RULES.map(r => r.name));
  assert.deepEqual(s.rules.map(r => r.n), [1, 2, 3, 4, 5, 6]);
});

test('AC3: the mixed fixture project fails exactly the rules it was built to fail, with the offending refs', async () => {
  const s = await scorecard(db, CHRIS, 'p-mixed');
  assert.equal(status(s), 'fail pass fail fail pass fail');
  const [r1, r2, r3, r4, r5, r6] = s.rules;
  assert.deepEqual(r1.refs, [ref('mixed-nodal')]);
  assert.match(r1.detail, /nodal-analysis@1\.0\.0 \(current 1\.1\.0\)/);
  assert.ok(r2.refs.includes(ref('mixed-opp')) && r2.refs.includes(ref('mixed-basis', 'doc')));
  assert.deepEqual(r3.refs, [ref('mixed-letter-bare', 'doc')]);
  assert.deepEqual(r4.refs, [ref('mixed-stale-old', 'doc')]);
  assert.match(r4.detail, /Old stale report/);
  assert.ok(r5.detail.includes('none for more than 3 days') && r5.refs.includes(ref('mail-fresh', 'doc')));
  assert.deepEqual(r6.refs, ['tag:lt-c1-nda']);
  assert.equal(s.summary.pass, 2); assert.equal(s.summary.fail, 4); assert.equal(s.summary.rag, 'red');
});

test('AC3: the clean project passes every rule; a renewal note is what clears rule 6', async () => {
  const s = await scorecard(db, CHRIS, 'p-clean');
  assert.equal(status(s), 'pass pass pass pass pass pass');
  assert.equal(s.summary.rag, 'green');
  assert.match(s.rules[5].detail, /renewal note/);
  await db.query("DELETE FROM items WHERE id = $1", [id['clean-renewal']]);
  assert.equal((await scorecard(db, CHRIS, 'p-clean')).rules[5].status, 'fail');
  await item('clean-renewal', { project: 'p-clean', tag: 'lt-c1-soon', type: 'note', title: 'Renewal note for the NDA', extracted: { kind: 'renewal', legal_tag: 'lt-c1-soon' } });
  assert.equal((await scorecard(db, CHRIS, 'p-clean')).rules[5].status, 'pass');
});

test('AC3: a project with nothing to measure says not-measurable rather than passing', async () => {
  const s = await scorecard(db, CHRIS, 'p-empty');
  assert.equal(status(s), 'not-measurable not-measurable not-measurable pass fail not-measurable');
  assert.deepEqual(s.rules[4].refs, [ref('mail-old', 'doc')]);
  assert.deepEqual(s.rules[0].refs, []);
  assert.equal(s.summary.not_measurable, 4); assert.equal(s.summary.rag, 'amber');
});

test('rules 4 and 5 are not measurable before the nightly job or mail capture has run', async () => {
  const fresh = await openDb(undefined); await migrate(fresh);
  await fresh.query("INSERT INTO people (id,email,name,role) VALUES ('chris','c@x.com','Chris','partner')");
  await fresh.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-firm','firm','first-party','ATC')");
  await fresh.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('internal','Internal','lt-firm')");
  const s = await scorecard(fresh, CHRIS, 'internal');
  assert.equal(status(s), 'not-measurable not-measurable not-measurable not-measurable not-measurable not-measurable');
  assert.equal(s.summary.rag, 'grey');
  await fresh.close();
});

test('only records in the caller\'s scope count: an associate does not see a partners-only NDA that a partner does', async () => {
  assert.equal((await scorecard(db, CHRIS, 'p-hidden')).rules[3].status, 'fail');
  const ana = await scorecard(db, ANA, 'p-hidden');
  assert.equal(ana.rules[3].status, 'pass');
  assert.ok(!JSON.stringify(ana).includes(id['hidden-nda']), 'the hidden record must not appear in refs or details');
});

test('routes: /api/projects/:id/scorecard is scoped, /api/scorecards lists the projects the caller can see with a RAG summary', async () => {
  const as = (p: Person) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: p.email } });
  const chris = await as(CHRIS), bob = await as(BOB), ana = await as(ANA);
  const one = await chris.request('/api/projects/p-mixed/scorecard');
  assert.equal(one.status, 200);
  const body: any = await one.json();
  assert.equal(body.project_id, 'p-mixed'); assert.equal(body.rules.length, 6); assert.equal(body.summary.rag, 'red');
  assert.equal((await chris.request('/api/projects/nope/scorecard')).status, 404);
  assert.equal((await bob.request('/api/projects/p-mixed/scorecard')).status, 403, 'not a member');
  assert.equal((await ana.request('/api/projects/p-mixed/scorecard')).status, 200);

  const all: any = await (await chris.request('/api/scorecards')).json();
  assert.deepEqual(all.projects.map((p: any) => p.id), ['p-mixed', 'p-clean', 'p-hidden', 'p-empty']);   // by project name; the internal inbox is not a project
  assert.equal(all.rules.length, 6);
  const by = Object.fromEntries(all.projects.map((p: any) => [p.id, p]));
  assert.equal(by['p-mixed'].rag, 'red'); assert.equal(by['p-clean'].rag, 'green');
  assert.equal(by['p-mixed'].client_name, 'Client One');
  assert.deepEqual(by['p-clean'].rules.map((r: any) => r.status), Array(6).fill('pass'));
  assert.deepEqual(all.summary, { green: 1, amber: 2, red: 1, grey: 0 });
  const none: any = await (await bob.request('/api/scorecards')).json();
  assert.deepEqual(none.projects, [], 'a person who is a member of nothing sees no scorecards');
  const list = await scorecards(db, CHRIS);
  assert.equal(list.length, 4);
});
