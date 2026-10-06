/**
 * The country pack's sections (wave 7 PR5; docs/vault-hub/wave7/05-markup.md §1.8, W7-AC18 to W7-AC20; 04-step-changes.md
 * P1 "How a pack is built" steps 3 to 5; choice D67). Each section is drafted from the extracted text of its stored
 * originals only, in short sentences each ending `[doc:<item id>]`, English and Spanish in one call; `checkCitations`
 * from draft.ts runs unchanged on the result, and the pack's own stricter rule follows it: a sentence that does not
 * cite one of this section's originals becomes a question, never a fact. The model never receives a URL to fetch,
 * never a client record, and never supplies a fact from memory: a section whose sources were all unreachable or empty
 * is written honestly without a model call.
 *
 *   draftSection(provider, section, originals, opts)   one section → PackSectionBody, status, spend
 *   draftSections(ctx)                                  the hook the country-pack job calls: one country_packs row per
 *                                                       section (a new version when one exists; the previous row gets
 *                                                       superseded_by; nothing is deleted), spend audited per section
 *   loadPack / packMarkdown / packHeadlines             the read side the connector uses
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { Storage } from '../storage.ts';
import type { LlmProvider, LlmUsage } from './provider.ts';
import { checkCitations } from './draft.ts';
import { costOf, DEFAULT_MODEL } from '../prices.ts';
import { countryName } from '../opportunities.ts';
import { SECTIONS, SECTION_IDS, TERMS, type PackQuality, type PackSectionBody, type PackSentence, type PackStatus, type SectionId, type TermId, type TermValue, type TermsCard } from '../country/types.ts';
import { checkTerms, packQuality, parseTermsReply, termsFormat, termsMarkdown } from '../country/terms.ts';
import { SECTION_SPECS, caveatFor, literatureOriginals, vendorContacts } from '../country/sections.ts';
import { countryRisk, worldMonitorConfigured, NOT_CONNECTED } from '../intel/worldmonitor.ts';
import { confirmedRoundSentences } from '../rounds/store.ts';

/* ── contracts shared with the job (builder J wires `opts.draft = draftSections`) ─────────────────────────── */

/** A registry source as the job resolved it for this build: the stored original's item id and sha when it was reached. */
export interface PackSourceRef { id: string; url: string; licence: string; attribution: string; fetched_at: string | null; item_id: string | null; sha256: string | null; reachable: boolean; /** reached, but the Vault's store refused to file it */ fault?: 'storage'; note?: string }
export interface DraftCtx {
  db: Db; storage?: Storage; provider: LlmProvider | null; country: string; jobId: number; by: string; now: Date; budgetGbp: number;
  sections: { section: SectionId; sources: PackSourceRef[]; /** the registry's override for this country, else SECTIONS' */ ttl_days?: number }[];
  /** Set by the weekly refresh so the spend rows say so. */
  refresh?: boolean;
}
export interface DraftSummary {
  country: string; sections: { section: SectionId; id: string; version: number; status: PackStatus; stale_reason: string | null; called: boolean; spend_gbp: number; changed: number; /** the previous version stood: same originals, still fresh */ kept?: boolean }[];
  spend_gbp: number; calls: number; stopped_by: 'budget' | null;
  /** The terms card this build wrote or kept. */
  terms?: { id: string; version: number; called: boolean; kept: boolean; spend_gbp: number; missing: TermId[] };
}

/** A stored original as the drafter reads it: the item id it will cite and the extracted text, nothing else. */
export interface Original { id: string; title: string; source_id: string | null; fetched_at: string | null; text: string; version: number }
export interface DraftSectionResult { status: PackStatus; body: PackSectionBody; citations: string[]; usage?: LlmUsage; model?: string; spend_gbp: number; warnings: string[]; called: boolean; /** set when the sources were reached but the store could not file them */ fault?: 'storage' }

const USD_PER_GBP = 1.28;
/** Every original of the country travels in the cached system block; the longest are cut, the block is capped. */
const MAX_CHARS_PER_ORIGINAL = 40_000;
const MAX_CHARS_ALL = 240_000;
const DAY = 86_400_000;
export const PACK_AUDIT_ACTION = 'llm.country-pack';

/** Pounds for one call from the list prices; an unlisted model is priced as the default so spend is never silently zero. */
export function costGbp(model: string | null | undefined, usage: LlmUsage): number {
  const usd = costOf(model, usage) ?? costOf(DEFAULT_MODEL, usage) ?? 0;
  return Math.round((usd / USD_PER_GBP) * 10000) / 10000;
}
const round4 = (n: number) => Math.round(n * 10000) / 10000;
export const ymd = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
export function dueAt(builtAt: unknown, ttlDays: number): string { return ymd(new Date(new Date(builtAt as any).getTime() + ttlDays * DAY)); }

/* ── prompts ─────────────────────────────────────────────────────────── */

/**
 * The rules and every original of the country, identical for all eleven calls of a build so the provider caches the
 * block once (the section's question travels in the user message). No URL is ever written here.
 */
export function packSystemPrompt(country: string, originals: Original[]): string {
  const name = countryName(country);
  const lines: string[] = [`You draft the country opening pack of Alpha Technical Centre, an oil and gas technical consultancy, for ${name.en} (${country}): the facts a petroleum engineer needs before working there.
Rules that are checked mechanically after you answer:
1. Write only from the ORIGINALS below. Each is a stored copy of a public source, identified by [doc:<id>]. Use any original that answers the question, whichever section it was fetched for. Never fetch anything, never follow or mention a link, never add knowledge from memory, never guess: no fetching, no outside facts.
2. Write short sentences, one fact each, with the figure, the rate, the name or the date in the sentence, and end EVERY sentence with the citation of the original it comes from, in the form [doc:<id>], taken only from the ORIGINALS. Never invent an id. A sentence you cannot cite must be given as a QUESTION line instead.
3. English and Spanish in this one answer: every sentence is a pair of lines, the English first then its Spanish (Latin American, formal usted), each ending with the same citation.
4. Name the instrument, the contract or the dataset a figure comes from, and the date the original carries when it has one. Say "not published" when the originals do not answer part of the question, as a QUESTION. Never quote what a person said as if it were the rule: state the rule, the rate or the name.
5. Answer in the exact line format the message asks for and nothing else.`, '', `ORIGINALS (${originals.length}):`];
  let budget = MAX_CHARS_ALL;
  for (const o of originals) {
    const cap = Math.max(0, Math.min(MAX_CHARS_PER_ORIGINAL, budget));
    if (cap <= 0) break;
    const text = o.text.length > cap ? `${o.text.slice(0, cap)} [truncated]` : o.text;
    budget -= text.length;
    lines.push(`ORIGINAL [doc:${o.id}] "${o.title}"${o.source_id ? ` (source ${o.source_id}` : ' ('}${o.fetched_at ? `${o.source_id ? ', ' : ''}fetched ${ymd(o.fetched_at)}` : ''}):`, text, '');
  }
  return lines.join('\n');
}

/** The section's question and the answer format; `own` names the originals fetched for this section, which the model should read first. */
export function packUserPrompt(section: SectionId, country: string, own: Original[] = []): string {
  const spec = SECTION_SPECS[section];
  return [`COUNTRY: ${countryName(country).en} (${country})`, `SECTION: ${spec.title.en} / ${spec.title.es}`, `QUESTION: ${spec.question.en}`,
    own.length ? `ORIGINALS FETCHED FOR THIS SECTION (read first, then any other that answers): ${own.map(o => `[doc:${o.id}]`).join(' ')}` : 'ORIGINALS FETCHED FOR THIS SECTION: none; answer from any original that does.',
    'FORMAT:',
    'HEADLINE EN: <one sentence that answers the question with its key figure or name> [doc:<id>]',
    'HEADLINE ES: <the same in Spanish> [doc:<id>]',
    'EN: <sentence> [doc:<id>]',
    'ES: <sentence> [doc:<id>]',
    '(repeat EN/ES pairs; at most twelve pairs)',
    'QUESTION EN: <what the originals did not answer>',
    'QUESTION ES: <the same in Spanish>'].join('\n');
}

/** The terms card's call: the same cached system block, the fixed fields as the message. */
export function termsUserPrompt(country: string): string {
  return [`COUNTRY: ${countryName(country).en} (${country})`, 'TASK: the terms card, the fixed facts a petroleum engineer wants first, each from an original.', termsFormat()].join('\n');
}

/* ── the reply ───────────────────────────────────────────────────────── */

export interface ParsedReply { headline: { en: string; es: string } | null; sentences: { en: string; es: string }[]; questions: { en: string; es: string }[] }

/** Pairs the English and Spanish lines of a reply in the line format above; tolerant of a missing Spanish line. */
export function parsePackReply(text: string): ParsedReply {
  const out: ParsedReply = { headline: null, sentences: [], questions: [] };
  let head: { en?: string; es?: string } = {};
  let pendingEn: string | null = null, pendingQ: string | null = null;
  const flushSentence = () => { if (pendingEn !== null) { out.sentences.push({ en: pendingEn, es: '' }); pendingEn = null; } };
  const flushQ = () => { if (pendingQ !== null) { out.questions.push({ en: pendingQ, es: '' }); pendingQ = null; } };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^HEADLINE\s+EN\s*:\s*(.+)$/i.exec(line))) head.en = m[1].trim();
    else if ((m = /^HEADLINE\s+ES\s*:\s*(.+)$/i.exec(line))) head.es = m[1].trim();
    else if ((m = /^QUESTION\s+EN\s*:\s*(.+)$/i.exec(line))) { flushSentence(); flushQ(); pendingQ = m[1].trim(); }
    else if ((m = /^QUESTION\s+ES\s*:\s*(.+)$/i.exec(line))) { if (pendingQ !== null) { out.questions.push({ en: pendingQ, es: m[1].trim() }); pendingQ = null; } else out.questions.push({ en: m[1].trim(), es: m[1].trim() }); }
    else if ((m = /^EN\s*:\s*(.+)$/i.exec(line))) { flushSentence(); flushQ(); pendingEn = m[1].trim(); }
    else if ((m = /^ES\s*:\s*(.+)$/i.exec(line))) { if (pendingEn !== null) { out.sentences.push({ en: pendingEn, es: m[1].trim() }); pendingEn = null; } }
    else if (/^\[QUESTION FOR YOU/i.test(line)) { flushSentence(); flushQ(); const q = line.replace(/^\[QUESTION FOR YOU:\s*/i, '').replace(/\]$/, ''); out.questions.push({ en: q, es: q }); }
    else if (pendingEn !== null) pendingEn += ' ' + line;     // a wrapped line continues the sentence
  }
  flushSentence(); flushQ();
  if (head.en || head.es) out.headline = { en: head.en ?? head.es ?? '', es: head.es ?? head.en ?? '' };
  return out;
}

const CITE_ALL_RE = /\s*\[(?:run|doc|lesson|ref|wm):[^\]]+\]/g;
const DOC_CITE_RE = /\[doc:[^\]]+\]/g;
/** The sentence without its citations, trimmed, with a final stop. */
export function stripCites(s: string): string {
  const t = s.replace(CITE_ALL_RE, '').replace(/\s+/g, ' ').trim();
  return t && !/[.!?…]$/.test(t) ? `${t}.` : t;
}
/** `text. [doc:a]`: the sentence, its punctuation, then its citations, so every sentence ends with `]`. */
const withCites = (s: string, cites: string[]) => `${stripCites(s)} ${cites.map(c => `[${c}]`).join(' ')}`.trim();

/**
 * draft.ts's check on one line, then the pack's rule: the line keeps only citations to this section's originals and
 * must keep at least one, or it is a question. Returns the cites kept (empty means: a question).
 */
function checkLine(line: string, allowed: Set<string>): { cites: string[]; questioned: boolean } {
  const checked = checkCitations([line], allowed).paragraphs[0] ?? '';
  if (/^\s*\[QUESTION FOR YOU/.test(checked)) return { cites: [], questioned: true };
  const cites = [...new Set([...checked.matchAll(DOC_CITE_RE)].map(m => m[0].slice(1, -1)).filter(c => allowed.has(c)))];
  return { cites, questioned: cites.length === 0 };
}

/** Every pair must cite; the Spanish inherits the English citation when it lost its own (one claim, two languages). */
export function checkPairs(parsed: ParsedReply, allowed: Set<string>): { headline: { en: string; es: string } | null; sentences: PackSentence[]; questions: { en: string; es: string }[]; citations: string[]; dropped: number } {
  const sentences: PackSentence[] = [], questions: { en: string; es: string }[] = [], citations = new Set<string>();
  let dropped = 0;
  const pair = (p: { en: string; es: string }): PackSentence | null => {
    const en = checkLine(p.en, allowed);
    if (en.questioned) return null;
    const es = p.es ? checkLine(p.es, allowed) : { cites: [], questioned: true };
    const esCites = es.questioned ? en.cites : es.cites;
    for (const c of [...en.cites, ...esCites]) citations.add(c);
    return { en: withCites(p.en, en.cites), es: withCites(p.es || p.en, esCites), cites: [...new Set([...en.cites, ...esCites])] };
  };
  for (const p of parsed.sentences) {
    const s = pair(p);
    if (s) sentences.push(s);
    else { dropped++; questions.push({ en: stripCites(p.en), es: stripCites(p.es || p.en) }); }
  }
  for (const q of parsed.questions) questions.push({ en: stripCites(q.en), es: stripCites(q.es || q.en) });
  let headline: { en: string; es: string } | null = null;
  if (parsed.headline) {
    const h = pair(parsed.headline);
    if (h) headline = { en: h.en, es: h.es };
  }
  if (!headline && sentences.length) headline = { en: sentences[0].en, es: sentences[0].es };
  return { headline, sentences, questions, citations: [...citations], dropped };
}

/* ── what changed (the re-run delta pattern: removed, added, changed) ── */

const key = (s: PackSentence) => stripCites(s.en).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Lines for the card: what the new version says that the old did not, and the reverse. A first version has nothing to compare with. */
export function diffSentences(prev: PackSentence[], next: PackSentence[]): { en: string; es: string }[] {
  if (!prev.length) return [];
  const out: { en: string; es: string }[] = [];
  const prevKeys = new Set(prev.map(key)), nextKeys = new Set(next.map(key));
  const removed = prev.filter(s => !nextKeys.has(key(s))), added = next.filter(s => !prevKeys.has(key(s)));
  const usedPrev = new Set<number>(), usedNext = new Set<number>();
  // A sentence citing the same originals that reads differently is a change, not a removal and an addition.
  removed.forEach((r, i) => {
    const j = added.findIndex((a, k) => !usedNext.has(k) && a.cites.length && a.cites.join() === r.cites.join());
    if (j < 0) return;
    usedPrev.add(i); usedNext.add(j);
    out.push({ en: `Changed: ${stripCites(r.en)} → ${stripCites(added[j].en)}`, es: `Cambió: ${stripCites(r.es)} → ${stripCites(added[j].es)}` });
  });
  removed.forEach((r, i) => { if (!usedPrev.has(i)) out.push({ en: `Removed: ${stripCites(r.en)}`, es: `Eliminado: ${stripCites(r.es)}` }); });
  added.forEach((a, k) => { if (!usedNext.has(k)) out.push({ en: `Added: ${stripCites(a.en)}`, es: `Añadido: ${stripCites(a.es)}` }); });
  return out;
}

/* ── one section ─────────────────────────────────────────────────────── */

const emptyBody = (headline: { en: string; es: string } | null, questions: { en: string; es: string }[] = []): PackSectionBody => ({ headline, sentences: [], questions, changed_since: [] });
/** Why the store refused, in words the owner can act on (the raw error stays on the chip). */
export function storageFault(note: string | undefined): { en: string; es: string } {
  const n = note ?? '';
  if (/NoSuchBucket|Bucket not found/i.test(n)) return { en: 'the storage bucket does not exist', es: 'el bucket de almacenamiento no existe' };
  if (/jwt|unauthori|apikey|\b40[13]\b/i.test(n)) return { en: 'the storage key was refused', es: 'la clave de almacenamiento fue rechazada' };
  if (/voyage|embed/i.test(n)) return { en: 'the search index refused the text', es: 'el índice de búsqueda rechazó el texto' };
  const m = n.replace(/^could not be filed:\s*/i, '').slice(0, 90).trim();
  return m ? { en: m, es: m } : { en: 'the file store refused the document', es: 'el almacén de archivos rechazó el documento' };
}
const NOT_FILED = (section: SectionId, n: number, why: { en: string; es: string }) => ({
  en: `Reached ${n} source${n === 1 ? '' : 's'} for ${SECTION_SPECS[section].title.en} but the Vault could not file ${n === 1 ? 'it' : 'them'}: ${why.en}. Fix the file store (vault/SETUP.md §1.5) and press Refresh.`,
  es: `Se alcanz${n === 1 ? 'ó' : 'aron'} ${n} fuente${n === 1 ? '' : 's'} para ${SECTION_SPECS[section].title.es} pero la Bóveda no pudo archivarla${n === 1 ? '' : 's'}: ${why.es}. Corrija el almacén de archivos (vault/SETUP.md §1.5) y pulse Actualizar.`,
});
const NO_SOURCE_REACHED = (section: SectionId, names: string[]) => ({ en: `No source reached for ${SECTION_SPECS[section].title.en}${names.length ? ` (${names.join(', ')})` : ''}; nothing was drafted.`, es: `Ninguna fuente alcanzada para ${SECTION_SPECS[section].title.es}${names.length ? ` (${names.join(', ')})` : ''}; no se redactó nada.` });

/**
 * Drafts one section from its originals. No originals: an honest body without a model call ('empty'; the service
 * section names the firm's own contacts through `opts.contacts`). Every surviving sentence cites one of these originals.
 */
export async function draftSection(provider: LlmProvider | null, section: SectionId, originals: Original[], opts: { country: string; contacts?: string[]; unreachable?: string[]; /** sources reached but not filed, and why the store refused */ unfiled?: { ids: string[]; why: { en: string; es: string } }; /** every original of the country: any may answer; the service section reads only its own */ all?: Original[] }): Promise<DraftSectionResult> {
  const spec = SECTION_SPECS[section];
  const pool = section === 'service' || !opts.all?.length ? originals : opts.all;
  const readable = pool.filter(o => o.text.trim().length > 0);
  const none: DraftSectionResult = { status: 'empty', body: emptyBody(null, [spec.question]), citations: [], spend_gbp: 0, warnings: [], called: false };
  // Reached but not filed is the Vault's fault: said first, with the fix, never dressed as "no source reached".
  // Reached but not filed is the Vault's fault and is said first, whatever the other originals could answer.
  if (!originals.length && opts.unfiled?.ids.length) return { ...none, status: 'unreachable', fault: 'storage', body: emptyBody(NOT_FILED(section, opts.unfiled.ids.length, opts.unfiled.why), [spec.question]) };
  if (!readable.length && !originals.length && opts.unreachable?.length) return { ...none, status: 'unreachable', body: emptyBody(NO_SOURCE_REACHED(section, opts.unreachable), [spec.question]) };
  if (!readable.length) {
    if (section === 'service') return { ...none, body: emptyBody(caveatFor('service', { contacts: opts.contacts ?? [] })!, [spec.question]) };
    const why = originals.length ? { en: `The ${originals.length} original(s) reached carried no text; nothing was drafted.`, es: `Los ${originals.length} original(es) alcanzados no contenían texto; no se redactó nada.` }
      : { en: `No source is registered for ${spec.title.en}; nothing was drafted.`, es: `No hay fuente registrada para ${spec.title.es}; no se redactó nada.` };
    return { ...none, body: emptyBody(why, [spec.question]) };
  }
  if (!provider) return { ...none, status: 'due', body: emptyBody({ en: 'No drafting assistant is connected; the originals are stored and the section will be drafted when one is.', es: 'No hay asistente de redacción conectado; los originales están almacenados y la sección se redactará cuando lo haya.' }, [spec.question]), warnings: ['no provider'] };
  const allowed = new Set(readable.map(o => `doc:${o.id}`));
  const r = await provider.complete({ system: packSystemPrompt(opts.country, readable), messages: [{ role: 'user', content: packUserPrompt(section, opts.country, originals.filter(o => o.text.trim().length > 0)) }], maxTokens: 2500 });
  const checked = checkPairs(parsePackReply(r.text), allowed);
  const warnings: string[] = [];
  if (checked.dropped) warnings.push(`${checked.dropped} sentence(s) did not cite an original of this section and were turned into questions`);
  const headline = checked.headline ?? { en: 'The originals reached did not support a cited sentence; see the questions.', es: 'Los originales alcanzados no sustentaron ninguna oración citada; vea las preguntas.' };
  return { status: 'fresh', body: { headline, sentences: checked.sentences, questions: checked.questions, changed_since: [] }, citations: checked.citations, usage: r.usage, model: r.model, spend_gbp: costGbp(r.model, r.usage), warnings, called: true };
}

/* ── the originals' text ─────────────────────────────────────────────── */

/** The extracted text of stored originals: the current chunks in order, else what the item's extracted record carries. */
export async function loadOriginals(db: Db, refs: { item_id: string; source_id: string | null }[]): Promise<Original[]> {
  const ids = [...new Set(refs.map(r => r.item_id))];
  if (!ids.length) return [];
  const items = new Map((await db.query<any>(`SELECT i.id::text AS id, i.title, i.version, i.hidden, i.extracted, i.origin->>'fetched_at' AS fetched_at, lt.classification
      FROM items i JOIN legal_tags lt ON lt.id = i.legal_tag WHERE i.id = ANY($1::uuid[])`, [ids])).rows.map(r => [r.id, r]));
  const chunks = (await db.query<any>('SELECT item_id::text AS item_id, text FROM chunks WHERE item_id = ANY($1::uuid[]) AND current ORDER BY item_id, ordinal', [ids])).rows;
  const byItem = new Map<string, string[]>();
  for (const c of chunks) (byItem.get(c.item_id) ?? byItem.set(c.item_id, []).get(c.item_id)!).push(c.text);
  const out: Original[] = [];
  for (const r of refs) {
    const it = items.get(r.item_id);
    // Only a public, visible original is read: the pack is public scope by construction, so anything else is refused here too.
    if (!it || it.hidden || it.classification !== 'public') continue;
    const ex = it.extracted ?? {};
    const text = (byItem.get(r.item_id) ?? []).join('\n\n') || [ex.text, ex.abstract, ex.summary, ex.quote].find((t: unknown) => typeof t === 'string' && t.trim()) || '';
    out.push({ id: r.item_id, title: it.title, source_id: r.source_id ?? ex.pack?.source_id ?? null, fetched_at: it.fetched_at ?? ex.manifest?.fetched_at ?? null, text: String(text), version: Number(it.version) || 1 });
  }
  return out;
}

/* ── the rows ────────────────────────────────────────────────────────── */

/** The same stored originals, byte for byte: every filed source's item and sha256 match (the risk section's World Monitor chip carries neither, so risk always redrafts). */
function sameOriginals(prev: PackSourceRef[] | null | undefined, now: PackSourceRef[]): boolean {
  const key = (xs: PackSourceRef[]) => JSON.stringify(xs.map(x => [x.id, x.item_id ?? null, x.sha256 ?? null, !!x.reachable]).sort());
  if (!Array.isArray(prev)) return false;
  if (!prev.length && !now.length) return true;                       // a section with no sources of its own: nothing to change
  if (!prev.length || !now.length) return false;
  if (now.some(x => x.reachable && x.item_id && !x.sha256)) return false;
  return key(prev) === key(now);
}
interface HeadRow { id: string; version: number; status: PackStatus; stale_reason: string | null; body: PackSectionBody; built_at: string; ttl_days: number; source_items: string[]; sources: PackSourceRef[] }
async function headRow(db: Db, country: string, section: SectionId): Promise<HeadRow | null> {
  return (await db.query<HeadRow>('SELECT id::text AS id, version, status, stale_reason, body, built_at, ttl_days, source_items, sources FROM country_packs WHERE country = $1 AND section = $2 AND superseded_by IS NULL ORDER BY version DESC LIMIT 1', [country, section])).rows[0] ?? null;
}
async function nextVersion(db: Db, country: string, section: SectionId): Promise<number> {
  return ((await db.query<{ v: number }>('SELECT coalesce(max(version), 0)::int AS v FROM country_packs WHERE country = $1 AND section = $2', [country, section])).rows[0]?.v ?? 0) + 1;
}
async function insertRow(db: Db, row: { country: string; section: SectionId; body: PackSectionBody; source_items: string[]; sources: PackSourceRef[]; ttl_days: number; status: PackStatus; stale_reason: string | null; built_at: Date; built_by: string; model: string | null; spend_gbp: number }): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const version = await nextVersion(db, row.country, row.section);
  const prev = await headRow(db, row.country, row.section);
  await db.query(`INSERT INTO country_packs (id, country, section, version, body, source_items, sources, ttl_days, status, stale_reason, built_at, built_by, model, spend_gbp)
                  VALUES ($1,$2,$3,$4,$5::jsonb,$6::text[],$7::jsonb,$8,$9,$10,$11,$12,$13,$14)`,
    [id, row.country, row.section, version, JSON.stringify(row.body), row.source_items, JSON.stringify(row.sources), row.ttl_days, row.status, row.stale_reason, row.built_at.toISOString(), row.built_by, row.model, row.spend_gbp]);
  if (prev) await db.query('UPDATE country_packs SET superseded_by = $2 WHERE id = $1', [prev.id, id]);
  return { id, version };
}

/** The World Monitor card, linked as a chip on the risk section (never duplicated into sentences; a reading is no stored original). */
async function worldMonitorChip(country: string): Promise<PackSourceRef> {
  const base = { id: 'world-monitor', url: `/api/countries/${country}/intel`, licence: 'World Monitor terms of service', attribution: 'World Monitor (the existing country intel card, linked)', item_id: null, sha256: null };
  if (!worldMonitorConfigured()) return { ...base, fetched_at: null, reachable: false, note: NOT_CONNECTED };
  try {
    const r = await countryRisk(country);
    if (!r.ok) return { ...base, fetched_at: null, reachable: false, note: r.reason };
    const d: any = r.data;
    return { ...base, fetched_at: r.fetched_at, reachable: true, note: `risk score ${d.score ?? 'n/a'}${d.level ? `, ${d.level}` : ''}${d.trend ? `, ${d.trend}` : ''}${d.sanctions_active ? ', sanctions active' : ''}` };
  } catch (e) { return { ...base, fetched_at: null, reachable: false, note: (e as Error).message }; }
}

/**
 * The hook: drafts every section the job hands over, in SECTIONS order, under the budget, and writes the rows. The
 * 'questions' section is derived from the others and costs nothing; a section the budget did not reach is 'due' with
 * stale_reason 'budget' (the head row updated when one exists, a row inserted when not) so the weekly refresh picks it up.
 */
export async function draftSectionsWithSummary(ctx: DraftCtx): Promise<DraftSummary> {
  const country = ctx.country.toUpperCase();
  const summary: DraftSummary = { country, sections: [], spend_gbp: 0, calls: 0, stopped_by: null };
  const order = new Map(SECTION_IDS.map((s, i) => [s, i]));
  const wanted = [...ctx.sections].sort((a, b) => (order.get(a.section) ?? 99) - (order.get(b.section) ?? 99));
  const ttlOf = (s: SectionId, override?: number) => (Number.isFinite(override) && override! > 0 ? override! : SECTIONS.find(x => x.id === s)!.ttl_days);
  const openQuestions: { en: string; es: string }[] = [];
  const unanswered: { section: SectionId; status: PackStatus; fault?: 'storage' }[] = [];
  const contacts = wanted.some(w => w.section === 'service') ? await vendorContacts(ctx.db, country) : [];
  let spent = 0;

  // Every original of the country, loaded once: any section may read any of them (the Chambers chapter answers the
  // fiscal, licensing and regulator questions as well as the legal one), and the block is cached across the calls.
  const literature = wanted.some(w => w.section === 'literature') ? await literatureOriginals(ctx.db, country) : [];
  const allRefs = new Map<string, { item_id: string; source_id: string | null }>();
  for (const w of wanted) for (const s of w.sources ?? []) if (s.reachable && s.item_id && !allRefs.has(s.item_id)) allRefs.set(s.item_id, { item_id: s.item_id, source_id: s.id });
  for (const x of literature) if (!allRefs.has(x.id)) allRefs.set(x.id, { item_id: x.id, source_id: x.source_id });
  const all = await loadOriginals(ctx.db, [...allRefs.values()]);
  const byId = new Map(all.map(o => [o.id, o]));
  const anyReadable = all.some(o => o.text.trim().length > 0);
  // Did any section's own sources change since its last version? If none did, fresh sections (and the terms) are kept.
  const prevRows = new Map<SectionId, HeadRow | null>();
  let anyChanged = false;
  for (const w of wanted) {
    if (w.section === 'questions') continue;
    const prev = await headRow(ctx.db, country, w.section); prevRows.set(w.section, prev);
    const chips: PackSourceRef[] = w.section === 'risk' ? [...(w.sources ?? []), await worldMonitorChip(country)] : (w.sources ?? []);
    if (!prev || !sameOriginals(prev.sources, chips)) anyChanged = true;
  }
  let anyCalled = false;

  for (const w of wanted) {
    if (w.section === 'questions') continue;        // derived last
    const sources = w.sources ?? [];
    const reached = sources.filter(s => s.reachable && s.item_id);
    const unfiledSrc = sources.filter(s => s.fault === 'storage');
    const unreachable = sources.filter(s => !(s.reachable && s.item_id) && s.fault !== 'storage').map(s => s.id);
    const unfiled = { ids: unfiledSrc.map(s => s.id), why: storageFault(unfiledSrc[0]?.note) };
    const refs: { item_id: string; source_id: string | null }[] = reached.map(s => ({ item_id: s.item_id!, source_id: s.id }));
    if (w.section === 'literature') for (const x of literature) if (!refs.some(r => r.item_id === x.id)) refs.push({ item_id: x.id, source_id: x.source_id });
    const originals = refs.map(r => byId.get(r.item_id)).filter((o): o is Original => !!o);
    const chips: PackSourceRef[] = w.section === 'risk' ? [...sources, await worldMonitorChip(country)] : sources;
    const ttl = ttlOf(w.section, w.ttl_days);
    const needsCall = w.section === 'service' ? originals.some(o => o.text.trim().length > 0) : anyReadable && !(originals.length === 0 && unfiled.ids.length > 0);
    const prev = prevRows.get(w.section) ?? null;
    // A fresh section is kept, not re-drafted, when no original of the country changed since the last build: a
    // Refresh that found nothing new costs nothing (6 Oct 2026: every build re-drafted every section).
    if (needsCall && prev && prev.status === 'fresh' && !ctx.refresh && !anyChanged) {
      summary.sections.push({ section: w.section, id: prev.id, version: prev.version, status: 'fresh', stale_reason: null, called: false, spend_gbp: 0, changed: 0, kept: true });
      for (const q of prev.body?.questions ?? []) if (!openQuestions.some(x => x.en === q.en)) openQuestions.push(q);
      continue;
    }

    let result: DraftSectionResult;
    if (needsCall && ctx.provider && spent >= ctx.budgetGbp) {
      // The budget is spent: mark due, draft nothing, keep the previous body where one exists.
      summary.stopped_by = 'budget';
      if (prev) {
        await ctx.db.query("UPDATE country_packs SET status = 'due', stale_reason = 'budget' WHERE id = $1", [prev.id]);
        summary.sections.push({ section: w.section, id: prev.id, version: prev.version, status: 'due', stale_reason: 'budget', called: false, spend_gbp: 0, changed: 0 });
      } else {
        const body = emptyBody({ en: `Not drafted: the build's budget (£${ctx.budgetGbp}) was spent before this section; it is due for the next refresh.`, es: `No redactada: el presupuesto de la construcción (£${ctx.budgetGbp}) se agotó antes de esta sección; queda pendiente para la próxima actualización.` }, [SECTION_SPECS[w.section].question]);
        const { id, version } = await insertRow(ctx.db, { country, section: w.section, body, source_items: originals.map(o => o.id), sources: chips, ttl_days: ttl, status: 'due', stale_reason: 'budget', built_at: ctx.now, built_by: ctx.by, model: null, spend_gbp: 0 });
        summary.sections.push({ section: w.section, id, version, status: 'due', stale_reason: 'budget', called: false, spend_gbp: 0, changed: 0 });
      }
      unanswered.push({ section: w.section, status: 'due' });
      continue;
    }
    result = await draftSection(ctx.provider, w.section, originals, { country, contacts, unreachable, unfiled, all });
    if (result.called) anyCalled = true;
    // Wave 7 PR6 (W7-AC22): the licensing section reads from round_events. Each confirmed event is one cited line added
    // from the table after drafting, never fed to the model, so the section stays true once the watch confirms a date.
    if (w.section === 'licensing') {
      const lines = await confirmedRoundSentences(ctx.db, country);
      if (lines.length) result = { ...result, body: { ...result.body, sentences: [...result.body.sentences, ...lines] }, citations: [...new Set([...result.citations, ...lines.flatMap(l => l.cites)])] };
    }
    if (result.called) {
      summary.calls++; spent = round4(spent + result.spend_gbp);
      await ctx.db.query(`INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out, cost_usd) VALUES ($1,$2,'public',$3::text[],$4::jsonb,$5,$6,$7,$8)`,
        [ctx.by, PACK_AUDIT_ACTION, result.citations.slice(0, 100), JSON.stringify({ model: result.model ?? null, country, section: w.section, job_id: ctx.jobId, refresh: ctx.refresh ? 'true' : 'false', spend_gbp: result.spend_gbp }),
         result.usage?.input ?? 0, result.usage?.cached ?? 0, result.usage?.output ?? 0, result.usage ? (costOf(result.model, result.usage) ?? null) : null]);
    }
    const changed = prev ? diffSentences(prev.body?.sentences ?? [], result.body.sentences) : [];
    if (prev && prev.status !== 'fresh' && result.status === 'fresh' && !changed.length && result.body.sentences.length) changed.push({ en: `Rebuilt: previously ${prev.status}${prev.stale_reason ? ` (${prev.stale_reason})` : ''}.`, es: `Reconstruida: antes ${prev.status}${prev.stale_reason ? ` (${prev.stale_reason})` : ''}.` });
    const body: PackSectionBody = { ...result.body, changed_since: changed };
    const stale_reason = result.fault === 'storage' ? `storage:${unfiled.why.en}` : result.status === 'unreachable' ? `unreachable:${unreachable[0] ?? 'all'}` : result.status === 'due' ? 'no_provider' : null;
    const { id, version } = await insertRow(ctx.db, { country, section: w.section, body, source_items: originals.map(o => o.id), sources: chips, ttl_days: ttl, status: result.status, stale_reason, built_at: ctx.now, built_by: ctx.by, model: result.model ?? null, spend_gbp: result.spend_gbp });
    summary.sections.push({ section: w.section, id, version, status: result.status, stale_reason, called: result.called, spend_gbp: result.spend_gbp, changed: changed.length });
    for (const q of body.questions) if (!openQuestions.some(x => x.en === q.en)) openQuestions.push(q);
    if (result.status !== 'fresh') unanswered.push({ section: w.section, status: result.status, ...(result.fault ? { fault: result.fault } : {}) });
  }

  // The terms card: one call over the same cached block, rebuilt when anything was re-drafted or none exists yet.
  const prevTerms = await headTerms(ctx.db, country);
  const readableAll = all.filter(o => o.text.trim().length > 0);
  if (readableAll.length && (anyCalled || !prevTerms || prevTerms.status !== 'fresh' || ctx.refresh)) {
    if (!ctx.provider) {
      if (!prevTerms) { const t = await insertTerms(ctx.db, { country, fields: emptyTerms(), questions: [{ en: 'No drafting assistant is connected; the terms will be drafted when one is.', es: 'No hay asistente de redacción conectado; los términos se redactarán cuando lo haya.' }], source_items: [], status: 'due', stale_reason: 'no_provider', built_at: ctx.now, built_by: ctx.by, model: null, spend_gbp: 0 }); summary.terms = { ...t, called: false, kept: false, spend_gbp: 0, missing: TERMS.filter(x => x.required).map(x => x.id) }; }
    } else if (spent >= ctx.budgetGbp) {
      summary.stopped_by = 'budget';
      if (!prevTerms) { const t = await insertTerms(ctx.db, { country, fields: emptyTerms(), questions: [], source_items: [], status: 'due', stale_reason: 'budget', built_at: ctx.now, built_by: ctx.by, model: null, spend_gbp: 0 }); summary.terms = { ...t, called: false, kept: false, spend_gbp: 0, missing: TERMS.filter(x => x.required).map(x => x.id) }; }
    } else {
      const allowed = new Set(readableAll.map(o => `doc:${o.id}`));
      const r = await ctx.provider.complete({ system: packSystemPrompt(country, readableAll), messages: [{ role: 'user', content: termsUserPrompt(country) }], maxTokens: 3000 });
      const checked = checkTerms(parseTermsReply(r.text), allowed, id => { const o = byId.get(id); return o?.fetched_at ? ymd(o.fetched_at) : null; });
      const cost = costGbp(r.model, r.usage);
      summary.calls++; spent = round4(spent + cost);
      await ctx.db.query(`INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out, cost_usd) VALUES ($1,$2,'public',$3::text[],$4::jsonb,$5,$6,$7,$8)`,
        [ctx.by, PACK_AUDIT_ACTION, checked.citations.slice(0, 100), JSON.stringify({ model: r.model ?? null, country, section: 'terms', job_id: ctx.jobId, refresh: ctx.refresh ? 'true' : 'false', spend_gbp: cost }), r.usage.input, r.usage.cached, r.usage.output, costOf(r.model, r.usage) ?? null]);
      const t = await insertTerms(ctx.db, { country, fields: checked.fields, questions: checked.questions, source_items: checked.citations.map(c => c.slice(4)), status: 'fresh', stale_reason: null, built_at: ctx.now, built_by: ctx.by, model: r.model ?? null, spend_gbp: cost });
      summary.terms = { ...t, called: true, kept: false, spend_gbp: cost, missing: packQuality({ version: t.version, status: 'fresh', stale_reason: null, built_at: ctx.now.toISOString(), fields: checked.fields, questions: checked.questions }).missing };
      for (const q of checked.questions) if (!openQuestions.some(x => x.en === q.en)) openQuestions.push(q);
    }
  } else if (prevTerms) {
    summary.terms = { id: prevTerms.id, version: prevTerms.version, called: false, kept: true, spend_gbp: 0, missing: packQuality(prevTerms).missing };
  }

  if (wanted.some(w => w.section === 'questions')) {
    const spec = SECTION_SPECS.questions;
    const questions = [...openQuestions.filter(q => !SECTION_IDS.some(s => SECTION_SPECS[s].question.en === q.en))];
    for (const u of unanswered) {
      const t = SECTION_SPECS[u.section].title;
      const why = u.fault === 'storage' ? { en: 'reached but the Vault could not file it', es: 'alcanzada pero la Bóveda no pudo archivarla' } : u.status === 'unreachable' ? { en: 'no source reached', es: 'ninguna fuente alcanzada' } : u.status === 'empty' ? { en: 'no source or no text', es: 'sin fuente o sin texto' } : { en: `not drafted (${u.status})`, es: `no redactada (${u.status})` };
      questions.push({ en: `${t.en}: ${why.en}; ask the regulator or counsel.`, es: `${t.es}: ${why.es}; pregunte al regulador o al asesor legal.` });
    }
    const prev = await headRow(ctx.db, country, 'questions');
    const headline = { en: `${questions.length} open question${questions.length === 1 ? '' : 's'} from the other sections; ${unanswered.length} section${unanswered.length === 1 ? '' : 's'} not drafted.`, es: `${questions.length} pregunta${questions.length === 1 ? '' : 's'} abierta${questions.length === 1 ? '' : 's'} de las demás secciones; ${unanswered.length} sección${unanswered.length === 1 ? '' : 'es'} sin redactar.` };
    const body: PackSectionBody = { headline, sentences: [], questions, changed_since: [] };
    if (prev) {
      const before = new Set((prev.body?.questions ?? []).map(q => q.en));
      body.changed_since = questions.filter(q => !before.has(q.en)).map(q => ({ en: `Added: ${q.en}`, es: `Añadido: ${q.es}` }));
    }
    const { id, version } = await insertRow(ctx.db, { country, section: 'questions', body, source_items: [], sources: [], ttl_days: ttlOf('questions', wanted.find(w => w.section === 'questions')?.ttl_days), status: 'fresh', stale_reason: null, built_at: ctx.now, built_by: ctx.by, model: null, spend_gbp: 0 });
    summary.sections.push({ section: 'questions', id, version, status: 'fresh', stale_reason: null, called: false, spend_gbp: 0, changed: body.changed_since.length });
  }
  summary.spend_gbp = round4(spent);
  return summary;
}

/* ── the terms card rows ─────────────────────────────────────────────── */

const emptyTerms = (): Record<TermId, TermValue | null> => Object.fromEntries(TERMS.map(t => [t.id, null])) as Record<TermId, TermValue | null>;
interface TermsRow extends TermsCard { id: string; source_items: string[] }
async function headTerms(db: Db, country: string): Promise<TermsRow | null> {
  const r = (await db.query<any>('SELECT id::text AS id, version, status, stale_reason, built_at, fields, questions, source_items FROM country_terms WHERE country = $1 AND superseded_by IS NULL ORDER BY version DESC LIMIT 1', [country])).rows[0];
  return r ? { id: r.id, version: Number(r.version), status: r.status, stale_reason: r.stale_reason ?? null, built_at: new Date(r.built_at).toISOString(), fields: { ...emptyTerms(), ...(r.fields ?? {}) }, questions: Array.isArray(r.questions) ? r.questions : [], source_items: r.source_items ?? [] } : null;
}
async function insertTerms(db: Db, row: { country: string; fields: Record<TermId, TermValue | null>; questions: { en: string; es: string }[]; source_items: string[]; status: TermsCard['status']; stale_reason: string | null; built_at: Date; built_by: string; model: string | null; spend_gbp: number }): Promise<{ id: string; version: number }> {
  const prev = await headTerms(db, row.country);
  const version = ((await db.query<{ v: number }>('SELECT coalesce(max(version), 0)::int AS v FROM country_terms WHERE country = $1', [row.country])).rows[0]?.v ?? 0) + 1;
  const id = randomUUID();
  await db.query(`INSERT INTO country_terms (id, country, version, fields, questions, source_items, status, stale_reason, built_at, built_by, model, spend_gbp) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::text[],$7,$8,$9,$10,$11,$12)`,
    [id, row.country, version, JSON.stringify(row.fields), JSON.stringify(row.questions), row.source_items, row.status, row.stale_reason, row.built_at.toISOString(), row.built_by, row.model, row.spend_gbp]);
  if (prev) await db.query('UPDATE country_terms SET superseded_by = $2 WHERE id = $1', [prev.id, id]);
  return { id, version };
}
/** The head terms card of a country, or null before the first drafted build. */
export async function loadTerms(db: Db, country: string): Promise<TermsCard | null> {
  const r = await headTerms(db, country.toUpperCase());
  if (!r) return null;
  const { id: _id, source_items: _s, ...card } = r; void _id; void _s;
  return card;
}

/** The hook as the job declares it (`opts.draft?: (ctx) => Promise<void>`). */
export async function draftSections(ctx: DraftCtx): Promise<void> { await draftSectionsWithSummary(ctx); }

/* ── reading a pack (the connector, get_project_context) ─────────────── */

export interface PackSectionRead { section: SectionId; title: { en: string; es: string }; version: number; status: PackStatus; stale_reason: string | null; built_at: string | null; ttl_days: number; due_at: string | null; body: PackSectionBody; sources: PackSourceRef[]; caveat: { en: string; es: string } | null }
export interface PackRead { country: string; name: { en: string; es: string }; assembled_at: string | null; sections: PackSectionRead[]; counts: Record<'built' | PackStatus, number>; terms: TermsCard | null; quality: PackQuality }

/** The countries that have at least one pack row, upper-case codes, sorted. */
export async function countriesWithPack(db: Db): Promise<string[]> {
  return (await db.query<{ country: string }>('SELECT DISTINCT trim(country) AS country FROM country_packs ORDER BY 1')).rows.map(r => r.country);
}

/** The head version of every section (ten, in order; a never-built section is version 0, 'empty'), or null when no row exists. */
export async function loadPack(db: Db, country: string): Promise<PackRead | null> {
  const cc = country.toUpperCase();
  const rows = (await db.query<any>('SELECT id::text AS id, section, version, status, stale_reason, body, built_at, ttl_days, sources FROM country_packs WHERE country = $1 AND superseded_by IS NULL ORDER BY section, version DESC', [cc])).rows;
  if (!rows.length) return null;
  const head = new Map<string, any>();
  for (const r of rows) if (!head.has(r.section)) head.set(r.section, r);
  const contacts = await vendorContacts(db, cc);
  const counts: PackRead['counts'] = { built: 0, fresh: 0, due: 0, stale: 0, unreachable: 0, empty: 0 };
  let assembled: string | null = null;
  const sections: PackSectionRead[] = SECTIONS.map(s => {
    const r = head.get(s.id);
    const caveat = caveatFor(s.id, { contacts });
    if (!r) { counts.empty++; return { section: s.id, title: { en: s.en, es: s.es }, version: 0, status: 'empty', stale_reason: null, built_at: null, ttl_days: s.ttl_days, due_at: null, body: emptyBody(null), sources: [], caveat }; }
    counts.built++; counts[r.status as PackStatus]++;
    const built = new Date(r.built_at).toISOString();
    if (!assembled || built > assembled) assembled = built;
    return { section: s.id, title: { en: s.en, es: s.es }, version: Number(r.version), status: r.status, stale_reason: r.stale_reason, built_at: built, ttl_days: Number(r.ttl_days), due_at: dueAt(built, Number(r.ttl_days)), body: r.body, sources: r.sources ?? [], caveat };
  });
  const terms = await loadTerms(db, cc);
  return { country: cc, name: countryName(cc), assembled_at: assembled, sections, counts, terms, quality: packQuality(terms) };
}

/** The terms as lines for get_project_context: the required facts first, each with its citation. */
export function termsLines(p: PackRead): string[] {
  if (!p.terms) return ['- Terms: not drafted yet'];
  const lines = [`- Terms (version ${p.terms.version}, ${p.quality.ok ? 'meets the bar' : `below standard: missing ${p.quality.missing.join(', ')}`}):`];
  for (const t of TERMS) { const v = p.terms.fields[t.id]; if (v) lines.push(`  - ${t.en}: ${v.en}${v.as_of ? ` (as of ${v.as_of})` : ''}`); }
  return lines;
}

/** The headline per section for get_project_context. */
export function packHeadlines(p: PackRead): { section: SectionId; en: string; status: PackStatus; due_at: string | null }[] {
  return p.sections.map(s => ({ section: s.section, en: s.body.headline?.en ?? (s.version ? '' : 'not built'), status: s.status, due_at: s.due_at }));
}

/** The pack as markdown: ten sections, every sentence with its citation, the as-of and status per section, the caveats, the chips. */
export function packMarkdown(p: PackRead): string {
  const c = p.counts;
  const lines: string[] = [`# Country pack: ${p.name.en} (${p.country})`, '', `${p.assembled_at ? `assembled ${ymd(p.assembled_at)}` : 'not assembled'}; ${c.built} of ${p.sections.length} sections built; fresh ${c.fresh}, due ${c.due}, stale ${c.stale}, unreachable ${c.unreachable}, empty ${c.empty}.`, '',
    'Public scope, built from public sources only. Every sentence cites the stored original it was drafted from, as [doc:<id>]; cite them the same way.', ''];
  lines.push(...termsMarkdown(p.terms, p.quality));
  for (const s of p.sections) {
    lines.push(`## ${s.title.en} · ${s.title.es}`, '');
    lines.push(s.version ? `- Status: ${s.status}${s.stale_reason ? ` (${s.stale_reason})` : ''}; as of ${ymd(s.built_at)}; due ${s.due_at}; version ${s.version}` : '- Status: empty; not built');
    if (s.caveat) lines.push(`- Caveat: ${s.caveat.en} · ${s.caveat.es}`);
    if (s.body.headline) lines.push(`- Headline: ${s.body.headline.en}`, `  - ES: ${s.body.headline.es}`);
    if (s.body.sentences.length) { lines.push('- Sentences:'); for (const x of s.body.sentences) lines.push(`  - ${x.en}`, `    - ES: ${x.es}`); }
    if (s.body.questions.length) { lines.push('- Questions:'); for (const q of s.body.questions) lines.push(`  - ${q.en}`, `    - ES: ${q.es}`); }
    if (s.body.changed_since.length) { lines.push('- What changed:'); for (const q of s.body.changed_since) lines.push(`  - ${q.en}`, `    - ES: ${q.es}`); }
    if (s.sources.length) { lines.push('- Sources:'); for (const src of s.sources) lines.push(`  - ${src.id}: ${src.attribution} (${src.licence}); ${src.fault === 'storage' ? 'reached, not filed' : src.reachable ? `fetched ${src.fetched_at ? ymd(src.fetched_at) : 'undated'}` : 'unreachable'}${src.item_id ? ` [doc:${src.item_id}]` : ''}${src.note ? `; ${src.note}` : ''}`); }
    lines.push('');
  }
  return lines.join('\n');
}
