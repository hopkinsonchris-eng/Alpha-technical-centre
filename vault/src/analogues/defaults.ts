/**
 * Proposed analogue defaults (M16). For a play type in js/analogues.js PLAYS,
 * low / mid / high for each input the play carries, read from the analogue rows
 * in the caller's scope that name that play:
 *
 *   permeability_md      -> rock.k              (md)
 *   net_pay_m            -> rock.hFt            (metres to feet)
 *   porosity_frac        -> rock.phi
 *   oil_viscosity_cp     -> fluids.muo          (waterflood plays only)
 *   initial_pressure_psi -> pressure.pres
 *   well_spacing_acres   -> wells.spacingAcres
 *
 * low / mid / high are the P10 / P50 / P90 of the values (linear interpolation
 * between order statistics, the spreadsheet PERCENTILE.INC rule), so low <= mid <= high
 * whatever the property, matching how PLAYS lists its rock ranges.
 *
 * A value borrowed from an analogue default or simply assumed is not evidence
 * about the play, and using it would feed the static defaults back to themselves,
 * so only measured, reported, client-stated and calculated values count. Each
 * input carries its count and the provenance mix of what went in; an input with
 * fewer than MIN_N values is reported under `insufficient` rather than proposed.
 * Nothing here writes: the tool shows the overlay with its count and a partner
 * decides whether to use it.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { visibleRows, valueOf, type ScopeInput } from './similar.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const MIN_N = 3;
const FT_PER_M = 1 / 0.3048;

export interface PlayInput { property: string; path: string; group: string; key: string; factor: number; triple: boolean; unit: string }
/** `triple` inputs are [low, mid, high] in PLAYS; the others are one number, for which the overlay carries the mid. */
export const PLAY_INPUTS: PlayInput[] = [
  { property: 'permeability_md', path: 'rock.k', group: 'rock', key: 'k', factor: 1, triple: true, unit: 'md' },
  { property: 'net_pay_m', path: 'rock.hFt', group: 'rock', key: 'hFt', factor: FT_PER_M, triple: true, unit: 'ft' },
  { property: 'porosity_frac', path: 'rock.phi', group: 'rock', key: 'phi', factor: 1, triple: true, unit: 'fraction' },
  { property: 'oil_viscosity_cp', path: 'fluids.muo', group: 'fluids', key: 'muo', factor: 1, triple: false, unit: 'cp' },
  { property: 'initial_pressure_psi', path: 'pressure.pres', group: 'pressure', key: 'pres', factor: 1, triple: false, unit: 'psi' },
  { property: 'well_spacing_acres', path: 'wells.spacingAcres', group: 'wells', key: 'spacingAcres', factor: 1, triple: false, unit: 'acres' },
];
const COUNTED = new Set(['measured', 'reported', 'client-stated', 'calculated']);

let plays: Record<string, any> | null | undefined;
/** js/analogues.js PLAYS, or null when the file cannot be loaded (then any play key is accepted). */
export async function loadPlays(): Promise<Record<string, any> | null> {
  if (plays !== undefined) return plays;
  try { plays = (await import(pathToFileURL(path.join(REPO_ROOT, 'js/analogues.js')).href)).PLAYS ?? null; } catch { plays = null; }
  return plays!;
}

/** Percentile p (0..1) of ascending xs, linear interpolation between order statistics. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const sig = (v: number, digits = 6) => Number(v.toPrecision(digits));

export interface InputDefault {
  property: string; path: string; unit: string; low: number; mid: number; high: number; n: number;
  provenance: Record<string, number>; static?: number | [number, number, number];
}
export interface DefaultsResult {
  play_type: string; scope: string; n_rows: number; min_n: number;
  inputs: Record<string, InputDefault>; insufficient: { path: string; n: number }[];
  provenance: Record<string, number>; excluded: Record<string, number>;
}
export class PlayError extends Error { status = 400 as const; }

export async function defaults(db: Db, person: Person, scope: ScopeInput, play_type: string, opts: { now?: Date; minN?: number } = {}): Promise<DefaultsResult> {
  if (!play_type) throw new PlayError('play_type is required');
  const known = await loadPlays();
  if (known && !known[play_type]) throw new PlayError(`unknown play_type "${play_type}"; one of ${Object.keys(known).join(', ')}`);
  const minN = opts.minN ?? MIN_N;
  const { rows, scope: resolved } = await visibleRows(db, person, scope, { now: opts.now, play_type });
  const inputs: Record<string, InputDefault> = {};
  const insufficient: DefaultsResult['insufficient'] = [];
  const excluded: Record<string, number> = {};
  const used = new Set<string>();

  for (const inp of PLAY_INPUTS) {
    const play = known?.[play_type];
    if (play && !(play[inp.group] && inp.key in play[inp.group])) continue;   // the play does not take this input (e.g. gas plays have no oil viscosity)
    const vals: number[] = []; const mix: Record<string, number> = {};
    for (const r of rows) {
      const v = valueOf(r, inp.property);
      if (v === undefined) continue;
      const prov: string = r[inp.property]?.provenance ?? 'reported';
      if (!COUNTED.has(prov)) { excluded[prov] = (excluded[prov] ?? 0) + 1; continue; }
      vals.push(v * inp.factor); mix[prov] = (mix[prov] ?? 0) + 1; used.add(r.id);
    }
    if (vals.length < minN) { insufficient.push({ path: inp.path, n: vals.length }); continue; }
    vals.sort((a, b) => a - b);
    const p = play?.[inp.group]?.[inp.key];
    inputs[inp.path] = {
      property: inp.property, path: inp.path, unit: inp.unit, low: sig(percentile(vals, 0.1)), mid: sig(percentile(vals, 0.5)), high: sig(percentile(vals, 0.9)),
      n: vals.length, provenance: mix, ...(p !== undefined ? { static: p } : {}),
    };
  }
  // Row-level mix: which kinds of source the proposal rests on.
  const counts: Record<string, number> = {};
  for (const r of rows) if (used.has(r.id)) counts[r.provenance] = (counts[r.provenance] ?? 0) + 1;
  return { play_type, scope: resolved.label, n_rows: used.size, min_n: minN, inputs, insufficient, provenance: counts, excluded };
}
