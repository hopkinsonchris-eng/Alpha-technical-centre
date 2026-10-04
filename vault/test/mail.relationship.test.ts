// Wave 6, PR 2 (W6-AC8): who last spoke to this person, and the strongest connection at the firm, from the captured mail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serviceSink } from '../src/ingest/items-client.ts';
import type { CaptureDeps } from '../src/ingest/mail/capture.ts';
import { pollMailbox } from '../src/ingest/mail/poll.ts';
import { ImapSource } from '../src/ingest/mail/imap.ts';
import { recomputeRelationships } from '../src/ingest/mail/relationship.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import { fakeImapFactory, MAILBOX } from './fixtures/mail/fakes.ts';

let h: Harness;
before(async () => { h = await setup('vault-mailrel-'); });
after(async () => { await h.db.close(); });
const q = <T = any>(sql: string, p: unknown[] = []) => h.db.query<T>(sql, p).then(r => r.rows);

test('W6-AC8: after a poll a contact carries last contact, who it was with, and the strongest connection; hidden mail stops counting', async () => {
  const deps: CaptureDeps = { sink: await serviceSink(h.db), ingest: null, origin: 'zoho-mail' };
  await pollMailbox(h.db, h.storage, new ImapSource({ user: MAILBOX, clientFactory: fakeImapFactory() }), deps);
  const n = await recomputeRelationships(h.db, { now: () => new Date('2026-04-01T00:00:00Z') });
  assert.ok(n >= 1);
  const maria = (await q(`SELECT id, relationship FROM contacts WHERE 'mfernandez@petroleradelorinoco.com' = ANY(emails)`))[0];
  assert.ok(maria, 'the seed knows María');
  const r = maria.relationship;
  assert.equal(r.exchanges, 4, 'm01 in, m02 out, m08 in, m11 out');
  assert.equal(r.last_contact_at, '2026-03-16T09:00:00.000Z'); assert.equal(r.last_direction, 'out'); assert.equal(r.last_contact_by, 'chris');
  assert.equal(r.first_contact_at, '2026-03-02T09:15:00.000Z');
  assert.equal(r.strongest_connection, 'chris'); assert.equal(r.by_person.chris.exchanges, 2);
  assert.ok(r.strength > 0 && r.strength <= 4);
  const luis = (await q(`SELECT relationship FROM contacts WHERE 'lparedes@petroleradelorinoco.com' = ANY(emails)`))[0]?.relationship;
  if (luis) { assert.equal(luis.last_contact_by, 'chris'); }
  // Hidden mail (a withdrawn mailbox, a bulk message) no longer counts.
  await h.db.query(`UPDATE items SET hidden = true WHERE external_id = 'm11@mail.fixture'`);
  await recomputeRelationships(h.db, { now: () => new Date('2026-04-01T00:00:00Z') });
  const r2 = (await q(`SELECT relationship FROM contacts WHERE id = $1`, [maria.id]))[0].relationship;
  assert.equal(r2.exchanges, 3); assert.equal(r2.last_contact_at, '2026-03-11T10:05:00.000Z'); assert.equal(r2.last_direction, 'in');
});
