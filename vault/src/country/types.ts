/**
 * The country opening pack (wave 7, PR4 and PR5; docs/vault-hub/wave7/05-markup.md §1.8, 04-step-changes.md P1).
 * These are the contracts the four builders share: the ten sections and their time to live, the source registry
 * (vault/master/country-sources.json), the stored-original conventions, and the shape the API and the Hub exchange.
 * Nothing here touches the network or the database.
 */

/** The ten sections, in the order the card shows them. TTLs are days; the registry may override per country. */
export const SECTIONS = [
  { id: 'legal',      ttl_days: 180, en: 'Legal framework',                es: 'Marco legal' },
  { id: 'licensing',  ttl_days: 7,   en: 'Licensing and the current round', es: 'Licencias y la ronda en curso' },
  { id: 'fiscal',     ttl_days: 90,  en: 'Fiscal terms',                    es: 'Términos fiscales' },
  { id: 'companies',  ttl_days: 30,  en: 'Who works there',                 es: 'Quién opera allí' },
  { id: 'service',    ttl_days: 180, en: 'The service industry',            es: 'La industria de servicios' },
  { id: 'regulator',  ttl_days: 180, en: 'Regulator and data room',         es: 'Regulador y sala de datos' },
  { id: 'production', ttl_days: 31,  en: 'Production, reserves and market', es: 'Producción, reservas y mercado' },
  { id: 'risk',       ttl_days: 1,   en: 'Risk and context',                es: 'Riesgo y contexto' },
  { id: 'literature', ttl_days: 30,  en: 'Technical literature',            es: 'Literatura técnica' },
  { id: 'questions',  ttl_days: 7,   en: 'What no source answered',         es: 'Lo que ninguna fuente respondió' },
] as const;
export type SectionId = typeof SECTIONS[number]['id'];
export const SECTION_IDS: SectionId[] = SECTIONS.map(s => s.id);

/** How a source is read. `html` and `pdf` are fetched and stored as-is; the adapters fetch structured data. */
export type SourceAccess = 'html' | 'pdf' | 'json' | 'csv' | 'rss' | 'arcgis' | 'ckan' | 'adapter';

/** One entry of the registry: a source for a section, in one country or generic (every country). */
export interface CountrySource {
  /** Stable id, e.g. 'chambers-oil-gas', 'nsta-licences', 'anh-areas'. */
  id: string;
  section: SectionId;
  /** The URL, or a series template with {year} resolved to the current edition at build time, or an adapter id for access 'adapter'. */
  url: string;
  access: SourceAccess;
  /** Licence as the publisher states it; required. */
  licence: string;
  /** The attribution line to carry on every chip and in the stored item; required. */
  attribution: string;
  /** Domains the fetch may touch (the provider's allowed_domains and the Http allow-list). */
  allowed_domains: string[];
  /** Overrides the section TTL for this source. */
  ttl_days?: number;
  /** Adapter-specific options (dataset ids, layer names, query parameters). */
  options?: Record<string, unknown>;
  /** A note shown on the chip when the source is known to be partial or seeded by hand. */
  note?: string;
}

export interface CountryRegistry {
  /** Sources that apply to every country (Chambers, Legal 500, EITI, ResourceContracts, GEM, EIA, JODI). */
  generic: CountrySource[];
  /** Per-country sources, keyed by ISO 3166-1 alpha-2 upper case; a country absent here gets the generic set and a note. */
  countries: Record<string, { name: string; regulator?: string; accounts_note?: string; sources: CountrySource[]; seeded_by_hand?: boolean }>;
}

/** Stored-original conventions: every fetched payload is an immutable item under project 'firm', public scope. */
export const PACK_PROJECT = 'firm';
export const PACK_LEGAL_TAG = 'lt-public';
export const PACK_ITEM_TYPE = { page: 'feed-snapshot', filing: 'regulatory-filing' } as const;
/** `extracted.kind` on every pack original, and `extracted.pack = {country, section, source_id}`. */
export const PACK_ITEM_KIND = 'country-source';
/** `origin.source` on every pack original. */
export const PACK_ORIGIN = 'country-pack';

/** One drafted sentence: both languages, cited to stored originals only. */
export interface PackSentence { en: string; es: string; cites: string[] }
export interface PackSectionBody {
  headline: { en: string; es: string } | null;
  sentences: PackSentence[];
  questions: { en: string; es: string }[];
  changed_since: { en: string; es: string }[];
}
export type PackStatus = 'fresh' | 'due' | 'stale' | 'unreachable' | 'empty';

/** What `GET /api/countries/:code/pack` returns. */
export interface PackSectionView {
  section: SectionId;
  title: { en: string; es: string };
  version: number;
  status: PackStatus;
  stale_reason: string | null;
  built_at: string;
  ttl_days: number;
  /** built_at + ttl_days, ISO date. */
  due_at: string;
  body: PackSectionBody;
  sources: { id: string; url: string; licence: string; attribution: string; fetched_at: string | null; item_id: string | null; reachable: boolean; note?: string }[];
}
export interface PackView {
  country: string;
  assembled_at: string | null;          // the newest built_at across sections, or null when no section exists
  sections: PackSectionView[];          // always ten, in SECTIONS order; a never-built section has version 0, status 'empty'
  counts: { built: number; fresh: number; due: number; stale: number; unreachable: number; empty: number };
  job: { id: number; status: 'running' | 'ok' | 'failed'; started_at: string } | null;   // the open or latest country-pack job
  spend_gbp: number;
}

/** The budget per build, pounds; PACK_BUDGET_GBP overrides. */
export const DEFAULT_PACK_BUDGET_GBP = 2;
export function packBudget(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.PACK_BUDGET_GBP);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PACK_BUDGET_GBP;
}
