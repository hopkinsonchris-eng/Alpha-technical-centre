// 14 Oct 2026 (db/015_lock_data_api.sql): Supabase publishes the `public` schema through its Data API to the `anon` and
// `authenticated` roles. Every Vault table must carry row-level security and grant those roles nothing, so the API
// can neither read nor write a record; the Vault's own connection (the tables' owner) is unaffected. A table added by
// a later migration without row-level security fails this test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';

let db: Db;
before(async () => {
  db = await openDb(undefined);
  // Supabase's defaults: the API roles exist and receive every table made in `public`.
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`);
  await migrate(db);
});
after(async () => { await db.close(); });

test('every table in public has row-level security', async () => {
  const off = (await db.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity ORDER BY 1`)).rows.map(r => r.relname);
  assert.deepEqual(off, [], `tables without row-level security: ${off.join(', ')}`);
  const n = Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n);
  assert.ok(n > 30, 'the check saw the Vault\'s tables');
});

test('the Data API roles hold no privilege on any Vault table', async () => {
  const held = (await db.query<{ grantee: string; table_name: string }>(
    `SELECT grantee, table_name FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon','authenticated') LIMIT 5`)).rows;
  assert.deepEqual(held, []);
});

test('as anon, reading or writing a record is refused; the owner still reads', async () => {
  await db.query(`INSERT INTO people (id, email, name, role) VALUES ('rls-x', 'rls-x@alpha-technical-centre.com', 'X', 'associate')`);
  await db.exec('SET ROLE anon');
  try {
    await assert.rejects(db.query('SELECT * FROM people'), /permission denied/);
    await assert.rejects(db.query(`INSERT INTO people (id, email, name, role) VALUES ('rls-y','y@x.com','Y','associate')`), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM items'), /permission denied/);
  } finally { await db.exec('RESET ROLE'); }
  assert.equal((await db.query(`SELECT 1 FROM people WHERE id = 'rls-x'`)).rows.length, 1);
});
