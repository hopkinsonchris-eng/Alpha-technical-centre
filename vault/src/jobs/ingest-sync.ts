/**
 * Scheduled ingest (M09): pull new and changed files from Zoho WorkDrive and Zoho Books (each only when
 * configured), then ingest every item that has no current chunks for its version, including the uploads
 * the API queued because they were 5 MB or larger. Run: `tsx src/jobs/ingest-sync.ts` (Render cron).
 * Every run is one row in `jobs`.
 */
import { pathToFileURL } from 'node:url';
import type { Db } from '../db/client.ts';
import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { openStorage, type Storage } from '../storage.ts';
import { openProvider } from '../llm/provider.ts';
import { openEmbedder } from '../ingest/embed.ts';
import { ingestItem, type IngestDeps } from '../ingest/index.ts';
import { serviceSink, type ItemSink } from '../ingest/items-client.ts';
import { syncWorkdrive, workdriveConfig, type SyncStats, type WorkdriveOptions } from '../ingest/workdrive.ts';
import { booksConfig, syncBooks, type BooksOptions } from '../ingest/zoho-books.ts';

export interface IngestSyncOptions {
  storage?: Storage; deps?: IngestDeps; sink?: ItemSink;
  /** false skips the source; options are passed through (tests inject fetch and config). Default: run when configured by env. */
  workdrive?: WorkdriveOptions | false; books?: BooksOptions | false;
  limit?: number;
}
export interface IngestSyncSummary {
  workdrive: SyncStats | null; books: SyncStats | null;
  ingested: number; skipped: number; needs_attention: number; failed: number; errors: string[];
  /** Set when the run had nothing to do, so the log says why rather than failing on a key it never needed. */
  idle?: string;
}

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

    const pending = (await db.query<{ id: string; version: number }>(
      `SELECT i.id, i.version FROM items i
        WHERE NOT i.hidden AND i.storage_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.item_id = i.id AND c.item_version = i.version AND c.current)
          AND coalesce(i.extracted->'ingest'->>'version', '') <> i.version::text
        ORDER BY i.created_at LIMIT $1`, [opts.limit ?? 200])).rows;
    if (!pending.length && !wd && !bk) {
      summary.idle = 'nothing to ingest and no WorkDrive or Books source configured';
      console.log(`ingest-sync: ${summary.idle}`);
    }
    // The embedder and provider are opened only when there is work: in production they refuse to
    // start without their keys, and an idle run must not fail on a key it would never have used.
    const storage = opts.storage ?? openStorage();
    const deps = opts.deps ?? (pending.length ? { provider: openProvider(), embedder: openEmbedder() } : null);
    for (const it of pending) {
      try {
        const r = await ingestItem(db, storage, it.id, deps!);
        if (r.status === 'ok') summary.ingested++; else if (r.status === 'skipped') summary.skipped++; else summary.needs_attention++;
        await db.query(`UPDATE jobs SET status = 'ok', finished_at = now() WHERE name = 'ingest-queue' AND finished_at IS NULL AND summary->>'item_id' = $1`, [it.id]);
      } catch (e) { summary.failed++; summary.errors.push(`${it.id}: ${(e as Error).message}`); }
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
