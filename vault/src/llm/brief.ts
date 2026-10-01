/**
 * The country brief (wave 2, docs/vault-hub/wave2/05-markup.md §1.6).
 * Gathers what the Vault holds for one country within the caller's scope
 * (projects and stages, non-superseded runs with their headline outputs,
 * the newest documents, confirmed lessons, correspondence), asks the model
 * for a cited brief, and runs the drafting assistant's citation check so no
 * uncited figure survives. Pure of HTTP: the route in api/countries.routes.ts
 * owns scope, caching and audit.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { Access, ProjectRow } from '../api/common.ts';
import { canSee, iso } from '../api/common.ts';
import type { LlmProvider } from './provider.ts';
import { checkCitations, ymd } from './draft.ts';

export interface BriefSource { ref: string; title: string; kind: 'run' | 'doc' | 'lesson'; project_id: string | null; date: string | null; legal_tag: string; detail?: string }
export interface BriefContext {
  country: string; projects: ProjectRow[]; sources: BriefSource[]; dispatches: any[];
  tags: string[]; source_hash: string; scope_hash: string;
}
export interface BriefResult { paragraphs: string[]; citations: string[]; warnings: string[]; questions: string[]; usage?: { input: number; cached: number; output: number }; model?: string }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Everything in scope for the country, with the two hashes that decide whether a cached brief still applies. */
export async function assembleCountryContext(db: Db, acc: Access, country: string, projects: ProjectRow[]): Promise<BriefContext> {
  const ids = projects.map(p => p.id);
  const sources: BriefSource[] = [];
  const tags = new Set<string>(projects.map(p => p.default_legal_tag));
  const key: string[] = projects.map(p => `${p.id}|${p.stage}|${p.status}|${JSON.stringify(p.register ?? {})}`);

  const runs = (await db.query<any>(`SELECT id, job, tool_version, title, status, created_at, record->'outputs' AS outputs, stale, legal_tag, project_id FROM runs
      WHERE project_id = ANY($1::text[]) AND NOT hidden AND status <> 'superseded' ORDER BY created_at DESC`, [ids])).rows;
  const perProject = new Map<string, number>();
  for (const r of runs) {
    if (!canSee(acc, r.legal_tag, r.project_id)) continue;
    const n = perProject.get(r.project_id) ?? 0;
    if (n >= 8) continue;
    perProject.set(r.project_id, n + 1);
    const headline = Object.entries(r.outputs ?? {}).filter(([k, v]: any) => k !== 'method' && v && typeof v.value === 'number').slice(0, 4)
      .map(([k, v]: any) => `${k} ${v.value}${v.unit ? ' ' + v.unit : ''}`).join(', ');
    sources.push({ ref: `run:${r.id}`, title: r.title ?? r.job, kind: 'run', project_id: r.project_id, date: ymd(r.created_at), legal_tag: r.legal_tag,
      detail: `${r.job}@${r.tool_version}, ${r.status}${r.stale ? ', STALE' : ''}${headline ? '; ' + headline : ''}` });
    tags.add(r.legal_tag); key.push(`run:${r.id}|${r.status}|${r.stale}`);
  }
  const items = (await db.query<any>(`SELECT id, type, title, version, created_at, authored_at, legal_tag, project_id, stale, extracted, reference_no FROM items
      WHERE project_id = ANY($1::text[]) AND NOT hidden ORDER BY coalesce(authored_at, created_at) DESC`, [ids])).rows;
  const perProjectDocs = new Map<string, number>();
  for (const i of items) {
    if (!canSee(acc, i.legal_tag, i.project_id, i)) continue;
    const n = perProjectDocs.get(i.project_id) ?? 0;
    if (n >= 10) continue;
    perProjectDocs.set(i.project_id, n + 1);
    sources.push({ ref: `doc:${i.id}`, title: i.title, kind: 'doc', project_id: i.project_id, date: ymd(i.authored_at ?? i.created_at), legal_tag: i.legal_tag,
      detail: `${i.type}${i.reference_no ? ' ' + i.reference_no : ''}${i.version > 1 ? ' v' + i.version : ''}${i.stale ? ', STALE' : ''}` });
    tags.add(i.legal_tag); key.push(`doc:${i.id}|${i.version}|${i.stale}`);
  }
  const lessons = (await db.query<any>(`SELECT id, record, scope, scope_id, legal_tag, last_confirmed FROM lessons
      WHERE status = 'confirmed' AND (scope = 'firm' OR (scope = 'project' AND scope_id = ANY($1::text[])) OR (scope = 'client' AND scope_id = ANY($2::text[])))
      ORDER BY last_confirmed DESC NULLS LAST LIMIT 12`, [ids, projects.map(p => p.client_id).filter(Boolean)])).rows;
  for (const l of lessons) {
    const pid = l.scope === 'project' ? l.scope_id : null;
    if (!canSee(acc, l.legal_tag, pid)) continue;
    sources.push({ ref: `lesson:${l.id}`, title: l.record?.claim ?? l.record?.statement ?? 'lesson', kind: 'lesson', project_id: pid, date: ymd(l.last_confirmed ?? ''), legal_tag: l.legal_tag });
    tags.add(l.legal_tag); key.push(`lesson:${l.id}`);
  }
  const orgIds = [...new Set(projects.map(p => p.client_id).filter(Boolean))] as string[];
  const dispatches = orgIds.length ? (await db.query<any>(`SELECT d.direction, d.channel, d.occurred_at, d.reference_no, i.title, i.id AS item_id, i.legal_tag, i.project_id
      FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.organisation_id = ANY($1::text[]) AND NOT i.hidden ORDER BY d.occurred_at DESC LIMIT 20`, [orgIds])).rows
      .filter(d => canSee(acc, d.legal_tag, d.project_id)) : [];
  for (const d of dispatches) { tags.add(d.legal_tag); key.push(`dispatch:${d.item_id}|${iso(d.occurred_at)}`); }

  const tagList = [...tags].sort();
  return { country, projects, sources, dispatches, tags: tagList, source_hash: sha(key.sort().join('\n')), scope_hash: sha(tagList.join('\n')) };
}

export function briefSystemPrompt(language: 'en' | 'es'): string {
  const lang = language === 'es' ? 'Spanish (Latin American, formal usted)' : 'British English';
  return `You write the country brief for the partners of Alpha Technical Centre, an oil and gas technical consultancy. Language: ${lang}.
Write five short paragraphs, each opening with its heading word followed by a full stop: Situation (what the firm holds in this country and at what stage), Record (the runs and documents that matter and when they were made), Numbers (the headline figures, with their units), Contradictions (where a run, a letter or a lesson disagrees with another, or a figure quoted in a document no longer matches the latest run; say "none found" if none), Open questions (what a partner should ask or do next).
Rules that are checked mechanically after you answer:
1. Every sentence that states a figure, a date or a fact from the record must end with a citation in square brackets taken ONLY from the CONTEXT: [run:<id>], [doc:<id>], [lesson:<id>]. Never invent an id. A sentence you cannot cite must be written as a question in the form [QUESTION FOR YOU: ...].
2. Use only the context. Do not add knowledge from outside it, and do not speculate about the country.
3. Name projects by their names. Be concrete and brief; a partner reads this on a Monday morning.
Return plain text paragraphs separated by blank lines. No preamble, no explanation.`;
}

export function briefUserPrompt(ctx: BriefContext, name: string): string {
  const lines: string[] = [];
  lines.push(`COUNTRY: ${name} (${ctx.country})`);
  lines.push(`PROJECTS: ${ctx.projects.map(p => `${p.name} (${p.id}; ${p.status}; stage ${p.stage}; client ${p.client_id ?? 'none'}${p.register && Object.keys(p.register).length ? '; register ' + JSON.stringify(p.register) : ''})`).join(' | ') || 'none'}`);
  const runs = ctx.sources.filter(s => s.kind === 'run'), docs = ctx.sources.filter(s => s.kind === 'doc'), lessons = ctx.sources.filter(s => s.kind === 'lesson');
  lines.push(`RUNS (newest first): ${runs.map(s => `${s.date} "${s.title}" in ${s.project_id} (${s.detail}) [${s.ref}]`).join(' | ') || 'none'}`);
  lines.push(`DOCUMENTS (newest first): ${docs.map(s => `${s.date} "${s.title}" in ${s.project_id} (${s.detail}) [${s.ref}]`).join(' | ') || 'none'}`);
  lines.push(`LESSONS: ${lessons.map(s => `${s.title} [${s.ref}]`).join(' | ') || 'none'}`);
  lines.push(`CORRESPONDENCE (newest first): ${ctx.dispatches.map(d => `${ymd(d.occurred_at)} ${d.direction} ${d.channel} ${d.reference_no ?? ''} "${d.title}" [doc:${d.item_id}]`).join(' | ') || 'none'}`);
  return lines.join('\n');
}

/** Ask the model and check every citation against the sources in scope. */
export async function writeBrief(ctx: BriefContext, name: string, language: 'en' | 'es', provider: LlmProvider): Promise<BriefResult> {
  const allowed = new Set<string>([...ctx.sources.map(s => s.ref), ...ctx.dispatches.map(d => `doc:${d.item_id}`)]);
  const r = await provider.complete({ system: briefSystemPrompt(language), messages: [{ role: 'user', content: briefUserPrompt(ctx, name) }], maxTokens: 1800 });
  const paragraphs = r.text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const checked = checkCitations(paragraphs, allowed);
  const warnings = [...checked.warnings];
  if (checked.questions.length) warnings.push(`${checked.questions.length} sentence(s) had no citation and were turned into questions for you`);
  if (!ctx.sources.length) warnings.push('no runs or documents were found in scope; the brief is skeletal');
  return { paragraphs: checked.paragraphs, citations: checked.citations, warnings, questions: checked.questions, usage: r.usage, model: r.model };
}
