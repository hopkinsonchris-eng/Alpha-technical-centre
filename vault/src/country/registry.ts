/**
 * The country pack's source registry (wave 7 PR4, docs/vault-hub/wave7/05-markup.md §1.8; 04-step-changes.md P1
 * "How a pack is built", step 1). Loads and validates vault/master/country-sources.json against CountryRegistry:
 * every source has an id, a section among the ten, a url, an access kind, a licence, an attribution line and a
 * non-empty allow-list, and a fetched url's host sits inside that allow-list. `sourcesFor` gives a country its own
 * entries first, then the generic set, with a note when the country has no entry; `resolveSeries` turns a {year}
 * series into the current edition (this year, then last). Public licensed sources only (Choice Sheet D67): the
 * hosts the hard constraints exclude are refused by code. Nothing here touches the network or the database.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countryName, isCountryCode } from '../opportunities.ts';
import { isAllowedUrl } from './adapters/shared.ts';
import { SECTIONS, SECTION_IDS, type CountryRegistry, type CountrySource, type SectionId, type SourceAccess } from './types.ts';
import { alpha3 } from './iso3.ts';

export const REGISTRY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../master/country-sources.json');
export const ACCESS_KINDS: SourceAccess[] = ['html', 'pdf', 'json', 'csv', 'rss', 'arcgis', 'ckan', 'adapter'];
/** Access kinds whose url is fetched as-is, so its host must sit inside allowed_domains. */
export const FETCHED_ACCESS: SourceAccess[] = ['html', 'pdf', 'json', 'csv', 'rss'];

/* ── hosts the pack never reads (D67; 00-practice-scan-research.md hard constraints) ─────────────────────────── */
// Written without the literal host names, as the miners do, so a static scan for them stays meaningful:
// the SPE library (crawlers and scripts prohibited), IEA data (datasets are not CC BY), OpenCorporates (not free for
// commercial use) and LinkedIn (terms of use).
const BLOCKED_HOSTS: RegExp[] = [/(^|\.)onepetro\.org$/i, /(^|\.)iea\.org$/i, /(^|\.)opencorporates\.com$/i, /(^|\.)linkedin\.com$/i];
export function isBlockedHost(host: string): boolean { return BLOCKED_HOSTS.some(re => re.test(host)); }

/* ── validation ──────────────────────────────────────────────────────────────────────────────────────────────── */

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };

function sourceProblems(s: any, where: string, seen: Set<string>): string[] {
  const out: string[] = [];
  if (!s || typeof s !== 'object') return [`${where}: a source must be an object`];
  const id = isStr(s.id) ? s.id : null;
  const tag = `${where}${id ? ` "${id}"` : ''}`;
  if (!id) out.push(`${tag}: id is required`);
  else if (seen.has(id)) out.push(`${tag}: duplicate id`);
  else seen.add(id);
  if (!isStr(s.section) || !SECTION_IDS.includes(s.section as SectionId)) out.push(`${tag}: section must be one of ${SECTION_IDS.join(', ')}`);
  if (!isStr(s.access) || !ACCESS_KINDS.includes(s.access as SourceAccess)) out.push(`${tag}: access must be one of ${ACCESS_KINDS.join(', ')}`);
  if (!isStr(s.licence)) out.push(`${tag}: licence is required (as the publisher states it)`);
  if (!isStr(s.attribution)) out.push(`${tag}: attribution line is required`);
  if (!Array.isArray(s.allowed_domains) || !s.allowed_domains.length || !s.allowed_domains.every(isStr)) out.push(`${tag}: allowed_domains must name at least one domain`);
  if (!isStr(s.url)) out.push(`${tag}: url is required`);
  else if (FETCHED_ACCESS.includes(s.access)) {
    const host = hostOf(s.url);
    if (!host) out.push(`${tag}: url "${s.url}" is not a valid URL`);
    else {
      // One allow-list rule for every fetch, K's isAllowedUrl (an entry written http://host permits plain http).
      const why = Array.isArray(s.allowed_domains) && s.allowed_domains.length && s.allowed_domains.every(isStr) ? isAllowedUrl(s.url, s.allowed_domains) : null;
      if (why) out.push(`${tag}: url host ${host} is outside allowed_domains [${s.allowed_domains.join(', ')}] (${why})`);
      if (isBlockedHost(host)) out.push(`${tag}: host ${host} is never read (D67 and the hard constraints)`);
    }
  }
  if (Array.isArray(s.allowed_domains)) for (const d of s.allowed_domains) if (isStr(d) && isBlockedHost(d)) out.push(`${tag}: allowed domain ${d} is never read (D67 and the hard constraints)`);
  if (s.ttl_days !== undefined && !(Number.isInteger(s.ttl_days) && s.ttl_days > 0)) out.push(`${tag}: ttl_days must be a positive integer`);
  if (s.options !== undefined && (s.options === null || typeof s.options !== 'object' || Array.isArray(s.options))) out.push(`${tag}: options must be an object`);
  if (s.note !== undefined && typeof s.note !== 'string') out.push(`${tag}: note must be a string`);
  return out;
}

/** Everything wrong with a registry, in words; an empty list means it validates. */
export function registryProblems(reg: unknown): string[] {
  const out: string[] = [];
  const r = reg as any;
  if (!r || typeof r !== 'object') return ['registry must be an object with generic and countries'];
  if (!Array.isArray(r.generic)) out.push('generic must be an array');
  if (!r.countries || typeof r.countries !== 'object' || Array.isArray(r.countries)) out.push('countries must be an object keyed by ISO 3166-1 alpha-2 code');
  if (out.length) return out;
  const seen = new Set<string>();
  r.generic.forEach((s: any, i: number) => out.push(...sourceProblems(s, `generic[${i}]`, seen)));
  for (const [code, entry] of Object.entries<any>(r.countries)) {
    if (!isCountryCode(code)) out.push(`countries."${code}": key must be an ISO 3166-1 alpha-2 code in upper case`);
    if (!entry || typeof entry !== 'object') { out.push(`countries."${code}": must be an object`); continue; }
    if (!isStr(entry.name)) out.push(`countries."${code}": name is required`);
    if (!Array.isArray(entry.sources)) { out.push(`countries."${code}": sources must be an array`); continue; }
    const local = new Set<string>();
    entry.sources.forEach((s: any, i: number) => out.push(...sourceProblems(s, `countries.${code}[${i}]`, local)));
    for (const id of local) if (seen.has(id)) out.push(`countries.${code} "${id}": duplicate of a generic id`);
    const isSlug = (v: unknown) => typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
    if (entry.slug !== undefined && !isSlug(entry.slug)) out.push(`countries.${code}: slug must be a URL slug (lower case letters, digits and hyphens), got ${JSON.stringify(entry.slug)}`);
    if (entry.slugs !== undefined) {
      if (!entry.slugs || typeof entry.slugs !== 'object' || Array.isArray(entry.slugs)) out.push(`countries.${code}: slugs must be an object of source id to slug`);
      else for (const [id, v] of Object.entries(entry.slugs)) {
        if (!seen.has(id) && !local.has(id)) out.push(`countries.${code}: slugs "${id}" names no generic or own source`);
        if (!isSlug(v)) out.push(`countries.${code}: slugs "${id}" must be a URL slug, got ${JSON.stringify(v)}`);
      }
    }
  }
  return out;
}

export function parseRegistry(raw: unknown): CountryRegistry {
  const problems = registryProblems(raw);
  if (problems.length) throw new Error(`country-sources registry is invalid:\n${problems.join('\n')}`);
  return raw as CountryRegistry;
}
export function loadRegistry(file = REGISTRY_PATH): CountryRegistry { return parseRegistry(JSON.parse(readFileSync(file, 'utf8'))); }

/* ── per country ─────────────────────────────────────────────────────────────────────────────────────────────── */

export interface ResolvedCountry {
  country: string;
  name: string;
  regulator: string | null;
  accounts_note: string | null;
  seeded_by_hand: boolean;
  /** The country's own entries first, then the generic set, each with {cc}, {cc_lower}, {cc3} and {country} filled; a {year} series stays a series. */
  sources: CountrySource[];
  /** Set when the country has no entry of its own. */
  note: string | null;
}

/** The ISO name as a URL slug: lower case, diacritics stripped, anything else a hyphen. */
export function countrySlug(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function fillPlaceholders(url: string, c: { code: string; name: string; /** the slug the sites use, when the display name is not it */ slug?: string }): string {
  return url.replace(/\{cc\}/g, c.code).replace(/\{cc_lower\}/g, c.code.toLowerCase()).replace(/\{cc3\}/g, alpha3(c.code) ?? c.code).replace(/\{country\}/g, c.slug || countrySlug(c.name));
}
function fillSource(s: CountrySource, c: { code: string; name: string; slug?: string }): CountrySource {
  const opts = s.options ? Object.fromEntries(Object.entries(s.options).map(([k, v]) => [k, typeof v === 'string' ? fillPlaceholders(v, c) : v])) : undefined;
  return { ...s, url: fillPlaceholders(s.url, c), ...(opts ? { options: opts } : {}) };
}

export function sourcesFor(reg: CountryRegistry, country: string): ResolvedCountry {
  if (!isCountryCode(country)) throw new Error(`"${country}" is not an ISO 3166-1 alpha-2 country code in capitals`);
  const entry = reg.countries[country];
  const name = entry?.name ?? countryName(country).en;
  // The entry may name the slug the sites use ("united-states"), and one per source where a site differs ("usa" at Chambers).
  const forSource = (s: CountrySource) => ({ code: country, name, slug: entry?.slugs?.[s.id] ?? entry?.slug });
  const own = (entry?.sources ?? []).map(s => fillSource(s, forSource(s)));
  const generic = reg.generic.map(s => fillSource(s, forSource(s)));
  return {
    country, name, regulator: entry?.regulator ?? null, accounts_note: entry?.accounts_note ?? null, seeded_by_hand: !!entry?.seeded_by_hand,
    sources: [...own, ...generic],
    note: entry ? null : `${name}'s regulator is not yet registered: the generic sources only (Chambers, Legal 500, EITI, ResourceContracts, GEM, EIA, JODI, PwC). Add an entry to the registry to read its regulator.`,
  };
}

/** The section's time to live, overridden per source. */
export function ttlFor(s: Pick<CountrySource, 'section' | 'ttl_days'>): number {
  return s.ttl_days ?? SECTIONS.find(x => x.id === s.section)?.ttl_days ?? 30;
}
export function sectionTtl(section: SectionId): number { return SECTIONS.find(x => x.id === section)?.ttl_days ?? 30; }

/* ── series ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export const isSeries = (url: string) => /\{year\}/.test(url);
export const editionUrl = (url: string, year: number) => url.replace(/\{year\}/g, String(year));

/**
 * A {year} series resolves to the current year's edition when it answers, else the previous year's; null when neither
 * does. `exists` is the probe (the fetch itself, in the job; a stub in tests). A url with no {year} is returned as is.
 */
export async function resolveSeries(url: string, now: Date, exists: (url: string) => Promise<boolean>): Promise<string | null> {
  if (!isSeries(url)) return url;
  const y = now.getUTCFullYear();
  for (const year of [y, y - 1]) {
    const u = editionUrl(url, year);
    if (await exists(u)) return u;
  }
  return null;
}
