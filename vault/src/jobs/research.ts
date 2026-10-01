/**
 * Research sync (wave 4): finishes the research runs the API server queued but did not run
 * (a restart, or a deploy mid-run). Every run is one row in `jobs` (name 'research').
 *   npx tsx src/jobs/research.ts        (Render cron "atc-vault-research", every 15 minutes)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { researchEnabled, runQueued } from '../research/run.ts';

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  await migrate(db);
  if (!researchEnabled()) { console.log(JSON.stringify({ skipped: 'RESEARCH_ENABLED=false' })); await db.close(); process.exit(0); }
  const r = await runQueued(db);
  console.log(JSON.stringify(r.map(s => ({ project_id: s.project_id, status: s.status, findings: s.findings, proposals: s.proposals, spend_gbp: s.spend_gbp, duration_ms: s.duration_ms, not_reached: s.not_reached.length }))));
  await db.close();
  if (r.some(s => s.status === 'failed')) process.exitCode = 1;
}
