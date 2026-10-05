/**
 * The round-watch cron (wave 7 PR6, W7-AC21): Render cron "atc-vault-round-watch", Sundays 04:30 UTC, after the
 * country-pack cron. Fetches the licensing pages of every country with an active or prospect project through the
 * pack's own fetch and store, reads each changed page once, and proposes dated stages into the review queue.
 *   npx tsx src/jobs/round-watch.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { watchRounds } from '../rounds/watch.ts';

export { watchRounds };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  await migrate(db);
  try {
    const s = await watchRounds(db);
    console.log(JSON.stringify(s));
  } catch (e) {
    console.error(`round-watch failed: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
