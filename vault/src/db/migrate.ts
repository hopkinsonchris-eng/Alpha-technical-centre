import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb, type Db } from './client.ts';

const DB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db');

/** Apply every db/NNN_*.sql not yet recorded in schema_migrations, in order. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(DB_DIR)).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(DB_DIR, f), 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    applied.push(f);
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  const applied = await migrate(db);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
  await db.close();
}
