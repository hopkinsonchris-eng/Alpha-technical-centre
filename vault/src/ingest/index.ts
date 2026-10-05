/**
 * ingestItem (M09): original bytes → text → chunks → contexts → embeddings → `chunks` rows.
 *
 * For one (item, version): loads the original from storage, extracts text (OCR for scans when possible),
 * writes derived/<item-id>/text.md, chunks with a contextual prefix, embeds, and inserts chunk rows carrying
 * the item's legal_tag / client_id / project_id / partners_only / expires_at so the gateway can filter inside
 * the query. Older versions' chunks are kept and marked current=false. Legal and finance types also get typed
 * facts with evidence quotes in `items.extracted`, and an NDA's expiry is proposed in the review queue.
 * Idempotent per (item, version) unless `force`.
 *
 * indexRun (wave 7, S31): a run's title, assumptions and outputs become chunks the same way (run_id instead of
 * item_id), so Find sees runs under the same scope predicate; retireRunChunks when a run is superseded.
 */
import type { Db } from '../db/client.ts';
import type { Storage } from '../storage.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { chunkText, contextualise } from './chunk.ts';
import { vectorLiteral, type Embedder } from './embed.ts';
import { extractText, UnsupportedFormat } from './extract.ts';
import { extractLegalFinance, flatten, isLegalFinanceType, proposeNdaExpiry } from './legal-finance.ts';
import { extractAssets, proposeAssets } from './entities.ts';

export interface IngestDeps { provider: LlmProvider | null; embedder: Embedder }
export interface IngestOptions { force?: boolean; now?: () => Date }
export type IngestStatus = 'ok' | 'skipped' | 'unsupported' | 'empty' | 'needs_ocr' | 'no_original';
export interface IngestResult {
  item_id: string; version: number; status: IngestStatus; chunks: number; text_chars: number;
  needs_ocr?: boolean; ocr?: boolean; partners_only?: boolean; nda_expiry_review?: string | null;
  /** wave 3: review-queue proposals opened for fields the document names */
  asset_proposals?: number;
}

const inflight = new Map<string, Promise<IngestResult>>();

export function ingestItem(db: Db, storage: Storage, itemId: string, deps: IngestDeps, opts: IngestOptions = {}): Promise<IngestResult> {
  const running = inflight.get(itemId);
  const next = (running ?? Promise.resolve(null)).catch(() => null).then(() => run(db, storage, itemId, deps, opts));
  inflight.set(itemId, next);
  const clear = () => { if (inflight.get(itemId) === next) inflight.delete(itemId); };
  next.then(clear, clear);
  return next;
}

async function run(db: Db, storage: Storage, itemId: string, deps: IngestDeps, opts: IngestOptions): Promise<IngestResult> {
  const item = (await db.query<any>(
    `SELECT id, type, title, version, storage_key, mime, legal_tag, client_id, project_id, extracted FROM items WHERE id = $1`, [itemId])).rows[0];
  if (!item) throw new Error(`item ${itemId} not found`);
  const version: number = item.version;
  const existing: any = item.extracted ?? {};
  const base = { item_id: item.id as string, version };

  const have = Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1 AND item_version = $2', [item.id, version])).rows[0].n);
  if (!opts.force && (have > 0 || (existing.ingest?.version === version && existing.ingest?.status !== 'no_original'))) {
    await db.query('UPDATE chunks SET current = false WHERE item_id = $1 AND item_version < $2 AND current', [item.id, version]);
    return { ...base, status: 'skipped', chunks: have, text_chars: Number(existing.text_chars ?? 0) };
  }
  if (!item.storage_key) return { ...base, status: 'no_original', chunks: 0, text_chars: 0 };
  const bytes = await storage.get(item.storage_key);
  if (!bytes) return { ...base, status: 'no_original', chunks: 0, text_chars: 0 };

  const mark = async (status: IngestStatus, patch: Record<string, unknown> = {}) => {
    const at = (opts.now?.() ?? new Date()).toISOString();
    await db.query(`UPDATE items SET extracted = extracted || $2::jsonb WHERE id = $1`, [item.id, JSON.stringify({ ...patch, ingest: { version, status, at } })]);
  };

  let ex;
  try { ex = await extractText(bytes, item.mime ?? '', existing.filename ?? item.title ?? ''); }
  catch (e) {
    if (e instanceof UnsupportedFormat) { await mark('unsupported', { text_chars: 0, chunks: 0 }); return { ...base, status: 'unsupported', chunks: 0, text_chars: 0 }; }
    throw e;
  }
  const textChars = ex.text.trim().length;
  if (!textChars) {
    const status: IngestStatus = ex.needs_ocr ? 'needs_ocr' : 'empty';
    await mark(status, { text_chars: 0, chunks: 0, format: ex.format, ...(ex.pages ? { pages: ex.pages } : {}), ...(ex.needs_ocr ? { needs_ocr: true } : {}) });
    return { ...base, status, chunks: 0, text_chars: 0, ...(ex.needs_ocr ? { needs_ocr: true } : {}) };
  }

  await storage.put(`derived/${item.id}/text.md`, new TextEncoder().encode(ex.text), 'text/markdown');

  const raw = chunkText(ex.text, ex.anchors);
  const chunks = await contextualise(raw, { title: item.title || ex.title || 'Untitled', type: item.type, text: ex.text }, deps.provider);
  const vectors = chunks.length ? await deps.embedder.embed(chunks.map(c => `${c.context}\n\n${c.text}`), 'document') : [];
  if (vectors.length !== chunks.length) throw new Error(`embedder returned ${vectors.length} vectors for ${chunks.length} chunks`);

  const tag = (await db.query<{ expires_at: string | null; partners_only: boolean }>(`SELECT to_char(expires_at,'YYYY-MM-DD') AS expires_at, partners_only FROM legal_tags WHERE id = $1`, [item.legal_tag])).rows[0];
  const patch: Record<string, unknown> = { text_chars: textChars, chunks: chunks.length, format: ex.format, anchors: ex.anchors.length };
  if (ex.pages) patch.pages = ex.pages;
  if (ex.needs_ocr) patch.needs_ocr = true;
  if (ex.ocr) patch.ocr = true;
  let lf = null;
  if (isLegalFinanceType(item.type)) {
    lf = await extractLegalFinance(ex.text, item.type, { provider: deps.provider });
    for (const [k, v] of Object.entries(flatten(lf))) if (k === 'legal_finance' || k === 'partners_only' || existing[k] === undefined) patch[k] = v;
  }
  // Recorded on the item; a partners-only variant of the legal tag is not created here (no legal-tag helper for variants).
  const partnersOnly = !!tag?.partners_only || patch.partners_only === true || existing.partners_only === true;
  if (partnersOnly) patch.partners_only = true;

  if (have > 0) await db.query('DELETE FROM chunks WHERE item_id = $1 AND item_version = $2', [item.id, version]); // forced re-index of derived rows only
  const BATCH = 20;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const rows = chunks.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = rows.map((c, j) => {
      const k = params.length;
      params.push(item.id, version, c.ordinal, c.anchor, c.context, c.text, item.legal_tag, item.client_id ?? null, item.project_id, partnersOnly, tag?.expires_at ?? null, vectorLiteral(vectors[i + j]));
      return `($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5},$${k + 6},$${k + 7},$${k + 8},$${k + 9},$${k + 10},$${k + 11}::date,true,$${k + 12}::vector)`;
    });
    await db.query(
      `INSERT INTO chunks (item_id, item_version, ordinal, anchor, context, text, legal_tag, client_id, project_id, partners_only, expires_at, current, embedding) VALUES ${values.join(',')}`, params);
  }
  await db.query('UPDATE chunks SET current = false WHERE item_id = $1 AND item_version < $2 AND current', [item.id, version]);
  // A scan that could not be OCRed here is indexed on whatever residual text it has, but stays
  // marked needs_ocr so the sync job retries it once language data is available.
  const finalStatus: IngestStatus = ex.needs_ocr ? 'needs_ocr' : 'ok';
  await mark(finalStatus, patch);

  let review: string | null = null;
  if (lf) review = await proposeNdaExpiry(db, { id: item.id, version, client_id: item.client_id ?? null, project_id: item.project_id, legal_tag: item.legal_tag, title: item.title }, lf);
  // Wave 3: fields the document names become proposals in the review queue (never attachments).
  let assetProposals = 0;
  if (item.project_id) {
    try {
      const project = (await db.query<any>('SELECT id, country, asset_ids FROM projects WHERE id = $1', [item.project_id])).rows[0];
      if (project) {
        const mentions = await extractAssets(db, ex.text, ex.anchors, { id: project.id, country: project.country ?? null, asset_ids: project.asset_ids ?? [] }, deps.provider);
        assetProposals = (await proposeAssets(db, { id: item.id, version, title: item.title ?? null, project_id: item.project_id }, { id: project.id, country: project.country ?? null, asset_ids: project.asset_ids ?? [] }, mentions)).length;
      }
    } catch { /* proposals are best effort; the document is indexed either way */ }
  }
  return { ...base, status: finalStatus, chunks: chunks.length, text_chars: textChars, ...(ex.needs_ocr ? { needs_ocr: true } : {}), ...(ex.ocr ? { ocr: true } : {}), ...(partnersOnly ? { partners_only: true } : {}), ...(review ? { nda_expiry_review: review } : {}), asset_proposals: assetProposals };
}

/* ── runs (wave 7, S31) ──────────────────────────────────────────────── */

export interface RunIndexResult { run_id: string; status: 'ok' | 'skipped' | 'not_found' | 'empty'; chunks: number }

const label = (k: string) => k.replace(/[_-]+/g, ' ').trim();
const num = (v: unknown) => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** The text Find sees for a run: its title, then each assumption and each output with unit, range and source. */
export function runText(run: { title?: string | null; job: string; tool_version: string; record: any }): string {
  const rec = run.record ?? {};
  const lines: string[] = [run.title || rec.title || `${run.job} ${run.tool_version}`];
  const assumptions = Object.entries(rec.assumptions ?? {});
  if (assumptions.length) {
    lines.push('', 'Assumptions:');
    for (const [k, a] of assumptions as [string, any][]) lines.push(`${label(k)}: ${num(a?.value)}${a?.unit ? ' ' + a.unit : ''}${a?.source ? ` (source: ${a.source})` : ''}`);
  }
  const outputs = Object.entries(rec.outputs ?? {});
  if (outputs.length) {
    lines.push('', 'Outputs:');
    for (const [k, o] of outputs as [string, any][]) lines.push(`${label(k)}: ${num(o?.value)}${o?.unit ? ' ' + o.unit : ''}${o?.low != null || o?.high != null ? ` (range ${num(o?.low)} to ${num(o?.high)})` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Chunks one run (title, assumptions, outputs) into `chunks` rows carrying the run's legal_tag / client_id / project_id
 * and the tag's partners_only / expires_at, so the gateway filters them inside the query exactly as a document's.
 * Idempotent per run unless `force`; a hidden or superseded run is never indexed (its chunks, if any, are retired).
 */
export async function indexRun(db: Db, runId: string, embedder: Embedder, opts: { force?: boolean } = {}): Promise<RunIndexResult> {
  const run = (await db.query<any>('SELECT id, job, tool_version, title, status, hidden, legal_tag, client_id, project_id, record FROM runs WHERE id = $1', [runId])).rows[0];
  if (!run) return { run_id: runId, status: 'not_found', chunks: 0 };
  const have = Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM chunks WHERE run_id = $1', [run.id])).rows[0].n);
  if (run.hidden || run.status === 'superseded') { if (have) await retireRunChunks(db, run.id); return { run_id: run.id, status: 'skipped', chunks: 0 }; }
  if (have && !opts.force) return { run_id: run.id, status: 'skipped', chunks: have };
  const raw = chunkText(runText(run), []);
  if (!raw.length) return { run_id: run.id, status: 'empty', chunks: 0 };
  const context = `Run "${run.title || run.job}" (${run.job} ${run.tool_version}, ${run.status})`;
  const chunks = raw.map(c => ({ ...c, context }));
  const vectors = await embedder.embed(chunks.map(c => `${c.context}\n\n${c.text}`), 'document');
  if (vectors.length !== chunks.length) throw new Error(`embedder returned ${vectors.length} vectors for ${chunks.length} chunks`);
  const tag = (await db.query<{ expires_at: string | null; partners_only: boolean }>(`SELECT to_char(expires_at,'YYYY-MM-DD') AS expires_at, partners_only FROM legal_tags WHERE id = $1`, [run.legal_tag])).rows[0];
  if (have) await db.query('DELETE FROM chunks WHERE run_id = $1', [run.id]);   // forced re-index of derived rows only
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    await db.query(
      `INSERT INTO chunks (item_id, run_id, item_version, ordinal, anchor, context, text, legal_tag, client_id, project_id, partners_only, expires_at, current, embedding)
       VALUES (NULL, $1, NULL, $2, NULL, $3, $4, $5, $6, $7, $8, $9::date, true, $10::vector)`,
      [run.id, c.ordinal, c.context, c.text, run.legal_tag, run.client_id ?? null, run.project_id, !!tag?.partners_only, tag?.expires_at ?? null, vectorLiteral(vectors[i])]);
  }
  return { run_id: run.id, status: 'ok', chunks: chunks.length };
}

/** A superseded (or hidden) run leaves Find: its chunks stop being current. The rows stay (nothing derived is deleted either). */
export async function retireRunChunks(db: Db, runId: string): Promise<void> {
  await db.query('UPDATE chunks SET current = false WHERE run_id = $1 AND current', [runId]);
}

/** Runs saved before runs were indexed: every visible, non-superseded run without chunks, oldest first. */
export async function indexPendingRuns(db: Db, embedder: Embedder, opts: { limit?: number } = {}): Promise<{ indexed: number; run_ids: string[] }> {
  const rows = (await db.query<{ id: string }>(
    `SELECT r.id::text AS id FROM runs r WHERE NOT r.hidden AND r.status <> 'superseded' AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.run_id = r.id)
      ORDER BY r.created_at, r.id LIMIT $1`, [Math.max(1, Math.min(opts.limit ?? 200, 1000))])).rows;
  const run_ids: string[] = [];
  for (const r of rows) if ((await indexRun(db, r.id, embedder)).status === 'ok') run_ids.push(r.id);
  return { indexed: run_ids.length, run_ids };
}
