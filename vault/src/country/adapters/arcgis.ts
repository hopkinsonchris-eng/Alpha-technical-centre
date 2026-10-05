/**
 * ArcGIS FeatureServer / GeoServices adapter for the country pack (wave 7 PR4; practice P62). Reads one layer:
 * the layer's own metadata for `maxRecordCount` and `fields`, then `query` pages of at most that many records with
 * `resultOffset`/`resultRecordCount` up to the registry's cap (`options.max_records`, default 5,000; ANH caps a page at
 * 2,000, NSTA's hosted layers too). Geometry is left out unless `options.geometry` is true: the pack wants attributes
 * (licence, operator, status, dates); the globe can ask for polygons later.
 *
 * NSTA publishes a DCAT catalogue (`data.json`) rather than stable layer URLs, so a source may give `options.dataset`
 * (the hub's landing-page slug, the title or the identifier) with `options.catalogue`, and the layer URL is resolved
 * from the dataset's "ArcGIS GeoServices REST API" distribution at fetch time. The catalogue's `modified` is then the
 * source's own date. Every URL, resolved or not, must sit inside the source's allowed_domains.
 *
 * One page is stored exactly as fetched. Several pages are merged into one feature set (the first page's envelope with
 * every page's features and no `exceededTransferLimit`), so the stored original is always a FeatureSet document.
 */
import type { CountrySource } from '../types.ts';
import { RefusedError, SourceHttp, describeError, fetchedAt, isoFrom, optionsOf, result, stripTags, unreachable, type AdapterContext, type AdapterResult } from './shared.ts';

export const DEFAULT_MAX_RECORDS = 5000;
const DEFAULT_PAGE = 1000;

export interface ArcgisOptions {
  /** Full layer URL, …/FeatureServer/0 or …/MapServer/3. */
  layer?: string;
  /** A DCAT dataset (landing-page slug such as `UKCS-transition::ukcs-offshore-petroleum-licences-wgs84`, title, or identifier) to resolve through `catalogue`. */
  dataset?: string;
  /** The DCAT `data.json` URL. */
  catalogue?: string;
  where?: string;
  out_fields?: string[];
  order_by?: string;
  geometry?: boolean;
  /** The most records fetched across pages. */
  max_records?: number;
  /** A page smaller than the server's maxRecordCount. */
  page_size?: number;
  title?: string;
  description?: string;
}

export interface DcatDataset { identifier?: string; landingPage?: string; title?: string; description?: string; modified?: string; license?: string; distribution?: { title?: string; format?: string; accessURL?: string; downloadURL?: string; mediaType?: string }[] }
export interface DcatCatalogue { dataset?: DcatDataset[] }
export interface ResolvedLayer { layer: string; title: string; description: string; modified: string | null; licence_stated: string; landing_page: string | null }

const slug = (u: string | undefined) => (u ?? '').replace(/\/+$/, '').split('/').pop() ?? '';
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The GeoService layer behind a DCAT dataset, or undefined when the dataset is absent or has no GeoService distribution (a PDF map, an app). */
export function resolveDcatLayer(catalogue: DcatCatalogue, dataset: string): ResolvedLayer | undefined {
  const want = lc(dataset);
  const ds = (catalogue.dataset ?? []).find(d => lc(slug(d.landingPage)) === want || lc(d.identifier) === want || lc(d.title) === want || lc(d.landingPage) === want);
  if (!ds) return undefined;
  const dist = (ds.distribution ?? []).find(x => /geoservice/i.test(x.format ?? '') || /geoservice/i.test(x.title ?? '') || /\/(Feature|Map)Server\/\d+$/.test(x.accessURL ?? ''));
  const layer = dist?.accessURL ?? dist?.downloadURL;
  if (!layer || !/\/(Feature|Map)Server\/\d+\/?$/.test(layer)) return undefined;
  return { layer: layer.replace(/\/$/, ''), title: ds.title ?? '', description: ds.description ?? '', modified: isoFrom(ds.modified), licence_stated: stripTags(ds.license), landing_page: ds.landingPage ?? null };
}

function queryUrl(layer: string, o: ArcgisOptions, offset: number, count: number): string {
  const p = new URLSearchParams();
  p.set('where', o.where ?? '1=1');
  p.set('outFields', o.out_fields?.length ? o.out_fields.join(',') : '*');
  p.set('returnGeometry', o.geometry ? 'true' : 'false');
  if (o.geometry) p.set('outSR', '4326');
  if (o.order_by) p.set('orderByFields', o.order_by);
  p.set('resultOffset', String(offset));
  p.set('resultRecordCount', String(count));
  p.set('f', 'json');
  return `${layer}/query?${p.toString()}`;
}

export const arcgisAdapter = async (source: CountrySource, ctx: AdapterContext = {}): Promise<AdapterResult> => {
  const at = fetchedAt(ctx);
  const fail = (reason: string, partial: Partial<AdapterResult> = {}) => unreachable(source, reason, ctx, { fetched_at: at, ...partial });
  const { options, error } = optionsOf(source);
  if (error) return fail(error);
  const o = options as ArcgisOptions;
  const http = new SourceHttp(source, ctx);
  try {
    // 1. the layer URL, given or resolved through the catalogue
    let layer = typeof o.layer === 'string' ? o.layer.replace(/\/$/, '') : undefined;
    let resolved: ResolvedLayer | undefined;
    if (!layer) {
      if (typeof o.dataset !== 'string' || !o.dataset) return fail('arcgis needs options.layer or options.dataset with options.catalogue');
      const catalogueUrl = typeof o.catalogue === 'string' && o.catalogue ? o.catalogue : source.url;
      const cat = await http.json<DcatCatalogue>(catalogueUrl);
      resolved = resolveDcatLayer(cat.value, o.dataset);
      if (!resolved) return fail(`dataset '${o.dataset}' is not in the catalogue ${catalogueUrl} with a GeoService distribution`);
      layer = resolved.layer;
    }
    http.assertAllowed(layer);

    // 2. the layer's own metadata: the page cap, the fields, the last edit
    const meta = (await http.json<any>(`${layer}?f=json`)).value;
    if (meta?.error) return fail(`ArcGIS error ${meta.error.code ?? ''}: ${meta.error.message ?? 'layer metadata refused'}`.trim());
    const serverMax = Number(meta?.maxRecordCount);
    const cap = Number.isInteger(o.max_records) && (o.max_records as number) > 0 ? (o.max_records as number) : DEFAULT_MAX_RECORDS;
    const requested = Number.isInteger(o.page_size) && (o.page_size as number) > 0 ? (o.page_size as number) : (Number.isFinite(serverMax) && serverMax > 0 ? serverMax : DEFAULT_PAGE);
    const pageSize = Number.isFinite(serverMax) && serverMax > 0 ? Math.min(requested, serverMax) : requested;

    // 3. the pages
    const pages: { raw: Buffer; body: any }[] = [];
    let got = 0, capped = false;
    for (let offset = 0; ; ) {
      const count = Math.min(pageSize, cap - got);
      if (count <= 0) { capped = true; break; }
      const page = await http.json<any>(queryUrl(layer, o, offset, count));
      if (page.value?.error) return fail(`ArcGIS error ${page.value.error.code ?? ''}: ${page.value.error.message ?? 'query refused'}`.trim());
      const features: unknown[] = Array.isArray(page.value?.features) ? page.value.features : [];
      pages.push({ raw: page.bytes, body: page.value });
      got += features.length; offset += features.length;
      // more only when the server says so and filled the page: fewer than asked means the layer is exhausted, whatever the flag says
      const more = page.value?.exceededTransferLimit === true && features.length >= count;
      if (!more) break;
      if (got >= cap) { capped = true; break; }
    }
    if (capped) ctx.onWarn?.(`${source.id}: stopped at the registry cap of ${cap} records (${layer})`);

    // 4. one page verbatim, several merged into one feature set
    let bytes: Buffer;
    if (pages.length === 1) bytes = pages[0].raw;
    else {
      const { exceededTransferLimit: _x, ...envelope } = pages[0].body;
      bytes = Buffer.from(JSON.stringify({ ...envelope, features: pages.flatMap(p => (Array.isArray(p.body.features) ? p.body.features : [])) }));
    }
    const fields = Array.isArray(meta?.fields) ? meta.fields.map((f: any) => f?.name).filter((n: unknown) => typeof n === 'string') : [];
    const lastEdit = isoFrom(meta?.editingInfo?.dataLastEditDate ?? meta?.editingInfo?.lastEditDate);
    return result(source, ctx, { fetched_at: at,
      url: layer,
      title: resolved?.title || o.title || (typeof meta?.name === 'string' && meta.name) || source.id,
      description: resolved?.description || o.description || (typeof meta?.description === 'string' ? stripTags(meta.description) : ''),
      rows: got, bytes, mime: 'application/json',
      meta: {
        layer, pages: pages.length, max_record_count: Number.isFinite(serverMax) ? serverMax : null, page_size: pageSize, cap, capped,
        fields, geometry: !!o.geometry, where: o.where ?? '1=1',
        source_modified: resolved?.modified ?? lastEdit, layer_last_edit: lastEdit,
        ...(resolved ? { catalogue: typeof o.catalogue === 'string' ? o.catalogue : source.url, dataset: o.dataset, landing_page: resolved.landing_page, licence_stated: resolved.licence_stated } : {}),
        ...(typeof meta?.copyrightText === 'string' && meta.copyrightText ? { copyright_text: meta.copyrightText } : {}),
      },
    });
  } catch (e) {
    return fail(e instanceof RefusedError ? e.message : describeError(e));
  }
};
