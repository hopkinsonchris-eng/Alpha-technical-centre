/**
 * The weekly dream (M15, Tier A prompt). Reads the week's runs (with their
 * re-run delta notes), filed correspondence, draft notes and transcripts,
 * together with the existing lessons in the same scopes, and proposes lessons
 * and updates into the partner review queue. It never modifies a confirmed
 * lesson: an update is a new *proposed* lesson that, once a partner confirms
 * it, supersedes the old one (the confirm route retires the old one).
 *
 *   npx tsx src/jobs/dream.ts        (Render cron "atc-vault-weekly-dream")
 *
 * Batch API: the provider is called once per project, sequentially, behind
 * LlmProvider. Every call is independent and self-contained, so moving to the
 * Message Batches API later (50% cost, results within 24 h) is a change to
 * this loop only: build one request per project, submit, and feed the results
 * to `applyCandidates`. It needs a provider method for batches; until then it
 * stays sequential.
 *
 * Rules enforced in code, not trusted to the model:
 *  - every lesson cites >= 1 evidence ref that appears in the input it was
 *    given; other refs are dropped, and a lesson left without evidence is dropped
 *  - a lesson's legal tag is the union of its evidence's tags
 *  - duplicates (normalised-token Jaccard >= 0.8 in the same scope) become a
 *    proposed update with `supersedes`, never a second lesson
 *  - the model may flag `contradicts: [lesson ids]`; both ids go to the queue
 *  - recurrence: a project-scope lesson seen on a third distinct project is
 *    proposed for firm scope with sanitised:false (a partner edits, then confirms)
 *  - lessons unconfirmed for 12 months are queued as 'reconfirm-lesson'
 * Idempotent: running twice over the same week proposes nothing new.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { migrate } from '../db/migrate.ts';
import { openDb } from '../db/client.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { ApiError, loadAccess, type Access } from '../api/common.ts';
import { isExpired, isVisible } from '../legal.ts';
import { validate } from '../schemas.ts';
import {
  deriveLessonTag, insertLesson, isNdaTag, loadLessons, LESSON_SCOPES, reconfirmCutoff, regenerateLessonsIndex, resolveEvidence,
  type IndexResult, type LessonRecord, type LessonScope,
} from './lessons-index.ts';

export const SIMILARITY_THRESHOLD = 0.8;
export const RECURRENCE_PROJECTS = 3;
const JOB_PERSON: Person = { id: 'job:dream', email: 'dream@job.local', name: 'Weekly dream', role: 'service' };

/* ── claim similarity ───────────────────────────────────────────────── */

/** Lower-case, accents stripped, punctuation to spaces: the token set claims are compared on. */
export function claimTokens(claim: string): Set<string> {
  return new Set(claim.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean));
}
/** Jaccard similarity of the normalised token sets: 1 = same words, 0 = nothing shared. */
export function claimSimilarity(a: string, b: string): number {
  const x = claimTokens(a), y = claimTokens(b);
  if (!x.size && !y.size) return 1;
  let inter = 0; for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

/* ── prompt (Tier A) ────────────────────────────────────────────────── */

export const DREAM_SYSTEM = `You are the weekly consolidation pass for a small technical consultancy's record. You read one project's activity for the past week and propose LESSONS: short, actionable claims a colleague on another job would want in front of them.

Rules:
1. Return STRICT JSON only, no prose, no code fence: {"lessons":[{"claim":string,"detail":string,"scope":"firm"|"discipline"|"client"|"project"|"tool","scope_id":string|null,"disciplines":[string],"evidence":[string],"confidence":number,"supersedes":string?,"contradicts":[string]?}]}
2. "claim" is one or two sentences, at most 400 characters, specific and actionable. "detail" gives the background, contributing factors and recommendation (after-action-review shape: what was intended, what happened, why, what to do next time).
3. "evidence" lists at least one reference, and ONLY references written in square brackets in the INPUT below, for example run:<uuid> or doc:<uuid>. Never invent a reference. A lesson you cannot cite is not a lesson.
4. "scope": use "project" (scope_id = the project id) unless the point clearly holds beyond this project. "discipline" needs scope_id = the discipline name, "tool" needs the tool id, "client" needs the client id, "firm" needs scope_id null.
5. "confidence" is 0 to 1: how sure you are that the claim is true and general enough to keep.
6. Do not repeat an EXISTING LESSON. If you are refining one, copy its id (the part after "lesson:") into "supersedes". If your lesson contradicts an existing one, list its id in "contradicts".
7. Prefer few, good lessons. If nothing this week is worth keeping, return {"lessons":[]}.`;

/* ── input ──────────────────────────────────────────────────────────── */

interface InputLine { ref: string; text: string }
export interface ProjectInput {
  project_id: string; client_id: string | null;
  runs: InputLine[]; deltas: InputLine[]; correspondence: InputLine[]; drafts: InputLine[]; transcripts: InputLine[];
  /** Every ref the model may cite for this project (transcript items are citable as doc: and transcript:). */
  allowed: Set<string>;
}
const clip = (s: unknown, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const ymd = (d: unknown) => new Date(d as any).toISOString().slice(0, 10);

async function snippet(db: Db, itemId: string, extracted: any, max: number): Promise<string> {
  const chunks = (await db.query<{ text: string }>('SELECT text FROM chunks WHERE item_id = $1 AND current ORDER BY ordinal LIMIT 4', [itemId])).rows;
  if (chunks.length) return clip(chunks.map(c => c.text).join(' '), max);
  return clip(extracted?.summary ?? extracted?.text ?? extracted?.draft ?? '', max);
}

export async function gatherInput(db: Db, acc: Access, from: Date, to: Date, maxChars = 900): Promise<Map<string, ProjectInput>> {
  const out = new Map<string, ProjectInput>();
  const bucket = (project_id: string, client_id: string | null) => {
    let b = out.get(project_id);
    if (!b) out.set(project_id, b = { project_id, client_id: client_id ?? acc.projects.get(project_id)?.client_id ?? null, runs: [], deltas: [], correspondence: [], drafts: [], transcripts: [], allowed: new Set() });
    return b;
  };
  const live = (tag: string) => { const t = acc.tags.get(tag); return !!t && !isExpired(t, acc.now); };
  const win = [from.toISOString(), to.toISOString()];

  const runs = (await db.query<any>(`SELECT id::text AS id, job, tool_version, status, title, project_id, client_id, legal_tag, created_at, record->'outputs' AS outputs, record->'facets' AS facets
                                       FROM runs WHERE NOT hidden AND created_at >= $1 AND created_at <= $2 ORDER BY created_at, id`, win)).rows;
  for (const r of runs) {
    if (!live(r.legal_tag)) continue;
    const b = bucket(r.project_id, r.client_id);
    b.runs.push({ ref: `run:${r.id}`, text: `${r.job} ${r.tool_version} [${r.status}] ${ymd(r.created_at)} "${clip(r.title, 120)}" outputs: ${clip(JSON.stringify(r.outputs ?? {}), maxChars)}${r.facets?.rerun ? ` (re-run of ${r.facets.rerun.of}; causes: ${clip((r.facets.rerun.causes ?? []).join('; '), 200)})` : ''}` });
    b.allowed.add(`run:${r.id}`);
  }

  const items = (await db.query<any>(`SELECT id::text AS id, type, title, created_at, authored_at, project_id, client_id, legal_tag, extracted FROM items
                                       WHERE NOT hidden AND created_at >= $1 AND created_at <= $2 ORDER BY created_at, id`, win)).rows;
  for (const it of items) {
    if (!live(it.legal_tag)) continue;
    const kind = it.extracted?.kind;
    const ex = it.extracted ?? {};
    const push = async (list: keyof Pick<ProjectInput, 'deltas' | 'correspondence' | 'drafts' | 'transcripts'>, text: string, alsoTranscript = false) => {
      const b = bucket(it.project_id, it.client_id);
      b[list].push({ ref: `doc:${it.id}`, text }); b.allowed.add(`doc:${it.id}`);
      if (alsoTranscript) b.allowed.add(`transcript:${it.id}`);
    };
    const head = `${it.type} ${ymd(it.authored_at ?? it.created_at)} "${clip(it.title, 140)}"`;
    if (kind === 'rerun-delta') await push('deltas', `${head}: ${clip(ex.summary, maxChars)} (run:${ex.of} -> run:${ex.rerun}; causes: ${clip((ex.causes ?? []).join('; '), 200)}${ex.review_required ? '; needed review' : ''})`);
    else if (kind === 'draft') await push('drafts', `${head}: brief "${clip(ex.brief, 200)}" -> ${clip(ex.draft, maxChars)}`);
    else if (it.type === 'transcript') await push('transcripts', `${head}: ${await snippet(db, it.id, ex, maxChars)}`, true);
    else if (it.type === 'email' || it.type === 'letter') await push('correspondence', `${head}: ${await snippet(db, it.id, ex, maxChars)}`);
  }
  return out;
}

export function renderInput(inp: ProjectInput, existing: LessonRecord[], from: Date, to: Date): string {
  const sec = (title: string, lines: InputLine[]) => `${title}:\n${lines.length ? lines.map(l => `- [${l.ref}] ${l.text}`).join('\n') : '- none'}`;
  return [
    `WINDOW: ${ymd(from)} to ${ymd(to)}`,
    `PROJECT: ${inp.project_id}${inp.client_id ? ` (client ${inp.client_id})` : ''}`,
    `EXISTING LESSONS:\n${existing.length ? existing.map(l => `- [lesson:${l.id}] (${l.status}, ${l.scope}${l.scope_id ? ':' + l.scope_id : ''}) ${clip(l.claim, 400)}`).join('\n') : '- none'}`,
    sec('RUNS', inp.runs), sec('RE-RUN DELTAS', inp.deltas), sec('FILED CORRESPONDENCE', inp.correspondence), sec('DRAFT NOTES', inp.drafts), sec('TRANSCRIPTS', inp.transcripts),
    'Return the JSON now.',
  ].join('\n\n');
}

/* ── model output ───────────────────────────────────────────────────── */

export interface Candidate {
  claim: string; detail?: string; scope: LessonScope; scope_id: string | null; disciplines: string[]; evidence: string[]; confidence: number;
  supersedes?: string; contradicts: string[];
}
export function parseDreamJson(text: string): any[] {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('the model did not return a JSON object');
  const j = JSON.parse(t.slice(a, b + 1));
  if (!j || !Array.isArray(j.lessons)) throw new Error('the model output has no "lessons" array');
  return j.lessons;
}
const bareId = (s: unknown) => typeof s === 'string' ? s.replace(/^lesson:/i, '').trim().toLowerCase() : '';

type Drop = 'invalid' | 'no_evidence' | 'scope';
/** Shape one raw lesson from the model into a Candidate, dropping refs the input does not contain. */
export function toCandidate(raw: any, inp: Pick<ProjectInput, 'project_id' | 'client_id' | 'allowed'>, knownProjects: Set<string>, knownClients: Set<string>): { cand?: Candidate; drop?: Drop; fabricated: number } {
  if (!raw || typeof raw !== 'object') return { drop: 'invalid', fabricated: 0 };
  const claim = typeof raw.claim === 'string' ? raw.claim.replace(/\s+/g, ' ').trim() : '';
  if (!claim || claim.length > 400) return { drop: 'invalid', fabricated: 0 };
  const cited: string[] = Array.isArray(raw.evidence) ? raw.evidence.filter((e: unknown): e is string => typeof e === 'string').map((e: string) => e.trim()) : [];
  const evidence = [...new Set(cited.filter(e => inp.allowed.has(e)))];
  const fabricated = new Set(cited.filter(e => !inp.allowed.has(e))).size;
  if (!evidence.length) return { drop: 'no_evidence', fabricated };
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : NaN;
  if (Number.isNaN(confidence)) return { drop: 'invalid', fabricated };
  const scope = raw.scope as LessonScope;
  if (!LESSON_SCOPES.includes(scope)) return { drop: 'invalid', fabricated };
  let scope_id: string | null = typeof raw.scope_id === 'string' && raw.scope_id.trim() ? raw.scope_id.trim() : null;
  if (scope === 'firm') scope_id = null;
  else if (scope === 'project') { scope_id = scope_id ?? inp.project_id; if (!knownProjects.has(scope_id)) return { drop: 'scope', fabricated }; }
  else if (scope === 'client') { scope_id = scope_id ?? inp.client_id; if (!scope_id || !knownClients.has(scope_id)) return { drop: 'scope', fabricated }; }
  else if (!scope_id) return { drop: 'scope', fabricated };
  const disciplines = Array.isArray(raw.disciplines) ? [...new Set<string>(raw.disciplines.filter((d: unknown): d is string => typeof d === 'string' && !!d.trim()).map((d: string) => d.trim().toLowerCase()))] : [];
  const contradicts = Array.isArray(raw.contradicts) ? [...new Set<string>(raw.contradicts.map(bareId).filter(Boolean))] : [];
  return {
    fabricated,
    cand: { claim, ...(typeof raw.detail === 'string' && raw.detail.trim() ? { detail: raw.detail.trim() } : {}), scope, scope_id, disciplines, evidence, confidence, ...(raw.supersedes ? { supersedes: bareId(raw.supersedes) } : {}), contradicts },
  };
}

/* ── the job ────────────────────────────────────────────────────────── */

export interface DreamSummary {
  job_id: number; status: 'ok' | 'failed'; window: { from: string; to: string }; projects: number; calls: number;
  input: { runs: number; deltas: number; correspondence: number; drafts: number; transcripts: number };
  proposed: number; updates: number; contradictions: number; promotions: number; duplicates_skipped: number; suppressed: number;
  fabricated_refs: number; dropped: { invalid: number; no_evidence: number; scope: number; tag: number };
  reconfirm_queued: number; tokens: { input: number; cached: number; output: number }; index?: Pick<IndexResult, 'listed' | 'omitted' | 'changed'>; llm: boolean; error?: string;
}
export interface DreamOptions { now?: Date; days?: number; maxItemChars?: number; firmDir?: string }

const subset = (a: string[], b: string[]) => a.every(x => b.includes(x));
const active = (l: LessonRecord) => l.status === 'confirmed' || l.status === 'proposed';

interface Ctx { db: Db; acc: Access; now: Date; jobId: number; summary: DreamSummary; pool: LessonRecord[] }

async function enqueue(c: Ctx, payload: Record<string, unknown>): Promise<void> {
  await c.db.query("INSERT INTO review_queue (id, kind, payload) VALUES ($1,'lesson',$2::jsonb)", [randomUUID(), JSON.stringify({ dream_job: c.jobId, ...payload })]);
}
/** The claim goes into the queue only when the lesson is not NDA-tagged: the queue list is not scope-filtered. */
const claimForQueue = (c: Ctx, l: LessonRecord) => isNdaTag(c.acc, l.legal_tag) ? {} : { claim: l.claim };

async function propose(c: Ctx, rec: Omit<LessonRecord, 'id' | 'author' | 'created_at' | 'status' | 'legal_tag' | 'valid_from' | 'valid_to' | 'superseded_by' | 'confirmed_by' | 'last_confirmed'>, legal_tag: string): Promise<LessonRecord> {
  const now = c.now.toISOString();
  const l: LessonRecord = { ...rec, id: randomUUID(), author: `dream:${c.jobId}`, created_at: now, valid_from: now, valid_to: null, superseded_by: null, status: 'proposed', confirmed_by: null, last_confirmed: null, legal_tag };
  const errs = validate('lesson', l);
  if (errs.length) throw new Error(`dream produced an invalid lesson: ${errs.map(e => `${e.path} ${e.message}`).join('; ')}`);
  await insertLesson(c.db, l);
  c.pool.push(l);
  return l;
}

/** Apply one project's candidates: dedupe, update, contradiction and recurrence rules. */
export async function applyCandidates(c: Ctx, cands: Candidate[], shownIds: Set<string>): Promise<void> {
  const { summary } = c;
  for (const cand of cands) {
    let legal_tag: string;
    try { legal_tag = await deriveLessonTag(c.db, c.acc, await resolveEvidence(c.db, cand.evidence), 'lt-firm'); }
    catch (e) { if (e instanceof ApiError) { summary.dropped.tag++; continue; } throw e; }

    const sims = c.pool.filter(l => l.scope === cand.scope && (l.scope_id ?? null) === cand.scope_id)
      .map(l => ({ l, s: claimSimilarity(cand.claim, l.claim) })).filter(x => x.s >= SIMILARITY_THRESHOLD);
    // Rejected or invalidated with nothing new to add: do not propose it again every week.
    if (sims.some(x => x.l.status === 'invalidated' && subset(cand.evidence, x.l.evidence)) && !sims.some(x => active(x.l))) { summary.suppressed++; continue; }
    // Nothing to add: a confirmed lesson already says it in the same words on the same evidence, or an open proposal already cites all of it.
    if (sims.some(x => active(x.l) && subset(cand.evidence, x.l.evidence) && (x.s === 1 || x.l.status === 'proposed'))) { summary.duplicates_skipped++; continue; }

    const named = cand.supersedes ? c.pool.find(l => l.id === cand.supersedes && l.status === 'confirmed' && shownIds.has(l.id)) : undefined;
    const target = named ?? sims.filter(x => x.l.status === 'confirmed').sort((a, b) => b.s - a.s || a.l.id.localeCompare(b.l.id))[0]?.l;
    let made: LessonRecord;
    if (target) {
      // Merge into an update: the old lesson's evidence stays; a partner's confirmation retires the old one.
      const evidence = [...new Set([...target.evidence, ...cand.evidence])];
      let tag: string;
      try { tag = await deriveLessonTag(c.db, c.acc, await resolveEvidence(c.db, evidence), 'lt-firm'); }
      catch (e) { if (e instanceof ApiError) { summary.dropped.tag++; continue; } throw e; }
      made = await propose(c, {
        claim: cand.claim, detail: cand.detail ?? target.detail, scope: target.scope, scope_id: target.scope_id ?? null,
        disciplines: [...new Set([...(target.disciplines ?? []), ...cand.disciplines])], sanitised: false, evidence,
        confidence: Math.max(target.confidence, cand.confidence), recurrence: target.recurrence ?? 1,
      }, tag);
      summary.updates++;
      await enqueue(c, { type: 'update', lesson_id: made.id, supersedes: target.id, similarity: Math.round(claimSimilarity(cand.claim, target.claim) * 1000) / 1000, scope: made.scope, scope_id: made.scope_id, confidence: made.confidence, legal_tag: made.legal_tag, ...claimForQueue(c, made) });
    } else if (sims.some(x => x.l.status === 'proposed')) {
      summary.duplicates_skipped++; continue;                        // an open proposal already says this
    } else {
      made = await propose(c, {
        claim: cand.claim, ...(cand.detail ? { detail: cand.detail } : {}), scope: cand.scope, scope_id: cand.scope_id, disciplines: cand.disciplines,
        sanitised: false, evidence: cand.evidence, confidence: cand.confidence, recurrence: 1,
      }, legal_tag);
      summary.proposed++;
      const firmWideNda = ['firm', 'discipline', 'tool'].includes(made.scope) && isNdaTag(c.acc, made.legal_tag);
      await enqueue(c, { type: 'new', lesson_id: made.id, scope: made.scope, scope_id: made.scope_id, confidence: made.confidence, legal_tag: made.legal_tag, needs_sanitising: firmWideNda, ...claimForQueue(c, made) });
    }

    for (const other of cand.contradicts) {
      const old = c.pool.find(l => l.id === other && active(l) && l.id !== made.id);
      if (!old || !shownIds.has(old.id)) continue;
      summary.contradictions++;
      await enqueue(c, { type: 'contradiction', lesson_id: made.id, contradicts: old.id, lesson_ids: [made.id, old.id], scope: made.scope, scope_id: made.scope_id, legal_tag: made.legal_tag });
    }

    if (made.scope === 'project') await maybePromote(c, made);
  }
}

/** Recurrence: the same project-scope claim on a third distinct project is proposed for firm scope, unsanitised. */
async function maybePromote(c: Ctx, seen: LessonRecord): Promise<void> {
  const like = c.pool.filter(l => l.scope === 'project' && active(l) && claimSimilarity(seen.claim, l.claim) >= SIMILARITY_THRESHOLD);
  const projects = [...new Set(like.map(l => l.scope_id!).filter(Boolean))].sort();
  if (projects.length < RECURRENCE_PROJECTS) return;
  if (c.pool.some(l => l.scope === 'firm' && active(l) && claimSimilarity(seen.claim, l.claim) >= SIMILARITY_THRESHOLD)) return;
  // Cite this week's evidence only: mixing three clients' evidence could not carry one legal tag. The other observations are listed in the queue row.
  const firm = await propose(c, {
    claim: seen.claim, detail: `${seen.detail ? seen.detail + '\n\n' : ''}Observed on ${projects.length} distinct projects. Proposed for firm scope: a partner must remove client-identifying detail and confirm it as sanitised.`,
    scope: 'firm', scope_id: null, disciplines: seen.disciplines ?? [], sanitised: false, evidence: seen.evidence, confidence: seen.confidence, recurrence: projects.length,
  }, seen.legal_tag);
  c.summary.promotions++;
  await enqueue(c, { type: 'recurrence', lesson_id: firm.id, proposed_scope: 'firm', sanitised: false, recurrence: projects.length, projects, observed_on: like.map(l => l.id), needs_sanitising: isNdaTag(c.acc, firm.legal_tag), legal_tag: firm.legal_tag, ...claimForQueue(c, firm) });
}

/** Confirmed lessons untouched for 12 months are queued once for re-confirmation. */
export async function queueReconfirmations(db: Db, acc: Access, now: Date): Promise<number> {
  const cutoff = reconfirmCutoff(now).getTime();
  const open = new Set((await db.query<{ id: string }>(`SELECT payload->>'lesson_id' AS id FROM review_queue WHERE kind = 'reconfirm-lesson' AND status = 'open'`)).rows.map(r => r.id));
  let n = 0;
  for (const l of await loadLessons(db, "status = 'confirmed' AND valid_to IS NULL")) {
    if (new Date(l.last_confirmed ?? l.created_at).getTime() >= cutoff || open.has(l.id)) continue;
    await db.query("INSERT INTO review_queue (id, kind, payload) VALUES ($1,'reconfirm-lesson',$2::jsonb)", [randomUUID(), JSON.stringify({
      lesson_id: l.id, scope: l.scope, scope_id: l.scope_id ?? null, legal_tag: l.legal_tag, last_confirmed: l.last_confirmed ?? null,
      months_unconfirmed: Math.floor((now.getTime() - new Date(l.last_confirmed ?? l.created_at).getTime()) / (30.4375 * 86_400_000)), ...(isNdaTag(acc, l.legal_tag) ? {} : { claim: l.claim }),
    })]);
    n++;
  }
  return n;
}

export async function runDream(db: Db, provider: LlmProvider | null, opts: DreamOptions = {}): Promise<DreamSummary> {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - (opts.days ?? 7) * 86_400_000);
  const { rows } = await db.query<{ id: number }>("INSERT INTO jobs (name) VALUES ('weekly-dream') RETURNING id");
  const jobId = rows[0].id;
  const summary: DreamSummary = {
    job_id: jobId, status: 'ok', window: { from: from.toISOString(), to: now.toISOString() }, projects: 0, calls: 0,
    input: { runs: 0, deltas: 0, correspondence: 0, drafts: 0, transcripts: 0 }, proposed: 0, updates: 0, contradictions: 0, promotions: 0,
    duplicates_skipped: 0, suppressed: 0, fabricated_refs: 0, dropped: { invalid: 0, no_evidence: 0, scope: 0, tag: 0 }, reconfirm_queued: 0,
    tokens: { input: 0, cached: 0, output: 0 }, llm: !!provider,
  };
  const acc = await loadAccess(db, JOB_PERSON, now);
  try {
    if (provider) {
      const inputs = await gatherInput(db, acc, from, now, opts.maxItemChars);
      const pool = await loadLessons(db);
      const c: Ctx = { db, acc, now, jobId, summary, pool };
      const projects = new Set(acc.projects.keys());
      const clients = new Set((await db.query<{ id: string }>('SELECT id FROM organisations')).rows.map(r => r.id));
      for (const inp of [...inputs.values()].sort((a, b) => a.project_id.localeCompare(b.project_id))) {
        summary.projects++;
        summary.input.runs += inp.runs.length; summary.input.deltas += inp.deltas.length; summary.input.correspondence += inp.correspondence.length;
        summary.input.drafts += inp.drafts.length; summary.input.transcripts += inp.transcripts.length;
        // Existing lessons in this project's scopes, and only those its client may see (an NDA lesson of another client never enters the prompt).
        const scope = { include_public: true, include_firm: true, project_id: inp.project_id, client_id: inp.client_id ?? undefined, is_partner: false };
        const shown = pool.filter(l => active(l) && (l.scope === 'firm' || l.scope === 'discipline' || l.scope === 'tool' || (l.scope === 'project' && l.scope_id === inp.project_id) || (l.scope === 'client' && l.scope_id === inp.client_id))
          && !!acc.tags.get(l.legal_tag) && isVisible(acc.tags.get(l.legal_tag)!, scope, now));
        const res = await provider.complete({ system: DREAM_SYSTEM, messages: [{ role: 'user', content: renderInput(inp, shown, from, now) }], maxTokens: 4096, temperature: 0.2 });
        summary.calls++;
        summary.tokens.input += res.usage.input; summary.tokens.cached += res.usage.cached; summary.tokens.output += res.usage.output;
        await db.query("INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out) VALUES ('job:dream','llm.dream',$1,$2::text[],$3::jsonb,$4,$5,$6)",
          [`project:${inp.project_id}`, [...inp.allowed].slice(0, 100), JSON.stringify({ model: res.model, job: jobId }), res.usage.input, res.usage.cached, res.usage.output]);
        let raw: any[];
        try { raw = parseDreamJson(res.text); } catch (e) { throw new Error(`project ${inp.project_id}: ${(e as Error).message}`); }
        const cands: Candidate[] = [];
        for (const r of raw) {
          const x = toCandidate(r, inp, projects, clients);
          summary.fabricated_refs += x.fabricated;
          if (x.cand) cands.push(x.cand); else summary.dropped[x.drop!]++;
        }
        await applyCandidates(c, cands, new Set(shown.map(l => l.id)));
      }
    }
  } catch (e) {
    summary.status = 'failed'; summary.error = (e as Error).message;
  }
  // Independent of the model: decay's queue and the core index are refreshed every week, even after a failed call.
  try {
    summary.reconfirm_queued = await queueReconfirmations(db, acc, now);
    const idx = await regenerateLessonsIndex(db, { now, dir: opts.firmDir });
    summary.index = { listed: idx.listed, omitted: idx.omitted, changed: idx.changed };
  } catch (e) {
    summary.status = 'failed'; summary.error = [summary.error, (e as Error).message].filter(Boolean).join('; ');
  }
  await db.query("UPDATE jobs SET finished_at=now(), status=$2, summary=$3::jsonb WHERE id=$1", [jobId, summary.status, JSON.stringify(summary)]);
  await db.query("INSERT INTO audit_events (person_id, action, scope, detail) VALUES ('job:dream','lesson.dream','firm',$1::jsonb)", [JSON.stringify(summary)]);
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  await migrate(db);
  const s = await runDream(db, openProvider());
  console.log(JSON.stringify(s));
  await db.close();
  if (s.status === 'failed') process.exitCode = 1;
}
