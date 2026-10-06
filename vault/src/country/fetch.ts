/**
 * Fetching one registry source (wave 7 PR4, 04-step-changes.md P1 "How a pack is built", step 2). Server-side only,
 * through the miners' rate-limited Http (one client per host), with an injectable fetch and clock so tests never
 * touch the network. Before any request the url's host must sit inside the source's allowed_domains and outside
 * the hosts the pack never reads; a redirect that lands elsewhere is refused after the fact. A byte cap (8 MB) and
 * a timeout bound every read. html and pdf are kept as fetched; json, csv and rss are parsed only far enough for a
 * title and a one-line description. A {year} series is resolved to the current edition, then the previous. Any
 * failure is a result, never a throw: {unreachable: true, reason}. No model call anywhere here.
 *
 * Two sources are built in: the Global Energy Monitor tracker is read from the imported master file (no fetch), and
 * ResourceContracts' text API is followed from its search into the newest contracts' first pages. Regulator adapters
 * (ArcGIS, CKAN, CSV) plug in through `ctx.adapters`, keyed by access kind or adapter id.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Http, HttpError, readZip, stripMarkup, type Clock } from '../miners/util.ts';
import { countryName } from '../opportunities.ts';
import { fillPlaceholders, isBlockedHost, isSeries, editionUrl } from './registry.ts';
import { adapterFor, isAllowedUrl, runAdapter, type AdapterResult } from './adapters/index.ts';
import type { CountrySource, SourceAccess } from './types.ts';

export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_PER_SECOND = 1;
export const MASTER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../master');

export interface FetchOk {
  unreachable: false;
  /** The registry url as resolved for the country and edition, with no secret in it: the item's external id. */
  url: string;
  /** Where the response came from after redirects (the same, usually). */
  url_final: string;
  bytes: Buffer;
  mime: string;
  fetched_at: string;
  status: number;
  title: string;
  description: string;
  /** The edition a {year} series resolved to. */
  edition?: number;
  /** The publisher's own date for the payload (an adapter's meta.source_modified), ISO, when it states one. */
  source_modified?: string | null;
  /** Records in the payload when an adapter counted them. */
  rows?: number;
}
export interface FetchUnreachable {
  unreachable: true; url: string; reason: string; fetched_at: string; status?: number; not_configured?: boolean;
  /** What arrived although the source is not usable (a CSV whose header changed): filed as an original, never drafted from. */
  partial?: FetchOk;
}
export type FetchResult = FetchOk | FetchUnreachable;

export interface FetchContext {
  country: string;
  /** The country's name for {country} slugs; the ISO name when absent. */
  name?: string;
  fetch?: typeof fetch;
  clock?: Clock;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  maxBytes?: number;
  timeoutMs?: number;
  /** Requests per second per host (default 1: ResourceContracts has no documented limit, so be polite). */
  perSecond?: number;
  /** One client per host, shared across the sources of a build. */
  pool?: HttpPool;
  /** Where gem-fields.json lives (tests). */
  masterDir?: string;
  /** Overrides by access kind or adapter id (the source url for access 'adapter'): tests, or a bespoke fetcher; K's arcgis, ckan and csv adapters are the default for their kinds. */
  adapters?: Record<string, SourceAdapter>;
  /** A degraded source (a cap reached, a licence that differs from the registry), one line each. */
  onWarn?: (message: string) => void;
}
/** What an adapter gets: the context plus the shared helpers, so it never calls fetch on its own. */
export interface AdapterContext extends Omit<FetchContext, 'now'> { now: Date; get: (url: string, source: CountrySource) => Promise<Got> }
export type SourceAdapter = (source: CountrySource, ctx: AdapterContext) => Promise<FetchResult>;

/* ── http: one rate-limited client per host ──────────────────────────────────────────────────────────────────── */

export class HttpPool {
  private clients = new Map<string, Http>();
  constructor(private readonly opts: { fetch?: typeof fetch; clock?: Clock; perSecond?: number } = {}) {}
  for(url: string): Http {
    const host = new URL(url).hostname.toLowerCase();
    let h = this.clients.get(host);
    if (!h) { h = new Http(this.opts.perSecond ?? DEFAULT_PER_SECOND, { fetch: this.opts.fetch, clock: this.opts.clock }, { 'user-agent': 'ATC-Vault country-pack (+https://www.alpha-technical-centre.com)' }); this.clients.set(host, h); }
    return h;
  }
}

/** The url may be fetched under the allow-list: K's one rule (vault/src/country/adapters/shared.ts) plus the hosts the pack never reads. */
export function hostAllowed(url: string, allowed: string[]): boolean { return allowReason(url, allowed) === null; }
function allowReason(url: string, allowed: string[]): string | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return `not a URL: ${url}`; }
  if (isBlockedHost(host)) return `refused: ${host} is never read (D67 and the hard constraints)`;
  const why = isAllowedUrl(url, allowed);
  return why ? `refused: ${host} is outside the allowed domains (${why})` : null;
}

class Refused extends Error { constructor(message: string, public status?: number, public notConfigured = false) { super(message); } }

export interface Got { bytes: Buffer; mime: string; url_final: string; status: number }

async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new Refused(`payload of ${declared} bytes exceeds the byte cap of ${max}`);
  if (!res.body) {
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > max) throw new Refused(`payload of ${b.length} bytes exceeds the byte cap of ${max}`);
    return b;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); throw new Refused(`payload exceeds the byte cap of ${max} bytes`); }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

const MIME_BY_ACCESS: Record<string, string> = { html: 'text/html', pdf: 'application/pdf', json: 'application/json', csv: 'text/csv', rss: 'application/rss+xml' };
const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

async function readZipCsv(bytes: Buffer): Promise<Buffer> {
  const entries = readZip(bytes);
  const entry = entries.find(e => /\.csv$/i.test(e.name)) ?? entries.find(e => /\.(txt|tsv)$/i.test(e.name));
  if (!entry) throw new Refused(`zip holds no CSV entry (${entries.map(e => e.name).join(', ') || 'empty'})`);
  const parts: Buffer[] = [];
  for await (const chunk of entry.open()) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(parts);
}

/* ── the fetch ───────────────────────────────────────────────────────────────────────────────────────────────── */

const ACCEPT: Record<string, string> = { html: 'text/html,application/xhtml+xml', pdf: 'application/pdf', json: 'application/json', csv: 'text/csv,application/zip,application/octet-stream,*/*;q=0.1', rss: 'application/rss+xml,application/xml,text/xml' };

export async function fetchSource(source: CountrySource, ctx: FetchContext): Promise<FetchResult> {
  const now = ctx.now?.() ?? new Date();
  const fetched_at = now.toISOString();
  const name = ctx.name ?? countryName(ctx.country).en;
  const fill = (u: string) => fillPlaceholders(u, { code: ctx.country, name });
  const src: CountrySource = {
    ...source, url: fill(source.url),
    ...(source.options ? { options: Object.fromEntries(Object.entries(source.options).map(([k, v]) => [k, typeof v === 'string' ? fill(v) : v])) } : {}),
  };
  const maxBytes = ctx.maxBytes ?? DEFAULT_MAX_BYTES, timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pool = ctx.pool ?? new HttpPool({ fetch: ctx.fetch, clock: ctx.clock, perSecond: ctx.perSecond });
  const env = ctx.env ?? process.env;

  /** One request within the allow-list, the byte cap and the timeout. */
  const get = async (url: string, s: CountrySource): Promise<Got> => {
    const why = allowReason(url, s.allowed_domains);
    if (why) throw new Refused(why);
    const http = pool.for(url);
    // A referenced timer, not AbortSignal.timeout: Node unrefs that one, and a build waiting on a hung host must keep the process alive to time out.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new DOMException(`timed out after ${timeoutMs} ms`, 'TimeoutError')), timeoutMs);
    let bytes: Buffer, res: Response;
    try {
      res = await http.request(url, { signal: ac.signal, headers: { accept: ACCEPT[s.access] ?? '*/*' }, redirect: 'follow' });
      const url_final = res.url || url;
      if (url_final !== url) {
        const fh = new URL(url_final).hostname;
        if (isBlockedHost(fh) || !hostAllowed(url_final, s.allowed_domains)) { await res.body?.cancel().catch(() => undefined); throw new Refused(`redirected to ${fh}, outside the allowed domains [${s.allowed_domains.join(', ')}]`); }
      }
      bytes = await readCapped(res, maxBytes);
    } finally { clearTimeout(timer); }
    const url_final = res.url || url;
    let mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || MIME_BY_ACCESS[s.access] || 'application/octet-stream';
    if (s.access === 'csv' && (isZip(bytes) || /zip/.test(mime))) { bytes = await readZipCsv(bytes); mime = 'text/csv'; }
    else if (s.access === 'csv' && !/csv|text\//.test(mime)) mime = 'text/csv';
    else if (s.access === 'json' && !/json/.test(mime)) mime = 'application/json';
    else if (s.access === 'html' && !/html/.test(mime)) mime = 'text/html';
    return { bytes, mime, url_final, status: res.status };
  };

  const fail = (e: unknown): FetchUnreachable => {
    const err = e as any;
    if (err instanceof Refused) return { unreachable: true, url: src.url, reason: err.message, fetched_at, ...(err.status ? { status: err.status } : {}), ...(err.notConfigured ? { not_configured: true } : {}) };
    if (err instanceof HttpError) return { unreachable: true, url: src.url, reason: `HTTP ${err.status} for ${src.url}`, fetched_at, status: err.status };
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { unreachable: true, url: src.url, reason: `timed out after ${timeoutMs} ms`, fetched_at };
    return { unreachable: true, url: src.url, reason: String(err?.message ?? err), fetched_at };
  };

  try {
    // A built-in by id (GEM from the master file, ResourceContracts text), or one injected for tests.
    if (src.access === 'adapter' || ctx.adapters?.[src.url] || ctx.adapters?.[src.access]) {
      const adapter = ctx.adapters?.[src.url] ?? ctx.adapters?.[src.access] ?? BUILT_IN[src.url];
      if (!adapter) throw new Refused(`no adapter registered for "${src.url}"`);
      return await adapter(src, { ...ctx, name, now, get, pool });
    }
    // Regulator open data through K's adapters (arcgis, ckan, csv), the same allow-list and Http; a zipped CSV (JODI) stays with the fetch below.
    if (adapterFor(src.access) && !(src.access === 'csv' && /\.zip(\?|$)/i.test(src.url))) {
      const why = allowReason(src.url, src.allowed_domains);
      if (why) throw new Refused(why);
      return fromAdapter(src, await runAdapter(src, { fetch: ctx.fetch, clock: ctx.clock, maxBytes, perSecond: ctx.perSecond, onWarn: m => ctx.onWarn?.(`${src.id}: ${m}`) }), fetched_at);
    }

    // A key from the environment, added to the request and never to the recorded url.
    const keyEnv = typeof src.options?.api_key_env === 'string' ? src.options.api_key_env : null;
    let requestUrl = src.url;
    if (keyEnv) {
      const key = env[keyEnv];
      if (!key) throw new Refused(`not configured: ${keyEnv} is not set`, undefined, true);
      const param = typeof src.options?.api_key_param === 'string' ? src.options.api_key_param : 'api_key';
      requestUrl = `${src.url}${src.url.includes('?') ? '&' : '?'}${encodeURIComponent(param)}=${encodeURIComponent(key)}`;
    }

    // The request, or for a series the current edition then the previous (404 and 410 mean "no such edition").
    let got: Got | null = null, edition: number | undefined, url = src.url;
    const probe = async (reqUrl: string): Promise<Got | null> => {
      try { return await get(reqUrl, src); }
      catch (e) { if (e instanceof HttpError && (e.status === 404 || e.status === 410)) return null; throw e; }
    };
    if (isSeries(src.url)) {
      const y = now.getUTCFullYear();
      for (const year of [y, y - 1]) {
        got = await probe(editionUrl(requestUrl, year));
        if (got) { url = editionUrl(src.url, year); edition = year; break; }
      }
      if (!got) throw new Refused(`no edition of the series answered for ${y} or ${y - 1}`, 404);
    } else {
      got = await probe(requestUrl);
      if (!got) throw new Refused(`HTTP 404 for ${src.url}`, 404);
    }

    const g: Got = got;
    const { title, description } = summarise(g.bytes, g.mime, src.access, { source: src, country: name });
    const url_final = g.url_final === requestUrl ? url : g.url_final;
    return { unreachable: false, url, url_final: redact(url_final, keyEnv ? env[keyEnv] : undefined), bytes: g.bytes, mime: g.mime, fetched_at, status: g.status, title, description, ...(edition ? { edition } : {}) };
  } catch (e) {
    return fail(e);
  }
}

const redact = (u: string, secret?: string) => (secret ? u.split(encodeURIComponent(secret)).join('***').split(secret).join('***') : u);

/* ── titles and one-line descriptions ────────────────────────────────────────────────────────────────────────── */

const clip = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const attributionHead = (attribution: string) => attribution.split(/[,;(]/)[0].replace(/^Source:\s*/i, '').trim();

function labelOf(rec: any): string | null {
  if (!rec || typeof rec !== 'object') return typeof rec === 'string' ? rec : null;
  for (const k of ['contract_name', 'name', 'title', 'label', 'country', 'period']) if (typeof rec[k] === 'string' && rec[k].trim()) return rec[k].trim();
  return null;
}
/** The first array of records in a JSON body: the body itself, a top-level array, or one a level down (EIA's response.data). */
function firstArray(j: any): { key: string; rows: any[] } | null {
  if (Array.isArray(j)) return { key: 'records', rows: j };
  if (!j || typeof j !== 'object') return null;
  for (const [k, v] of Object.entries(j)) if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'object')) return { key: k, rows: v };
  for (const [, v] of Object.entries(j)) if (v && typeof v === 'object' && !Array.isArray(v)) { const r = firstArray(v); if (r) return r; }
  return null;
}

/** A title and a one-line description, parsed only as far as that needs. */
export function summarise(bytes: Buffer, mime: string, access: SourceAccess, o: { source?: CountrySource; country?: string } = {}): { title: string; description: string } {
  const base = o.source ? `${attributionHead(o.source.attribution)}${o.country ? ` — ${o.country}` : ''}` : (o.country ?? 'Country source');
  const text = () => bytes.toString('utf8');
  try {
    if (access === 'html' || /html/.test(mime)) {
      const h = text();
      const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(h);
      const meta = /<meta\s+(?:[^>]*?\s)?name=["']description["'][^>]*?content=["']([^"']*)["']/i.exec(h) ?? /<meta\s+(?:[^>]*?\s)?content=["']([^"']*)["'][^>]*?name=["']description["']/i.exec(h);
      const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(h);
      const body = stripMarkup(h.replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1>/gi, ' '));
      const title = t ? stripMarkup(t[1]) : base;
      const description = clip(stripMarkup(meta?.[1] ?? p?.[1] ?? body));
      return { title: title || base, description };
    }
    if (access === 'json' || /json/.test(mime)) {
      const j = JSON.parse(text());
      const arr = firstArray(j);
      if (!arr) return { title: base, description: clip(`JSON object with ${Object.keys(j ?? {}).join(', ') || 'no keys'}`) };
      const first = arr.rows.length ? labelOf(arr.rows[0]) : null;
      const n = arr.rows.length;
      return { title: base, description: clip(`${n} ${n === 1 ? 'record' : 'records'} (${arr.key})${first ? `; first: ${first}` : ''}`) };
    }
    if (access === 'csv' || /csv|tab-separated/.test(mime)) {
      const t = text();
      const lines = t.split(/\r?\n/).filter(l => l.trim() !== '');
      const header = (lines[0] ?? '').split(lines[0]?.includes('\t') ? '\t' : ',').map(c => c.trim().replace(/^"|"$/g, ''));
      const rows = Math.max(0, lines.length - 1);
      return { title: base, description: clip(`${header.length} columns (${header.join(', ')}); ${rows} ${rows === 1 ? 'row' : 'rows'}`) };
    }
    if (access === 'rss' || /xml/.test(mime)) {
      const x = text();
      const ch = /<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(x) ?? /<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i.exec(x);
      const items = x.match(/<(item|entry)\b/gi)?.length ?? 0;
      const firstItem = /<(?:item|entry)\b[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i.exec(x);
      return { title: ch ? stripMarkup(ch[1]) : base, description: clip(`${items} ${items === 1 ? 'item' : 'items'}${firstItem ? `; latest: ${stripMarkup(firstItem[1])}` : ''}`) };
    }
    if (access === 'pdf' || /pdf/.test(mime)) return { title: base, description: `PDF, ${bytes.length} bytes` };
  } catch (e) {
    return { title: base, description: clip(`could not be summarised: ${(e as Error).message}`) };
  }
  return { title: base, description: `${mime}, ${bytes.length} bytes` };
}

/* ── built-in adapters ───────────────────────────────────────────────────────────────────────────────────────── */

interface GemMaster { release: string; imported_at: string; units: any[] }
let gemCache: { file: string; data: GemMaster } | null = null;
function loadGem(dir: string): GemMaster {
  const file = path.join(dir, 'gem-fields.json');
  if (gemCache?.file !== file) gemCache = { file, data: JSON.parse(readFileSync(file, 'utf8')) };
  return gemCache.data;
}

/** The Global Energy Monitor extraction tracker, already imported: the country's units, operator and ownership included. No request. */
export const gemFieldsAdapter: SourceAdapter = async (source, ctx) => {
  const gem = loadGem(ctx.masterDir ?? MASTER_DIR);
  const units = (gem.units ?? []).filter(u => u?.country === ctx.country).sort((a, b) => String(a.unit_id).localeCompare(String(b.unit_id)));
  const body = { release: gem.release, imported_at: gem.imported_at, country: ctx.country, units };
  const bytes = Buffer.from(JSON.stringify(body));
  const operators = [...new Set(units.map(u => u.operator).filter((o): o is string => typeof o === 'string' && o.trim() !== ''))];
  const fetched_at = ctx.now.toISOString();
  return {
    unreachable: false, url: `${source.url}:${ctx.country}`, url_final: 'https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/', bytes, mime: 'application/json', fetched_at, status: 200,
    title: `Global Energy Monitor — ${ctx.name ?? ctx.country}`,
    description: clip(`${units.length} extraction ${units.length === 1 ? 'area' : 'areas'} (release ${gem.release}); operators: ${operators.slice(0, 8).join(', ') || 'none recorded'}`),
  };
};

/** ResourceContracts: the search, then the newest contracts' first pages of text, bundled as one original. */
export const resourceContractsTextAdapter: SourceAdapter = async (source, ctx) => {
  const o = source.options ?? {};
  const searchUrl = typeof o.search === 'string' ? o.search : null;
  const textUrl = typeof o.text === 'string' ? o.text : null;
  if (!searchUrl || !textUrl) return { unreachable: true, url: source.url, reason: 'options.search and options.text are required', fetched_at: ctx.now.toISOString() };
  const maxContracts = typeof o.max_contracts === 'number' ? o.max_contracts : 3, maxPages = typeof o.max_pages === 'number' ? o.max_pages : 2;
  const fetched_at = ctx.now.toISOString();
  try {
    const search = await ctx.get(searchUrl, source);
    const results: any[] = firstArray(JSON.parse(search.bytes.toString('utf8')))?.rows ?? [];
    const dated = (r: any) => String(r.signature_date ?? r.signature_year ?? '');
    const newest = results.filter(r => r && r.contract_id != null).sort((a, b) => dated(b).localeCompare(dated(a)) || Number(a.contract_id) - Number(b.contract_id)).slice(0, maxContracts);
    const contracts: any[] = [];
    let pages = 0;
    for (const r of newest) {
      const c = { contract_id: r.contract_id, open_contracting_id: r.open_contracting_id ?? null, contract_name: r.contract_name ?? null, signature_date: r.signature_date ?? null, signature_year: r.signature_year ?? null, company_name: r.company_name ?? [], contract_type: r.contract_type ?? [], pages: [] as any[], error: null as string | null };
      for (let p = 1; p <= maxPages; p++) {
        try {
          const got = await ctx.get(textUrl.replace(/\{id\}/g, String(r.contract_id)).replace(/\{page\}/g, String(p)), source);
          const j = JSON.parse(got.bytes.toString('utf8'));
          const t = typeof j.text === 'string' ? j.text : typeof j === 'string' ? j : '';
          c.pages.push({ page: p, total_pages: j.total_pages ?? null, text: t }); pages++;
          if (!t.trim()) break;
        } catch (e) { c.error = (e as Error).message; break; }
      }
      contracts.push(c);
    }
    const body = { country: ctx.country, search_url: searchUrl, total: results.length, contracts };
    return {
      unreachable: false, url: `${source.url}:${ctx.country}`, url_final: searchUrl, bytes: Buffer.from(JSON.stringify(body)), mime: 'application/json', fetched_at, status: search.status,
      title: `ResourceContracts.org contract text — ${ctx.name ?? ctx.country}`,
      description: clip(`${contracts.length} ${contracts.length === 1 ? 'contract' : 'contracts'} of ${results.length} published, ${pages} ${pages === 1 ? 'page' : 'pages'} of text${contracts[0]?.contract_name ? `; newest: ${contracts[0].contract_name}` : ''}`),
    };
  } catch (e) {
    const err = e as any;
    const reason = err instanceof HttpError ? `HTTP ${err.status} for ${searchUrl}` : err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out' : String(err?.message ?? err);
    return { unreachable: true, url: `${source.url}:${ctx.country}`, reason, fetched_at, ...(err instanceof HttpError ? { status: err.status } : {}) };
  }
};

/** K's AdapterResult as a FetchResult: the payload is the original; an unreachable result that still carries bytes (a reshaped CSV) is filed but never drafted from. */
export function fromAdapter(source: CountrySource, r: AdapterResult, fetched_at: string): FetchResult {
  const modified = typeof r.meta?.source_modified === 'string' ? r.meta.source_modified : null;
  const ok: FetchOk = {
    unreachable: false, url: r.url || source.url, url_final: r.url || source.url, bytes: r.bytes, mime: r.mime, fetched_at: r.fetched_at || fetched_at, status: 200,
    title: r.title || `${attributionHead(source.attribution)}`, description: r.description || '', source_modified: modified, rows: r.rows,
  };
  if (!r.unreachable) return ok;
  return { unreachable: true, url: r.url || source.url, reason: r.unreachable, fetched_at: r.fetched_at || fetched_at, ...(r.bytes?.length ? { partial: ok } : {}) };
}

const BUILT_IN: Record<string, SourceAdapter> = { 'gem-fields': gemFieldsAdapter, 'resourcecontracts-text': resourceContractsTextAdapter };
export const BUILT_IN_ADAPTERS = Object.keys(BUILT_IN);

