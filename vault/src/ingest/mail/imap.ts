/**
 * IMAP mail source (M10): Zoho Mail (imappro.zoho.com) or any IMAP server, through imapflow, parsed with mailparser.
 *
 * Folders are INBOX and Sent (ZOHO_MAIL_IMAP_SENT_FOLDER overrides the name). The cursor is one JSON object,
 * `{"INBOX":"<UIDVALIDITY>:<UID>","Sent":"<UIDVALIDITY>:<UID>"}`: the last UID done in each folder. When a folder's
 * UIDVALIDITY changes the server has renumbered it, so that folder restarts from the beginning (dedupe makes that safe).
 *
 * The client is built by an injectable factory; tests pass a recorded fake that speaks the same subset of ImapFlow.
 * Env: ZOHO_MAIL_IMAP_HOST (default imappro.zoho.com), ZOHO_MAIL_IMAP_USER / ZOHO_MAIL_IMAP_PASSWORD, and for further
 * mailboxes (each partner's) ZOHO_MAIL_IMAP_USER_2 / ZOHO_MAIL_IMAP_PASSWORD_2 … _9.
 */
import type { FetchOptions, MailFolder, MailSource, RawMessage } from './types.ts';
import { parseRfc822 } from './parse.ts';

/** The part of ImapFlow this source uses. */
export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  readonly mailbox: false | { uidValidity: bigint | number | string };
  search(query: { since?: Date }, options?: { uid?: boolean }): Promise<number[] | false | undefined>;
  fetch(range: string, query: { uid: true; source: true; flags: true; internalDate: true }, options: { uid: true }): AsyncIterable<{ uid: number; source?: Buffer | Uint8Array; flags?: Set<string> | string[]; internalDate?: Date | string }>;
}
export type ImapClientFactory = () => ImapClientLike | Promise<ImapClientLike>;

export interface ImapSourceOptions {
  user: string;
  password?: string;
  host?: string;
  port?: number;
  /** Folder path → kind. Default INBOX and Sent. */
  folders?: Array<{ path: string; kind: MailFolder }>;
  clientFactory?: ImapClientFactory;
  /** Messages per FETCH when searching by date. */
  batch?: number;
  onSkip?: (info: { folder: string; uid: number; error: string }) => void;
}

type Cursor = Record<string, string>;
export function parseCursor(s: string | null): Cursor {
  if (!s) return {};
  try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
const splitEntry = (v: string | undefined): { validity: string; uid: number } | null => {
  const m = /^(\d+):(\d+)$/.exec(v ?? '');
  return m ? { validity: m[1], uid: Number(m[2]) } : null;
};

async function defaultFactory(o: ImapSourceOptions): Promise<ImapClientLike> {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({ host: o.host ?? 'imappro.zoho.com', port: o.port ?? 993, secure: true, auth: { user: o.user, pass: o.password ?? '' }, logger: false });
  client.on('error', () => { /* surfaced by the command that was running; an unhandled 'error' event would end the process */ });
  return client as unknown as ImapClientLike;
}

export class ImapSource implements MailSource {
  readonly id: string;
  readonly origin = 'zoho-mail' as const;
  private readonly folders: Array<{ path: string; kind: MailFolder }>;

  constructor(private readonly o: ImapSourceOptions) {
    this.id = `zoho-mail:${o.user.toLowerCase()}`;
    this.folders = o.folders ?? [{ path: 'INBOX', kind: 'inbox' }, { path: process.env.ZOHO_MAIL_IMAP_SENT_FOLDER || 'Sent', kind: 'sent' }];
  }

  async *fetch(cursor: string | null, opts: FetchOptions = {}): AsyncGenerator<{ message: RawMessage; cursor: string }> {
    const client = await (this.o.clientFactory ?? (() => defaultFactory(this.o)))();
    await client.connect();
    const state = parseCursor(cursor);
    const mailbox = this.o.user.toLowerCase();
    try {
      for (const folder of this.folders) {
        let lock: { release(): void };
        try { lock = await client.getMailboxLock(folder.path); }
        catch (e) { if (folder.kind === 'inbox') throw e; continue; }   // a mailbox without a Sent folder is not an error
        try {
          const validity = String(client.mailbox ? client.mailbox.uidValidity : '0');
          const prev = splitEntry(state[folder.path]);
          const lastUid = prev && prev.validity === validity ? prev.uid : 0;

          const uids: number[] | null = !cursor && opts.since ? ((await client.search({ since: opts.since }, { uid: true })) || []).slice().sort((a, b) => a - b) : null;
          const ranges: string[] = uids
            ? Array.from({ length: Math.ceil(uids.length / (this.o.batch ?? 100)) }, (_, i) => uids.slice(i * (this.o.batch ?? 100), (i + 1) * (this.o.batch ?? 100)).join(','))
            : [`${lastUid + 1}:*`];

          for (const range of ranges) {
            for await (const m of client.fetch(range, { uid: true, source: true, flags: true, internalDate: true }, { uid: true })) {
              if (!uids && m.uid <= lastUid) continue;              // `N:*` always returns the last message, even when it is older than N
              if (!m.source) continue;
              let message: RawMessage;
              try {
                message = await parseRfc822(m.source, {
                  mailbox, folder: folder.kind, labels: [...(m.flags ?? [])],
                  fallbackDate: m.internalDate ? new Date(m.internalDate) : undefined,
                  fallbackId: `imap-${mailbox}-${folder.path}-${validity}-${m.uid}@generated.invalid`,
                });
              } catch (e) {
                this.o.onSkip?.({ folder: folder.path, uid: m.uid, error: (e as Error).message });
                state[folder.path] = `${validity}:${m.uid}`;
                continue;
              }
              state[folder.path] = `${validity}:${m.uid}`;
              yield { message, cursor: JSON.stringify(state) };
            }
          }
        } finally { lock.release(); }
      }
    } finally {
      try { await client.logout(); } catch { /* connection already gone */ }
    }
  }
}

/** Every Zoho mailbox configured in the environment (none when ZOHO_MAIL_IMAP_USER is unset). */
export function zohoSourcesFromEnv(env: NodeJS.ProcessEnv = process.env, clientFactory?: ImapClientFactory): ImapSource[] {
  const host = env.ZOHO_MAIL_IMAP_HOST || 'imappro.zoho.com';
  const out: ImapSource[] = [];
  for (const n of ['', '_2', '_3', '_4', '_5', '_6', '_7', '_8', '_9']) {
    const user = env[`ZOHO_MAIL_IMAP_USER${n}`], password = env[`ZOHO_MAIL_IMAP_PASSWORD${n}`];
    if (user && password) out.push(new ImapSource({ user, password, host, clientFactory }));
  }
  return out;
}
