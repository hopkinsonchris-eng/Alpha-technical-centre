/**
 * Fields named in a document (wave 3, docs/vault-hub/wave3/05-markup.md §1.3, W3-D1).
 * After a document is indexed, `extractAssets` finds the fields, blocks, basins and
 * wells it names: a dictionary pass over the Vault's assets for the project's country
 * (including the imported Global Energy Monitor units), and, with a provider, a model
 * pass whose every candidate must carry a quote found verbatim in the text and
 * containing the name. Nothing attaches itself: `proposeAssets` writes review-queue
 * rows of kind `asset` (one open row per project and name) that a member or partner
 * accepts or rejects in the Hub.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { LlmProvider } from '../llm/provider.ts';
import type { Anchor } from './extract.ts';
import { ASSET_KINDS, locate, type AssetKind, type Candidate } from '../assets/gazetteers.ts';
import { quoteInText } from './legal-finance.ts';

export interface AssetMention { name: string; kind: AssetKind; quote: string; anchor: string | null; source: 'dictionary' | 'model'; asset_id?: string }
export interface MentionProject { id: string; country: string | null; asset_ids: string[] }
export interface MentionItem { id: string; version: number; title: string | null; project_id: string }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MIN_NAME = 4;
const SHORT_NAME = 5;
const FIELD_WORD = /\b(?:field|fields|block|blocks|basin|well|wells|campo|campos|bloque|cuenca|pozo|yacimiento|discovery|licence|license|concession)\b/i;
const MAX_MENTIONS = 20;

function anchorAt(anchors: Anchor[], offset: number): string | null {
  let best: Anchor | null = null;
  for (const a of anchors) if (a.offset <= offset && (!best || a.offset >= best.offset)) best = a;
  return best?.label ?? null;
}

/** The sentence around a match, whitespace-collapsed, at most ~300 characters. */
function sentenceAround(text: string, index: number, len: number): string {
  const start = Math.max(0, text.slice(0, index).lastIndexOf('\n') + 1);
  let end = text.indexOf('\n', index + len);
  if (end < 0) end = text.length;
  const before = text.slice(start, index);
  const prev = [...before.matchAll(/[.!?]["')\]]*\s+/g)].pop();
  const a = prev ? start + prev.index! + prev[0].length : start;
  const next = /[.!?]["')\]]*(?=\s|$)/.exec(text.slice(index + len, end));
  const b = next ? index + len + next.index + next[0].length : end;
  let q = squash(text.slice(a, b));
  if (q.length > 300) {
    const from = Math.max(0, Math.min(index - a - 100, q.length - 300));
    q = q.slice(from, from + 300);
    if (from > 0) q = q.slice(q.indexOf(' ') + 1);
    q = q.slice(0, q.lastIndexOf(' ') > 0 ? q.lastIndexOf(' ') : q.length);
  }
  return q;
}

/** Whole-word, case-insensitive pass over the Vault's assets for the project's country. */
async function dictionaryPass(db: Db, text: string, anchors: Anchor[], project: MentionProject): Promise<AssetMention[]> {
  if (!project.country) return [];
  const rows = (await db.query<{ id: string; name: string; kind: AssetKind }>(
    'SELECT id, name, kind FROM assets WHERE country = $1 AND kind = ANY($2::text[]) AND length(name) >= $3 ORDER BY length(name) DESC, name', [project.country, ASSET_KINDS, MIN_NAME])).rows;
  const out: AssetMention[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    // A short name ("Bare", "Boca") is an ordinary word too: it must appear as written and next to a field word.
    const short = r.name.length <= SHORT_NAME;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(r.name)}(?![\\p{L}\\p{N}])`, short ? 'u' : 'iu');
    const m = re.exec(text);
    if (!m) continue;
    if (short && !FIELD_WORD.test(text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40))) continue;
    seen.add(key);
    out.push({ name: r.name, kind: r.kind, quote: sentenceAround(text, m.index, m[0].length), anchor: anchorAt(anchors, m.index), source: 'dictionary', asset_id: r.id });
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

const SYSTEM = [
  'You find the oil and gas fields, licence blocks, basins and wells that a document names. Reply with one JSON object and nothing else.',
  'Shape: {"candidates":[{"name":"<the name as written>","kind":"field|block|basin|well","quote":"<one exact, verbatim sentence from the document that contains the name>"}]}.',
  'Only names of specific fields, blocks, basins or wells: not companies, countries, states or generic words. Omit anything you cannot quote verbatim. Never guess a name or a location.',
].join('\n');

function parseJsonObject(s: string): any {
  const body = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

/** The model's candidates, kept only when the quote is verbatim in the text and contains the name. */
async function modelPass(text: string, anchors: Anchor[], provider: LlmProvider): Promise<AssetMention[]> {
  let raw: any = null;
  try {
    const r = await provider.complete({ system: SYSTEM, messages: [{ role: 'user', content: text.slice(0, 20000) }], maxTokens: 1200, effort: 'low' , purpose: 'extract.assets' });
    raw = parseJsonObject(r.text);
  } catch { return []; }
  const list: any[] = Array.isArray(raw?.candidates) ? raw.candidates : [];
  const out: AssetMention[] = [];
  const flat = squash(text), lower = flat.toLowerCase();
  for (const c of list) {
    if (!c || typeof c.name !== 'string' || typeof c.quote !== 'string') continue;
    const name = squash(c.name);
    let quote = squash(c.quote);
    if (name.length < 2 || quote.length < 3 || !quoteInText(text, quote) || !quote.toLowerCase().includes(name.toLowerCase())) continue;
    const kind: AssetKind = ASSET_KINDS.includes(c.kind) ? c.kind : 'field';
    const at = lower.indexOf(quote.toLowerCase());
    if (at >= 0) quote = flat.slice(at, at + quote.length);                 // the document's own spelling and case
    // The squashed offset is close enough to the raw one for an anchor label.
    out.push({ name, kind, quote, anchor: at >= 0 ? anchorAt(anchors, at) : null, source: 'model' });
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/**
 * Fields the document names and the project does not yet hold. The dictionary pass runs
 * always; the model pass only with a provider. Merged on name; the dictionary wins because
 * it carries the asset id.
 */
export async function extractAssets(db: Db, text: string, anchors: Anchor[], project: MentionProject, provider: LlmProvider | null): Promise<AssetMention[]> {
  if (!text.trim()) return [];
  const attachedNames = new Set<string>();
  if (project.asset_ids.length) for (const r of (await db.query<{ name: string }>('SELECT name FROM assets WHERE id = ANY($1::text[])', [project.asset_ids])).rows) attachedNames.add(r.name.toLowerCase());
  const attachedIds = new Set(project.asset_ids);
  const byName = new Map<string, AssetMention>();
  for (const m of await dictionaryPass(db, text, anchors, project)) byName.set(m.name.toLowerCase(), m);
  if (provider) for (const m of await modelPass(text, anchors, provider)) if (!byName.has(m.name.toLowerCase())) byName.set(m.name.toLowerCase(), m);
  return [...byName.values()].filter(m => !attachedNames.has(m.name.toLowerCase()) && !(m.asset_id && attachedIds.has(m.asset_id))).slice(0, MAX_MENTIONS);
}

const trimCandidate = (c: Candidate) => ({ name: c.name, kind: c.kind, country: c.country, lat: c.lat, lon: c.lon, source: c.source, source_id: c.source_id, source_url: c.source_url, confidence: c.confidence, asset_id: c.asset_id ?? null, detail: c.detail ?? null });

/**
 * Writes one review-queue row of kind `asset` per mention, with up to three gazetteer
 * candidates, deduplicated on (project, name) while a row is open. Returns the new ids.
 */
export async function proposeAssets(db: Db, item: MentionItem, project: MentionProject, mentions: AssetMention[]): Promise<string[]> {
  const ids: string[] = [];
  for (const m of mentions) {
    const dup = await db.query("SELECT 1 FROM review_queue WHERE kind = 'asset' AND status = 'open' AND payload->>'project_id' = $1 AND lower(payload->>'name') = $2", [project.id, m.name.toLowerCase()]);
    if (dup.rows.length) continue;
    let candidates: ReturnType<typeof trimCandidate>[] = [];
    try { candidates = (await locate(db, m.name, project.country, { limit: 3 })).candidates.map(trimCandidate); } catch { candidates = []; }
    const id = randomUUID();
    await db.query("INSERT INTO review_queue (id, kind, payload) VALUES ($1, 'asset', $2::jsonb)", [id, JSON.stringify({
      project_id: project.id, item_id: item.id, item_version: item.version, item_title: item.title ?? null,
      name: m.name, kind: m.kind, quote: m.quote, anchor: m.anchor, source: m.source, candidates,
      proposal: `Field named in "${item.title ?? item.id}": ${m.name}`,
    })]);
    ids.push(id);
  }
  return ids;
}
