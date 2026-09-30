/**
 * Lessons store helpers and the core index (M15).
 *
 * This file holds everything the lessons endpoints and the weekly dream job
 * share, so neither imports the other:
 *   - the Lesson record shape and row <-> record mapping (the `lessons` table
 *     keeps the full schema record in `record` and mirrors the fields the
 *     queries filter on in columns; both are always written together)
 *   - decay (rank falls after 12 months without `last_confirmed`)
 *   - evidence resolution (run:/doc:/transcript: refs -> legal tags)
 *   - regenerateLessonsIndex(): writes vault/firm/LESSONS.md (<= 200 lines,
 *     grouped by discipline) and vault/firm/lessons.json. Called on every
 *     confirmation (in the same request) and by the weekly job. The output has
 *     no timestamps and a total order, so identical lessons give identical
 *     bytes and the bot PR that commits it only shows real changes.
 *
 * Confidentiality: LESSONS.md is committed to git and injected into every
 * session, so it lists only confirmed lessons whose legal tag is not
 * client-nda (a sanitised lesson has been re-tagged lt-firm by a partner),
 * not partners-only and not expired.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import { bad, resolveTag, type Access } from '../api/common.ts';

/* ── shapes ─────────────────────────────────────────────────────────── */

export type LessonScope = 'firm' | 'discipline' | 'client' | 'project' | 'tool';
export type LessonStatus = 'proposed' | 'confirmed' | 'invalidated';
export const LESSON_SCOPES: LessonScope[] = ['firm', 'discipline', 'client', 'project', 'tool'];
/** Scopes whose lessons reach every project: NDA-derived content may not sit here unsanitised. */
export const FIRM_REACHING: LessonScope[] = ['firm', 'discipline', 'tool'];

export interface LessonRecord {
  id: string; claim: string; detail?: string; scope: LessonScope; scope_id: string | null; disciplines?: string[];
  legal_tag: string; sanitised?: boolean; evidence: string[]; author: string; created_at: string;
  valid_from?: string; valid_to?: string | null; superseded_by?: string | null; status: LessonStatus;
  confirmed_by?: string | null; last_confirmed?: string | null; confidence: number; recurrence?: number;
}

const isoOrNull = (d: unknown): string | null => d == null ? null : new Date(d as any).toISOString();

const COLS = 'id, record, scope, scope_id, legal_tag, status, created_at, last_confirmed, valid_to, superseded_by';

/** The record with the queryable columns laid over it (the columns are the source of truth for state). */
export function rowToLesson(row: any): LessonRecord {
  const r = { ...(row.record ?? {}) };
  return {
    ...r, id: row.id, scope: row.scope, scope_id: row.scope_id ?? null, legal_tag: row.legal_tag, status: row.status,
    created_at: isoOrNull(row.created_at) ?? r.created_at, last_confirmed: isoOrNull(row.last_confirmed), valid_to: isoOrNull(row.valid_to),
    superseded_by: row.superseded_by ?? null,
  } as LessonRecord;
}

export async function loadLessons(db: Db, where = 'TRUE', params: unknown[] = []): Promise<LessonRecord[]> {
  return (await db.query<any>(`SELECT ${COLS} FROM lessons WHERE ${where} ORDER BY created_at, id`, params)).rows.map(rowToLesson);
}
export async function loadLesson(db: Db, id: string): Promise<LessonRecord | null> {
  const r = (await db.query<any>(`SELECT ${COLS} FROM lessons WHERE id = $1`, [id])).rows[0];
  return r ? rowToLesson(r) : null;
}

export async function insertLesson(db: Db, l: LessonRecord): Promise<void> {
  await db.query(
    'INSERT INTO lessons (id, record, scope, scope_id, legal_tag, status, created_at, last_confirmed, valid_to, superseded_by) VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10)',
    [l.id, JSON.stringify(l), l.scope, l.scope_id ?? null, l.legal_tag, l.status, l.created_at, l.last_confirmed ?? null, l.valid_to ?? null, l.superseded_by ?? null]);
}
/** Lessons are never deleted: state changes rewrite the record and its mirrored columns together. */
export async function saveLesson(db: Db, l: LessonRecord): Promise<void> {
  await db.query(
    'UPDATE lessons SET record=$2::jsonb, scope=$3, scope_id=$4, legal_tag=$5, status=$6, last_confirmed=$7, valid_to=$8, superseded_by=$9 WHERE id=$1',
    [l.id, JSON.stringify(l), l.scope, l.scope_id ?? null, l.legal_tag, l.status, l.last_confirmed ?? null, l.valid_to ?? null, l.superseded_by ?? null]);
}

/* ── decay ──────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
/** No decay for a year; then the factor halves every six months, never below the floor. */
export const DECAY_GRACE_DAYS = 365;
export const DECAY_HALF_LIFE_DAYS = 182.5;
export const DECAY_FLOOR = 0.1;

/** The date decay counts from: last_confirmed, else creation (a proposal has never been confirmed). */
export function decayAnchor(l: Pick<LessonRecord, 'last_confirmed' | 'created_at'>): Date {
  return new Date(l.last_confirmed ?? l.created_at);
}
export function decayFactor(l: Pick<LessonRecord, 'last_confirmed' | 'created_at'>, now: Date): number {
  const age = (now.getTime() - decayAnchor(l).getTime()) / DAY;
  if (!(age > DECAY_GRACE_DAYS)) return 1;
  return Math.max(DECAY_FLOOR, Math.pow(0.5, (age - DECAY_GRACE_DAYS) / DECAY_HALF_LIFE_DAYS));
}
/** Retrieval rank: confidence times the decay factor. */
export function lessonRank(l: LessonRecord, now: Date): number {
  return Math.round((l.confidence ?? 0) * decayFactor(l, now) * 1e6) / 1e6;
}
export function compareRank(a: LessonRecord, b: LessonRecord, now: Date): number {
  return lessonRank(b, now) - lessonRank(a, now) || String(b.last_confirmed ?? '').localeCompare(String(a.last_confirmed ?? '')) || a.claim.localeCompare(b.claim) || a.id.localeCompare(b.id);
}
/** The instant twelve months before `now`: lessons last confirmed before it are due for re-confirmation. */
export function reconfirmCutoff(now: Date): Date {
  const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() - 1); return d;
}

/* ── evidence ───────────────────────────────────────────────────────── */

export const EVIDENCE_RE = /^(?:(?:run|doc):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|transcript:[A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/i;
export interface ResolvedEvidence { ref: string; found: boolean; legal_tag?: string; project_id?: string; hidden?: boolean }

/**
 * Look every evidence ref up. run: and doc: refs must be vault records.
 * transcript:<uuid> is an item of type transcript when one exists; any other
 * transcript:<id> is an external assistant-session transcript: it is accepted
 * and contributes no tag.
 */
export async function resolveEvidence(db: Db, refs: string[]): Promise<ResolvedEvidence[]> {
  const ids = (kind: string) => [...new Set(refs.map(r => new RegExp(`^${kind}:([0-9a-f-]{36})$`, 'i').exec(r)?.[1]?.toLowerCase()).filter((x): x is string => !!x))];
  const runIds = ids('run'), itemIds = [...new Set([...ids('doc'), ...ids('transcript')])];
  const runs = new Map<string, any>(), items = new Map<string, any>();
  if (runIds.length) for (const r of (await db.query<any>('SELECT id::text AS id, legal_tag, project_id, hidden FROM runs WHERE id = ANY($1::uuid[])', [runIds])).rows) runs.set(r.id, r);
  if (itemIds.length) for (const r of (await db.query<any>('SELECT id::text AS id, legal_tag, project_id, hidden, type FROM items WHERE id = ANY($1::uuid[])', [itemIds])).rows) items.set(r.id, r);
  return refs.map((ref): ResolvedEvidence => {
    const m = /^(run|doc|transcript):(.+)$/i.exec(ref);
    if (!m) return { ref, found: false };
    const kind = m[1].toLowerCase(), id = m[2].toLowerCase();
    const row = kind === 'run' ? runs.get(id) : items.get(id);
    if (kind === 'transcript') {
      if (row && row.type === 'transcript') return { ref, found: true, legal_tag: row.legal_tag, project_id: row.project_id, hidden: row.hidden };
      return { ref, found: true };
    }
    return row ? { ref, found: true, legal_tag: row.legal_tag, project_id: row.project_id, hidden: row.hidden } : { ref, found: false };
  });
}

/**
 * The legal tag of a lesson: the union of its evidence records' tags (never
 * lowered here; only a partner's sanitising lowers it, in the confirm route).
 * With no vault record among the evidence (an external transcript only) the
 * fallback applies. Throws 409 when the evidence spans two clients' NDAs.
 */
export async function deriveLessonTag(db: Db, acc: Access, evidence: ResolvedEvidence[], fallback: string): Promise<string> {
  const tags = [...new Set(evidence.map(e => e.legal_tag).filter((t): t is string => !!t))];
  if (!tags.length) return resolveTag(db, acc, [fallback]);
  return resolveTag(db, acc, tags);
}

export function isNdaTag(acc: Access, tagId: string): boolean {
  return acc.tags.get(tagId)?.classification === 'client-nda';
}

/** Validate a scope string (`firm | discipline:<name> | client:<id> | project:<id> | tool:<id>`). */
export function parseLessonScope(s: string): { scope: LessonScope; id: string | null } {
  const i = s.indexOf(':');
  const kind = (i < 0 ? s : s.slice(0, i)) as LessonScope, id = i < 0 ? null : s.slice(i + 1);
  if (!LESSON_SCOPES.includes(kind)) throw bad(`unknown scope "${s}"; use firm | discipline:<name> | client:<id> | project:<id> | tool:<id>`, '?scope');
  if (kind === 'firm') { if (id) throw bad('scope "firm" takes no id', '?scope'); return { scope: 'firm', id: null }; }
  if (!id) throw bad(`scope "${kind}" needs an id: ${kind}:<id>`, '?scope');
  return { scope: kind, id };
}

/* ── the core index ─────────────────────────────────────────────────── */

export const INDEX_MAX_LINES = 200;
const VAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let dirOverride: string | null = null;
/** Tests point the index at a temp directory so they never touch the committed file. */
export function setFirmDir(dir: string | null): void { dirOverride = dir; }
export function firmDir(): string { return dirOverride ?? process.env.VAULT_FIRM_DIR ?? path.join(VAULT_DIR, 'firm'); }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
export function disciplineOf(l: Pick<LessonRecord, 'scope' | 'scope_id' | 'disciplines'>): string {
  const d = l.scope === 'discipline' && l.scope_id ? l.scope_id : (l.disciplines ?? []).find(x => x && x.trim());
  return d ? d.trim().toLowerCase() : 'general';
}
const scopeText = (l: LessonRecord) => l.scope_id ? `${l.scope}:${l.scope_id}` : l.scope;

const HEADER = [
  '# Firm lessons',
  '',
  '<!-- Generated by vault/src/jobs/lessons-index.ts from confirmed lessons in the Vault. Do not edit by hand: it is rewritten on every confirmation and by the weekly job. -->',
  '',
  'Confirmed, non-confidential lessons, grouped by discipline. Each line is a claim with its lesson id and scope; read the full record and evidence at `GET /api/lessons/<id>`. A machine-readable copy is `lessons.json`.',
  '',
];

export interface IndexRender { markdown: string; json: string; lines: number; listed: number; omitted: number }

/** Pure rendering: eligible lessons in, file contents out. */
export function renderLessonsIndex(lessons: LessonRecord[], now: Date): IndexRender {
  const ranked = [...lessons].sort((a, b) => compareRank(a, b, now));
  const total = ranked.length;
  // Line budget: header + per group (heading + blank) + one per lesson; if some do not fit, reserve two lines for the omission note.
  const groups = new Set(ranked.map(disciplineOf));
  const fullCost = HEADER.length + groups.size * 2 + total;
  const truncated = fullCost > INDEX_MAX_LINES;
  const budget = INDEX_MAX_LINES - HEADER.length - (truncated ? 2 : 0);
  const chosen: LessonRecord[] = []; const seen = new Set<string>(); let used = 0;
  for (const l of ranked) {
    const g = disciplineOf(l); const cost = 1 + (seen.has(g) ? 0 : 2);
    if (used + cost > budget) continue;
    used += cost; seen.add(g); chosen.push(l);
  }
  const byGroup = new Map<string, LessonRecord[]>();
  for (const l of chosen) (byGroup.get(disciplineOf(l)) ?? byGroup.set(disciplineOf(l), []).get(disciplineOf(l))!).push(l);
  const names = [...byGroup.keys()].sort((a, b) => a === 'general' ? 1 : b === 'general' ? -1 : a.localeCompare(b));
  const out = [...HEADER];
  if (!total) out.push('_No confirmed lessons yet._');
  for (const g of names) {
    out.push(`## ${g}`);
    for (const l of byGroup.get(g)!) out.push(`- ${norm(l.claim)} (lesson:${l.id}, ${scopeText(l)})`);
    out.push('');
  }
  if (truncated) out.push(`_${total - chosen.length} lower-ranked lessons are not listed; see lessons.json._`);
  while (out.length && out.at(-1) === '') out.pop();
  const markdown = out.join('\n') + '\n';
  const json = JSON.stringify({
    generated_from: 'confirmed lessons in the Vault', count: total,
    lessons: ranked.map(l => ({
      id: l.id, claim: norm(l.claim), scope: l.scope, scope_id: l.scope_id ?? null, discipline: disciplineOf(l), disciplines: l.disciplines ?? [],
      confidence: l.confidence, recurrence: l.recurrence ?? 1, sanitised: !!l.sanitised, last_confirmed: l.last_confirmed ?? null,
    })),
  }, null, 2) + '\n';
  return { markdown, json, lines: markdown.split('\n').length - 1, listed: chosen.length, omitted: total - chosen.length };
}

/** Confirmed, current, and safe for a committed firm-wide file. */
export async function loadIndexable(db: Db, now: Date): Promise<LessonRecord[]> {
  const rows = (await db.query<any>(
    `SELECT l.id, l.record, l.scope, l.scope_id, l.legal_tag, l.status, l.created_at, l.last_confirmed, l.valid_to, l.superseded_by
       FROM lessons l JOIN legal_tags t ON t.id = l.legal_tag
      WHERE l.status = 'confirmed' AND (l.valid_to IS NULL OR l.valid_to > $1)
        AND t.classification <> 'client-nda' AND NOT t.partners_only AND NOT t.personal_data AND NOT t.export_restricted
        AND (t.expires_at IS NULL OR t.expires_at >= $2::date)
      ORDER BY l.created_at, l.id`, [now.toISOString(), now.toISOString().slice(0, 10)])).rows;
  return rows.map(rowToLesson);
}

export interface IndexResult { dir: string; markdown_path: string; json_path: string; lines: number; listed: number; omitted: number; changed: boolean }

/** Rewrite vault/firm/LESSONS.md and lessons.json (only when the content changed). */
export async function regenerateLessonsIndex(db: Db, opts: { now?: Date; dir?: string } = {}): Promise<IndexResult> {
  const now = opts.now ?? new Date();
  const dir = opts.dir ?? firmDir();
  const r = renderLessonsIndex(await loadIndexable(db, now), now);
  mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, 'LESSONS.md'), jsonPath = path.join(dir, 'lessons.json');
  let changed = false;
  for (const [p, body] of [[mdPath, r.markdown], [jsonPath, r.json]] as const) {
    if (!existsSync(p) || readFileSync(p, 'utf8') !== body) { writeFileSync(p, body); changed = true; }
  }
  return { dir, markdown_path: mdPath, json_path: jsonPath, lines: r.lines, listed: r.listed, omitted: r.omitted, changed };
}
