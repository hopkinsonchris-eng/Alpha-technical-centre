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
import { loadRules } from './rules.ts';
import { recomputeRelationships } from './relationship.ts';
import { ZohoHttpError, ZohoMailSource, type HistoryCursor } from './zoho-api.ts';
import { openSecret, tokenKeyFromEnv } from '../../secrets.ts';
import { zohoMailClientFromEnv } from './zoho-oauth.ts';
import { originOf, type MailSource } from './types.ts';

export const MAIL_POLL_INTERVAL_MS = 5 * 60_000;

export interface PollStats {
  mailbox: string; fetched: number; created: number; duplicates: number; skipped: number; filed: number; queued: number;
  dispatches: number; proposals: number; attachments: number; errors: string[];
  /** Wave 6: kept apart as bulk, filed to the firm inbox without a queue row (the memory said not a project email), ready for one tap. */
  bulk?: number; dismissed?: number; ready?: number;
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
  const capDeps: CaptureDeps = { ...deps, origin: deps.origin ?? originOf(source), context: deps.context ?? source.context, rules: deps.rules ?? await loadRules(db) };
  try {
    for await (const { message, cursor } of source.fetch(start, backfill ? { since: opts.since } : {})) {
      s.fetched++;
      const r = await captureMessage(db, storage, message, capDeps);
      if (r.status === 'created') {
        s.created++; if (r.filed) s.filed++; else if (r.queue_id) s.queued++;
        if (r.outcome === 'bulk') s.bulk = (s.bulk ?? 0) + 1; else if (r.outcome === 'dismissed') s.dismissed = (s.dismissed ?? 0) + 1; else if (r.outcome === 'ready') s.ready = (s.ready ?? 0) + 1;
        s.attachments += r.attachment_ids.length; s.dispatches += r.dispatch_ids.length; s.proposals += r.proposals.length;
      }
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

/* ── mailboxes connected by consent (wave 6, D60) ── */

export interface ConnectionRow { id: string; person_id: string; address: string; account_id: string; accounts_url: string; api_url: string; refresh_token_enc: string; privacy: 'all' | 'subjects' | 'none'; status: string; history_cursor: string | null; history_window_days: number; history_done_at: string | null }
export type ConnectedSource = ZohoMailSource & { connection: ConnectionRow };
export interface ConnectionSourceOptions { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; pageSize?: number }

/** One Zoho source per live connection, with the person's refresh token opened from its sealed form. A missing key or client means none. */
export async function sourcesFromConnections(db: Db, o: ConnectionSourceOptions = {}): Promise<ConnectedSource[]> {
  const env = o.env ?? process.env;
  const key = tokenKeyFromEnv(env), client = zohoMailClientFromEnv(env);
  if (!key || !client) return [];
  const rows = (await db.query<ConnectionRow>(`SELECT id, person_id, address, account_id, accounts_url, api_url, refresh_token_enc, privacy, status, history_cursor, history_window_days, history_done_at FROM mailbox_connections WHERE status <> 'revoked' AND provider = 'zoho-mail' ORDER BY connected_at`)).rows;
  const out: ConnectedSource[] = [];
  for (const c of rows) {
    let refreshToken: string;
    try { refreshToken = openSecret(c.refresh_token_enc, key); }
    catch (e) { await db.query(`UPDATE mailbox_connections SET status = 'error', last_error = $2 WHERE id = $1`, [c.id, `token cannot be opened: ${(e as Error).message}`]); continue; }
    const src = new ZohoMailSource({ address: c.address, accountId: c.account_id, apiUrl: c.api_url, accountsUrl: c.accounts_url, clientId: client.clientId, clientSecret: client.clientSecret, refreshToken, fetch: o.fetch, sleep: o.sleep, now: o.now, pageSize: o.pageSize }) as ConnectedSource;
    src.context = { person_id: c.person_id, privacy: c.privacy, connection_id: c.id };
    src.connection = c;
    out.push(src);
  }
  return out;
}

/** Record how the poll went for a connection: the time, and an error that pauses nothing but is shown on the Settings card. */
async function noteConnection(db: Db, c: ConnectionRow, errors: string[]): Promise<void> {
  const err = errors.find(e => !/^attachment |^index /.test(e.split(': ').slice(1).join(': '))) ?? null;
  await db.query(`UPDATE mailbox_connections SET last_poll_at = now(), last_error = $2, status = CASE WHEN $2::text IS NULL THEN 'connected' ELSE 'error' END WHERE id = $1 AND status <> 'revoked'`, [c.id, err ? err.slice(0, 300) : null]);
}

export const HISTORY_SLICE = 100;
export const HISTORY_CAP = 20_000;

/**
 * One slice of history for a connection (P55): newest first, down to the window, at most HISTORY_SLICE messages a poll
 * and HISTORY_CAP in all; tagged history, no organisation proposals, queued only with a known counterparty. Resumes
 * from the stored cursor after a crash; dedupe makes a repeated page harmless.
 */
export async function historySlice(db: Db, storage: Storage, src: ConnectedSource, deps: Omit<CaptureDeps, 'origin'>, o: { limit?: number; now?: () => Date } = {}): Promise<{ fetched: number; created: number; done: boolean; errors: string[] }> {
  const c = src.connection;
  const out = { fetched: 0, created: 0, done: !!c.history_done_at, errors: [] as string[] };
  if (c.history_done_at || c.history_window_days <= 0 || c.privacy === 'none') { if (!c.history_done_at) await db.query('UPDATE mailbox_connections SET history_done_at = now() WHERE id = $1', [c.id]); return { ...out, done: true }; }
  let cursor: HistoryCursor | null = null;
  try { cursor = c.history_cursor ? JSON.parse(c.history_cursor) : null; } catch { cursor = null; }
  const count = Number(cursor?.count ?? 0);
  const now = o.now ?? (() => new Date());
  const windowStart = new Date(now().getTime() - c.history_window_days * 864e5);
  const limit = Math.max(0, Math.min(o.limit ?? HISTORY_SLICE, HISTORY_CAP - count));
  if (limit === 0) { await db.query('UPDATE mailbox_connections SET history_done_at = now() WHERE id = $1', [c.id]); return { ...out, done: true }; }
  const capDeps: CaptureDeps = { ...deps, origin: 'zoho-mail', context: src.context, history: true, rules: deps.rules ?? await loadRules(db) };
  try {
    const slice = await src.fetchHistory(cursor, { windowStart, limit });
    for (const message of slice.messages) {
      out.fetched++;
      const r = await captureMessage(db, storage, message, capDeps);
      if (r.status === 'created') out.created++;
      for (const e of r.errors) out.errors.push(`${message.external_id}: ${e}`);
    }
    const next: HistoryCursor = { ...slice.cursor, count: count + slice.messages.length };
    await db.query('UPDATE mailbox_connections SET history_cursor = $2 WHERE id = $1', [c.id, JSON.stringify(next)]);
    if (slice.done) { await db.query('UPDATE mailbox_connections SET history_done_at = now() WHERE id = $1 AND history_done_at IS NULL', [c.id]); out.done = true; }
  } catch (e) {
    out.errors.push(`${src.id}: history: ${(e as Error).message}`);   // the cursor stays at the last stored page
  }
  return out;
}

export interface RunPollOptions { sources?: MailSource[]; since?: Date; limit?: number; connections?: ConnectionSourceOptions | false; /** Already-built connected sources (the job builds them once). */ connected?: ConnectedSource[]; historyLimit?: number; now?: () => Date }
export interface PollSummary { mailboxes: PollStats[]; dispatches_resolved: number; history?: Array<{ mailbox: string; fetched: number; created: number; done: boolean; errors: string[] }>; relationships?: number }

/** Every mailbox: the environment's (IMAP, Gmail) and the connections by consent; then a slice of history per connection; then the relationships. */
export async function pollAll(db: Db, storage: Storage, deps: Omit<CaptureDeps, 'origin'>, opts: RunPollOptions = {}): Promise<PollSummary> {
  const connected = opts.connected ?? (opts.connections === false ? [] : await sourcesFromConnections(db, opts.connections ?? {}));
  const taken = new Set(connected.map(c => c.id));
  const sources = [...(opts.sources ?? sourcesFromEnv()).filter(s => !taken.has(s.id)), ...connected];   // a consented connection supersedes an env mailbox of the same address
  const rules = deps.rules ?? await loadRules(db);
  const mailboxes: PollStats[] = [];
  for (const src of sources) {
    let stats: PollStats;
    try { stats = await pollMailbox(db, storage, src, { ...deps, rules }, { since: opts.since, limit: opts.limit }); }
    catch (e) { stats = { mailbox: src.id, fetched: 0, created: 0, duplicates: 0, skipped: 0, filed: 0, queued: 0, dispatches: 0, proposals: 0, attachments: 0, errors: [`${src.id}: ${(e as Error).message}`] }; }
    mailboxes.push(stats);
    if ((src as ConnectedSource).connection) await noteConnection(db, (src as ConnectedSource).connection, stats.errors.filter(e => !(e.includes(': attachment ') || e.includes(': index '))));
  }
  const history: PollSummary['history'] = [];
  for (const src of connected) {
    const h = await historySlice(db, storage, src, { ...deps, rules }, { limit: opts.historyLimit, now: opts.now });
    history.push({ mailbox: src.id, ...h });
    if (h.errors.length && !(h.errors[0].includes('rate limit'))) await db.query(`UPDATE mailbox_connections SET last_error = $2 WHERE id = $1 AND status <> 'revoked'`, [src.connection.id, h.errors[0].slice(0, 300)]);
  }
  const dispatches_resolved = await resolvePendingDispatches(db, { firm: deps.firmDomains });
  const relationships = sources.length ? await recomputeRelationships(db, { firm: deps.firmDomains }) : 0;
  return { mailboxes, dispatches_resolved, history, relationships };
}

export { ZohoHttpError };
