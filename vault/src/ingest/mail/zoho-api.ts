/**
 * Zoho Mail REST source (wave 6, D60, P50): a person's mailbox read through the Zoho Mail API with the refresh
 * token they granted at sign-in, so no app password exists anywhere.
 *
 * Reading: Inbox and Sent are listed newest first (`messages/view`, sortBy date, 200 a page; the API has no "since",
 * so paging stops at the last message the cursor names or at a date). Each message is fetched as its raw MIME
 * (`originalmessage`) and parsed by the same code as IMAP and Gmail, so the three sources yield the same RawMessage.
 * The cursor is one JSON object per folder: `{"inbox":{"last":"<messageId>","time":<receivedTime ms>}, "sent":{…}}`.
 *
 * History (P55): `fetchHistory` walks a folder backwards by page offset from a stored position, newest first, until
 * the window's start, so a slice of a few hundred messages can run on every poll without re-reading the top.
 *
 * Rate: Zoho allows 30 requests a minute per account; the source paces itself and treats a 429 or a lock-out as
 * a pause (the poll records the error and keeps the cursor). All HTTP goes through the injected fetch.
 */
import type { FetchOptions, MailFolder, MailSource, MailboxContext, RawMessage } from './types.ts';
import { parseRfc822 } from './parse.ts';

export class ZohoHttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export interface ZohoMailSourceOptions {
  /** The mailbox address: the cursor key and RawMessage.mailbox. */
  address: string;
  accountId: string;
  /** The data centre's mail API host, e.g. https://mail.zoho.eu. */
  apiUrl: string;
  /** The data centre's accounts server, for the token refresh. */
  accountsUrl: string;
  clientId: string; clientSecret: string; refreshToken: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pageSize?: number;
  /** Requests a minute (Zoho: 30). */
  perMinute?: number;
  onSkip?: (info: { folder: string; messageId: string; error: string }) => void;
}

interface Listed { messageId: string; folderId: string; receivedTime: number; folder: MailFolder; status?: string; flagid?: string }
type Cursor = Record<string, { last: string; time: number }>;
export interface FolderPos { start: number; done: boolean }
export interface HistoryCursor { inbox?: FolderPos; sent?: FolderPos; /** messages brought in so far, against the cap */ count?: number }
type FolderKey = 'inbox' | 'sent';

const FOLDER_KINDS: Array<[MailFolder, RegExp]> = [['inbox', /^inbox$/i], ['sent', /^sent(\s*(items|mail))?$/i]];

export function parseZohoCursor(s: string | null): Cursor {
  if (!s) return {};
  try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

export class ZohoMailSource implements MailSource {
  readonly id: string;
  readonly origin = 'zoho-mail' as const;
  /** The person and privacy level of a mailbox connected by consent; set by the poll. */
  context?: MailboxContext;
  private token: string | null = null;
  private tokenExp = 0;
  private folders: Array<{ id: string; kind: MailFolder; name: string }> | null = null;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private stamps: number[] = [];

  constructor(private readonly o: ZohoMailSourceOptions) {
    this.id = `zoho-mail:${o.address.toLowerCase()}`;
    this.f = o.fetch ?? fetch;
    this.sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  /* ── auth and HTTP ── */
  private async accessToken(force = false): Promise<string> {
    if (this.token && !force && this.now() < this.tokenExp - 60_000) return this.token;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.o.refreshToken, client_id: this.o.clientId, client_secret: this.o.clientSecret });
    const res = await this.f(`${this.o.accountsUrl.replace(/\/+$/, '')}/oauth/v2/token`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new ZohoHttpError(res.status === 200 ? 401 : res.status, `zoho token refresh failed (${res.status}): ${j.error ?? 'no access_token'}`);
    this.token = j.access_token; this.tokenExp = this.now() + (Number(j.expires_in) || 3600) * 1000;
    return this.token!;
  }
  private async pace(): Promise<void> {
    const per = this.o.perMinute ?? 30, t = this.now();
    this.stamps = this.stamps.filter(s => t - s < 60_000);
    if (this.stamps.length >= per) { const wait = 60_000 - (t - this.stamps[0]) + 50; await this.sleep(wait); this.stamps = this.stamps.filter(s => this.now() - s < 60_000); }
    this.stamps.push(this.now());
  }
  private async api(path: string, params: Record<string, string | number | undefined> = {}, accept = 'application/json'): Promise<Response> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.append(k, String(v));
    const url = `${this.o.apiUrl.replace(/\/+$/, '')}/api/accounts/${encodeURIComponent(this.o.accountId)}${path}${qs.size ? `?${qs}` : ''}`;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await this.pace();
      const res = await this.f(url, { headers: { authorization: `Zoho-oauthtoken ${await this.accessToken()}`, accept } });
      if (res.ok) return res;
      if (res.status === 401 && !refreshed) { refreshed = true; await this.accessToken(true); continue; }
      if (res.status >= 500 && attempt < 2) { await this.sleep(500 * 2 ** attempt); continue; }
      if (res.status === 429) throw new ZohoHttpError(429, `zoho rate limit on ${path}: the mailbox pauses until the next poll`);
      throw new ZohoHttpError(res.status, `zoho ${path} failed (${res.status})`);
    }
  }
  private async json(path: string, params?: Record<string, string | number | undefined>): Promise<any> { return (await this.api(path, params)).json(); }

  /* ── folders ── */
  private async folderList(): Promise<Array<{ id: string; kind: MailFolder; name: string }>> {
    if (this.folders) return this.folders;
    const j = await this.json('/folders');
    const out: Array<{ id: string; kind: MailFolder; name: string }> = [];
    for (const fo of j.data ?? []) {
      const type = String(fo.folderType ?? ''), name = String(fo.folderName ?? '');
      const kind = FOLDER_KINDS.find(([, re]) => re.test(type) || re.test(name))?.[0];
      if (kind && !out.some(x => x.kind === kind)) out.push({ id: String(fo.folderId), kind, name });
    }
    if (!out.some(x => x.kind === 'inbox')) throw new ZohoHttpError(404, 'zoho mailbox has no Inbox folder');
    return (this.folders = out);
  }

  /* ── one page of a folder, newest first ── */
  private async page(folder: { id: string; kind: MailFolder }, start: number): Promise<Listed[]> {
    const j = await this.json('/messages/view', { folderId: folder.id, start, limit: this.o.pageSize ?? 200, sortBy: 'date', sortorder: 'false', includesent: folder.kind === 'sent' ? 'true' : undefined });
    return (j.data ?? []).map((m: any) => ({ messageId: String(m.messageId), folderId: String(m.folderId ?? folder.id), receivedTime: Number(m.receivedTime ?? m.sentDateInGMT ?? 0), folder: folder.kind, status: m.status, flagid: m.flagid }));
  }

  /** The raw MIME of one message (JSON with the content, or the bytes themselves), parsed like IMAP and Gmail. */
  private async load(m: Listed): Promise<RawMessage | null> {
    let raw: Buffer;
    try {
      const res = await this.api(`/messages/${encodeURIComponent(m.messageId)}/originalmessage`, {}, 'application/json, message/rfc822, text/plain');
      const ct = res.headers.get('content-type') ?? '';
      if (/json/i.test(ct)) {
        const j: any = await res.json();
        const content = j?.data?.messageContent ?? j?.data?.content ?? j?.data?.originalMessage ?? j?.data ?? '';
        raw = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
      } else raw = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof ZohoHttpError && e.status === 404) return null;   // deleted since it was listed
      throw e;
    }
    const labels: string[] = [];
    if (m.status && /unread/i.test(String(m.status))) labels.push('Unread');
    if (m.flagid && String(m.flagid) !== '0' && !/^flag_not_set$/i.test(String(m.flagid))) labels.push(String(m.flagid));
    try {
      return await parseRfc822(raw, { mailbox: this.o.address.toLowerCase(), folder: m.folder, labels, fallbackDate: m.receivedTime ? new Date(m.receivedTime) : undefined, fallbackId: `zoho-${this.o.address.toLowerCase()}-${m.messageId}@generated.invalid` });
    } catch (e) { this.o.onSkip?.({ folder: m.folder, messageId: m.messageId, error: (e as Error).message }); return null; }
  }

  /** New messages since the cursor (everything, or everything since `opts.since` on a backfill), oldest first per folder. */
  async *fetch(cursor: string | null, opts: FetchOptions = {}): AsyncGenerator<{ message: RawMessage; cursor: string }> {
    const state = parseZohoCursor(cursor);
    const size = this.o.pageSize ?? 200;
    for (const folder of await this.folderList()) {
      const prev = state[folder.kind];
      const since = opts.since?.getTime();
      const fresh: Listed[] = [];
      for (let start = 1; ; start += size) {
        const rows = await this.page(folder, start);
        let stop = false;
        for (const r of rows) {
          if (prev && (r.messageId === prev.last || r.receivedTime < prev.time)) { stop = true; break; }
          if (!prev && since !== undefined && r.receivedTime < since) { stop = true; break; }
          fresh.push(r);
        }
        if (stop || rows.length < size) break;
      }
      // Oldest first, so the cursor only ever moves forward; the newest of the batch becomes the folder's cursor.
      fresh.sort((a, b) => a.receivedTime - b.receivedTime || a.messageId.localeCompare(b.messageId));
      for (const r of fresh) {
        const message = await this.load(r);
        state[folder.kind] = { last: r.messageId, time: r.receivedTime };
        if (!message) continue;
        yield { message, cursor: JSON.stringify(state) };
      }
    }
  }

  /**
   * One slice of history: from each folder's stored page offset, newest first, down to `windowStart`; at most
   * `limit` messages in this call. Returns the messages, the cursor to store, and whether every folder is done.
   */
  async fetchHistory(cursor: HistoryCursor | null, o: { windowStart: Date; limit: number }): Promise<{ messages: RawMessage[]; cursor: HistoryCursor; done: boolean }> {
    const state: HistoryCursor = { ...(cursor ?? {}) };
    const size = this.o.pageSize ?? 200;
    const out: RawMessage[] = [];
    for (const folder of await this.folderList()) {
      const key = folder.kind as FolderKey;
      const st: FolderPos = state[key] ?? { start: 1, done: false };
      if (st.done) { state[key] = st; continue; }
      while (out.length < o.limit) {
        const rows = await this.page(folder, st.start);
        if (!rows.length) { st.done = true; break; }
        let consumed = 0;
        for (const r of rows) {
          if (out.length >= o.limit) break;                                   // the rest of this page waits for the next slice
          consumed++;
          if (r.receivedTime < o.windowStart.getTime()) { st.done = true; break; }
          const message = await this.load(r);
          if (message) out.push(message);
        }
        st.start += consumed;
        if (consumed === rows.length && rows.length < size) st.done = true;
        if (st.done || out.length >= o.limit) break;
      }
      state[key] = st;
      if (out.length >= o.limit) break;
    }
    const folders = await this.folderList();
    return { messages: out, cursor: state, done: folders.every(fo => state[fo.kind as FolderKey]?.done) };
  }
}
