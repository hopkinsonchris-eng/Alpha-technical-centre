/**
 * The embedding cap (28 Nov 2026, approved by the owner).
 *
 * Read live on 27 Nov: 943,264 chunks, 922,432 of them from 197 Parker Creek spreadsheets (daily workover and
 * completion reports, up to 25,042 slices each), 5.3 GB of embeddings, and a meaning-based search that had to read all
 * of it. A large spreadsheet or CSV now keeps every slice for word search (the row and its tsv stay) but only its first
 * EMBED_CAP.keep slices carry an embedding. Nothing is deleted: no item, no original, no text, no chunk row.
 *
 * What stops being findable: a meaning-based match inside the later slices of such a file. A word match still finds
 * every row.
 *
 *  - embedLimit(): how many of a new file's chunks the indexer embeds (ingest/index.ts).
 *  - capEmbeddings(): clears the embeddings beyond the cap on files indexed before this, in small statements and
 *    inside a time budget, so it never holds a long lock and never runs at service start-up; the ingest job calls it
 *    each run until nothing is left, then builds the partial index the vector statement uses. Idempotent.
 *
 * The way back for a file: a forced re-index with a higher cap, which re-embeds it (Voyage spend).
 */
import type { Db } from '../db/client.ts';

export const EMBED_CAP = { formats: ['xlsx', 'csv'], over: 100, keep: 40 };
export const EMBEDDED_INDEX = 'chunks_embedded_idx';

/** How many of a file's chunks (from the first) get an embedding. */
export function embedLimit(format: string, chunks: number, cap = EMBED_CAP): number {
  return cap.formats.includes(format) && chunks > cap.over ? cap.keep : chunks;
}

export interface CapSummary { files: number; cleared: number; left_files: number; index: 'present' | 'built' | 'waiting' | 'failed'; ms: number; error?: string }
export interface CapOptions { budgetMs?: number; batchRows?: number; cap?: typeof EMBED_CAP; now?: () => number }

/** Files over the cap that have not been capped yet: read from items alone, so it does not scan chunks. */
const CANDIDATES = `
  SELECT i.id::text AS id, (i.extracted->>'chunks')::int AS chunks FROM items i
   WHERE i.extracted->>'format' = ANY($1::text[]) AND (i.extracted->>'chunks') ~ '^[0-9]+$' AND (i.extracted->>'chunks')::int > $2
     AND i.extracted->'embed_cap' IS NULL
   ORDER BY (i.extracted->>'chunks')::int DESC`;

export async function capEmbeddings(db: Db, opts: CapOptions = {}): Promise<CapSummary> {
  const cap = opts.cap ?? EMBED_CAP, budget = opts.budgetMs ?? 300_000, step = opts.batchRows ?? 2000, clock = opts.now ?? Date.now;
  const t0 = clock();
  const out: CapSummary = { files: 0, cleared: 0, left_files: 0, index: 'waiting', ms: 0 };
  const spent = () => clock() - t0 >= budget;
  try {
    const todo = (await db.query<{ id: string; chunks: number }>(CANDIDATES, [cap.formats, cap.over])).rows;
    out.left_files = todo.length;
    for (const f of todo) {
      if (spent()) break;
      // The true extent: a file re-read since may hold more or fewer slices than the count on the item.
      const max = Number((await db.query<any>('SELECT coalesce(max(ordinal), -1) AS m FROM chunks WHERE item_id = $1::uuid', [f.id])).rows[0].m);
      let cleared = 0, done = true;
      for (let lo = cap.keep; lo <= max; lo += step) {
        if (spent()) { done = false; break; }
        // One short statement per window of slices, found through chunks_item_idx: no long lock, no table scan.
        const r = await db.query<any>(
          `WITH u AS (UPDATE chunks SET embedding = NULL WHERE item_id = $1::uuid AND ordinal >= $2 AND ordinal < $3 AND embedding IS NOT NULL RETURNING 1)
           SELECT count(*)::int AS n FROM u`, [f.id, lo, lo + step]);
        cleared += r.rows[0].n;
      }
      out.cleared += cleared;
      if (!done) break;                                                    // the rest of this file waits for the next run; its cleared windows are skipped then
      await db.query(`UPDATE items SET extracted = extracted || jsonb_build_object('embed_cap', jsonb_build_object('keep', $2::int, 'at', now())) WHERE id = $1::uuid`, [f.id, cap.keep]);
      out.files++; out.left_files--;
    }
    if (out.left_files === 0) out.index = await ensureEmbeddedIndex(db);
  } catch (e) { out.error = String((e as Error)?.message ?? e).slice(0, 200); if (out.left_files === 0) out.index = 'failed'; }
  out.ms = clock() - t0;
  return out;
}

/**
 * The index the vector statement finds embedded chunks through, once few chunks carry one. Built CONCURRENTLY on
 * Postgres (no write lock on chunks); a build that was cut short leaves an invalid index, which is dropped and rebuilt.
 */
export async function ensureEmbeddedIndex(db: Db): Promise<CapSummary['index']> {
  const st = (await db.query<any>(`SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`, [EMBEDDED_INDEX])).rows[0];
  if (st?.valid) return 'present';
  const conc = db.backend === 'pg' ? 'CONCURRENTLY ' : '';
  if (st) await db.exec(`DROP INDEX ${conc}IF EXISTS ${EMBEDDED_INDEX}`);
  await db.exec(`CREATE INDEX ${conc}IF NOT EXISTS ${EMBEDDED_INDEX} ON chunks (legal_tag, project_id) WHERE embedding IS NOT NULL`);
  return 'built';
}
