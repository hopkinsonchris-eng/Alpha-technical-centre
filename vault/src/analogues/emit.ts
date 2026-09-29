/**
 * Analogue emission (M16). Every evaluation Run becomes one AnalogueRow, so our
 * own work sits in the same table as the papers M11 extracts.
 *
 * A Run is an evaluation when its tool manifest `produces` one of
 * EVALUATION_OUTPUTS (technical potential, NPV, recovery factor and the like).
 * The row is built from three sources and every numeric says which one:
 *   params       what the user entered            -> measured
 *   assumptions  what the tool or user assumed    -> analogue | assumed | client-stated | measured (as declared)
 *   outputs      what the tool calculated         -> calculated
 * When the same property appears in more than one source the earlier source
 * wins (a typed value beats an assumption beats a result).
 *
 * The paper path already exists (miners/paper-facts.ts). This file reuses its
 * schema-derived property list (`numericProperties`) so the two cannot drift,
 * and emits provenance 'own-evaluation', never 'paper'.
 *
 *   emitForRun(db, runId)        idempotent: one row per run, replaced on re-emit
 *   emitIfEvaluation(db, runId)  the hook the runs route can call after a save; never throws
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import { buildCatalog, type Catalog, type ToolManifest } from '../catalog.ts';
import { uuidFrom } from '../db/seed.ts';
import { numericProperties } from '../miners/paper-facts.ts';
import { validate, validator } from '../schemas.ts';
import { runRecord } from '../api/runs.routes.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Output names that mark a tool as an evaluation tool. */
export const EVALUATION_OUTPUTS = [
  'technical_potential_bopd', 'npv10', 'npv10_usd_mm', 'irr', 'recovery_factor', 'recovery_factor_frac',
  'eur_mmbbl', 'stoiip_mmbbl', 'breakeven_usd_bbl', 'reserves_2p_mmboe',
];

export type NumProv = 'measured' | 'reported' | 'client-stated' | 'analogue' | 'assumed' | 'calculated';
export interface Num { value: number; low?: number; high?: number; provenance: NumProv }
export interface AnalogueRow { id: string; source_ref: string; asset_id: string; as_of: string; legal_tag: string; provenance: string; [k: string]: unknown }
export interface AssetRec { id: string; kind: string; name?: string; parent_id?: string | null; country?: string | null }
export type AssetIndex = Map<string, AssetRec>;
export interface RunLike {
  id: string; job: string; created_at: string | Date; author?: string; legal_tag: string; asset_ids?: string[] | null;
  params?: any; assumptions?: any; outputs?: any;
}

export const isEvaluationTool = (m: Pick<ToolManifest, 'produces'> | null | undefined): boolean =>
  !!m?.produces?.some(p => EVALUATION_OUTPUTS.includes(p));

/* ── how a run's names map onto schema properties ───────────────────── */

const M_PER_FT = 0.3048;
const KM2_PER_ACRE = 0.00404686;

/** Register input paths (js/analogues.js) → analogue-row property, with the factor from the register's unit to the row's unit. */
export const PATH_MAP: Record<string, { property: string; factor: number }> = {
  'rock.k': { property: 'permeability_md', factor: 1 },
  'rock.hFt': { property: 'net_pay_m', factor: M_PER_FT },
  'rock.phi': { property: 'porosity_frac', factor: 1 },
  'rock.areaAcres': { property: 'area_km2', factor: KM2_PER_ACRE },
  'fluids.muo': { property: 'oil_viscosity_cp', factor: 1 },
  'pressure.pres': { property: 'initial_pressure_psi', factor: 1 },
  'wells.spacingAcres': { property: 'well_spacing_acres', factor: 1 },
  'wells.producers': { property: 'well_count', factor: 1 },
};

/** Output names that differ from the row's property name. */
const OUTPUT_MAP: Record<string, string> = {
  npv10: 'npv10_usd_mm', irr: 'irr_frac', recovery_factor: 'recovery_factor_frac',
  technical_potential_bopd: 'peak_rate_bopd', capex: 'capex_usd_mm', breakeven: 'breakeven_usd_bbl',
};

/** What a play key says about the reservoir. Categorical only; nothing here is a measurement. */
function playHints(play: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (/carbonate/.test(play)) h.lithology = 'carbonate'; else if (/clastic/.test(play)) h.lithology = 'clastic';
  if (/^onshore/.test(play)) h.environment = 'onshore';
  if (/waterflood/.test(play)) h.drive_mechanism = 'waterflood';
  return h;
}

const COUNTRY_ISO: Record<string, string> = {
  colombia: 'CO', venezuela: 'VE', brazil: 'BR', brasil: 'BR', argentina: 'AR', peru: 'PE', 'perú': 'PE', ecuador: 'EC', mexico: 'MX', 'méxico': 'MX',
  guyana: 'GY', suriname: 'SR', bolivia: 'BO', 'trinidad and tobago': 'TT', chile: 'CL', paraguay: 'PY', uruguay: 'UY',
};

/* ── asset resolution ───────────────────────────────────────────────── */

export async function loadAssets(db: Db): Promise<AssetIndex> {
  const rows = (await db.query<AssetRec>('SELECT id, kind, name, parent_id, country FROM assets')).rows;
  return new Map(rows.map(a => [a.id, a]));
}

function kindOf(id: string, assets: AssetIndex): string | undefined {
  return assets.get(id)?.kind ?? (id.startsWith('field:') ? 'field' : id.startsWith('basin:') ? 'basin' : undefined);
}
function ancestors(id: string, assets: AssetIndex): AssetRec[] {
  const out: AssetRec[] = []; const seen = new Set<string>();
  for (let cur = assets.get(id); cur && !seen.has(cur.id); cur = cur.parent_id ? assets.get(cur.parent_id) : undefined) { out.push(cur); seen.add(cur.id); }
  return out;
}

/** First field-kind id of the run (master data 'field' or 'reservoir'), else `run:<id>`; basin and country from its parents. */
export function resolveAsset(run: RunLike, assets: AssetIndex): { asset_id: string; basin_id?: string; country?: string } {
  const ids = run.asset_ids ?? [];
  const fieldId = ids.find(i => ['field', 'reservoir'].includes(kindOf(i, assets) ?? ''));
  const chain = fieldId ? ancestors(fieldId, assets) : [];
  const basinId = chain.find(a => a.kind === 'basin')?.id ?? ids.find(i => kindOf(i, assets) === 'basin');
  const country = chain.find(a => a.country)?.country ?? (basinId ? assets.get(basinId)?.country : undefined) ?? undefined;
  return { asset_id: fieldId ?? `run:${run.id}`, ...(basinId ? { basin_id: basinId } : {}), ...(country && /^[A-Z]{2}$/.test(country) ? { country } : {}) };
}

/* ── value extraction ───────────────────────────────────────────────── */

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const round = (v: number) => Math.round(v * 1e9) / 1e9;

function unitFactor(property: string, unit: unknown): number {
  const u = typeof unit === 'string' ? unit.replace(/[\s_-]/g, '').toLowerCase() : '';
  if (property === 'irr_frac' && (u === '%' || u === 'percent' || u === 'pct')) return 0.01;
  if (property.endsWith('_usd_mm')) { if (u === 'usd') return 1e-6; if (u === 'kusd' || u === 'musd_k' || u === 'thousandusd') return 1e-3; }
  return 1;
}

function scaled(n: { value: number; low?: number; high?: number }, f: number, provenance: NumProv): Num {
  const out: Num = { value: round(n.value * f), provenance };
  if (isNum(n.low) && n.low * f <= out.value) out.low = round(n.low * f);
  if (isNum(n.high) && n.high * f >= out.value) out.high = round(n.high * f);
  return out;
}
/** A bare number or a {value, low, high, unit} object. */
function asNumber(x: unknown): { value: number; low?: number; high?: number; unit?: unknown } | null {
  if (isNum(x)) return { value: x };
  if (isObj(x) && isNum(x.value)) return { value: x.value, low: isNum(x.low) ? x.low : undefined, high: isNum(x.high) ? x.high : undefined, unit: x.unit };
  return null;
}

const ASSUMPTION_PROV: Record<string, NumProv> = { measured: 'measured', 'client-stated': 'client-stated', analogue: 'analogue', assumed: 'assumed' };
function assumptionProvenance(a: any): NumProv {
  if (typeof a?.provenance === 'string' && ASSUMPTION_PROV[a.provenance]) return ASSUMPTION_PROV[a.provenance];
  if (a?.source === 'analogue') return 'analogue';
  if (a?.source === 'client-stated') return 'client-stated';
  return 'assumed';
}

const ENUMS = (): Record<string, string[]> => {
  const props = (validator('analogue-row').schema as any).properties as Record<string, any>;
  return Object.fromEntries(['environment', 'lithology', 'drive_mechanism', 'fluid_type'].map(k => [k, props[k].enum as string[]]));
};

interface Collected { nums: Map<string, Num>; play?: string; opportunityCountry?: string; categorical: Record<string, string> }

/** Reads the three sources in priority order. Unknown names are ignored: params are opaque to the vault. */
function collect(run: RunLike): Collected {
  const nums = new Map<string, Num>();
  const numeric = new Set(numericProperties());
  const put = (property: string, n: Num) => { if (numeric.has(property) && !nums.has(property)) nums.set(property, n); };
  const params = isObj(run.params) ? run.params : {};

  // 1. params: what the user typed. The Register keeps typed values in potentialModel.measured; other tools may carry schema names directly.
  const opp = isObj(params.opportunity) ? params.opportunity : undefined;
  const pm = isObj(opp?.potentialModel) ? opp!.potentialModel : undefined;
  const measured = isObj(pm?.measured) ? pm!.measured : {};
  for (const [p, v] of Object.entries(measured)) {
    const m = PATH_MAP[p]; const n = asNumber(v);
    if (m && n) put(m.property, scaled(n, m.factor, 'measured'));
  }
  for (const bag of [params, isObj(params.inputs) ? params.inputs : {}, isObj(params.reservoir) ? params.reservoir : {}]) {
    for (const [k, v] of Object.entries(bag)) { const n = asNumber(v); if (n && numeric.has(k)) put(k, scaled(n, 1, 'measured')); }
  }

  // 2. assumptions: keyed by register path or by schema name; the entry says how it is known.
  const assumptions = isObj(run.assumptions) ? run.assumptions : {};
  for (const [k, a] of Object.entries(assumptions)) {
    const n = asNumber(isObj(a) ? a : { value: a });
    if (!n) continue;
    const m = PATH_MAP[k];
    const prov = assumptionProvenance(a);
    if (m) put(m.property, scaled(n, m.factor, prov)); else if (numeric.has(k)) put(k, scaled(n, 1, prov));
  }
  // Assumptions declared for the play's own default bag (Register: potentialModel.assumed) are assumed.
  for (const [p, v] of Object.entries(isObj(pm?.assumed) ? pm!.assumed : {})) {
    const m = PATH_MAP[p]; const n = asNumber(v);
    if (m && n) put(m.property, scaled(n, m.factor, 'assumed'));
  }

  // 3. outputs: what the tool calculated.
  for (const [k, o] of Object.entries(isObj(run.outputs) ? run.outputs : {})) {
    const n = asNumber(o);
    if (!n) continue;
    const property = OUTPUT_MAP[k] ?? k;
    put(property, scaled(n, unitFactor(property, n.unit), 'calculated'));
  }

  const categorical: Record<string, string> = {};
  const play = typeof pm?.play === 'string' ? pm.play : typeof params.play_type === 'string' ? params.play_type : undefined;
  if (play) Object.assign(categorical, playHints(play));
  for (const [k, allowed] of Object.entries(ENUMS())) {
    const v = params[k] ?? (isObj(params.reservoir) ? params.reservoir[k] : undefined);
    if (typeof v === 'string' && allowed.includes(v)) categorical[k] = v;
  }
  return { nums, play, categorical, opportunityCountry: typeof opp?.country === 'string' ? opp.country : undefined };
}

/* ── the row ────────────────────────────────────────────────────────── */

/** Deterministic id: re-emitting a run addresses the same row. */
export const rowIdForRun = (runId: string): string => uuidFrom(`analogue-row:run:${runId.toLowerCase()}`);

export function rowFromRun(run: RunLike, manifest: Pick<ToolManifest, 'id' | 'produces'> & { aliases?: any }, assets: AssetIndex): AnalogueRow {
  const c = collect(run);
  const a = resolveAsset(run, assets);
  const created = run.created_at instanceof Date ? run.created_at.toISOString() : String(run.created_at);
  const row: AnalogueRow = {
    id: rowIdForRun(run.id), source_ref: `run:${run.id.toLowerCase()}`, asset_id: a.asset_id, as_of: created.slice(0, 10),
    legal_tag: run.legal_tag, provenance: 'own-evaluation',
  };
  if (a.basin_id) row.basin_id = a.basin_id;
  const country = a.country ?? (c.opportunityCountry ? COUNTRY_ISO[c.opportunityCountry.trim().toLowerCase()] : undefined);
  if (country) row.country = country;
  if (c.play) row.play_type = c.play;
  Object.assign(row, c.categorical);
  for (const [k, v] of [...c.nums.entries()].sort(([x], [y]) => x.localeCompare(y))) row[k] = v;
  row.extracted_by = run.author ?? 'vault';
  row.notes = `Emitted from ${manifest.id} run ${run.id}.` + (c.play ? ` Lithology, environment and drive are read from the play type ${c.play}, not measured.` : '');
  return row;
}

/* ── persistence ────────────────────────────────────────────────────── */

export interface EmitOptions { manifest?: ToolManifest; catalog?: () => Catalog; assets?: AssetIndex }
export interface EmitResult { status: 'emitted' | 'replaced' | 'skipped'; run_id: string; row_id?: string; reason?: string }
export class EmitError extends Error { constructor(public status: 404 | 422, message: string) { super(message); } }

let cached: { at: number; catalog: Catalog } | undefined;
function defaultCatalog(): Catalog {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), catalog: buildCatalog(REPO_ROOT) };
  return cached.catalog;
}

export async function emitForRun(db: Db, runId: string, opts: EmitOptions = {}): Promise<EmitResult> {
  const id = runId.toLowerCase();
  const found = (await db.query<any>('SELECT id, job, created_at, author, legal_tag, asset_ids, status, hidden, record FROM runs WHERE id = $1', [id])).rows[0];
  if (!found) throw new EmitError(404, `run ${id} not found`);
  const existing = (await db.query('SELECT id FROM analogue_rows WHERE id = $1', [rowIdForRun(id)])).rows.length > 0;
  // A withdrawn or superseded run is no longer an analogue: drop its row.
  if (found.hidden || found.status === 'superseded') {
    if (existing) await db.query('DELETE FROM analogue_rows WHERE id = $1', [rowIdForRun(id)]);
    return { status: 'skipped', run_id: id, reason: found.hidden ? 'run is hidden' : 'run is superseded' };
  }
  const manifest = opts.manifest ?? (opts.catalog ? opts.catalog() : defaultCatalog()).tools.find(t => t.id === found.job);
  if (!manifest) return { status: 'skipped', run_id: id, reason: `tool ${found.job} is not in the catalog` };
  if (!isEvaluationTool(manifest)) return { status: 'skipped', run_id: id, reason: `tool ${found.job} does not produce evaluation outputs` };

  const rec = runRecord({ ...found, record: found.record });
  const row = rowFromRun({ ...rec, id, created_at: found.created_at, author: found.author, legal_tag: found.legal_tag, asset_ids: found.asset_ids }, manifest, opts.assets ?? await loadAssets(db));
  const errs = validate('analogue-row', row);
  if (errs.length) throw new EmitError(422, `analogue row for run ${id} does not validate: ${errs.map(e => `${e.path} ${e.message}`).join('; ')}`);
  await db.query(
    `INSERT INTO analogue_rows (id, source_ref, asset_id, legal_tag, provenance, as_of, row) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (id) DO UPDATE SET source_ref = excluded.source_ref, asset_id = excluded.asset_id, legal_tag = excluded.legal_tag,
       provenance = excluded.provenance, as_of = excluded.as_of, row = excluded.row`,
    [row.id, row.source_ref, row.asset_id, row.legal_tag, row.provenance, row.as_of, JSON.stringify(row)]);
  return { status: existing ? 'replaced' : 'emitted', run_id: id, row_id: row.id };
}

/** For the runs route to call after a save. Non-evaluation runs are skipped; a failure is reported, never thrown, so a save cannot be broken by this. */
export async function emitIfEvaluation(db: Db, runId: string, opts: EmitOptions = {}): Promise<EmitResult> {
  try { return await emitForRun(db, runId, opts); }
  catch (e) { return { status: 'skipped', run_id: runId, reason: `emit failed: ${(e as Error).message}` }; }
}
