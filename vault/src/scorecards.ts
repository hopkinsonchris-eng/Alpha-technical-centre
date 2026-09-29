/**
 * Project scorecards (M17). Six rules per project, each `pass`, `fail` or `not-measurable`, each with the refs it
 * looked at (the offending records on a fail, the evidence on a pass). The server is the source of truth; the Hub
 * shows what this returns.
 *
 *   1 tool-version      Every final run uses the current tool version
 *                       final runs whose tool is in the registry; fail when one is older than aliases.current.
 *                       Not measurable: no final run of a registered tool.
 *   2 basis-note        Every evaluation has a basis note
 *                       final runs of evaluation tools (analogues/emit isEvaluationTool) must be cited by a note that is
 *                       a basis note (extracted.kind = "basis", or a title starting "Basis"). Not measurable: no such run.
 *   3 letter-cites-run  Every letter cites at least one run
 *                       outbound letters (an item type "letter" with no inbound-only dispatch) need a run: ref in item_cites.
 *                       Not measurable: no outbound letter.
 *   4 stale-documents   No stale document older than 7 days
 *                       items flagged stale by the nightly job whose date (authored, else created) is over 7 days old.
 *                       Not measurable until the nightly staleness job has run at least once.
 *   5 unfiled-mail      No unfiled correspondence older than 3 days
 *                       open filing-queue rows that name this project among their suggestions, queued over 3 days ago.
 *                       Not measurable until mail capture has run (a mail cursor, a queue row or an email item exists).
 *   6 legal-expiry      Legal tags not expiring within 30 days without a renewal note
 *                       tags of the project and of its records that expire within 30 days need a note (extracted.kind
 *                       "renewal", or a title containing "renew") that names the tag id (extracted.legal_tag, tags,
 *                       a tag: cite, or the title). Not measurable: none of the project's tags carries an expiry.
 *
 * Only records the caller may see count (canSee: legal tag, project membership, partners-only types), so a scorecard
 * never reveals that a record the caller cannot open exists. RAG: grey when nothing is measurable; otherwise green with
 * no failing rule, amber with one or two, red with three or more (the Hub's "4 or 5 of 6 is amber" reading).
 */
import type { Db } from './db/client.ts';
import type { Person } from './auth.ts';
import { assertVisible, canSee, loadAccess, notFound, type Access, type ProjectRow } from './api/common.ts';
import { isEvaluationTool } from './analogues/emit.ts';
import { cmpSemver } from './jobs/staleness.ts';

export type RuleStatus = 'pass' | 'fail' | 'not-measurable';
export type Rag = 'green' | 'amber' | 'red' | 'grey';
export interface RuleResult { n: number; id: string; name: string; status: RuleStatus; detail: string; refs: string[] }
export interface Scorecard {
  project_id: string; as_of: string; rules: RuleResult[];
  summary: { pass: number; fail: number; not_measurable: number; rag: Rag };
}

export const RULES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'tool-version', name: 'Every final run uses the current tool version' },
  { id: 'basis-note', name: 'Every evaluation has a basis note' },
  { id: 'letter-cites-run', name: 'Every letter cites at least one run' },
  { id: 'stale-documents', name: 'No stale document older than 7 days' },
  { id: 'unfiled-mail', name: 'No unfiled correspondence older than 3 days' },
  { id: 'legal-expiry', name: 'Legal tags not expiring within 30 days without a renewal note' },
];
export const STALE_DAYS = 7, UNFILED_DAYS = 3, EXPIRY_DAYS = 30;
const DAY = 864e5;
const REF_CAP = 50;

interface Shared { tools: Map<string, any>; stalenessRan: boolean; mailSeen: boolean }

async function loadShared(db: Db): Promise<Shared> {
  const tools = new Map((await db.query<{ id: string; manifest: any }>('SELECT id, manifest FROM tools')).rows.map(t => [t.id, t.manifest]));
  const stalenessRan = (await db.query("SELECT 1 FROM audit_events WHERE action = 'staleness.run' LIMIT 1")).rows.length > 0;
  const mailSeen = (await db.query("SELECT 1 FROM mail_cursors LIMIT 1")).rows.length > 0
    || (await db.query("SELECT 1 FROM filing_queue LIMIT 1")).rows.length > 0
    || (await db.query("SELECT 1 FROM items WHERE type = 'email' LIMIT 1")).rows.length > 0;
  return { tools, stalenessRan, mailSeen };
}

const at = (d: unknown) => new Date(d as any).getTime();
const list = (xs: string[]) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function compute(db: Db, acc: Access, project: ProjectRow, sh: Shared, now: Date): Promise<Scorecard> {
  const pid = project.id;
  const runs = (await db.query<any>('SELECT id::text AS id, job, tool_version, status, legal_tag FROM runs WHERE project_id = $1 AND NOT hidden ORDER BY created_at, id', [pid])).rows
    .filter(r => canSee(acc, r.legal_tag, pid));
  const itemRows = (await db.query<any>('SELECT id::text AS id, type, title, legal_tag, created_at, authored_at, stale, tags, extracted, supersedes::text AS supersedes FROM items WHERE project_id = $1 AND NOT hidden ORDER BY created_at, id', [pid])).rows
    .filter(i => canSee(acc, i.legal_tag, pid, i));
  const superseded = new Set(itemRows.map(i => i.supersedes).filter((x): x is string => !!x));
  const items = itemRows.filter(i => !superseded.has(i.id));
  const ids = itemRows.map(i => i.id);
  const cites = new Map<string, string[]>();
  const dispatches = new Map<string, Set<string>>();
  if (ids.length) {
    for (const c of (await db.query<any>('SELECT item_id::text AS item_id, ref FROM item_cites WHERE item_id = ANY($1::uuid[])', [ids])).rows) (cites.get(c.item_id) ?? cites.set(c.item_id, []).get(c.item_id)!).push(c.ref);
    for (const d of (await db.query<any>('SELECT item_id::text AS item_id, direction FROM dispatches WHERE item_id = ANY($1::uuid[])', [ids])).rows) (dispatches.get(d.item_id) ?? dispatches.set(d.item_id, new Set()).get(d.item_id)!).add(d.direction);
  }
  const out: RuleResult[] = [];
  const rule = (i: number, status: RuleStatus, detail: string, refs: string[]) => out.push({ n: i + 1, id: RULES[i].id, name: RULES[i].name, status, detail, refs: [...new Set(refs)].slice(0, REF_CAP) });

  // 1. final runs on the current tool version
  const finals = runs.filter(r => r.status === 'final' && sh.tools.get(r.job)?.aliases?.current);
  if (!finals.length) rule(0, 'not-measurable', 'No final run of a registered tool in this project.', []);
  else {
    const old = finals.filter(r => cmpSemver(r.tool_version, sh.tools.get(r.job).aliases.current) < 0);
    if (!old.length) rule(0, 'pass', `All ${plural(finals.length, 'final run', 'final runs')} use the current tool version.`, finals.map(r => `run:${r.id}`));
    else rule(0, 'fail', `${old.length} of ${plural(finals.length, 'final run', 'final runs')} use an older tool version: ${list(old.map(r => `${r.job}@${r.tool_version} (current ${sh.tools.get(r.job).aliases.current})`))}.`, old.map(r => `run:${r.id}`));
  }

  // 2. evaluations have a basis note
  const evals = runs.filter(r => r.status === 'final' && isEvaluationTool(sh.tools.get(r.job)));
  if (!evals.length) rule(1, 'not-measurable', 'No final evaluation run in this project.', []);
  else {
    const isBasis = (i: any) => i.type === 'note' && (i.extracted?.kind === 'basis' || /^basis/i.test(i.title ?? ''));
    const covered = new Set<string>();
    const noteRefs: string[] = [];
    for (const n of items.filter(isBasis)) for (const c of cites.get(n.id) ?? []) if (c.startsWith('run:')) { covered.add(c.slice(4)); noteRefs.push(`doc:${n.id}`); }
    const missing = evals.filter(r => !covered.has(r.id));
    if (!missing.length) rule(1, 'pass', `All ${plural(evals.length, 'final evaluation', 'final evaluations')} are cited by a basis note.`, [...evals.map(r => `run:${r.id}`), ...noteRefs]);
    else rule(1, 'fail', `${missing.length} of ${plural(evals.length, 'final evaluation', 'final evaluations')} have no basis note: ${list(missing.map(r => r.job))}.`, missing.map(r => `run:${r.id}`));
  }

  // 3. letters cite a run
  const letters = items.filter(i => i.type === 'letter' && !(dispatches.get(i.id)?.has('in') && !dispatches.get(i.id)?.has('out')));
  if (!letters.length) rule(2, 'not-measurable', 'No outbound letter in this project.', []);
  else {
    const bare = letters.filter(l => !(cites.get(l.id) ?? []).some(c => c.startsWith('run:')));
    if (!bare.length) rule(2, 'pass', `All ${plural(letters.length, 'letter', 'letters')} cite at least one run.`, letters.map(l => `doc:${l.id}`));
    else rule(2, 'fail', `${bare.length} of ${plural(letters.length, 'letter', 'letters')} cite no run: ${list(bare.map(l => l.title))}.`, bare.map(l => `doc:${l.id}`));
  }

  // 4. stale documents
  if (!sh.stalenessRan) rule(3, 'not-measurable', 'The nightly staleness job has not run yet.', []);
  else {
    const old = items.filter(i => i.stale && now.getTime() - at(i.authored_at ?? i.created_at) > STALE_DAYS * DAY);
    if (!old.length) rule(3, 'pass', `No document has been stale for more than ${STALE_DAYS} days.`, items.filter(i => i.stale).map(i => `doc:${i.id}`));
    else rule(3, 'fail', `${plural(old.length, 'document is', 'documents are')} stale and older than ${STALE_DAYS} days: ${list(old.map(i => i.title))}.`, old.map(i => `doc:${i.id}`));
  }

  // 5. unfiled correspondence
  if (!sh.mailSeen) rule(4, 'not-measurable', 'Mail capture has not run yet.', []);
  else {
    const q = (await db.query<any>(
      `SELECT q.item_id::text AS item_id, q.created_at, i.title, i.project_id, i.legal_tag, i.type, i.extracted
         FROM filing_queue q JOIN items i ON i.id = q.item_id
        WHERE q.status = 'open' AND NOT i.hidden AND q.suggestions @> $1::jsonb ORDER BY q.created_at`, [JSON.stringify([{ project_id: pid }])])).rows
      .filter(r => canSee(acc, r.legal_tag, r.project_id, r));
    const old = q.filter(r => now.getTime() - at(r.created_at) > UNFILED_DAYS * DAY);
    if (!old.length) rule(4, 'pass', q.length ? `${plural(q.length, 'message is', 'messages are')} waiting to be filed, none for more than ${UNFILED_DAYS} days.` : 'No correspondence is waiting to be filed to this project.', q.map(r => `doc:${r.item_id}`));
    else rule(4, 'fail', `${plural(old.length, 'message has', 'messages have')} waited more than ${UNFILED_DAYS} days to be filed here: ${list(old.map(r => r.title))}.`, old.map(r => `doc:${r.item_id}`));
  }

  // 6. legal tags expiring soon
  const tagIds = new Set<string>([project.default_legal_tag, ...items.map(i => i.legal_tag), ...runs.map(r => r.legal_tag)]);
  const expiring = [...tagIds].map(id => acc.tags.get(id)).filter((t): t is NonNullable<typeof t> => !!t && !!t.expires_at);
  if (!expiring.length) rule(5, 'not-measurable', 'None of the legal tags on this project has an expiry date.', []);
  else {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const soon = expiring.filter(t => Math.round((Date.parse(t.expires_at! + 'T00:00:00Z') - today) / DAY) <= EXPIRY_DAYS);
    const notes = items.filter(i => i.type === 'note' && (i.extracted?.kind === 'renewal' || /renew/i.test(i.title ?? '')));
    const covered = (tagId: string) => notes.some(n => n.extracted?.legal_tag === tagId || (n.tags ?? []).includes(tagId) || (cites.get(n.id) ?? []).includes(`tag:${tagId}`) || (n.title ?? '').includes(tagId));
    const bare = soon.filter(t => !covered(t.id));
    if (!bare.length) rule(5, 'pass', soon.length ? `${plural(soon.length, 'tag expires', 'tags expire')} within ${EXPIRY_DAYS} days and each has a renewal note.` : `No legal tag expires within ${EXPIRY_DAYS} days (next: ${expiring.map(t => t.expires_at!).sort()[0]}).`, expiring.map(t => `tag:${t.id}`));
    else rule(5, 'fail', `${plural(bare.length, 'legal tag expires', 'legal tags expire')} within ${EXPIRY_DAYS} days with no renewal note: ${list(bare.map(t => `${t.id} (${t.expires_at})`))}.`, bare.map(t => `tag:${t.id}`));
  }

  const pass = out.filter(r => r.status === 'pass').length, fail = out.filter(r => r.status === 'fail').length, nm = out.length - pass - fail;
  const rag: Rag = pass + fail === 0 ? 'grey' : fail === 0 ? 'green' : fail <= 2 ? 'amber' : 'red';
  return { project_id: pid, as_of: now.toISOString(), rules: out, summary: { pass, fail, not_measurable: nm, rag } };
}

/** The scorecard of one project as `person` may see it. Throws ApiError 404 (no such project or expired tag) or 403. */
export async function scorecard(db: Db, person: Person, projectId: string, now = new Date()): Promise<Scorecard> {
  const acc = await loadAccess(db, person, now);
  const p = acc.projects.get(projectId);
  if (!p) throw notFound(`project "${projectId}" not found`);
  assertVisible(acc, p.default_legal_tag, p.id, `project "${projectId}"`);
  return compute(db, acc, p, await loadShared(db), now);
}

export interface ScorecardRow { project_id: string; name: string; client_id: string | null; client_name: string | null; status: string; scorecard: Scorecard }

/** Every project the person can see (the internal `firm` inbox excluded), by name. */
export async function scorecards(db: Db, person: Person, now = new Date()): Promise<ScorecardRow[]> {
  const acc = await loadAccess(db, person, now);
  const sh = await loadShared(db);
  const names = new Map((await db.query<{ id: string; name: string }>('SELECT id, name FROM organisations')).rows.map(o => [o.id, o.name]));
  const rows: ScorecardRow[] = [];
  for (const p of [...acc.projects.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (p.id === 'firm' || !canSee(acc, p.default_legal_tag, p.id)) continue;
    rows.push({ project_id: p.id, name: p.name, client_id: p.client_id, client_name: p.client_id ? names.get(p.client_id) ?? p.client_id : null, status: p.status, scorecard: await compute(db, acc, p, sh, now) });
  }
  return rows;
}
