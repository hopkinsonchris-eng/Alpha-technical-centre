import { describeStorage, openStorage } from './storage.ts';
import { serve } from '@hono/node-server';
import { openDb } from './db/client.ts';
import { boot } from './db/boot.ts';
import { createApp } from './app.ts';

const db = await openDb();
await boot(db, line => console.log(line));
openStorage();                                                     // refuses a container disk in production (W5-D1)
console.log(`storage: ${describeStorage()}`);
const app = await createApp({ db, fetch, log: line => console.log(line) });   // fetch: lets the catalog read external apps' version.json
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`vault-api listening on :${port} (${db.backend})`));
