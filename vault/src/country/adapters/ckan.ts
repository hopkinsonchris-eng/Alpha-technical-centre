/**
 * CKAN adapter for the country pack (wave 7 PR4; practice P62): `package_show` for the dataset, then one resource
 * downloaded and stored as fetched. The resource is chosen by id (`options.resource`), by format
 * (`options.resource_format`, e.g. CSV) and/or by a name pattern (`options.resource_match`); when several match the
 * most recently modified wins. The resource's `last_modified` (or the package's `metadata_modified`) is the source's
 * own date, and the package's `license_title` is recorded beside the registry's licence so a change is visible.
 *
 * datos.energia.gob.ar answers only over plain HTTP (HTTPS redirects back), so its registry entries name
 * `http://datos.energia.gob.ar` in allowed_domains explicitly; without that the first request is refused.
 */
import { parse } from 'csv-parse/sync';
import type { CountrySource } from '../types.ts';
import { RefusedError, SourceHttp, describeError, fetchedAt, isoFrom, optionsOf, result, unreachable, type AdapterContext, type AdapterResult } from './shared.ts';

export interface CkanOptions {
  /** Package id or name. */
  package?: string;
  /** The CKAN site root; default: the origin of the source URL. */
  base?: string;
  /** Resource id. */
  resource?: string;
  /** Resource format, case-insensitive (CSV, SHP, ZIP, GeoJSON). */
  resource_format?: string;
  /** A case-insensitive regular expression on the resource name. */
  resource_match?: string;
}

interface CkanResource { id?: string; name?: string; format?: string; url?: string; mimetype?: string | null; last_modified?: string | null; created?: string; state?: string; size?: number | null; description?: string }
interface CkanPackage { id?: string; name?: string; title?: string; notes?: string; license_id?: string; license_title?: string; license_url?: string; metadata_modified?: string; organization?: { title?: string; name?: string } | null; resources?: CkanResource[] }

const MIME_BY_FORMAT: Record<string, string> = { csv: 'text/csv', json: 'application/json', geojson: 'application/geo+json', zip: 'application/zip', shp: 'application/zip', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', pdf: 'application/pdf', xml: 'application/xml', txt: 'text/plain' };

export function chooseResource(resources: CkanResource[], o: CkanOptions): CkanResource | undefined {
  let pool = resources.filter(r => typeof r.url === 'string' && r.url && (r.state ?? 'active') === 'active');
  if (o.resource) return pool.find(r => r.id === o.resource);
  if (o.resource_format) pool = pool.filter(r => (r.format ?? '').toLowerCase() === o.resource_format!.toLowerCase());
  if (o.resource_match) { const re = new RegExp(o.resource_match, 'i'); pool = pool.filter(r => re.test(r.name ?? '') || re.test(r.url ?? '')); }
  return pool.sort((a, b) => (isoFrom(b.last_modified ?? b.created) ?? '').localeCompare(isoFrom(a.last_modified ?? a.created) ?? ''))[0];
}

/** Data rows in a CSV payload (records minus the header), 0 when it does not parse. */
export function countCsvRows(bytes: Buffer): number {
  try {
    const text = bytes.toString('utf8');
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
    const records = parse(text, { delimiter, bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as unknown[][];
    return Math.max(0, records.length - 1);
  } catch { return 0; }
}

export const ckanAdapter = async (source: CountrySource, ctx: AdapterContext = {}): Promise<AdapterResult> => {
  const at = fetchedAt(ctx);
  const fail = (reason: string, partial: Partial<AdapterResult> = {}) => unreachable(source, reason, ctx, { fetched_at: at, ...partial });
  const { options, error } = optionsOf(source);
  if (error) return fail(error);
  const o = options as CkanOptions;
  if (typeof o.package !== 'string' || !o.package) return fail('ckan needs options.package (the dataset id or name)');
  const http = new SourceHttp(source, ctx);
  try {
    const base = (typeof o.base === 'string' && o.base ? o.base : new URL(source.url).origin).replace(/\/$/, '');
    const showUrl = `${base}/api/3/action/package_show?id=${encodeURIComponent(o.package)}`;
    const show = await http.json<{ success?: boolean; error?: { message?: string; __type?: string }; result?: CkanPackage }>(showUrl);
    if (show.value?.success === false || !show.value?.result) return fail(`CKAN refused package '${o.package}': ${show.value?.error?.message ?? show.value?.error?.__type ?? 'no result'}`);
    const pkg = show.value.result;
    const res = chooseResource(pkg.resources ?? [], o);
    if (!res?.url) {
      const wanted = [o.resource && `id ${o.resource}`, o.resource_format && `format ${o.resource_format}`, o.resource_match && `name /${o.resource_match}/`].filter(Boolean).join(', ') || 'any';
      return fail(`no resource matching ${wanted} in package '${o.package}' (${(pkg.resources ?? []).map(r => `${r.format}: ${r.name}`).join('; ') || 'no resources'})`);
    }
    const got = await http.get(res.url);
    if (got.bytes.length === 0) return fail(`empty body from ${res.url}`);
    const format = (res.format ?? '').toLowerCase();
    const mime = (res.mimetype && res.mimetype.split(';')[0].trim()) || MIME_BY_FORMAT[format] || (got.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
    const stated = pkg.license_title ?? pkg.license_id ?? '';
    if (stated && stated !== source.licence) ctx.onWarn?.(`${source.id}: package_show states licence '${stated}', the registry says '${source.licence}'`);
    return result(source, ctx, { fetched_at: at,
      url: res.url,
      title: `${pkg.title ?? pkg.name ?? o.package}: ${res.name ?? res.id ?? 'resource'}${res.format ? ` (${res.format})` : ''}`,
      description: pkg.notes ?? '',
      rows: format === 'csv' || mime === 'text/csv' ? countCsvRows(got.bytes) : 0,
      bytes: got.bytes, mime,
      meta: {
        package_id: pkg.id ?? null, package_name: pkg.name ?? o.package, package_show: showUrl,
        resource_id: res.id ?? null, resource_name: res.name ?? null, resource_format: res.format ?? null, resource_size: res.size ?? null,
        source_modified: isoFrom(res.last_modified) ?? isoFrom(pkg.metadata_modified), package_modified: isoFrom(pkg.metadata_modified),
        licence_stated: stated, licence_url: pkg.license_url ?? null, organisation: pkg.organization?.title ?? null,
      },
    });
  } catch (e) {
    return fail(e instanceof RefusedError ? e.message : describeError(e));
  }
};
