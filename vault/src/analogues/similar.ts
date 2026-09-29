/**
 * Find similar (M16). Two parts:
 *
 *  1. `analogueVisibility`: the legal-tag predicate over analogue_rows. It is the
 *     M12 chunk predicate (gateway/scope.ts buildPredicate) restated for a table
 *     that has a legal_tag but no project or client column of its own. It is
 *     applied INSIDE the query, so a row outside the caller's scope is never
 *     ranked, counted or returned:
 *       - the tag must be unexpired, never a multi-client (conflict) tag, and
 *         partners-only tags only for partners;
 *       - public scope sees public tags, firm sees public + firm, client/project
 *         scope adds that client's client-nda tags (associates only for projects
 *         they are members of; the project is the source run's or document's);
 *       - a row whose source run is hidden or superseded, or whose source
 *         document is hidden, is not current and is never seen.
 *  2. `similar`: Gower-style distance. Every attribute both rows carry counts
 *     once, on a 0..1 scale, and the distance is their mean.
 *       numeric      |z(a) - z(b)| / 3, capped at 1, z-scored against the rows in
 *                    scope (log10 first for the properties that span decades);
 *       categorical  0 when equal, CATEGORY_PENALTY when different
 *                    (lithology, drive_mechanism, fluid_type, environment).
 *     Only descriptors are compared (setting, rock, fluid, pressure, spacing);
 *     outcomes (recovery, EUR, NPV) are what an analogue is used to predict, so
 *     they never drive the distance.
 */
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { resolveScope, type Predicate, type ProjectInfo, type ResolvedScope } from '../gateway/scope.ts';

export const SIMILARITY_NUMERIC = [
  'depth_m', 'net_pay_m', 'porosity_frac', 'permeability_md', 'water_saturation_frac', 'api_gravity', 'oil_viscosity_cp',
  'gor_scf_stb', 'initial_pressure_psi', 'temperature_c', 'area_km2', 'well_spacing_acres',
] as const;
export const LOG_SCALED = new Set<string>(['permeability_md', 'oil_viscosity_cp', 'gor_scf_stb', 'area_km2']);
export const SIMILARITY_CATEGORICAL = ['lithology', 'drive_mechanism', 'fluid_type', 'environment'] as const;
export const CATEGORY_PENALTY = 1;
export const Z_CAP = 3;
export const MIN_SHARED = 2;

export type ScopeInput = string | ResolvedScope;
export interface AnalogueRowRecord { id: string; source_ref: string; asset_id: string; legal_tag: string; provenance: string; as_of: string; [k: string]: any }

export async function loadProjectInfos(db: Db): Promise<Map<string, ProjectInfo>> {
  return new Map((await db.query<any>('SELECT id, client_id, members FROM projects')).rows.map(r => [r.id, { id: r.id, client_id: r.client_id, members: r.members ?? [] }]));
}

export async function toScope(db: Db, scope: ScopeInput, person: Person): Promise<{ scope: ResolvedScope; projects: Map<string, ProjectInfo> }> {
  const projects = await loadProjectInfos(db);
  return { projects, scope: scope && typeof scope === 'object' ? scope : resolveScope(scope as string | undefined, person, projects) };
}

/** The project a row's source belongs to, for the associate membership rule. */
const SOURCE_PROJECT = `COALESCE((SELECT r.project_id FROM runs r WHERE a.source_ref = 'run:' || r.id::text), (SELECT i.project_id FROM items i WHERE a.source_ref = 'doc:' || i.id::text))`;

/** SQL terms over analogue_rows `a` joined to legal_tags `lt` (a.legal_tag = lt.id). `start` is the first positional parameter. */
export function analogueVisibility(scope: ResolvedScope, person: Person, now: Date, projects: Map<string, ProjectInfo>, start = 1): Predicate {
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${start + params.length - 1}`; };
  const today = now.toISOString().slice(0, 10);
  const terms: string[] = [
    `(lt.expires_at IS NULL OR lt.expires_at >= ${p(today)}::date)`,
    "(lt.client_id IS NULL OR lt.client_id NOT LIKE '%+%')",
    "NOT EXISTS (SELECT 1 FROM runs r WHERE a.source_ref = 'run:' || r.id::text AND (r.hidden OR r.status = 'superseded'))",
    "NOT EXISTS (SELECT 1 FROM items i WHERE a.source_ref = 'doc:' || i.id::text AND i.hidden)",
  ];
  if (person.role !== 'partner') terms.push('NOT lt.partners_only');
  const isPublic = "lt.classification = 'public'";
  const isFirm = "lt.classification = 'firm'";
  switch (scope.kind) {
    case 'public': terms.push(isPublic); break;
    case 'firm': terms.push(`(${isPublic} OR ${isFirm})`); break;
    case 'client':
    case 'project': {
      const cid = scope.client_id;
      if (!cid) { terms.push(`(${isPublic} OR ${isFirm})`); break; }
      let nda = `(lt.classification = 'client-nda' AND lt.client_id = ${p(cid)})`;
      if (person.role !== 'partner') {
        const mine = [...projects.values()].filter(x => x.client_id === cid && x.members.includes(person.id)).map(x => x.id);
        nda = `(${nda} AND (${SOURCE_PROJECT}) = ANY(${p(mine)}::text[]))`;
      }
      terms.push(`(${isPublic} OR ${isFirm} OR ${nda})`);
      break;
    }
  }
  return { sql: terms.map(t => `(${t})`).join(' AND '), params };
}

export interface VisibleOptions { now?: Date; asset?: string; provenance?: string; play_type?: string; limit?: number }

/** Every row the caller may see in `scope`, newest first. */
export async function visibleRows(db: Db, person: Person, scope: ScopeInput, opts: VisibleOptions = {}): Promise<{ rows: AnalogueRowRecord[]; scope: ResolvedScope }> {
  const s = await toScope(db, scope, person);
  const pred = analogueVisibility(s.scope, person, opts.now ?? new Date(), s.projects, 1);
  const params = [...pred.params];
  const where = [pred.sql];
  for (const [col, v] of [['a.asset_id', opts.asset], ['a.provenance', opts.provenance]] as const) if (v) { params.push(v); where.push(`${col} = $${params.length}`); }
  if (opts.play_type) { params.push(opts.play_type); where.push(`a.row->>'play_type' = $${params.length}`); }
  const limit = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const rows = (await db.query<{ row: AnalogueRowRecord }>(
    `SELECT a.row FROM analogue_rows a JOIN legal_tags lt ON lt.id = a.legal_tag WHERE ${where.join(' AND ')} ORDER BY a.as_of DESC, a.id${limit}`, params)).rows.map(r => r.row);
  return { rows, scope: s.scope };
}

/* ── distance ───────────────────────────────────────────────────────── */

/** A property's number: a {value} object or a bare number. */
export const valueOf = (row: any, prop: string): number | undefined => {
  const v = row?.[prop];
  const n = typeof v === 'number' ? v : v && typeof v === 'object' ? v.value : undefined;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const scale = (prop: string, v: number): number | undefined => LOG_SCALED.has(prop) ? (v > 0 ? Math.log10(v) : undefined) : v;

export interface Driver { property: string; kind: 'numeric' | 'categorical'; a: number | string; b: number | string; dissimilarity: number; share: number }
export interface SimilarHit { row: AnalogueRowRecord; source_ref: string; legal_tag: string; distance: number; shared: number; drivers: Driver[]; contributions: Driver[] }

export interface PopulationStats { [prop: string]: { mean: number; sd: number; n: number } }
export function populationStats(rows: any[]): PopulationStats {
  const out: PopulationStats = {};
  for (const prop of SIMILARITY_NUMERIC) {
    const xs = rows.map(r => valueOf(r, prop)).map(v => v === undefined ? undefined : scale(prop, v)).filter((v): v is number => v !== undefined);
    if (!xs.length) continue;
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);   // population sd
    out[prop] = { mean, sd, n: xs.length };
  }
  return out;
}

/** Distance between two rows against a population, or null when they share fewer than MIN_SHARED attributes. */
export function distanceBetween(a: any, b: any, stats: PopulationStats): Omit<SimilarHit, 'row' | 'source_ref' | 'legal_tag'> | null {
  const parts: Omit<Driver, 'share'>[] = [];
  for (const prop of SIMILARITY_NUMERIC) {
    const va = valueOf(a, prop), vb = valueOf(b, prop), st = stats[prop];
    if (va === undefined || vb === undefined || !st) continue;
    const sa = scale(prop, va), sb = scale(prop, vb);
    if (sa === undefined || sb === undefined) continue;
    const dz = st.sd > 0 ? Math.abs(sa - sb) / st.sd : 0;
    parts.push({ property: prop, kind: 'numeric', a: va, b: vb, dissimilarity: Math.min(dz, Z_CAP) / Z_CAP });
  }
  for (const prop of SIMILARITY_CATEGORICAL) {
    const va = a?.[prop], vb = b?.[prop];
    if (typeof va !== 'string' || typeof vb !== 'string') continue;
    parts.push({ property: prop, kind: 'categorical', a: va, b: vb, dissimilarity: va === vb ? 0 : CATEGORY_PENALTY });
  }
  if (parts.length < MIN_SHARED) return null;
  const total = parts.reduce((s, p) => s + p.dissimilarity, 0);
  const contributions: Driver[] = parts.map(p => ({ ...p, share: total > 0 ? p.dissimilarity / total : 0 })).sort((x, y) => y.dissimilarity - x.dissimilarity || x.property.localeCompare(y.property));
  return { distance: total / parts.length, shared: parts.length, contributions, drivers: contributions.filter(c => c.dissimilarity > 0).slice(0, 3) };
}

export interface SimilarTarget { asset_id?: string; row?: Record<string, any> }

/**
 * The k rows nearest to a target, inside `scope`. The target is an asset id (its newest visible row) or a row.
 * Rows of the target's own asset are left out. Throws {status:404} when the asset has no row in scope and {status:400} for a bad target.
 */
export async function similar(db: Db, person: Person, scope: ScopeInput, target: SimilarTarget, k = 10, opts: { now?: Date } = {}): Promise<{ target: Record<string, any>; hits: SimilarHit[]; population: number }> {
  if (!target || (!target.asset_id && !target.row)) throw Object.assign(new Error('give an asset_id or a row'), { status: 400 });
  const kk = Math.max(1, Math.min(50, Math.floor(k) || 10));
  const { rows } = await visibleRows(db, person, scope, { now: opts.now });
  let ref: Record<string, any> | undefined = target.row;
  if (!ref) {
    ref = rows.find(r => r.asset_id === target.asset_id);   // newest first
    if (!ref) throw Object.assign(new Error(`no analogue row for asset ${target.asset_id} in this scope`), { status: 404 });
  }
  const own = target.asset_id ?? ref.asset_id;
  const pool = rows.filter(r => r.id !== ref!.id && !(own && r.asset_id === own));
  const stats = populationStats([...rows, ...(target.row ? [target.row] : [])]);
  const hits: SimilarHit[] = [];
  for (const r of pool) {
    const d = distanceBetween(ref, r, stats);
    if (d) hits.push({ row: r, source_ref: r.source_ref, legal_tag: r.legal_tag, ...d });
  }
  hits.sort((x, y) => x.distance - y.distance || x.row.id.localeCompare(y.row.id));
  return { target: ref, hits: hits.slice(0, kk), population: rows.length };
}
