import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runIngestSync } from '../src/jobs/ingest-sync.ts';
import { runMailPoll } from '../src/jobs/mail-poll.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';

// On Render the cron jobs run with NODE_ENV=production from day one, before the owner has entered
// VOYAGE_API_KEY or any mailbox or WorkDrive credentials. A job with nothing to do must finish
// cleanly and say so, not fail on a key it would not have used. The guard against indexing with
// fake embeddings still applies the moment there is real work.

let h: Harness;
const saved: Record<string, string | undefined> = {};
before(async () => {
  h = await setup('vault-idle-');
  for (const k of ['NODE_ENV', 'LLM_PROVIDER', 'VOYAGE_API_KEY', 'ANTHROPIC_API_KEY']) saved[k] = process.env[k];
  process.env.NODE_ENV = 'production';
  delete process.env.LLM_PROVIDER;
  delete process.env.VOYAGE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await h.db.close();
});

const lastJob = async (name: string) => (await h.db.query<{ status: string; summary: any }>(`SELECT status, summary FROM jobs WHERE name = $1 ORDER BY id DESC LIMIT 1`, [name])).rows[0];

test('ingest-sync with no source configured and nothing pending finishes ok in production without an embedding key', async () => {
  const s = await runIngestSync(h.db, { workdrive: false, books: false });
  assert.deepEqual([s.ingested, s.skipped, s.failed, s.errors], [0, 0, 0, []]);
  assert.match(s.idle ?? '', /nothing to ingest/);
  assert.equal((await lastJob('ingest-sync')).status, 'ok');
});

test('mail-poll with no mailbox configured finishes ok in production without an embedding key', async () => {
  const s = await runMailPoll(h.db, { sources: [] });
  assert.deepEqual(s.mailboxes, []);
  assert.match(s.idle ?? '', /no mailbox configured/);
  assert.equal((await lastJob('mail-poll')).status, 'ok');
});

test('ingest-sync with real pending work still refuses to index without an embedding key in production', async () => {
  const project = (await h.db.query<{ id: string }>('SELECT id FROM projects LIMIT 1')).rows[0].id;
  const tag = (await h.db.query<{ id: string }>('SELECT id FROM legal_tags LIMIT 1')).rows[0].id;
  await h.db.query(`INSERT INTO items (id, type, title, created_at, project_id, legal_tag, origin, storage_key, content_hash)
    VALUES ('11111111-1111-4111-8111-111111111111', 'document', 'pending.md', now(), $1, $2, '{"kind":"test"}'::jsonb, 'originals/none', 'sha256:none')`, [project, tag]);
  await assert.rejects(runIngestSync(h.db, { workdrive: false, books: false }), /VOYAGE_API_KEY is required in production/);
  await h.db.query(`DELETE FROM items WHERE id = '11111111-1111-4111-8111-111111111111'`);
});
