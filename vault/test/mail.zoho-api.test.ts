// Wave 6, PR 2 (docs/vault-hub/wave6/05-markup.md §2, W6-AC2): the Zoho Mail REST source yields the same RawMessage as
// IMAP and Gmail on the shared mailbox, keeps a per-folder cursor, paces itself and pauses on a rate limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZohoHttpError, ZohoMailSource } from '../src/ingest/mail/zoho-api.ts';
import { conformance, collect } from './fixtures/mail/conformance.ts';
import { fakeZohoFetch, MAILBOX, type ZohoCalls } from './fixtures/mail/fakes.ts';

const make = (o: Parameters<typeof fakeZohoFetch>[0] = {}, extra: Partial<ConstructorParameters<typeof ZohoMailSource>[0]> = {}) =>
  new ZohoMailSource({ address: MAILBOX, accountId: '776', apiUrl: 'https://mail.zoho.eu', accountsUrl: 'https://accounts.zoho.eu', clientId: 'id', clientSecret: 'secret', refreshToken: 'rt', fetch: fakeZohoFetch(o), sleep: async () => {}, pageSize: 5, ...extra });

conformance(test, ({ late }) => ({ source: make({ late }) }));

test('zoho: the source id is the mailbox and its items are zoho-mail; folders are found by type, Drafts and Trash ignored', async () => {
  const calls: ZohoCalls = { urls: [], tokens: 0 };
  const src = make({ calls });
  assert.equal(src.id, 'zoho-mail:' + MAILBOX); assert.equal(src.origin, 'zoho-mail');
  await collect(src);
  assert.equal(calls.urls.filter(u => u.startsWith('/api/accounts/776/folders')).length, 1);
  const folders = new Set(calls.urls.filter(u => u.includes('/messages/view')).map(u => new URL('http://x' + u).searchParams.get('folderId')));
  assert.deepEqual([...folders].sort(), ['9001', '9003']);
  assert.equal(calls.tokens, 1, 'one token refresh for the whole read');
});

test('zoho: the cursor names the newest message per folder; the next read lists newest first and stops at it, fetching only what is new', async () => {
  const first = await collect(make());
  const cur = JSON.parse(first[first.length - 1].cursor);
  assert.deepEqual(Object.keys(cur).sort(), ['inbox', 'sent']);
  assert.equal(cur.inbox.last, '100012'); assert.equal(cur.sent.last, '100011');
  const calls: ZohoCalls = { urls: [], tokens: 0 };
  const next = await collect(make({ late: true, calls }), first[first.length - 1].cursor);
  assert.deepEqual(next.map(x => x.message.external_id), ['m13@mail.fixture']);
  assert.equal(calls.urls.filter(u => u.includes('/originalmessage')).length, 1, 'only the new message is fetched');
  assert.ok(calls.urls.some(u => u.includes('sortBy=date') && u.includes('sortorder=false')), 'newest first');
});

test('zoho: a rate limit pauses the read with the cursor where it was; an expired token is refreshed once; raw bytes are accepted as well as JSON', async () => {
  const src = make({ rateLimitAfter: 3 });
  const got: string[] = [];
  await assert.rejects((async () => { for await (const x of src.fetch(null)) got.push(x.message.external_id); })(), (e: any) => e instanceof ZohoHttpError && e.status === 429);
  const calls: ZohoCalls = { urls: [], tokens: 0 };
  const all = await collect(make({ expireFirstToken: true, calls }));
  assert.equal(all.length, 12); assert.equal(calls.tokens, 2);
  const text = await collect(make({ rawAsText: true }));
  assert.equal(text.length, 12);
  assert.equal(text.find(x => x.message.external_id === 'm01@mail.fixture')!.message.from.name, 'María Fernández');
});

test('zoho: labels carry Unread and a flag; history walks a folder backwards by offset to the window start, in slices, and says when it is done', async () => {
  const byId = new Map((await collect(make())).map(g => [g.message.external_id, g.message]));
  assert.deepEqual(byId.get('m01@mail.fixture')!.labels, ['Unread']);
  assert.deepEqual(byId.get('m03@mail.fixture')!.labels, ['important']);
  const src = make();
  const windowStart = new Date('2026-03-05T00:00:00Z');
  const a = await src.fetchHistory(null, { windowStart, limit: 4 });
  assert.equal(a.messages.length, 4); assert.equal(a.done, false);
  assert.ok(a.messages.every(m => new Date(m.date) >= windowStart));
  const ids = (ms: typeof a.messages) => ms.map(m => m.external_id);
  const b = await src.fetchHistory(a.cursor, { windowStart, limit: 4 });
  const c = await src.fetchHistory(b.cursor, { windowStart, limit: 4 });
  const d = await src.fetchHistory(c.cursor, { windowStart, limit: 4 });
  const all = [...ids(a.messages), ...ids(b.messages), ...ids(c.messages), ...ids(d.messages)];
  assert.equal(new Set(all).size, all.length, 'no message twice across slices');
  assert.deepEqual(all.sort(), ['m04@mail.fixture', 'm05@mail.fixture', 'm06@mail.fixture', 'm07@mail.fixture', 'm08@mail.fixture', 'm09@mail.fixture', 'm10@mail.fixture', 'm11@mail.fixture', 'm12@mail.fixture'], 'everything on or after the window start, nothing before');
  assert.equal(d.done, true);
  const e = await src.fetchHistory(d.cursor, { windowStart, limit: 4 });
  assert.equal(e.messages.length, 0); assert.equal(e.done, true);
});
