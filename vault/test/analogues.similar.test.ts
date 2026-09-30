import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, uuidFrom } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { ScopeError } from '../src/gateway/scope.ts';
import type { Person } from '../src/auth.ts';
import { analogueVisibility, distanceBetween, populationStats, similar, visibleRows } from '../src/analogues/similar.ts';

const DOMAIN = 'alpha-technical-centre.com';
const NOW = new Date('2026-09-29T12:00:00Z');
const PARTNER: Person = { id: 'chris', email: `chris@${DOMAIN}`, name: 'Chris', role: 'partner' };
const ANA: Person = { id: 'ana', email: `ana@${DOMAIN}`, name: 'Ana', role: 'associate' };

let db: Db;
const num = (value: number, provenance = 'measured') => ({ value, provenance });
const ids = new Map<string, string>();

/** Inserts one analogue row. `run` names the project of a real source run (for the associate membership rule). */
async function put(name: string, tag: string, asset: string, body: Record<string, any>, run?: { project: string; status?: string }) {
  const id = uuidFrom(`sim:${name}`); ids.set(name, id);
  let source = `run:${uuidFrom(`sim-src:${name}`)}`;
  if (run) {
    const rid = source.slice(4);
    await db.query(
      `INSERT INTO runs (id, job, tool_version, tool_commit, author, created_at, project_id, asset_ids, legal_tag, record, input_hash, status)
       VALUES ($1,'financial-model','1.0.0','abc1234','chris',$2,$3,'{}',$4,'{}'::jsonb,$5,$6)`, [rid, '2026-09-01T00:00:00Z', run.project, tag, `sha256:${rid}`, run.status ?? 'final']);
  }
  const row = { id, source_ref: source, asset_id: asset, as_of: '2026-09-01', legal_tag: tag, provenance: 'own-evaluation', ...body };
  await db.query('INSERT INTO analogue_rows (id, source_ref, asset_id, legal_tag, provenance, as_of, row) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)', [id, source, asset, tag, 'own-evaluation', '2026-09-01', JSON.stringify(row)]);
  return row;
}

const cubiro = { lithology: 'clastic', environment: 'onshore', drive_mechanism: 'waterflood', fluid_type: 'black-oil', depth_m: num(2900), porosity_frac: num(0.17), permeability_md: num(320), api_gravity: num(24) };

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana',$1,'Ana','associate') ON CONFLICT DO NOTHING", [`ana@${DOMAIN}`]);
  for (const c of ['a', 'b']) {
    await db.query('INSERT INTO organisations (id,name,kind) VALUES ($1,$2,$3)', [c, `Client ${c}`, 'client']);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ($1,'client-nda','second-party',$2,$3)", [`lt-${c}-nda`, c, c]);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ($1,'client-nda','second-party',$2,$3,'2020-01-01')", [`lt-${c}-old`, c, c]);
    for (const n of [1, 2]) await db.query('INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,$2,$3,$4,$5::text[])', [`p-${c}-${n}`, c, `${c}${n}`, `lt-${c}-nda`, c === 'a' && n === 1 ? ['ana', 'chris'] : ['chris']]);
  }
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator,partners_only) VALUES ('lt-firm-po','firm','first-party','ATC',true)");

  // the field we ask about, and the seeded neighbours
  await put('cubiro', 'lt-firm', 'field:llanos:cubiro', cubiro);
  await put('yopal', 'lt-firm', 'field:llanos:yopal', { ...cubiro, depth_m: num(2750), porosity_frac: num(0.18), permeability_md: num(290), api_gravity: num(25) });
  await put('chichimene', 'lt-public', 'field:llanos:chichimene', { ...cubiro, fluid_type: 'heavy-oil', drive_mechanism: 'water-drive', depth_m: num(2600), porosity_frac: num(0.19), permeability_md: num(450), api_gravity: num(14) });
  await put('lagunillas', 'lt-public', 'field:maracaibo:lagunillas', { ...cubiro, fluid_type: 'heavy-oil', depth_m: num(1000), porosity_frac: num(0.30), permeability_md: num(1500), api_gravity: num(16) });
  await put('loma', 'lt-public', 'field:neuquen:loma-campana', { lithology: 'shale', environment: 'onshore', fluid_type: 'volatile-oil', depth_m: num(2700), porosity_frac: num(0.08), permeability_md: num(0.0005) });
  // rows that must never be returned to the firm scope, though each is a better match than the neighbours
  await put('b-secret', 'lt-b-nda', 'field:b:twin', { ...cubiro }, { project: 'p-b-1' });
  await put('b-old', 'lt-b-old', 'field:b:old-twin', { ...cubiro });
  await put('partner-only', 'lt-firm-po', 'field:llanos:po-twin', { ...cubiro });
  await put('withdrawn', 'lt-firm', 'field:llanos:withdrawn-twin', { ...cubiro }, { project: 'firm', status: 'superseded' });
  // client A: one row from a project Ana is on, one from a project she is not
  await put('a-mine', 'lt-a-nda', 'field:a:mine', { ...cubiro, depth_m: num(2890) }, { project: 'p-a-1' });
  await put('a-theirs', 'lt-a-nda', 'field:a:theirs', { ...cubiro, depth_m: num(2895) }, { project: 'p-a-2' });
});
after(async () => { await db.close(); });

const names = (hits: { row: { id: string } }[]) => hits.map(h => [...ids].find(([, v]) => v === h.row.id)![0]);

test('the seeded nearest field is first, then by distance, and the target\'s own asset is left out', async () => {
  const r = await similar(db, ANA, 'firm', { asset_id: 'field:llanos:cubiro' }, 10, { now: NOW });
  assert.deepEqual(names(r.hits), ['yopal', 'chichimene', 'lagunillas', 'loma']);
  const d = r.hits.map(h => h.distance);
  assert.deepEqual(d, [...d].sort((a, b) => a - b), 'ascending');
  assert.ok(d[0] > 0 && d[0] < d[1]);
  assert.ok(r.hits.every(h => h.row.asset_id !== 'field:llanos:cubiro'));
  assert.equal(r.population, 5, 'an associate\'s firm scope holds five rows, cubiro included');
});

test('each hit carries its source ref, legal tag and the properties that drove the distance', async () => {
  const r = await similar(db, ANA, 'firm', { asset_id: 'field:llanos:cubiro' }, 3, { now: NOW });
  assert.equal(r.hits.length, 3);
  const chi = r.hits.find(h => h.row.asset_id === 'field:llanos:chichimene')!;
  assert.match(chi.source_ref, /^run:/); assert.equal(chi.legal_tag, 'lt-public');
  const props = chi.drivers.map(x => x.property);
  assert.ok(props.includes('fluid_type') && props.includes('drive_mechanism'), `categorical mismatches drive it: ${props}`);
  assert.ok(chi.drivers.every(x => x.dissimilarity > 0) && chi.drivers.length <= 3);
  assert.ok(chi.contributions.length === chi.shared);
  assert.ok(Math.abs(chi.contributions.reduce((s, c) => s + c.share, 0) - 1) < 1e-9);
  const yop = r.hits[0];
  assert.ok(!yop.drivers.some(x => x.kind === 'categorical'), 'categoricals agree with the nearest field');
});

test('a row outside the scope is never returned, whatever its distance', async () => {
  const firm = await similar(db, PARTNER, 'firm', { asset_id: 'field:llanos:cubiro' }, 50, { now: NOW });
  assert.equal(names(firm.hits)[0], 'partner-only', 'a partner may see the partners-only twin');
  for (const hidden of ['b-secret', 'b-old', 'withdrawn', 'a-mine', 'a-theirs']) assert.ok(!names(firm.hits).includes(hidden), `${hidden} not in firm scope`);
  const pub = await similar(db, PARTNER, 'public', { row: cubiro }, 50, { now: NOW });
  assert.deepEqual(names(pub.hits).sort(), ['chichimene', 'lagunillas', 'loma']);
  // the same holds for an explicit row as the target
  const viaRow = await similar(db, PARTNER, 'firm', { row: cubiro }, 50, { now: NOW });
  assert.ok(!names(viaRow.hits).includes('b-secret'));
  // client:b sees its own NDA row, firm and public; never client a's
  const b = await similar(db, PARTNER, 'client:b', { row: cubiro }, 50, { now: NOW });
  assert.equal(b.hits.find(h => h.row.id === ids.get('b-secret'))!.distance, 0, 'the twin is at distance zero inside its own client scope');
  assert.ok(names(b.hits).includes('b-secret')); assert.ok(!names(b.hits).includes('b-old'));
  assert.ok(!names(b.hits).includes('a-mine'));
  // partners-only reaches only partners
  const asAna = await similar(db, ANA, 'firm', { row: cubiro }, 50, { now: NOW });
  assert.ok(!names(asAna.hits).includes('partner-only'));
});

test('associates see client rows only from projects they belong to; scopes they may not hold are refused', async () => {
  const mine = (await visibleRows(db, ANA, 'project:p-a-1', { now: NOW })).rows.map(r => r.asset_id);
  assert.ok(mine.includes('field:a:mine')); assert.ok(!mine.includes('field:a:theirs'));
  const partner = (await visibleRows(db, PARTNER, 'client:a', { now: NOW })).rows.map(r => r.asset_id);
  assert.ok(partner.includes('field:a:mine') && partner.includes('field:a:theirs'));
  await assert.rejects(visibleRows(db, ANA, 'project:p-b-1', { now: NOW }), (e: any) => e instanceof ScopeError && e.status === 403);
  await assert.rejects(visibleRows(db, ANA, 'client:b', { now: NOW }), (e: any) => e.status === 403);
  await assert.rejects(visibleRows(db, ANA, undefined as any, { now: NOW }), (e: any) => e.status === 400);
});

test('an asset with no row in scope is a 404, and no target is a 400', async () => {
  await assert.rejects(similar(db, PARTNER, 'firm', { asset_id: 'field:b:twin' }, 5, { now: NOW }), (e: any) => e.status === 404);
  await assert.rejects(similar(db, PARTNER, 'firm', {} as any, 5, { now: NOW }), (e: any) => e.status === 400);
});

test('distance is the mean of per-attribute dissimilarities: hand-checked', () => {
  const rows = [{ depth_m: { value: 100 }, porosity_frac: { value: 0.2 } }, { depth_m: { value: 200 }, porosity_frac: { value: 0.3 } }];
  const stats = populationStats(rows);
  assert.equal(stats.depth_m.mean, 150); assert.equal(stats.depth_m.sd, 50);
  const num = distanceBetween(rows[0], rows[1], stats)!;
  assert.ok(Math.abs(num.distance - 2 / 3) < 1e-9, 'each attribute is 2 sd apart: 2/3 of the cap');
  const cat = distanceBetween({ ...rows[0], lithology: 'clastic' }, { ...rows[1], lithology: 'carbonate' }, stats)!;
  assert.ok(Math.abs(cat.distance - (2 / 3 + 2 / 3 + 1) / 3) < 1e-9, 'a categorical mismatch adds the penalty');
  const same = distanceBetween({ ...rows[0], lithology: 'clastic' }, { ...rows[1], lithology: 'clastic' }, stats)!;
  assert.ok(same.distance < cat.distance);
  assert.equal(distanceBetween({ depth_m: { value: 1 } }, { depth_m: { value: 2 } }, stats), null, 'fewer than two shared attributes is not comparable');
});

test('GET /api/analogues/similar: scope is required, ScopeError maps to 400/403, hits carry distance and drivers', async () => {
  const partner = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: PARTNER.email } });
  const ana = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: ANA.email } });
  const get = async (a: typeof partner, q: string) => { const r = await a.request(`/api/analogues/similar?${q}`); return { status: r.status, body: (await r.json()) as any }; };
  assert.equal((await get(partner, 'asset=field:llanos:cubiro')).status, 400);
  assert.equal((await get(partner, 'scope=nope:1&asset=field:llanos:cubiro')).status, 400);
  assert.equal((await get(ana, 'scope=project:p-b-1&asset=field:llanos:cubiro')).status, 403);
  assert.equal((await get(partner, 'scope=firm')).status, 400);
  assert.equal((await get(partner, 'scope=firm&asset=x&row={}')).status, 400);
  assert.equal((await get(partner, 'scope=firm&row=notjson')).status, 400);
  assert.equal((await get(partner, 'scope=firm&asset=field:none:none')).status, 404);
  const ok = await get(ana, 'scope=firm&asset=field:llanos:cubiro&k=2');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.hits.length, 2);
  assert.equal(ok.body.hits[0].row.asset_id, 'field:llanos:yopal');
  assert.ok(typeof ok.body.hits[0].distance === 'number' && Array.isArray(ok.body.hits[0].drivers));
  const viaRow = await get(partner, `scope=public&row=${encodeURIComponent(JSON.stringify(cubiro))}`);
  assert.equal(viaRow.status, 200); assert.equal(viaRow.body.hits.length, 3);
  const rows = await (await ana.request('/api/analogues?scope=firm&provenance=own-evaluation')).json() as any;
  assert.equal(rows.count, 5); assert.ok(rows.rows.every((r: any) => r.provenance === 'own-evaluation'));
  assert.equal((await partner.request('/api/analogues?scope=firm&provenance=bogus')).status, 400);
  assert.equal((await partner.request('/api/analogues')).status, 400);
  const one = await (await ana.request('/api/analogues?scope=firm&asset=field:llanos:yopal')).json() as any;
  assert.equal(one.count, 1);
  const a = (await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'analogue.%'")).rows[0].n;
  assert.ok(a >= 8, 'audited');
});

test('the predicate is a pure SQL term set over analogue_rows a and legal_tags lt', () => {
  const projects = new Map([['p', { id: 'p', client_id: 'x', members: ['ana'] }]]);
  const p = analogueVisibility({ kind: 'client', client_id: 'x', label: 'client:x' }, ANA, NOW, projects, 3);
  assert.match(p.sql, /lt\.classification = 'client-nda' AND lt\.client_id = \$4/);
  assert.match(p.sql, /NOT lt\.partners_only/);
  assert.deepEqual(p.params, ['2026-09-29', 'x', ['p']]);
});
