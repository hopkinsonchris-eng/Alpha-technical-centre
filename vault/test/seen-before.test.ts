// Wave 7 PR6, P3 "have we seen this before" (docs/vault-hub/wave7/04-step-changes.md P3; 05-markup.md §1.9): on entry, a new
// project's organisation, country, field and gazetteer names and its first document's text are matched against the firm's
// own records in the caller's scope, as one cited paragraph with the reasons shown. A client-NDA evaluation is named only to
// those whose scope includes it; the search runs through the gateway's own predicate, so scope never widens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-seen-'));
delete process.env.CF_ACCESS_TEAM_DOMAIN;
process.env.NODE_ENV = 'test';

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { configureSearch } = await import('../src/gateway/index.ts');
const { FakeEmbedder, vectorLiteral } = await import('../src/ingest/embed.ts');
const { seenBefore } = await import('../src/rounds/seen-before.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const DOMAIN = 'alpha-technical-centre.com';
const fake = new FakeEmbedder();
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let associate: Awaited<ReturnType<typeof createApp>>;
const chris = { id: 'chris', email: `chris@${DOMAIN}`, name: 'Chris', role: 'partner' as const };
const ana = { id: 'ana', email: `ana@${DOMAIN}`, name: 'Ana', role: 'associate' as const };
const call = async (a: typeof partner, url: string) => { const r = await a.request(url); return { status: r.status, body: await r.json() }; };

const ids = { oldMemo: randomUUID(), ndaIndex: randomUUID(), approach: randomUUID() };
async function doc(id: string, o: { title: string; project: string; tag: string; client: string | null; text: string; created: string; type?: string }) {
  await db.query(`INSERT INTO items (id, type, title, created_at, authors, client_id, project_id, legal_tag, origin, content_hash, version, extracted)
                  VALUES ($1,$2,$3,$4,'{chris}',$5,$6,$7,'{"source":"upload"}'::jsonb,$8,1,$9::jsonb)`, [id, o.type ?? 'report', o.title, o.created, o.client, o.project, o.tag, `sha256:${id.replace(/-/g, '').padEnd(64, '0')}`, JSON.stringify({ kind: 'report', text: o.text })]);
  const [emb] = await fake.embed([o.text]);
  await db.query('INSERT INTO chunks (item_id, item_version, ordinal, text, legal_tag, client_id, project_id, embedding) VALUES ($1,1,0,$2,$3,$4,$5,$6::vector)', [id, o.text, o.tag, o.client, o.project, vectorLiteral(emb)]);
}

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  configureSearch({ embed: async (t) => (await fake.embed([t]))[0], maxDistance: fake.maxDistance });
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('ana','ana@${DOMAIN}','Ana','associate') ON CONFLICT (id) DO NOTHING`);
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('org-client-co','Client Co','client','GY'),('org-company-y','Company Y','operator','GY'),('org-other','Other Holdings','client','GY')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-nda-other','client-nda','second-party','org-other','Other Holdings')");
  await db.query("INSERT INTO assets (id,kind,name,country) VALUES ('field:block-12','block','Block 12','GY'),('basin:guyana','basin','Guyana Basin','GY')");
  await db.query(`INSERT INTO projects (id,client_id,name,default_legal_tag,members,country,status,stage,asset_ids,register,created_at,closed_at) VALUES
    ('p-old','org-client-co','Block 12 screening','lt-firm','{chris}','GY','closed','Lost','{field:block-12}','{"holder":"Company Y"}','2024-03-01','2024-06-30'),
    ('p-nda','org-other','Other Holdings data room','lt-nda-other','{chris}','GY','active','Technical review','{field:block-12}','{}','2025-01-10',NULL),
    ('p-new','org-client-co','Block 12 farm-in','lt-firm','{chris,ana}','GY','prospect','Initial screen','{field:block-12}','{"holder":"Company Y"}','2026-10-01',NULL),
    ('p-far','org-client-co','Talara nodal study','lt-firm','{chris}','PE','active','Qualified','{}','{}','2026-05-01',NULL)`);
  await doc(ids.oldMemo, { title: 'Block 12 screening memo', project: 'p-old', tag: 'lt-firm', client: 'org-client-co', created: '2024-04-02', text: 'Block 12 screening for Client Co: the production figure quoted in the data room was wrong by a factor of three; the opportunity was dropped.' });
  await doc(ids.ndaIndex, { title: 'Block 12 data room index', project: 'p-nda', tag: 'lt-nda-other', client: 'org-other', created: '2025-02-01', text: 'Block 12 data room index for Other Holdings: seismic volumes, well logs and the production figure from Company Y.' });
  await doc(ids.approach, { title: 'Company Y approach letter', project: 'p-new', tag: 'lt-firm', client: 'org-client-co', created: '2026-10-02', text: 'Company Y proposes a farm-in to Block 12 offshore Guyana; the production figure offered is 12,000 bopd from the data room.', type: 'letter' });
  partner = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  associate = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
});
after(async () => { configureSearch({}); await db.close(); });

test('P3 seenBefore: the prior screening of the same field for the same client is found with its reasons and cited; the first document finds the memo through the gateway; organisations named on the approach are listed; the project being screened is left out', async () => {
  const r = await seenBefore(db, chris, { country: 'GY', organisation_ids: ['org-client-co', 'org-company-y'], names: ['Block 12', 'Company Y'], first_item_id: ids.approach, exclude_project_id: 'p-new' }, { now: new Date('2026-10-05T09:00:00Z') });
  const old = r.matches.find(m => m.ref === 'project:p-old');
  assert.ok(old, JSON.stringify(r.matches));
  assert.deepEqual(old!.reasons, ['same field: Block 12 (block)', 'same client: Client Co', 'name matches "Block 12"', 'same holder: Company Y', 'same country: Guyana']);
  assert.equal(old!.cite, `doc:${ids.oldMemo}`);
  assert.ok(!r.matches.some(m => m.project_id === 'p-new'), 'the project itself is not a match');
  assert.ok(!r.matches.some(m => m.ref === 'project:p-far'), 'a project sharing only the client\'s other work is not matched by field or name');
  assert.ok(r.matches.some(m => m.kind === 'document' && m.ref === `doc:${ids.oldMemo}`), 'the first document reads like the old memo');
  assert.ok(r.matches.some(m => m.kind === 'organisation' && m.name === 'Client Co') && r.matches.some(m => m.kind === 'organisation' && m.name === 'Company Y'));
  assert.ok(r.paragraph);
  assert.match(r.paragraph!.en, /The firm already has "Block 12 screening" for Client Co \(closed, Lost, closed 2024-06-30; same field: Block 12 \(block\); same client: Client Co/);
  assert.match(r.paragraph!.en, new RegExp(`\\[doc:${ids.oldMemo}\\]`));
  assert.match(r.paragraph!.es, /La firma ya tiene "Block 12 screening" para Client Co/);
  assert.ok(r.cites.includes(`doc:${ids.oldMemo}`));
  // A partner sees the NDA project as a match by field, but its document never surfaces through the search (firm scope, never wider than Find).
  assert.ok(r.matches.some(m => m.ref === 'project:p-nda'));
  assert.ok(!r.matches.some(m => m.ref === `doc:${ids.ndaIndex}`), 'the client-NDA chunk is outside firm scope');
  assert.ok(!r.paragraph!.en.includes('seismic volumes'));
});

test('P3 scope never widens: an associate outside the NDA project neither sees it named nor its document; the firm-tagged screening is still found', async () => {
  const r = await seenBefore(db, ana, { country: 'GY', organisation_ids: ['org-client-co'], names: ['Block 12'], first_item_id: ids.approach, exclude_project_id: 'p-new' }, { now: new Date('2026-10-05T09:00:00Z') });
  assert.ok(r.matches.some(m => m.ref === 'project:p-old'));
  assert.ok(!r.matches.some(m => m.ref === 'project:p-nda' || m.ref === `doc:${ids.ndaIndex}`), JSON.stringify(r.matches));
  assert.ok(!JSON.stringify(r).includes('Other Holdings data room'));
});

test('P3 GET /api/projects/:id/seen-before: built from the project\'s own country, client, fields, holder and first document; 404 outside the caller\'s scope; audited in the project\'s scope', async () => {
  const r = await call(partner, '/api/projects/p-new/seen-before');
  assert.equal(r.status, 200);
  assert.equal(r.body.project_id, 'p-new');
  const old = r.body.matches.find((m: any) => m.ref === 'project:p-old');
  assert.ok(old, JSON.stringify(r.body.matches));
  assert.ok(old.reasons.includes('same field: Block 12 (block)') && old.reasons.includes('same holder: Company Y') && old.reasons.includes('same client: Client Co'), JSON.stringify(old.reasons));
  assert.ok(r.body.paragraph && /Block 12 screening/.test(r.body.paragraph.en));
  const a = await call(associate, '/api/projects/p-new/seen-before');
  assert.equal(a.status, 200);
  assert.ok(!JSON.stringify(a.body).includes('p-nda'));
  assert.equal((await call(associate, '/api/projects/p-nda/seen-before')).status, 404, 'not a member of the NDA project');
  assert.equal((await call(partner, '/api/projects/p-none/seen-before')).status, 404);
  const audited = (await db.query<any>("SELECT scope, refs FROM audit_events WHERE action = 'project.seen_before' AND scope = 'project:p-new' ORDER BY id LIMIT 1")).rows[0];
  assert.ok(audited); assert.ok(audited.refs.includes('project:p-new') && audited.refs.includes(`doc:${ids.oldMemo}`));
});
