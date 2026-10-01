/**
 * Opportunity fields on a project (wave 2). Shared by project.create,
 * project.update and the countries summary so the rules are stated once:
 * country is ISO 3166-1 alpha-2, coordinates are in range, the stage is one
 * of the register's stages plus the three closing ones, and the register
 * block is a plain object of summary fields the Hub shows.
 */
import { bad } from './api/common.ts';

export const STAGES = ['Initial screen', 'Qualified', 'Technical review', 'Commercial review', 'Negotiation', 'Won', 'Lost', 'Closed'] as const;
export type Stage = typeof STAGES[number];
export const DEFAULT_STAGE: Stage = 'Initial screen';

export interface StageChange { stage: string; at: string; by: string }

/** Register summary fields the Hub shows; anything else in the block is kept but not interpreted. */
export const REGISTER_FIELDS = ['source', 'current', 'plan', 'risk', 'risk_score', 'attractiveness', 'thesis', 'next', 'owner', 'risks'] as const;

const COUNTRY_RE = /^[A-Z]{2}$/;
const displayNames = new Map<string, Intl.DisplayNames>();
function names(lang: string): Intl.DisplayNames {
  let d = displayNames.get(lang);
  if (!d) { d = new Intl.DisplayNames([lang], { type: 'region', fallback: 'code' }); displayNames.set(lang, d); }
  return d;
}

/** Bilingual country name for an ISO alpha-2 code; the code itself when ICU does not know it. */
export function countryName(code: string): { en: string; es: string } {
  return { en: names('en').of(code) ?? code, es: names('es').of(code) ?? code };
}

/** True when the code is two capitals and ICU knows it as a region (so "XX" is refused). */
export function isCountryCode(code: unknown): code is string {
  if (typeof code !== 'string' || !COUNTRY_RE.test(code)) return false;
  try { return names('en').of(code) !== code; } catch { return false; }
}

export interface OpportunityPatch { country?: string | null; lat?: number | null; lon?: number | null; stage?: Stage; register?: Record<string, unknown> }

/**
 * Validate the opportunity fields present in `b` (absent keys are left out of
 * the result; null clears country or coordinates). Throws 400 with the JSON
 * path of the first bad field.
 */
export function readOpportunityFields(b: Record<string, unknown>): OpportunityPatch {
  const out: OpportunityPatch = {};
  if (b.country !== undefined) {
    if (b.country === null) out.country = null;
    else if (!isCountryCode(b.country)) throw bad('country must be an ISO 3166-1 alpha-2 code in capitals (e.g. "CO")', '/country');
    else out.country = b.country;
  }
  for (const [k, lim] of [['lat', 90], ['lon', 180]] as const) {
    const v = b[k];
    if (v === undefined) continue;
    if (v === null) { out[k] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > lim) throw bad(`${k} must be a number between -${lim} and ${lim}`, `/${k}`);
    out[k] = v;
  }
  if (b.stage !== undefined) {
    if (typeof b.stage !== 'string' || !(STAGES as readonly string[]).includes(b.stage)) throw bad(`stage must be one of ${STAGES.join(', ')}`, '/stage');
    out.stage = b.stage as Stage;
  }
  if (b.register !== undefined) {
    if (b.register === null || typeof b.register !== 'object' || Array.isArray(b.register)) throw bad('register must be an object of summary fields', '/register');
    out.register = b.register as Record<string, unknown>;
  }
  return out;
}

export const stageEntry = (stage: string, by: string, at: Date): StageChange => ({ stage, at: at.toISOString(), by });
