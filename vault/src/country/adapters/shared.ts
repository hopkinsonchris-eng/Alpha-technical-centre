/**
 * Shared plumbing for the country pack adapters (wave 7 PR4, docs/vault-hub/wave7/05-markup.md §1.8): the result
 * contract the job stores as an immutable original, the registry allow-list, a rate-limited fetch through the miners'
 * `Http` (so the OnePetro rule and the 429/503 back-off apply here too), and small date helpers. Nothing here knows
 * about the database. Every adapter takes an injectable fetch and clock so the tests never touch the network.
 */
import { Http, HttpError, systemClock, type Clock } from '../../miners/util.ts';
import type { CountrySource } from '../types.ts';

export interface AdapterContext {
  fetch?: typeof fetch;
  clock?: Clock;
  /** Called with a human-readable message when a source is degraded (a cap reached, a licence that differs from the registry). */
  onWarn?: (message: string) => void;
  /** Largest payload accepted, bytes. Default 25 MB. */
  maxBytes?: number;
  /** Requests per second against one source. Default 2. */
  perSecond?: number;
}

/** What an adapter returns for one registry source. `bytes` is the payload to store as the original, as fetched. */
export interface AdapterResult {
  source_id: string;
  /** The URL actually fetched for the payload (the layer query, the resource download, the CSV), for `origin.external_id`. */
  url: string;
  title: string;
  description: string;
  /** Records in the payload: features, CSV data rows. 0 when unknown or unreachable. */
  rows: number;
  bytes: Buffer;
  mime: string;
  /** ISO 8601, from the injected clock. */
  fetched_at: string;
  attribution: string;
  licence: string;
  /** Set when nothing usable was fetched: the reason, never thrown. `bytes` may still carry what was fetched (a CSV whose header changed). */
  unreachable?: string;
  /** Adapter facts: `source_modified` (the publisher's own date, ISO) whenever one exists, paging and header details. */
  meta: Record<string, unknown>;
}

export type CountryAdapter = (source: CountrySource, ctx?: AdapterContext) => Promise<AdapterResult>;

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/* ── the allow-list ─────────────────────────────────────────────────── */

const BLOCKED_HOSTS = [/(^|\.)onepetro\.org$/i];
const normaliseEntry = (d: string) => ({
  http: /^http:\/\//i.test(d),
  host: d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/[/:].*$/, ''),
});
const hostMatches = (host: string, entry: string) => host === entry || host.endsWith(`.${entry}`);

/**
 * Null when `url` may be fetched under `allowed`, otherwise the reason. An entry is a host name (`arcgis.com` covers
 * every subdomain) and permits https only; an entry written `http://host` permits plain http to that host as well, which
 * is how the registry says so explicitly for datos.energia.gob.ar. The OnePetro rule from the miners applies here too.
 */
export function isAllowedUrl(url: string, allowed: string[]): string | null {
  if (!Array.isArray(allowed) || allowed.length === 0) return 'allowed_domains is empty';
  let u: URL;
  try { u = new URL(url); } catch { return `not a URL: ${url}`; }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some(re => re.test(host))) return `refusing to fetch ${host}: metadata and abstracts only, never the SPE library`;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return `scheme ${u.protocol.replace(':', '')} is not fetched (${url})`;
  const entries = allowed.map(normaliseEntry);
  const matching = entries.filter(e => e.host && hostMatches(host, e.host));
  if (matching.length === 0) return `${host} is not in allowed_domains [${allowed.join(', ')}]`;
  if (u.protocol === 'http:' && !matching.some(e => e.http)) return `plain http to ${host} is not in allowed_domains (add 'http://${host}' to permit it)`;
  return null;
}

/* ── results ────────────────────────────────────────────────────────── */

export const fetchedAt = (ctx: AdapterContext = {}) => new Date((ctx.clock ?? systemClock).now()).toISOString();

export function unreachable(source: CountrySource, reason: string, ctx: AdapterContext = {}, partial: Partial<AdapterResult> = {}): AdapterResult {
  return {
    source_id: source.id, url: source.url, title: optionString(source, 'title') ?? source.id, description: optionString(source, 'description') ?? '',
    rows: 0, bytes: Buffer.alloc(0), mime: 'application/octet-stream', fetched_at: fetchedAt(ctx),
    attribution: source.attribution, licence: source.licence, meta: {},
    ...partial,
    unreachable: reason,
  };
}

/** A reachable result. `fields.fetched_at` is the moment the adapter started (before paging and rate-limit waits); the clock's now when absent. */
export function result(source: CountrySource, ctx: AdapterContext, fields: Pick<AdapterResult, 'url' | 'title' | 'description' | 'rows' | 'bytes' | 'mime' | 'meta'> & { fetched_at?: string }): AdapterResult {
  return { source_id: source.id, fetched_at: fetchedAt(ctx), attribution: source.attribution, licence: source.licence, ...fields };
}

export const optionString = (source: CountrySource, key: string): string | undefined => {
  const v = source.options?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

/** The registry's options as a plain object, or a reason when they are not one. */
export function optionsOf(source: CountrySource): { options: Record<string, unknown>; error?: string } {
  const o = source.options ?? {};
  if (typeof o !== 'object' || Array.isArray(o)) return { options: {}, error: `options must be an object, got ${typeof o}` };
  return { options: o as Record<string, unknown> };
}

/** One line for the unreachable reason: the status and URL of an HttpError, the message of anything else. */
export function describeError(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status} for ${e.url}`;
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

/* ── fetching ───────────────────────────────────────────────────────── */

export class RefusedError extends Error {}

/** A rate-limited fetch bound to one source's allow-list. Every URL is checked before a request is made. */
export class SourceHttp {
  private readonly http: Http;
  constructor(private readonly source: CountrySource, private readonly ctx: AdapterContext = {}) {
    this.http = new Http(ctx.perSecond ?? 2, { fetch: ctx.fetch, clock: ctx.clock }, { 'user-agent': 'ATC-Vault country-pack (+https://alpha-technical-centre.com)' });
  }
  assertAllowed(url: string): void {
    const why = isAllowedUrl(url, this.source.allowed_domains);
    if (why) throw new RefusedError(why);
  }
  /** GET the URL as bytes, refusing hosts outside the allow-list and payloads over `maxBytes`. Throws; callers turn it into `unreachable`. */
  async get(url: string, accept = '*/*'): Promise<{ bytes: Buffer; headers: Headers; url: string }> {
    this.assertAllowed(url);
    const res = await this.http.request(url, { headers: { accept } });
    const max = this.ctx.maxBytes ?? DEFAULT_MAX_BYTES;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) throw new Error(`payload of ${declared} bytes is over the ${max} byte limit (${url})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > max) throw new Error(`payload of ${bytes.length} bytes is over the ${max} byte limit (${url})`);
    return { bytes, headers: res.headers, url };
  }
  async json<T = any>(url: string): Promise<{ value: T; bytes: Buffer; headers: Headers; url: string }> {
    const got = await this.get(url, 'application/json');
    let value: T;
    try { value = JSON.parse(got.bytes.toString('utf8')); } catch { throw new Error(`not JSON: ${url}`); }
    return { value, ...got };
  }
}

/* ── dates ──────────────────────────────────────────────────────────── */

/** Publisher dates in the forms the regulators use (ISO with or without zone, epoch ms, dd.mm.yyyy, dd/mm/yyyy, RFC 1123) to ISO 8601; null when unreadable. */
export function isoFrom(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e11 ? new Date(v).toISOString() : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', se = '00', frac = '', zone] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}.${(frac + '000').slice(0, 3)}${zone ? zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : 'Z'}`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  m = /^(\d{2})[./](\d{2})[./](\d{4})(?:\s*-?\s*(\d{2}):(\d{2}))?$/.exec(s);
  if (m) {
    const t = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export const stripTags = (s: unknown): string => typeof s === 'string' ? s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim() : '';
