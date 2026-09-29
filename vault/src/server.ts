import { serve } from '@hono/node-server';
import { openDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';
import { createApp } from './app.ts';

const db = await openDb();
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
const app = await createApp({ db });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`vault-api listening on :${port} (${db.backend})`));
