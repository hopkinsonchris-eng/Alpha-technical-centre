/**
 * Object storage for immutable originals (M02). The Vault stores bytes under
 * `originals/<hash-prefix>/<sha256>`; derived text under `derived/<item-id>/text.md`.
 *  - filesystem: VAULT_STORAGE_DIR (default vault/.storage), for tests and local dev
 *  - supabase:   stub until M09 wires Supabase Storage
 * Select with VAULT_STORAGE=filesystem|supabase (default filesystem).
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Storage {
  /** Write bytes at key. Idempotent: writing the same key again replaces it with identical content-addressed bytes. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** Read bytes, or null when the key is absent. */
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
}

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.storage');

function safeKey(key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(key) || key.split('/').some(p => p === '..' || p === '.' || p === '')) {
    throw new Error(`invalid storage key "${key}"`);
  }
  return key;
}

export function filesystemStorage(root = process.env.VAULT_STORAGE_DIR || DEFAULT_DIR): Storage {
  const abs = (key: string) => path.join(root, safeKey(key));
  return {
    async put(key, bytes) {
      const file = abs(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    async get(key) {
      try { return new Uint8Array(await readFile(abs(key))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    },
    async exists(key) {
      try { return (await stat(abs(key))).isFile(); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
    },
  };
}

/** Supabase Storage arrives with M09; until then every call refuses. */
export function supabaseStorage(): Storage {
  const refuse = async (): Promise<never> => { throw new Error('storage not configured'); };
  return { put: refuse, get: refuse, exists: refuse };
}

export function openStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  const kind = (env.VAULT_STORAGE ?? 'filesystem').toLowerCase();
  if (kind === 'supabase') return supabaseStorage();
  if (kind !== 'filesystem') throw new Error(`unknown VAULT_STORAGE "${kind}"`);
  return filesystemStorage(env.VAULT_STORAGE_DIR || DEFAULT_DIR);
}

/** Content-addressed key for an original: originals/<first two hex chars>/<hex>. */
export function originalKey(sha256Hex: string): string {
  return `originals/${sha256Hex.slice(0, 2)}/${sha256Hex}`;
}
