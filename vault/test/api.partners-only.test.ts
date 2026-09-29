import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const H = 'sha256:' + 'f'.repeat(64);
const INVOICE = '00000000-0000-4000-8000-0000000000e1';
const LETTER = '00000000-0000-4000-8000-0000000000e2';

test('finance and legal items are partners-only: an associate on the project sees the letter but not the invoice', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate')");
  await db.query("UPDATE projects SET members = '{chris,ana}' WHERE id = 'orinoco-partnership'");
  await db.query(`INSERT INTO items (id,type,title,created_at,project_id,client_id,legal_tag,origin,content_hash,version,extracted) VALUES
    ($1,'invoice','Invoice INV-2026-031',now(),'orinoco-partnership','petrolera-del-orinoco','lt-orinoco-nda-2026','{"source":"zoho-books"}'::jsonb,$3,1,'{"amount":18500}'::jsonb),
    ($2,'letter','Letter to the partner',now(),'orinoco-partnership','petrolera-del-orinoco','lt-orinoco-nda-2026','{"source":"upload"}'::jsonb,$3,1,'{}'::jsonb)`, [INVOICE, LETTER, H]);
  const as = async (email: string) => createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: email }, version: 'test' });
  const ana = await as('ana@alpha-technical-centre.com'), chris = await as('chris@alpha-technical-centre.com');
  assert.equal((await ana.request(`/api/items/${LETTER}`)).status, 200);
  assert.equal((await ana.request(`/api/items/${INVOICE}`)).status, 403);
  assert.equal((await ana.request(`/api/items/${INVOICE}/versions`)).status, 403);
  const list: any = await (await ana.request('/api/items?project=orinoco-partnership')).json();
  const ids = (list.items ?? list).map((i: any) => i.id);
  assert.ok(ids.includes(LETTER) && !ids.includes(INVOICE));
  assert.equal((await chris.request(`/api/items/${INVOICE}`)).status, 200);
  // A partner can open a finance record to associates per item.
  await db.query("UPDATE items SET extracted = extracted || '{\"partners_only\": false}'::jsonb WHERE id = $1", [INVOICE]);
  assert.equal((await ana.request(`/api/items/${INVOICE}`)).status, 200);
  await db.close();
});
