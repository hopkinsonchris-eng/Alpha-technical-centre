import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, uuidFrom } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import type { Person } from '../src/auth.ts';
import { defaults, percentile, PLAY_INPUTS, PlayError } from '../src/analogues/defaults.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOMAIN = 'alpha-technical-centre.com';
const NOW = new Date('2026-09-29T12:00:00Z');
const PARTNER: Person = { id: 'chris', email: `chris@${DOMAIN}`, name: 'Chris', role: 'partner' };
const ANA: Person = { id: 'ana', email: `ana@${DOMAIN}`, name: 'Ana', role: 'associate' };
const FT_PER_M = 1 / 0.3048;

let db: Db;
const n = (value: number, provenance = 'reported') => ({ value, provenance });
let seq = 0;
async function put(tag: string, provenance: string, body: Record<string, any>) {
  const id = uuidFrom(`def:${++seq}`);
  const row = { id, source_ref: `doc:${uuidFrom(`def-src:${seq}`)}`, asset_id: `paper:${seq}`, as_of: '2026-06-01', legal_tag: tag, provenance, ...body };
  await db.query('INSERT INTO analogue_rows (id, source_ref, asset_id, legal_tag, provenance, as_of, row) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)', [id, row.source_ref, row.asset_id, tag, provenance, '2026-06-01', JSON.stringify(row)]);
}

/* Twelve carbonate-waterflood rows: seven own evaluations (measured) and five papers (reported). */
const K = [5, 8, 10, 15, 20, 30, 40, 60, 80, 120, 150, 200];
const H = [15, 18, 22, 25, 28, 30, 33, 36, 40, 45, 52, 60];                             // metres
const PHI = [0.08, 0.09, 0.10, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.19, 0.22];
const SPACING = [40, 60, 80, 100];                                                        // only four rows state it
const MU = [1.2, 2.0];                                                                    // only two rows state it

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana',$1,'Ana','associate') ON CONFLICT DO NOTHING", [`ana@${DOMAIN}`]);
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('b','Client B','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-b-nda','client-nda','second-party','b','B')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator,partners_only) VALUES ('lt-firm-po','firm','first-party','ATC',true)");
  for (let i = 0; i < 12; i++) {
    const own = i < 7;
    await put(own ? 'lt-firm' : 'lt-public', own ? 'own-evaluation' : 'paper', {
      play_type: 'carbonate-waterflood', lithology: 'carbonate',
      permeability_md: n(K[i], own ? 'measured' : 'reported'), net_pay_m: n(H[i], own ? 'measured' : 'reported'), porosity_frac: n(PHI[i], own ? 'measured' : 'reported'),
      ...(i < 4 ? { well_spacing_acres: n(SPACING[i]) } : {}), ...(i < 2 ? { oil_viscosity_cp: n(MU[i]) } : {}),
    });
  }
  // noise that must not move the answer
  await put('lt-firm', 'own-evaluation', { play_type: 'onshore-clastic-waterflood', permeability_md: n(1e6, 'measured') });          // other play
  await put('lt-firm', 'own-evaluation', { play_type: 'carbonate-waterflood', permeability_md: n(999999, 'analogue'), porosity_frac: n(0.9, 'assumed') });   // borrowed values
  await put('lt-b-nda', 'own-evaluation', { play_type: 'carbonate-waterflood', permeability_md: n(888888, 'measured') });               // client B's NDA
  await put('lt-firm-po', 'own-evaluation', { play_type: 'carbonate-waterflood', permeability_md: n(777777, 'measured') });            // partners only
});
after(async () => { await db.close(); });

test('percentile is linear interpolation between order statistics', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(percentile([10, 20], 0.5), 15);
  assert.ok(Math.abs(percentile([5, 8, 10], 0.1) - 5.6) < 1e-12);
  assert.equal(percentile([7], 0.9), 7);
});

test('AC3: defaults for carbonate-waterflood from 12 rows match the hand-calculated P10/P50/P90', async () => {
  const d = await defaults(db, ANA, 'firm', 'carbonate-waterflood', { now: NOW });
  assert.equal(d.n_rows, 12);
  // k: n=12, P10 at index 1.1 -> 8 + 0.1*(10-8); P50 at 5.5 -> (30+40)/2; P90 at 9.9 -> 120 + 0.9*(150-120)
  const k = d.inputs['rock.k'];
  assert.deepEqual([k.low, k.mid, k.high], [8.2, 35, 147]); assert.equal(k.n, 12);
  // net pay: metres 18.4 / 31.5 / 51.3, shown in feet because PLAYS holds rock.hFt
  const h = d.inputs['rock.hFt'];
  assert.ok(Math.abs(h.low - 18.4 * FT_PER_M) < 1e-3 && Math.abs(h.mid - 31.5 * FT_PER_M) < 1e-3 && Math.abs(h.high - 51.3 * FT_PER_M) < 1e-3, JSON.stringify(h));
  assert.ok(Math.abs(h.low - 60.37) < 0.01 && Math.abs(h.mid - 103.35) < 0.01 && Math.abs(h.high - 168.31) < 0.01, 'and in the round numbers a reader would check');
  const phi = d.inputs['rock.phi'];
  assert.deepEqual([phi.low, phi.mid, phi.high], [0.091, 0.135, 0.188]);
  // four values: P10 at 0.3 -> 40 + 0.3*20; P50 -> 70; P90 at 2.7 -> 80 + 0.7*20
  const sp = d.inputs['wells.spacingAcres'];
  assert.deepEqual([sp.low, sp.mid, sp.high, sp.n], [46, 70, 94, 4]);
  // two values are not enough to propose a range
  assert.equal(d.inputs['fluids.muo'], undefined);
  assert.deepEqual(d.insufficient.filter(x => x.path === 'fluids.muo'), [{ path: 'fluids.muo', n: 2 }]);
  assert.ok(d.insufficient.some(x => x.path === 'pressure.pres' && x.n === 0));
  for (const x of Object.values(d.inputs)) assert.ok(x.low <= x.mid && x.mid <= x.high);
});

test('counts and provenance mix, and borrowed values are excluded', async () => {
  const d = await defaults(db, ANA, 'firm', 'carbonate-waterflood', { now: NOW });
  assert.deepEqual(d.provenance, { 'own-evaluation': 7, paper: 5 });
  assert.deepEqual(d.inputs['rock.k'].provenance, { measured: 7, reported: 5 });
  assert.deepEqual(d.excluded, { analogue: 1, assumed: 1 }, 'analogue and assumed values are reported, not used');
  assert.deepEqual(d.inputs['rock.k'].static, [10, 40, 150], 'the static PLAYS values sit beside the proposal');
  assert.equal(d.scope, 'firm');
});

test('scope decides the rows: public sees only the papers, a partner also sees partners-only tags', async () => {
  const pub = await defaults(db, ANA, 'public', 'carbonate-waterflood', { now: NOW });
  assert.equal(pub.n_rows, 5); assert.deepEqual(pub.provenance, { paper: 5 });
  assert.deepEqual(pub.inputs['rock.k'].provenance, { reported: 5 });
  const partner = await defaults(db, PARTNER, 'firm', 'carbonate-waterflood', { now: NOW });
  assert.equal(partner.n_rows, 13, 'the partners-only row counts for a partner');
  assert.equal(partner.inputs['rock.k'].n, 13);
  const client = await defaults(db, PARTNER, 'client:b', 'carbonate-waterflood', { now: NOW });
  assert.equal(client.inputs['rock.k'].n, 14, 'client B sees its own NDA row');
  const fromAna = await defaults(db, ANA, 'firm', 'carbonate-waterflood', { now: NOW });
  assert.ok(fromAna.inputs['rock.k'].high < 1000, 'nothing from client B or partners-only reached the associate');
});

test('the play must be a key of js/analogues.js PLAYS, and the mapped inputs exist there', async () => {
  const { PLAYS } = await import(pathToFileURL(path.join(ROOT, 'js/analogues.js')).href);
  assert.ok(PLAYS['carbonate-waterflood']);
  for (const i of PLAY_INPUTS.filter(x => x.group !== 'fluids')) assert.ok(i.key in PLAYS['carbonate-waterflood'][i.group], i.path);
  assert.ok(PLAY_INPUTS.every(i => PLAYS['carbonate-waterflood'][i.group]?.[i.key] !== undefined), 'all six exist for a waterflood play');
  await assert.rejects(defaults(db, ANA, 'firm', 'moon-waterflood', { now: NOW }), (e: any) => e instanceof PlayError && e.status === 400);
  await assert.rejects(defaults(db, ANA, 'firm', '', { now: NOW }), PlayError);
  const gas = await defaults(db, ANA, 'firm', 'onshore-gas', { now: NOW });
  assert.equal(gas.n_rows, 0);
  assert.ok(!gas.insufficient.some(x => x.path === 'fluids.muo'), 'a gas play takes no oil viscosity');
});

test('GET /api/analogues/defaults: scope and play_type are required; unknown play is 400; audited', async () => {
  const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: ANA.email } });
  const get = async (q: string) => { const r = await app.request(`/api/analogues/defaults?${q}`); return { status: r.status, body: (await r.json()) as any }; };
  assert.equal((await get('play_type=carbonate-waterflood')).status, 400);
  assert.equal((await get('scope=firm')).status, 400);
  assert.equal((await get('scope=firm&play_type=moon')).status, 400);
  assert.equal((await get('scope=project:nope&play_type=carbonate-waterflood')).status, 403);
  const ok = await get('scope=firm&play_type=carbonate-waterflood');
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.inputs['rock.k'].low, ok.body.inputs['rock.k'].mid, ok.body.inputs['rock.k'].high], [8.2, 35, 147]);
  assert.equal(ok.body.n_rows, 12);
  const a = (await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action = 'analogue.defaults'")).rows[0].n;
  assert.equal(a, 5);
});
