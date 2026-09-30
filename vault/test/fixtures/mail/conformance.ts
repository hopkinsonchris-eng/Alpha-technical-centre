/**
 * The conformance suite both mail adapters must pass on the same 12-message recorded mailbox (M10 AC5).
 * Expectations are written out by hand here, independent of the parsing code they check.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MailSource, RawMessage } from '../../../src/ingest/mail/types.ts';
import { manifest, readEml } from './fakes.ts';

export interface Made { source: MailSource }
export type Make = (o: { late?: boolean }) => Made;

const INFO = 'info@alpha-technical-centre.com';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 12);
const m = (n: number) => `m${String(n).padStart(2, '0')}@mail.fixture`;

interface Expect { from: string; to: string[]; cc: string[]; subject: string; date: string; in_reply_to: string | null; references: string[]; thread: number; folder: 'inbox' | 'sent'; atts: string[]; textStarts: string }
export const EXPECTED: Record<number, Expect> = {
  1: { from: 'mfernandez@petroleradelorinoco.com', to: [INFO], cc: [], subject: 'Cubiro water injection data request', date: '2026-03-02T09:15:00.000Z', in_reply_to: null, references: [], thread: 1, folder: 'inbox', atts: ['cubiro-injection-2026.pdf'], textStarts: 'Dear team,' },
  2: { from: 'chris@alpha-technical-centre.com', to: ['mfernandez@petroleradelorinoco.com'], cc: [], subject: 'Re: Cubiro water injection data request', date: '2026-03-02T11:40:00.000Z', in_reply_to: m(1), references: [m(1)], thread: 1, folder: 'sent', atts: [], textStarts: 'María,' },
  3: { from: 'lparedes@petroleradelorinoco.com', to: [INFO], cc: ['mfernandez@petroleradelorinoco.com'], subject: 'Borrador de NDA — revisión', date: '2026-03-04T15:02:00.000Z', in_reply_to: null, references: [], thread: 3, folder: 'inbox', atts: ['nda-draft.txt'], textStarts: 'Estimados,' },
  4: { from: 'news@oilgasjournal.com', to: [INFO], cc: [], subject: 'This week in upstream', date: '2026-03-05T06:00:00.000Z', in_reply_to: null, references: [], thread: 4, folder: 'inbox', atts: [], textStarts: 'THIS WEEK IN UPSTREAM' },
  5: { from: 'jorge.salazar@andinolabs.co', to: [INFO], cc: [], subject: 'PVT report Cubiro-14', date: '2026-03-09T13:30:00.000Z', in_reply_to: null, references: [], thread: 5, folder: 'inbox', atts: ['cubiro-14-pvt.csv'], textStarts: 'Hello,' },
  6: { from: INFO, to: ['jorge.salazar@andinolabs.co'], cc: ['chris@alpha-technical-centre.com'], subject: 'Re: PVT report Cubiro-14', date: '2026-03-09T16:10:00.000Z', in_reply_to: m(5), references: [m(5)], thread: 5, folder: 'sent', atts: [], textStarts: 'Jorge,' },
  7: { from: 'ana.family@gmail.com', to: [INFO], cc: [], subject: 'Sunday lunch', date: '2026-03-10T18:45:00.000Z', in_reply_to: null, references: [], thread: 7, folder: 'inbox', atts: [], textStarts: 'Are we still on' },
  8: { from: 'mfernandez@petroleradelorinoco.com', to: [INFO], cc: [], subject: 'Re: Borrador de NDA — revisión', date: '2026-03-11T10:05:00.000Z', in_reply_to: m(3), references: [m(3)], thread: 3, folder: 'inbox', atts: ['comments-1.txt', 'comments-2.txt'], textStarts: 'Gracias,' },
  9: { from: 'chris@alpha-technical-centre.com', to: ['lparedes@petroleradelorinoco.com'], cc: [], subject: 'Re: Borrador de NDA — revisión', date: '2026-03-12T08:20:00.000Z', in_reply_to: m(3), references: [m(3), m(8)], thread: 3, folder: 'sent', atts: [], textStarts: 'Luis,' },
  10: { from: 'info@camara-hidrocarburos.org', to: [INFO], cc: [], subject: 'Convocatoria: taller de regalías — Bogotá', date: '2026-03-13T14:00:00.000Z', in_reply_to: null, references: [], thread: 10, folder: 'inbox', atts: [], textStarts: 'Estimados socios,' },
  11: { from: 'chris@alpha-technical-centre.com', to: ['mfernandez@petroleradelorinoco.com', 'lparedes@petroleradelorinoco.com'], cc: ['jorge.salazar@andinolabs.co'], subject: 'Cubiro-14 PVT and injection review', date: '2026-03-16T09:00:00.000Z', in_reply_to: null, references: [], thread: 11, folder: 'sent', atts: [], textStarts: 'María, Luis,' },
  12: { from: 'cuentas@suministros-llano.com', to: [INFO], cc: [], subject: '', date: '2026-03-17T07:30:00.000Z', in_reply_to: null, references: [], thread: 12, folder: 'inbox', atts: ['invoice-2026-0417.pdf'], textStarts: 'Adjuntamos' },
  13: { from: 'mfernandez@petroleradelorinoco.com', to: [INFO], cc: [], subject: 'Cubiro-14 follow-up', date: '2026-03-20T12:00:00.000Z', in_reply_to: m(1), references: [m(1)], thread: 1, folder: 'inbox', atts: [], textStarts: 'Following up' },
};

export async function collect(source: MailSource, cursor: string | null = null, opts?: { since?: Date }) {
  const out: Array<{ message: RawMessage; cursor: string }> = [];
  for await (const x of source.fetch(cursor, opts)) out.push(x);
  return out;
}
const n = (msg: RawMessage) => Number(/^m(\d+)@/.exec(msg.external_id)![1]);

/** The attachment bytes as the fixture files hold them. */
function attachmentBytes(num: number): Array<{ filename: string; sha: string }> {
  const eml = readEml(manifest.messages.find(x => x.n === num)!.file).toString('latin1');
  const found: Array<{ filename: string; sha: string }> = [];
  for (const mt of eml.matchAll(/Content-Disposition: attachment; filename="([^"]+)"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)) found.push({ filename: mt[1], sha: sha(Buffer.from(mt[2].replace(/\s+/g, ''), 'base64')) });
  return found;
}

export function conformance(test: (name: string, fn: () => Promise<void>) => void, make: Make): void {
  test('conformance: a full read returns the 12 messages of the mailbox in the RawMessage shape', async () => {
    const got = await collect(make({}).source);
    assert.equal(got.length, 12);
    assert.deepEqual(got.map(g => n(g.message)).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const { message: g, cursor } of got) {
      const e = EXPECTED[n(g)];
      assert.equal(typeof cursor, 'string');
      assert.deepEqual(Object.keys(g).filter(k => k !== 'html').sort(), ['attachments', 'cc', 'date', 'external_id', 'folder', 'from', 'in_reply_to', 'labels', 'mailbox', 'references', 'subject', 'text', 'thread_id', 'to'], `keys of m${n(g)}`);
      assert.equal(g.mailbox, INFO);
      assert.equal(g.from.address, e.from, `from m${n(g)}`);
      assert.deepEqual(g.to.map(a => a.address), e.to, `to m${n(g)}`);
      assert.deepEqual(g.cc.map(a => a.address), e.cc, `cc m${n(g)}`);
      assert.equal(g.subject, e.subject, `subject m${n(g)}`);
      assert.equal(g.date, e.date, `date m${n(g)}`);
      assert.equal(g.in_reply_to, e.in_reply_to, `in_reply_to m${n(g)}`);
      assert.deepEqual(g.references, e.references, `references m${n(g)}`);
      assert.equal(g.thread_id, m(e.thread), `thread m${n(g)}`);
      assert.equal(g.folder, e.folder, `folder m${n(g)}`);
      assert.ok(g.text.trim().startsWith(e.textStarts), `text m${n(g)}: ${g.text.slice(0, 40)}`);
      assert.deepEqual(g.attachments.map(a => a.filename), e.atts, `attachments m${n(g)}`);
      assert.deepEqual(g.attachments.map(a => ({ filename: a.filename, sha: sha(a.bytes) })), attachmentBytes(n(g)), `attachment bytes m${n(g)}`);
      assert.ok(Array.isArray(g.labels));
    }
    const byN = new Map(got.map(g => [n(g.message), g.message]));
    assert.equal(byN.get(1)!.from.name, 'María Fernández');
    assert.ok(byN.get(3)!.html?.includes('<p>Estimados,</p>'), 'html kept beside the text');
    assert.ok(byN.get(4)!.text.includes('Brent closed'), 'an html-only message still has text');
    assert.equal(byN.get(4)!.html?.includes('<h1>'), true);
    assert.equal(byN.get(10)!.text.includes('¡Esperamos su participación!'), true, 'quoted-printable decoded');
    assert.equal(new Set(got.map(g => g.message.external_id)).size, 12, 'no message twice');
  });

  test('conformance: reading again from any message\'s cursor yields exactly the messages after it', async () => {
    const all = await collect(make({}).source);
    const at = all[4];
    const rest = await collect(make({}).source, at.cursor);
    assert.deepEqual(rest.map(r => r.message.external_id), all.slice(5).map(r => r.message.external_id));
    const end = await collect(make({}).source, all[all.length - 1].cursor);
    assert.equal(end.length, 0, 'from the last cursor there is nothing new');
  });

  test('conformance: a message that arrives after the last cursor is the only one the next read returns', async () => {
    const first = await collect(make({}).source);
    const next = await collect(make({ late: true }).source, first[first.length - 1].cursor);
    assert.deepEqual(next.map(x => x.message.external_id), [m(13)]);
    assert.equal(next[0].message.folder, 'inbox');
    assert.deepEqual(next[0].message.references, [m(1)]);
    const after = await collect(make({ late: true }).source, next[0].cursor);
    assert.equal(after.length, 0);
  });

  test('conformance: a backfill since a date returns only messages on or after it', async () => {
    const got = await collect(make({}).source, null, { since: new Date('2026-03-10T00:00:00Z') });
    assert.deepEqual(got.map(g => n(g.message)).sort((a, b) => a - b), [7, 8, 9, 10, 11, 12]);
  });

  test('conformance: sent and inbox folders are told apart', async () => {
    const got = await collect(make({}).source);
    assert.deepEqual(got.filter(g => g.message.folder === 'sent').map(g => n(g.message)).sort((a, b) => a - b), [2, 6, 9, 11]);
  });
}
