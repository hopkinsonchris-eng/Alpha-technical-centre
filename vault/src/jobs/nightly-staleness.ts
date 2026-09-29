import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { runStalenessJob } from './staleness.ts';
const db = await openDb();
await migrate(db);
const s = await runStalenessJob(db);
console.log(JSON.stringify(s));
await db.close();
