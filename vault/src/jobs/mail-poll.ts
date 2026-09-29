/**
 * Mail poll job (M10): every configured mailbox, from its cursor, every five minutes. One row per run in `jobs`.
 *   node --import tsx src/jobs/mail-poll.ts            one pass (Render cron, every five minutes)
 *   node --import tsx src/jobs/mail-poll.ts --loop     one pass every 5 minutes in this process (local dev, a worker)
 */
import { pathToFileURL } from 'node:url';
import type { Db } from '../db/client.ts';
import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { openStorage, type Storage } from '../storage.ts';
import { openProvider } from '../llm/provider.ts';
import { openEmbedder } from '../ingest/embed.ts';
import type { IngestDeps } from '../ingest/index.ts';
import { serviceSink, type ItemSink } from '../ingest/items-client.ts';
import { MAIL_POLL_INTERVAL_MS, pollAll, type RunPollOptions } from '../ingest/mail/poll.ts';

export interface MailPollOptions extends RunPollOptions {
  storage?: Storage; deps?: IngestDeps | null; sink?: ItemSink; jobName?: string;
}

export async function runMailPoll(db: Db, opts: MailPollOptions = {}) {
  const name = opts.jobName ?? 'mail-poll';
  const job = (await db.query<{ id: number }>(`INSERT INTO jobs (name, status) VALUES ($1, 'running') RETURNING id`, [name])).rows[0].id;
  try {
    const sink = opts.sink ?? await serviceSink(db);
    const ingest = opts.deps === undefined ? { provider: openProvider(), embedder: openEmbedder() } : opts.deps;
    const summary = await pollAll(db, opts.storage ?? openStorage(), { sink, ingest }, opts);
    const errors = summary.mailboxes.flatMap(m => m.errors);
    await db.query(`UPDATE jobs SET status = $3, finished_at = now(), summary = $2::jsonb WHERE id = $1`, [job, JSON.stringify(summary), errors.length ? 'failed' : 'ok']);
    return summary;
  } catch (e) {
    await db.query(`UPDATE jobs SET status = 'failed', finished_at = now(), summary = $2::jsonb WHERE id = $1`, [job, JSON.stringify({ error: (e as Error).message })]);
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await openDb();
  await migrate(db);
  const once = async () => { try { console.log(JSON.stringify(await runMailPoll(db))); } catch (e) { console.error('mail-poll failed:', (e as Error).message); process.exitCode = 1; } };
  await once();
  if (process.argv.includes('--loop')) setInterval(once, MAIL_POLL_INTERVAL_MS);
  else await db.close();
}
