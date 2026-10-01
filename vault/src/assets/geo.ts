/**
 * Which country a point falls in (wave 3 PR 4). The Vault reads the same pruned Natural Earth
 * polygons the Hub's globe draws (hub/geo/countries-110m.json): coarse near coasts, so the
 * answer is a flag for a person to look at, never a reason to refuse. A field whose
 * coordinates fall outside the project's country, or whose gazetteer record names another
 * country, is marked `outside` and the Hub asks before attaching it.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GEO_FILE = path.join(REPO_DIR, 'hub/geo/countries-110m.json');

type Ring = number[][];
interface Feature { iso2: string; name: string; polys: Ring[][]; bbox: [number, number, number, number] }
let features: Feature[] | null = null;
let geoFile = GEO_FILE;
/** Tests point at a smaller file; production reads the committed one. */
export function configureGeo(file: string | null): void { geoFile = file ?? GEO_FILE; features = null; }

function load(): Feature[] {
  if (features) return features;
  features = [];
  if (!existsSync(geoFile)) return features;
  const g = JSON.parse(readFileSync(geoFile, 'utf8'));
  for (const f of g.features ?? []) {
    const polys: Ring[][] = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const poly of polys) for (const [x, y] of poly[0] ?? []) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    features.push({ iso2: String(f.properties?.iso2 ?? ''), name: String(f.properties?.en ?? ''), polys, bbox: [minX, minY, maxX, maxY] });
  }
  return features;
}

function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the polygon data is on disk; without it only gazetteer country codes are compared. */
export function geoAvailable(): boolean { return load().length > 0; }

/** The ISO 3166-1 alpha-2 code of the country containing the point, or null (sea, or no polygons). */
export function countryOfPoint(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const f of load()) {
    const [minX, minY, maxX, maxY] = f.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    for (const poly of f.polys) {
      if (!poly.length || !inRing(poly[0], lon, lat)) continue;
      let hole = false;
      for (let h = 1; h < poly.length; h++) if (inRing(poly[h], lon, lat)) { hole = true; break; }
      if (!hole) return f.iso2;
    }
  }
  return null;
}

export interface LocationCheck { expected: string; found: string | null; method: 'polygon' | 'gazetteer' | 'none'; outside: boolean }

/**
 * Compares where a record says it is with where the project is. The polygon decides when the
 * record has coordinates; the gazetteer's country code otherwise; with neither, nothing is known.
 */
export function locationCheck(expected: string | null, rec: { lat?: number | null; lon?: number | null; country?: string | null }): LocationCheck | null {
  if (!expected) return null;
  if (rec.lat != null && rec.lon != null && geoAvailable()) {
    const found = countryOfPoint(rec.lat, rec.lon);
    // A coastal point the coarse polygons miss is not evidence of anything.
    return { expected, found, method: 'polygon', outside: found !== null && found !== expected };
  }
  if (rec.country) return { expected, found: rec.country, method: 'gazetteer', outside: rec.country !== expected };
  return { expected, found: null, method: 'none', outside: false };
}
