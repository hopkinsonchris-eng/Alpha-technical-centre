/**
 * Database client (M00/M01). One interface, two backends:
 *  - DATABASE_URL set  → node-postgres against Supabase (or any Postgres 16 + pgvector)
 *  - DATABASE_URL unset → embedded PGlite (tests, local dev, CI) with the vector extension
 */
import { readFileSync } from 'node:fs';

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run a multi-statement script (migrations). No parameters. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  backend: 'pg' | 'pglite';
}

export interface PgPoolConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
  max: number;
  /** Set when the connection is encrypted but the server certificate is not verified. Log it once. */
  warning?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SSL_PARAMS = ['sslmode', 'uselibpqcompat', 'sslrootcert', 'sslcert', 'sslkey'];

/**
 * Build the node-postgres pool config for DATABASE_URL.
 *
 * pg 8.x treats `sslmode=require` in the URL as verify-full, and hosted Postgres
 * (Supabase's pooler included) presents a certificate signed by the provider's
 * own root CA, which Node does not trust by default. So the ssl parameters are
 * taken out of the URL and TLS is configured explicitly:
 *  - DATABASE_SSL_CA (inline PEM, or a path to a PEM file such as a Render
 *    secret file) → encrypted and verified against that CA.
 *  - sslmode=disable, or a local host → no TLS.
 *  - otherwise → encrypted but unverified, with a warning naming the fix.
 */
export function pgPoolConfig(url: string, env: Record<string, string | undefined> = process.env): PgPoolConfig {
  // Edit the query string by hand so the other parameters keep their exact encoding.
  const [base, query = ''] = url.split('?', 2);
  const pairs = query.split('&').filter(Boolean);
  const keyOf = (pair: string) => decodeURIComponent(pair.split('=')[0]).toLowerCase();
  const sslmode = pairs.find(p => keyOf(p) === 'sslmode')?.split('=')[1]?.toLowerCase() ?? null;
  const kept = pairs.filter(p => !SSL_PARAMS.includes(keyOf(p)));
  const connectionString = kept.length ? `${base}?${kept.join('&')}` : base;
  const host = new URL(base).hostname.toLowerCase();

  if (sslmode === 'disable' || (!sslmode && LOCAL_HOSTS.has(host))) return { connectionString, ssl: false, max: 5 };

  const caSetting = env.DATABASE_SSL_CA;
  if (caSetting?.trim()) {
    const ca = caSetting.trimStart().startsWith('-----BEGIN') ? caSetting : readFileSync(caSetting.trim(), 'utf8');
    return { connectionString, ssl: { rejectUnauthorized: true, ca }, max: 5 };
  }
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    warning: `database connection to ${host} is encrypted but the server certificate is not verified; set DATABASE_SSL_CA to the provider's root certificate (PEM text or file path) to verify it`,
  };
}

export async function openDb(url = process.env.DATABASE_URL): Promise<Db> {
  if (url) {
    const { default: pg } = await import('pg');
    const cfg = pgPoolConfig(url);
    if (cfg.warning) console.warn(`vault-api: ${cfg.warning}`);
    const pool = new pg.Pool({ connectionString: cfg.connectionString, ssl: cfg.ssl, max: cfg.max });
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
