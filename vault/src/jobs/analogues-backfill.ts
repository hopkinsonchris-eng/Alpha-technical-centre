/**
 * Analogue backfill (M16). Emits an analogue row for every final run that does
 * not have one yet. Idempotent: a run that already has a row is left alone
 * (use POST /api/analogues/emit/:runId or emitForRun to rebuild one). Runs of
 * tools that produce no evaluation outputs are counted and skipped.
 *   npx tsx src/jobs/analogues-backfill.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { emitForRun, loadAssets, type EmitOptions } from '../analogues/emit.ts';

export interface BackfillSummary { runs_checked: number; emitted: number; skipped: number; failed: { run_id: string; reason: string }[] }

export async function runAnaloguesBackfill(db: Db, opts: EmitOptions = {}): Promise<BackfillSummary> {
  const runs = (await db.query<{ id: string }>(
    `SELECT r.id FROM runs r WHERE r.status = 'final' AND NOT r.hidden
        AND NOT EXISTS (SELECT 1 FROM analogue_rows a WHERE a.source_ref = 'run:' || r.id::text AND a.provenance = 'own-evaluation')
      ORDER BY r.created_at, r.id`)).rows;
  const summary: BackfillSummary = { runs_checked: runs.length, emitted: 0, skipped: 0, failed: [] };
  const assets = opts.assets ?? await loadAssets(db);
  for (const { id } of runs) {
    try {
      const r = await emitForRun(db, id, { ...opts, assets });
      if (r.status === 'skipped') summary.skipped++; else summary.emitted++;
    } catch (e) { summary.failed.push({ run_id: id, reason: (e as Error).message }); }
  }
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  await migrate(db);
  const s = await runAnaloguesBackfill(db);
  console.log(JSON.stringify(s));
  await db.close();
  if (s.failed.length) process.exitCode = 1;
}
