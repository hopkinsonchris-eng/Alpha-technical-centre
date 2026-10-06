import { describeStorage, openStorage, storageHealth } from './storage.ts';
import { serve } from '@hono/node-server';
import { openDb } from './db/client.ts';
import { boot } from './db/boot.ts';
import { createApp } from './app.ts';

const db = await openDb();
await boot(db, line => console.log(line));
const storage = openStorage();                                     // refuses a container disk in production (W5-D1)
console.log(`storage: ${describeStorage()}`);
// The store is checked at boot and reported on /api/health: a bucket that does not exist used to surface only as
// "unreachable" sources at the first pack build. The server keeps serving (reads work); the Hub's strip says so.
const storageCheck = storageHealth(storage);
const check = await storageCheck();
console.log(check.ok ? 'storage check: ok' : `storage check: FAILED: ${check.error}. Nothing can be filed until this is fixed.`);
const app = await createApp({ db, fetch, log: line => console.log(line), storageCheck });   // fetch: lets the catalog read external apps' version.json
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`vault-api listening on :${port} (${db.backend})`));
