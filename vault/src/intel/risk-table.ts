/**
 * The risk table's arithmetic (wave 8, docs/vault-hub/wave8/01-risk-lens.md §2). Pure functions, stated once
 * so the route, its tests and the design note agree. The five columns are the opportunity register's
 * (Geopolitical, Sanctions, Security, Technical, Commercial); the first three are read from World Monitor,
 * the last two are what a person entered in the project's register block. Overall is the register's rule:
 * the mean of the three highest columns that have a value. Every live cell carries the formula in words.
 */

export const RISK_COLUMNS = ['geopolitical', 'sanctions', 'security', 'technical', 'commercial'] as const;
export type RiskColumn = typeof RISK_COLUMNS[number];
export type CellStatus = 'live' | 'entered' | 'missing' | 'unavailable';
export interface RiskCell { score: number | null; status: CellStatus; source: string; as_of: string | null; evidence: string }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;

/** Great-circle distance in kilometres (haversine, R = 6371 km). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180, R = 6371;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Events within `radiusKm` of a point: count, fatalities and the nearest distance. Events without coordinates are not counted. */
export function nearby(events: { lat: number | null; lon: number | null; fatalities: number | null }[], lat: number, lon: number, radiusKm = 200): { events: number; fatalities: number; nearest_km: number | null } {
  let n = 0, f = 0, nearest: number | null = null;
  for (const e of events) {
    if (typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
    const d = distanceKm(lat, lon, e.lat, e.lon);
    if (d > radiusKm) continue;
    n++; f += e.fatalities ?? 0;
    if (nearest === null || d < nearest) nearest = d;
  }
  return { events: n, fatalities: f, nearest_km: nearest === null ? null : Math.round(nearest) };
}

/**
 * Sanctions column: 5 when the country carries no active OFAC designations; when it does, 40 plus 20 per decade of
 * designated entities (1 entity → 40, 10 → 60, 100 → 80, 1,000 → 100). The scale is coarse on purpose: the cell says
 * "sanctions matter here and roughly how much", the evidence names the count, and the Sanctions section of the
 * country pack carries the rest.
 */
export function sanctionsScore(active: boolean | null, count: number | null): number | null {
  if (active === null) return null;
  if (!active) return 5;
  return Math.round(clamp(40 + 20 * Math.log10(Math.max(1, count ?? 1)), 40, 100));
}

/** Security column: 10 at rest, plus 8 per ACLED event and 3 per fatality within the window and radius, capped at 100. */
export function securityScore(events: number | null, fatalities: number | null): number | null {
  if (events === null) return null;
  return Math.min(100, 10 + 8 * events + 3 * (fatalities ?? 0));
}

/** Overall: the register's rule, the mean of the three highest columns with a value, rounded; null when none has one. */
export function overallScore(cells: Record<RiskColumn, RiskCell>): number | null {
  const v = RISK_COLUMNS.map(k => cells[k].score).filter((x): x is number => typeof x === 'number').sort((a, b) => b - a).slice(0, 3);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
}

/** A hand-entered column from the project's register block (`risks.Technical`, any case), or missing. */
export function enteredCell(register: Record<string, unknown> | null | undefined, column: RiskColumn): RiskCell {
  const risks = register && typeof register.risks === 'object' && register.risks ? register.risks as Record<string, unknown> : {};
  const key = Object.keys(risks).find(k => k.toLowerCase() === column);
  const v = key === undefined ? undefined : risks[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  if (n === null) return { score: null, status: 'missing', source: 'project register', as_of: null, evidence: `${column[0].toUpperCase()}${column.slice(1)} is not entered on this project's register; no feed can supply it.` };
  return { score: clamp(n, 0, 100), status: 'entered', source: 'project register', as_of: null, evidence: `${column[0].toUpperCase()}${column.slice(1)} ${clamp(n, 0, 100)} as entered on the project's register.` };
}

export const unavailable = (source: string, reason: string): RiskCell => ({ score: null, status: 'unavailable', source, as_of: null, evidence: reason });
