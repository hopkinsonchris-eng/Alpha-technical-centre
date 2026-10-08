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
export interface LocateOptions { fetch?: typeof fetch; geonamesUser?: string; timeoutMs?: number; limit?: number; /** wave 8: the kind asked for drives what the gazetteers are asked (default field) */ kind?: AssetKind }
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

/* Wave 8 (8 Oct 2026, "Fezzan"): what each kind asks the gazetteers for. Before this every lookup asked for oil and
   gas fields only, so a basin or a region (Fezzan, a region of Libya with coordinates on Wikidata and GeoNames) never
   came back whatever kind was chosen. GeoNames feature codes: BSNP petroleum basin, BSND drainage basin, RGN region,
   AREA area, DSRT desert, PLAT plateau, OILF oilfield, GASF gasfield, OILW oil well, WLL well, RESV reservoir. */
const GEONAMES_CODES: Record<AssetKind, string[]> = {
  field: ['OILF', 'GASF'], block: ['OILF', 'GASF', 'AREA', 'RGN'], basin: ['BSNP', 'BSND', 'RGN', 'AREA', 'DSRT', 'PLAT'],
  reservoir: ['OILF', 'GASF', 'RESV'], well: ['OILW', 'WLL', 'OILF', 'GASF'],
};
/** The Wikidata classes that make a record a strong match for the kind; anything else with a place is still offered, weaker. */
const CLASS_WORDS: Record<AssetKind, RegExp> = {
  field: /oil ?field|gas ?field|hydrocarbon|petroleum field|oil and gas/i, block: /block|concession|licen[cs]e|lease|contract area/i,
  basin: /basin|region|landscape|desert|plateau|depression|graben|trough|sub-?basin|geological/i, reservoir: /reservoir|formation|oil ?field|gas ?field/i,
  well: /well|borehole|drilling/i,
};

async function fromGeonames(fetchImpl: typeof fetch, name: string, country: string | null, user: string, timeoutMs: number, kind: AssetKind): Promise<Candidate[]> {
  const u = new URL('https://secure.geonames.org/searchJSON');
  u.searchParams.set('name', name);
  if (country) u.searchParams.set('country', country);
  for (const code of GEONAMES_CODES[kind]) u.searchParams.append('featureCode', code);
  u.searchParams.set('maxRows', '5'); u.searchParams.set('username', user);
  const j = await fetchJson(fetchImpl, u.toString(), timeoutMs);
  if (j?.status?.message) throw new Error(String(j.status.message));
  return (Array.isArray(j?.geonames) ? j.geonames : []).map((g: any) => ({
    name: String(g.name), kind: (/^(OILF|GASF)$/.test(String(g.fcode ?? '')) && kind !== 'well' ? 'field' : kind) as AssetKind, country: g.countryCode ?? country ?? null,
    lat: Number.isFinite(Number(g.lat)) ? Number(g.lat) : null, lon: Number.isFinite(Number(g.lng)) ? Number(g.lng) : null,
    source: 'geonames' as Source, source_id: String(g.geonameId), source_url: `https://www.geonames.org/${g.geonameId}`,
    confidence: String(g.name).toLowerCase() === name.toLowerCase() ? 0.8 : 0.5,
    detail: { feature_code: g.fcode ?? null, admin1: g.adminName1 ?? null },
  }));
}

async function fromWikidata(fetchImpl: typeof fetch, name: string, country: string | null, timeoutMs: number, kind: AssetKind): Promise<Candidate[]> {
  // 1. The text search Wikipedia itself uses: fuzzy on the label and its aliases, in every language.
  const su = new URL('https://www.wikidata.org/w/api.php');
  su.searchParams.set('action', 'wbsearchentities'); su.searchParams.set('search', name.trim()); su.searchParams.set('language', 'en');
  su.searchParams.set('uselang', 'en'); su.searchParams.set('type', 'item'); su.searchParams.set('limit', '10'); su.searchParams.set('format', 'json');
  const sj = await fetchJson(fetchImpl, su.toString(), timeoutMs);
  const ids: string[] = (Array.isArray(sj?.search) ? sj.search : []).map((e: any) => String(e?.id ?? '')).filter((id: string) => /^Q\d+$/.test(id)).slice(0, 10);
  if (!ids.length) return [];
  // 2. What those items are and where: their classes, coordinates, country and operator, in one query.
  const query = `SELECT ?item ?itemLabel ?classLabel ?coord ?countryCode ?operatorLabel WHERE {
  VALUES ?item { ${ids.map(id => 'wd:' + id).join(' ')} }
  OPTIONAL { ?item wdt:P31 ?class }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P17 ?c . ?c wdt:P297 ?countryCode }
  OPTIONAL { ?item wdt:P137 ?operator }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
}`;
  const u = new URL('https://query.wikidata.org/sparql');
  u.searchParams.set('format', 'json'); u.searchParams.set('query', query);
  const j = await fetchJson(fetchImpl, u.toString(), timeoutMs);
  const rows: any[] = j?.results?.bindings ?? [];
  // Several rows per item (one per class): keep the item once, the matching class first, every class in the detail.
  const byId = new Map<string, { row: any; classes: string[] }>();
  for (const b of rows) {
    const id = String(b.item?.value ?? '').split('/').pop() ?? '';
    if (!id) continue;
    const cls = b.classLabel?.value ? String(b.classLabel.value) : '';
    const e = byId.get(id) ?? { row: b, classes: [] };
    if (cls && !e.classes.includes(cls)) e.classes.push(cls);
    if (!e.row.coord?.value && b.coord?.value) e.row = b;
    byId.set(id, e);
  }
  const out: Candidate[] = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (!e) continue;
    const b = e.row;
    const cc = b.countryCode?.value ? String(b.countryCode.value).toUpperCase() : null;
    const c = parseWikidataCoord(b.coord?.value);
    if (!c && !cc) continue;                                    // a boat, a person, a disambiguation page: nothing to place
    if (country && cc && cc !== country) continue;
    if (e.classes.some(k => /disambiguation|Wikimedia|human\b|ship|boat|vehicle|film|album|song/i.test(k))) continue;
    const matching = e.classes.find(k => CLASS_WORDS[kind].test(k));
    out.push({
      name: String(b.itemLabel?.value ?? id), kind, country: cc ?? country ?? null, lat: c?.lat ?? null, lon: c?.lon ?? null,
      source: 'wikidata', source_id: id, source_url: `https://www.wikidata.org/wiki/${id}`,
      confidence: matching ? 0.8 : 0.5,
      detail: { class: matching ?? e.classes[0] ?? null, classes: e.classes, operator: b.operatorLabel?.value ?? null },
    });
  }
  return out.sort((a, z) => z.confidence - a.confidence);
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
  const kind: AssetKind = opts.kind && ASSET_KINDS.includes(opts.kind) ? opts.kind : 'field';
  const unavailable: Unavailable[] = [];
  const vault = await fromVault(db, name, country);
  const [gn, wd] = await Promise.all([
    geonamesUser ? fromGeonames(fetchImpl, name, country, geonamesUser, timeoutMs, kind).catch(e => { unavailable.push({ source: 'geonames', reason: (e as Error).message }); return [] as Candidate[]; })
      : Promise.resolve((unavailable.push({ source: 'geonames', reason: 'GEONAMES_USERNAME not set on the Vault service' }), [] as Candidate[])),
    fromWikidata(fetchImpl, name, country, timeoutMs, kind).catch(e => { unavailable.push({ source: 'wikidata', reason: (e as Error).message }); return [] as Candidate[]; }),
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
