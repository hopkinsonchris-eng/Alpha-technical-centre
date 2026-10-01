/**
 * Drafting assistant core (M13, Tier A). Builds the context for a draft from
 * the Vault only, asks the model, and refuses to let an uncited factual
 * sentence through: it is rewritten as a question to the author.
 *
 * Kinds: email | letter | report-section | calc-note. Scope comes from the
 * project; every retrieval goes through the gateway with that scope.
 */
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import type { LlmProvider } from './provider.ts';
import { hybridSearch, type SearchHit, type SearchDeps } from '../gateway/search.ts';
import { resolveScope, type ProjectInfo } from '../gateway/scope.ts';

export type DraftKind = 'email' | 'letter' | 'report-section' | 'calc-note';
export interface DraftRequest { kind: DraftKind; project_id: string; brief: string; organisation_id?: string; thread_id?: string; language?: 'en' | 'es'; tone?: string; run_id?: string }
export interface Source { ref: string; title: string; why: string; snippet?: string; date?: string }
export interface DraftContext {
  scope: string; project: any; organisation?: any; contacts?: any[]; dispatches?: any[]; contracts?: any[];
  runs: any[]; sources: Source[]; lessons: any[]; who_to_ask: Array<{ person: string; last: string; on: string }>; sub_queries: string[]; house_style: string; letterhead?: string;
}
export interface DraftResult { draft: string; paragraphs: string[]; citations: string[]; sources: Source[]; who_to_ask: DraftContext['who_to_ask']; warnings: string[]; questions: string[]; usage?: { input: number; cached: number; output: number }; model?: string; context: DraftContext }

const CITE_RE = /\[(run|doc|lesson|ref|wm):[^\]]+\]/g;   // wm: World Monitor live risk, conflict events and headlines (wave 3)
export const ymd = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const NUMBER_RE = /\d/;

/** Split a brief into up to six independent sub-queries (cheap heuristic; the model refines nothing here). */
export function decompose(brief: string, extra: string[] = []): string[] {
  const parts = brief.split(/[.;\n]+|\band\b|\by\b/i).map(s => s.trim()).filter(s => s.length > 12);
  const uniq: string[] = [];
  for (const p of [...extra, ...parts]) if (!uniq.some(u => u.toLowerCase() === p.toLowerCase())) uniq.push(p);
  return uniq.slice(0, 6);
}

/** Sentences carrying a number or a claim marker must cite; the rest may not. */
export function checkCitations(paragraphs: string[], allowed: Set<string>): { paragraphs: string[]; warnings: string[]; questions: string[]; citations: string[] } {
  const warnings: string[] = [], questions: string[] = [], citations = new Set<string>();
  const out = paragraphs.map((p, pi) => {
    // Split on sentence ends without losing a character; bracketed questions stay whole.
    const sentences = p.split(/(?<=[.!?])\s+(?![^\[]*\])/);
    return sentences.map(s => {
      const cites = [...s.matchAll(CITE_RE)].map(m => m[0].slice(1, -1));
      const unknown = cites.filter(c => !allowed.has(c));
      if (unknown.length) { warnings.push(`paragraph ${pi + 1}: citation outside scope removed (${unknown.join(', ')})`); s = s.replace(CITE_RE, m => (allowed.has(m.slice(1, -1)) ? m : '')); }
      for (const c of cites) if (allowed.has(c)) citations.add(c);
      const factual = NUMBER_RE.test(s) && !/^\s*(our ref|your ref|date|dear|yours|atentamente|estimad)/i.test(s);
      if (factual && !cites.some(c => allowed.has(c))) {
        questions.push(s.trim());
        return `[QUESTION FOR YOU: this sentence carries a figure with no record in scope to cite: "${s.trim()}"]`;
      }
      return s;
    }).join(' ');
  });
  return { paragraphs: out, warnings, questions, citations: [...citations] };
}

async function loadProjects(db: Db): Promise<Map<string, ProjectInfo>> {
  return new Map((await db.query<any>('SELECT id, client_id, members FROM projects')).rows.map(r => [r.id, { id: r.id, client_id: r.client_id, members: r.members ?? [] }]));
}

export async function assembleContext(db: Db, person: Person, req: DraftRequest, search: SearchDeps, now = new Date()): Promise<DraftContext> {
  const projects = await loadProjects(db);
  const scope = resolveScope(`project:${req.project_id}`, person, projects);
  const project = (await db.query<any>('SELECT * FROM projects WHERE id = $1', [req.project_id])).rows[0];
  if (!project) throw Object.assign(new Error(`project ${req.project_id} not found`), { status: 404 });
  const ctx: DraftContext = { scope: scope.label, project, runs: [], sources: [], lessons: [], who_to_ask: [], sub_queries: [], house_style: '' };
  ctx.house_style = (await db.query<any>("SELECT value FROM settings WHERE key = 'house_style'")).rows[0]?.value ?? 'ATC house style: purpose first, one idea per paragraph, every figure cites its run or document, British English or Spanish as the counterparty prefers.';

  const orgId = req.organisation_id ?? project.client_id;
  if (orgId) {
    ctx.organisation = (await db.query<any>('SELECT * FROM organisations WHERE id = $1', [orgId])).rows[0];
    ctx.contacts = (await db.query<any>('SELECT * FROM contacts WHERE organisation_id = $1 ORDER BY name', [orgId])).rows;
    ctx.dispatches = (await db.query<any>(`SELECT d.id, d.direction, d.channel, d.occurred_at, d.reference_no, d.their_reference, d.acknowledged_at, i.title, i.id AS item_id, i.type
                                            FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.organisation_id = $1 AND NOT i.hidden ORDER BY d.occurred_at ASC`, [orgId])).rows;
    ctx.contracts = (await db.query<any>(`SELECT id, type, title, authored_at, reference_no, extracted, legal_tag FROM items WHERE NOT hidden AND type IN ('nda','contract','licence') AND $1 = ANY(organisation_ids) ORDER BY authored_at DESC`, [orgId])).rows;
  }
  // Runs in scope: the project's non-superseded runs, newest first; a named run first.
  ctx.runs = (await db.query<any>(`SELECT id, job, tool_version, title, status, created_at, record->'outputs' AS outputs, record->'assumptions' AS assumptions, stale, legal_tag, project_id FROM runs
                                    WHERE project_id = $1 AND NOT hidden AND status <> 'superseded' ORDER BY (id = $2::uuid) DESC NULLS LAST, created_at DESC LIMIT 12`, [req.project_id, req.run_id ?? null])).rows;
  // Lessons in scope.
  ctx.lessons = (await db.query<any>(`SELECT id, record->>'claim' AS claim, scope, scope_id, last_confirmed FROM lessons WHERE status = 'confirmed' AND (scope IN ('firm') OR (scope = 'project' AND scope_id = $1) OR (scope = 'client' AND scope_id = $2) OR scope = 'discipline') ORDER BY last_confirmed DESC NULLS LAST LIMIT 12`, [req.project_id, project.client_id])).rows;
  // Retrieval: sub-queries through the gateway.
  ctx.sub_queries = decompose(req.brief, ctx.organisation ? [ctx.organisation.name] : []);
  const seen = new Map<string, Source>();
  for (const q of ctx.sub_queries) {
    let hits: SearchHit[] = [];
    try { hits = await hybridSearch(db, q, scope, person, projects, search, { k: 7, now }); } catch { hits = []; }
    for (const h of hits) if (!seen.has(h.ref)) seen.set(h.ref, { ref: h.ref, title: h.title ?? h.ref, why: q, snippet: h.snippet });
  }
  ctx.sources = [...seen.values()].slice(0, 7);
  // Colleagues who last worked the topic: authors of the runs and sources.
  const authors = (await db.query<any>(`SELECT author AS person, max(created_at) AS last, max(job) AS on FROM runs WHERE project_id = $1 AND NOT hidden GROUP BY author ORDER BY last DESC LIMIT 3`, [req.project_id])).rows;
  ctx.who_to_ask = authors.filter(a => a.person !== person.id).map(a => ({ person: a.person, last: new Date(a.last).toISOString().slice(0, 10), on: a.on }));
  if (req.kind === 'letter') ctx.letterhead = (await db.query<any>("SELECT id FROM firm_assets WHERE kind = 'letterhead' AND is_current AND language = $1 LIMIT 1", [req.language ?? 'en'])).rows[0]?.id;
  return ctx;
}

export function allowedRefs(ctx: DraftContext): Set<string> {
  const s = new Set<string>();
  for (const r of ctx.runs) s.add(`run:${r.id}`);
  for (const x of ctx.sources) s.add(x.ref);
  for (const l of ctx.lessons) s.add(`lesson:${l.id}`);
  for (const d of ctx.dispatches ?? []) s.add(`doc:${d.item_id}`);
  for (const c of ctx.contracts ?? []) s.add(`doc:${c.id}`);
  return s;
}

export function systemPrompt(kind: DraftKind, language: 'en' | 'es', houseStyle: string): string {
  const lang = language === 'es' ? 'Spanish (Latin American, formal usted)' : 'British English';
  const shape = {
    email: 'a short professional email: greeting line, two to four paragraphs, sign-off. No subject line in the body.',
    letter: 'a formal business letter body only (no addresses, references or signature: those are rendered separately): opening paragraph stating the purpose, then one idea per paragraph, no bullet lists, a closing paragraph proposing the next step.',
    'report-section': 'a section of a technical report: a short heading line, then paragraphs; tables are allowed as Markdown.',
    'calc-note': 'a basis-of-calculation note (PRMS §1.2.0.12 shape): Method; Data relied on; Data accepted as represented; Assumptions with sources; Tool and version; Result and range.',
  }[kind];
  return `You draft documents for the partners of Alpha Technical Centre, an oil and gas technical consultancy. Write ${shape} Language: ${lang}.
Rules that are checked mechanically after you answer:
1. Every sentence that states a figure, a date or a fact from the record must end with a citation in square brackets taken ONLY from the CONTEXT: [run:<id>], [doc:<id>], [lesson:<id>]. Never invent an id. A sentence you cannot cite must be written as a question to the author in the form [QUESTION FOR YOU: ...].
2. Use only the context. Do not add knowledge from outside it.
3. When previous correspondence is listed, refer to the relevant earlier documents by their date and reference number.
4. Apply the lessons in the context where they bear on the draft.
5. House style: ${houseStyle}
Return plain text paragraphs separated by blank lines. No preamble, no explanation.`;
}

export function userPrompt(req: DraftRequest, ctx: DraftContext): string {
  const lines: string[] = [];
  lines.push(`BRIEF: ${req.brief}`);
  lines.push(`PROJECT: ${ctx.project.name} (${ctx.project.id}); client ${ctx.project.client_id ?? 'none'}; scope ${ctx.scope}`);
  if (ctx.organisation) {
    lines.push(`COUNTERPARTY: ${ctx.organisation.name} (${ctx.organisation.kind}); contacts: ${(ctx.contacts ?? []).map(c => `${c.name}${c.role ? ', ' + c.role : ''}`).join('; ') || 'none'}`);
    lines.push(`PREVIOUS CORRESPONDENCE (oldest first): ${(ctx.dispatches ?? []).map(d => `${ymd(d.occurred_at)} ${d.direction} ${d.channel} ${d.reference_no ?? d.their_reference ?? ''} "${d.title}" [doc:${d.item_id}]`).join(' | ') || 'none'}`);
    lines.push(`CONTRACTS IN FORCE: ${(ctx.contracts ?? []).map(c => `${c.type} "${c.title}" ${c.extracted?.effective_date ?? ''}→${c.extracted?.expiry ?? ''} [doc:${c.id}]`).join(' | ') || 'none'}`);
  }
  lines.push(`RUNS: ${ctx.runs.map(r => `${r.title ?? r.job} (${r.job}@${r.tool_version}, ${r.status}${r.stale ? ', STALE' : ''}) outputs ${JSON.stringify(r.outputs)} [run:${r.id}]`).join(' | ') || 'none'}`);
  lines.push(`SOURCES: ${ctx.sources.map(s => `"${s.title}" — ${s.snippet ?? ''} [${s.ref}]`).join(' | ') || 'none'}`);
  lines.push(`LESSONS: ${ctx.lessons.map(l => `${l.claim} [lesson:${l.id}]`).join(' | ') || 'none'}`);
  if (ctx.who_to_ask.length) lines.push(`COLLEAGUES WHO WORKED THIS: ${ctx.who_to_ask.map(w => `${w.person} (${w.on}, ${w.last})`).join('; ')}`);
  return lines.join('\n');
}

export async function draft(db: Db, person: Person, req: DraftRequest, provider: LlmProvider | null, search: SearchDeps, now = new Date()): Promise<DraftResult> {
  const ctx = await assembleContext(db, person, req, search, now);
  const language = req.language ?? 'en';
  const allowed = allowedRefs(ctx);
  let text: string; let usage; let model;
  if (provider) {
    const r = await provider.complete({ system: systemPrompt(req.kind, language, ctx.house_style), messages: [{ role: 'user', content: userPrompt(req, ctx) }], maxTokens: 1500 });
    text = r.text; usage = r.usage; model = r.model;
  } else {
    text = fallbackDraft(req, ctx, language);
  }
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const checked = checkCitations(paragraphs, allowed);
  const warnings = [...checked.warnings];
  if (checked.questions.length) warnings.push(`${checked.questions.length} sentence(s) had no citation and were turned into questions for you`);
  if (!ctx.sources.length && !ctx.runs.length) warnings.push('no runs or documents were found in scope; the draft is skeletal');
  return { draft: checked.paragraphs.join('\n\n'), paragraphs: checked.paragraphs, citations: checked.citations, sources: ctx.sources, who_to_ask: ctx.who_to_ask, warnings, questions: checked.questions, usage, model, context: ctx };
}

/** No provider configured: a skeleton that still cites everything it can, so the pipeline works end to end. */
function fallbackDraft(req: DraftRequest, ctx: DraftContext, language: 'en' | 'es'): string {
  const es = language === 'es';
  const p: string[] = [];
  const last = (ctx.dispatches ?? []).filter(d => d.direction === 'out').at(-1);
  if (last) p.push(es ? `Con referencia a nuestra comunicación del ${ymd(last.occurred_at)} (${last.reference_no ?? ''}) [doc:${last.item_id}].` : `Further to our ${last.channel === 'email' ? 'email' : 'letter'} of ${ymd(last.occurred_at)} (${last.reference_no ?? ''}) [doc:${last.item_id}].`);
  p.push(`[QUESTION FOR YOU: ${req.brief}]`);
  for (const r of ctx.runs.slice(0, 2)) {
    const first = Object.entries(r.outputs ?? {})[0];
    if (first) p.push(es ? `Nuestro cálculo "${r.title ?? r.job}" indica ${first[0]} = ${(first[1] as any).value} ${(first[1] as any).unit ?? ''} [run:${r.id}].` : `Our calculation "${r.title ?? r.job}" gives ${first[0]} = ${(first[1] as any).value} ${(first[1] as any).unit ?? ''} [run:${r.id}].`);
  }
  const nda = (ctx.contracts ?? []).find(c => c.type === 'nda');
  if (nda) p.push(es ? `Este intercambio se realiza bajo el acuerdo de confidencialidad vigente [doc:${nda.id}].` : `This exchange falls under the confidentiality agreement in force [doc:${nda.id}].`);
  return p.join('\n\n');
}
