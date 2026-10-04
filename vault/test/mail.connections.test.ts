// Wave 6, PR 2 (W6-AC2, W6-AC4): the poll reads every mailbox connected by consent through the Zoho API with the
// sealed token, records how it went, pauses on a rate limit, and brings the history in quiet slices.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { serviceSink } from '../src/ingest/items-client.ts';
import type { CaptureDeps } from '../src/ingest/mail/capture.ts';
import { HISTORY_CAP, historySlice, pollAll, sourcesFromConnections } from '../src/ingest/mail/poll.ts';
import { ImapSource } from '../src/ingest/mail/imap.ts';
import { sealSecret } from '../src/secrets.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import { fakeImapFactory, fakeZohoFetch, MAILBOX, type ZohoCalls } from './fixtures/mail/fakes.ts';

let h: Harness;
let deps: Omit<CaptureDeps, 'origin'>;
const KEY = randomBytes(32).toString('base64');
const ENV = { VAULT_TOKEN_KEY: KEY, ZOHO_MAIL_CLIENT_ID: '1000.X', ZOHO_MAIL_CLIENT_SECRET: 'shh', ALLOWED_EMAIL_DOMAIN: 'alpha-technical-centre.com' };
before(async () => { h = await setup('vault-mailconn-'); deps = { sink: await serviceSink(h.db), ingest: null }; });
after(async () => { await h.db.close(); });
const q = <T = any>(sql: string, p: unknown[] = []) => h.db.query<T>(sql, p).then(r => r.rows);
const wipe = async () => { await h.db.query('DELETE FROM mailbox_connections'); };

async function connection(o: { privacy?: string; windowDays?: number; address?: string; token?: string } = {}) {
  await wipe();
  const id = randomUUID();
  await h.db.query(`INSERT INTO people (id, email, name, role) VALUES ('info', $1, 'Info', 'associate') ON CONFLICT (id) DO NOTHING`, [MAILBOX]);
  await h.db.query(`INSERT INTO mailbox_connections (id, person_id, provider, address, account_id, accounts_url, api_url, refresh_token_enc, scopes, privacy, history_window_days) VALUES ($1,'info','zoho-mail',$2,'776','https://accounts.zoho.eu','https://mail.zoho.eu',$3,'{ZohoMail.messages.READ}',$4,$5)`,
    [id, o.address ?? MAILBOX, o.token ?? sealSecret('rt-1', Buffer.from(KEY, 'base64')), o.privacy ?? 'all', o.windowDays ?? 180]);
  return id;
}
const conn = async (id: string) => (await q('SELECT * FROM mailbox_connections WHERE id = $1', [id]))[0];

test('W6-AC2: a connection becomes a Zoho source with the opened token; the live poll captures the mailbox once, supersedes an env mailbox of the same address, and records the poll', async () => {
  const id = await connection();
  const calls: ZohoCalls = { urls: [], tokens: 0 };
  const sources = await sourcesFromConnections(h.db, { env: ENV, fetch: fakeZohoFetch({ calls }), sleep: async () => {}, pageSize: 5 });
  assert.equal(sources.length, 1); assert.equal(sources[0].id, 'zoho-mail:' + MAILBOX); assert.deepEqual(sources[0].context, { person_id: 'info', privacy: 'all', connection_id: id });
  assert.deepEqual(await sourcesFromConnections(h.db, { env: { ...ENV, VAULT_TOKEN_KEY: '' } }), [], 'no key, no sources');
  const imap = new ImapSource({ user: MAILBOX, clientFactory: fakeImapFactory() });
  const r = await pollAll(h.db, h.storage, deps, { sources: [imap], connections: { env: ENV, fetch: fakeZohoFetch({ calls }), sleep: async () => {}, pageSize: 5 }, historyLimit: 0, now: () => new Date('2026-03-21T00:00:00Z') });
  assert.equal(r.mailboxes.length, 1, 'the consented connection replaces the env mailbox of the same address');
  assert.equal(r.mailboxes[0].mailbox, 'zoho-mail:' + MAILBOX);
  assert.deepEqual([r.mailboxes[0].fetched, r.mailboxes[0].created, r.mailboxes[0].skipped, r.mailboxes[0].bulk, r.mailboxes[0].errors], [12, 12, 0, 1, []], 'through the API no IMAP flag marks the family lunch personal, so it is kept (the person blocks it from Settings); the newsletter is created but bulk');
  assert.ok(calls.urls.some(u => u.includes('/originalmessage')), 'read through the Zoho API');
  const c = await conn(id);
  assert.equal(c.status, 'connected'); assert.ok(c.last_poll_at); assert.equal(c.last_error, null);
  assert.equal((await q(`SELECT count(*)::int AS n FROM items WHERE origin->>'source' = 'zoho-mail' AND extracted->>'connection_id' = $1 AND parent_id IS NULL`, [id]))[0].n, 12);
  // Again: nothing new, the cursor held.
  const again = await pollAll(h.db, h.storage, deps, { sources: [], connections: { env: ENV, fetch: fakeZohoFetch({}), sleep: async () => {}, pageSize: 5 }, historyLimit: 0 });
  assert.deepEqual([again.mailboxes[0].fetched, again.mailboxes[0].created], [0, 0]);
  await wipe();
});

test('W6-AC2: a rate limit pauses the connection with its cursor and shows on the card; the next healthy poll recovers; a token that cannot be opened marks the connection in error', async () => {
  const id = await connection();
  await h.db.query(`DELETE FROM mail_cursors WHERE mailbox = $1`, ['zoho-mail:' + MAILBOX]);
  await h.db.query(`DELETE FROM items WHERE origin->>'source' = 'zoho-mail'`).catch(() => {});
  const limited = await pollAll(h.db, h.storage, deps, { sources: [], connections: { env: ENV, fetch: fakeZohoFetch({ rateLimitAfter: 4 }), sleep: async () => {}, pageSize: 5 }, historyLimit: 0 });
  assert.ok(limited.mailboxes[0].errors.some(e => /rate limit/.test(e)), JSON.stringify(limited.mailboxes[0].errors));
  const c1 = await conn(id);
  assert.equal(c1.status, 'error'); assert.match(c1.last_error, /rate limit/);
  const ok = await pollAll(h.db, h.storage, deps, { sources: [], connections: { env: ENV, fetch: fakeZohoFetch({}), sleep: async () => {}, pageSize: 5 }, historyLimit: 0 });
  assert.deepEqual(ok.mailboxes[0].errors, []);
  const c2 = await conn(id);
  assert.equal(c2.status, 'connected'); assert.equal(c2.last_error, null);
  await wipe();
  const bad = await connection({ token: 'v1.AAAA.BBBB.CCCC' });
  assert.deepEqual(await sourcesFromConnections(h.db, { env: ENV }), []);
  assert.equal((await conn(bad)).status, 'error'); assert.match((await conn(bad)).last_error, /cannot be opened/);
  await wipe();
});

test('W6-AC4: history arrives in slices, newest first, inside the window only, tagged history, with no organisation proposals and queue rows only for a known counterparty; it resumes after a failure and stops at the cap', async () => {
  // A database of its own: the live polls above already hold these messages, and dedupe would hide what history does.
  const fresh = await setup('vault-mailhist-');
  const h0 = h; h = fresh;
  deps = { sink: await serviceSink(h.db), ingest: null };
  try {
  const id = await connection({ windowDays: 10 });
  const now = () => new Date('2026-03-21T00:00:00Z');          // window: 11 March onwards → m08..m12
  const mkSrc = (o: Parameters<typeof fakeZohoFetch>[0] = {}) => sourcesFromConnections(h.db, { env: ENV, fetch: fakeZohoFetch(o), sleep: async () => {}, pageSize: 5 }).then(s => s[0]);
  const a = await historySlice(h.db, h.storage, await mkSrc(), deps, { limit: 2, now });
  assert.deepEqual([a.fetched, a.created, a.done, a.errors], [2, 2, false, []]);
  const c1 = await conn(id);
  assert.ok(c1.history_cursor); assert.equal(c1.history_done_at, null);
  assert.equal(JSON.parse(c1.history_cursor).count, 2);
  // A failure mid-slice keeps the cursor where the last stored page left it.
  const failed = await historySlice(h.db, h.storage, await mkSrc({ rateLimitAfter: 2 }), deps, { limit: 2, now });
  assert.ok(failed.errors.some(e => /rate limit/.test(e)));
  assert.equal((await conn(id)).history_cursor, c1.history_cursor, 'the cursor did not move');
  let done = false, guard = 0;
  while (!done && guard++ < 10) { const s = await historySlice(h.db, h.storage, await mkSrc(), deps, { limit: 2, now }); done = s.done; assert.deepEqual(s.errors, []); }
  assert.equal(done, true);
  const items = await q(`SELECT external_id, tags, extracted->>'history' AS hist, authored_at FROM items WHERE origin->>'source' = 'zoho-mail' AND parent_id IS NULL AND extracted->>'connection_id' = $1 ORDER BY external_id`, [id]);
  assert.deepEqual(items.map(i => i.external_id), ['m08@mail.fixture', 'm09@mail.fixture', 'm10@mail.fixture', 'm11@mail.fixture', 'm12@mail.fixture'], 'inside the window, nothing before, nothing twice');
  assert.ok(items.every(i => i.tags.includes('history') && i.hist === 'true'));
  assert.ok((await conn(id)).history_done_at);
  assert.equal((await q(`SELECT count(*)::int AS n FROM review_queue WHERE kind = 'organisation' AND payload->>'source' = 'mail-capture'`))[0].n, 0, 'history proposes no organisations');
  const queued = await q(`SELECT i.external_id FROM filing_queue f JOIN items i ON i.id = f.item_id WHERE i.extracted->>'connection_id' = $1`, [id]);
  assert.deepEqual(queued.map(x => x.external_id), [], 'm10 and m12 come from unknown senders: nothing waits in the queue for history');
  // Done stays done; the cap ends it early.
  const after = await historySlice(h.db, h.storage, await mkSrc(), deps, { limit: 2, now });
  assert.deepEqual([after.fetched, after.done], [0, true]);
  await wipe();
  const capped = await connection({ windowDays: 365 });
  await h.db.query('UPDATE mailbox_connections SET history_cursor = $2 WHERE id = $1', [capped, JSON.stringify({ count: HISTORY_CAP })]);
  const c = await historySlice(h.db, h.storage, await mkSrc(), deps, { limit: 5, now });
  assert.deepEqual([c.fetched, c.done], [0, true]); assert.ok((await conn(capped)).history_done_at);
  await wipe();
  } finally { await fresh.db.close(); h = h0; }
});
