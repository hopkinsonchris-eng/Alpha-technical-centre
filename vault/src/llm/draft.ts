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
export interface DraftRequest { kind: DraftKind; project_id: string; brief: string; organisation_id?: string; thread_id?: string; language?: 'en' | 'es'; tone?: string; run_id?: string;
  /** Wave 5: the draft to rewrite under `tone` (shorter, longer, formal, plain), so a re-draft keeps the content. */
  previous?: string }
/** Wave 5: the register counterparties (W5-D3); names, not figures, so a sentence naming them needs no citation. */
export interface Counterparties { holder?: string; government?: string; licence?: string; partners: string[] }
export const LICENCE_WORDS: Record<string, string> = { concession: 'concession', psc: 'production sharing contract', service: 'service contract', jv: 'joint venture', licence: 'licence', other: 'other' };
export function counterpartiesOf(register: Record<string, unknown> | null | undefined): Counterparties | null {
  if (!register) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const lic = str(register.licence_type);
  const c: Counterparties = { holder: str(register.holder), government: str(register.government), licence: lic ? (LICENCE_WORDS[lic] ?? lic) + (str(register.licence_note) ? ` (${str(register.licence_note)})` : '') : undefined,
    partners: Array.isArray(register.partners) ? register.partners.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [] };
  return c.holder || c.government || c.licence || c.partners.length ? c : null;
}
export interface Source { ref: string; title: string; why: string; snippet?: string; date?: string }
export interface DraftContext {
  scope: string; project: any; organisation?: any; contacts?: any[]; dispatches?: any[]; contracts?: any[]; counterparties?: Counterparties | null;
  runs: any[]; sources: Source[]; lessons: any[]; who_to_ask: Array<{ person: string; last: string; on: string }>; sub_queries: string[]; house_style: string; letterhead?: string;
  /** Wave 7 PR5 (W7-AC19): the country pack's stored originals for the project's country (public, under the firm project), citable like any source. */
  pack_sources?: Source[];
}
/** Wave 7 (S19): no drafting provider means no draft, said plainly; never a silent template. The route answers 503 with this. */
export class NoProviderError extends Error {
  status = 503; code = 'not_configured';
  constructor() { super('the drafting assistant is not connected on this Vault, so nothing was drafted'); }
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

/* ── wave 7 PR3 (A6, 03 §7.4 item 3): a cited figure must be the cited run's figure ─────────────────────── */

export interface RunFigures { outputs?: any; assumptions?: any }
interface Figure { value: number; unit: string }
const RUN_CITE_RE = /\[run:([^\]]+)\]/g;
const OTHER_CITE_RE = /\[(doc|lesson|ref|wm):[^\]]+\]/;
const MONTH_WORDS = '(?:january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
const NOT_FIGURES = [
  /\[[a-z]+:[^\]]+\]/gi,                                                          // citations
  /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g,                                        // ISO dates
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:de\\s+)?${MONTH_WORDS}(?:\\s+de)?\\s+\\d{4}\\b`, 'gi'),   // 8 July 2026, 8 de julio de 2026
  new RegExp(`\\b${MONTH_WORDS}\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'gi'),                 // July 8, 2026
  /\b[A-Z]{2,6}-\d{4}-\d{2,6}\b/g,                                                // reference numbers (ATC-2026-0131)
  /(?<![\d.,])(?:19|20)\d{2}(?![\d.,])/g,                                        // a bare year
];
const NUMBER_WITH_UNIT_RE = /(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(%|[A-Za-z°$€£][\w$€£/°^³².-]*))?/g;
const normUnit = (u: unknown): string => String(u ?? '').toLowerCase().replace(/[\s.]/g, '');

function figuresOf(run: RunFigures): Figure[] {
  const out: Figure[] = [];
  const take = (bag: unknown) => {
    if (!bag || typeof bag !== 'object') return;
    for (const v of Object.values(bag as Record<string, any>)) {
      if (v === null || typeof v !== 'object') { if (typeof v === 'number' && Number.isFinite(v)) out.push({ value: v, unit: '' }); continue; }
      const unit = normUnit(v.unit);
      for (const k of ['value', 'low', 'high']) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out.push({ value: v[k], unit });
    }
  };
  take(run.outputs); take(run.assumptions);
  return out;
}
/** Does v, shown at the precision n was written with, read as n? */
const readsAs = (n: number, v: number, decimals: number): boolean => Math.abs(n - v) <= 0.5 * Math.pow(10, -decimals) + 1e-9;

/**
 * Every sentence that cites a run and nothing else must quote only figures the cited runs carry in outputs or
 * assumptions, at the precision written, with the unit when one is written. A sentence that fails becomes a
 * question to the author; a sentence that also cites a document, lesson or reference is not checked here, since
 * the figure may be theirs. Dates, reference numbers, citation ids and bare years are not figures.
 */
export function checkFigures(paragraphs: string[], runs: Map<string, RunFigures>): { paragraphs: string[]; warnings: string[]; questions: string[] } {
  const warnings: string[] = [], questions: string[] = [];
  const out = paragraphs.map(p => p.split(/(?<=[.!?])\s+(?![^\[]*\])/).map(s => {
    if (/^\s*\[QUESTION FOR YOU/.test(s) || OTHER_CITE_RE.test(s)) return s;
    const cited = [...s.matchAll(RUN_CITE_RE)].map(m => m[1]).filter(id => runs.has(id));
    if (!cited.length) return s;
    const figures = cited.flatMap(id => figuresOf(runs.get(id)!));
    const units = new Set(figures.map(f => f.unit).filter(Boolean));
    let text = s;
    for (const re of NOT_FIGURES) text = text.replace(re, ' ');
    const bad: string[] = [];
    for (const m of text.matchAll(NUMBER_WITH_UNIT_RE)) {
      const shown = `${m[1]}${m[2] ?? ''}`;
      const n = Number(shown.replace(/,/g, ''));
      const decimals = m[2] ? m[2].length - 1 : 0;
      const unit = m[3] ? normUnit(m[3]) : '';
      const ok = figures.some(f => {
        if (unit === '%') return (f.unit === '%' && readsAs(n, f.value, decimals)) || ((f.unit === '' || f.unit === 'fraction' || f.unit === 'frac') && readsAs(n, f.value * 100, decimals));
        if (!readsAs(n, f.value, decimals)) return false;
        if (!unit || !f.unit) return true;                       // no unit written, or the run's figure carries none
        if (f.unit === unit) return true;
        return !units.has(unit);                                  // a word after the number that is no unit of this run (wells, years, items)
      });
      if (!ok) bad.push(m[3] ? `${shown} ${m[3]}` : shown);
    }
    if (!bad.length) return s;
    questions.push(s.trim());
    return `[QUESTION FOR YOU: this sentence quotes ${bad.join(', ')}, which is not an output or assumption of the cited run: "${s.trim()}"]`;
  }).join(' '));
  if (questions.length) warnings.push(`${questions.length} sentence(s) quoted a figure that is not in the cited run and were turned into questions for you`);
  return { paragraphs: out, warnings, questions };
}

/** The item types that count as a delivered or received document (the same rule as the nightly age flag G1). */
const FOREGROUND_TYPES = ['letter', 'report', 'spreadsheet', 'data-room-file'];

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

  ctx.counterparties = counterpartiesOf(project.register);
  // The organisation: the one named, else the register's current owner when an organisation carries that name, else the client.
  let orgId: string | null = req.organisation_id ?? null;
  if (!orgId && ctx.counterparties?.holder) orgId = (await db.query<any>('SELECT id FROM organisations WHERE lower(name) LIKE lower($1) || \'%\' ORDER BY length(name) LIMIT 1', [ctx.counterparties.holder])).rows[0]?.id ?? null;
  if (!orgId) orgId = project.client_id ?? null;
  if (orgId) {
    ctx.organisation = (await db.query<any>('SELECT * FROM organisations WHERE id = $1', [orgId])).rows[0];
    ctx.contacts = (await db.query<any>('SELECT * FROM contacts WHERE organisation_id = $1 ORDER BY name', [orgId])).rows;
    ctx.dispatches = (await db.query<any>(`SELECT d.id, d.direction, d.channel, d.occurred_at, d.reference_no, d.their_reference, d.acknowledged_at, i.title, i.id AS item_id, i.type
                                            FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.organisation_id = $1 AND NOT i.hidden ORDER BY d.occurred_at ASC`, [orgId])).rows;
    ctx.contracts = (await db.query<any>(`SELECT id, type, title, authored_at, reference_no, extracted, legal_tag FROM items WHERE NOT hidden AND type IN ('nda','contract','licence') AND $1 = ANY(organisation_ids) ORDER BY authored_at DESC`, [orgId])).rows;
  }
  // Runs in scope: the project's non-superseded runs, newest first; a named run first. Wave 7 PR3 (A6): each carries its
  // assets, its date and its outputs with units, and the newest foreground document it is older than, if any.
  ctx.runs = (await db.query<any>(`SELECT id, job, tool_version, title, status, created_at, asset_ids, record->'outputs' AS outputs, record->'assumptions' AS assumptions, stale, legal_tag, project_id FROM runs
                                    WHERE project_id = $1 AND NOT hidden AND status <> 'superseded' ORDER BY (id = $2::uuid) DESC NULLS LAST, created_at DESC LIMIT 12`, [req.project_id, req.run_id ?? null])).rows;
  const newest = (await db.query<any>(
    `SELECT i.id, i.title, coalesce(i.authored_at, i.created_at) AS at FROM items i
      WHERE i.project_id = $1 AND NOT i.hidden AND coalesce(i.extracted->>'kind', '') NOT IN ('draft', 'research', 'dossier') AND coalesce(i.extracted->>'history', 'false') <> 'true' AND coalesce(i.extracted->>'category', '') <> 'bulk'
        AND (i.type = ANY($2::text[]) OR (i.type = 'email' AND EXISTS (SELECT 1 FROM items c WHERE c.parent_id = i.id)))
      ORDER BY coalesce(i.authored_at, i.created_at) DESC, i.id LIMIT 1`, [req.project_id, FOREGROUND_TYPES])).rows[0];
  for (const r of ctx.runs) {
    r.created_at = new Date(r.created_at).toISOString();
    r.asset_ids = r.asset_ids ?? [];
    r.newer_document = newest && new Date(newest.at) > new Date(r.created_at) ? { id: newest.id, title: newest.title, date: ymd(newest.at) } : null;
  }
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
  // Wave 5 (F17): research findings are notes the runs filed, not chunked; the ones whose title or quote share words
  // with the brief join the sources, newest first, so a letter can cite what the Vault found by itself.
  const words = new Set(`${req.brief} ${ctx.sub_queries.join(' ')}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4));
  const findings = (await db.query<any>(`SELECT id, title, extracted, authored_at, created_at FROM items WHERE project_id = $1 AND NOT hidden AND extracted->>'kind' = 'research' ORDER BY coalesce(authored_at, created_at) DESC LIMIT 200`, [req.project_id])).rows;
  const scored = findings.map((f: any) => { const text = `${f.title} ${f.extracted?.quote ?? ''}`.toLowerCase(); let n = 0; for (const w of words) if (text.includes(w)) n++; return { f, n }; }).filter(x => x.n >= 2).sort((a, b) => b.n - a.n);
  for (const { f } of scored.slice(0, 5)) if (!seen.has(`doc:${f.id}`)) seen.set(`doc:${f.id}`, { ref: `doc:${f.id}`, title: f.title, why: 'research finding', snippet: f.extracted?.quote ?? undefined, date: ymd(f.authored_at ?? f.created_at) });
  ctx.sources = [...seen.values()].slice(0, 12);
  // Wave 7 PR5 (W7-AC19): the pack's originals are sources the drafter may cite when the project's country has a pack.
  // They are public by construction (lt-public under the firm project, checked again here), so every scope admits them.
  ctx.pack_sources = await packSources(db, project.country, req.brief);
  // Colleagues who last worked the topic: authors of the runs and sources.
  const authors = (await db.query<any>(`SELECT author AS person, max(created_at) AS last, max(job) AS on FROM runs WHERE project_id = $1 AND NOT hidden GROUP BY author ORDER BY last DESC LIMIT 3`, [req.project_id])).rows;
  ctx.who_to_ask = authors.filter(a => a.person !== person.id).map(a => ({ person: a.person, last: new Date(a.last).toISOString().slice(0, 10), on: a.on }));
  if (req.kind === 'letter') ctx.letterhead = (await db.query<any>("SELECT id FROM firm_assets WHERE kind = 'letterhead' AND is_current AND language = $1 LIMIT 1", [req.language ?? 'en'])).rows[0]?.id;
  return ctx;
}

/**
 * The stored originals the country's pack was built from (the head version of each section), as sources: title,
 * section, fetch date and the passage that best matches the brief. Only public, visible items under the firm project.
 */
export async function packSources(db: Db, country: string | null | undefined, brief: string, limit = 8): Promise<Source[]> {
  const cc = typeof country === 'string' ? country.trim().toUpperCase() : '';
  if (!cc) return [];
  const heads = (await db.query<any>('SELECT section, source_items, built_at FROM country_packs WHERE country = $1 AND superseded_by IS NULL ORDER BY section, version DESC', [cc])).rows;
  const seenSection = new Set<string>(), sectionOf = new Map<string, string>();
  for (const h of heads) {
    if (seenSection.has(h.section)) continue;
    seenSection.add(h.section);
    for (const id of h.source_items ?? []) if (!sectionOf.has(id)) sectionOf.set(id, h.section);
  }
  const ids = [...sectionOf.keys()];
  if (!ids.length) return [];
  const items = (await db.query<any>(`SELECT i.id::text AS id, i.title, i.extracted, coalesce(i.authored_at, i.created_at) AS at, i.origin->>'fetched_at' AS fetched_at FROM items i JOIN legal_tags lt ON lt.id = i.legal_tag
      WHERE i.id = ANY($1::uuid[]) AND NOT i.hidden AND lt.classification = 'public' AND i.project_id = 'firm'`, [ids])).rows;
  const chunks = (await db.query<any>('SELECT item_id::text AS item_id, text FROM chunks WHERE item_id = ANY($1::uuid[]) AND current ORDER BY item_id, ordinal', [ids])).rows;
  const textOf = new Map<string, string[]>();
  for (const c of chunks) (textOf.get(c.item_id) ?? textOf.set(c.item_id, []).get(c.item_id)!).push(c.text);
  const words = brief.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4);
  const titles: Record<string, string> = { legal: 'Legal framework', licensing: 'Licensing and the current round', fiscal: 'Fiscal terms', companies: 'Who works there', service: 'The service industry', regulator: 'Regulator and data room', production: 'Production, reserves and market', risk: 'Risk and context', literature: 'Technical literature', questions: 'What no source answered' };
  const out: Array<Source & { score: number }> = [];
  for (const it of items) {
    const parts = textOf.get(it.id) ?? [String(it.extracted?.text ?? '')];
    // The passage with the most brief words, else the opening.
    let best = parts[0] ?? '', bestN = -1;
    for (const p of parts) { const l = p.toLowerCase(); let n = 0; for (const w of words) if (l.includes(w)) n++; if (n > bestN) { bestN = n; best = p; } }
    const section = sectionOf.get(it.id) ?? '';
    out.push({ ref: `doc:${it.id}`, title: it.title, why: `country pack: ${titles[section] ?? section}`, snippet: best.replace(/\s+/g, ' ').trim().slice(0, 400), date: ymd(it.fetched_at ?? it.at), score: bestN });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit).map(({ score: _s, ...s }) => s);
}

export function allowedRefs(ctx: DraftContext): Set<string> {
  const s = new Set<string>();
  for (const r of ctx.runs) s.add(`run:${r.id}`);
  for (const x of ctx.sources) s.add(x.ref);
  for (const x of ctx.pack_sources ?? []) s.add(x.ref);
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
  if (req.tone) lines.push(`REWRITE THE PREVIOUS DRAFT: ${req.tone}. Keep every citation of the previous draft on the sentence it supports; add nothing new.`);
  if (req.previous) lines.push(`PREVIOUS DRAFT:\n${req.previous}`);
  if (ctx.counterparties) {
    const c = ctx.counterparties;
    lines.push(`COUNTERPARTIES: ${[c.holder ? `current owner ${c.holder}` : null, c.government ? `government ${c.government}` : null, c.licence ? `licence ${c.licence}` : null, c.partners.length ? `partners ${c.partners.join(', ')}` : null].filter(Boolean).join('; ')} (names from the register; cite nothing for a name alone)`);
  }
  lines.push(`PROJECT: ${ctx.project.name} (${ctx.project.id}); client ${ctx.project.client_id ?? 'none'}; scope ${ctx.scope}`);
  if (ctx.organisation) {
    lines.push(`COUNTERPARTY: ${ctx.organisation.name} (${ctx.organisation.kind}); contacts: ${(ctx.contacts ?? []).map(c => `${c.name}${c.role ? ', ' + c.role : ''}`).join('; ') || 'none'}`);
    lines.push(`PREVIOUS CORRESPONDENCE (oldest first): ${(ctx.dispatches ?? []).map(d => `${ymd(d.occurred_at)} ${d.direction} ${d.channel} ${d.reference_no ?? d.their_reference ?? ''} "${d.title}" [doc:${d.item_id}]`).join(' | ') || 'none'}`);
    lines.push(`CONTRACTS IN FORCE: ${(ctx.contracts ?? []).map(c => `${c.type} "${c.title}" ${c.extracted?.effective_date ?? ''}→${c.extracted?.expiry ?? ''} [doc:${c.id}]`).join(' | ') || 'none'}`);
  }
  lines.push(`RUNS: ${ctx.runs.map(r => `${r.title ?? r.job} (${r.job}@${r.tool_version}, ${r.status}${r.stale ? ', STALE' : ''}) outputs ${JSON.stringify(r.outputs)} [run:${r.id}]`).join(' | ') || 'none'}`);
  lines.push(`SOURCES: ${ctx.sources.map(s => `"${s.title}" — ${s.snippet ?? ''} [${s.ref}]`).join(' | ') || 'none'}`);
  if (ctx.pack_sources?.length) lines.push(`COUNTRY PACK ORIGINALS (public, ${String(ctx.project.country ?? '').trim()}): ${ctx.pack_sources.map(s => `"${s.title}" (${s.why}${s.date ? `, fetched ${s.date}` : ''}) — ${s.snippet ?? ''} [${s.ref}]`).join(' | ')}`);
  lines.push(`LESSONS: ${ctx.lessons.map(l => `${l.claim} [lesson:${l.id}]`).join(' | ') || 'none'}`);
  if (ctx.who_to_ask.length) lines.push(`COLLEAGUES WHO WORKED THIS: ${ctx.who_to_ask.map(w => `${w.person} (${w.on}, ${w.last})`).join('; ')}`);
  return lines.join('\n');
}

export async function draft(db: Db, person: Person, req: DraftRequest, provider: LlmProvider | null, search: SearchDeps, now = new Date()): Promise<DraftResult> {
  const ctx = await assembleContext(db, person, req, search, now);
  const language = req.language ?? 'en';
  const allowed = allowedRefs(ctx);
  if (!provider) throw new NoProviderError();
  const r = await provider.complete({ system: systemPrompt(req.kind, language, ctx.house_style), messages: [{ role: 'user', content: userPrompt(req, ctx) }], maxTokens: 1500 });
  const text = r.text, usage = r.usage, model = r.model;
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const checked = checkCitations(paragraphs, allowed);
  const warnings = [...checked.warnings];
  if (checked.questions.length) warnings.push(`${checked.questions.length} sentence(s) had no citation and were turned into questions for you`);
  // Wave 7 PR3 (A6): a cited figure must be the run's figure, and a weak run is named.
  const figures = checkFigures(checked.paragraphs, new Map(ctx.runs.map(r => [r.id, { outputs: r.outputs, assumptions: r.assumptions }])));
  warnings.push(...figures.warnings);
  for (const c of checked.citations) {
    if (!c.startsWith('run:')) continue;
    const r = ctx.runs.find(x => x.id === c.slice(4));
    if (!r) continue;
    if (r.status === 'draft') warnings.push(`cites draft run ${r.id}`);
    if (r.newer_document) warnings.push(`cites run older than document ${r.newer_document.id}`);
  }
  if (!ctx.sources.length && !ctx.runs.length) warnings.push('no runs or documents were found in scope; the draft is skeletal');
  const questions = [...checked.questions, ...figures.questions];
  // The pack's originals are offered with the sources, so a cited Act gets its chip like any other record.
  return { draft: figures.paragraphs.join('\n\n'), paragraphs: figures.paragraphs, citations: checked.citations, sources: [...ctx.sources, ...(ctx.pack_sources ?? [])], who_to_ask: ctx.who_to_ask, warnings, questions, usage, model, context: ctx };
}
