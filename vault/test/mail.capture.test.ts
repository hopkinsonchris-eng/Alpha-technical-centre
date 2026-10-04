import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FakeProvider } from '../src/llm/provider.ts';
import { FakeEmbedder } from '../src/ingest/embed.ts';
import { serviceSink } from '../src/ingest/items-client.ts';
import { captureMessage, fingerprint, type CaptureDeps } from '../src/ingest/mail/capture.ts';
import { getCursor, pollMailbox, setCursor } from '../src/ingest/mail/poll.ts';
import { resolvePendingDispatches } from '../src/ingest/mail/counterparties.ts';
import { ImapSource } from '../src/ingest/mail/imap.ts';
import { GmailSource } from '../src/ingest/mail/gmail.ts';
import type { MailSource, RawMessage } from '../src/ingest/mail/types.ts';
import { runMailBackfill } from '../src/jobs/mail-backfill.ts';
import { runMailPoll } from '../src/jobs/mail-poll.ts';
import { makePdf } from './fixtures/ingest/build.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import { fakeGmailFetch, fakeImapFactory, MAILBOX } from './fixtures/mail/fakes.ts';

let h: Harness;
let deps: CaptureDeps;
const ingest = { provider: new FakeProvider(), embedder: new FakeEmbedder() };
before(async () => {
  h = await setup('vault-mailcap-');
  deps = { sink: await serviceSink(h.db), ingest, origin: 'zoho-mail' };
});
after(async () => { await h.db.close(); });

const INFO = 'info@alpha-technical-centre.com';
const MARIA = 'María Fernández <mfernandez@petroleradelorinoco.com>';
const addr = (s: string) => { const m = /^(.*?)\s*<(.+)>$/.exec(s); return m ? { name: m[1].trim(), address: m[2].toLowerCase() } : { address: s.toLowerCase() }; };

let seq = 0;
function mk(o: { id?: string; from?: string; to?: string[]; cc?: string[]; subject?: string; text?: string; date?: string; folder?: 'inbox' | 'sent' | 'other'; in_reply_to?: string; references?: string[]; labels?: string[]; attachments?: RawMessage['attachments'] } = {}): RawMessage {
  const n = ++seq;
  const external_id = o.id ?? `t${n}@capture.fixture`;
  const references = o.references ?? (o.in_reply_to ? [o.in_reply_to] : []);
  return {
    mailbox: INFO, external_id, thread_id: references[0] ?? o.in_reply_to ?? external_id, in_reply_to: o.in_reply_to ?? null, references,
    from: addr(o.from ?? MARIA), to: (o.to ?? [INFO]).map(addr), cc: (o.cc ?? []).map(addr), subject: o.subject ?? `Message ${n}`,
    date: o.date ?? new Date(Date.UTC(2026, 3, 1, 8, 0, n)).toISOString(), text: o.text ?? `Body of message ${n}.`, attachments: o.attachments ?? [], labels: o.labels ?? [], folder: o.folder ?? 'inbox',
  };
}

/** An in-memory mailbox: fetch(cursor) returns the messages after that index. `redeliver` ignores the cursor (a server that repeats itself). */
function listSource(id: string, list: RawMessage[], o: { redeliver?: boolean; failAt?: number } = {}): MailSource & { messages: RawMessage[] } {
  return {
    id, messages: list,
    async *fetch(cursor, opts) {
      const from = o.redeliver || !cursor ? 0 : Number(cursor);
      for (let i = from; i < list.length; i++) {
        if (opts?.since && new Date(list[i].date) < opts.since) continue;
        if (o.failAt === i) throw new Error('mail server went away');
        yield { message: list[i], cursor: String(i + 1) };
      }
    },
  };
}

const q = <T = any>(sql: string, p: unknown[] = []) => h.db.query<T>(sql, p).then(r => r.rows);
const item = async (extId: string) => (await q(`SELECT * FROM items WHERE external_id = $1 AND parent_id IS NULL`, [extId]))[0];
const api = async (method: string, url: string, body?: unknown) => {
  const res = await h.app.request(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
  return { status: res.status, body: (await res.json()) as any };
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

test('AC8: a message to a project contact is one Item under that project after two polls, with its attachment as a child Item', async () => {
  const pdf = await makePdf(['Injection data for the Carabobo screening: monthly volumes and pressures.']);
  const m = mk({ id: 'ac8@capture.fixture', from: MARIA, to: [INFO], cc: ['lparedes@petroleradelorinoco.com'], subject: 'Carabobo injection data', text: 'Attached are the volumes for the Carabobo screening.', attachments: [{ filename: 'injection-data.pdf', mime: 'application/pdf', bytes: pdf }] });
  const source = listSource('zoho-mail:ac8', [m]);

  const p1 = await pollMailbox(h.db, h.storage, source, deps);
  const p2 = await pollMailbox(h.db, h.storage, source, deps);
  assert.deepEqual([p1.created, p1.filed, p1.attachments, p1.errors], [1, 1, 1, []]);
  assert.deepEqual([p2.fetched, p2.created], [0, 0], 'the second poll starts after the first message');
  assert.equal(await getCursor(h.db, 'zoho-mail:ac8'), '1');

  const rows = await q(`SELECT * FROM items WHERE external_id LIKE 'ac8@capture.fixture%' ORDER BY external_id`);
  assert.equal(rows.length, 2, 'the message and its attachment, nothing else');
  const mail = rows.find(r => r.parent_id === null)!, att = rows.find(r => r.parent_id !== null)!;
  assert.equal(mail.type, 'email'); assert.equal(mail.project_id, 'orinoco-partnership'); assert.equal(mail.legal_tag, 'lt-orinoco-nda-2026');
  assert.equal(mail.origin.source, 'zoho-mail'); assert.equal(mail.origin.external_id, 'ac8@capture.fixture'); assert.equal(mail.title, 'Carabobo injection data');
  assert.equal(new Date(mail.authored_at).toISOString(), m.date); assert.deepEqual(mail.authors, ['mfernandez@petroleradelorinoco.com']);
  assert.equal(mail.filing.method, 'classifier'); assert.ok(mail.filing.confidence >= 0.85);
  assert.deepEqual(mail.organisation_ids, ['petrolera-del-orinoco']);
  assert.deepEqual(mail.extracted.contacts.map((c: any) => [c.role, c.email]), [['from', 'mfernandez@petroleradelorinoco.com'], ['to', INFO], ['cc', 'lparedes@petroleradelorinoco.com']]);
  assert.equal(mail.extracted.contacts[0].contact_id, 'maria-fernandez'); assert.equal(mail.extracted.contacts[1].firm, true);
  assert.equal(mail.extracted.direction, 'in'); assert.equal(mail.extracted.thread_id, 'ac8@capture.fixture');
  assert.equal(mail.extracted.classification.project_id, 'orinoco-partnership');
  assert.equal(att.type, 'report'); assert.equal(att.parent_id, mail.id); assert.equal(att.project_id, 'orinoco-partnership'); assert.equal(att.title, 'injection-data.pdf');
  assert.equal(att.content_hash, `sha256:${sha(pdf)}`, 'the attachment bytes are stored as they arrived');
  assert.equal(att.origin.external_id, 'ac8@capture.fixture#1');
  // both are indexed, with the project's scope
  for (const id of [mail.id, att.id]) {
    const chunks = await q(`SELECT DISTINCT project_id, legal_tag FROM chunks WHERE item_id = $1`, [id]);
    assert.deepEqual(chunks, [{ project_id: 'orinoco-partnership', legal_tag: 'lt-orinoco-nda-2026' }]);
  }
  assert.equal((await q(`SELECT count(*)::int AS n FROM filing_queue WHERE item_id = $1`, [mail.id]))[0].n, 0);
  // the original is an EML whose text is searchable
  assert.match(new TextDecoder().decode((await h.storage.get(mail.storage_key))!), /^Message-ID: <ac8@capture.fixture>/m);
  assert.match(new TextDecoder().decode((await h.storage.get(`derived/${mail.id}/text.md`))!), /volumes for the Carabobo screening/);

  // A server that repeats itself, another mailbox holding the same message, and a copy with a new Message-Id: still one item.
  const again = await pollMailbox(h.db, h.storage, listSource('zoho-mail:ac8', [m], { redeliver: true }), deps);
  assert.deepEqual([again.duplicates, again.created], [1, 0]);
  const other = await pollMailbox(h.db, h.storage, listSource('gmail:someone@gmail.example', [{ ...m, mailbox: 'someone@gmail.example' }]), { ...deps, origin: 'gmail' });
  assert.deepEqual([other.duplicates, other.created], [1, 0]);
  const reissued = await captureMessage(h.db, h.storage, { ...m, external_id: 'ac8-other-id@gateway.example', thread_id: 'ac8-other-id@gateway.example' }, deps);
  assert.deepEqual([reissued.status, reissued.duplicate_of, reissued.item_id], ['duplicate', 'content', mail.id]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM items WHERE external_id LIKE 'ac8%'`))[0].n, 2);
  assert.notEqual(fingerprint(m), fingerprint({ ...m, text: 'something else' }));
});

test('thread grouping: replies join the conversation of the earliest known message, by References or In-Reply-To', async () => {
  const root = mk({ id: 'thr-root@capture.fixture', subject: 'Basis of the screening', text: 'Root of the thread.' });
  const r1 = mk({ id: 'thr-1@capture.fixture', in_reply_to: 'thr-root@capture.fixture', subject: 'Re: Basis of the screening' });
  const r2 = mk({ id: 'thr-2@capture.fixture', in_reply_to: 'thr-1@capture.fixture', references: ['thr-root@capture.fixture', 'thr-1@capture.fixture'], subject: 'Re: Re: Basis of the screening' });
  // its References header lost the root, but it answers r2
  const r3 = mk({ id: 'thr-3@capture.fixture', in_reply_to: 'thr-2@capture.fixture', references: ['thr-2@capture.fixture'], subject: 'Re: Re: Re: Basis of the screening' });
  // an unrelated conversation that merely shares the subject
  const other = mk({ id: 'thr-other@capture.fixture', subject: 'Basis of the screening', text: 'A different conversation.' });
  for (const m of [root, r1, r2, r3, other]) assert.equal((await captureMessage(h.db, h.storage, m, deps)).status, 'created');
  const threads = Object.fromEntries((await q(`SELECT external_id, extracted->>'thread_id' AS t FROM items WHERE external_id LIKE 'thr-%' AND parent_id IS NULL`)).map(r => [r.external_id, r.t]));
  assert.deepEqual(threads, { 'thr-root@capture.fixture': 'thr-root@capture.fixture', 'thr-1@capture.fixture': 'thr-root@capture.fixture', 'thr-2@capture.fixture': 'thr-root@capture.fixture', 'thr-3@capture.fixture': 'thr-root@capture.fixture', 'thr-other@capture.fixture': 'thr-other@capture.fixture' });
  const refs = (await item('thr-2@capture.fixture')).extracted;
  assert.deepEqual(refs.references, ['thr-root@capture.fixture', 'thr-1@capture.fixture']); assert.equal(refs.in_reply_to, 'thr-1@capture.fixture');
});

test('AC2: a message with no matching contact lands in the queue; assigning files it, adds the sender to the project contacts, and the next message from them files directly', async () => {
  const csv = new TextEncoder().encode('depth_ft,pressure_psi\n8200,3510\n8300,3555\n');
  const first = mk({ id: 'q1@capture.fixture', from: 'Dario Lozano <dario.lozano@nuevalab.co>', subject: 'Core analysis results', text: 'Attached are the routine core analysis results for the Carabobo wells.', attachments: [{ filename: 'core-analysis.csv', mime: 'text/csv', bytes: csv }] });
  const r = await captureMessage(h.db, h.storage, first, deps);
  assert.deepEqual([r.status, r.filed, r.project_id], ['created', false, 'firm']);
  assert.ok(r.queue_id && r.confidence! < 0.85);
  const queued = await item('q1@capture.fixture');
  assert.equal(queued.project_id, 'firm'); assert.equal(queued.legal_tag, 'lt-firm'); assert.deepEqual(queued.tags, ['unfiled']);
  const child = (await q('SELECT * FROM items WHERE parent_id = $1', [queued.id]))[0];
  assert.equal(child.project_id, 'firm');

  // the queue lists it (the hub's shape) and offers the classifier's suggestions
  const list = await api('GET', '/api/queue/filing');
  assert.equal(list.status, 200);
  const row = list.body.items.find((x: any) => x.item_id === queued.id);
  assert.equal(row.id, r.queue_id); assert.equal(row.subject, 'Core analysis results'); assert.equal(row.from, 'Dario Lozano'); assert.equal(row.from_address, 'dario.lozano@nuevalab.co');
  assert.equal(row.attachments, 1); assert.equal(row.status, 'open');
  assert.equal(row.suggestions[0].project_id, 'orinoco-partnership', 'the Carabobo wording suggests the project, without enough to file it');
  assert.ok(row.suggestions[0].confidence > 0 && row.suggestions[0].confidence < 0.85); assert.match(row.suggestions[0].project_name, /Carabobo/);
  assert.equal(row.suggested_project_id, 'orinoco-partnership'); assert.equal(row.confidence, row.suggestions[0].confidence);
  assert.equal(row.suggestions[0].evidence[0].signal, 'tokens');

  // an unknown organisation is proposed at the same time (AC16)
  const prop = (await q(`SELECT * FROM review_queue WHERE kind = 'organisation' AND payload->>'domain' = 'nuevalab.co'`))[0];
  assert.equal(prop.status, 'open'); assert.equal(prop.payload.name, 'Nuevalab'); assert.equal(prop.payload.sender_email, 'dario.lozano@nuevalab.co');

  const bad = await api('POST', `/api/queue/filing/${r.queue_id}/assign`, {});
  assert.equal(bad.status, 400);
  assert.equal((await api('POST', `/api/queue/filing/${r.queue_id}/assign`, { project_id: 'firm' })).status, 400);
  assert.equal((await api('POST', `/api/queue/filing/${r.queue_id}/assign`, { project_id: 'no-such-project' })).status, 400);
  const a = await api('POST', `/api/queue/filing/${r.queue_id}/assign`, { project_id: 'orinoco-partnership' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual([a.body.status, a.body.project_id, a.body.legal_tag], ['assigned', 'orinoco-partnership', 'lt-orinoco-nda-2026']);
  assert.equal(a.body.contacts.length, 1); assert.equal(a.body.contacts[0].created, true);
  assert.equal(a.body.dispatch_ids.length, 1, 'the sender is a known contact now, so the inbound message gets its dispatch');
  const dsp = (await q('SELECT * FROM dispatches WHERE id = $1', [a.body.dispatch_ids[0]]))[0];
  assert.deepEqual([dsp.direction, dsp.item_id, dsp.organisation_id, dsp.contact_ids], ['in', queued.id, a.body.contacts[0].organisation_id, [a.body.contacts[0].contact_id]]);
  assert.equal((await q(`SELECT organisation_ids FROM items WHERE id = $1`, [queued.id]))[0].organisation_ids[0], a.body.contacts[0].organisation_id);
  assert.equal((await q(`SELECT status FROM review_queue WHERE id = $1`, [prop.id]))[0].status, 'accepted', 'the organisation the assignment created settles its own proposal');

  const moved = await q('SELECT id, project_id, client_id, legal_tag, filing, tags FROM items WHERE id = ANY($1::uuid[])', [[queued.id, child.id]]);
  for (const it of moved) {
    assert.deepEqual([it.project_id, it.client_id, it.legal_tag, it.tags], ['orinoco-partnership', 'petrolera-del-orinoco', 'lt-orinoco-nda-2026', []]);
    assert.deepEqual(it.filing, { method: 'manual', confidence: 1, confirmed_by: 'chris' });
    const chunks = await q('SELECT DISTINCT project_id, client_id, legal_tag, to_char(expires_at,\'YYYY-MM-DD\') AS e FROM chunks WHERE item_id = $1', [it.id]);
    assert.deepEqual(chunks, [{ project_id: 'orinoco-partnership', client_id: 'petrolera-del-orinoco', legal_tag: 'lt-orinoco-nda-2026', e: '2028-02-13' }]);
  }
  const contact = (await q(`SELECT c.*, pc.project_id FROM contacts c JOIN project_contacts pc ON pc.contact_id = c.id WHERE 'dario.lozano@nuevalab.co' = ANY(c.emails)`))[0];
  assert.equal(contact.project_id, 'orinoco-partnership'); assert.equal(contact.name, 'Dario Lozano');
  assert.equal((await q(`SELECT status, resolved_by FROM filing_queue WHERE id = $1`, [r.queue_id]))[0].status, 'assigned');
  assert.equal((await api('POST', `/api/queue/filing/${r.queue_id}/assign`, { project_id: 'orinoco-partnership' })).status, 409, 'a resolved row cannot be resolved twice');
  assert.equal((await api('GET', '/api/queue/filing')).body.items.filter((x: any) => x.item_id === queued.id).length, 0);

  // the next message from the sender files directly
  const next = await captureMessage(h.db, h.storage, mk({ id: 'q2@capture.fixture', from: 'Dario Lozano <dario.lozano@nuevalab.co>', subject: 'Follow-up', text: 'A short follow-up.' }), deps);
  assert.deepEqual([next.filed, next.project_id, next.queue_id], [true, 'orinoco-partnership', undefined]);
  assert.equal((await item('q2@capture.fixture')).filing.method, 'classifier');
});

test('"not a project email": dismissing keeps the message and its attachment in the firm inbox and adds no contact', async () => {
  const r = await captureMessage(h.db, h.storage, mk({ id: 'q3@capture.fixture', from: 'Deals <deals@promo-example.com>', subject: 'Big savings on drilling rigs', text: 'Limited offer.', attachments: [{ filename: 'offer.txt', mime: 'text/plain', bytes: new TextEncoder().encode('offer') }] }), deps);
  assert.equal(r.filed, false);
  const contactsBefore = (await q('SELECT count(*)::int AS n FROM contacts'))[0].n;
  const d = await api('POST', `/api/queue/filing/${r.queue_id}/dismiss`);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual([d.body.status, d.body.project_id], ['dismissed', 'firm']);
  const it = await item('q3@capture.fixture');
  assert.equal(it.project_id, 'firm'); assert.deepEqual(it.tags, ['firm/inbox']); assert.equal(it.filing.method, 'manual'); assert.equal(it.filing.confirmed_by, 'chris');
  assert.deepEqual((await q('SELECT project_id, tags FROM items WHERE parent_id = $1', [it.id])), [{ project_id: 'firm', tags: ['firm/inbox'] }]);
  assert.equal((await q('SELECT count(*)::int AS n FROM contacts'))[0].n, contactsBefore);
  assert.equal((await api('POST', `/api/queue/filing/${r.queue_id}/dismiss`)).status, 409);
  assert.equal((await api('POST', `/api/queue/filing/00000000-0000-4000-8000-00000000dead/dismiss`)).status, 404);
  assert.equal((await api('GET', '/api/queue/filing?status=dismissed')).body.items.some((x: any) => x.item_id === it.id), true);
  assert.equal((await api('GET', '/api/queue/filing?status=nope')).status, 400);
});

test('AC16: a sent message creates an out dispatch, an inbound from a known contact an in dispatch, an unknown sender an organisation proposal', async () => {
  const inbound = mk({ id: 'd-in@capture.fixture', from: MARIA, subject: 'NDA comments', text: 'Our comments on the NDA follow.', date: '2026-05-04T09:00:00Z' });
  const sent = mk({ id: 'd-out@capture.fixture', from: 'Chris Hopkinson <chris@alpha-technical-centre.com>', to: [MARIA, 'Luis Paredes <lparedes@petroleradelorinoco.com>'], folder: 'sent', in_reply_to: 'd-in@capture.fixture', subject: 'Re: NDA comments', text: 'Thank you, we will revise the NDA.', date: '2026-05-04T14:30:00Z' });
  const stranger = mk({ id: 'd-unk@capture.fixture', from: 'Marta Ibarra <marta@geodatos-andinos.com>', subject: 'Seismic data for sale', text: 'We license regional seismic data.', date: '2026-05-05T08:00:00Z' });
  const fromFirmInbox = mk({ id: 'd-firm@capture.fixture', from: 'Chris Hopkinson <chris@alpha-technical-centre.com>', to: [INFO, 'lparedes@petroleradelorinoco.com'], subject: 'Copy of my note to Luis', text: 'Copied to the shared mailbox.', date: '2026-05-06T10:00:00Z' });
  const internal = mk({ id: 'd-internal@capture.fixture', from: 'Chris Hopkinson <chris@alpha-technical-centre.com>', to: [INFO], subject: 'Reminder to self', text: 'Buy stamps.', folder: 'sent', date: '2026-05-06T11:00:00Z' });
  const r = { in: await captureMessage(h.db, h.storage, inbound, deps), out: await captureMessage(h.db, h.storage, sent, deps), unk: await captureMessage(h.db, h.storage, stranger, deps), firm: await captureMessage(h.db, h.storage, fromFirmInbox, deps), internal: await captureMessage(h.db, h.storage, internal, deps) };

  const disp = async (extId: string) => (await q(`SELECT d.* FROM dispatches d JOIN items i ON i.id = d.item_id WHERE i.external_id = $1 ORDER BY d.id`, [extId]));
  const [din] = await disp('d-in@capture.fixture');
  assert.deepEqual([din.direction, din.channel, din.organisation_id, din.contact_ids, din.recorded_by, din.signed_by], ['in', 'email', 'petrolera-del-orinoco', ['maria-fernandez'], 'mail-capture', null]);
  assert.equal(din.occurred_at.toISOString(), '2026-05-04T09:00:00.000Z'); assert.equal(din.in_reply_to, null); assert.equal(r.in.dispatch_ids[0], din.id);

  const [dout] = await disp('d-out@capture.fixture');
  assert.deepEqual([dout.direction, dout.channel, dout.organisation_id, dout.recorded_by, dout.signed_by], ['out', 'email', 'petrolera-del-orinoco', 'mail-capture', 'chris']);
  assert.deepEqual([...dout.contact_ids].sort(), ['luis-paredes', 'maria-fernandez'], 'contacts matched from the recipients');
  assert.equal(dout.in_reply_to, din.id, 'in_reply_to is the dispatch of the message it answers');
  assert.equal(dout.occurred_at.toISOString(), '2026-05-04T14:30:00.000Z');
  assert.equal(dout.reference_no, null);

  assert.equal((await disp('d-unk@capture.fixture')).length, 0, 'no organisation, no dispatch yet');
  const proposal = (await q(`SELECT * FROM review_queue WHERE kind = 'organisation' AND payload->>'domain' = 'geodatos-andinos.com'`))[0];
  assert.deepEqual([proposal.status, proposal.payload.name, proposal.payload.domain, proposal.payload.sender_email, proposal.payload.item_id], ['open', 'Geodatos Andinos', 'geodatos-andinos.com', 'marta@geodatos-andinos.com', (await item('d-unk@capture.fixture')).id]);
  assert.equal(r.unk.proposals[0], proposal.id);
  assert.equal((await item('d-unk@capture.fixture')).extracted.dispatch_pending, true);

  // from a firm address but in the inbox: still outbound, to the counterparty only
  const [dfirm] = await disp('d-firm@capture.fixture');
  assert.deepEqual([dfirm.direction, dfirm.organisation_id, dfirm.contact_ids], ['out', 'petrolera-del-orinoco', ['luis-paredes']]);
  assert.equal((await disp('d-internal@capture.fixture')).length, 0, 'a message between colleagues is nobody\'s dispatch');
  assert.equal(r.internal.proposals.length, 0);

  // the dispatch register shows them, and the audit trail names the recorder
  const reg = await api('GET', '/api/dispatches?organisation=petrolera-del-orinoco&limit=1000');
  const ids = reg.body.dispatches.map((d: any) => d.id);
  assert.ok(ids.includes(din.id) && ids.includes(dout.id));
  assert.ok((await q(`SELECT 1 FROM audit_events WHERE person_id = 'mail-capture' AND action = 'dispatch.create' AND $1 = ANY(refs)`, [`dispatch:${dout.id}`])).length === 1);

  // a second message from the same unknown organisation joins the open proposal; free mail never proposes
  const again = await captureMessage(h.db, h.storage, mk({ id: 'd-unk2@capture.fixture', from: 'Pedro <pedro@geodatos-andinos.com>', subject: 'Seismic data, second mail', text: 'Second mail.' }), deps);
  assert.equal(again.proposals[0], proposal.id);
  assert.equal((await q(`SELECT count(*)::int AS n FROM review_queue WHERE kind = 'organisation' AND payload->>'domain' = 'geodatos-andinos.com'`))[0].n, 1);
  assert.equal((await q(`SELECT payload->'item_ids' AS ids FROM review_queue WHERE id = $1`, [proposal.id]))[0].ids.length, 2);
  const gm = await captureMessage(h.db, h.storage, mk({ id: 'd-gm@capture.fixture', from: 'Someone <someone@gmail.com>', subject: 'Hello', text: 'Hi.' }), deps);
  assert.equal(gm.proposals.length, 0);

  // a rejected proposal is not made again
  await h.db.query(`UPDATE review_queue SET status = 'rejected' WHERE id = $1`, [proposal.id]);
  const third = await captureMessage(h.db, h.storage, mk({ id: 'd-unk3@capture.fixture', from: 'Pedro <pedro@geodatos-andinos.com>', subject: 'Seismic data, third mail', text: 'Third.' }), deps);
  assert.equal(third.proposals.length, 0);

  // once the organisation is in the registry, the waiting dispatch is created at the next poll
  const org = await api('POST', '/api/organisations', { name: 'Geodatos Andinos S.A.S.', kind: 'vendor', identifiers: { domains: ['geodatos-andinos.com'] } });
  assert.equal(org.status, 201);
  await api('POST', '/api/contacts', { organisation_id: org.body.id, name: 'Marta Ibarra', emails: ['marta@geodatos-andinos.com'] });
  assert.ok(await resolvePendingDispatches(h.db) >= 1);
  const [late] = await disp('d-unk@capture.fixture');
  assert.deepEqual([late.direction, late.organisation_id, late.contact_ids.length], ['in', org.body.id, 1]);
  assert.equal((await item('d-unk@capture.fixture')).extracted.dispatch_pending, false);
  assert.equal(await resolvePendingDispatches(h.db), 0, 'nothing is created twice');
});

test('outbound mail to an unknown organisation is proposed too, and its dispatch waits for the organisation', async () => {
  const sent = mk({ id: 'o-out@capture.fixture', from: INFO, to: ['Ines Cruz <ines@refinadora-sur.com>'], folder: 'sent', subject: 'Introduction', text: 'We would like to introduce ourselves.' });
  const r = await captureMessage(h.db, h.storage, sent, deps);
  assert.equal(r.dispatch_ids.length, 0);
  const p = (await q(`SELECT payload FROM review_queue WHERE id = $1`, [r.proposals[0]]))[0].payload;
  assert.deepEqual([p.domain, p.direction], ['refinadora-sur.com', 'out']);
  const org = await api('POST', '/api/organisations', { name: 'Refinadora del Sur', kind: 'client', identifiers: { domains: ['refinadora-sur.com'] } });
  await resolvePendingDispatches(h.db);
  const d = (await q(`SELECT d.* FROM dispatches d JOIN items i ON i.id = d.item_id WHERE i.external_id = 'o-out@capture.fixture'`))[0];
  assert.deepEqual([d.direction, d.organisation_id, d.contact_ids], ['out', org.body.id, []], 'organisation matched by the recipient\'s domain, no contact yet');
});

test('AC4: excluded senders, excluded labels and personal labels are never ingested, and each is audited as skipped', async () => {
  const put = await api('PUT', '/api/settings/mail_exclusions', { value: { addresses: ['spouse@family.example'], domains: ['private-bank.example'], labels: ['Private/Health'] } });
  assert.equal(put.status, 200);
  const before = (await q('SELECT count(*)::int AS n FROM items'))[0].n;
  const chunksBefore = (await q('SELECT count(*)::int AS n FROM chunks'))[0].n;
  const att = [{ filename: 'scan.pdf', mime: 'application/pdf', bytes: await makePdf(['Private statement']) }];
  const excluded = [
    mk({ id: 'x-addr@capture.fixture', from: 'Spouse <spouse@family.example>', subject: 'Dinner', text: 'Dinner at eight?', attachments: att }),
    mk({ id: 'x-dom@capture.fixture', from: 'Bank <statements@private-bank.example>', subject: 'Your statement', text: 'Statement attached.' }),
    mk({ id: 'x-lab@capture.fixture', from: MARIA, subject: 'Carabobo injection data (private)', text: 'Volumes.', labels: ['INBOX', 'Private/Health'] }),
    mk({ id: 'x-pers@capture.fixture', from: MARIA, subject: 'Carabobo lunch', text: 'Lunch?', labels: ['\\Seen', '$Personal'] }),
    mk({ id: 'x-sent@capture.fixture', from: INFO, to: ['spouse@family.example'], folder: 'sent', subject: 'Re: Dinner', text: 'Yes.' }),
  ];
  const source = listSource('zoho-mail:ac4', [...excluded, mk({ id: 'x-ok@capture.fixture', from: MARIA, subject: 'Carabobo screening', text: 'Ordinary message.' })]);
  const stats = await pollMailbox(h.db, h.storage, source, deps);
  assert.deepEqual([stats.fetched, stats.skipped, stats.created], [6, 5, 1], 'the poll goes on past them');
  assert.equal(await getCursor(h.db, 'zoho-mail:ac4'), '6');

  for (const m of excluded) {
    assert.equal((await q(`SELECT count(*)::int AS n FROM items WHERE external_id LIKE $1`, [m.external_id + '%']))[0].n, 0, `${m.external_id} is absent`);
    const ev = await q(`SELECT * FROM audit_events WHERE action = 'mail.capture.skipped' AND detail->>'message_id' = $1`, [m.external_id]);
    assert.equal(ev.length, 1, `${m.external_id} audited`);
    assert.equal(ev[0].detail.status, 'skipped'); assert.equal(ev[0].person_id, 'mail-capture');
    assert.equal(JSON.stringify(ev[0].detail).includes('family.example'), false, 'the audit event does not repeat the address');
  }
  assert.deepEqual((await q(`SELECT detail->>'reason' AS r FROM audit_events WHERE action = 'mail.capture.skipped' AND detail->>'message_id' LIKE 'x-%' ORDER BY id`)).map(r => r.r), ['address', 'domain', 'label', 'personal-label', 'address']);
  assert.equal((await q('SELECT count(*)::int AS n FROM items'))[0].n, before + 1, 'only the ordinary message was stored');
  assert.ok((await q('SELECT count(*)::int AS n FROM chunks'))[0].n > chunksBefore);
  assert.equal((await q(`SELECT count(*)::int AS n FROM filing_queue q JOIN items i ON i.id = q.item_id WHERE i.external_id LIKE 'x-%' AND i.external_id <> 'x-ok@capture.fixture'`))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int AS n FROM dispatches d JOIN items i ON i.id = d.item_id WHERE i.external_id LIKE 'x-%' AND i.external_id <> 'x-ok@capture.fixture'`))[0].n, 0);
  await h.db.query(`DELETE FROM settings WHERE key = 'mail_exclusions'`);
});

test('poll: the cursor moves only past captured messages; a failure stops the mailbox and the next poll resumes at that message', async () => {
  const list = [mk({ id: 'p1@capture.fixture' }), mk({ id: 'p2@capture.fixture' }), mk({ id: 'p3@capture.fixture' }), mk({ id: 'p4@capture.fixture' })];
  const flaky = listSource('zoho-mail:flaky', list, { failAt: 2 });
  const s1 = await pollMailbox(h.db, h.storage, flaky, deps);
  assert.equal(s1.created, 2); assert.match(s1.errors[0], /mail server went away/);
  assert.equal(await getCursor(h.db, 'zoho-mail:flaky'), '2');
  const s2 = await pollMailbox(h.db, h.storage, listSource('zoho-mail:flaky', list), deps);
  assert.deepEqual([s2.fetched, s2.created, s2.duplicates], [2, 2, 0]);

  // a capture that throws stops the poll before its cursor is stored
  const boom = { ...deps, sink: async () => { throw new Error('storage down'); } };
  const s3 = await pollMailbox(h.db, h.storage, listSource('zoho-mail:boom', [mk({ id: 'p5@capture.fixture' })]), boom);
  assert.match(s3.errors[0], /storage down/); assert.equal(await getCursor(h.db, 'zoho-mail:boom'), null);

  // a backfill reads from a date, leaves an existing cursor alone and sets one where there was none
  const dated = [mk({ id: 'b1@capture.fixture', date: '2026-01-05T00:00:00Z' }), mk({ id: 'b2@capture.fixture', date: '2026-02-05T00:00:00Z' }), mk({ id: 'b3@capture.fixture', date: '2026-03-05T00:00:00Z' })];
  await setCursor(h.db, 'zoho-mail:live', '99');
  const live = await pollMailbox(h.db, h.storage, listSource('zoho-mail:live', dated), deps, { since: new Date('2026-02-01T00:00:00Z') });
  assert.equal(live.created, 2); assert.equal(await getCursor(h.db, 'zoho-mail:live'), '99');
  const fresh = await pollMailbox(h.db, h.storage, listSource('zoho-mail:fresh', dated), deps, { since: new Date('2026-02-01T00:00:00Z') });
  assert.deepEqual([fresh.created, fresh.duplicates], [0, 2]);
  assert.equal(await getCursor(h.db, 'zoho-mail:fresh'), '3');
});

test('both adapters feed the same capture: the recorded mailbox through IMAP, then through Gmail, gives one item per message', async () => {
  await h.db.query(`DELETE FROM settings WHERE key = 'mail_exclusions'`);
  const imap = new ImapSource({ user: MAILBOX, clientFactory: fakeImapFactory() });
  const s1 = await pollMailbox(h.db, h.storage, imap, deps);
  assert.deepEqual([s1.fetched, s1.created, s1.skipped, s1.filed, s1.queued, s1.errors], [12, 11, 1, 6, 4, []], 'the personal message is skipped; contacts of the Orinoco project file; the newsletter is bulk (wave 6); the rest queue');
  assert.equal((await item('m07@mail.fixture')), undefined);
  const news = await item('m04@mail.fixture');
  assert.equal(news.hidden, true, 'a newsletter is kept apart (P56)'); assert.equal(news.extracted.category, 'bulk'); assert.match(news.extracted.bulk_reason, /sender news@/);
  assert.equal(s1.attachments, 6, 'one child per attachment: pdf, nda draft, csv, two comments, invoice');

  const filed = (await q(`SELECT external_id FROM items WHERE project_id = 'orinoco-partnership' AND origin->>'source' = 'zoho-mail' AND external_id LIKE 'm%@mail.fixture' AND parent_id IS NULL ORDER BY external_id`)).map(r => r.external_id);
  assert.deepEqual(filed, ['m01', 'm02', 'm03', 'm08', 'm09', 'm11'].map(x => `${x}@mail.fixture`));
  const dirs = (await q(`SELECT i.external_id, d.direction, d.in_reply_to FROM dispatches d JOIN items i ON i.id = d.item_id WHERE i.external_id LIKE 'm%@mail.fixture' ORDER BY i.external_id`));
  assert.deepEqual(dirs.map(d => [d.external_id.slice(0, 3), d.direction]), [['m01', 'in'], ['m02', 'out'], ['m03', 'in'], ['m08', 'in'], ['m09', 'out'], ['m11', 'out']]);
  const byExt = Object.fromEntries((await q(`SELECT i.external_id, d.id FROM dispatches d JOIN items i ON i.id = d.item_id WHERE i.external_id LIKE 'm%@mail.fixture'`)).map(r => [r.external_id.slice(0, 3), r.id]));
  const irt = Object.fromEntries(dirs.map(d => [d.external_id.slice(0, 3), d.in_reply_to]));
  assert.equal(irt.m02, byExt.m01); assert.equal(irt.m08, byExt.m03); assert.equal(irt.m09, byExt.m03); assert.equal(irt.m11, null);
  const orgs = (await q(`SELECT payload->>'domain' AS d FROM review_queue WHERE kind = 'organisation' AND payload->>'source' = 'mail-capture' AND payload->>'sender_email' LIKE '%@%' AND payload->>'domain' IN ('andinolabs.co','oilgasjournal.com','camara-hidrocarburos.org','suministros-llano.com') ORDER BY 1`)).map(r => r.d);
  assert.deepEqual(orgs, ['andinolabs.co', 'camara-hidrocarburos.org', 'suministros-llano.com'], 'bulk mail proposes no organisation');

  const gmail = new GmailSource({ clientId: 'a', clientSecret: 'b', refreshToken: 'c', mailbox: MAILBOX, fetch: fakeGmailFetch(), sleep: async () => {} });
  const s2 = await pollMailbox(h.db, h.storage, gmail, { ...deps, origin: 'gmail' });
  assert.deepEqual([s2.fetched, s2.created, s2.duplicates, s2.skipped], [12, 0, 11, 1], 'the same Message-Ids are not captured twice, whichever adapter delivered them');
  assert.equal(await getCursor(h.db, `gmail:${MAILBOX}`), '1000');
  const late = await pollMailbox(h.db, h.storage, new GmailSource({ clientId: 'a', clientSecret: 'b', refreshToken: 'c', mailbox: MAILBOX, fetch: fakeGmailFetch({ late: true }), sleep: async () => {} }), { ...deps, origin: 'gmail' });
  assert.deepEqual([late.fetched, late.created, late.filed], [1, 1, 1], 'a later message comes through history.list and files by its contact and thread');
  assert.equal((await item('m13@mail.fixture')).origin.source, 'gmail');
});

test('AC3: a backfill of 1,000 generated messages completes with zero duplicates, and running it again adds nothing', async () => {
  await h.db.query(`DELETE FROM settings WHERE key = 'mail_exclusions'`);
  const contacts = ['mfernandez@petroleradelorinoco.com', 'lparedes@petroleradelorinoco.com'];
  const gen: RawMessage[] = [];
  for (let i = 0; i < 1000; i++) {
    const kind = i % 10;
    const from = kind < 4 ? contacts[i % 2] : kind < 6 ? `sender${i % 37}@vendor${i % 11}.example` : INFO;
    const sent = kind >= 6 && kind < 8;
    const prior = i > 20 && kind % 3 === 0 ? gen[i - 7] : null;
    gen.push(mk({
      id: `bulk-${i}@capture.fixture`, from: sent ? INFO : from === INFO ? 'Chris <chris@alpha-technical-centre.com>' : from,
      to: sent ? [contacts[i % 2]] : [INFO], folder: sent ? 'sent' : 'inbox', subject: `Bulk message ${i}: Carabobo item ${i % 97}`, text: `Generated body ${i}. ${'Reservoir data. '.repeat(3 + (i % 5))}`,
      date: new Date(Date.UTC(2025, 0, 1, 0, 0, i * 7)).toISOString(), ...(prior ? { in_reply_to: prior.external_id, references: [prior.external_id] } : {}),
      attachments: i % 20 === 0 ? [{ filename: `data-${i}.csv`, mime: 'text/csv', bytes: new TextEncoder().encode(`a,b\n${i},${i * 2}\n`) }] : [],
    }));
  }
  // 100 of them are delivered twice by the server, 30 more come back with a new Message-Id
  const delivered = [...gen];
  for (let i = 0; i < 100; i++) delivered.splice(i * 9 + 5, 0, gen[i * 9]);
  for (let i = 0; i < 30; i++) delivered.push({ ...gen[i * 31 + 3], external_id: `bulk-reissued-${i}@gateway.example`, thread_id: `bulk-reissued-${i}@gateway.example`, in_reply_to: null, references: [] });
  assert.equal(delivered.length, 1130);
  // Wave 6 (P54): mail between colleagues only is never kept, so the 200 colleague-only messages (and their repeats) are skipped by rule.
  const colleaguesOnly = (m: RawMessage) => [m.from, ...m.to, ...m.cc].every(a => a.address.endsWith('@alpha-technical-centre.com'));
  const kept = gen.filter(m => !colleaguesOnly(m)).length, protectedDeliveries = delivered.filter(colleaguesOnly).length;
  assert.deepEqual([kept, protectedDeliveries], [800, 226]);

  const beforeItems = (await q(`SELECT count(*)::int AS n FROM items`))[0].n;
  const t0 = Date.now();
  const source = listSource('zoho-mail:bulk', delivered);
  const run = await runMailBackfill(h.db, new Date('2000-01-01T00:00:00Z'), { sources: [source], deps: null, storage: h.storage, sink: deps.sink });
  const took = Date.now() - t0;
  const s = run.mailboxes[0];
  assert.deepEqual(s.errors, []);
  assert.equal(s.fetched, 1130);
  assert.equal(s.created, kept, 'one item for each distinct message the rules allow');
  assert.equal(s.duplicates, 1130 - kept - protectedDeliveries);
  assert.equal(s.skipped, protectedDeliveries);
  console.log(`backfill: ${s.fetched} delivered, ${s.created} created, ${s.duplicates} duplicates, ${s.filed} filed, ${s.queued} queued, ${s.dispatches} dispatches, ${s.attachments} attachments in ${took} ms`);

  const bulk = await q(`SELECT id, external_id, parent_id, extracted->>'fingerprint' AS fp FROM items WHERE external_id LIKE 'bulk-%'`);
  const parents = bulk.filter(b => b.parent_id === null);
  assert.equal(parents.length, kept);
  assert.equal(new Set(parents.map(p => p.external_id)).size, kept, 'no Message-Id twice');
  assert.equal(new Set(parents.map(p => p.fp)).size, kept, 'no content twice');
  assert.equal(bulk.length - parents.length, 50, 'every attachment is stored once');
  assert.equal((await q(`SELECT count(*)::int AS n FROM items WHERE external_id LIKE 'bulk-reissued%'`))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int AS n FROM (SELECT item_id, organisation_id FROM dispatches GROUP BY 1, 2 HAVING count(*) > 1) x`))[0].n, 0, 'no dispatch twice');
  assert.equal((await q(`SELECT count(*)::int AS n FROM filing_queue q JOIN items i ON i.id = q.item_id WHERE i.external_id LIKE 'bulk-%' GROUP BY q.item_id HAVING count(*) > 1`)).length, 0);
  assert.equal(await getCursor(h.db, 'zoho-mail:bulk'), '1130');
  assert.equal((await q(`SELECT status FROM jobs WHERE name = 'mail-backfill' ORDER BY id DESC LIMIT 1`))[0].status, 'ok');

  const again = await runMailBackfill(h.db, new Date('2000-01-01T00:00:00Z'), { sources: [listSource('zoho-mail:bulk', delivered)], deps: null, storage: h.storage, sink: deps.sink });
  assert.deepEqual([again.mailboxes[0].created, again.mailboxes[0].duplicates, again.mailboxes[0].skipped], [0, 1130 - protectedDeliveries, protectedDeliveries]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM items`))[0].n, beforeItems + kept + 50);
});

test('the poll job runs every configured mailbox from its cursor and records the run', async () => {
  const src = listSource('zoho-mail:job', [mk({ id: 'job-1@capture.fixture' }), mk({ id: 'job-2@capture.fixture' })]);
  const first = await runMailPoll(h.db, { sources: [src], deps: null, storage: h.storage, sink: deps.sink });
  assert.equal(first.mailboxes[0].created, 2);
  src.messages.push(mk({ id: 'job-3@capture.fixture' }));
  const second = await runMailPoll(h.db, { sources: [src], deps: null, storage: h.storage, sink: deps.sink });
  assert.deepEqual([second.mailboxes[0].fetched, second.mailboxes[0].created], [1, 1]);
  const jobs = await q(`SELECT status, summary FROM jobs WHERE name = 'mail-poll' ORDER BY id`);
  assert.deepEqual(jobs.map(j => j.status), ['ok', 'ok']);
  assert.equal(jobs[1].summary.mailboxes[0].mailbox, 'zoho-mail:job');
  assert.equal(existsSync(path.join(h.storageDir, 'originals')), true);
});
