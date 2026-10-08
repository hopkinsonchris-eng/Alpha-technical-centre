/**
 * Ask this project (wave 8 PR 4, docs/vault-hub/wave8/03-indexing-and-ask.md, W8-AC17).
 * A question answered from the project's indexed passages only: retrieval through the gateway in the project's
 * scope (the caller's own scope, so a member never sees a partners-only passage), the model asked for cited
 * paragraphs, the drafting assistant's checker on the reply (an uncited figure becomes a question), and the files
 * the answer drew on listed with how often each is cited. Pure of HTTP: the route owns scope, audit and errors.
 */
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import type { LlmProvider, LlmUsage } from './provider.ts';
import { hybridSearch, loadProjects, resolveScope, type SearchDeps, type SearchHit } from '../gateway/index.ts';
import { RRF_K } from '../gateway/search.ts';
import { checkCitations, ymd } from './draft.ts';

export interface AskPassage { ref: string; item_id: string; title: string; type: string; date: string | null; ordinal: number; text: string }
export interface AskSource { ref: string; id: string; name: string; type: string; date: string | null; cited: number }
export interface AskResult {
  answer: string[]; questions: string[]; citations: string[]; sources: AskSource[]; passages: number; warnings: string[];
  usage?: LlmUsage; model?: string;
}

const STOP = new Set(('a an the and or of in on at to for from by with without about as is are was were be been being have has had do does did how what which who whom whose when where why ' +
  'this that these those there here it its they them their we our you your i me my he she his her any all some much many more most such than then so if not no yes can could should would will shall may might must ' +
  'over under into onto out up down off very just also ever never been being historically history been successful success successfully ' +
  'el la los las un una unos unas y o de del en con sin sobre como es son fue fueron ser estar hay que qué cuál cuáles quién cuándo dónde por para al lo le les se su sus este esta estos estas ese esa esos esas ha han había muy más menos').split(/\s+/));

/** The content words of a question, each a query of its own, so a passage that carries any of them is a candidate. */
export function keywords(question: string): string[] {
  const words = String(question || '').toLowerCase().replace(/[¿?¡!.,;:()"'“”]/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 4 || STOP.has(w)) continue;                 // a year or a well number is a search term too
    if (!out.includes(w)) out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

/** The passages the question reaches, fused across the whole question and each of its content words, best first. */
export async function gatherPassages(db: Db, person: Person, projectId: string, question: string, deps: SearchDeps, opts: { now?: Date; k?: number } = {}): Promise<AskPassage[]> {
  const k = opts.k ?? 24, now = opts.now ?? new Date();
  const projects = await loadProjects(db);
  const scope = resolveScope(`project:${projectId}`, person, projects);
  const queries = [question.trim(), ...keywords(question).filter(w => w !== question.trim().toLowerCase())];
  const fused = new Map<string, { hit: SearchHit; score: number }>();
  for (const q of queries) {
    const hits = await hybridSearch(db, q, scope, person, projects, deps, { k, now });
    hits.forEach((h, i) => {
      if (!h.item_id) return;                                   // runs are read through their records elsewhere; the answer cites documents
      const key = `${h.item_id}#${h.ordinal}`;
      const f = fused.get(key) ?? { hit: h, score: 0 };
      f.score += (q === queries[0] ? 2 : 1) / (RRF_K + i + 1);   // the whole question counts double
      fused.set(key, f);
    });
  }
  const top = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
  if (!top.length) return [];
  const ids = [...new Set(top.map(t => t.hit.item_id as string))];
  const rows = (await db.query<any>(
    `SELECT c.item_id::text AS item_id, c.ordinal, c.text, i.title, i.type, coalesce(i.authored_at, i.created_at) AS at
       FROM chunks c JOIN items i ON i.id = c.item_id
      WHERE c.current AND NOT i.hidden AND c.item_id = ANY($1::uuid[]) AND c.item_version = i.version`, [ids])).rows;
  const byKey = new Map(rows.map((r: any) => [`${r.item_id}#${r.ordinal}`, r]));
  const out: AskPassage[] = [];
  for (const t of top) {
    const r = byKey.get(`${t.hit.item_id}#${t.hit.ordinal}`);
    if (!r) continue;
    out.push({ ref: `doc:${r.item_id}`, item_id: r.item_id, title: r.title ?? '', type: r.type ?? '', date: r.at ? new Date(r.at).toISOString() : null, ordinal: Number(r.ordinal), text: String(r.text) });
  }
  return out;
}

export function askSystemPrompt(language: 'en' | 'es'): string {
  const lang = language === 'es' ? 'Spanish (Latin American, formal usted)' : 'British English';
  return `You answer a question for the engineers of Alpha Technical Centre, an oil and gas technical consultancy, from passages of the project's own files. Language: ${lang}.
Write the answer as two to five short paragraphs. Lead with the answer; then the evidence; then what the passages leave open.
Rules that are checked mechanically after you answer:
1. Every sentence that states a figure, a date, a name or a fact from the files must end with a citation in square brackets taken ONLY from the PASSAGES: [doc:<id>]. One citation per sentence is enough; cite the passage the fact came from.
2. Use only the passages. Do not add knowledge from outside them. If the passages do not answer the question, say so in one sentence without a citation, and say what kind of file would.
3. Quote figures with their units as the passage gives them. Do not average or extrapolate beyond what a passage states.
Return plain text paragraphs separated by blank lines. No heading, no preamble, no list of sources (the Vault lists them).`;
}

export function askUserPrompt(projectName: string, question: string, passages: AskPassage[]): string {
  const lines = [`PROJECT: ${projectName}`, `QUESTION: ${question.trim()}`, `PASSAGES (${passages.length}, best match first):`];
  passages.forEach((p, i) => lines.push(`${i + 1}. [${p.ref}] "${p.title}" (${p.type}${p.date ? ', ' + ymd(p.date) : ''}): ${p.text.replace(/\s+/g, ' ').trim().slice(0, 1800)}`));
  return lines.join('\n');
}

export interface AskArgs { db: Db; person: Person; project: { id: string; name: string }; question: string; language: 'en' | 'es'; provider: LlmProvider; search: SearchDeps; now?: Date; k?: number }

export async function askProject(a: AskArgs): Promise<AskResult> {
  const passages = await gatherPassages(a.db, a.person, a.project.id, a.question, a.search, { now: a.now, k: a.k });
  if (!passages.length) {
    return { answer: [], questions: [], citations: [], sources: [], passages: 0, warnings: ['no indexed passage in this project matches the question; the files may still be waiting for the indexer'] };
  }
  const allowed = new Set(passages.map(p => p.ref));
  const r = await a.provider.complete({
    system: askSystemPrompt(a.language), messages: [{ role: 'user', content: askUserPrompt(a.project.name, a.question, passages) }], maxTokens: 2500,
    purpose: 'ask', by: a.person.id, scope: `project:${a.project.id}`, refs: [...allowed],
  });
  const paragraphs = r.text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const checked = checkCitations(paragraphs, allowed);
  // The checker leaves an uncited figure in place as a bracketed question; here the questions are a section of their
  // own, so the answer keeps only what stood, and a paragraph that was all question goes.
  const answer = checked.paragraphs.map(p => p.replace(/\[QUESTION FOR YOU:[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const p of answer) for (const m of p.matchAll(/\[(doc:[0-9a-f-]{36})\]/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const first = new Map<string, AskPassage>();
  for (const p of passages) if (!first.has(p.ref)) first.set(p.ref, p);
  const sources: AskSource[] = [...counts.entries()].filter(([ref]) => first.has(ref))
    .map(([ref, cited]) => { const p = first.get(ref)!; return { ref, id: p.item_id, name: p.title || p.item_id, type: p.type, date: p.date, cited }; })
    .sort((x, y) => y.cited - x.cited || x.name.localeCompare(y.name));
  const warnings = [...checked.warnings];
  if (checked.questions.length) warnings.push(`${checked.questions.length} sentence(s) had no citation and were turned into questions for you`);
  return { answer, questions: checked.questions, citations: checked.citations, sources, passages: passages.length, warnings, usage: r.usage, model: r.model };
}
