/**
 * Project screening (M19). Compares a project's conditions with an entry's published operating limits.
 *   numeric    pass inside the limits, marginal within 10% of a bound, fail beyond, unknown when either side is missing
 *   environment fail when the project's setting is not in the entry's list
 *   sand       marginal one level above the entry's tolerance (low < moderate < high), fail two levels above
 *   power/rig  marginal when the entry needs reliable power or a rig and the project lacks it
 * Project fit (1–5): 1 on any fail; else 5 − 1 per marginal − 0.25 per unknown, floor 2; 3 when the entry publishes no limits.
 * Conditions may be derived from a project's figures (unit-converted); stored conditions override them key by key.
 */
import { NUMERIC_KEY_IDS, SAND_LEVELS, type Conditions, type NumericKey, type Screening } from './model.ts';

export type Result = 'pass' | 'marginal' | 'fail' | 'unknown';
export interface Check { key: string; condition: unknown; limit: unknown; result: Result; why: string }
export interface ScreenResult { verdict: Exclude<Result, 'unknown'> | 'unscreened'; fit: number; checks: Check[]; counts: Record<Result, number> }

export const MARGIN = 0.10;
const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 1000) / 1000));

export function checkNumeric(key: NumericKey, value: number | undefined, lim: { min?: number; max?: number } | undefined): Check {
  if (!lim) return { key, condition: value ?? null, limit: null, result: 'unknown', why: 'no published limit' };
  if (value === undefined || value === null || Number.isNaN(value)) return { key, condition: null, limit: lim, result: 'unknown', why: 'project value not set' };
  const span = (b: number) => Math.max(Math.abs(b) * MARGIN, 1e-9);
  if (lim.max !== undefined && value > lim.max) {
    return value <= lim.max + span(lim.max)
      ? { key, condition: value, limit: lim, result: 'marginal', why: `${fmt(value)} is just above the ${fmt(lim.max)} maximum` }
      : { key, condition: value, limit: lim, result: 'fail', why: `${fmt(value)} exceeds the ${fmt(lim.max)} maximum` };
  }
  if (lim.min !== undefined && value < lim.min) {
    return value >= lim.min - span(lim.min)
      ? { key, condition: value, limit: lim, result: 'marginal', why: `${fmt(value)} is just below the ${fmt(lim.min)} minimum` }
      : { key, condition: value, limit: lim, result: 'fail', why: `${fmt(value)} is below the ${fmt(lim.min)} minimum` };
  }
  return { key, condition: value, limit: lim, result: 'pass', why: 'within published limits' };
}

export function screen(s: Screening | undefined, c: Conditions): ScreenResult {
  const lim: any = s ?? {};
  const checks: Check[] = [];
  for (const k of NUMERIC_KEY_IDS) {
    if (lim[k] === undefined) continue;                 // limits the entry does not publish are not checked
    checks.push(checkNumeric(k, (c as any)[k], lim[k]));
  }
  if (lim.environment) {
    checks.push(!c.environment
      ? { key: 'environment', condition: null, limit: lim.environment, result: 'unknown', why: 'project setting not set' }
      : lim.environment.includes(c.environment)
        ? { key: 'environment', condition: c.environment, limit: lim.environment, result: 'pass', why: `used ${c.environment}` }
        : { key: 'environment', condition: c.environment, limit: lim.environment, result: 'fail', why: `not deployed ${c.environment} (${lim.environment.join(', ')} only)` });
  }
  if (lim.sand) {
    const tol = SAND_LEVELS.indexOf(lim.sand), have = c.sand ? SAND_LEVELS.indexOf(c.sand) : -1;
    checks.push(have < 0
      ? { key: 'sand', condition: null, limit: lim.sand, result: 'unknown', why: 'project sand production not set' }
      : have <= tol
        ? { key: 'sand', condition: c.sand, limit: lim.sand, result: 'pass', why: `tolerates ${lim.sand} sand` }
        // One level over is marginal (sand-tolerant variants and sand control exist); two levels is a fail.
        : have - tol === 1
          ? { key: 'sand', condition: c.sand, limit: lim.sand, result: 'marginal', why: `rated for ${lim.sand} sand; wells produce ${c.sand} (needs a sand-tolerant design or sand control)` }
          : { key: 'sand', condition: c.sand, limit: lim.sand, result: 'fail', why: `tolerates ${lim.sand} sand; wells produce ${c.sand}` });
  }
  if (lim.needs_power === true) {
    checks.push(c.power_reliable === false
      ? { key: 'power', condition: false, limit: 'needs reliable power', result: 'marginal', why: 'needs reliable power; project power is unreliable (backup generation or a hybrid lift needed)' }
      : { key: 'power', condition: c.power_reliable ?? null, limit: 'needs reliable power', result: c.power_reliable === true ? 'pass' : 'unknown', why: c.power_reliable === true ? 'reliable power available' : 'project power reliability not set' });
  }
  if (lim.needs_rig === true) {
    checks.push(c.rigs_available === false
      ? { key: 'rig', condition: false, limit: 'needs a workover rig', result: 'marginal', why: 'install or repair needs a rig; rigs are scarce' }
      : { key: 'rig', condition: c.rigs_available ?? null, limit: 'needs a workover rig', result: c.rigs_available === true ? 'pass' : 'unknown', why: c.rigs_available === true ? 'rigs available' : 'rig availability not set' });
  }
  const counts: Record<Result, number> = { pass: 0, marginal: 0, fail: 0, unknown: 0 };
  for (const ch of checks) counts[ch.result]++;
  const verdict = counts.fail ? 'fail' : counts.marginal ? 'marginal' : counts.pass ? 'pass' : 'unscreened';
  // No published limits at all: a neutral 3, so an unscreened entry never outranks one that passed its checks.
  const fit = !checks.length ? 3 : counts.fail ? 1 : Math.max(2, 5 - counts.marginal - 0.25 * counts.unknown);
  return { verdict, fit: Math.round(fit * 100) / 100, checks, counts };
}

/* ── conditions from project figures ─────────────────────────────────── */

export interface FigureLike { name: string; value: number; unit: string; as_of?: string | null; source_ref?: string | null; stale?: boolean }
export interface ConditionSource { value: number | string | boolean; from: 'stored' | 'figure'; ref?: string | null; as_of?: string | null; figure?: string; unit?: string }

const u = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace('°', '');
/** One rule per condition: which figure names it reads and how each unit converts. null = unit not understood. */
const RULES: Array<{ key: NumericKey; name: RegExp; convert: (v: number, unit: string) => number | null }> = [
  { key: 'depth_m', name: /depth|\btvd\b/i, convert: (v, x) => ['m', 'mtvd', 'metres', 'meters'].includes(u(x)) ? v : ['ft', 'fttvd', 'feet'].includes(u(x)) ? v * 0.3048 : null },
  { key: 'api', name: /\bapi\b|gravity/i, convert: (v, x) => ['api', 'degapi', 'deg.api'].includes(u(x)) ? v : null },
  { key: 'water_cut', name: /water.?cut|\bwc\b|\bbsw\b/i, convert: (v, x) => u(x) === '%' ? v / 100 : ['fraction', 'frac', 'v/v', '-', ''].includes(u(x)) ? v : null },
  { key: 'temperature_c', name: /temp/i, convert: (v, x) => ['c', 'degc'].includes(u(x)) ? v : ['f', 'degf'].includes(u(x)) ? (v - 32) * 5 / 9 : null },
  { key: 'gor_scf_bbl', name: /\bgor\b|gas.?oil.?ratio/i, convert: (v, x) => ['scf/bbl', 'scf/stb'].includes(u(x)) ? v : ['m3/m3', 'sm3/sm3'].includes(u(x)) ? v * 5.6146 : null },
  { key: 'viscosity_cp', name: /viscos/i, convert: (v, x) => ['cp', 'mpa.s', 'mpas', 'mpa·s'].includes(u(x)) ? v : null },
  { key: 'permeability_md', name: /perm/i, convert: (v, x) => ['md', 'millidarcy'].includes(u(x)) ? v : u(x) === 'd' ? v * 1000 : null },
  { key: 'net_pay_m', name: /net.?pay/i, convert: (v, x) => u(x) === 'm' ? v : u(x) === 'ft' ? v * 0.3048 : null },
  { key: 'salinity_ppm', name: /salinity|\btds\b/i, convert: (v, x) => ['ppm', 'mg/l'].includes(u(x)) ? v : null },
];

/** The newest non-stale figure per condition, converted; figures in units the rules do not understand are skipped. */
export function deriveConditions(figures: FigureLike[]): Record<string, ConditionSource> {
  const out: Record<string, ConditionSource & { _at: string }> = {};
  for (const f of figures) {
    if (f.stale || typeof f.value !== 'number' || !Number.isFinite(f.value)) continue;
    for (const r of RULES) {
      if (!r.name.test(f.name)) continue;
      const v = r.convert(f.value, f.unit ?? '');
      if (v === null) continue;
      const at = f.as_of ?? '';
      if (!out[r.key] || at > out[r.key]._at) out[r.key] = { value: Math.round(v * 1000) / 1000, from: 'figure', ref: f.source_ref ?? null, as_of: f.as_of ?? null, figure: f.name, unit: f.unit, _at: at };
      break;
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, { _at, ...rest }]) => [k, rest]));
}

/** Stored conditions win key by key over derived ones. Returns the merged conditions and where each came from. */
export function mergeConditions(stored: Conditions | null, derived: Record<string, ConditionSource>, storedMeta?: { set_at?: string | null }): { conditions: Conditions; sources: Record<string, ConditionSource> } {
  const sources: Record<string, ConditionSource> = { ...derived };
  for (const [k, v] of Object.entries(stored ?? {})) if (v !== undefined && v !== null) sources[k] = { value: v as any, from: 'stored', as_of: storedMeta?.set_at ?? null };
  const conditions = Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.value])) as Conditions;
  return { conditions, sources };
}
