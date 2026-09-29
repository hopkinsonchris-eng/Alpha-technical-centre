/**
 * Weekly miners job (M11). Runs the orchestrator for every enabled source
 * (weekly feeds always; monthly feeds in the first week of the month, or when
 * MINERS_INCLUDE_MONTHLY=1), then imports the radar ledger and, when an LLM
 * provider is configured, extracts paper facts. Idempotent: an unchanged upstream
 * writes nothing. `MINERS_SINCE=YYYY-MM-DD` backfills.
 *   npx tsx src/jobs/miners.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { extractPaperFacts, type PaperFactsSummary } from '../miners/paper-facts.ts';
import { importRadarLedger, type RadarImportSummary } from '../miners/radar-bridge.ts';
import { runMiners, type RunOptions, type RunSummary } from '../miners/run.ts';

export interface WeeklyMinersResult { miners: RunSummary; radar: RadarImportSummary; paper_facts: PaperFactsSummary | null }

export async function runWeeklyMiners(db: Db, opts: RunOptions & { provider?: LlmProvider | null; includeMonthly?: boolean; ledgerPath?: string } = {}): Promise<WeeklyMinersResult> {
  const now = opts.now ?? new Date();
  const monthly = opts.includeMonthly ?? (process.env.MINERS_INCLUDE_MONTHLY === '1' || now.getUTCDate() <= 7);
  const since = opts.since ?? (process.env.MINERS_SINCE ? new Date(process.env.MINERS_SINCE) : undefined);
  const miners = await runMiners(db, { ...opts, now, since, schedules: opts.schedules ?? (monthly ? ['weekly', 'monthly'] : ['weekly']) });
  const radar = await importRadarLedger(db, { ledgerPath: opts.ledgerPath, storage: opts.storage, now });
  const provider = opts.provider === undefined ? openProvider() : opts.provider;
  const paper_facts = provider ? await extractPaperFacts(db, { provider, storage: opts.storage, now }) : null;
  return { miners, radar, paper_facts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  await migrate(db);
  const r = await runWeeklyMiners(db);
  console.log(JSON.stringify(r));
  await db.close();
  if (Object.values(r.miners.adapters).some(a => a.error)) process.exitCode = 1;
}
