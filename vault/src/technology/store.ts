/**
 * Technology register storage (M19). Entries are versioned by key and never overwritten: a revision is a new row,
 * confirming it supersedes the previous confirmed row, rejecting or retiring changes only the status of that row.
 * Citations, project conditions and project suggestions are append-only; the latest row wins.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { Db } from '../db/client.ts';
import { APPLICATIONS, applicationOfKey, type Application, type Conditions, type EntryBody } from './model.ts';

export interface EntryRow {
  id: string; key: string; version: number; application: Application; name: string; record: EntryBody;
  content_hash: string; status: 'proposed' | 'confirmed' | 'rejected' | 'retired'; legal_tag: string;
  author: string; note: string | null; created_at: string; decided_by: string | null; decided_at: string | null;
  superseded_by: string | null; superseded_at: string | null;
}
export interface CitationRow { key: string; query: string; source: string; since_2016: number | null; since_2023: number | null; counted_at: string; counted_by: string }

const iso = (d: unknown) => d == null ? null : new Date(d as any).toISOString();
const SELECT = `id::text AS id, key, version, application, name, record, content_hash, status, legal_tag, author, note, created_at, decided_by, decided_at, superseded_by::text AS superseded_by, superseded_at`;
const row = (r: any): EntryRow => ({ ...r, created_at: iso(r.created_at)!, decided_at: iso(r.decided_at), superseded_at: iso(r.superseded_at) });

/** Stable hash of the body (key, note excluded): an identical re-import is a no-op. */
export function contentHash(body: EntryBody): string {
  const { key: _k, note: _n, ...rest } = body as any;
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon(rest))).digest('hex');
}

export async function nextKey(db: Db, app: Application): Promise<string> {
  const prefix = APPLICATIONS[app].prefix;
  const r = await db.query<{ n: number | null }>(`SELECT max(substring(key from 3)::int) AS n FROM tech_entries WHERE key LIKE $1`, [`${prefix}%`]);
  const n = (r.rows[0]?.n ?? 0) + 1;
  return `${prefix}${String(n).padStart(2, '0')}`;
}

export class StoreError extends Error { constructor(public status: number, message: string, public path?: string) { super(message); } }

/** Insert a version. A body with a key revises that key (same application); without one a new key is assigned. */
export async function insertEntry(db: Db, body: EntryBody, opts: { author: string; status: 'proposed' | 'confirmed'; now: Date; seedKey?: boolean }): Promise<{ row: EntryRow; duplicate: boolean }> {
  const hash = contentHash(body);
  let key = body.key;
  if (key) {
    const app = applicationOfKey(key);
    if (app !== body.application) throw new StoreError(400, `key ${key} belongs to ${app ?? 'no application'}, not ${body.application}`, '/key');
  } else {
    // A new entry identical to one already proposed or current (any key) is the same proposal, not a new key.
    const dup = (await db.query<any>(`SELECT ${SELECT} FROM tech_entries WHERE application = $1 AND content_hash = $2 AND (status = 'proposed' OR (status = 'confirmed' AND superseded_by IS NULL)) LIMIT 1`, [body.application, hash])).rows[0];
    if (dup) return { row: row(dup), duplicate: true };
    key = await nextKey(db, body.application);
  }
  const prev = (await db.query<any>(`SELECT ${SELECT} FROM tech_entries WHERE key = $1 ORDER BY version DESC`, [key])).rows.map(row);
  // Only an import may create a key it names (so a seed keeps its numbering); the API assigns new keys.
  if (body.key && !prev.length && !opts.seedKey) throw new StoreError(400, `no entry has key ${key}; omit key to propose a new entry`, '/key');
  const same = prev.find(p => p.content_hash === hash && (p.status === 'proposed' || (p.status === 'confirmed' && !p.superseded_by)));
  if (same) return { row: same, duplicate: true };
  const id = randomUUID(), version = (prev[0]?.version ?? 0) + 1;
  const record = { ...body, key };
  await db.query(
    `INSERT INTO tech_entries (id, key, version, application, name, record, content_hash, status, legal_tag, author, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'proposed','lt-firm',$8,$9,$10)`,
    [id, key, version, body.application, body.name, JSON.stringify(record), hash, opts.author, body.note ?? (prev.length ? 'revision' : 'new entry'), opts.now.toISOString()]);
  if (opts.status === 'confirmed') await decide(db, id, 'confirmed', opts.author, opts.now);
  return { row: (await loadEntry(db, id))!, duplicate: false };
}

export async function loadEntry(db: Db, id: string): Promise<EntryRow | null> {
  const r = (await db.query<any>(`SELECT ${SELECT} FROM tech_entries WHERE id = $1`, [id])).rows[0];
  return r ? row(r) : null;
}
export async function history(db: Db, key: string): Promise<EntryRow[]> {
  return (await db.query<any>(`SELECT ${SELECT} FROM tech_entries WHERE key = $1 ORDER BY version DESC`, [key])).rows.map(row);
}

/** confirm: supersedes the key's current confirmed row. reject: a proposal that never becomes valid. retire: the current confirmed row leaves the register. */
export async function decide(db: Db, id: string, to: 'confirmed' | 'rejected' | 'retired', by: string, now: Date): Promise<EntryRow> {
  const e = await loadEntry(db, id);
  if (!e) throw new StoreError(404, `entry ${id} not found`);
  const at = now.toISOString();
  if (to === 'retired') {
    if (e.status !== 'confirmed' || e.superseded_by) throw new StoreError(409, `only the current confirmed version can be retired (this one is ${e.superseded_by ? 'superseded' : e.status})`);
  } else if (e.status !== 'proposed') throw new StoreError(409, `entry ${id} is ${e.status}; only a proposal can be ${to}`);
  if (to === 'confirmed') {
    await db.query(`UPDATE tech_entries SET superseded_by = $1, superseded_at = $2 WHERE key = $3 AND status = 'confirmed' AND superseded_by IS NULL`, [id, at, e.key]);
  }
  await db.query(`UPDATE tech_entries SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1`, [id, to, by, at]);
  return (await loadEntry(db, id))!;
}

export async function currentEntries(db: Db, application?: string): Promise<EntryRow[]> {
  return (await db.query<any>(`SELECT ${SELECT} FROM tech_entries WHERE status = 'confirmed' AND superseded_by IS NULL ${application ? 'AND application = $1' : ''} ORDER BY key`, application ? [application] : [])).rows.map(row);
}
export async function proposals(db: Db, application?: string): Promise<EntryRow[]> {
  return (await db.query<any>(`SELECT ${SELECT} FROM tech_entries WHERE status = 'proposed' ${application ? 'AND application = $1' : ''} ORDER BY created_at DESC`, application ? [application] : [])).rows.map(row);
}

export async function latestCitations(db: Db, keys: string[]): Promise<Map<string, CitationRow>> {
  if (!keys.length) return new Map();
  const r = await db.query<any>(`SELECT DISTINCT ON (key) key, query, source, since_2016, since_2023, counted_at, counted_by FROM tech_citations WHERE key = ANY($1::text[]) ORDER BY key, counted_at DESC`, [keys]);
  return new Map(r.rows.map((c: any) => [c.key, { ...c, counted_at: iso(c.counted_at)! }]));
}
export async function appendCitation(db: Db, c: Omit<CitationRow, 'counted_at'> & { counted_at?: string }): Promise<void> {
  await db.query(`INSERT INTO tech_citations (id, key, query, source, since_2016, since_2023, counted_at, counted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), c.key, c.query, c.source, c.since_2016, c.since_2023, c.counted_at ?? new Date().toISOString(), c.counted_by]);
}

export async function latestConditions(db: Db, projectId: string): Promise<{ conditions: Conditions; note: string | null; set_by: string; set_at: string } | null> {
  const r = (await db.query<any>(`SELECT conditions, note, set_by, set_at FROM tech_conditions WHERE project_id = $1 ORDER BY set_at DESC, id LIMIT 1`, [projectId])).rows[0];
  return r ? { conditions: r.conditions, note: r.note, set_by: r.set_by, set_at: iso(r.set_at)! } : null;
}
export async function insertConditions(db: Db, projectId: string, conditions: Conditions, by: string, note: string | null, now: Date): Promise<void> {
  await db.query(`INSERT INTO tech_conditions (id, project_id, conditions, note, set_by, set_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6)`, [randomUUID(), projectId, JSON.stringify(conditions), note, by, now.toISOString()]);
}

export interface SuggestionRow { key: string; entry_id: string; status: 'suggested' | 'shortlisted' | 'dismissed'; note: string | null; by_person: string; at: string }
export async function latestSuggestions(db: Db, projectId: string): Promise<Map<string, SuggestionRow>> {
  const r = await db.query<any>(`SELECT DISTINCT ON (key) key, entry_id::text AS entry_id, status, note, by_person, at FROM tech_suggestions WHERE project_id = $1 ORDER BY key, at DESC, id`, [projectId]);
  return new Map(r.rows.map((s: any) => [s.key, { ...s, at: iso(s.at)! }]));
}
export async function insertSuggestion(db: Db, projectId: string, s: Omit<SuggestionRow, 'at'>, now: Date): Promise<void> {
  await db.query(`INSERT INTO tech_suggestions (id, project_id, key, entry_id, status, note, by_person, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), projectId, s.key, s.entry_id, s.status, s.note, s.by_person, now.toISOString()]);
}
