/**
 * The country pack's generic adapters (wave 7 PR4, builder K). The job (J) calls `runAdapter(source, ctx)` for every
 * registry source whose `access` is one of `arcgis`, `ckan` or `csv`, and stores the result's `bytes` as the immutable
 * original with its `url`, `fetched_at`, `attribution`, `licence` and `meta.source_modified`. `html`, `pdf`, `json` and
 * `rss` sources are fetched as-is by the job itself; `adapter` names a bespoke fetcher the job owns.
 *
 * Every adapter takes an injectable fetch and clock, refuses any URL outside the source's allowed_domains before a
 * request is made, and never throws on a network error: it reports `unreachable` with the reason.
 */
import type { CountrySource, SourceAccess } from '../types.ts';
import { arcgisAdapter } from './arcgis.ts';
import { ckanAdapter } from './ckan.ts';
import { csvAdapter } from './csv.ts';
import { describeError, unreachable, type AdapterContext, type AdapterResult, type CountryAdapter } from './shared.ts';

export type { AdapterContext, AdapterResult, CountryAdapter } from './shared.ts';
export { isAllowedUrl } from './shared.ts';
export { arcgisAdapter, resolveDcatLayer } from './arcgis.ts';
export { ckanAdapter } from './ckan.ts';
export { csvAdapter } from './csv.ts';

export type AdapterAccess = Extract<SourceAccess, 'arcgis' | 'ckan' | 'csv'>;

export const ADAPTERS: Record<AdapterAccess, CountryAdapter> = { arcgis: arcgisAdapter, ckan: ckanAdapter, csv: csvAdapter };

export const adapterFor = (access: SourceAccess | string): CountryAdapter | undefined =>
  Object.prototype.hasOwnProperty.call(ADAPTERS, access) ? ADAPTERS[access as AdapterAccess] : undefined;

/** Run the adapter the source's `access` names. Never throws: an unknown access or an adapter fault is `unreachable`. */
export async function runAdapter(source: CountrySource, ctx: AdapterContext = {}): Promise<AdapterResult> {
  const adapter = adapterFor(source.access);
  if (!adapter) return unreachable(source, `no adapter for access '${source.access}' (the job fetches html, pdf, json and rss itself)`, ctx);
  try { return await adapter(source, ctx); }
  catch (e) { return unreachable(source, describeError(e), ctx); }
}
