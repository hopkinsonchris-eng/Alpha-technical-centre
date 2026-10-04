/**
 * Who last spoke to this person (wave 6, P57): from the captured mail, per contact, the last two-way exchange, who at
 * the firm it was with, and the strongest connection (recency and frequency: each exchange counts 1, halved every
 * 180 days). Only human, visible mail counts; protected and blocked mail never reached the Vault. Written to
 * `contacts.relationship`, read by the Write to… picker and the record panel.
 */
import type { Db } from '../../db/client.ts';
import { domainOf, firmDomains } from './classify.ts';

export interface Relationship { last_contact_at: string | null; last_contact_by: string | null; last_direction: 'in' | 'out' | null; first_contact_at: string | null; exchanges: number; strongest_connection: string | null; strength: number; by_person: Record<string, { exchanges: number; last_at: string; strength: number }>; computed_at: string }

const HALF_LIFE_DAYS = 180;

/** Recompute every contact's relationship from the mail items. Returns the number of contacts written. */
export async function recomputeRelationships(db: Db, o: { firm?: string[]; now?: () => Date } = {}): Promise<number> {
  const firm = o.firm ?? firmDomains();
  const now = (o.now ?? (() => new Date()))();
  const people = new Map((await db.query<{ id: string; email: string }>('SELECT id, lower(email) AS email FROM people')).rows.map(r => [r.email, r.id]));
  const contacts = (await db.query<{ id: string; emails: string[] }>('SELECT id, emails FROM contacts')).rows;
  const byEmail = new Map<string, string>();
  for (const c of contacts) for (const e of c.emails ?? []) byEmail.set(String(e).toLowerCase(), c.id);
  if (!byEmail.size) return 0;
  const rows = (await db.query<{ id: string; at: string; extracted: any }>(
    `SELECT id, coalesce(authored_at, created_at) AS at, extracted FROM items
      WHERE type = 'email' AND NOT hidden AND parent_id IS NULL AND coalesce(extracted->>'category', 'human') <> 'bulk'
        AND (extracted->>'direction') IN ('in','out') ORDER BY coalesce(authored_at, created_at)`)).rows;
  const acc = new Map<string, Relationship>();
  for (const r of rows) {
    const ex = r.extracted ?? {};
    const list: Array<{ email: string; role: string; firm?: boolean }> = ex.contacts ?? [];
    const firmSide = list.filter(c => c.firm ?? firm.includes(domainOf(c.email))).map(c => people.get(String(c.email).toLowerCase()) ?? null).filter((x): x is string => !!x);
    const direction: 'in' | 'out' = ex.direction;
    // the firm person of the exchange: who wrote it (out) or whom it was addressed to (in); the mailbox owner when nobody matched
    const owner = people.get(String(ex.mailbox ?? '').toLowerCase()) ?? null;
    const person = (direction === 'out' ? firmSide[0] : firmSide.find(p => list.some(c => c.role === 'to' && people.get(String(c.email).toLowerCase()) === p)) ?? firmSide[0]) ?? owner;
    const at = new Date(r.at).toISOString();
    const ageDays = Math.max(0, (now.getTime() - new Date(r.at).getTime()) / 864e5);
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const counted = new Set<string>();
    for (const c of list) {
      if (c.firm ?? firm.includes(domainOf(c.email))) continue;
      if (direction === 'in' && c.role !== 'from') continue;        // inbound: the sender spoke
      if (direction === 'out' && c.role === 'from') continue;       // outbound: the recipients were spoken to
      const cid = byEmail.get(String(c.email).toLowerCase());
      if (!cid || counted.has(cid)) continue;
      counted.add(cid);
      const rel = acc.get(cid) ?? { last_contact_at: null, last_contact_by: null, last_direction: null, first_contact_at: null, exchanges: 0, strongest_connection: null, strength: 0, by_person: {}, computed_at: now.toISOString() };
      rel.exchanges++; rel.strength += w;
      rel.first_contact_at ??= at;
      rel.last_contact_at = at; rel.last_contact_by = person; rel.last_direction = direction;
      if (person) { const bp = rel.by_person[person] ?? { exchanges: 0, last_at: at, strength: 0 }; bp.exchanges++; bp.last_at = at; bp.strength += w; rel.by_person[person] = bp; }
      acc.set(cid, rel);
    }
  }
  let n = 0;
  for (const c of contacts) {
    const rel = acc.get(c.id);
    if (rel) {
      rel.strength = Math.round(rel.strength * 1000) / 1000;
      for (const bp of Object.values(rel.by_person)) bp.strength = Math.round(bp.strength * 1000) / 1000;
      rel.strongest_connection = Object.entries(rel.by_person).sort((a, b) => b[1].strength - a[1].strength || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      await db.query('UPDATE contacts SET relationship = $2::jsonb WHERE id = $1', [c.id, JSON.stringify(rel)]);
      n++;
    } else await db.query(`UPDATE contacts SET relationship = '{}'::jsonb WHERE id = $1 AND relationship <> '{}'::jsonb`, [c.id]);
  }
  return n;
}
