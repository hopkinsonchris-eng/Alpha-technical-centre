import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GmailSource, gmailSourceFromEnv } from '../src/ingest/mail/gmail.ts';
import { conformance, collect } from './fixtures/mail/conformance.ts';
import { fakeGmailFetch, MAILBOX, type GmailCalls } from './fixtures/mail/fakes.ts';

const make = (o: Parameters<typeof fakeGmailFetch>[0] = {}) => new GmailSource({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', mailbox: MAILBOX, fetch: fakeGmailFetch(o), sleep: async () => {} });

conformance(test, ({ late }) => ({ source: make({ late }) }));

const ids = (calls: GmailCalls) => calls.urls.map(u => u.split('?')[0]);

test('gmail: an empty cursor backfills with messages.list, oldest first, and ends on the historyId read before it started', async () => {
  const calls: GmailCalls = { urls: [], tokens: 0 };
  const got = await collect(make({ calls }));
  assert.equal(got.length, 12);
  assert.deepEqual(got.map(g => g.message.external_id).slice(0, 3), ['m01@mail.fixture', 'm02@mail.fixture', 'm03@mail.fixture']);
  assert.equal(got[got.length - 1].cursor, '1000');
  assert.match(got[0].cursor, /^1000@g01$/, 'mid-backfill the cursor names the last message done');
  assert.ok(calls.urls.some(u => u.includes('/messages?') && u.includes('pageToken=page2')), 'both list pages read');
  assert.equal(ids(calls).filter(u => u === '/history').length, 0, 'no history call for a backfill');
  assert.equal(calls.tokens, 1);
});

test('gmail: a stored historyId reads users.history.list and fetches only the new message', async () => {
  const calls: GmailCalls = { urls: [], tokens: 0 };
  const got = await collect(make({ late: true, calls }), '1000');
  assert.deepEqual(got.map(g => g.message.external_id), ['m13@mail.fixture']);
  assert.equal(got[0].cursor, '1010');
  assert.equal(calls.urls.filter(u => u.startsWith('/history')).length, 1);
  assert.match(calls.urls.find(u => u.startsWith('/history'))!, /startHistoryId=1000/);
  assert.match(calls.urls.find(u => u.startsWith('/history'))!, /historyTypes=messageAdded/);
  assert.equal(calls.urls.filter(u => u.startsWith('/messages?')).length, 0, 'no full listing');
  assert.equal(calls.urls.filter(u => u.startsWith('/messages/')).length, 1, 'only the new message is fetched');
});

test('gmail: an interrupted backfill resumes after the last message done', async () => {
  const all = await collect(make());
  const rest = await collect(make(), all[3].cursor);
  assert.deepEqual(rest.map(r => r.message.external_id), all.slice(4).map(r => r.message.external_id));
  assert.equal(rest[rest.length - 1].cursor, '1000');
});

test('gmail: history that Gmail no longer holds (404) falls back to the full backfill', async () => {
  const calls: GmailCalls = { urls: [], tokens: 0 };
  const got = await collect(make({ failHistory404: true, calls }), '1000');
  assert.equal(got.length, 12);
  assert.ok(ids(calls).includes('/history') && ids(calls).includes('/messages'));
});

test('gmail: labels are names, folder comes from SENT and INBOX, and the Personal user label is kept', async () => {
  const byId = new Map((await collect(make())).map(g => [g.message.external_id, g.message]));
  assert.deepEqual(byId.get('m07@mail.fixture')!.labels, ['INBOX', 'Personal']);
  assert.deepEqual(byId.get('m03@mail.fixture')!.labels, ['INBOX', 'CATEGORY_PERSONAL']);
  assert.deepEqual(byId.get('m02@mail.fixture')!.labels, ['SENT']);
});

test('gmail: an expired access token is refreshed once and the request retried', async () => {
  const calls: GmailCalls = { urls: [], tokens: 0 };
  const got = await collect(make({ expireFirstToken: true, calls }));
  assert.equal(got.length, 12);
  assert.equal(calls.tokens, 2);
});

test('gmail: rate limits and server errors are retried with backoff, then reported', async () => {
  let n = 0; const waits: number[] = [];
  const flaky: typeof fetch = (async (input: any, init?: RequestInit) => {
    if (String(input).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't' }));
    if (String(input).includes('/profile')) { n++; return n < 3 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ emailAddress: MAILBOX, historyId: '5' })); }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
  const s = new GmailSource({ clientId: 'a', clientSecret: 'b', refreshToken: 'c', fetch: flaky, sleep: async (ms) => { waits.push(ms); } });
  assert.equal((await collect(s)).length, 0);
  assert.deepEqual(waits, [500, 1000]);
  const dead = new GmailSource({ clientId: 'a', clientSecret: 'b', refreshToken: 'c', fetch: (async (i: any) => String(i).includes('oauth2') ? new Response('{"access_token":"t"}') : new Response('{}', { status: 500 })) as typeof fetch, sleep: async () => {} });
  await assert.rejects(collect(dead), /failed \(500\)/);
});

test('gmail: the source id is the mailbox, its items are gmail, and the OAuth variables configure it', () => {
  assert.equal(make().id, `gmail:${MAILBOX}`);
  assert.equal(make().origin, 'gmail');
  assert.equal(gmailSourceFromEnv({}), null);
  assert.equal(gmailSourceFromEnv({ GMAIL_OAUTH_CLIENT_ID: 'a', GMAIL_OAUTH_CLIENT_SECRET: 'b' }), null);
  assert.equal(gmailSourceFromEnv({ GMAIL_OAUTH_CLIENT_ID: 'a', GMAIL_OAUTH_CLIENT_SECRET: 'b', GMAIL_OAUTH_REFRESH_TOKEN: 'c' })!.id, 'gmail:me');
});
