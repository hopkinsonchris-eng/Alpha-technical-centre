/**
 * Database client (M00/M01). One interface, two backends:
 *  - DATABASE_URL set  → node-postgres against Supabase (or any Postgres 16 + pgvector)
 *  - DATABASE_URL unset → embedded PGlite (tests, local dev, CI) with the vector extension
 */
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run a multi-statement script (migrations). No parameters. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  backend: 'pg' | 'pglite';
}

export async function openDb(url = process.env.DATABASE_URL): Promise<Db> {
  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return {
      backend: 'pg',
      query: async <T,>(sql: string, params?: unknown[]) => {
        const r = await pool.query(sql, params as any[]);
        return { rows: r.rows as T[] };
      },
      exec: async (sql) => { await pool.query(sql); },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite/vector');
  const db = new PGlite({ extensions: { vector } });
  await db.waitReady;
  return {
    backend: 'pglite',
    query: async <T,>(sql: string, params?: unknown[]) => {
      const r = await db.query(sql, params as any[]);
      return { rows: r.rows as T[] };
    },
    exec: async (sql) => { await db.exec(sql); },
    close: () => db.close(),
  };
}
