import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImapSource, parseCursor, zohoSourcesFromEnv } from '../src/ingest/mail/imap.ts';
import { conformance, collect } from './fixtures/mail/conformance.ts';
import { fakeImapFactory, MAILBOX, type ImapCalls } from './fixtures/mail/fakes.ts';

const source = (o: Parameters<typeof fakeImapFactory>[0] = {}) => new ImapSource({ user: MAILBOX, password: 'x', clientFactory: fakeImapFactory(o) });

conformance(test, ({ late }) => ({ source: source({ late }) }));

test('imap: the source id is the mailbox and its items are zoho-mail', () => {
  const s = source();
  assert.equal(s.id, `zoho-mail:${MAILBOX}`);
  assert.equal(s.origin, 'zoho-mail');
});

test('imap: the cursor is UIDVALIDITY:UID per folder, and the next read asks only for higher UIDs', async () => {
  const calls: ImapCalls = { locks: [], fetches: [], searches: [], connects: 0, logouts: 0 };
  const all = await collect(new ImapSource({ user: MAILBOX, clientFactory: fakeImapFactory({ calls }) }));
  assert.deepEqual(calls.locks, ['INBOX', 'Sent']);
  assert.deepEqual(calls.fetches, ['INBOX:1:*', 'Sent:1:*']);
  assert.equal(calls.connects, 1); assert.equal(calls.logouts, 1);
  const last = parseCursor(all[all.length - 1].cursor);
  assert.deepEqual(last, { INBOX: '1700000001:8', Sent: '1700000002:4' });
  assert.equal(parseCursor(all[0].cursor).INBOX, '1700000001:1');
  assert.equal(parseCursor(all[0].cursor).Sent, undefined, 'a folder not read yet has no entry');

  const calls2: ImapCalls = { locks: [], fetches: [], searches: [], connects: 0, logouts: 0 };
  const again = await collect(new ImapSource({ user: MAILBOX, clientFactory: fakeImapFactory({ calls: calls2 }) }), all[all.length - 1].cursor);
  assert.equal(again.length, 0, 'the server answers the last message for N:* and it is filtered out');
  assert.deepEqual(calls2.fetches, ['INBOX:9:*', 'Sent:5:*']);
});

test('imap: a new UIDVALIDITY means the server renumbered the folder, so that folder is read from the start', async () => {
  const all = await collect(source());
  const cursor = all[all.length - 1].cursor;
  const again = await collect(source({ uidValidity: { Sent: 1700009999 } }), cursor);
  assert.deepEqual(again.map(a => a.message.external_id).sort(), ['m02@mail.fixture', 'm06@mail.fixture', 'm09@mail.fixture', 'm11@mail.fixture']);
  assert.equal(parseCursor(again[again.length - 1].cursor).Sent, '1700009999:4');
  assert.equal(parseCursor(again[again.length - 1].cursor).INBOX, '1700000001:8', 'the other folder keeps its position');
});

test('imap: a backfill searches by date and fetches those UIDs', async () => {
  const calls: ImapCalls = { locks: [], fetches: [], searches: [], connects: 0, logouts: 0 };
  const got = await collect(new ImapSource({ user: MAILBOX, clientFactory: fakeImapFactory({ calls }) }), null, { since: new Date('2026-03-10T00:00:00Z') });
  assert.equal(got.length, 6);
  assert.deepEqual(calls.searches, ['2026-03-10T00:00:00.000Z', '2026-03-10T00:00:00.000Z']);
  assert.deepEqual(calls.fetches, ['INBOX:5,6,7,8', 'Sent:3,4']);
});

test('imap: flags become labels, and a missing Sent folder is not an error', async () => {
  const all = await collect(source());
  const byId = new Map(all.map(a => [a.message.external_id, a.message]));
  assert.ok(byId.get('m07@mail.fixture')!.labels.includes('$Personal'));
  assert.ok(byId.get('m01@mail.fixture')!.labels.includes('\\Seen'));
  const noSent = new ImapSource({ user: MAILBOX, clientFactory: fakeImapFactory(), folders: [{ path: 'INBOX', kind: 'inbox' }, { path: 'Sent Items', kind: 'sent' }] });
  assert.equal((await collect(noSent)).length, 8);
});

test('imap: mailboxes come from the environment, the host defaults to Zoho, extra mailboxes use numbered variables', () => {
  assert.equal(zohoSourcesFromEnv({}).length, 0);
  const s = zohoSourcesFromEnv({ ZOHO_MAIL_IMAP_USER: 'info@a.com', ZOHO_MAIL_IMAP_PASSWORD: 'p', ZOHO_MAIL_IMAP_USER_2: 'chris@a.com', ZOHO_MAIL_IMAP_PASSWORD_2: 'q', ZOHO_MAIL_IMAP_USER_3: 'no-password@a.com' });
  assert.deepEqual(s.map(x => x.id), ['zoho-mail:info@a.com', 'zoho-mail:chris@a.com']);
});
