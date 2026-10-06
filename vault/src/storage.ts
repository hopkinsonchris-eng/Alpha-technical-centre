/**
 * Object storage for immutable originals (M02). The Vault stores bytes under
 * `originals/<hash-prefix>/<sha256>`; derived text under `derived/<item-id>/text.md`.
 *  - filesystem: VAULT_STORAGE_DIR (default vault/.storage), for tests and local dev
 *  - supabase:   a private bucket in the Supabase project (wave 5): SUPABASE_URL, SUPABASE_SERVICE_KEY, VAULT_STORAGE_BUCKET
 * Select with VAULT_STORAGE=filesystem|supabase (default filesystem; production refuses the filesystem unless a directory is named).
 */
import { mkdir, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Storage {
  /** Write bytes at key. Idempotent: writing the same key again replaces it with identical content-addressed bytes. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** Read bytes, or null when the key is absent. */
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
  /** Remove the bytes at key. Absent keys are not an error: a purge may run twice. */
  delete(key: string): Promise<void>;
  /** Is the store there to write to? The boot log and GET /api/health report it (a missing bucket was silent until the first filing failed). */
  check?(): Promise<StorageCheck>;
}

/** What the boot check and GET /api/health say about the store. `error` is written for the owner: what is wrong and where it is fixed. */
export interface StorageCheck { ok: boolean; kind: 'supabase' | 'filesystem'; bucket?: string; error?: string; checked_at: string }

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
    async delete(key) {
      try { await unlink(abs(key)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    },
    async check() {
      const checked_at = new Date().toISOString();
      try { await mkdir(root, { recursive: true }); await stat(root); return { ok: true, kind: 'filesystem', checked_at }; }
      catch (e) { return { ok: false, kind: 'filesystem', error: `storage directory ${root} cannot be used: ${(e as Error).message}`, checked_at }; }
    },
  };
}

export interface SupabaseStorageOptions { url: string; serviceKey: string; bucket?: string; fetch?: typeof fetch }

/**
 * Supabase Storage (wave 5, W5-D1): a private bucket in the project that holds the database, reached with
 * plain fetch and the service key, so the API and every cron share one store that survives a deploy.
 * `put` upserts (a content-addressed key always carries the same bytes); `get` and `exists` answer null and
 * false on the store's not-found shape (HTTP 400 with code NoSuchKey) and throw a named error on anything else.
 */
export function supabaseStorage(o: SupabaseStorageOptions): Storage {
  const base = o.url.replace(/\/+$/, '') + '/storage/v1/object';
  const bucket = o.bucket ?? 'vault';
  const f = o.fetch ?? fetch;
  const auth = { authorization: `Bearer ${o.serviceKey}`, apikey: o.serviceKey };
  const objectUrl = (key: string, info = false) => `${base}/${info ? 'info/' : ''}${bucket}/${safeKey(key).split('/').map(encodeURIComponent).join('/')}`;
  const notFound = async (res: Response): Promise<boolean> => {
    if (res.status === 404) return true;
    if (res.status !== 400) return false;
    try { const j = await res.clone().json(); return j?.code === 'NoSuchKey' || j?.statusCode === '404' || String(j?.error ?? '').toLowerCase() === 'not found'; } catch { return false; }
  };
  const fail = async (what: string, key: string, res: Response): Promise<never> => {
    throw new Error(`supabase storage ${what} ${res.status} for ${key}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  };
  return {
    async put(key, bytes, mime) {
      const res = await f(objectUrl(key), { method: 'POST', headers: { ...auth, 'content-type': mime || 'application/octet-stream', 'x-upsert': 'true', 'cache-control': '3600' }, body: bytes as unknown as BodyInit });
      if (!res.ok) await fail('put', key, res);
    },
    async get(key) {
      const res = await f(objectUrl(key), { headers: auth });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      if (await notFound(res)) return null;
      return fail('get', key, res);
    },
    async exists(key) {
      const res = await f(objectUrl(key, true), { headers: auth });
      if (res.ok) return true;
      if (await notFound(res)) return false;
      return fail('exists', key, res);
    },
    async delete(key) {
      const res = await f(objectUrl(key), { method: 'DELETE', headers: auth });
      if (res.ok || await notFound(res)) return;
      await fail('delete', key, res);
    },
    // GET /storage/v1/bucket/<id> answers the bucket's record, 404-shaped when there is none. The bucket name and the
    // key are the two things an owner sets by hand, so each failure names the one to fix and where (SETUP.md §1.5).
    async check() {
      const checked_at = new Date().toISOString();
      const where = 'vault/SETUP.md §1.5';
      try {
        const res = await f(`${o.url.replace(/\/+$/, '')}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers: auth });
        if (res.ok) return { ok: true, kind: 'supabase', bucket, checked_at };
        const body = (await res.text().catch(() => '')).slice(0, 200);
        let error: string;
        if (res.status === 404 || /NoSuchBucket|Bucket not found/i.test(body)) error = `bucket "${bucket}" does not exist in the Supabase project: create it under Storage, private, with that exact name, or set VAULT_STORAGE_BUCKET to the bucket that exists (${where})`;
        else if (/jwt|unauthori|apikey|invalid/i.test(body) || res.status === 401 || res.status === 403) error = `the service key was refused by Supabase Storage (${res.status}): SUPABASE_SERVICE_KEY must be the project's service_role key (${where})`;
        else error = `Supabase Storage answered ${res.status} for bucket "${bucket}": ${body}`;
        return { ok: false, kind: 'supabase', bucket, error, checked_at };
      } catch (e) { return { ok: false, kind: 'supabase', bucket, error: `Supabase Storage could not be reached: ${(e as Error).message}`, checked_at }; }
    },
  };
}

/**
 * The store check for the health route: a good answer is kept for `okMs` (five minutes), a bad one for `failMs`
 * (a minute), so the platform's probe never hits Supabase on every call and the Hub clears soon after the owner
 * fixes the store. A store without `check` is reported as fine.
 */
export function storageHealth(storage: Storage, okMs = 5 * 60_000, failMs = 60_000, clock: () => number = Date.now): () => Promise<StorageCheck> {
  let last: StorageCheck | null = null, at = 0, pending: Promise<StorageCheck> | null = null;
  return async () => {
    if (last && clock() - at < (last.ok ? okMs : failMs)) return last;
    if (!pending) {
      const run = storage.check ? storage.check() : Promise.resolve<StorageCheck>({ ok: true, kind: 'filesystem', checked_at: new Date().toISOString() });
      pending = run.catch((e): StorageCheck => ({ ok: false, kind: 'filesystem', error: (e as Error).message, checked_at: new Date().toISOString() }))
        .then(r => { last = r; at = clock(); pending = null; return r; });
    }
    return pending;
  };
}

/** Where the open store lives, for the boot log. */
export function describeStorage(env: NodeJS.ProcessEnv = process.env): string {
  const kind = (env.VAULT_STORAGE ?? 'filesystem').toLowerCase();
  return kind === 'supabase' ? `supabase bucket "${env.VAULT_STORAGE_BUCKET ?? 'vault'}" at ${env.SUPABASE_URL ?? '(unset)'}` : `filesystem ${env.VAULT_STORAGE_DIR || DEFAULT_DIR}`;
}

export function openStorage(env: NodeJS.ProcessEnv = process.env, opts: { fetch?: typeof fetch } = {}): Storage {
  const kind = (env.VAULT_STORAGE ?? 'filesystem').toLowerCase();
  if (kind === 'supabase') {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error('VAULT_STORAGE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY (vault/SETUP.md §1.5)');
    return supabaseStorage({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY, bucket: env.VAULT_STORAGE_BUCKET, fetch: opts.fetch });
  }
  if (kind !== 'filesystem') throw new Error(`unknown VAULT_STORAGE "${kind}"`);
  // A container disk is wiped at every deploy: on a production server the filesystem is allowed only when a
  // directory is named on purpose (a persistent disk), never by default.
  if (env.NODE_ENV === 'production' && !env.VAULT_STORAGE_DIR) throw new Error('VAULT_STORAGE=filesystem on a production server loses every original at the next deploy: set VAULT_STORAGE=supabase (vault/SETUP.md §1.5), or VAULT_STORAGE_DIR on a persistent disk on purpose');
  return filesystemStorage(env.VAULT_STORAGE_DIR || DEFAULT_DIR);
}

/** Content-addressed key for an original: originals/<first two hex chars>/<hex>. */
export function originalKey(sha256Hex: string): string {
  return `originals/${sha256Hex.slice(0, 2)}/${sha256Hex}`;
}
