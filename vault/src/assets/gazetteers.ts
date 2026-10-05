/**
 * Locating a field (wave 3, docs/vault-hub/wave3/05-markup.md §1.2, P25, P26).
 * Candidates come, in order, from the Vault's own assets (including the
 * Global Energy Monitor units imported by scripts/import-gem.ts), then
 * GeoNames (feature codes OILF and GASF, needs a free username) and Wikidata
 * (instances of oil field, Q211748). Every candidate carries its source and
 * record id; a source that cannot answer is reported in `unavailable`, never
 * passed off as "no results". No coordinate ever comes from the model.
 */
import type { Db } from '../db/client.ts';

export type AssetKind = 'field' | 'block' | 'basin' | 'reservoir' | 'well';
export type Source = 'vault' | 'gem' | 'geonames' | 'wikidata';
export interface Candidate {
  name: string; kind: AssetKind; country: string | null; lat: number | null; lon: number | null;
  source: Source; source_id: string; source_url: string | null; confidence: number;
  asset_id?: string; detail?: Record<string, unknown>;
}
export interface Unavailable { source: Source; reason: string }
export interface LocateOptions { fetch?: typeof fetch; geonamesUser?: string; timeoutMs?: number; limit?: number }
export interface LocateResult { candidates: Candidate[]; unavailable: Unavailable[] }

export const ASSET_KINDS: AssetKind[] = ['field', 'block', 'basin', 'reservoir', 'well'];   // wave 7 PR3: a reservoir sits between a field and its wells
const UA = 'ATC-Vault/1.0 (https://www.alpha-technical-centre.com; vault@alpha-technical-centre.com)';

/** `field:ve:la-victoria-apure`: kind, lower-case country, ascii slug of the name. */
export function slugAssetId(kind: string, country: string | null, name: string): string {
  const slug = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unnamed';
  return `${kind}:${(country ?? 'xx').toLowerCase()}:${slug}`;
}

/** "Point(-70.9 7.6)" → {lon, lat}; null when it is not a WKT point. */
export function parseWikidataCoord(wkt: string | undefined | null): { lon: number; lat: number } | null {
  const m = /^Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(String(wkt ?? '').trim());
  if (!m) return null;
  const lon = Number(m[1]), lat = Number(m[2]);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? { lon, lat } : null;
}

async function fetchJson(fetchImpl: typeof fetch, url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': UA, ...headers } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    const msg = (e as Error).message || String(e);
    throw new Error(/abort/i.test(msg) ? 'timed out' : msg);
  } finally { clearTimeout(timer); }
}

async function fromVault(db: Db, name: string, country: string | null): Promise<Candidate[]> {
  const q = name.toLowerCase();
  const rows = (await db.query<any>(
    `SELECT id, kind, name, country, lat, lon, location_source, source_url, operator, props FROM assets
      WHERE kind = ANY($1::text[]) AND ($2::text IS NULL OR country = $2) AND lower(name) LIKE '%' || $3 || '%' ORDER BY (lower(name) = $3) DESC, name LIMIT 10`,
    [ASSET_KINDS, country, q.replace(/[\\%_]/g, m => '\\' + m)])).rows;
  return rows.map(r => {
    const gem = r.props?.gem;
    return {
      name: r.name, kind: r.kind, country: r.country ?? null, lat: r.lat ?? null, lon: r.lon ?? null,
      source: gem ? 'gem' : 'vault', source_id: gem?.unit_id ? String(gem.unit_id) : r.id, source_url: r.source_url ?? null,
      confidence: r.name.toLowerCase() === q ? 1 : 0.7, asset_id: r.id, detail: gem ?? undefined,
    } as Candidate;
  });
}

async function fromGeonames(fetchImpl: typeof fetch, name: string, country: string | null, user: string, timeoutMs: number): Promise<Candidate[]> {
  const u = new URL('https://secure.geonames.org/searchJSON');
  u.searchParams.set('name', name);
  if (country) u.searchParams.set('country', country);
  u.searchParams.append('featureCode', 'OILF'); u.searchParams.append('featureCode', 'GASF');
  u.searchParams.set('maxRows', '5'); u.searchParams.set('username', user);
  const j = await fetchJson(fetchImpl, u.toString(), timeoutMs);
  if (j?.status?.message) throw new Error(String(j.status.message));
  return (Array.isArray(j?.geonames) ? j.geonames : []).map((g: any) => ({
    name: String(g.name), kind: 'field' as AssetKind, country: g.countryCode ?? country ?? null,
    lat: Number.isFinite(Number(g.lat)) ? Number(g.lat) : null, lon: Number.isFinite(Number(g.lng)) ? Number(g.lng) : null,
    source: 'geonames' as Source, source_id: String(g.geonameId), source_url: `https://www.geonames.org/${g.geonameId}`,
    confidence: String(g.name).toLowerCase() === name.toLowerCase() ? 0.8 : 0.5,
    detail: { feature_code: g.fcode ?? null, admin1: g.adminName1 ?? null },
  }));
}

async function fromWikidata(fetchImpl: typeof fetch, name: string, country: string | null, timeoutMs: number): Promise<Candidate[]> {
  const safe = name.replace(/["\\]/g, ' ').trim();
  const query = `SELECT ?item ?itemLabel ?coord ?countryCode ?operatorLabel WHERE {
  ?item wdt:P31 wd:Q211748 ; rdfs:label ?label .
  FILTER(LANG(?label) IN ("en","es") && CONTAINS(LCASE(?label), LCASE("${safe}")))
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P17 ?c . ?c wdt:P297 ?countryCode }
  OPTIONAL { ?item wdt:P137 ?operator }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
} LIMIT 10`;
  const u = new URL('https://query.wikidata.org/sparql');
  u.searchParams.set('format', 'json'); u.searchParams.set('query', query);
  const j = await fetchJson(fetchImpl, u.toString(), timeoutMs);
  const rows: any[] = j?.results?.bindings ?? [];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const b of rows) {
    const id = String(b.item?.value ?? '').split('/').pop() ?? '';
    if (!id || seen.has(id)) continue;
    const cc = b.countryCode?.value ? String(b.countryCode.value).toUpperCase() : null;
    if (country && cc && cc !== country) continue;
    seen.add(id);
    const c = parseWikidataCoord(b.coord?.value);
    out.push({
      name: String(b.itemLabel?.value ?? id), kind: 'field', country: cc ?? country ?? null, lat: c?.lat ?? null, lon: c?.lon ?? null,
      source: 'wikidata', source_id: id, source_url: `https://www.wikidata.org/wiki/${id}`,
      confidence: String(b.itemLabel?.value ?? '').toLowerCase().startsWith(name.toLowerCase()) ? 0.7 : 0.5,
      detail: { operator: b.operatorLabel?.value ?? null },
    });
  }
  return out;
}

let defaults: LocateOptions = {};
/** Process-wide defaults for every lookup (tests inject fetch; production reads the environment). */
export function configureLocate(o: LocateOptions): void { defaults = { ...defaults, ...o }; }

/** Candidates for a name in a country, Vault first, each with its source; unavailable sources named. */
export async function locate(db: Db, name: string, country: string | null, o: LocateOptions = {}): Promise<LocateResult> {
  const opts = { ...defaults, ...o };
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const geonamesUser = opts.geonamesUser ?? process.env.GEONAMES_USERNAME;
  const unavailable: Unavailable[] = [];
  const vault = await fromVault(db, name, country);
  const [gn, wd] = await Promise.all([
    geonamesUser ? fromGeonames(fetchImpl, name, country, geonamesUser, timeoutMs).catch(e => { unavailable.push({ source: 'geonames', reason: (e as Error).message }); return [] as Candidate[]; })
      : Promise.resolve((unavailable.push({ source: 'geonames', reason: 'GEONAMES_USERNAME not set on the Vault service' }), [] as Candidate[])),
    fromWikidata(fetchImpl, name, country, timeoutMs).catch(e => { unavailable.push({ source: 'wikidata', reason: (e as Error).message }); return [] as Candidate[]; }),
  ]);
  const limit = opts.limit ?? 12;
  return { candidates: [...vault, ...gn, ...wd].slice(0, limit), unavailable: unavailable.sort((a, b) => a.source.localeCompare(b.source)) };
}

/* ── country names (for the GEM import) ─────────────────────────────── */

const ALIASES: Record<string, string> = {
  'russia': 'RU', 'russian federation': 'RU', 'iran': 'IR', 'syria': 'SY', 'vietnam': 'VN', 'viet nam': 'VN', 'laos': 'LA', 'bolivia': 'BO',
  'venezuela': 'VE', 'tanzania': 'TZ', 'democratic republic of the congo': 'CD', 'dr congo': 'CD', 'congo, dem. rep.': 'CD', 'republic of the congo': 'CG', 'congo': 'CG',
  "côte d'ivoire": 'CI', "cote d'ivoire": 'CI', 'ivory coast': 'CI', 'united states': 'US', 'usa': 'US', 'united states of america': 'US', 'united kingdom': 'GB', 'uk': 'GB',
  'south korea': 'KR', 'north korea': 'KP', 'brunei': 'BN', 'timor-leste': 'TL', 'east timor': 'TL', 'moldova': 'MD', 'türkiye': 'TR', 'turkey': 'TR', 'trinidad and tobago': 'TT',
  'myanmar': 'MM', 'burma': 'MM', 'czech republic': 'CZ', 'czechia': 'CZ', 'eswatini': 'SZ', 'swaziland': 'SZ', 'cape verde': 'CV', 'cabo verde': 'CV', 'micronesia': 'FM', 'palestine': 'PS',
};
let byName: Map<string, string> | null = null;
function countryIndex(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  const dn = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a) + String.fromCharCode(b);
    let n: string | undefined; try { n = dn.of(code); } catch { continue; }
    if (n && n !== code) byName.set(n.toLowerCase(), code);
  }
  for (const [k, v] of Object.entries(ALIASES)) byName.set(k, v);
  return byName;
}
/** "Venezuela" → "VE"; null when the name is not recognised. */
export function countryCodeOf(name: string): string | null {
  const k = String(name ?? '').trim().toLowerCase();
  if (!k) return null;
  if (/^[a-z]{2}$/.test(k) && countryIndex().has(new Intl.DisplayNames(['en'], { type: 'region' }).of(k.toUpperCase())?.toLowerCase() ?? '')) return k.toUpperCase();
  return countryIndex().get(k) ?? null;
}
