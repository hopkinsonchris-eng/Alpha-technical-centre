/**
 * Scheduled ingest (M09): pull new and changed files from Zoho WorkDrive and Zoho Books (each only when
 * configured), then ingest every item that has no current chunks for its version, including the uploads
 * the API queued because they were 5 MB or larger. Run: `tsx src/jobs/ingest-sync.ts` (Render cron).
 * Every run is one row in `jobs`.
 */
import { pathToFileURL } from 'node:url';
import { BudgetExceeded, processSpendGbp } from '../llm/spend-guard.ts';
import type { Db } from '../db/client.ts';
import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { openStorage, type Storage } from '../storage.ts';
import { ingestProviderFor, openProvider } from '../llm/provider.ts';
import { openEmbedder } from '../ingest/embed.ts';
import { ingestItem, type IngestDeps } from '../ingest/index.ts';
import { serviceSink, type ItemSink } from '../ingest/items-client.ts';
import { syncWorkdrive, workdriveConfig, type SyncStats, type WorkdriveOptions } from '../ingest/workdrive.ts';
import { booksConfig, syncBooks, type BooksOptions } from '../ingest/zoho-books.ts';
import { fileBacklog, type BacklogSummary } from '../folders/classify.ts';

export interface IngestSyncOptions {
  storage?: Storage; deps?: IngestDeps; sink?: ItemSink;
  /** false skips the source; options are passed through (tests inject fetch and config). Default: run when configured by env. */
  workdrive?: WorkdriveOptions | false; books?: BooksOptions | false;
  limit?: number;
  /** false skips filing the folder backlog (wave 9); default: file it. */
  folders?: boolean;
}
export interface IngestSyncSummary {
  workdrive: SyncStats | null; books: SyncStats | null;
  ingested: number; skipped: number; needs_attention: number; failed: number; errors: string[];
  /** Set when the run had nothing to do, so the log says why rather than failing on a key it never needed. */
  idle?: string;
  /** Set when the run's model-spend cap stopped it, with how many items wait for the next run. */
  stopped_by?: 'budget'; left?: number;
  /** scans put back because this run's OCR time (VAULT_OCR_RUN_SECONDS, default 300) was spent */
  ocr_deferred?: number;
  /** Wave 9: records that had never been filed into the project folders, filed this run within what is left of the cap. */
  folders?: BacklogSummary;
}

/** Pounds of model spend one ingest-sync run may make; INGEST_BUDGET_GBP overrides. */
export const DEFAULT_INGEST_BUDGET_GBP = 2;
export function ingestBudgetGbp(env: NodeJS.ProcessEnv = process.env): number { const v = Number(env.INGEST_BUDGET_GBP); return Number.isFinite(v) && v > 0 ? v : DEFAULT_INGEST_BUDGET_GBP; }

export async function runIngestSync(db: Db, opts: IngestSyncOptions = {}): Promise<IngestSyncSummary> {
  const job = (await db.query<{ id: number }>(`INSERT INTO jobs (name, status) VALUES ('ingest-sync', 'running') RETURNING id`)).rows[0].id;
  const summary: IngestSyncSummary = { workdrive: null, books: null, ingested: 0, skipped: 0, needs_attention: 0, failed: 0, errors: [] };
  try {
    const wd = opts.workdrive === false ? null : (opts.workdrive ?? (workdriveConfig() ? {} : null));
    const bk = opts.books === false ? null : (opts.books ?? (booksConfig() ? {} : null));
    let sink = opts.sink;
    if ((wd || bk) && !sink) sink = await serviceSink(db);
    if (wd) summary.workdrive = await syncWorkdrive(db, sink!, wd);
    if (bk) summary.books = await syncBooks(db, sink!, bk);

    const pending = (await db.query<{ id: string; version: number; title: string | null; project_id: string | null }>(
      `SELECT i.id, i.version, i.title, i.project_id FROM items i
        WHERE NOT i.hidden AND i.storage_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.item_id = i.id AND c.item_version = i.version AND c.current)
          AND coalesce(i.extracted->'ingest'->>'version', '') <> i.version::text
        -- A file that failed before goes behind every file that has not, so one that fails every run (a bad key, a
        -- file the extractor chokes on) never holds the queue: before this, the oldest 200 were retried forever.
        ORDER BY CASE WHEN i.extracted->'ingest_error'->>'version' = i.version::text
                      THEN coalesce((i.extracted->'ingest_error'->>'attempts')::int, 1) ELSE 0 END,
                 -- a scan a run had no OCR time for waits behind the files that need none
                 CASE WHEN i.extracted->>'ocr_deferred' = i.version::text THEN 1 ELSE 0 END,
                 i.created_at LIMIT $1`, [opts.limit ?? 200])).rows;
    if (!pending.length && !wd && !bk) {
      summary.idle = 'nothing to ingest and no WorkDrive or Books source configured';
      console.log(`ingest-sync: ${summary.idle}`);
    }
    // The embedder and provider are opened only when there is work: in production they refuse to
    // start without their keys, and an idle run must not fail on a key it would never have used.
    const storage = opts.storage ?? openStorage();
    const deps = opts.deps ?? (pending.length ? { provider: openProvider(), embedder: openEmbedder() } : null);
    // A per-run cap on model spend (INGEST_BUDGET_GBP, default £2): a backlog is worked through run by run, never in
    // one unbounded sweep; what is left waits for the next run, fifteen minutes on.
    const cap = ingestBudgetGbp(); const spentBefore = processSpendGbp();
    // OCR time this run may spend; once it is gone, scans are put back for a later run and text files keep flowing.
    const ocrBudgetMs = 1000 * Number(process.env.VAULT_OCR_RUN_SECONDS ?? 300); let ocrMs = 0;
    for (const [i, it] of pending.entries()) {
      if (processSpendGbp() - spentBefore >= cap) { summary.stopped_by = 'budget'; summary.left = pending.length - i; console.log(`ingest-sync: stopped at £${cap} of model spend this run; ${summary.left} item(s) wait for the next run`); break; }
      try {
        const t0 = Date.now();
        const r = await ingestItem(db, storage, it.id, deps!, { ocr: ocrMs < ocrBudgetMs });
        const secs = (Date.now() - t0) / 1000;
        if (r.ocr) ocrMs += Date.now() - t0;
        if (r.status === 'ocr_deferred') { summary.ocr_deferred = (summary.ocr_deferred ?? 0) + 1; }
        else if (r.status === 'ok') summary.ingested++; else if (r.status === 'skipped') summary.skipped++; else summary.needs_attention++;
        console.log(`ingest-sync: ${r.status}${r.ocr ? ' (ocr)' : ''} ${r.chunks} chunks ${secs.toFixed(1)}s [${it.project_id ?? '-'}] ${(it.title ?? it.id).slice(0, 80)}`);
        await db.query(`UPDATE items SET extracted = extracted - 'ingest_error' WHERE id = $1 AND extracted ? 'ingest_error'`, [it.id]);
        await db.query(`UPDATE jobs SET status = 'ok', finished_at = now() WHERE name = 'ingest-queue' AND finished_at IS NULL AND summary->>'item_id' = $1`, [it.id]);
      } catch (e) {
        console.log(`ingest-sync: failed [${it.project_id ?? '-'}] ${(it.title ?? it.id).slice(0, 80)}: ${(e as Error).message.slice(0, 200)}`);
        // The day's model budget is spent: every file after this would fail the same way, and none of them is at fault.
        if (e instanceof BudgetExceeded) { summary.stopped_by = 'budget'; summary.left = pending.length - i; summary.errors.push((e as Error).message); break; }
        summary.failed++; summary.errors.push(`${it.id}: ${(e as Error).message}`);
        await db.query(
          `UPDATE items SET extracted = extracted || jsonb_build_object('ingest_error', jsonb_build_object('version', version, 'at', now(), 'message', left($2, 500),
             'attempts', CASE WHEN extracted->'ingest_error'->>'version' = version::text THEN coalesce((extracted->'ingest_error'->>'attempts')::int, 0) + 1 ELSE 1 END))
           WHERE id = $1`, [it.id, (e as Error).message]).catch(() => {});
      }
    }
    // Wave 9: records never filed into the project folders (research notes, mail, files from before the folders) are
    // filed here, at most 200 a run, within whatever the cap has left; a run with no model files by the rules alone.
    if (opts.folders !== false && !summary.stopped_by) {
      const left = cap - (processSpendGbp() - spentBefore);
      let provider = deps?.provider ?? null;
      if (!deps) { try { provider = openProvider(); } catch { provider = null; } }
      try { summary.folders = await fileBacklog(db, ingestProviderFor(provider), { limit: 200, budgetGbp: Math.max(0, left) }); } catch (e) { summary.errors.push(`folders: ${(e as Error).message}`); }
    }
    for (const s of [summary.workdrive, summary.books]) if (s) summary.errors.push(...s.errors);
    await db.query(`UPDATE jobs SET status = 'ok', finished_at = now(), summary = $2::jsonb WHERE id = $1`, [job, JSON.stringify(summary)]);
  } catch (e) {
    summary.errors.push((e as Error).message);
    await db.query(`UPDATE jobs SET status = 'failed', finished_at = now(), summary = $2::jsonb WHERE id = $1`, [job, JSON.stringify(summary)]);
    throw e;
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await openDb();
  await migrate(db);
  const s = await runIngestSync(db);
  console.log(JSON.stringify(s));
  await db.close();
}
