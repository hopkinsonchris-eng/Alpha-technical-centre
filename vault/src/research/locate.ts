/**
 * Locating the fields a project attached by name (wave 4 follow-up, 1 October 2026). A field that came in
 * from a document proposal, or was typed in, has no coordinates; the research run asks the gazetteers for
 * them (the Vault's own records including the Global Energy Monitor units, GeoNames, Wikidata; never the
 * model). An exact name match in the project's country sets the location and files the dossier; a looser
 * match ("Oficina" for "Oficina Norte") becomes a `research` proposal of kind `location` that a person
 * decides. A field with no candidate is named in the summary so the person can place it by hand.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import { locate, type Candidate, type LocateOptions } from '../assets/gazetteers.ts';
import { fileDossier, type AssetRow } from '../assets/dossier.ts';
import { locationCheck } from '../assets/geo.ts';
import { nameKeywords } from './queries.ts';

export interface LocateField { id: string; name: string; kind: string; country: string | null; lat: number | null; lon: number | null }
export interface LocateOutcome { field_id: string; name: string; outcome: 'located' | 'proposed' | 'none' | 'outside' | 'error'; candidate?: Candidate; match?: 'exact' | 'area'; reason?: string; dossier?: string[]; proposal_id?: string }

const DIRECTION = /^(norte|sur|este|oeste|central|centro|north|south|east|west|upper|lower|alto|bajo|nuevo|nueva|new|old|viejo|vieja|area|área|zona|zone|campo|field|block|bloque)$/i;
const NOISE = /\b(oil|gas|oil and gas|petroleum|field|fields|campo|campo petrolero|yacimiento|block|bloque|project|unit)\b/gi;
export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(NOISE, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** The best candidate for a field: an exact name in the country first, else the strongest area match from a distinctive part of the name. */
export function pickCandidate(field: LocateField, country: string | null, byName: Map<string, Candidate[]>): { candidate: Candidate; match: 'exact' | 'area' } | null {
  const target = normName(field.name);
  const all: { c: Candidate; match: 'exact' | 'area'; score: number }[] = [];
  for (const [asked, cands] of byName) {
    for (const c of cands) {
      if (c.lat == null || c.lon == null) continue;
      if (country && c.country && c.country !== country) continue;
      const cn = normName(c.name);
      if (!cn) continue;
      const exact = cn === target;
      const area = !exact && (target.startsWith(cn + ' ') || target.endsWith(' ' + cn) || target.includes(' ' + cn + ' ') || cn === normName(asked));
      if (!exact && !area) continue;
      const src = c.source === 'gem' ? 3 : c.source === 'vault' ? 2.5 : c.source === 'geonames' ? 2 : 1;
      all.push({ c, match: exact ? 'exact' : 'area', score: (exact ? 10 : 0) + src + (c.confidence ?? 0) });
    }
  }
  if (!all.length) return null;
  all.sort((a, b) => b.score - a.score);
  return { candidate: all[0].c, match: all[0].match };
}

/** Asks the gazetteers for every unlocated field of the project; sets exact matches, proposes area matches. */
export async function locateFields(db: Db, project: { id: string; country: string | null }, fields: LocateField[], by: string, now: Date, o: LocateOptions = {}): Promise<LocateOutcome[]> {
  const out: LocateOutcome[] = [];
  for (const f of fields) {
    if (f.lat != null && f.lon != null) continue;
    // The names to ask for: the field's name, the distinctive parts of a compound name, and each word that is
    // not a direction or a size ("OFICINA NORTE" → Oficina; "Yopales Central" → Yopales), so an area record is found.
    const words = f.name.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4 && !DIRECTION.test(w));
    const names = [...new Set([...nameKeywords([f.name]), ...words].map(n => n.trim()).filter(Boolean))].slice(0, 5);
    const byName = new Map<string, Candidate[]>();
    try {
      for (const n of names) {
        const r = await locate(db, n, project.country ?? f.country ?? null, { ...o, limit: 8 });
        byName.set(n, r.candidates.filter(c => c.asset_id !== f.id));
      }
    } catch (e) { out.push({ field_id: f.id, name: f.name, outcome: 'error', reason: (e as Error).message }); continue; }
    const best = pickCandidate(f, project.country ?? null, byName);
    if (!best) { out.push({ field_id: f.id, name: f.name, outcome: 'none' }); continue; }
    const { candidate: c, match } = best;
    const check = locationCheck(project.country ?? null, { lat: c.lat, lon: c.lon, country: c.country });
    if (check?.outside) { out.push({ field_id: f.id, name: f.name, outcome: 'outside', candidate: c, match, reason: `${c.name} sits in ${check.found}, not ${check.expected}` }); continue; }
    if (match === 'exact') {
      const props = c.detail ? JSON.stringify({ [c.source]: { ...c.detail, ...(c.source_id ? { [c.source === 'gem' ? 'unit_id' : 'id']: c.source_id } : {}) } }) : '{}';
      const row = (await db.query<AssetRow>(
        `UPDATE assets SET lat = $2, lon = $3, location_source = $4, source_url = coalesce(source_url, $5), country = coalesce(country, $6), props = props || $7::jsonb
          WHERE id = $1 RETURNING id, kind, name, country, lat, lon, location_source, source_url, operator, props`,
        [f.id, c.lat, c.lon, c.source, c.source_url, c.country, props])).rows[0];
      const dossier = await fileDossier(db, project.id, row, by, now);
      out.push({ field_id: f.id, name: f.name, outcome: 'located', candidate: c, match, dossier });
      continue;
    }
    const dup = await db.query("SELECT id FROM review_queue WHERE kind = 'research' AND status = 'open' AND payload->>'project_id' = $1 AND payload->>'fact_kind' = 'location' AND payload->>'asset_id' = $2", [project.id, f.id]);
    if (dup.rows.length) { out.push({ field_id: f.id, name: f.name, outcome: 'proposed', candidate: c, match, proposal_id: dup.rows[0].id }); continue; }
    const id = randomUUID();
    const value = `${c.lat}, ${c.lon}`;
    await db.query("INSERT INTO review_queue (id, kind, payload) VALUES ($1, 'research', $2::jsonb)", [id, JSON.stringify({
      project_id: project.id, item_id: null, item_title: null, fact_kind: 'location', value, unit: null, year: null,
      quote: `${c.name} (${c.source}${c.country ? ', ' + c.country : ''}) at ${value}`, asset_id: f.id, asset_name: f.name,
      candidate: { name: c.name, kind: c.kind, country: c.country, lat: c.lat, lon: c.lon, source: c.source, source_id: c.source_id, source_url: c.source_url, detail: c.detail ?? null },
      proposal: `Location for ${f.name}: ${c.name} (${c.source}) at ${value}, an area match`,
    })]);
    out.push({ field_id: f.id, name: f.name, outcome: 'proposed', candidate: c, match, proposal_id: id });
  }
  return out;
}

/** Applies an accepted location proposal to its field and files the dossier. */
export async function applyLocation(db: Db, projectId: string, assetId: string, cand: { lat: number; lon: number; source: string; source_id?: string | null; source_url?: string | null; country?: string | null; detail?: Record<string, unknown> | null }, by: string, now: Date): Promise<{ asset: AssetRow; dossier: string[] } | null> {
  const props = cand.detail ? JSON.stringify({ [cand.source]: { ...cand.detail, ...(cand.source_id ? { [cand.source === 'gem' ? 'unit_id' : 'id']: cand.source_id } : {}) } }) : '{}';
  const row = (await db.query<AssetRow>(
    `UPDATE assets SET lat = $2, lon = $3, location_source = $4, source_url = coalesce(source_url, $5), country = coalesce(country, $6), props = props || $7::jsonb
      WHERE id = $1 RETURNING id, kind, name, country, lat, lon, location_source, source_url, operator, props`,
    [assetId, cand.lat, cand.lon, cand.source, cand.source_url ?? null, cand.country ?? null, props])).rows[0];
  if (!row) return null;
  const dossier = await fileDossier(db, projectId, row, by, now);
  return { asset: row, dossier };
}
