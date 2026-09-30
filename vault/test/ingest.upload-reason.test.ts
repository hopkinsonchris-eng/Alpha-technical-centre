import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type Harness } from './fixtures/ingest/harness.ts';

// When the API cannot index a file on the spot it queues the file for the ingest job. The
// person uploading must be told why in the response, not only in the jobs table: on the live
// Hub a small file came back "queued" with no reason, which turned out to be the API running
// without its embedding key.

let h: Harness;
const saved: Record<string, string | undefined> = {};
before(async () => {
  h = await setup('vault-upload-reason-');
  for (const k of ['NODE_ENV', 'VOYAGE_API_KEY']) saved[k] = process.env[k];
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await h.db.close();
});

test('a small file queued because the embedder is not configured says so in its result', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.VOYAGE_API_KEY;
  try {
    const r = await h.upload([{ name: 'sow-revc.md', bytes: '# Scope of work\n\nPhase 1 field study.', type: 'text/markdown' }]);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const x = r.body.results[0];
    assert.equal(x.status, 'queued', JSON.stringify(x));
    assert.match(x.error ?? '', /VOYAGE_API_KEY is required in production/, JSON.stringify(x));
    const job = (await h.db.query<{ summary: any }>(`SELECT summary FROM jobs WHERE name = 'ingest-queue' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(job.summary.item_id, x.item_id);
    assert.match(job.summary.reason, /VOYAGE_API_KEY/);
  } finally {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.VOYAGE_API_KEY !== undefined) process.env.VOYAGE_API_KEY = saved.VOYAGE_API_KEY;
  }
});
