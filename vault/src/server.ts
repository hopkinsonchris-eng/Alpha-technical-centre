import { serve } from '@hono/node-server';
import { openDb } from './db/client.ts';
import { boot } from './db/boot.ts';
import { createApp } from './app.ts';

const db = await openDb();
await boot(db, line => console.log(line));
const app = await createApp({ db });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`vault-api listening on :${port} (${db.backend})`));
