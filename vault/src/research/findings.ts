/**
 * Filing what a research run found (wave 4, docs/vault-hub/wave4/05-markup.md §1.4.4–5).
 * A finding is an ordinary public note under the project: source, URL, date, the query that
 * found it and a verbatim excerpt, deduplicated on (project, source, external id) so a re-run
 * updates rather than duplicates. Proposals: the wave 3 field pass (`extractAssets`) for
 * fields not yet attached, and, with a provider, one low-effort read per finding for the
 * operator, licence and production figure it states, each kept only with a verbatim quote.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { LlmProvider, LlmUsage } from '../llm/provider.ts';
import { extractAssets, proposeAssets } from '../ingest/entities.ts';
import { quoteInText } from '../ingest/legal-finance.ts';

export interface Finding {
  source: string;                 // 'gdelt' | 'company-signals' | 'company-enrichment' | 'sec-filings' | 'intel-timeline'
  external_id: string;
  url: string | null;
  title: string;
  text: string;                   // the excerpt or description the source gave; the quote is drawn from it
  published_at: string | null;
  authors: string[];
  query: string;
  asset_ids: string[];
  facts?: Record<string, unknown>;
}
export interface FiledFinding { id: string; status: 'created' | 'updated' | 'unchanged' }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const sha = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

/** Files one finding; the same (project, source, external id) is updated when its content changed and left alone otherwise. */
export async function fileFinding(db: Db, projectId: string, f: Finding, by: string, now: Date): Promise<FiledFinding> {
  const quote = squash(f.text).slice(0, 600);
  const extracted = { kind: 'research', source: f.source, query: f.query, quote, published_at: f.published_at, url: f.url, authors: f.authors, ...(f.facts ?? {}) };
  const hash = sha(JSON.stringify({ title: f.title, quote, facts: f.facts ?? null }));
  const existing = (await db.query<any>("SELECT id, version, content_hash FROM items WHERE project_id = $1 AND origin->>'source' = 'research' AND external_id = $2 AND NOT hidden", [projectId, f.external_id])).rows[0];
  if (existing && existing.content_hash === hash) return { id: existing.id, status: 'unchanged' };
  const origin = { source: 'research', adapter: f.source, external_id: f.external_id, url: f.url, fetched_at: now.toISOString(), query: f.query };
  if (existing) {
    await db.query('UPDATE items SET title = $2, extracted = $3::jsonb, origin = $4::jsonb, content_hash = $5, version = version + 1, authored_at = coalesce($6, authored_at), asset_ids = $7::text[] WHERE id = $1',
      [existing.id, f.title, JSON.stringify(extracted), JSON.stringify(origin), hash, f.published_at, f.asset_ids]);
    return { id: existing.id, status: 'updated' };
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO items (id, type, title, created_at, authored_at, authors, client_id, project_id, asset_ids, legal_tag, origin, external_id, content_hash, version, extracted, tags)
     VALUES ($1,'note',$2,$3,$4,$5::text[],NULL,$6,$7::text[],'lt-public',$8::jsonb,$9,$10,1,$11::jsonb,$12::text[])`,
    [id, f.title, now.toISOString(), f.published_at, [by, ...f.authors.slice(0, 5)], projectId, f.asset_ids, JSON.stringify(origin), f.external_id, hash, JSON.stringify(extracted), ['research', f.source]]);
  return { id, status: 'created' };
}

/* ── proposals ───────────────────────────────────────────────────────── */

export interface ResearchFact { kind: 'operator' | 'licence' | 'production'; value: string; quote: string; unit?: string | null; year?: number | null; asset_name?: string | null }

const SYSTEM = [
  'You read one short news or filing excerpt about an oil and gas field or company and report the facts it states. Reply with one JSON object and nothing else.',
  'Shape: {"facts":[{"kind":"operator|licence|production","value":"<the fact as written>","quote":"<one exact, verbatim sentence from the excerpt that states it>","unit":"<bopd|boe/d|bbl/d|mcf/d|null>","year":<number or null>,"asset_name":"<the field or block the fact is about, or null>"}]}.',
  'operator: who operates the field or block. licence: a licence, block award, contract or concession named. production: a production rate with its unit. Omit anything you cannot quote verbatim. Never guess.',
].join('\n');

function parseJsonObject(s: string): any {
  const body = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

/** The facts a finding states, each with a verbatim quote; an invented quote drops the fact. Returns the provider's usage for the budget. */
export async function readFacts(text: string, provider: LlmProvider): Promise<{ facts: ResearchFact[]; usage: LlmUsage; model: string }> {
  const r = await provider.complete({ system: SYSTEM, messages: [{ role: 'user', content: text.slice(0, 6000) }], maxTokens: 600, effort: 'low' });
  const raw = parseJsonObject(r.text);
  const list: any[] = Array.isArray(raw?.facts) ? raw.facts : [];
  const facts: ResearchFact[] = [];
  for (const f of list) {
    if (!f || !['operator', 'licence', 'production'].includes(f.kind) || typeof f.value !== 'string' || typeof f.quote !== 'string') continue;
    const value = squash(f.value), quote = squash(f.quote);
    if (value.length < 2 || quote.length < 3 || !quoteInText(text, quote)) continue;
    facts.push({ kind: f.kind, value, quote, unit: typeof f.unit === 'string' ? f.unit : null, year: typeof f.year === 'number' ? f.year : null, asset_name: typeof f.asset_name === 'string' ? f.asset_name : null });
  }
  return { facts, usage: r.usage, model: r.model };
}

export interface ProposalProject { id: string; country: string | null; asset_ids: string[] }

/**
 * Opens proposals for a filed finding: `asset` rows for fields it names (wave 3), `research`
 * rows for the operator, licence and production facts given. Deduplicated while open on
 * (project, kind, value). Returns the ids opened.
 */
export async function proposeFromFinding(db: Db, project: ProposalProject, item: { id: string; title: string }, text: string, facts: ResearchFact[]): Promise<{ asset: string[]; research: string[] }> {
  const mentions = await extractAssets(db, text, [], project, null);
  const asset = await proposeAssets(db, { id: item.id, version: 1, title: item.title, project_id: project.id }, project, mentions);
  const research: string[] = [];
  const fieldByName = new Map<string, string>();
  if (project.asset_ids.length) for (const r of (await db.query<{ id: string; name: string }>('SELECT id, name FROM assets WHERE id = ANY($1::text[])', [project.asset_ids])).rows) fieldByName.set(r.name.toLowerCase(), r.id);
  for (const f of facts) {
    const dup = await db.query("SELECT 1 FROM review_queue WHERE kind = 'research' AND status = 'open' AND payload->>'project_id' = $1 AND payload->>'fact_kind' = $2 AND lower(payload->>'value') = $3", [project.id, f.kind, f.value.toLowerCase()]);
    if (dup.rows.length) continue;
    const assetId = f.asset_name ? fieldByName.get(f.asset_name.toLowerCase()) ?? null : (project.asset_ids.length === 1 ? project.asset_ids[0] : null);
    const id = randomUUID();
    await db.query("INSERT INTO review_queue (id, kind, payload) VALUES ($1, 'research', $2::jsonb)", [id, JSON.stringify({
      project_id: project.id, item_id: item.id, item_title: item.title, fact_kind: f.kind, value: f.value, unit: f.unit ?? null, year: f.year ?? null, quote: f.quote, asset_id: assetId, asset_name: f.asset_name ?? null,
      proposal: f.kind === 'operator' ? `Operator: ${f.value}` : f.kind === 'licence' ? `Licence: ${f.value}` : `Production: ${f.value}${f.unit ? ' ' + f.unit : ''}${f.year ? ' (' + f.year + ')' : ''}`,
    })]);
    research.push(id);
  }
  return { asset, research };
}

/** Converts an accepted production fact to kboe/d when its unit allows; null when it does not. */
export function toKboed(value: string, unit: string | null | undefined): number | null {
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (unit ?? '').toLowerCase();
  if (/kboe?\/?d|kbopd|kb\/d/.test(u)) return n;
  if (/\b(bopd|bbl\/d|boe\/d|b\/d|barrels)/.test(u)) return Math.round(n) / 1000;
  return null;
}
