/**
 * Mail backfill (M10): read every configured mailbox from a date and capture what the Vault does not hold yet.
 *   node --import tsx src/jobs/mail-backfill.ts --since=2024-01-01
 * Dedupe on Message-Id and content makes it safe to run again or over a period the poller already covered. The mailbox's
 * poll cursor is set only when it had none, so a backfill never moves a live poller backwards or forwards.
 */
import { pathToFileURL } from 'node:url';
import { openDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { runMailPoll, type MailPollOptions } from './mail-poll.ts';

export function parseSince(argv: string[]): Date {
  const arg = argv.find(a => a.startsWith('--since='))?.slice('--since='.length);
  if (!arg || !/^\d{4}-\d{2}-\d{2}$/.test(arg) || Number.isNaN(Date.parse(arg))) throw new Error('usage: mail-backfill --since=YYYY-MM-DD');
  return new Date(`${arg}T00:00:00Z`);
}

export const runMailBackfill = (db: Parameters<typeof runMailPoll>[0], since: Date, opts: MailPollOptions = {}) =>
  runMailPoll(db, { ...opts, since, jobName: 'mail-backfill' });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const since = parseSince(process.argv);
  const db = await openDb();
  await migrate(db);
  try { console.log(JSON.stringify(await runMailBackfill(db, since))); } finally { await db.close(); }
}
