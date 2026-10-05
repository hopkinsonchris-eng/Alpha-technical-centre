/**
 * The round_events table (wave 7 PR6; docs/vault-hub/wave7/05-markup.md §1.9, W7-AC21 and W7-AC22; 04-step-changes.md P2).
 *   proposeRounds(db, proposals)        each accepted proposal becomes a 'proposed' row and a review-queue entry of kind
 *                                       'round'; the same country, round, stage and date is never proposed twice while a
 *                                       proposed or confirmed row exists
 *   confirmRound / dismissRound         the decision, from the queue or from POST /api/rounds/:id/confirm and /dismiss:
 *                                       confirming sets status, who and when and supersedes the older confirmed event of
 *                                       the same country, round and stage (superseded_by); dismissing sets 'dismissed';
 *                                       either resolves the open queue row; nothing is ever deleted
 *   roundsView(db, opts)                the RoundsView the Hub reads: countries with `open`, the deadlines soonest first
 *                                       within the window, the proposals waiting
 *   confirmedRoundSentences(db, cc)     the pack's licensing section: one short cited line per confirmed event
 * Round events are public by construction (regulator pages filed in public scope); every row names its source item.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { PackSentence } from '../country/types.ts';
import { countryName } from '../opportunities.ts';
import { STAGES, type RoundEvent, type RoundProposal, type RoundsView, type StageId } from './types.ts';

export const QUEUE_KIND = 'round';
export const EVENT_STATUSES = ['proposed', 'confirmed', 'dismissed', 'superseded'] as const;
export type EventStatus = typeof EVENT_STATUSES[number];
const DAY = 86_400_000;
const SELECT = `id::text AS id, trim(country) AS country, round, stage, to_char(event_date, 'YYYY-MM-DD') AS event_date, title, quote, source_item::text AS source_item, source_url, read_at,
                status, confirmed_by, confirmed_at, superseded_by::text AS superseded_by, created_at`;

export class RoundDecisionError extends Error { constructor(public status: 404 | 409, public code: 'not_found' | 'conflict', message: string) { super(message); } }

export const stageLabel = (stage: string): { en: string; es: string } => { const s = STAGES.find(x => x.id === stage) ?? STAGES[STAGES.length - 1]; return { en: s.en, es: s.es }; };
const iso = (d: unknown): string | null => (d == null ? null : new Date(d as any).toISOString());
export const ymd = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

/** Days from `now` (UTC date) to a YYYY-MM-DD; negative when past; null without a date. */
export function daysFrom(now: Date, date: string | null): number | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / DAY);
}

export function toRoundEvent(r: any, now: Date): RoundEvent {
  return {
    id: r.id, country: r.country, round: r.round, stage: r.stage as StageId, event_date: r.event_date ?? null, title: r.title, quote: r.quote, source_item: r.source_item ?? null, source_url: r.source_url,
    read_at: iso(r.read_at)!, status: r.status, confirmed_by: r.confirmed_by ?? null, confirmed_at: iso(r.confirmed_at), created_at: iso(r.created_at)!, days: daysFrom(now, r.event_date ?? null),
  };
}

/** What the queue page shows for a round proposal; no project, so every member sees it. */
export function queuePayload(e: { id: string; country: string; round: string; stage: string; event_date: string | null; title: string; quote: string; source_item: string | null; source_url: string; read_at: string }) {
  const label = stageLabel(e.stage);
  return {
    round_event_id: e.id, country: e.country, country_name: countryName(e.country), round: e.round, stage: e.stage, stage_label: label,
    event_date: e.event_date, title: e.title, quote: e.quote, source_item: e.source_item, source_url: e.source_url, read_at: e.read_at,
    proposal: `${e.round} · ${label.en}${e.event_date ? ` · ${e.event_date}` : ''}`,
  };
}

/* ── proposals ───────────────────────────────────────────────────────── */

export async function proposeRounds(db: Db, proposals: RoundProposal[], now = new Date()): Promise<{ inserted: string[]; duplicates: number }> {
  const inserted: string[] = [];
  let duplicates = 0;
  for (const p of proposals) {
    const country = p.country.toUpperCase();
    const dup = await db.query(
      `SELECT 1 FROM round_events WHERE country = $1 AND round = $2 AND stage = $3 AND event_date IS NOT DISTINCT FROM $4::date AND status IN ('proposed', 'confirmed') LIMIT 1`,
      [country, p.round, p.stage, p.event_date]);
    if (dup.rows.length) { duplicates++; continue; }
    const id = randomUUID();
    const read_at = new Date(p.read_at).toISOString();
    await db.query(
      `INSERT INTO round_events (id, country, round, stage, event_date, title, quote, source_item, source_url, read_at, status, created_at)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8::uuid, $9, $10, 'proposed', $11)`,
      [id, country, p.round, p.stage, p.event_date, p.title, p.quote, p.source_item, p.source_url, read_at, now.toISOString()]);
    await db.query('INSERT INTO review_queue (id, kind, payload, created_at) VALUES ($1, $2, $3::jsonb, $4)',
      [randomUUID(), QUEUE_KIND, JSON.stringify(queuePayload({ id, country, round: p.round, stage: p.stage, event_date: p.event_date, title: p.title, quote: p.quote, source_item: p.source_item, source_url: p.source_url, read_at })), now.toISOString()]);
    inserted.push(id);
  }
  return { inserted, duplicates };
}

/* ── one event ───────────────────────────────────────────────────────── */

export async function roundEvent(db: Db, id: string, now = new Date()): Promise<RoundEvent | null> {
  const r = (await db.query<any>(`SELECT ${SELECT} FROM round_events WHERE id = $1`, [id])).rows[0];
  return r ? toRoundEvent(r, now) : null;
}

async function resolveQueue(db: Db, eventId: string, status: 'accepted' | 'rejected', personId: string, now: Date): Promise<void> {
  await db.query(`UPDATE review_queue SET status = $2, resolved_by = $3, resolved_at = $4 WHERE kind = $5 AND status = 'open' AND payload->>'round_event_id' = $1`, [eventId, status, personId, now.toISOString(), QUEUE_KIND]);
}

async function openRow(db: Db, id: string): Promise<any> {
  const r = (await db.query<any>(`SELECT ${SELECT} FROM round_events WHERE id = $1`, [id])).rows[0];
  if (!r) throw new RoundDecisionError(404, 'not_found', `round event ${id} not found`);
  if (r.status !== 'proposed') throw new RoundDecisionError(409, 'conflict', `round event ${id} is already ${r.status}`);
  return r;
}

/** Confirms a proposal: status, who, when; the older confirmed event of the same country, round and stage is superseded, never deleted. */
export async function confirmRound(db: Db, id: string, personId: string, now = new Date()): Promise<RoundEvent> {
  const r = await openRow(db, id);
  const upd = await db.query(`UPDATE round_events SET status = 'confirmed', confirmed_by = $2, confirmed_at = $3 WHERE id = $1 AND status = 'proposed' RETURNING id`, [id, personId, now.toISOString()]);
  if (!upd.rows.length) throw new RoundDecisionError(409, 'conflict', `round event ${id} was decided meanwhile`);
  await db.query(`UPDATE round_events SET status = 'superseded', superseded_by = $1 WHERE country = $2 AND round = $3 AND stage = $4 AND status = 'confirmed' AND id <> $1`, [id, r.country, r.round, r.stage]);
  await resolveQueue(db, id, 'accepted', personId, now);
  return (await roundEvent(db, id, now))!;
}

export async function dismissRound(db: Db, id: string, personId: string, now = new Date()): Promise<RoundEvent> {
  await openRow(db, id);
  const upd = await db.query(`UPDATE round_events SET status = 'dismissed' WHERE id = $1 AND status = 'proposed' RETURNING id`, [id]);
  if (!upd.rows.length) throw new RoundDecisionError(409, 'conflict', `round event ${id} was decided meanwhile`);
  await resolveQueue(db, id, 'rejected', personId, now);
  return (await roundEvent(db, id, now))!;
}

/* ── the view ────────────────────────────────────────────────────────── */

export interface ViewOptions { countries: string[]; status?: EventStatus | 'all'; within?: number; now?: Date }

const OPENING: StageId[] = ['bids_open', 'bid_deadline'];
const byDate = (a: RoundEvent, b: RoundEvent) => (a.event_date === b.event_date ? 0 : a.event_date === null ? 1 : b.event_date === null ? -1 : a.event_date < b.event_date ? -1 : 1) || a.round.localeCompare(b.round) || a.stage.localeCompare(b.stage) || a.created_at.localeCompare(b.created_at);

/** A country is open when a confirmed bids-open or bid-deadline stage lies in the future, or an announced round has no confirmed award yet. */
export function isOpen(confirmed: RoundEvent[]): boolean {
  if (confirmed.some(e => OPENING.includes(e.stage) && e.days !== null && e.days >= 0)) return true;
  return confirmed.some(e => e.stage === 'announced' && !confirmed.some(a => a.stage === 'award' && a.round === e.round));
}

export async function roundsView(db: Db, opts: ViewOptions): Promise<RoundsView> {
  const now = opts.now ?? new Date();
  const status = opts.status ?? 'confirmed';
  const within = opts.within ?? 90;
  const countries = [...new Set(opts.countries.map(c => c.toUpperCase()))].sort();
  const rows = countries.length ? (await db.query<any>(`SELECT ${SELECT} FROM round_events WHERE country = ANY($1::text[])`, [countries])).rows.map(r => toRoundEvent(r, now)) : [];
  const out: RoundsView = { countries: [], deadlines: [], proposed: 0 };
  // `confirmed` carries the superseded rows too, so the Hub can word "moved to <date>" against the earlier event of the same round and stage.
  const wanted: EventStatus[] | null = status === 'all' ? null : status === 'confirmed' ? ['confirmed', 'superseded'] : [status];
  for (const c of countries) {
    const all = rows.filter(e => e.country === c).sort(byDate);
    const confirmed = all.filter(e => e.status === 'confirmed');
    out.countries.push({ country: c, name: countryName(c).en, open: isOpen(confirmed), events: wanted ? all.filter(e => wanted.includes(e.status)) : all });
  }
  out.deadlines = rows.filter(e => e.status === 'confirmed' && e.days !== null && e.days >= 0 && e.days <= within).sort((a, b) => (a.days! - b.days!) || a.country.localeCompare(b.country) || a.round.localeCompare(b.round) || a.stage.localeCompare(b.stage));
  out.proposed = rows.filter(e => e.status === 'proposed').length;
  return out;
}

/* ── the pack's licensing section ────────────────────────────────────── */

/** One short line per confirmed event, both languages, citing the stored original the quote came from; an event without a stored original cannot be cited and is left out. */
export async function confirmedRoundSentences(db: Db, country: string): Promise<PackSentence[]> {
  const rows = (await db.query<any>(`SELECT ${SELECT} FROM round_events WHERE country = $1 AND status = 'confirmed' AND source_item IS NOT NULL`, [country.toUpperCase()])).rows.map(r => toRoundEvent(r, new Date())).sort(byDate);
  return rows.map(e => {
    const label = stageLabel(e.stage);
    const cite = `doc:${e.source_item}`;
    const date = { en: e.event_date ?? 'date not given', es: e.event_date ?? 'sin fecha' };
    return {
      en: `${e.round} — ${label.en}: ${date.en}. ${e.title} (page read ${ymd(e.read_at)}, confirmed ${ymd(e.confirmed_at)}). [${cite}]`,
      es: `${e.round} — ${label.es}: ${date.es}. ${e.title} (página leída ${ymd(e.read_at)}, confirmada ${ymd(e.confirmed_at)}). [${cite}]`,
      cites: [cite],
    };
  });
}
