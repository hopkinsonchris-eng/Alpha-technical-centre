/**
 * Mailbox polling (M10): read a source from its stored cursor, capture each message, store the cursor after each one.
 * The cursor of a message is stored only after it was captured, so a crash repeats at most that message (dedupe makes it
 * harmless), and a message that fails to capture stops the mailbox and is retried at the next poll instead of being skipped.
 */
import type { Db } from '../../db/client.ts';
import type { Storage } from '../../storage.ts';
import { captureMessage, type CaptureDeps } from './capture.ts';
import { resolvePendingDispatches } from './counterparties.ts';
import { gmailSourceFromEnv } from './gmail.ts';
import { zohoSourcesFromEnv } from './imap.ts';
import { originOf, type MailSource } from './types.ts';

export const MAIL_POLL_INTERVAL_MS = 5 * 60_000;

export interface PollStats {
  mailbox: string; fetched: number; created: number; duplicates: number; skipped: number; filed: number; queued: number;
  dispatches: number; proposals: number; attachments: number; errors: string[];
}
export interface PollOptions {
  /** Backfill: ignore the stored cursor and read from this date; the cursor is stored only if the mailbox had none. */
  since?: Date;
  /** Stop after this many messages (tests, and a bound for a first run on a huge mailbox). */
  limit?: number;
}

export async function getCursor(db: Db, mailbox: string): Promise<string | null> {
  return (await db.query<{ cursor: string }>('SELECT cursor FROM mail_cursors WHERE mailbox = $1', [mailbox])).rows[0]?.cursor ?? null;
}
export async function setCursor(db: Db, mailbox: string, cursor: string): Promise<void> {
  await db.query(`INSERT INTO mail_cursors (mailbox, cursor, updated_at) VALUES ($1,$2,now()) ON CONFLICT (mailbox) DO UPDATE SET cursor = excluded.cursor, updated_at = now()`, [mailbox, cursor]);
}

export async function pollMailbox(db: Db, storage: Storage, source: MailSource, deps: Omit<CaptureDeps, 'origin'> & { origin?: CaptureDeps['origin'] }, opts: PollOptions = {}): Promise<PollStats> {
  const s: PollStats = { mailbox: source.id, fetched: 0, created: 0, duplicates: 0, skipped: 0, filed: 0, queued: 0, dispatches: 0, proposals: 0, attachments: 0, errors: [] };
  const stored = await getCursor(db, source.id);
  const backfill = !!opts.since;
  const start = backfill ? null : stored;
  let last: string | null = null;
  const capDeps: CaptureDeps = { ...deps, origin: deps.origin ?? originOf(source) };
  try {
    for await (const { message, cursor } of source.fetch(start, backfill ? { since: opts.since } : {})) {
      s.fetched++;
      const r = await captureMessage(db, storage, message, capDeps);
      if (r.status === 'created') { s.created++; if (r.filed) s.filed++; else s.queued++; s.attachments += r.attachment_ids.length; s.dispatches += r.dispatch_ids.length; s.proposals += r.proposals.length; }
      else if (r.status === 'duplicate') s.duplicates++;
      else s.skipped++;
      for (const e of r.errors) s.errors.push(`${message.external_id}: ${e}`);
      last = cursor;
      if (!backfill) await setCursor(db, source.id, cursor);
      if (opts.limit && s.fetched >= opts.limit) break;
    }
  } catch (e) {
    s.errors.push(`${source.id}: ${(e as Error).message}`);
    return s;                                   // the cursor stays where the last captured message left it
  }
  if (backfill && last && stored === null) await setCursor(db, source.id, last);
  return s;
}

/** Every mailbox the environment configures: Zoho IMAP (ZOHO_MAIL_IMAP_USER…) and Gmail (GMAIL_OAUTH_…). */
export function sourcesFromEnv(env: NodeJS.ProcessEnv = process.env): MailSource[] {
  const gmail = gmailSourceFromEnv(env);
  return [...zohoSourcesFromEnv(env), ...(gmail ? [gmail] : [])];
}

export interface RunPollOptions { sources?: MailSource[]; since?: Date; limit?: number }

export async function pollAll(db: Db, storage: Storage, deps: Omit<CaptureDeps, 'origin'>, opts: RunPollOptions = {}): Promise<{ mailboxes: PollStats[]; dispatches_resolved: number }> {
  const sources = opts.sources ?? sourcesFromEnv();
  const mailboxes: PollStats[] = [];
  for (const src of sources) mailboxes.push(await pollMailbox(db, storage, src, deps, { since: opts.since, limit: opts.limit }));
  const dispatches_resolved = await resolvePendingDispatches(db, { firm: deps.firmDomains });
  return { mailboxes, dispatches_resolved };
}
