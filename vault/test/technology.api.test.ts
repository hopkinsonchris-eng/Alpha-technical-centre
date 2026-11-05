import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NDA_DOC = U(201), FIRM_DOC = U(202);
const DOMAIN = 'alpha-technical-centre.com';

async function setup() {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  // chris is a partner on Orinoco (client NDA); ana an associate member; ben an associate who is not a member.
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'),('ben','ben@alpha-technical-centre.com','Ben','associate') ON CONFLICT DO NOTHING");
  await db.query("UPDATE projects SET members = '{chris,ana}' WHERE id = 'orinoco-partnership'");
  const doc = (id: string, project: string, tag: string, n: number) => db.query(
    "INSERT INTO items (id,type,title,created_at,project_id,legal_tag,origin,content_hash,version) VALUES ($1,'note',$2,now(),$3,$4,'{\"source\":\"upload\"}'::jsonb,$5,1)", [id, `note ${n}`, project, tag, `sha256:${String(n).repeat(64).slice(0, 64)}`]);
  await doc(NDA_DOC, 'orinoco-partnership', 'lt-orinoco-nda-2026', 1);
  await doc(FIRM_DOC, 'firm', 'lt-firm', 2);
  const as = async (who: string) => {
    const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `${who}@${DOMAIN}` }, version: 'test' });
    return (p: string, body?: unknown) => app.request(p, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };
  return { db, chris: await as('chris'), ana: await as('ana'), ben: await as('ben') };
}
const j = async (r: Response) => (await r.json()) as any;
const entry = (over: Record<string, unknown> = {}) => ({
  application: 'artificial-lift', name: 'Plunger lift', summary: 'A free piston lifts liquid slugs from gas wells using reservoir energy.', readiness: 4,
  screening: { depth_m: { max: 2000 }, environment: ['onshore', 'shallow-water'] },
  evidence: [{ claim: 'EPA reports payback in months.', tier: 'E2', who: 'US EPA', source: 'https://www.epa.gov/natural-gas-star-program' }],
  providers: [{ name: 'ChampionX' }, { name: 'PCS Ferguson', adipec_2026: { hall: 'Hall 15', stand: '15100' } }],
  scores: { capex: 5, opex: 5, benefit: 2, evidence: 4 }, reference_fit: { score: 2, reason: 'Oil wells mostly' },
  ...over,
});

test('proposals: associates propose, only partners confirm, proposals stay private to partners and the author (AC1)', async () => {
  const { db, chris, ana, ben } = await setup();
  const bad = async (body: unknown, p: string) => { const r = await ana('/api/technology', body); assert.equal(r.status, 400, JSON.stringify(await r.clone().json())); assert.equal((await j(r)).error.path, p); };
  await bad(entry({ name: undefined }), '/name');
  await bad(entry({ colour: 'red' }), '/colour');
  await bad(entry({ evidence: [] }), '/evidence');
  await bad(entry({ evidence: [{ claim: 'x', tier: 'E5', source: 'https://x.org' }] }), '/evidence/0/tier');
  await bad(entry({ screening: { depth_m: { min: 9, max: 1 } } }), '/screening/depth_m');
  await bad(entry({ application: 'astrology' }), '/application');
  await bad(entry({ key: 'WH01' }), '/key');
  await bad(entry({ key: 'AL99' }), '/key');

  const r = await ana('/api/technology', { ...entry(), status: 'confirmed', author: 'chris', legal_tag: 'lt-public' });
  assert.equal(r.status, 201);
  const p = await j(r);
  assert.equal(p.status, 'proposed', 'an associate cannot confirm by posting status'); assert.equal(p.author, 'ana'); assert.equal(p.legal_tag, 'lt-firm');
  assert.equal(p.key, 'AL01'); assert.equal(p.version, 1);
  // the same content again is a no-op
  const again = await ana('/api/technology', entry());
  assert.equal(again.status, 200); assert.equal((await j(again)).duplicate, true);

  assert.equal((await j(await ana('/api/technology?status=proposed'))).count, 1);
  assert.equal((await j(await ben('/api/technology?status=proposed'))).count, 0, 'other associates do not see proposals');
  assert.equal((await ben(`/api/technology/${p.id}`)).status, 404);
  assert.equal((await j(await ana('/api/technology'))).count, 0, 'nothing confirmed yet');

  assert.equal((await ana(`/api/technology/${p.id}/confirm`, {})).status, 403);
  const c = await chris(`/api/technology/${p.id}/confirm`, {});
  assert.equal(c.status, 200); assert.equal((await j(c)).status, 'confirmed');
  assert.equal((await chris(`/api/technology/${p.id}/confirm`, {})).status, 409);
  const list = await j(await ben('/api/technology'));
  assert.equal(list.count, 1); assert.equal(list.entries[0].key, 'AL01'); assert.equal(list.entries[0].adipec_2026, 1);
  assert.equal(list.entries[0].scores.cost_benefit, 2); assert.equal(list.entries[0].scores.citation, null);
  const audits = (await db.query("SELECT action FROM audit_events WHERE action LIKE 'technology.%'")).rows.map((a: any) => a.action);
  assert.ok(audits.includes('technology.propose') && audits.includes('technology.confirm'));
  await db.close();
});

test('a confirmed revision supersedes the previous version; history keeps both (AC2)', async () => {
  const { db, chris, ana } = await setup();
  const v1 = await j(await chris('/api/technology', { ...entry(), status: 'confirmed' }));
  assert.equal(v1.status, 'confirmed', 'a partner may confirm on posting');
  const v2 = await j(await ana('/api/technology', entry({ key: 'AL01', summary: 'A free piston lifts liquid slugs; now with two field trials cited.', note: 'radar 2026-12' })));
  assert.equal(v2.version, 2); assert.equal(v2.status, 'proposed');
  let cur = await j(await ana('/api/technology'));
  assert.equal(cur.count, 1); assert.equal(cur.entries[0].version, 1, 'the proposal does not replace the confirmed version');
  await chris(`/api/technology/${v2.id}/confirm`, {});
  cur = await j(await ana('/api/technology'));
  assert.equal(cur.count, 1); assert.equal(cur.entries[0].version, 2);
  const one = await j(await ana(`/api/technology/${v2.id}`));
  assert.deepEqual(one.history.map((h: any) => [h.version, h.status, !!h.superseded_by]), [[2, 'confirmed', false], [1, 'confirmed', true]]);
  const old = await j(await ana(`/api/technology/${v1.id}`));
  assert.equal(old.version, 1, 'the superseded version stays readable');
  // retire takes the key out of the register and keeps every version
  assert.equal((await chris(`/api/technology/${v1.id}/retire`, {})).status, 409, 'a superseded version cannot be retired');
  assert.equal((await chris(`/api/technology/${v2.id}/retire`, {})).status, 200);
  assert.equal((await j(await ana('/api/technology'))).count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM tech_entries WHERE key = 'AL01'")).rows[0].n, 2);
  // a rejected proposal never becomes valid
  const v3 = await j(await ana('/api/technology', entry({ name: 'Gas-assisted plunger lift' })));
  assert.equal(v3.key, 'AL02');
  assert.equal((await chris(`/api/technology/${v3.id}/reject`, {})).status, 200);
  assert.equal((await chris(`/api/technology/${v3.id}/confirm`, {})).status, 409);
  await db.close();
});

test('evidence may cite only firm or public Vault records (AC3)', async () => {
  const { db, chris } = await setup();
  const nda = await chris('/api/technology', entry({ evidence: [{ claim: 'Field result', tier: 'E3', source: `doc:${NDA_DOC}` }] }));
  assert.equal(nda.status, 400); assert.equal((await j(nda)).error.path, '/evidence/0/source');
  const missing = await chris('/api/technology', entry({ evidence: [{ claim: 'x', tier: 'E3', source: `doc:${U(999)}` }] }));
  assert.equal(missing.status, 400);
  const firm = await chris('/api/technology', entry({ evidence: [{ claim: 'Firm method note', tier: 'E3', source: `doc:${FIRM_DOC}` }] }));
  assert.equal(firm.status, 201);
  await db.close();
});

test('citations: partners and service jobs append; scores scale within an application (AC4)', async () => {
  const { db, chris, ana } = await setup();
  const a = await j(await chris('/api/technology', { ...entry(), status: 'confirmed' }));
  const b = await j(await chris('/api/technology', { ...entry({ name: 'ESP' }), status: 'confirmed' }));
  const w = await j(await chris('/api/technology', { ...entry({ application: 'water-handling', name: 'Hydrocyclones' }), status: 'confirmed' }));
  assert.equal(w.key, 'WH01');
  assert.equal((await ana('/api/technology/citations', { counts: [{ key: 'AL01', query: '"plunger lift"', source: 'import', since_2016: 1, since_2023: 1 }] })).status, 403);
  assert.equal((await chris('/api/technology/citations', { counts: [{ key: 'ZZ01', query: 'q', source: 'import', since_2016: 1, since_2023: 1 }] })).status, 400);
  const ok = await chris('/api/technology/citations', { counts: [
    { key: 'AL01', query: '"plunger lift"', source: 'import', since_2016: 153, since_2023: 66 },
    { key: 'AL02', query: '"electric submersible pump"', source: 'import', since_2016: 1879, since_2023: 819 },
    { key: 'WH01', query: 'hydrocyclone', source: 'import', since_2016: 7, since_2023: 2 },
  ] });
  assert.equal(ok.status, 201);
  const al = await j(await ana('/api/technology?application=artificial-lift'));
  const byKey = Object.fromEntries(al.entries.map((e: any) => [e.key, e]));
  assert.equal(byKey.AL02.scores.citation, 5); assert.equal(byKey.AL01.scores.citation, 1);
  const wh = await j(await ana('/api/technology?application=water-handling'));
  assert.equal(wh.entries[0].scores.citation, 5, 'a lone count in its own application scores 5');
  assert.equal((await ana('/api/technology?w=1,2')).status, 400);
  const costOnly = await j(await ana('/api/technology?application=artificial-lift&w=0,1,0,0'));
  assert.equal(costOnly.entries[0].scores.overall, costOnly.entries[0].scores.cost_benefit);
  void a; void b;
  await db.close();
});

test('projects: conditions, match and suggestions respect project access (AC6, AC7)', async () => {
  const { db, chris, ana, ben } = await setup();
  const e = await j(await chris('/api/technology', { ...entry(), status: 'confirmed' }));
  await chris('/api/technology', { ...entry({ name: 'Deep ESP', screening: { depth_m: { max: 5000 } } }), status: 'confirmed' });
  const P = '/api/projects/orinoco-partnership/technology';
  assert.equal((await ben(`${P}/conditions`)).status, 403, 'a non-member cannot read client project conditions');
  assert.equal((await ben(`${P}/conditions`, { conditions: { depth_m: 1000 } })).status, 403);
  assert.equal((await ana(`${P}/conditions`, { conditions: { depth_m: 'deep' } })).status, 400);
  assert.equal((await ana(`${P}/conditions`, { conditions: { colour: 'red' } })).status, 400);
  assert.equal((await ana('/api/projects/nope/technology/conditions')).status, 404);
  assert.equal((await ana(`${P}/conditions`, { conditions: { depth_m: 3000, environment: 'shallow-water' }, note: 'from the 2026 well file' })).status, 201);
  const cond = await j(await ana(`${P}/conditions`));
  assert.equal(cond.conditions.depth_m, 3000); assert.equal(cond.sources.depth_m.from, 'stored');

  const m = await j(await ana(`${P}/match`));
  assert.equal(m.count, 2);
  const plunger = m.entries.find((x: any) => x.key === e.key), deep = m.entries.find((x: any) => x.key !== e.key);
  assert.equal(plunger.screen.verdict, 'fail'); assert.equal(plunger.scores.fit, 1);
  assert.equal(deep.screen.verdict, 'pass'); assert.equal(deep.rank, 1, 'the entry that passes ranks first');

  assert.equal((await ana(`${P}/suggestions`, { key: 'AL09', status: 'shortlisted' })).status, 400);
  assert.equal((await ana(`${P}/suggestions`, { key: e.key, status: 'adopted' })).status, 400);
  assert.equal((await ben(`${P}/suggestions`, { key: e.key, status: 'shortlisted' })).status, 403);
  assert.equal((await ana(`${P}/suggestions`, { key: e.key, status: 'suggested', note: 'check depth' })).status, 201);
  assert.equal((await ana(`${P}/suggestions`, { key: e.key, status: 'dismissed', note: 'too deep' })).status, 201);
  const s = await j(await ana(`${P}/suggestions`));
  assert.equal(s.suggestions.length, 1); assert.equal(s.suggestions[0].status, 'dismissed', 'the latest decision wins');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_suggestions')).rows[0].n, 2, 'decisions are appended, never overwritten');
  const m2 = await j(await ana(`${P}/match`));
  assert.equal(m2.entries.find((x: any) => x.key === e.key).suggestion.status, 'dismissed');
  await db.close();
});
