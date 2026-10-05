/**
 * Weekly country pack refresh (wave 7 PR5, W7-AC20): rebuilds the due and stale sections of every country with an
 * active or prospect project, under PACK_BUDGET_GBP per country, and writes what changed. The nightly staleness job
 * marks the sections; this job only drafts. A country with no active project is never refreshed.
 *   npx tsx src/jobs/country-pack-refresh.ts        (Render cron "atc-vault-country-pack-refresh", Mondays 05:00 UTC)
 * The sources are the previous build's, read at their newest stored version; when the country-pack job's fetch is
 * wired here (`sources` in RefreshOpts) the refresh re-fetches them first.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { openProvider } from '../llm/provider.ts';
import { packBudget } from '../country/types.ts';
import { refreshStale } from '../country/refresh.ts';

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  await migrate(db);
  const provider = openProvider();
  if (!provider) console.error('no drafting provider is configured (ANTHROPIC_API_KEY); due sections stay due and are not drafted');
  try {
    const r = await refreshStale(db, { provider, budgetGbp: packBudget(), by: 'job:country-pack-refresh' });
    console.log(JSON.stringify({ job_id: r.job_id, countries: r.countries.map(c => ({ country: c.country, sections: c.sections.map(s => `${s.section}:${s.status}`), spend_gbp: c.spend_gbp, stopped_by: c.stopped_by })), rebuilt: r.rebuilt, changed: r.changed.length, spend_gbp: r.spend_gbp, skipped_no_project: r.skipped_no_project }));
  } catch (e) {
    console.error(JSON.stringify({ error: (e as Error).message }));
    process.exitCode = 1;
  }
  await db.close();
}
