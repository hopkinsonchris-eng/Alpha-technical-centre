/**
 * World Monitor (wave 3, docs/vault-hub/wave3/05-markup.md §1.5, Option B, W3-D3).
 * Country risk, recent conflict events and headlines from api.worldmonitor.app,
 * read server-side with the key in WORLD_MONITOR_API_KEY (never sent to a
 * browser). Every call is cached in memory for an hour per (endpoint, country);
 * a 429 is honoured for its Retry-After and reported, never retried in a loop;
 * 401/403 are reported as "not connected" with the reason. Without a key every
 * reader gets {ok:false} and the Hub says the feed is not connected: nothing is
 * simulated.
 */

export interface WmOptions { fetch?: typeof fetch; apiKey?: string | null; baseUrl?: string; now?: () => Date; ttlMs?: number; timeoutMs?: number }
export interface CountryRisk { score: number | null; level: string | null; components: Record<string, unknown> | null; computed_at: string | null }
export interface AcledEvent { id: string; type: string | null; sub_type: string | null; admin1: string | null; location: string | null; actors: string | null; fatalities: number | null; date: string | null; notes: string | null }
export interface Headline { n: number; title: string; source: string | null; url: string | null; published_at: string | null }
export type WmResult<T> = { ok: true; data: T; fetched_at: string; cached: boolean } | { ok: false; reason: string; retry_after_s?: number };

const BASE = 'https://api.worldmonitor.app';
const HOUR = 3_600_000;
const FAIL_TTL = 5 * 60_000;

let opts: WmOptions = {};
const cache = new Map<string, { at: number; result: WmResult<unknown> }>();
let rateLimitedUntil = 0;

/** Tests inject fetch, the key and the clock; production reads the environment. */
export function configureWorldMonitor(o: WmOptions): void { opts = { ...opts, ...o }; cache.clear(); rateLimitedUntil = 0; }
export function resetWorldMonitorCache(): void { cache.clear(); rateLimitedUntil = 0; }
const key = () => (opts.apiKey === undefined ? (process.env.WORLD_MONITOR_API_KEY || null) : opts.apiKey);
/** True when a key is set; the Hub and the brief say "not connected" otherwise. */
export function worldMonitorConfigured(): boolean { return !!key(); }
export const NOT_CONNECTED = 'not connected (set WORLD_MONITOR_API_KEY on the Vault service)';

async function get(path: string, params: Record<string, string>): Promise<WmResult<any>> {
  const k = key();
  if (!k) return { ok: false, reason: NOT_CONNECTED };
  const now = (opts.now ?? (() => new Date()))().getTime();
  const id = path + '?' + new URLSearchParams(params).toString();
  const hit = cache.get(id);
  if (hit && now - hit.at < (hit.result.ok ? (opts.ttlMs ?? HOUR) : FAIL_TTL)) return { ...hit.result, ...(hit.result.ok ? { cached: true } : {}) } as WmResult<any>;
  if (now < rateLimitedUntil) return { ok: false, reason: `rate limited by World Monitor; retry after ${Math.ceil((rateLimitedUntil - now) / 1000)} s`, retry_after_s: Math.ceil((rateLimitedUntil - now) / 1000) };
  const u = new URL(path, opts.baseUrl ?? BASE);
  for (const [a, b] of Object.entries(params)) u.searchParams.set(a, b);
  const fetchImpl = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  let result: WmResult<any>;
  try {
    const r = await fetchImpl(u.toString(), { headers: { accept: 'application/json', 'X-WorldMonitor-Key': k }, signal: ctrl.signal });
    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after') ?? '60');
      const secs = Number.isFinite(ra) && ra > 0 ? ra : 60;
      rateLimitedUntil = now + secs * 1000;
      result = { ok: false, reason: `rate limited by World Monitor; retry after ${secs} s`, retry_after_s: secs };
    } else if (r.status === 401 || r.status === 403) result = { ok: false, reason: `not connected: World Monitor answered HTTP ${r.status} (check WORLD_MONITOR_API_KEY and the plan)` };
    else if (!r.ok) result = { ok: false, reason: `World Monitor answered HTTP ${r.status}` };
    else result = { ok: true, data: await r.json(), fetched_at: new Date(now).toISOString(), cached: false };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    result = { ok: false, reason: /abort/i.test(msg) ? 'World Monitor timed out' : `World Monitor unreachable: ${msg}` };
  } finally { clearTimeout(timer); }
  cache.set(id, { at: now, result });
  return result;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const list = (j: any, ...keys: string[]): any[] => { for (const k of keys) if (Array.isArray(j?.[k])) return j[k]; return Array.isArray(j) ? j : []; };

/** GET /api/intelligence/v1/get-country-risk → composite score, advisory level, components. */
export async function countryRisk(code: string): Promise<WmResult<CountryRisk>> {
  const r = await get('/api/intelligence/v1/get-country-risk', { country_code: code });
  if (!r.ok) return r;
  const c = r.data?.cii ?? r.data?.risk ?? r.data ?? {};
  return { ...r, data: { score: num(c.combinedScore ?? c.combined_score ?? c.score), level: str(c.advisoryLevel ?? c.advisory_level ?? c.level), components: c.components && typeof c.components === 'object' ? c.components : null, computed_at: str(c.computedAt ?? c.computed_at ?? r.data?.computedAt) } };
}

/** GET /api/conflict/v1/list-acled-events for the last `days` days. */
export async function acledEvents(code: string, days = 30): Promise<WmResult<AcledEvent[]>> {
  const now = (opts.now ?? (() => new Date()))().getTime();
  const start = String(now - days * 86_400_000);
  const r = await get('/api/conflict/v1/list-acled-events', { country: code, start });
  if (!r.ok) return r;
  const rows = list(r.data, 'events', 'data', 'items', 'results').slice(0, 40).map((e: any, i: number): AcledEvent => ({
    id: str(e.event_id_cnty ?? e.eventId ?? e.id) ?? `${code}-${i + 1}`, type: str(e.event_type ?? e.eventType ?? e.type), sub_type: str(e.sub_event_type ?? e.subEventType ?? null),
    admin1: str(e.admin1 ?? e.region), location: str(e.location), actors: str([e.actor1 ?? e.actors, e.actor2].filter(Boolean).join(' vs ')) , fatalities: num(e.fatalities),
    date: str(e.event_date ?? e.eventDate ?? e.date), notes: str(e.notes ?? e.summary),
  }));
  return { ...r, data: rows };
}

/** GET /api/news/v1/list-country-headlines → numbered headlines. */
export async function headlines(code: string): Promise<WmResult<Headline[]>> {
  const r = await get('/api/news/v1/list-country-headlines', { countries: code });
  if (!r.ok) return r;
  const rows = list(r.data, 'headlines', 'articles', 'items', 'data', 'results').slice(0, 12).map((h: any, i: number): Headline => ({
    n: i + 1, title: String(h.title ?? h.headline ?? '').trim() || `headline ${i + 1}`, source: str(h.source?.name ?? h.source ?? h.publisher), url: str(h.url ?? h.link), published_at: str(h.published_at ?? h.publishedAt ?? h.date),
  }));
  return { ...r, data: rows };
}
