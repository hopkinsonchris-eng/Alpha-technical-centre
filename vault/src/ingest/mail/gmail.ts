/**
 * Gmail mail source (M10): the Gmail REST API over fetch, no client library.
 *
 * Auth: OAuth refresh token (GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN) exchanged for an
 * access token, refreshed once on a 401. The cursor is a Gmail historyId:
 *  - empty cursor  → full backfill with users.messages.list (oldest first). The mailbox's current historyId is read first and
 *                    becomes the cursor once the backfill completes, so nothing that arrives during it is missed. While it runs
 *                    the cursor is `<historyId>@<last message id done>` so a crash resumes instead of restarting.
 *  - historyId     → users.history.list (messageAdded) from that id. A 404 means Gmail no longer holds that history; the source
 *                    falls back to the full backfill (dedupe makes it safe).
 * Messages are fetched with format=raw and parsed by the same code as IMAP, so both adapters yield the same RawMessage.
 * `fetch` and `sleep` are injectable; tests replay recorded responses.
 */
import type { FetchOptions, MailFolder, MailSource, RawMessage } from './types.ts';
import { parseRfc822 } from './parse.ts';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GmailSourceOptions {
  clientId: string; clientSecret: string; refreshToken: string;
  /** The mailbox address for RawMessage.mailbox and the mail_cursors key. Read from users.getProfile when omitted. */
  mailbox?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pageSize?: number;
}

class GmailHttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export class GmailSource implements MailSource {
  readonly origin = 'gmail' as const;
  private token: string | null = null;
  private labelNames: Map<string, string> | null = null;
  private address: string | null;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: GmailSourceOptions) {
    this.f = o.fetch ?? fetch;
    this.sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    this.address = o.mailbox?.toLowerCase() ?? null;
  }

  /** The cursor key. Fixed at construction (set GMAIL_MAILBOX to the address; `gmail:me` otherwise). */
  get id(): string { return `gmail:${this.o.mailbox?.toLowerCase() ?? 'me'}`; }

  private async accessToken(force = false): Promise<string> {
    if (this.token && !force) return this.token;
    const res = await this.f(TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, refresh_token: this.o.refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    if (!res.ok) throw new GmailHttpError(res.status, `gmail token refresh failed (${res.status})`);
    const j: any = await res.json();
    if (!j.access_token) throw new Error('gmail token refresh returned no access_token');
    return (this.token = j.access_token as string);
  }

  private async api<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.append(k, String(v));
    const url = `${API}${path}${qs.size ? `?${qs}` : ''}`;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await this.f(url, { headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && !refreshed) { refreshed = true; await this.accessToken(true); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await this.sleep(500 * 2 ** attempt); continue; }
      throw new GmailHttpError(res.status, `gmail ${path} failed (${res.status})`);
    }
  }

  private async labels(): Promise<Map<string, string>> {
    if (!this.labelNames) {
      const j = await this.api<{ labels?: Array<{ id: string; name: string }> }>('/labels');
      this.labelNames = new Map((j.labels ?? []).map(l => [l.id, l.name]));
    }
    return this.labelNames;
  }

  private async load(id: string): Promise<RawMessage | null> {
    let m: any;
    try { m = await this.api('/messages/' + encodeURIComponent(id), { format: 'raw' }); }
    catch (e) { if (e instanceof GmailHttpError && e.status === 404) return null; throw e; }   // deleted since it was listed
    const ids: string[] = m.labelIds ?? [];
    if (ids.includes('DRAFT') || ids.includes('SPAM') || ids.includes('TRASH')) return null;
    const names = await this.labels();
    const folder: MailFolder = ids.includes('SENT') ? 'sent' : ids.includes('INBOX') ? 'inbox' : 'other';
    const raw = Buffer.from(String(m.raw ?? ''), 'base64url');
    return parseRfc822(raw, {
      mailbox: this.address ?? 'me', folder, labels: ids.map(i => names.get(i) ?? i),
      fallbackDate: m.internalDate ? new Date(Number(m.internalDate)) : undefined,
      fallbackId: `gmail-${m.id}@generated.invalid`,
    });
  }

  private async listAll(since?: Date): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const j: any = await this.api('/messages', { maxResults: this.o.pageSize ?? 500, pageToken, q: since ? `after:${since.toISOString().slice(0, 10).replace(/-/g, '/')}` : undefined });
      for (const m of j.messages ?? []) ids.push(m.id);
      pageToken = j.nextPageToken;
    } while (pageToken);
    return ids.reverse();          // the API lists newest first
  }

  async *fetch(cursor: string | null, opts: FetchOptions = {}): AsyncGenerator<{ message: RawMessage; cursor: string }> {
    if (!this.address) this.address = String((await this.api('/profile')).emailAddress ?? 'me').toLowerCase();
    if (cursor && /^\d+$/.test(cursor)) {
      try { yield* this.fromHistory(cursor); return; }
      catch (e) { if (!(e instanceof GmailHttpError && e.status === 404)) throw e; }   // history expired
      cursor = null;
    }
    yield* this.backfill(cursor, opts);
  }

  private async *backfill(cursor: string | null, opts: FetchOptions): AsyncGenerator<{ message: RawMessage; cursor: string }> {
    const resume = cursor ? /^(\d+)@(.+)$/.exec(cursor) : null;
    const startHistory = resume ? resume[1] : String((await this.api('/profile')).historyId);
    let ids = await this.listAll(opts.since);
    if (resume) { const at = ids.indexOf(resume[2]); if (at >= 0) ids = ids.slice(at + 1); }
    const pending: Array<{ message: RawMessage; id: string }> = [];
    for (let i = 0; i < ids.length; i++) {
      const message = await this.load(ids[i]);
      if (!message) continue;
      pending.push({ message, id: ids[i] });
      // One message is held back so the last yield can carry the clean historyId.
      if (pending.length > 1) { const p = pending.shift()!; yield { message: p.message, cursor: `${startHistory}@${p.id}` }; }
    }
    if (pending[0]) yield { message: pending[0].message, cursor: startHistory };
  }

  private async *fromHistory(startHistoryId: string): AsyncGenerator<{ message: RawMessage; cursor: string }> {
    let pageToken: string | undefined;
    const seen = new Set<string>();
    const batch: Array<{ id: string; at: string }> = [];
    let latest = startHistoryId;
    do {
      const j: any = await this.api('/history', { startHistoryId, historyTypes: 'messageAdded', maxResults: 500, pageToken });
      for (const h of j.history ?? []) for (const a of h.messagesAdded ?? []) {
        const id = a.message?.id;
        if (id && !seen.has(id)) { seen.add(id); batch.push({ id, at: String(h.id) }); }
      }
      if (j.historyId) latest = String(j.historyId);
      pageToken = j.nextPageToken;
    } while (pageToken);
    const held: Array<{ message: RawMessage; at: string }> = [];
    for (const b of batch) {
      const message = await this.load(b.id);
      if (!message) continue;
      held.push({ message, at: b.at });
      if (held.length > 1) { const p = held.shift()!; yield { message: p.message, cursor: p.at }; }
    }
    if (held[0]) yield { message: held[0].message, cursor: latest };
  }
}

export function gmailSourceFromEnv(env: NodeJS.ProcessEnv = process.env, o: Partial<GmailSourceOptions> = {}): GmailSource | null {
  const clientId = env.GMAIL_OAUTH_CLIENT_ID, clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET, refreshToken = env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return new GmailSource({ clientId, clientSecret, refreshToken, mailbox: env.GMAIL_MAILBOX, ...o });
}
