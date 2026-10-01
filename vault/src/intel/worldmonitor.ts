/**
 * World Monitor (wave 3, docs/vault-hub/wave3/05-markup.md §1.5, Option B, W3-D3; widened in
 * wave 3 PR 4 to everything the feed holds for a country). Read server-side with the key in
 * WORLD_MONITOR_API_KEY, which never reaches a browser. Shapes follow the published OpenAPI
 * bundle (api.worldmonitor.app/openapi.json): epoch-millisecond timestamps become ISO strings,
 * enum names lose their prefixes, and every reader returns {ok:true, data} or {ok:false, reason}
 * so a section the plan does not include ("needs World Monitor Pro") never hides the others.
 * Every call is cached in memory for an hour per (endpoint, country); a 429 is honoured for
 * its Retry-After and reported, never retried in a loop; 401/403 are reported as not connected
 * or Pro-gated with the reason. Without a key every reader says not connected: nothing is
 * simulated.
 */

export interface WmOptions { fetch?: typeof fetch; apiKey?: string | null; baseUrl?: string; now?: () => Date; ttlMs?: number; timeoutMs?: number }
export type WmResult<T> = { ok: true; data: T; fetched_at: string; cached: boolean } | { ok: false; reason: string; retry_after_s?: number; pro?: boolean };

export interface CountryRisk {
  score: number | null; level: string | null; trend: string | null; static_baseline: number | null; dynamic_score: number | null;
  components: Record<string, number> | null; computed_at: string | null; methodology: string | null; advisory_provenance: string | null;
  sanctions_active: boolean | null; sanctions_count: number | null; region: string | null;
}
export interface AcledEvent { id: string; type: string | null; sub_type: string | null; admin1: string | null; location: string | null; lat: number | null; lon: number | null; actors: string | null; fatalities: number | null; date: string | null; notes: string | null; source: string | null }
export interface UcdpEvent { id: string; type: string | null; side_a: string | null; side_b: string | null; deaths: number | null; deaths_low: number | null; deaths_high: number | null; date: string | null; lat: number | null; lon: number | null }
export interface Headline { n: number; title: string; source: string | null; url: string | null; published_at: string | null }
export interface IntelBrief { brief: string; model: string | null; generated_at: string | null; sources: { title: string; source: string | null; url: string | null; published_at: string | null }[]; evidence: { id: string; kind: string | null; label: string; value: string | null; fact: string | null; as_of: string | null; url: string | null }[] }
export interface Coverage { window_hours: number | null; generated_at: string | null; headlines: Headline[]; events: { at: string | null; lane: string | null; label: string; severity: string | null; origin: string | null; source: string | null }[]; sources: { source: string; state: string | null; detail: string | null; contributed: number | null }[]; degraded: boolean }
export interface EnergyProfile { mix_year: number | null; mix: Record<string, number> | null; import_share: number | null; oil: Record<string, number | string | null> | null; gas: Record<string, number | string | null> | null; stocks: Record<string, number | string | null> | null; raw: Record<string, unknown> }
export interface Port { id: string; name: string; lat: number | null; lon: number | null; tanker_calls_30d: number | null; trend_pct: number | null; import_dwt: number | null; export_dwt: number | null; anomaly: boolean }
export interface CountryFacts { name: string | null; capital: string | null; population: number | null; area_km2: number | null; head_of_state: string | null; head_of_state_title: string | null; languages: string[]; currencies: string[]; summary: string | null }
export interface Humanitarian { events_total: number | null; political_violence: number | null; fatalities: number | null; demonstrations: number | null; period: string | null; updated_at: string | null }
export interface Advisory { title: string; url: string | null; date: string | null; source: string | null; source_country: string | null; level: string | null }
export interface Sanctions { entries: number | null; new_entries: number | null; vessels: number | null; aircraft: number | null; dataset_date: string | null; recent: { name: string; type: string | null; programs: string[]; effective_at: string | null; is_new: boolean }[] }
export interface Resilience { score: number | null; level: string | null; trend: string | null; change_30d: number | null; low_confidence: boolean; domains: { id: string; score: number | null; weight: number | null }[] }
export interface Outage { id: string; title: string; url: string | null; detected_at: string | null; ended_at: string | null; severity: string | null; region: string | null; cause: string | null }
export interface IntelRecord { id: string; domain: string | null; category: string | null; title: string; summary: string | null; url: string | null; occurred_at: string | null; score: number | null }

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
export const NEEDS_PRO = 'needs World Monitor Pro (this endpoint is Pro-gated on the current plan)';

const nowMs = () => (opts.now ?? (() => new Date()))().getTime();

async function get(path: string, params: Record<string, string>): Promise<WmResult<any>> {
  const k = key();
  if (!k) return { ok: false, reason: NOT_CONNECTED };
  const now = nowMs();
  const id = path + '?' + new URLSearchParams(params).toString();
  const hit = cache.get(id);
  if (hit && now - hit.at < (hit.result.ok ? (opts.ttlMs ?? HOUR) : FAIL_TTL)) return { ...hit.result, ...(hit.result.ok ? { cached: true } : {}) } as WmResult<any>;
  if (now < rateLimitedUntil) { const s = Math.ceil((rateLimitedUntil - now) / 1000); return { ok: false, reason: `rate limited by World Monitor; retry after ${s} s`, retry_after_s: s }; }
  const u = new URL(path, opts.baseUrl ?? BASE);
  for (const [a, b] of Object.entries(params)) u.searchParams.set(a, b);
  const fetchImpl = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10000);
  let result: WmResult<any>;
  try {
    const r = await fetchImpl(u.toString(), { headers: { accept: 'application/json', 'X-WorldMonitor-Key': k }, signal: ctrl.signal });
    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after') ?? '60');
      const secs = Number.isFinite(ra) && ra > 0 ? ra : 60;
      rateLimitedUntil = now + secs * 1000;
      result = { ok: false, reason: `rate limited by World Monitor; retry after ${secs} s`, retry_after_s: secs };
    } else if (r.status === 401) result = { ok: false, reason: 'not connected: World Monitor answered HTTP 401 (check WORLD_MONITOR_API_KEY)' };
    else if (r.status === 403 || r.status === 402) {
      let code = ''; try { code = String((await r.json())?.code ?? ''); } catch { /* no body */ }
      result = /lapsed/i.test(code) ? { ok: false, reason: 'not connected: the World Monitor subscription has lapsed', pro: true } : { ok: false, reason: NEEDS_PRO, pro: true };
    }
    else if (!r.ok) result = { ok: false, reason: `World Monitor answered HTTP ${r.status}` };
    else result = { ok: true, data: await r.json(), fetched_at: new Date(now).toISOString(), cached: false };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    result = { ok: false, reason: /abort/i.test(msg) ? 'World Monitor timed out' : `World Monitor unreachable: ${msg}` };
  } finally { clearTimeout(timer); }
  cache.set(id, { at: now, result });
  return result;
}

/* ── shape helpers ───────────────────────────────────────────────────── */
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
/** Epoch milliseconds (number or int64 string), seconds, or an ISO string → ISO; null otherwise. */
export const whenIso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== '' && /^-?\d+(\.\d+)?$/.test(String(v).trim())) {
    if (n <= 0) return null;                                             // 0 is "not set" in the feed, never 1970
    const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : n;
    const d = new Date(ms); return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d.toISOString();
};
/** "TREND_DIRECTION_RISING" → "rising"; "SEVERITY_LEVEL_HIGH" → "high". */
export const enumWord = (v: unknown): string | null => { const s = str(v); if (!s) return null; const m = /_([A-Z]+)$/.exec(s); const w = (m ? m[1] : s).toLowerCase(); return w === 'unspecified' ? null : w; };
const list = (j: any, ...keys: string[]): any[] => { for (const k of keys) if (Array.isArray(j?.[k])) return j[k]; return Array.isArray(j) ? j : []; };

/* ── readers ─────────────────────────────────────────────────────────── */

/** GET /api/intelligence/v1/get-country-risk → the Country Instability Index for the country. */
export async function countryRisk(code: string): Promise<WmResult<CountryRisk>> {
  const r = await get('/api/intelligence/v1/get-country-risk', { country_code: code });
  if (!r.ok) return r;
  const d = r.data ?? {}, c = d.cii ?? {};
  const comps = c.components && typeof c.components === 'object' ? Object.fromEntries(Object.entries(c.components).map(([k, v]) => [k, num(v) ?? 0])) : null;
  return { ...r, data: {
    score: num(c.combinedScore ?? d.combinedScore), level: str(d.advisoryLevel ?? c.advisoryLevel), trend: enumWord(c.trend), static_baseline: num(c.staticBaseline), dynamic_score: num(c.dynamicScore),
    components: comps, computed_at: whenIso(c.computedAt), methodology: str(c.methodologyVersion), advisory_provenance: str(c.advisoryProvenance),
    sanctions_active: bool(d.sanctionsActive), sanctions_count: num(d.sanctionsCount), region: str(c.region),
  } };
}

/** GET /api/conflict/v1/list-acled-events for the last `days` days (start/end are epoch milliseconds). */
export async function acledEvents(code: string, days = 30): Promise<WmResult<AcledEvent[]>> {
  const now = nowMs();
  const r = await get('/api/conflict/v1/list-acled-events', { country: code, start: String(now - days * 86_400_000), end: String(now) });
  if (!r.ok) return r;
  const rows = list(r.data, 'events').slice(0, 60).map((e: any, i: number): AcledEvent => ({
    id: str(e.id ?? e.event_id_cnty) ?? `${code}-${i + 1}`, type: str(e.eventType ?? e.event_type), sub_type: str(e.subEventType ?? e.sub_event_type), admin1: str(e.admin1), location: str(e.locationName ?? (typeof e.location === 'string' ? e.location : null)),
    lat: num(e.location?.latitude), lon: num(e.location?.longitude), actors: Array.isArray(e.actors) ? e.actors.filter(Boolean).join(' vs ') || null : str([e.actor1, e.actor2].filter(Boolean).join(' vs ')),
    fatalities: num(e.fatalities), date: whenIso(e.occurredAt ?? e.event_date ?? e.date), notes: str(e.notes), source: str(e.source),
  }));
  rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return { ...r, data: rows };
}

/** GET /api/conflict/v1/list-ucdp-events for the last `days` days. */
export async function ucdpEvents(code: string, days = 90): Promise<WmResult<UcdpEvent[]>> {
  const now = nowMs();
  const r = await get('/api/conflict/v1/list-ucdp-events', { country: code, start: String(now - days * 86_400_000), end: String(now) });
  if (!r.ok) return r;
  return { ...r, data: list(r.data, 'events').slice(0, 40).map((e: any, i: number): UcdpEvent => ({
    id: str(e.id) ?? `${code}-u${i + 1}`, type: enumWord(e.violenceType), side_a: str(e.sideA), side_b: str(e.sideB), deaths: num(e.deathsBest), deaths_low: num(e.deathsLow), deaths_high: num(e.deathsHigh),
    date: whenIso(e.dateStart), lat: num(e.location?.latitude), lon: num(e.location?.longitude),
  })) };
}

/** GET /api/news/v1/list-country-headlines?country_codes=XX → the country's bucket of headlines. */
export async function headlines(code: string): Promise<WmResult<Headline[]>> {
  const r = await get('/api/news/v1/list-country-headlines', { country_codes: code });
  if (!r.ok) return r;
  const bucket = r.data?.countries?.[code] ?? r.data?.countries?.[code.toLowerCase()] ?? null;
  const rows = list(bucket, 'items', 'headlines').slice(0, 15).map((h: any, i: number): Headline => ({
    n: i + 1, title: String(h.title ?? h.headline ?? '').trim() || `headline ${i + 1}`, source: str(h.source?.name ?? h.source ?? h.publisher), url: str(h.link ?? h.url), published_at: whenIso(h.publishedAt ?? h.published_at ?? h.date),
  }));
  return { ...r, data: rows };
}

/** GET /api/intelligence/v1/get-country-intel-brief (Pro): World Monitor's own strategic brief with its sources and evidence. */
export async function intelBrief(code: string): Promise<WmResult<IntelBrief>> {
  const r = await get('/api/intelligence/v1/get-country-intel-brief', { country_code: code });
  if (!r.ok) return r;
  const d = r.data ?? {};
  return { ...r, data: {
    brief: String(d.brief ?? '').trim(), model: str(d.model), generated_at: whenIso(d.generatedAt),
    sources: list(d, 'sources').map((s: any) => ({ title: String(s.title ?? s.url ?? ''), source: str(s.source), url: str(s.url), published_at: whenIso(s.publishedAt) })),
    evidence: list(d, 'evidence').map((e: any, i: number) => ({ id: str(e.id) ?? `e${i + 1}`, kind: str(e.kind), label: String(e.label ?? ''), value: str(e.value), fact: str(e.factText), as_of: whenIso(e.asOf), url: str(e.url) })),
  } };
}

/** GET /api/intelligence/v1/get-country-coverage (Pro): clustered incidents and headlines over a window. */
export async function coverage(code: string, windowHours = 72): Promise<WmResult<Coverage>> {
  const r = await get('/api/intelligence/v1/get-country-coverage', { country_code: code, window_hours: String(windowHours), limit: '40' });
  if (!r.ok) return r;
  const d = r.data ?? {};
  return { ...r, data: {
    window_hours: num(d.windowHours), generated_at: whenIso(d.generatedAt),
    headlines: list(d, 'headlines').map((h: any, i: number): Headline => ({ n: i + 1, title: String(h.title ?? ''), source: str(h.source), url: str(h.url), published_at: whenIso(h.publishedAtMs ?? h.publishedAt) })),
    events: list(d, 'events').map((e: any) => ({ at: whenIso(e.timestampMs ?? e.occurredAt), lane: str(e.lane), label: String(e.label ?? ''), severity: str(e.severity), origin: str(e.origin), source: str(e.source) })),
    sources: list(d, 'sources').map((s: any) => ({ source: String(s.source ?? ''), state: str(s.state), detail: str(s.detail), contributed: num(s.contributed) })),
    degraded: !!d.degraded,
  } };
}

/** GET /api/intelligence/v1/get-country-energy-profile: the mix, oil and gas demand and imports, stocks. */
export async function energyProfile(code: string): Promise<WmResult<EnergyProfile>> {
  const r = await get('/api/intelligence/v1/get-country-energy-profile', { country_code: code });
  if (!r.ok) return r;
  const d = r.data ?? {};
  const mix = d.mixAvailable ? { coal: num(d.coalShare) ?? 0, gas: num(d.gasShare) ?? 0, oil: num(d.oilShare) ?? 0, nuclear: num(d.nuclearShare) ?? 0, renewables: num(d.renewShare) ?? 0, hydro: num(d.hydroShare) ?? 0, wind: num(d.windShare) ?? 0, solar: num(d.solarShare) ?? 0 } : null;
  const oil = d.jodiOilAvailable ? { data_month: str(d.jodiOilDataMonth), crude_imports_kbd: num(d.crudeImportsKbd), gasoline_demand_kbd: num(d.gasolineDemandKbd), gasoline_imports_kbd: num(d.gasolineImportsKbd), diesel_demand_kbd: num(d.dieselDemandKbd), diesel_imports_kbd: num(d.dieselImportsKbd), jet_demand_kbd: num(d.jetDemandKbd), jet_imports_kbd: num(d.jetImportsKbd), lpg_demand_kbd: num(d.lpgDemandKbd), lpg_imports_kbd: num(d.lpgImportsKbd) } : null;
  const gas = d.jodiGasAvailable ? { data_month: str(d.jodiGasDataMonth), total_demand_tj: num(d.gasTotalDemandTj), lng_imports_tj: num(d.gasLngImportsTj), pipe_imports_tj: num(d.gasPipeImportsTj), lng_share: num(d.gasLngShare), storage_fill_pct: d.gasStorageAvailable ? num(d.gasStorageFillPct) : null, storage_trend: d.gasStorageAvailable ? str(d.gasStorageTrend) : null } : null;
  const stocks = d.ieaStocksAvailable ? Object.fromEntries(Object.entries(d).filter(([k]) => /^ieaStocks/.test(k) && k !== 'ieaStocksAvailable').map(([k, v]) => [k.replace(/^ieaStocks/, '').replace(/^[A-Z]/, m => m.toLowerCase()), typeof v === 'number' ? v : str(v)])) : null;
  return { ...r, data: { mix_year: num(d.mixYear), mix, import_share: num(d.importShare), oil, gas, stocks, raw: d } };
}

/** GET /api/intelligence/v1/get-country-port-activity: tanker traffic by port. */
export async function portActivity(code: string): Promise<WmResult<Port[]>> {
  const r = await get('/api/intelligence/v1/get-country-port-activity', { country_code: code });
  if (!r.ok) return r;
  return { ...r, data: list(r.data, 'ports').map((p: any, i: number): Port => ({ id: str(p.portId) ?? `p${i + 1}`, name: String(p.portName ?? p.portId ?? ''), lat: num(p.lat), lon: num(p.lon), tanker_calls_30d: num(p.tankerCalls30d), trend_pct: num(p.trendDeltaPct), import_dwt: num(p.importTankerDwt), export_dwt: num(p.exportTankerDwt), anomaly: !!p.anomalySignal })) };
}

/** GET /api/intelligence/v1/get-country-facts: Wikidata and Wikipedia basics. */
export async function countryFacts(code: string): Promise<WmResult<CountryFacts>> {
  const r = await get('/api/intelligence/v1/get-country-facts', { country_code: code });
  if (!r.ok) return r;
  const d = r.data ?? {};
  return { ...r, data: { name: str(d.countryName), capital: str(d.capital), population: num(d.population), area_km2: num(d.areaSqKm), head_of_state: str(d.headOfState), head_of_state_title: str(d.headOfStateTitle), languages: list(d, 'languages').map(String), currencies: list(d, 'currencies').map(String), summary: str(d.wikipediaSummary) } };
}

/** GET /api/conflict/v1/get-humanitarian-summary: HAPI conflict totals for the reference period. */
export async function humanitarian(code: string): Promise<WmResult<Humanitarian>> {
  const r = await get('/api/conflict/v1/get-humanitarian-summary', { country_code: code });
  if (!r.ok) return r;
  const s = r.data?.summary ?? r.data ?? {};
  return { ...r, data: { events_total: num(s.conflictEventsTotal), political_violence: num(s.conflictPoliticalViolenceEvents), fatalities: num(s.conflictFatalities), demonstrations: num(s.conflictDemonstrations), period: str(s.referencePeriod), updated_at: whenIso(s.updatedAt) } };
}

/** GET /api/intelligence/v1/list-security-advisories, kept to the country (the list covers everyone). */
export async function advisories(code: string): Promise<WmResult<Advisory[]>> {
  const r = await get('/api/intelligence/v1/list-security-advisories', {});
  if (!r.ok) return r;
  const rows = list(r.data, 'advisories').filter((a: any) => String(a.country ?? '').toUpperCase() === code).map((a: any): Advisory => ({ title: String(a.title ?? ''), url: str(a.link), date: whenIso(a.pubDate), source: str(a.source), source_country: str(a.sourceCountry), level: str(a.level) }));
  const by = r.data?.byCountry?.[code];
  if (!rows.length && by) rows.push({ title: String(by), url: null, date: null, source: 'World Monitor', source_country: null, level: null });
  return { ...r, data: rows };
}

/** GET /api/sanctions/v1/list-sanctions-pressure (Pro), kept to the country. */
export async function sanctions(code: string): Promise<WmResult<Sanctions>> {
  const r = await get('/api/sanctions/v1/list-sanctions-pressure', { max_items: '200' });
  if (!r.ok) return r;
  const d = r.data ?? {};
  const c = list(d, 'countries').find((x: any) => String(x.countryCode ?? '').toUpperCase() === code);
  const recent = list(d, 'entries').filter((e: any) => (e.countryCodes ?? []).map((x: string) => x.toUpperCase()).includes(code)).slice(0, 12)
    .map((e: any) => ({ name: String(e.name ?? ''), type: enumWord(e.entityType), programs: list(e, 'programs').map(String), effective_at: whenIso(e.effectiveAt), is_new: !!e.isNew }));
  return { ...r, data: { entries: num(c?.entryCount), new_entries: num(c?.newEntryCount), vessels: num(c?.vesselCount), aircraft: num(c?.aircraftCount), dataset_date: str(d.datasetDate), recent } };
}

/** GET /api/resilience/v1/get-resilience-score (Pro): the Country Resilience Index. */
export async function resilience(code: string): Promise<WmResult<Resilience>> {
  const r = await get('/api/resilience/v1/get-resilience-score', { countryCode: code });
  if (!r.ok) return r;
  const d = r.data ?? {};
  return { ...r, data: { score: num(d.overallScore), level: str(d.level), trend: str(d.trend), change_30d: num(d.change30d), low_confidence: !!d.lowConfidence, domains: list(d, 'domains').map((x: any) => ({ id: String(x.id ?? ''), score: num(x.score), weight: num(x.weight) })) } };
}

/** GET /api/infrastructure/v1/list-internet-outages for the last `days` days. */
export async function outages(code: string, days = 30): Promise<WmResult<Outage[]>> {
  const now = nowMs();
  const r = await get('/api/infrastructure/v1/list-internet-outages', { country: code, start: String(now - days * 86_400_000), end: String(now) });
  if (!r.ok) return r;
  return { ...r, data: list(r.data, 'outages').slice(0, 20).map((o: any, i: number): Outage => ({ id: str(o.id) ?? `o${i + 1}`, title: String(o.title ?? ''), url: str(o.link), detected_at: whenIso(o.detectedAt), ended_at: whenIso(o.endedAt), severity: enumWord(o.severity), region: str(o.region), cause: str(o.cause) })) };
}

/** GET /api/intelligence/v1/get-intel-timeline (Pro): the durable intelligence store for the country, newest first. */
export async function intelTimeline(code: string, limit = 40): Promise<WmResult<IntelRecord[]>> {
  const r = await get('/api/intelligence/v1/get-intel-timeline', { country: code, limit: String(limit) });
  if (!r.ok) return r;
  return { ...r, data: list(r.data, 'records').map((x: any, i: number): IntelRecord => ({ id: str(x.id) ?? `r${i + 1}`, domain: str(x.domain), category: str(x.category), title: String(x.title ?? ''), summary: str(x.summary), url: str(x.sourceUrl), occurred_at: whenIso(x.occurredAt), score: num(x.score) })) };
}

/* ── research readers (wave 4) ───────────────────────────────────────── */

export interface GdeltArticle { title: string; url: string; source: string | null; date: string | null; language: string | null; tone: number | null }
export interface CompanyProfile { name: string | null; domain: string | null; description: string | null; location: string | null; website: string | null; founded: number | null; cik: string | null; ticker: string | null; industry: string | null; country: string | null; market_cap_musd: number | null; recent_filings: { form: string | null; date: string | null; url: string | null }[]; sources: string[] }
export interface CompanySignal { type: string | null; title: string; url: string | null; source: string | null; tier: number | null; at: string | null; strength: string | null }
export interface SecFiling { company: string; cik: string | null; form: string; file_date: string | null; items: string[]; url: string | null; accession: string | null }

/** GDELT writes its dates as 20260930T100000Z; anything else goes through whenIso. */
const gdeltDate = (v: unknown): string | null => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(v ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : whenIso(v);
};
/** GET /api/intelligence/v1/search-gdelt-documents: GDELT GKG articles for a query. */
export async function gdeltDocuments(query: string, o: { maxRecords?: number; timespan?: string; sort?: string } = {}): Promise<WmResult<GdeltArticle[]>> {
  const r = await get('/api/intelligence/v1/search-gdelt-documents', { query, max_records: String(o.maxRecords ?? 25), timespan: o.timespan ?? '1y', sort: o.sort ?? 'DateDesc' });
  if (!r.ok) return r;
  if (r.data?.error && !list(r.data, 'articles').length) return { ok: false, reason: `GDELT: ${String(r.data.error)}` };
  const rows = list(r.data, 'articles').filter((a: any) => a && (a.url || a.title)).map((a: any): GdeltArticle => ({ title: String(a.title ?? a.url ?? '').trim(), url: String(a.url ?? ''), source: str(a.source), date: gdeltDate(a.seendate ?? a.date), language: str(a.language), tone: num(a.tone) }));
  return { ...r, data: rows };
}

/** GET /api/intelligence/v1/get-company-enrichment by name (or domain). */
export async function companyEnrichment(name: string, domain?: string): Promise<WmResult<CompanyProfile>> {
  const r = await get('/api/intelligence/v1/get-company-enrichment', domain ? { domain } : { name });
  if (!r.ok) return r;
  const d = r.data ?? {}, c = d.company ?? {}, m = d.market ?? {};
  return { ...r, data: {
    name: str(c.name), domain: str(c.domain), description: str(c.description), location: str(c.location), website: str(c.website), founded: num(c.founded), cik: str(c.cik), ticker: str(c.ticker),
    industry: str(m.industry), country: str(m.country), market_cap_musd: num(m.marketCapMusd),
    recent_filings: list(d.secFilings, 'recentFilings').slice(0, 10).map((f: any) => ({ form: str(f.form ?? f.formType), date: whenIso(f.filedAt ?? f.fileDate ?? f.date), url: str(f.url ?? f.link) })),
    sources: list(d, 'sources').map(String),
  } };
}

/** GET /api/intelligence/v1/list-company-signals: SEC 8-K material events and news mentions for a company. */
export async function companySignals(company: string): Promise<WmResult<CompanySignal[]>> {
  const r = await get('/api/intelligence/v1/list-company-signals', { company });
  if (!r.ok) return r;
  return { ...r, data: list(r.data, 'signals').slice(0, 30).map((x: any): CompanySignal => ({ type: str(x.type), title: String(x.title ?? '').trim(), url: str(x.url), source: str(x.source), tier: num(x.sourceTier), at: whenIso(x.timestampMs), strength: str(x.strength) })) };
}

/** GET /api/intelligence/v1/search-sec-filings: full-text search over EDGAR. */
export async function secFilings(query: string, o: { forms?: string; years?: number; limit?: number } = {}): Promise<WmResult<SecFiling[]>> {
  const now = nowMs();
  const start = new Date(now - (o.years ?? 2) * 365 * 86_400_000).toISOString().slice(0, 10);
  const r = await get('/api/intelligence/v1/search-sec-filings', { query, forms: o.forms ?? '10-K,20-F,6-K,8-K', start_date: start, end_date: new Date(now).toISOString().slice(0, 10), limit: String(o.limit ?? 10) });
  if (!r.ok) return r;
  return { ...r, data: list(r.data, 'results').map((x: any): SecFiling => ({ company: String(x.company ?? ''), cik: str(x.cik), form: String(x.form ?? ''), file_date: whenIso(x.fileDate)?.slice(0, 10) ?? null, items: list(x, 'items').map(String), url: str(x.url), accession: str(x.accession) })) };
}
