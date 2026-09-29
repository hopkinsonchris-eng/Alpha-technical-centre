/** Replays of the recorded mailbox: a fake ImapFlow and a fake fetch for the Gmail REST API. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImapClientLike } from '../../../src/ingest/mail/imap.ts';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const MAILBOX = 'info@alpha-technical-centre.com';
const json = (rel: string) => JSON.parse(readFileSync(path.join(DIR, rel), 'utf8'));
export const readEml = (rel: string) => readFileSync(path.join(DIR, rel));
export const manifest: { mailbox: string; messages: Array<{ n: number; file: string; message_id: string; folder: 'inbox' | 'sent'; uid: number; gmail_id: string; late: boolean; date: string }> } = json('mailbox.json');

export interface ImapCalls { locks: string[]; fetches: string[]; searches: unknown[]; connects: number; logouts: number }

/** A recorded IMAP server holding INBOX and Sent. `late` includes the message that arrives after the first poll. */
export function fakeImapFactory(o: { late?: boolean; uidValidity?: { INBOX?: number; Sent?: number }; calls?: ImapCalls } = {}): () => ImapClientLike {
  const calls: ImapCalls = o.calls ?? { locks: [], fetches: [], searches: [], connects: 0, logouts: 0 };
  return () => {
    let open: any = null;
    const client: ImapClientLike = {
      async connect() { calls.connects++; },
      async logout() { calls.logouts++; },
      async getMailboxLock(p: string) {
        const f = json(`imap/${p}.json`);
        open = { ...f, uidValidity: o.uidValidity?.[p as 'INBOX' | 'Sent'] ?? f.uidValidity, messages: f.messages.filter((m: any) => o.late || !m.late) };
        calls.locks.push(p);
        return { release() { open = null; } };
      },
      get mailbox() { return open ? { uidValidity: BigInt(open.uidValidity) } : false; },
      async search(q: { since?: Date }) {
        calls.searches.push(q.since?.toISOString());
        return open.messages.filter((m: any) => !q.since || new Date(m.internalDate) >= q.since).map((m: any) => m.uid);
      },
      async *fetch(range: string) {
        calls.fetches.push(`${open.path}:${range}`);
        const wanted = new Set<number>();
        let star: number | null = null;
        for (const part of range.split(',')) {
          const m = /^(\d+):(\*|\d+)$/.exec(part);
          if (m) { const lo = Number(m[1]); if (m[2] === '*') star = lo; else for (let u = lo; u <= Number(m[2]); u++) wanted.add(u); }
          else wanted.add(Number(part));
        }
        const max = Math.max(0, ...open.messages.map((m: any) => m.uid));
        for (const m of open.messages) {
          const hit = wanted.has(m.uid) || (star !== null && (m.uid >= star || (star > max && m.uid === max)));   // `N:*` always returns the last message, as a real server does
          if (hit) yield { uid: m.uid, source: readEml(m.file), flags: new Set<string>(m.flags), internalDate: m.internalDate };
        }
      },
    } as ImapClientLike;
    return client;
  };
}

export interface GmailCalls { urls: string[]; tokens: number }

/** A recorded Gmail API. `late` = the state after message 13 arrived; `failHistory404` makes history.list answer "too old". */
export function fakeGmailFetch(o: { late?: boolean; failHistory404?: boolean; calls?: GmailCalls; expireFirstToken?: boolean } = {}): typeof fetch {
  const calls = o.calls ?? { urls: [], tokens: 0 };
  let expired = !!o.expireFirstToken;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return (async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.host === 'oauth2.googleapis.com') { calls.tokens++; return reply({ access_token: `token-${calls.tokens}`, expires_in: 3600, token_type: 'Bearer' }); }
    calls.urls.push(url.pathname.replace('/gmail/v1/users/me', '') + url.search);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (expired && auth === 'Bearer token-1') { expired = false; return reply({ error: { code: 401 } }, 401); }
    const p = url.pathname.replace('/gmail/v1/users/me', '');
    if (p === '/profile') return reply(json(o.late ? 'gmail/profile-late.json' : 'gmail/profile.json'));
    if (p === '/labels') return reply(json('gmail/labels.json'));
    if (p === '/messages') {
      const page = json(url.searchParams.get('pageToken') ? 'gmail/messages.list.page2.json' : 'gmail/messages.list.page1.json');
      const after = url.searchParams.get('q')?.match(/after:(\d{4})\/(\d{2})\/(\d{2})/);
      if (after) {
        const since = Date.UTC(+after[1], +after[2] - 1, +after[3]);
        return reply({ messages: (page.messages as any[]).filter(m => Number(json(`gmail/messages/${m.id}.json`).internalDate) >= since) });
      }
      return reply(page);
    }
    const m = /^\/messages\/(g\d+)$/.exec(p);
    if (m) {
      try { return reply(json(`gmail/messages/${m[1]}.json`)); } catch { return reply({ error: { code: 404 } }, 404); }
    }
    if (p === '/history') {
      const start = Number(url.searchParams.get('startHistoryId'));
      if (o.failHistory404 || start < 1000) return reply({ error: { code: 404, message: 'Requested entity was not found.' } }, 404);
      if (o.late && start === 1000) return reply(json('gmail/history.after-1000.json'));
      return reply({ historyId: o.late ? '1010' : '1000' });
    }
    return reply({ error: { code: 404 } }, 404);
  }) as typeof fetch;
}
