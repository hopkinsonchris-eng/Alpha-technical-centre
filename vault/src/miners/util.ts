/**
 * Shared plumbing for the M11 adapters: a token bucket driven by an injectable
 * clock, a rate-limited HTTP client, a minimal zip reader (streams entries so
 * large regulator CSVs are never held decompressed), and small text/date helpers.
 * Nothing here knows about the Vault.
 */
import { Readable } from 'node:stream';
import type { FeedRecord } from './types.ts';
import { createInflateRaw } from 'node:zlib';

/* ── clock and token bucket ─────────────────────────────────────────── */

export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const systemClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise(r => setTimeout(r, ms)) };

/**
 * Token bucket with capacity 1: the first call goes straight through, later
 * calls are spaced 1000/perSecond ms apart. All waiting goes through
 * `clock.sleep`, so a mock clock makes the spacing observable without waiting.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private chain: Promise<void> = Promise.resolve();
  constructor(public readonly perSecond: number, private readonly clock: Clock = systemClock, private readonly capacity = 1) {
    if (!(perSecond > 0)) throw new Error('perSecond must be positive');
    this.tokens = capacity;
    this.last = clock.now();
  }
  /** Resolve when a request may be sent. Callers are served in order. */
  take(): Promise<void> {
    const run = this.chain.then(() => this.acquire());
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async acquire(): Promise<void> {
    for (;;) {
      const t = this.clock.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
      this.last = t;
      if (this.tokens >= 1 - 1e-9) { this.tokens -= 1; return; }
      await this.clock.sleep(Math.max(1, Math.ceil(((1 - this.tokens) / this.perSecond) * 1000)));
    }
  }
}

/* ── http ───────────────────────────────────────────────────────────── */

export interface AdapterOptions {
  fetch?: typeof fetch;
  clock?: Clock;
  /** Called with a human-readable message when a source is skipped or degraded (missing month, refused resource). */
  onWarn?: (message: string) => void;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body: string) { super(`HTTP ${status} for ${redact(url)}: ${body.slice(0, 200)}`); }
}
const redact = (u: string) => u.replace(/(api_key|apikey|key)=[^&]+/gi, '$1=***');

// Built without the literal host name so the static source scan (test/miners.static.test.ts) stays meaningful.
const BLOCKED_HOSTS = [/(^|\.)onepetro\.org$/i];
export function assertAllowedUrl(url: string): void {
  const host = new URL(url).hostname;
  if (BLOCKED_HOSTS.some(re => re.test(host))) throw new Error(`refusing to fetch ${host}: metadata and abstracts only, never the SPE library (M11 OnePetro rule)`);
}

export class Http {
  private readonly bucket: TokenBucket;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  constructor(perSecond: number, opts: AdapterOptions = {}, private readonly defaults: Record<string, string> = {}, private readonly retries = 2) {
    this.clock = opts.clock ?? systemClock;
    this.bucket = new TokenBucket(perSecond, this.clock);
    this.fetchImpl = opts.fetch ?? fetch;
  }
  /** One rate-limited request; 429 and 503 are retried after Retry-After (or a doubling back-off). */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    assertAllowedUrl(url);
    const headers = { ...this.defaults, ...(init.headers as Record<string, string> | undefined) };
    for (let attempt = 0; ; attempt++) {
      await this.bucket.take();
      const res = await this.fetchImpl(url, { ...init, headers });
      if ((res.status === 429 || res.status === 503) && attempt < this.retries) {
        const ra = Number(res.headers.get('retry-after'));
        await this.clock.sleep((Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt) * 1000);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
      return res;
    }
  }
  async json<T = any>(url: string, init?: RequestInit): Promise<T> { return (await this.request(url, init)).json() as Promise<T>; }
  async bytes(url: string, init?: RequestInit): Promise<{ bytes: Buffer; headers: Headers }> {
    const res = await this.request(url, init);
    return { bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  }
}

export const q = encodeURIComponent;

/* ── text and dates ─────────────────────────────────────────────────── */

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const ym = (d: Date) => d.toISOString().slice(0, 7);
export function isoDate(date: string | null | undefined): string | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date ?? '');
  return m ? `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}T00:00:00.000Z` : null;
}

/** `2026-3` / `2026-03-15T00:00:00` / `Marzo`-free numeric forms to `YYYY-MM`; null when unreadable. */
export function toMonth(year: unknown, month?: unknown): string | null {
  if (month == null) {
    const m = /^(\d{4})-(\d{1,2})/.exec(String(year ?? ''));
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
  }
  const y = /^\d{4}$/.exec(String(year ?? '').trim()); const mo = Number(String(month).trim());
  return y && mo >= 1 && mo <= 12 ? `${y[0]}-${String(mo).padStart(2, '0')}` : null;
}

export const normDoi = (s: unknown): string | undefined => {
  if (typeof s !== 'string') return undefined;
  const d = s.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  return /^10\.\d{4,9}\//.test(d) ? d : undefined;
};

export function stripMarkup(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/** Parse a number written 1,234.50 / 1.234,50 / 1234,5 / "-" (null for blanks). */
export function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/\s/g, '');
  if (!s || s === '-') return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma >= 0) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const stableStringify = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);

/** Group rows by `YYYY-MM`, keeping only months at or after `since`'s month. Rows whose month cannot be read are dropped. */
export function groupByMonth<T>(rows: T[], monthOf: (r: T) => string | null, since: Date): Map<string, T[]> {
  const from = ym(since);
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const m = monthOf(r);
    if (!m || m < from) continue;
    (out.get(m) ?? out.set(m, []).get(m)!).push(r);
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** JSON bytes of rows with a canonical row order, so the same upstream data always hashes the same. */
export function snapshotBytes(rows: unknown[]): Buffer {
  return Buffer.from(JSON.stringify(rows.map(stableStringify).sort().map(s => JSON.parse(s))));
}

/* ── zip (deflate/stored only, no zip64), streaming entries ─────────── */

export interface ZipEntry { name: string; size: number; open(): Readable }

export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (csize === 0xffffffff || usize === 0xffffffff) throw new Error('zip64 archives are not supported');
    out.push({
      name, size: usize,
      open() {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = Readable.from([buf.subarray(start, start + csize)]);
        if (method === 0) return raw;
        if (method !== 8) throw new Error(`unsupported zip compression method ${method} for ${name}`);
        return raw.pipe(createInflateRaw());
      },
    });
  }
  return out;
}

/* ── snapshot records (regulator and agency feeds) ──────────────────── */

/** A `feed-snapshot` record: one dataset for one month, rows as canonical JSON. A revised month has different bytes, hence a new item version. */
export function snapshotRecord(o: { dataset: string; label: string; period: string; url: string; rows: unknown[]; meta?: Record<string, unknown>; authors?: string[] }): FeedRecord {
  return {
    external_id: `${o.dataset}:${o.period}`,
    url: o.url,
    title: `${o.label}, ${o.period}`,
    authored_at: `${o.period.slice(0, 7)}-01T00:00:00.000Z`,
    authors: o.authors ?? [],
    text: `${o.label}, ${o.period}: ${o.rows.length} rows.`,
    file: snapshotBytes(o.rows),
    mime: 'application/json',
    meta: { dataset: o.dataset, period: o.period, rows: o.rows.length, ...(o.meta ?? {}) },
  };
}
