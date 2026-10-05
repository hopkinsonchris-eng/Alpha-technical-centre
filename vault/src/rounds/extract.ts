/**
 * Reading a changed regulator page for dated round stages (wave 7 PR6; docs/vault-hub/wave7/05-markup.md §1.9, W7-AC21;
 * 04-step-changes.md P2 "AI leverage (b)"). One low-effort model call over the page's extracted text asks for the dated
 * stages as JSON: the round's name as the regulator writes it, a stage from STAGE_IDS, the date, a one-line title and
 * the verbatim sentence that states it. The rules are checked mechanically afterwards, never trusted:
 *   - the quote must be found verbatim (whitespace-normalised) in the text, or the proposal is refused and counted in
 *     `refused_quotes`: the model never supplies a date from memory, only from the fetched text;
 *   - a date must parse (YYYY-MM-DD, a day in words, or dd/mm/yyyy) or be null; a date the quote gives no figure for is refused;
 *   - the stage must be one of STAGE_IDS.
 * No provider means no proposals; the page is still filed by the watch. Spend is priced like the pack's (costGbp).
 * Nothing here touches the network or the database, and the model never receives a URL.
 */
import type { LlmProvider, LlmUsage } from '../llm/provider.ts';
import { costGbp } from '../llm/country-pack.ts';
import { countryName } from '../opportunities.ts';
import { STAGES, STAGE_IDS, type RoundProposal, type StageId } from './types.ts';

export const ROUND_AUDIT_ACTION = 'llm.round-watch';
const MAX_CHARS = 40_000;
const MAX_PROPOSALS = 40;
const MIN_QUOTE_CHARS = 12;

export interface ExtractResult {
  proposals: RoundProposal[];
  /** Proposals refused because their quote is not in the text. */
  refused_quotes: number;
  /** Every refusal: quote, stage or date. */
  refused: number;
  warnings: string[];
  usage?: LlmUsage; model?: string; spend_gbp: number; called: boolean;
}

/* ── prompts ─────────────────────────────────────────────────────────── */

/** Stable per country so the provider caches it; the page travels in the user message. */
export function roundSystemPrompt(country: string): string {
  const name = countryName(country).en;
  const stages = STAGES.map(s => `${s.id} (${s.en})`).join(', ');
  return `You read one page from the oil and gas regulator of ${name} (${country}) for Alpha Technical Centre, a technical consultancy, and list the dated steps of its licensing rounds.
Rules that are checked mechanically after you answer:
1. Read only the TEXT in the message. Never fetch anything, never add a fact or a date from memory, never guess a date the text does not state.
2. Each step is one licensing round's stage with the sentence of the TEXT that states it, copied verbatim (the exact words, same language, no paraphrase, no ellipsis). A step whose sentence is not in the TEXT is discarded.
3. Stages: ${stages}. Use 'other' for a dated step that fits none.
4. Give the date as YYYY-MM-DD when the sentence gives a full date; a sentence that gives no date, or only a month or a season, has date null.
5. Name the round as the regulator writes it (for example "33rd Offshore Licensing Round", "6º Ciclo da Oferta Permanente de Concessão").
6. Answer with a JSON array only, no prose: [{"round": "...", "stage": "...", "date": "YYYY-MM-DD" | null, "title": "<one short line in English saying what happens>", "quote": "<the verbatim sentence>"}]. An empty array when the page states no round step.`;
}

export function roundUserPrompt(country: string, text: string, readAt: string): string {
  const t = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)} [truncated]` : text;
  return `COUNTRY: ${countryName(country).en} (${country})\nPAGE READ: ${readAt.slice(0, 10)}\nTEXT:\n${t}`;
}

/* ── checks ──────────────────────────────────────────────────────────── */

export const normaliseWs = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const unquote = (s: string) => s.replace(/^["'“”‘’«»\s]+|["'“”‘’«»\s]+$/g, '');

/** The quote, whitespace-normalised and stripped of surrounding quotation marks, occurs in the text. */
export function quoteInText(quote: string, text: string): boolean {
  const q = unquote(normaliseWs(quote));
  return q.length >= MIN_QUOTE_CHARS && normaliseWs(text).includes(q);
}

const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number): string | undefined => {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1900 || y > 2200) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined;
};
/** YYYY-MM-DD for a date the model gave in any readable form; null for null or empty; undefined when it does not parse. */
export function parseEventDate(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || /^null$/i.test(s)) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s))) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(s))) return valid(Number(m[3]), Number(m[2]), Number(m[1]));     // dd/mm/yyyy as the Latin regulators write it
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  return /\d{4}/.test(s) ? valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? undefined : undefined;
}
/** A dated proposal must show its figure in the quote: the year, or the day of the month as a number. */
export function dateEvidenced(date: string, quote: string): boolean {
  const [y, , d] = date.split('-');
  return quote.includes(y) || new RegExp(`(^|\\D)0?${Number(d)}(\\D|$)`).test(quote);
}

/** The JSON array in a reply, fences or prose around it tolerated; [] when none can be read. */
export function parseRoundReply(text: string): any[] {
  const body = text.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '');
  const a = body.indexOf('['), b = body.lastIndexOf(']');
  const tryParse = (s: string): any => { try { return JSON.parse(s); } catch { return undefined; } };
  let j = tryParse(body.trim());
  if (j === undefined && a >= 0 && b > a) j = tryParse(body.slice(a, b + 1));
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object') for (const k of ['proposals', 'events', 'steps', 'stages']) if (Array.isArray(j[k])) return j[k];
  return [];
}

/* ── the extraction ──────────────────────────────────────────────────── */

export async function extractRounds(provider: LlmProvider | null, country: string, text: string, sourceUrl: string, sourceItem: string | null, readAt: string): Promise<ExtractResult> {
  const none: ExtractResult = { proposals: [], refused_quotes: 0, refused: 0, warnings: [], spend_gbp: 0, called: false };
  if (!provider) return { ...none, warnings: ['no provider: the page is filed, nothing is proposed'] };
  if (!text.trim()) return { ...none, warnings: ['the page carried no text'] };
  const read_at = new Date(readAt).toISOString();
  const r = await provider.complete({ system: roundSystemPrompt(country), messages: [{ role: 'user', content: roundUserPrompt(country, text, read_at) }], maxTokens: 1500, effort: 'low' });
  const out: ExtractResult = { ...none, usage: r.usage, model: r.model, spend_gbp: costGbp(r.model, r.usage), called: true };
  const items = parseRoundReply(r.text);
  if (!items.length && r.text.trim() && !/^\s*\[\s*\]\s*$/.test(r.text.replace(/```[a-z]*/gi, ''))) out.warnings.push('the reply held no JSON array');
  const seen = new Set<string>();
  for (const it of items.slice(0, MAX_PROPOSALS)) {
    if (!it || typeof it !== 'object') { out.refused++; continue; }
    const round = typeof it.round === 'string' ? normaliseWs(it.round) : '';
    const stage = typeof it.stage === 'string' ? it.stage.trim().toLowerCase() : '';
    const title = typeof it.title === 'string' ? normaliseWs(it.title) : '';
    const quote = typeof it.quote === 'string' ? unquote(normaliseWs(it.quote)) : '';
    if (!round || !title) { out.refused++; out.warnings.push(`refused: a step without a round name or title`); continue; }
    if (!STAGE_IDS.includes(stage as StageId)) { out.refused++; out.warnings.push(`refused: "${stage}" is not a stage (${round})`); continue; }
    if (!quoteInText(quote, text)) { out.refused++; out.refused_quotes++; out.warnings.push(`refused: the quote is not in the text (${round}, ${stage})`); continue; }
    const event_date = parseEventDate(it.date);
    if (event_date === undefined) { out.refused++; out.warnings.push(`refused: the date "${String(it.date)}" does not parse (${round}, ${stage})`); continue; }
    if (event_date && !dateEvidenced(event_date, quote)) { out.refused++; out.warnings.push(`refused: the quote gives no figure for ${event_date} (${round}, ${stage})`); continue; }
    const key = `${round}|${stage}|${event_date ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.proposals.push({ country, round, stage: stage as StageId, event_date, title: title.slice(0, 200), quote: quote.slice(0, 2000), source_item: sourceItem, source_url: sourceUrl, read_at });
  }
  return out;
}
