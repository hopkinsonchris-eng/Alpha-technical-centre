/**
 * Daily risk snapshots (wave 8, docs/vault-hub/wave8/01-risk-lens.md §3; db/013_risk_snapshots.sql). The countries
 * summary records each held country's Instability Index once a day, and the deltas over 7 and 30 days are read back
 * from here. Never overwritten: the first reading of the day stands (runs and items are immutable; so is a reading).
 */
import type { Db } from '../db/client.ts';
import type { CountryRisk } from './worldmonitor.ts';

export interface RiskDelta { delta_7d: number | null; delta_30d: number | null; since: string | null }

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Record today's reading for the country unless one is already held for today. Returns true when a row was written. */
export async function recordSnapshot(db: Db, country: string, risk: CountryRisk, fetchedAt: string, now: Date): Promise<boolean> {
  if (typeof risk.score !== 'number') return false;
  const r = await db.query(
    `INSERT INTO risk_snapshots (country, day, score, level, trend, sanctions_active, sanctions_count, components, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) ON CONFLICT (country, day) DO NOTHING RETURNING country`,
    [country, dayOf(now), risk.score, risk.level, risk.trend, risk.sanctions_active, risk.sanctions_count, risk.components ? JSON.stringify(risk.components) : null, fetchedAt]);
  return r.rows.length > 0;
}

/** The change in score against the latest snapshot on or before 7 and 30 days ago, to one decimal; null without one. */
export async function deltas(db: Db, country: string, score: number | null, now: Date): Promise<RiskDelta> {
  if (typeof score !== 'number') return { delta_7d: null, delta_30d: null, since: null };
  const out: RiskDelta = { delta_7d: null, delta_30d: null, since: null };
  for (const [key, days] of [['delta_7d', 7], ['delta_30d', 30]] as const) {
    const day = dayOf(new Date(now.getTime() - days * 864e5));
    const row = (await db.query<{ score: string | number; day: string | Date }>('SELECT score, day FROM risk_snapshots WHERE country = $1 AND day <= $2 AND score IS NOT NULL ORDER BY day DESC LIMIT 1', [country, day])).rows[0];
    if (!row) continue;
    out[key] = Math.round((score - Number(row.score)) * 10) / 10;
    if (key === 'delta_30d' || !out.since) out.since = typeof row.day === 'string' ? row.day.slice(0, 10) : dayOf(row.day as Date);
  }
  return out;
}
