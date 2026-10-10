/**
 * The World Monitor risk log (wave 8, docs/vault-hub/wave8/01-risk-on-the-map.md, W8-AC1 and W8-AC6). The countries
 * summary records each reading once per computed_at (append-only, migration 013) and reads back the previous distinct
 * reading, so the Hub can say "+16 since 1 Sep" and the connector can hand Claude the change beside the score. The
 * lines for a project's context come from the same cached adapter calls the Hub's intelligence card uses; nothing is
 * fetched in the browser and the key never leaves the server.
 */
import type { Db } from '../db/client.ts';
import { advisories, countryRisk, worldMonitorConfigured, type CountryRisk } from './worldmonitor.ts';

export interface RiskChange { change: number | null; previous_computed_at: string | null }

const iso = (v: unknown): string | null => { if (!v) return null; const d = v instanceof Date ? v : new Date(String(v)); return isNaN(d.getTime()) ? null : d.toISOString(); };
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Appends the reading when it is new (one row per country and computed_at) and answers the change since the previous one. */
export async function recordRisk(db: Db, country: string, r: CountryRisk, fetchedAt: string): Promise<RiskChange> {
  const computedAt = iso(r.computed_at);
  if (computedAt && r.score !== null) {
    await db.query(
      `INSERT INTO country_risk_log (country, score, level, trend, sanctions_active, sanctions_count, computed_at, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (country, computed_at) DO NOTHING`,
      [country, r.score, r.level, r.trend, r.sanctions_active, r.sanctions_count, computedAt, fetchedAt]);
  }
  const prev = (await db.query<{ score: string | number | null; computed_at: unknown }>(
    `SELECT score, computed_at FROM country_risk_log WHERE country = $1 AND ($2::timestamptz IS NULL OR computed_at < $2::timestamptz) ORDER BY computed_at DESC LIMIT 1`,
    [country, computedAt])).rows[0];
  if (!prev || prev.score === null || r.score === null) return { change: null, previous_computed_at: null };
  return { change: round1(r.score - Number(prev.score)), previous_computed_at: iso(prev.computed_at) };
}

/** The connector's risk block for a project's country: nothing without a key or when the feed refuses (W8-AC6). */
export async function countryRiskLines(db: Db, country: string): Promise<string[]> {
  if (!worldMonitorConfigured()) return [];
  const r = await countryRisk(country);
  if (!r.ok) return [];
  const d = r.data;
  const log = await recordRisk(db, country, d, r.fetched_at);
  const score = d.score === null ? 'no index' : String(Math.round(d.score));
  const lines = ['', `## Country risk (World Monitor, ${country})`, '',
    `- Instability index: ${score} (${d.level ?? 'no advisory'}), trend ${d.trend ?? 'unknown'}${d.computed_at ? `, as of ${d.computed_at.slice(0, 10)}` : ''}; OFAC-designated entities linked ${d.sanctions_active ? (d.sanctions_count ?? '?') : 'none recorded'}`,
    log.change === null ? '- Change: first reading on record' : `- Change: ${log.change > 0 ? '+' : ''}${log.change} since ${log.previous_computed_at!.slice(0, 10)}`];
  const adv = await advisories(country);
  if (adv.ok) for (const a of adv.data.slice(0, 5)) lines.push(`- Advisory: ${a.title} (${[a.source, a.level ? `level ${a.level}` : null, a.date ? a.date.slice(0, 10) : null].filter(Boolean).join(', ')})`);
  lines.push('- Figures quoted for screening under World Monitor terms; the country pack is the source of record.');
  return lines;
}
