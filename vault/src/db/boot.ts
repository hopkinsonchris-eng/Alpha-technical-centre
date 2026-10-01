/**
 * Server boot (M01/M02): apply pending migrations, then load the committed master data
 * (partners, master assets, firm assets such as the letterhead, reference sets). Both steps
 * are idempotent, so this runs on every start. The cron jobs only migrate; nothing they do
 * depends on the master rows being fresh.
 */
import type { Db } from './client.ts';
import { migrate } from './migrate.ts';
import { GEM_FILE, seedMaster, type MasterSummary } from './seed.ts';

export interface BootSummary { migrations: string[]; master: MasterSummary }

export async function boot(db: Db, log: (line: string) => void = () => {}): Promise<BootSummary> {
  const migrations = await migrate(db);
  if (migrations.length) log(`migrations applied: ${migrations.join(', ')}`);
  const master = await seedMaster(db, { gemFile: GEM_FILE });
  log(`master data loaded: ${master.people} people, ${master.assets} assets, ${master.firm_assets} firm assets, ${master.reference_sets} reference sets` +
    (master.reference_versions_added ? ` (${master.reference_versions_added} reference versions added)` : '') +
    (master.gem_units ? `, ${master.gem_units} Global Energy Monitor units${master.gem_skipped ? ' (already loaded)' : ''}` : ''));
  return { migrations, master };
}
