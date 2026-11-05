/**
 * Technology register (M19): the shape of an entry, a project's screening conditions and the score weights.
 * Validated in-module with zod rather than as a Tier A schema in docs/vault-hub/schemas (see the spec's
 * "Contract decision"). Server fields (id, key, version, status, author, legal tag) are never taken from a body.
 */
import { z } from 'zod';

/** Application areas and the two-letter prefix their keys carry. Adding an area is a code change, on purpose. */
export const APPLICATIONS = {
  'artificial-lift':   { prefix: 'AL', label: 'Artificial lift' },
  'water-handling':    { prefix: 'WH', label: 'Produced-water handling' },
  'ior-eor':           { prefix: 'IR', label: 'Improved and enhanced oil recovery' },
  'well-intervention': { prefix: 'WI', label: 'Well intervention and production enhancement' },
  'integrity':         { prefix: 'IC', label: 'Asset integrity and corrosion' },
  'emissions-power':   { prefix: 'EP', label: 'Emissions reduction and field power' },
} as const;
export type Application = keyof typeof APPLICATIONS;
export const APPLICATION_IDS = Object.keys(APPLICATIONS) as Application[];
export const applicationOfKey = (key: string): Application | undefined =>
  APPLICATION_IDS.find(a => key.startsWith(APPLICATIONS[a].prefix));

export const KEY_RE = /^[A-Z]{2}[0-9]{2,3}$/;
export const TIERS = ['E1', 'E2', 'E3', 'E4'] as const;            // E5 (marketing, no data) is never citable
const VAULT_REF_RE = /^(doc|run):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const source = z.string().max(1000).refine(s => /^https?:\/\/\S+$/i.test(s) || VAULT_REF_RE.test(s), 'must be an http(s) URL or doc:/run:<uuid>');
const score = z.number().int().min(1).max(5);
const range = z.object({ min: z.number().optional(), max: z.number().optional() }).strict()
  .refine(r => r.min !== undefined || r.max !== undefined, 'give min, max or both')
  .refine(r => r.min === undefined || r.max === undefined || r.min <= r.max, 'min must not exceed max');

/** Numeric screening keys, their unit and what a project condition of that key means. */
export const NUMERIC_KEYS = {
  depth_m:         'm (true vertical depth)',
  rate_bpd:        'bbl/d liquid per well (per unit for facilities)',
  temperature_c:   '°C (bottomhole or process)',
  api:             '°API',
  viscosity_cp:    'cP (reservoir oil)',
  water_cut:       'fraction 0–1',
  gor_scf_bbl:     'scf/bbl',
  permeability_md: 'mD',
  net_pay_m:       'm',
  deviation_deg:   'degrees from vertical',
  salinity_ppm:    'ppm TDS',
} as const;
export type NumericKey = keyof typeof NUMERIC_KEYS;
export const NUMERIC_KEY_IDS = Object.keys(NUMERIC_KEYS) as NumericKey[];
export const ENVIRONMENTS = ['onshore', 'shallow-water', 'offshore', 'subsea'] as const;
export const SAND_LEVELS = ['low', 'moderate', 'high'] as const;

export type Screening = Partial<Record<NumericKey, { min?: number; max?: number }>> & {
  environment?: Array<typeof ENVIRONMENTS[number]>; sand?: typeof SAND_LEVELS[number]; needs_power?: boolean; needs_rig?: boolean;
};
const screeningShape: Record<string, z.ZodTypeAny> = Object.fromEntries(NUMERIC_KEY_IDS.map(k => [k, range.optional()]));
export const Screening = z.object({
  ...screeningShape,
  environment: z.array(z.enum(ENVIRONMENTS)).min(1).optional(),
  sand: z.enum(SAND_LEVELS).optional().describe('the most sand the technology tolerates'),
  needs_power: z.boolean().optional(),
  needs_rig: z.boolean().optional(),
}).strict() as unknown as z.ZodType<Screening>;

export const Evidence = z.object({
  claim: z.string().min(1).max(1200),
  tier: z.enum(TIERS),
  who: z.string().max(300).optional(),
  source,
  abstract_only: z.boolean().optional().describe('read as an abstract or excerpt only: check before quoting to a client'),
}).strict();

export const Provider = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().max(1000).optional(),
  adipec_2026: z.object({ hall: z.string().max(40).optional(), stand: z.string().max(40).optional(), country: z.string().max(80).optional() }).strict().optional(),
}).strict();

/** The body a caller posts (and the `record` column holds). */
export const EntryBody = z.object({
  key: z.string().regex(KEY_RE).optional().describe('give an existing key to propose a revision; omit for a new entry'),
  application: z.enum(APPLICATION_IDS as [Application, ...Application[]]),
  name: z.string().min(3).max(200),
  summary: z.string().min(10).max(1500),
  readiness: z.number().int().min(1).max(4),
  operating_window: z.record(z.string(), z.string().max(1500).nullable()).optional(),
  screening: Screening.default({}),
  capex: z.string().max(1500).nullable().optional(),
  capex_source: source.nullable().optional(),
  opex: z.string().max(1500).nullable().optional(),
  opex_source: source.nullable().optional(),
  evidence: z.array(Evidence).min(1).max(12),
  providers: z.array(Provider).max(60).default([]),
  scores: z.object({ capex: score, opex: score, benefit: score, evidence: score }).strict(),
  reference_fit: z.object({ score, reason: z.string().max(600), case: z.string().max(80).default('maracaibo') }).strict().optional(),
  rationale: z.string().max(800).optional(),
  caveats: z.string().max(2500).optional(),
  citation_query: z.string().max(600).optional().describe('Semantic Scholar bulk-search syntax; used by the monthly count'),
  note: z.string().max(400).optional().describe('why this version'),
}).strict();
export type EntryBody = z.infer<typeof EntryBody>;

/** A project's conditions: the same numeric keys as screening, as single values, plus the categorical facts. */
export type Conditions = Partial<Record<NumericKey, number>> & {
  environment?: typeof ENVIRONMENTS[number]; sand?: typeof SAND_LEVELS[number]; power_reliable?: boolean; rigs_available?: boolean;
};
const condShape: Record<string, z.ZodTypeAny> = Object.fromEntries(NUMERIC_KEY_IDS.map(k => [k, z.number().finite().optional()]));
export const Conditions = z.object({
  ...condShape,
  environment: z.enum(ENVIRONMENTS).optional(),
  sand: z.enum(SAND_LEVELS).optional().describe('how much sand the wells produce'),
  power_reliable: z.boolean().optional(),
  rigs_available: z.boolean().optional(),
}).strict() as unknown as z.ZodType<Conditions>;

export const Weights = z.object({
  citation: z.number().min(0).max(1),
  cost_benefit: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
  fit: z.number().min(0).max(1),
}).strict().refine(w => w.citation + w.cost_benefit + w.evidence + w.fit > 0, 'weights must not all be zero');
export type Weights = z.infer<typeof Weights>;
export const DEFAULT_WEIGHTS: Weights = { citation: 0.20, cost_benefit: 0.35, evidence: 0.20, fit: 0.25 };

/** zod issue path → the JSON-pointer style the API's 400s carry ('/evidence/0/source'). */
export function issuePath(e: z.ZodError): { path: string; message: string } {
  const i: any = e.issues[0];
  const segs = [...(i?.path ?? []).map(String), ...(i?.code === 'unrecognized_keys' && i.keys?.length ? [String(i.keys[0])] : [])];
  const p = '/' + segs.join('/');
  return { path: p === '/' ? '/' : p, message: i?.message ?? 'invalid' };
}
