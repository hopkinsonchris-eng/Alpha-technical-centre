import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { buildCatalog } from '../src/catalog.ts';
import { runInputHash } from '../src/hash.ts';
import { validate } from '../src/schemas.ts';
import { emitForRun, emitIfEvaluation, isEvaluationTool, loadAssets, rowFromRun, rowIdForRun } from '../src/analogues/emit.ts';
import { runAnaloguesBackfill } from '../src/jobs/analogues-backfill.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOMAIN = 'alpha-technical-centre.com';
const catalog = buildCatalog(ROOT);
const fixture = (tool: string) => JSON.parse(readFileSync(path.join(ROOT, `test/e2e/fixtures/${tool}.json`), 'utf8'));
const NUM_PROV = ['measured', 'reported', 'client-stated', 'analogue', 'assumed', 'calculated'];

let db: Db;
let app: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const post = (a: typeof app, url: string, body?: unknown) => a.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/** The register captures its analogue defaults as assumptions (opportunity-register.html); this is that shape. */
const REGISTER_ASSUMPTIONS = {
  'rock.k': { value: 150, source: 'analogue', provenance: 'analogue' },
  'rock.hFt': { value: 45, unit: 'ft', source: 'analogue', provenance: 'analogue' },
  'rock.phi': { value: 0.21, source: 'analogue', provenance: 'analogue' },
  'fluids.muo': { value: 3, unit: 'cp', source: 'analogue', provenance: 'analogue' },
  'pressure.skin': { value: 2.5, source: 'analyst', provenance: 'assumed' },
};

async function saveRun(tool: string, over: Record<string, any> = {}): Promise<any> {
  const fx = fixture(tool);
  const manifest = catalog.tools.find(t => t.id === tool)!;
  const v = manifest.versions.find(x => x.version === manifest.aliases.current)!;
  const rec: any = {
    id: randomUUID(), job: tool, tool_version: v.version, tool_commit: v.commit, author: 'chris', created_at: '2026-09-20T10:00:00Z',
    project_id: 'llanos-screen', client_id: 'frontera', asset_ids: [], legal_tag: 'lt-frontera-nda-2026', title: `${tool} fixture`,
    inputs: [{ ref: `tool:${tool}`, kind: 'manual' }], assumptions: {}, params: fx.params, outputs: fx.expected, status: 'final', ...over,
  };
  rec.input_hash = runInputHash(rec);
  const res = await post(app, '/api/runs', rec);
  assert.equal(res.status, 201, await res.text());
  return rec;
}

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda-2026','client-nda','second-party','frontera','Frontera')");
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ('llanos-screen','frontera','Llanos screen','lt-frontera-nda-2026','{chris}')");
  app = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('the evaluation tools are the ones whose manifest produces an evaluation output', () => {
  const eval_ = catalog.tools.filter(isEvaluationTool).map(t => t.id).sort();
  assert.deepEqual(eval_, ['ela-model-suite', 'ela-studio', 'financial-model', 'opportunity-register']);
});

test('AC11: every evaluation run in the fixture set emits a row that validates, with provenance on each numeric', async () => {
  const runs: any[] = [];
  runs.push(await saveRun('opportunity-register', { asset_ids: ['field:llanos:cubiro'], assumptions: REGISTER_ASSUMPTIONS }));
  runs.push(await saveRun('ela-studio'));
  runs.push(await saveRun('ela-model-suite'));
  runs.push(await saveRun('financial-model'));
  for (const rec of runs) {
    const r = await emitForRun(db, rec.id);
    assert.ok(['emitted', 'replaced'].includes(r.status), `${rec.job}: ${JSON.stringify(r)}`);   // saved runs are emitted on save; a manual emit replaces
    const row = (await db.query<any>('SELECT row FROM analogue_rows WHERE id = $1', [r.row_id])).rows[0].row;
    assert.deepEqual(validate('analogue-row', row), [], `${rec.job} row validates`);
    assert.equal(row.provenance, 'own-evaluation');
    assert.equal(row.source_ref, `run:${rec.id}`);
    assert.equal(row.legal_tag, rec.legal_tag);
    const nums = Object.entries(row).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as any));
    assert.ok(nums.length > 0, `${rec.job} carries at least one numeric`);
    for (const [k, v] of nums) assert.ok(NUM_PROV.includes((v as any).provenance), `${rec.job}.${k} has provenance`);
  }
  const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM analogue_rows WHERE provenance = 'own-evaluation'")).rows[0].n;
  assert.equal(n, 4);
});

test('the register run: measured from params, analogue and assumed from assumptions, calculated from outputs', async () => {
  const rec = (await db.query<any>("SELECT id FROM runs WHERE job = 'opportunity-register'")).rows[0];
  const row = (await db.query<any>('SELECT row FROM analogue_rows WHERE source_ref = $1', [`run:${rec.id}`])).rows[0].row;
  assert.equal(row.asset_id, 'field:llanos:cubiro');
  assert.equal(row.basin_id, 'basin:llanos');
  assert.equal(row.country, 'CO');
  assert.equal(row.play_type, 'onshore-clastic-waterflood');
  assert.deepEqual([row.lithology, row.environment, row.drive_mechanism], ['clastic', 'onshore', 'waterflood']);
  // typed by the user -> measured (6000 acres = 24.28 km2; 3100 psi; 60 producers)
  assert.equal(row.initial_pressure_psi.value, 3100); assert.equal(row.initial_pressure_psi.provenance, 'measured');
  assert.equal(row.well_count.value, 60); assert.equal(row.well_count.provenance, 'measured');
  assert.ok(Math.abs(row.area_km2.value - 24.281) < 0.001); assert.equal(row.area_km2.provenance, 'measured');
  // borrowed from the play -> analogue, with feet converted to metres
  assert.equal(row.permeability_md.value, 150); assert.equal(row.permeability_md.provenance, 'analogue');
  assert.ok(Math.abs(row.net_pay_m.value - 13.716) < 1e-6); assert.equal(row.net_pay_m.provenance, 'analogue');
  // calculated from outputs, with the band
  assert.equal(row.peak_rate_bopd.provenance, 'calculated');
  assert.ok(Math.abs(row.peak_rate_bopd.value - 77581.22423408263) < 1e-3);
  assert.ok(row.peak_rate_bopd.low < row.peak_rate_bopd.value && row.peak_rate_bopd.value < row.peak_rate_bopd.high);
  assert.equal(row.extracted_by, 'chris');
});

test('financial and ELA runs without a field id use run:<id> and carry calculated economics', async () => {
  const rec = (await db.query<any>("SELECT id FROM runs WHERE job = 'financial-model'")).rows[0];
  const row = (await db.query<any>('SELECT row FROM analogue_rows WHERE source_ref = $1', [`run:${rec.id}`])).rows[0].row;
  assert.equal(row.asset_id, `run:${rec.id}`);
  assert.ok(Math.abs(row.npv10_usd_mm.value - 1038.4483601123864) < 1e-6); assert.equal(row.npv10_usd_mm.provenance, 'calculated');
  assert.ok(Math.abs(row.irr_frac.value - 0.9594799186138336) < 1e-6);
  assert.equal(row.country, undefined);
});

test('pure rowFromRun: precedence, units, asset and basin resolution', async () => {
  const assets = await loadAssets(db);
  const manifest = catalog.tools.find(t => t.id === 'opportunity-register')!;
  const run = {
    id: randomUUID(), job: 'opportunity-register', created_at: '2026-08-01T00:00:00Z', author: 'ana', legal_tag: 'lt-firm', asset_ids: ['basin:maracaibo', 'field:maracaibo:boscan'],
    params: { opportunity: { country: 'Venezuela', potentialModel: { play: 'carbonate-waterflood', measured: { 'rock.k': 200, 'rock.hFt': 100 } } } },
    assumptions: { 'rock.k': { value: 999, source: 'analogue', provenance: 'analogue' }, 'fluids.muo': { value: 12, source: 'client-stated' }, 'wells.spacingAcres': { value: 40, source: 'analyst' } },
    outputs: { irr: { value: 25, unit: '%' }, npv10: { value: 5e7, unit: 'USD' }, uplift_bopd: { value: 10 } },
  };
  const row = rowFromRun(run, manifest, assets);
  assert.deepEqual(validate('analogue-row', row), []);
  assert.equal(row.asset_id, 'field:maracaibo:boscan');                    // first field-kind id, not the basin
  assert.equal(row.basin_id, 'basin:maracaibo'); assert.equal(row.country, 'VE');
  assert.equal(row.lithology, 'carbonate');
  assert.deepEqual(row.permeability_md, { value: 200, provenance: 'measured' });   // typed beats assumption
  assert.ok(Math.abs((row.net_pay_m as any).value - 30.48) < 1e-9);
  assert.equal((row.oil_viscosity_cp as any).provenance, 'client-stated');
  assert.equal((row.well_spacing_acres as any).provenance, 'assumed');
  assert.equal((row.irr_frac as any).value, 0.25);
  assert.equal((row.npv10_usd_mm as any).value, 50);
  assert.equal(row.uplift_bopd, undefined);                                      // not a schema property: ignored
  assert.equal(row.id, rowIdForRun(run.id));
  // no field, no basin, unknown country: run:<id> and nothing invented
  const bare = rowFromRun({ ...run, asset_ids: [], params: {} }, manifest, assets);
  assert.equal(bare.asset_id, `run:${run.id}`); assert.equal(bare.basin_id, undefined); assert.equal(bare.country, undefined);
});

test('emit is idempotent: one row per run, replaced on re-emit, removed when the run is superseded', async () => {
  const rec = await saveRun('financial-model', { params: { ...fixture('financial-model').params, brent: 71 }, asset_ids: ['field:llanos:cubiro'] });
  const first = await emitForRun(db, rec.id);
  const again = await emitForRun(db, rec.id);
  assert.ok(['emitted', 'replaced'].includes(first.status)); assert.equal(again.status, 'replaced'); assert.equal(first.row_id, again.row_id);
  const count = () => db.query<{ n: number }>('SELECT count(*)::int AS n FROM analogue_rows WHERE source_ref = $1', [`run:${rec.id}`]).then(r => r.rows[0].n);
  assert.equal(await count(), 1);
  await db.query("UPDATE analogue_rows SET row = jsonb_set(row, '{notes}', '\"stale\"') WHERE id = $1", [first.row_id]);
  await emitForRun(db, rec.id);
  assert.notEqual((await db.query<any>('SELECT row->>\'notes\' AS n FROM analogue_rows WHERE id = $1', [first.row_id])).rows[0].n, 'stale', 're-emit rebuilds the row from the run');
  await db.query("UPDATE runs SET status = 'superseded' WHERE id = $1", [rec.id]);
  assert.equal((await emitForRun(db, rec.id)).status, 'skipped');
  assert.equal(await count(), 0);
});

test('emitIfEvaluation skips non-evaluation tools and never throws', async () => {
  const nodal = await saveRun('nodal-analysis');
  const r = await emitIfEvaluation(db, nodal.id);
  assert.equal(r.status, 'skipped'); assert.match(r.reason!, /does not produce evaluation outputs/);
  assert.equal((await db.query('SELECT 1 FROM analogue_rows WHERE source_ref = $1', [`run:${nodal.id}`])).rows.length, 0);
  const missing = await emitIfEvaluation(db, randomUUID());
  assert.equal(missing.status, 'skipped'); assert.match(missing.reason!, /not found/);
  const ok = await saveRun('ela-studio', { params: { ...fixture('ela-studio').params, crews: 9 } });
  assert.ok(['emitted', 'replaced'].includes((await emitIfEvaluation(db, ok.id)).status));
});

test('backfill emits rows for final runs that have none, and only those', async () => {
  const a = await saveRun('ela-model-suite', { params: { ...fixture('ela-model-suite').params, extra: 1 } });
  const b = await saveRun('opportunity-register', { params: { ...fixture('opportunity-register').params, extra: 1 }, asset_ids: ['field:llanos:cubiro'] });
  const draft = await saveRun('ela-studio', { params: { ...fixture('ela-studio').params, extra: 1 }, status: 'draft' });
  const other = await saveRun('nodal-analysis', { params: { ...fixture('nodal-analysis').params, extra: 1 } });
  // Simulate runs saved before the emit hook existed: drop their rows so the backfill has work to do.
  await db.query('DELETE FROM analogue_rows WHERE source_ref = ANY($1::text[])', [[`run:${a.id}`, `run:${b.id}`]]);
  const s = await runAnaloguesBackfill(db);
  assert.deepEqual(s.failed, []);
  const has = async (id: string) => (await db.query('SELECT 1 FROM analogue_rows WHERE source_ref = $1', [`run:${id}`])).rows.length === 1;
  assert.ok(await has(a.id)); assert.ok(await has(b.id));
  assert.ok(!(await has(draft.id)), 'a draft is not backfilled');
  assert.ok(!(await has(other.id)), 'a non-evaluation tool has no row');
  assert.ok(s.emitted >= 2 && s.skipped >= 1);
  const again = await runAnaloguesBackfill(db);
  assert.equal(again.emitted, 0, 'second pass emits nothing new');
});

test('POST /api/analogues/emit/:runId: 201 then 200, 404, and 403 outside the caller\'s scope', async () => {
  const rec = await saveRun('financial-model', { params: { ...fixture('financial-model').params, brent: 90 } });
  let r = await post(app, `/api/analogues/emit/${rec.id}`);
  assert.ok([200, 201].includes(r.status)); assert.ok(['emitted', 'replaced'].includes(((await r.json()) as any).status));
  r = await post(app, `/api/analogues/emit/${rec.id}`);
  assert.equal(r.status, 200); assert.equal(((await r.json()) as any).status, 'replaced');
  assert.equal((await post(app, `/api/analogues/emit/${randomUUID()}`)).status, 404);
  assert.equal((await post(app, '/api/analogues/emit/not-a-uuid')).status, 404);
  const nodal = await saveRun('nodal-analysis', { params: { ...fixture('nodal-analysis').params, brent: 90 } });
  r = await post(app, `/api/analogues/emit/${nodal.id}`);
  assert.equal(r.status, 200); assert.equal(((await r.json()) as any).status, 'skipped');
  // an associate who is not on the project cannot see the run, so cannot emit it
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('outsider','outsider@alpha-technical-centre.com','Outsider','associate') ON CONFLICT DO NOTHING");
  const outsider = await appFor(`outsider@${DOMAIN}`);
  assert.equal((await post(outsider, `/api/analogues/emit/${rec.id}`)).status, 403);
  const audit = (await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action = 'analogue.emit'")).rows[0].n;
  assert.ok(audit >= 5, 'every request is audited');
});
