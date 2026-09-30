/**
 * Lessons (M15).
 *   GET  /api/lessons?scope=&status=&cascade=   confirmed by default; ordered by rank (confidence x decay)
 *   POST /api/lessons                           proposed unless a partner posts confirmed
 *   GET  /api/lessons/:id                       readable even when invalidated
 *   POST /api/lessons/:id/confirm               partner; body may carry {claim, detail, sanitised}
 *   POST /api/lessons/:id/reject                partner; a proposal that never becomes valid
 *   POST /api/lessons/:id/invalidate            partner; sets valid_to and superseded_by, never deletes
 *
 * The legal tag of a lesson is the union of its evidence records' tags. A
 * lesson derived from client-nda evidence cannot reach firm-wide scopes
 * (firm, discipline, tool) unless a partner has confirmed it as sanitised:
 * that is the only route by which client content becomes firm content, and it
 * re-tags the lesson lt-firm. Confirm, invalidate and a partner's own
 * confirmed post rewrite vault/firm/LESSONS.md in the same request.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import {
  assertVisible, bad, canSee, check, conflict, forbidden, intParam, isPartner, jsonBody, loadAccess, notFound, requirePartner, requireWritableProject,
  route, scopeLabel, UUID_RE, uuidParam, type Access, type Ctx,
} from './common.ts';
import {
  decayFactor, deriveLessonTag, EVIDENCE_RE, FIRM_REACHING, insertLesson, isNdaTag, lessonRank, loadLesson, loadLessons, parseLessonScope,
  regenerateLessonsIndex, resolveEvidence, saveLesson, compareRank, type IndexResult, type LessonRecord, type LessonScope,
} from '../jobs/lessons-index.ts';

const STATUSES = ['proposed', 'confirmed', 'invalidated', 'all'];

/** Visible through the lesson's legal tag: the same rule every other record obeys. */
export function lessonVisible(acc: Access, l: LessonRecord): boolean {
  const tag = acc.tags.get(l.legal_tag);
  if (!tag) return false;
  let pid: string | undefined = l.scope === 'project' && l.scope_id ? l.scope_id : undefined;
  if (!pid && tag.client_id) pid = [...acc.projects.values()].find(p => p.client_id === tag.client_id && p.members.includes(acc.person.id))?.id;
  return canSee(acc, l.legal_tag, pid);
}
/** Proposals are review-queue material: partners and their author see them; confirmed and invalidated lessons are readable by anyone in scope. */
const readable = (acc: Access, l: LessonRecord) => lessonVisible(acc, l) && (l.status !== 'proposed' || isPartner(acc.person) || l.author === acc.person.id);

export function lessonView(l: LessonRecord, now: Date) {
  return { ...l, statement: l.claim, discipline: l.disciplines?.[0] ?? (l.scope === 'discipline' ? l.scope_id : null), decay: Math.round(decayFactor(l, now) * 1e4) / 1e4, rank: lessonRank(l, now) };
}

/** `scope=` filter; with cascade, the scopes a lesson at this level inherits from. */
function scopeMatcher(acc: Access, raw: string | undefined, cascade: boolean): (l: LessonRecord) => boolean {
  if (!raw) return () => true;
  const { scope, id } = parseLessonScope(raw);
  const want: Array<[LessonScope, string | null]> = [[scope, id]];
  if (cascade) {
    if (scope === 'project') { const c = acc.projects.get(id!)?.client_id; if (c) want.push(['client', c]); }
    if (scope !== 'firm') want.push(['firm', null]);
  }
  return (l) => want.some(([s, i]) => l.scope === s && (l.scope_id ?? null) === i);
}

/** Rewrite the index; a filesystem failure must not fail the confirmation, but it must be visible. */
async function reindex(x: Ctx): Promise<IndexResult | { error: string }> {
  try {
    const r = await regenerateLessonsIndex(x.db, { now: x.now });
    x.a.detail.index = { listed: r.listed, omitted: r.omitted, changed: r.changed };
    return r;
  } catch (e) {
    console.error('[lessons] index regeneration failed:', e);
    x.a.detail.index_error = (e as Error).message;
    return { error: (e as Error).message };
  }
}
const indexBody = (r: IndexResult | { error: string }) => 'error' in r ? { error: r.error } : { path: 'vault/firm/LESSONS.md', lines: r.lines, listed: r.listed, omitted: r.omitted, changed: r.changed };

/** Close review-queue rows that this decision settles. */
async function settleQueue(x: Ctx, id: string, outcome: 'accepted' | 'rejected', includeContradictions: boolean): Promise<number> {
  const r = await x.db.query(
    `UPDATE review_queue SET status = $2, resolved_by = $3, resolved_at = $4
      WHERE status = 'open' AND kind IN ('lesson','reconfirm-lesson')
        AND (payload->>'lesson_id' = $1 ${includeContradictions ? `OR payload->'lesson_ids' @> to_jsonb($1::text)` : ''})
        AND ($5::boolean OR coalesce(payload->>'type','') <> 'contradiction')
      RETURNING id`, [id, outcome, x.person.id, x.now.toISOString(), includeContradictions]);
  return r.rows.length;
}

async function optionalBody(x: Ctx): Promise<any> {
  const raw = await x.c.req.text();
  if (!raw.trim()) return {};
  let b: unknown;
  try { b = JSON.parse(raw); } catch { throw bad('request body must be valid JSON', '/', 'invalid_json'); }
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw bad('request body must be a JSON object', '/', 'invalid_json');
  return b;
}

async function load(x: Ctx, acc: Access): Promise<LessonRecord> {
  const id = uuidParam(x.c);
  const l = await loadLesson(x.db, id);
  if (!l) throw notFound(`lesson ${id} not found`);
  if (!lessonVisible(acc, l)) throw forbidden(`lesson ${id} is outside your scope`);
  x.a.scope = l.scope === 'project' && l.scope_id ? scopeLabel(l.scope_id) : l.scope === 'client' && l.scope_id ? `client:${l.scope_id}` : 'firm';
  x.a.refs = [`lesson:${id}`];
  return l;
}

/** The 403 rule. */
function assertMayBeFirmWide(acc: Access, l: LessonRecord): void {
  if (FIRM_REACHING.includes(l.scope) && isNdaTag(acc, l.legal_tag) && !l.sanitised) {
    throw forbidden(`a lesson derived from client-nda evidence cannot have ${l.scope} scope until a partner has sanitised and confirmed it (confirm with {"sanitised": true} after editing the claim)`);
  }
}
/** A partner-confirmed sanitised lesson may be firm-wide: its tag drops to lt-firm. */
function lowerIfSanitised(acc: Access, l: LessonRecord): string | null {
  if (l.sanitised && FIRM_REACHING.includes(l.scope) && isNdaTag(acc, l.legal_tag)) { const from = l.legal_tag; l.legal_tag = 'lt-firm'; return from; }
  return null;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/lessons', 'lesson.list', async (x) => {
    const status = x.c.req.query('status') ?? 'confirmed';
    if (!STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join(', ')}`, '?status');
    const limit = intParam(x.c, 'limit', 100, 500);
    const acc = await loadAccess(x.db, x.person, x.now);
    const match = scopeMatcher(acc, x.c.req.query('scope') || undefined, ['1', 'true'].includes(x.c.req.query('cascade') ?? ''));
    const rows = await loadLessons(x.db, status === 'all' ? 'TRUE' : 'status = $1', status === 'all' ? [] : [status]);
    const now = x.now;
    const out = rows.filter(l => match(l) && readable(acc, l)).sort((a, b) => compareRank(a, b, now)).slice(0, limit);
    x.a.scope = x.c.req.query('scope') || 'firm'; x.a.refs = out.map(l => `lesson:${l.id}`);
    x.a.detail = { status, count: out.length };
    return { body: { lessons: out.map(l => lessonView(l, now)), count: out.length } };
  });

  route(app, 'GET', '/api/lessons/:id', 'lesson.read', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const l = await load(x, acc);
    if (!readable(acc, l)) throw forbidden(`lesson ${l.id} is outside your scope`);
    const supersedes = (await x.db.query<{ id: string }>('SELECT id FROM lessons WHERE superseded_by = $1 ORDER BY created_at, id', [l.id])).rows.map(r => r.id);
    return { body: { ...lessonView(l, x.now), supersedes } };
  });

  route(app, 'POST', '/api/lessons', 'lesson.create', async (x) => {
    const { db, person, now } = x;
    const body = await jsonBody(x.c);
    if (body.status !== undefined && !['proposed', 'confirmed'].includes(body.status)) throw bad('status must be "proposed" or "confirmed"', '/status');
    const wantsConfirmed = body.status === 'confirmed';
    const confirmedNow = wantsConfirmed && isPartner(person);
    const nowIso = now.toISOString();

    // Server-owned fields are filled before validation so the schema sees the whole record; client values for them are ignored.
    const rec: any = {
      recurrence: 1, sanitised: false, disciplines: [], scope_id: body.scope === 'firm' ? null : undefined, valid_from: nowIso,
      ...body,
      id: randomUUID(), author: person.id, created_at: nowIso, valid_to: null, superseded_by: null,
      status: confirmedNow ? 'confirmed' : 'proposed', confirmed_by: confirmedNow ? person.id : null, last_confirmed: confirmedNow ? nowIso : null,
      legal_tag: 'lt-pending',
    };
    if (rec.scope_id === undefined) delete rec.scope_id;
    check('lesson', rec);
    if (rec.scope === 'firm' && rec.scope_id != null) throw bad('scope "firm" takes no scope_id', '/scope_id');
    if (rec.scope !== 'firm' && !rec.scope_id) throw bad(`scope "${rec.scope}" needs a scope_id`, '/scope_id');
    if (rec.scope === 'firm') rec.scope_id = null;
    rec.evidence = [...new Set<string>(rec.evidence)];
    rec.evidence.forEach((e: string, i: number) => { if (!EVIDENCE_RE.test(e)) throw bad(`evidence must be run:<uuid>, doc:<uuid> or transcript:<id>, got "${e}"`, `/evidence/${i}`); });

    const acc = await loadAccess(db, person, now);
    let fallbackTag = 'lt-firm';
    if (rec.scope === 'project') { const p = requireWritableProject(acc, rec.scope_id, '/scope_id'); fallbackTag = p.default_legal_tag; }
    if (rec.scope === 'client') {
      if (!(await db.query('SELECT 1 FROM organisations WHERE id = $1', [rec.scope_id])).rows.length) throw bad(`organisation "${rec.scope_id}" does not exist`, '/scope_id', 'unknown_client');
    }
    x.a.scope = rec.scope === 'project' ? scopeLabel(rec.scope_id) : rec.scope === 'client' ? `client:${rec.scope_id}` : 'firm';

    // Evidence must exist and be within the caller's scope; the lesson's tag is the union of theirs.
    const ev = await resolveEvidence(db, rec.evidence);
    ev.forEach((e, i) => {
      if (!e.found || e.hidden) throw bad(`evidence ${e.ref} does not exist`, `/evidence/${i}`, 'unknown_evidence');
      if (e.legal_tag) assertVisible(acc, e.legal_tag, e.project_id, `evidence ${e.ref}`);
    });
    rec.legal_tag = await deriveLessonTag(db, acc, ev, fallbackTag);
    x.a.refs = [`lesson:${rec.id}`, ...rec.evidence];

    // Client content becomes firm content only through a partner: sanitised and confirmed by them.
    if (FIRM_REACHING.includes(rec.scope) && isNdaTag(acc, rec.legal_tag)) {
      if (!(rec.sanitised === true && confirmedNow)) {
        x.a.detail = { refused: 'nda-evidence' };
        throw forbidden(`a lesson derived from client-nda evidence cannot have ${rec.scope} scope unless it is sanitised and confirmed by a partner`);
      }
    }
    const lowered = lowerIfSanitised(acc, rec);
    if (lowered) x.a.detail.tag_lowered_from = lowered;
    check('lesson', rec);
    await insertLesson(db, rec);
    x.a.detail = { ...x.a.detail, status: rec.status, legal_tag: rec.legal_tag, downgraded: wantsConfirmed && !confirmedNow };
    const idx = confirmedNow ? await reindex(x) : undefined;
    return { status: 201, body: { ...lessonView(rec, now), ...(idx ? { index: indexBody(idx) } : {}) } };
  });

  route(app, 'POST', '/api/lessons/:id/confirm', 'lesson.confirm', async (x) => {
    requirePartner(x.person, 'confirming a lesson');
    const acc = await loadAccess(x.db, x.person, x.now);
    const l = await load(x, acc);
    if (l.status === 'invalidated') throw conflict(`lesson ${l.id} is invalidated; propose a new lesson instead`);
    const b = await optionalBody(x);
    for (const k of Object.keys(b)) if (!['claim', 'detail', 'sanitised'].includes(k)) throw bad(`only claim, detail and sanitised may be edited on confirmation, got "${k}"`, `/${k}`);
    const next: LessonRecord = { ...l };
    if (b.claim !== undefined) next.claim = b.claim;
    if (b.detail !== undefined) next.detail = b.detail;
    if (b.sanitised !== undefined) { if (typeof b.sanitised !== 'boolean') throw bad('sanitised must be true or false', '/sanitised'); next.sanitised = b.sanitised; }
    const nowIso = x.now.toISOString();
    Object.assign(next, { status: 'confirmed', confirmed_by: x.person.id, last_confirmed: nowIso, valid_from: l.valid_from ?? nowIso });
    check('lesson', next);
    assertMayBeFirmWide(acc, next);
    const lowered = lowerIfSanitised(acc, next);
    await saveLesson(x.db, next);

    // An update proposed by the dream supersedes the lesson it refines: retire that one, never delete it.
    const links = (await x.db.query<any>(`SELECT payload FROM review_queue WHERE status = 'open' AND kind = 'lesson' AND payload->>'lesson_id' = $1 AND payload->>'supersedes' IS NOT NULL`, [l.id])).rows;
    const superseded: string[] = [];
    for (const { payload } of links) {
      const old = await loadLesson(x.db, payload.supersedes);
      if (old && old.status !== 'invalidated' && old.id !== next.id) {
        await saveLesson(x.db, { ...old, status: 'invalidated', valid_to: nowIso, superseded_by: next.id });
        superseded.push(old.id);
      }
    }
    const settled = await settleQueue(x, l.id, 'accepted', false);
    x.a.refs = [`lesson:${l.id}`, ...superseded.map(s => `lesson:${s}`)];
    x.a.detail = { was: l.status, edited: Object.keys(b), tag_lowered_from: lowered, superseded, queue_settled: settled };
    const idx = await reindex(x);
    return { body: { ...lessonView(next, x.now), superseded, index: indexBody(idx) } };
  });

  route(app, 'POST', '/api/lessons/:id/reject', 'lesson.reject', async (x) => {
    requirePartner(x.person, 'rejecting a lesson');
    const acc = await loadAccess(x.db, x.person, x.now);
    const l = await load(x, acc);
    if (l.status !== 'proposed') throw conflict(`lesson ${l.id} is ${l.status}; only a proposal can be rejected (use invalidate for a confirmed lesson)`);
    const b = await optionalBody(x);
    const next: LessonRecord = { ...l, status: 'invalidated', valid_to: x.now.toISOString() };
    await saveLesson(x.db, next);
    const settled = await settleQueue(x, l.id, 'rejected', true);
    x.a.detail = { reason: typeof b.reason === 'string' ? b.reason.slice(0, 500) : null, queue_settled: settled };
    return { body: lessonView(next, x.now) };
  });

  route(app, 'POST', '/api/lessons/:id/invalidate', 'lesson.invalidate', async (x) => {
    requirePartner(x.person, 'invalidating a lesson');
    const acc = await loadAccess(x.db, x.person, x.now);
    const l = await load(x, acc);
    if (l.status === 'invalidated') throw conflict(`lesson ${l.id} is already invalidated`);
    const b = await optionalBody(x);
    let by: string | null = null;
    if (b.superseded_by != null) {
      if (typeof b.superseded_by !== 'string' || !UUID_RE.test(b.superseded_by)) throw bad('superseded_by must be a lesson id', '/superseded_by');
      const sid: string = b.superseded_by.toLowerCase();
      if (sid === l.id) throw bad('a lesson cannot supersede itself', '/superseded_by');
      if (!(await loadLesson(x.db, sid))) throw bad(`lesson ${sid} does not exist`, '/superseded_by', 'unknown_lesson');
      by = sid;
    }
    const next: LessonRecord = { ...l, status: 'invalidated', valid_to: x.now.toISOString(), superseded_by: by };
    await saveLesson(x.db, next);
    const settled = await settleQueue(x, l.id, 'rejected', true);
    x.a.refs = [`lesson:${l.id}`, ...(by ? [`lesson:${by}`] : [])];
    x.a.detail = { was: l.status, superseded_by: by, reason: typeof b.reason === 'string' ? b.reason.slice(0, 500) : null, queue_settled: settled };
    const idx = await reindex(x);
    return { body: { ...lessonView(next, x.now), index: indexBody(idx) } };
  });
}
