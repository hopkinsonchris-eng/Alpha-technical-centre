/** Shared setup for the M09 test files: embedded Postgres, migrations, the AC15 seed, the app, fake provider and embedder. */
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DOMAIN = 'alpha-technical-centre.com';
export const readFixture = (rel: string) => readFileSync(path.join(HERE, rel));
export const readJson = (rel: string) => JSON.parse(readFileSync(path.join(HERE, rel), 'utf8'));

export async function setup(prefix = 'vault-ingest-') {
  const storageDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.VAULT_STORAGE_DIR = storageDir;
  process.env.LLM_PROVIDER = 'fake';
  delete process.env.VOYAGE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ZOHO_WORKDRIVE_CLIENT_ID;
  delete process.env.ZOHO_BOOKS_CLIENT_ID;
  process.env.NODE_ENV = 'test';
  const { openDb } = await import('../../../src/db/client.ts');
  const { migrate } = await import('../../../src/db/migrate.ts');
  const { seedMaster, seedFixture } = await import('../../../src/db/seed.ts');
  const { createApp } = await import('../../../src/app.ts');
  const db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, readJson('../ac15/seed.json'));
  const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  const { openStorage } = await import('../../../src/storage.ts');
  const storage = openStorage();
  const upload = async (files: Array<{ name: string; bytes: Uint8Array | string; type?: string }>, fields: Record<string, string> = { project_id: 'orinoco-partnership' }) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append('files', new Blob([f.bytes as BlobPart], { type: f.type ?? '' }), f.name);
    const res = await app.request('/api/ingest/upload', { method: 'POST', body: fd });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { db, app, storage, storageDir, upload };
}
export type Harness = Awaited<ReturnType<typeof setup>>;
