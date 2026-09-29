/**
 * Paper facts (M11, Tier B). For papers whose stored abstract has at least 400
 * characters, ask the LLM provider for analogue-row properties and a
 * `paper_facts` block, and write validated rows to `analogue_rows`
 * (provenance 'paper', source_ref doc:<id>).
 *
 * The model is not trusted. Every numeric property must arrive with an evidence
 * quote that really occurs in the abstract; a number without a verifiable quote
 * is dropped, enum values outside the schema are dropped, and the assembled row
 * must pass analogue-row.schema.json or the paper yields no row. Only the
 * abstract is ever sent: metadata and abstracts, never full text.
 *
 * The provider interface has no batch call, so papers go through in small
 * concurrent groups; swap in the Batch API behind the same interface later.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { validate, validator } from '../schemas.ts';
import { openStorage, type Storage } from '../storage.ts';
import { audit } from '../audit.ts';
import { normaliseTitle } from './run.ts';

export const MIN_ABSTRACT_CHARS = 400;

/* ── what the schema allows, read from the schema so it cannot drift ── */

const schemaProps = (): Record<string, any> => (validator('analogue-row').schema as any).properties;
export const numericProperties = (): string[] => Object.entries(schemaProps()).filter(([, v]) => v.$ref === '#/$defs/num').map(([k]) => k);
const enumProperties = (): Record<string, string[]> => Object.fromEntries(Object.entries(schemaProps()).filter(([, v]) => Array.isArray(v.enum)).map(([k, v]) => [k, v.enum]));
const METHODS = (): string[] => schemaProps().method.items.enum;
const FREE_TEXT = ['play_type', 'depositional_setting', 'trap_type', 'operator', 'notes'] as const;
const NUM_PROVENANCE = ['measured', 'reported', 'analogue', 'assumed', 'calculated'];

export const SYSTEM_PROMPT = () => `You extract structured facts from the abstract of one petroleum-engineering or geoscience paper.
Reply with one JSON object and nothing else. Use only what the abstract states; never infer, convert from memory or fill gaps.
{
  "asset_name": string|null,          // field, reservoir or pilot the paper is about
  "basin_name": string|null,
  "country": string|null,             // ISO 3166-1 alpha-2, upper case
  "categorical": {                    // omit keys the abstract does not support
    ${Object.entries(enumProperties()).map(([k, v]) => `"${k}": one of ${v.join(' | ')}`).join(',\n    ')},
    "method": array of ${METHODS().join(' | ')},
    ${FREE_TEXT.map(k => `"${k}": string`).join(', ')}
  },
  "numeric": [                        // one entry per number the abstract states for a property below
    { "property": ${numericProperties().join(' | ')},
      "value": number, "low": number?, "high": number?,
      "provenance": ${NUM_PROVENANCE.join(' | ')},
      "quote": "exact words copied from the abstract that state the number",
      "location": "abstract" }
  ],
  "paper_facts": {
    "study_type": string,             // e.g. field pilot, core flood, simulation, review
    "summary": string,                // one or two sentences
    "findings": [ { "statement": string, "quote": "exact words from the abstract" } ]
  }
}
Units are fixed by the property name (_frac is a fraction 0..1, _md millidarcy, _cp centipoise, _m metres, _c degrees Celsius, _mmbbl million barrels, _psi psi, _usd_mm million USD). Convert only when the abstract gives the unit explicitly, and quote the original words.`;

/* ── quote checking ─────────────────────────────────────────────────── */

const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
/** The quote occurs in the text (whitespace and quote-mark insensitive). `needDigit` is set for numeric evidence: a number needs words that contain one. */
export const quoteInText = (quote: unknown, text: string, needDigit = false): boolean =>
  typeof quote === 'string' && squash(quote).length >= 4 && (!needDigit || /\d/.test(quote)) && squash(text).includes(squash(quote));

/* ── assembling a row ───────────────────────────────────────────────── */

export interface ExtractContext {
  docId: string;
  legalTag: string;
  abstract: string;
  authoredAt: string | null;
  now: Date;
  extractedBy: string;
  /** Resolves a name from the paper to a master-data id, when one matches. */
  resolveAsset?: (name: string, kind: 'field' | 'basin') => string | undefined;
}
export interface Assembled { row: Record<string, any>; paper_facts: Record<string, any>; dropped: { property: string; reason: string }[] }

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function assembleRow(llm: any, c: ExtractContext): Assembled {
  if (!llm || typeof llm !== 'object' || Array.isArray(llm)) throw new Error('model output is not a JSON object');
  const dropped: Assembled['dropped'] = [];
  const row: Record<string, any> = {
    id: randomUUID(), source_ref: `doc:${c.docId}`, asset_id: '', as_of: (c.authoredAt ?? c.now.toISOString()).slice(0, 10), legal_tag: c.legalTag, provenance: 'paper', extracted_by: c.extractedBy,
  };
  const assetName = typeof llm.asset_name === 'string' ? llm.asset_name.trim() : '';
  row.asset_id = (assetName && c.resolveAsset?.(assetName, 'field')) || `paper:${c.docId}`;
  const basinName = typeof llm.basin_name === 'string' ? llm.basin_name.trim() : '';
  const basin = basinName && c.resolveAsset?.(basinName, 'basin');
  if (basin) row.basin_id = basin;
  if (typeof llm.country === 'string' && /^[A-Z]{2}$/.test(llm.country)) row.country = llm.country;

  const cat = llm.categorical && typeof llm.categorical === 'object' ? llm.categorical : {};
  for (const [k, allowed] of Object.entries(enumProperties())) {
    if (cat[k] === undefined) continue;
    if (allowed.includes(cat[k])) row[k] = cat[k]; else dropped.push({ property: k, reason: `"${cat[k]}" is not an allowed value` });
  }
  if (Array.isArray(cat.method)) { const m = cat.method.filter((x: unknown) => typeof x === 'string' && METHODS().includes(x)); if (m.length) row.method = [...new Set(m)]; }
  for (const k of FREE_TEXT) if (typeof cat[k] === 'string' && cat[k].trim()) row[k] = cat[k].trim().slice(0, 300);

  const evidence: { property: string; quote: string; location?: string }[] = [];
  const allowedNumeric = new Set(numericProperties());
  for (const n of Array.isArray(llm.numeric) ? llm.numeric : []) {
    const prop = n?.property;
    if (typeof prop !== 'string' || !allowedNumeric.has(prop)) { dropped.push({ property: String(prop), reason: 'not an analogue-row numeric property' }); continue; }
    if (!isNum(n.value)) { dropped.push({ property: prop, reason: 'value is not a number' }); continue; }
    if (!quoteInText(n.quote, c.abstract, true)) { dropped.push({ property: prop, reason: 'evidence quote missing or not found in the abstract' }); continue; }
    if (row[prop]) { dropped.push({ property: prop, reason: 'duplicate property' }); continue; }
    const v: Record<string, unknown> = { value: n.value, provenance: NUM_PROVENANCE.includes(n.provenance) ? n.provenance : 'reported' };
    if (isNum(n.low) && n.low <= n.value) v.low = n.low;
    if (isNum(n.high) && n.high >= n.value) v.high = n.high;
    row[prop] = v;
    evidence.push({ property: prop, quote: String(n.quote).trim(), location: typeof n.location === 'string' ? n.location : 'abstract' });
  }
  if (evidence.length) row.evidence = evidence;

  const pf = llm.paper_facts && typeof llm.paper_facts === 'object' ? llm.paper_facts : {};
  const findings = (Array.isArray(pf.findings) ? pf.findings : []).filter((f: any) => typeof f?.statement === 'string' && quoteInText(f.quote, c.abstract))
    .map((f: any) => ({ statement: f.statement.trim(), quote: String(f.quote).trim() }));
  const paper_facts = {
    extracted_at: c.now.toISOString(), extracted_by: c.extractedBy, min_abstract_chars: MIN_ABSTRACT_CHARS,
    ...(typeof pf.study_type === 'string' ? { study_type: pf.study_type.trim() } : {}),
    ...(typeof pf.summary === 'string' ? { summary: pf.summary.trim() } : {}),
    findings, evidence, dropped,
  };
  return { row, paper_facts, dropped };
}

export function parseModelJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('model output has no JSON object');
  return JSON.parse(t.slice(a, b + 1));
}

/* ── the job ────────────────────────────────────────────────────────── */

export interface PaperFactsSummary { considered: number; skipped_short: number; extracted: number; rows: number; dropped_properties: number; failed: { item_id: string; reason: string }[] }
export interface PaperFactsOptions { provider: LlmProvider; storage?: Storage; now?: Date; limit?: number; concurrency?: number }

export async function extractPaperFacts(db: Db, opts: PaperFactsOptions): Promise<PaperFactsSummary> {
  const now = opts.now ?? new Date();
  const storage = opts.storage ?? openStorage();
  const extractedBy = `${opts.provider.name}:${opts.provider.model}`;
  const summary: PaperFactsSummary = { considered: 0, skipped_short: 0, extracted: 0, rows: 0, dropped_properties: 0, failed: [] };

  const candidates = (await db.query<any>(
    `SELECT id, title, authored_at, legal_tag, storage_key, coalesce((extracted->>'abstract_chars')::int, 0) AS chars FROM items
      WHERE type = 'paper' AND NOT hidden AND NOT (extracted ? 'paper_facts') AND storage_key IS NOT NULL AND mime = 'application/json'
        AND (extracted ? 'abstract_chars') ORDER BY created_at, id`)).rows;
  const assets = (await db.query<{ id: string; kind: string; name: string }>(`SELECT id, kind, name FROM assets WHERE kind IN ('field','reservoir','basin')`)).rows;
  const byName = new Map<string, { id: string; kind: string }>(); for (const a of assets) byName.set(`${a.kind === 'basin' ? 'basin' : 'field'}:${normaliseTitle(a.name)}`, a);
  const resolveAsset = (name: string, kind: 'field' | 'basin') => byName.get(`${kind}:${normaliseTitle(name)}`)?.id;

  const todo: any[] = [];
  for (const it of candidates) {
    if (it.chars < MIN_ABSTRACT_CHARS) { summary.skipped_short++; continue; }
    if (opts.limit && todo.length >= opts.limit) break;
    todo.push(it);
  }
  summary.considered = todo.length;

  const one = async (it: any) => {
    try {
      const bytes = await storage.get(it.storage_key);
      const abstract: string = bytes ? JSON.parse(Buffer.from(bytes).toString('utf8')).abstract ?? '' : '';
      if (abstract.length < MIN_ABSTRACT_CHARS) { summary.skipped_short++; summary.considered--; return; }
      const res = await opts.provider.complete({
        system: SYSTEM_PROMPT(), maxTokens: 2000, temperature: 0,
        messages: [{ role: 'user', content: `PAPER_ID: ${it.id}\nTITLE: ${it.title}\nPUBLISHED: ${it.authored_at ? new Date(it.authored_at).toISOString().slice(0, 10) : 'unknown'}\nABSTRACT:\n${abstract}` }],
      });
      const a = assembleRow(parseModelJson(res.text), { docId: it.id, legalTag: it.legal_tag, abstract, authoredAt: it.authored_at ? new Date(it.authored_at).toISOString() : null, now, extractedBy, resolveAsset });
      summary.dropped_properties += a.dropped.length;
      const hasContent = Object.keys(a.row).some(k => !['id', 'source_ref', 'asset_id', 'as_of', 'legal_tag', 'provenance', 'extracted_by'].includes(k));
      let rowId: string | null = null;
      if (hasContent) {
        const errs = validate('analogue-row', a.row);
        if (errs.length) throw new Error(`row does not validate: ${errs.map(e => `${e.path} ${e.message}`).join('; ')}`);
        const dup = (await db.query('SELECT 1 FROM analogue_rows WHERE source_ref = $1 AND provenance = $2', [a.row.source_ref, 'paper'])).rows.length;
        if (!dup) {
          await db.query('INSERT INTO analogue_rows (id, source_ref, asset_id, legal_tag, provenance, as_of, row) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
            [a.row.id, a.row.source_ref, a.row.asset_id, a.row.legal_tag, a.row.provenance, a.row.as_of, JSON.stringify(a.row)]);
          rowId = a.row.id; summary.rows++;
        }
      }
      // Derived facts live in `extracted`; the original bytes and content hash are untouched, so the item version does not change.
      await db.query(`UPDATE items SET extracted = extracted || $2::jsonb WHERE id = $1`, [it.id, JSON.stringify({ paper_facts: { ...a.paper_facts, row_id: rowId } })]);
      await audit(db, 'miners', 'paper_facts.extract', 'firm', [`doc:${it.id}`], { rows: rowId ? 1 : 0, dropped: a.dropped.length, tokens_in: res.usage.input, tokens_out: res.usage.output, model: res.model });
      summary.extracted++;
    } catch (e) {
      summary.failed.push({ item_id: it.id, reason: (e as Error).message });
    }
  };
  const width = Math.max(1, opts.concurrency ?? 4);
  for (let i = 0; i < todo.length; i += width) await Promise.all(todo.slice(i, i + width).map(one));
  return summary;
}
