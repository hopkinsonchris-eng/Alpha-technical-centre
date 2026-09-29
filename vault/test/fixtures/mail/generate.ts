/**
 * Generates the recorded mailbox fixtures for the M10 adapter tests: one mailbox of 12 messages (plus a 13th that "arrives
 * later"), written as RFC 822 files and as what an IMAP server and the Gmail REST API answer for them. Deterministic.
 * Run: npx tsx test/fixtures/mail/generate.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePdf } from '../ingest/build.ts';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const INFO = 'info@alpha-technical-centre.com';

interface Att { filename: string; mime: string; bytes: Uint8Array }
interface Def {
  n: number; id: string; folder: 'inbox' | 'sent'; date: string; from: string; to: string[]; cc?: string[]; subject: string; encodedSubject?: boolean;
  text: string; html?: string; qp?: boolean; inReplyTo?: string; references?: string[]; atts?: Att[]; flags?: string[]; labelIds?: string[]; late?: boolean;
}

const b64 = (b: Uint8Array | Buffer | string, wrap = true) => { const s = Buffer.from(b as any).toString('base64'); return wrap ? s.replace(/(.{76})/g, '$1\r\n') : s; };
const enc = (s: string) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const qpEncode = (s: string) => Buffer.from(s, 'utf8').reduce((out, b) => out + (b > 126 || b < 32 && b !== 10 || b === 61 ? `=${b.toString(16).toUpperCase().padStart(2, '0')}` : String.fromCharCode(b)), '').replace(/\n/g, '\r\n');

function eml(d: Def): string {
  const boundary = `----=_atc_${d.n}`;
  const h = [
    `Message-ID: <${d.id}>`, `Date: ${new Date(d.date).toUTCString()}`, `From: ${d.from}`, `To: ${d.to.join(', ')}`,
    ...(d.cc?.length ? [`Cc: ${d.cc.join(', ')}`] : []), `Subject: ${d.encodedSubject ? enc(d.subject) : d.subject}`,
    ...(d.inReplyTo ? [`In-Reply-To: <${d.inReplyTo}>`] : []), ...(d.references?.length ? [`References: ${d.references.map(r => `<${r}>`).join(' ')}`] : []), 'MIME-Version: 1.0',
  ];
  const textPart = d.qp
    ? `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qpEncode(d.text)}\r\n`
    : `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${d.text.replace(/\n/g, '\r\n')}\r\n`;
  const htmlPart = d.html ? `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${d.html}\r\n` : '';
  let body: string;
  if (d.atts?.length) {
    const alt = d.html ? `--${boundary}-alt\r\n${textPart}--${boundary}-alt\r\n${htmlPart}--${boundary}-alt--\r\n` : '';
    body = `--${boundary}\r\n` + (d.html ? `Content-Type: multipart/alternative; boundary="${boundary}-alt"\r\n\r\n${alt}` : textPart) +
      d.atts.map(a => `--${boundary}\r\nContent-Type: ${a.mime}; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.bytes)}\r\n`).join('') + `--${boundary}--\r\n`;
    h.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  } else if (d.html && d.text) {
    body = `--${boundary}\r\n${textPart}--${boundary}\r\n${htmlPart}--${boundary}--\r\n`;
    h.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  } else if (d.html) {
    body = `${d.html}\r\n`;
    h.push('Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
  } else {
    body = textPart.replace(/^Content-Type[^]*?\r\n\r\n/, '');
    h.push(...textPart.split('\r\n\r\n')[0].split('\r\n'));
  }
  return h.join('\r\n') + '\r\n\r\n' + body;
}

const pdf = await makePdf(['Water injection data, Cubiro field, monthly volumes January to August 2026.', 'Injection rate averaged 21,400 bwpd across four injectors.']);
const invoicePdf = await makePdf(['INVOICE 2026-0417 Suministros del Llano SAS. Amount due USD 4,200.00. Due 30 days.']);
const csv = (s: string) => new TextEncoder().encode(s);

const M = (n: number) => `m${String(n).padStart(2, '0')}@mail.fixture`;
const defs: Def[] = [
  { n: 1, id: M(1), folder: 'inbox', date: '2026-03-02T09:15:00Z', from: 'María Fernández <mfernandez@petroleradelorinoco.com>', to: [INFO], subject: 'Cubiro water injection data request',
    text: 'Dear team,\n\nPlease find attached the injection volumes for the Cubiro field. Could you confirm receipt?\n\nSaludos,\nMaría', atts: [{ filename: 'cubiro-injection-2026.pdf', mime: 'application/pdf', bytes: pdf }], flags: ['\\Seen'], labelIds: ['INBOX', 'UNREAD'] },
  { n: 2, id: M(2), folder: 'sent', date: '2026-03-02T11:40:00Z', from: 'Chris Hopkinson <chris@alpha-technical-centre.com>', to: ['María Fernández <mfernandez@petroleradelorinoco.com>'], subject: 'Re: Cubiro water injection data request',
    text: 'María,\n\nReceived, thank you. We will review the volumes and revert this week.\n\nChris', inReplyTo: M(1), references: [M(1)], flags: ['\\Seen'], labelIds: ['SENT'] },
  { n: 3, id: M(3), folder: 'inbox', date: '2026-03-04T15:02:00Z', from: 'Dr. Luis Paredes <lparedes@petroleradelorinoco.com>', to: [INFO], cc: ['mfernandez@petroleradelorinoco.com'], subject: 'Borrador de NDA — revisión', encodedSubject: true,
    text: 'Estimados,\n\nAdjunto el borrador del acuerdo de confidencialidad para su revisión.', html: '<html><body><p>Estimados,</p><p>Adjunto el borrador del acuerdo de confidencialidad para su revisión.</p></body></html>',
    atts: [{ filename: 'nda-draft.txt', mime: 'text/plain', bytes: csv('MUTUAL NON-DISCLOSURE AGREEMENT between Alpha Technical Centre and Petrolera del Orinoco S.A.\n') }], flags: ['\\Seen'], labelIds: ['INBOX', 'CATEGORY_PERSONAL'] },
  { n: 4, id: M(4), folder: 'inbox', date: '2026-03-05T06:00:00Z', from: 'Oil & Gas Journal <news@oilgasjournal.com>', to: [INFO], subject: 'This week in upstream',
    text: '', html: '<html><body><h1>This week in upstream</h1><p>Brent closed at 84 dollars.</p></body></html>', flags: [], labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] },
  { n: 5, id: M(5), folder: 'inbox', date: '2026-03-09T13:30:00Z', from: 'Jorge Salazar <jorge.salazar@andinolabs.co>', to: [INFO], subject: 'PVT report Cubiro-14',
    text: 'Hello,\n\nAttached is the PVT report for Cubiro-14 as agreed.\n\nJorge', atts: [{ filename: 'cubiro-14-pvt.csv', mime: 'text/csv', bytes: csv('pressure_psia,rs_scf_stb,bo_rb_stb\n3500,620,1.31\n2500,455,1.27\n') }], flags: [], labelIds: ['INBOX'] },
  { n: 6, id: M(6), folder: 'sent', date: '2026-03-09T16:10:00Z', from: `ATC shared mailbox <${INFO}>`, to: ['Jorge Salazar <jorge.salazar@andinolabs.co>'], cc: ['chris@alpha-technical-centre.com'], subject: 'Re: PVT report Cubiro-14',
    text: 'Jorge,\n\nThank you, the report arrived.\n\nATC', inReplyTo: M(5), references: [M(5)], flags: ['\\Seen'], labelIds: ['SENT'] },
  { n: 7, id: M(7), folder: 'inbox', date: '2026-03-10T18:45:00Z', from: 'Ana <ana.family@gmail.com>', to: [INFO], subject: 'Sunday lunch',
    text: 'Are we still on for Sunday?', flags: ['$Personal'], labelIds: ['INBOX', 'Label_1'] },
  { n: 8, id: M(8), folder: 'inbox', date: '2026-03-11T10:05:00Z', from: 'María Fernández <mfernandez@petroleradelorinoco.com>', to: [INFO], subject: 'Re: Borrador de NDA — revisión', encodedSubject: true,
    text: 'Gracias, revisaremos el borrador y le enviamos comentarios.', inReplyTo: M(3), references: [M(3)], atts: [{ filename: 'comments-1.txt', mime: 'text/plain', bytes: csv('Clause 4: confidentiality term 24 months.\n') }, { filename: 'comments-2.txt', mime: 'text/plain', bytes: csv('Clause 9: governing law England and Wales.\n') }], flags: ['\\Seen'], labelIds: ['INBOX'] },
  { n: 9, id: M(9), folder: 'sent', date: '2026-03-12T08:20:00Z', from: 'Chris Hopkinson <chris@alpha-technical-centre.com>', to: ['Dr. Luis Paredes <lparedes@petroleradelorinoco.com>'], subject: 'Re: Borrador de NDA — revisión', encodedSubject: true,
    text: 'Luis,\n\nHemos recibido el borrador. Le respondemos con comentarios el viernes.\n\nChris', inReplyTo: M(3), references: [M(3), M(8)], flags: ['\\Seen'], labelIds: ['SENT'] },
  { n: 10, id: M(10), folder: 'inbox', date: '2026-03-13T14:00:00Z', from: 'Cámara de Hidrocarburos <info@camara-hidrocarburos.org>', to: [INFO], subject: 'Convocatoria: taller de regalías — Bogotá',
    text: 'Estimados socios,\n\nLes invitamos al taller de regalías que se celebrará el próximo mes en Bogotá. Inscripción sin costo. ¡Esperamos su participación!', qp: true, flags: [], labelIds: ['INBOX'] },
  { n: 11, id: M(11), folder: 'sent', date: '2026-03-16T09:00:00Z', from: 'Chris Hopkinson <chris@alpha-technical-centre.com>', to: ['María Fernández <mfernandez@petroleradelorinoco.com>', 'Luis Paredes <lparedes@petroleradelorinoco.com>'], cc: ['Jorge Salazar <jorge.salazar@andinolabs.co>'], subject: 'Cubiro-14 PVT and injection review',
    text: 'María, Luis,\n\nWe have combined the PVT report with the injection data. Findings attached to follow.\n\nChris', flags: ['\\Seen'], labelIds: ['SENT'] },
  { n: 12, id: M(12), folder: 'inbox', date: '2026-03-17T07:30:00Z', from: 'Cuentas <cuentas@suministros-llano.com>', to: [INFO], subject: '',
    text: 'Adjuntamos la factura.', atts: [{ filename: 'invoice-2026-0417.pdf', mime: 'application/pdf', bytes: invoicePdf }], flags: [], labelIds: ['INBOX'] },
  { n: 13, id: M(13), folder: 'inbox', date: '2026-03-20T12:00:00Z', from: 'María Fernández <mfernandez@petroleradelorinoco.com>', to: [INFO], subject: 'Cubiro-14 follow-up',
    text: 'Following up on the Cubiro-14 review: can we meet on Thursday?', inReplyTo: M(1), references: [M(1)], flags: [], labelIds: ['INBOX'], late: true },
];

for (const d of ['eml', 'imap', 'gmail', 'gmail/messages']) { rmSync(path.join(OUT, d), { recursive: true, force: true }); mkdirSync(path.join(OUT, d), { recursive: true }); }

const uidOf = (d: Def) => defs.filter(x => x.folder === d.folder && x.n <= d.n).length;
const manifest = defs.map(d => ({ n: d.n, file: `eml/${String(d.n).padStart(2, '0')}.eml`, message_id: d.id, folder: d.folder, uid: uidOf(d), gmail_id: `g${String(d.n).padStart(2, '0')}`, late: !!d.late,
  labels_imap: d.flags ?? [], label_ids: d.labelIds ?? [], date: d.date }));
writeFileSync(path.join(OUT, 'mailbox.json'), JSON.stringify({ mailbox: INFO, messages: manifest }, null, 1) + '\n');
for (const d of defs) writeFileSync(path.join(OUT, `eml/${String(d.n).padStart(2, '0')}.eml`), eml(d));

// What an IMAP server holds: per folder the UIDVALIDITY and the messages with flags.
for (const [folder, name] of [['inbox', 'INBOX'], ['sent', 'Sent']] as const) {
  writeFileSync(path.join(OUT, `imap/${name}.json`), JSON.stringify({ path: name, uidValidity: name === 'INBOX' ? 1700000001 : 1700000002,
    messages: manifest.filter(m => m.folder === folder).map(m => ({ uid: m.uid, file: m.file, flags: m.labels_imap, internalDate: m.date, late: m.late })) }, null, 1) + '\n');
}

// What Gmail answers: profile, labels, list pages (newest first), one raw message each, and the history after the first backfill.
writeFileSync(path.join(OUT, 'gmail/profile.json'), JSON.stringify({ emailAddress: INFO, messagesTotal: 12, threadsTotal: 8, historyId: '1000' }, null, 1) + '\n');
writeFileSync(path.join(OUT, 'gmail/profile-late.json'), JSON.stringify({ emailAddress: INFO, messagesTotal: 13, threadsTotal: 8, historyId: '1010' }, null, 1) + '\n');
writeFileSync(path.join(OUT, 'gmail/labels.json'), JSON.stringify({ labels: [
  { id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'SENT', name: 'SENT', type: 'system' }, { id: 'UNREAD', name: 'UNREAD', type: 'system' },
  { id: 'CATEGORY_PERSONAL', name: 'CATEGORY_PERSONAL', type: 'system' }, { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' }, { id: 'Label_1', name: 'Personal', type: 'user' },
] }, null, 1) + '\n');
const threadOf = (d: Def) => `t-${(d.references?.[0] ?? d.inReplyTo ?? d.id).replace(/[^a-z0-9]/g, '')}`;
for (const d of defs) {
  const raw = Buffer.from(eml(d), 'utf8').toString('base64url');
  writeFileSync(path.join(OUT, `gmail/messages/g${String(d.n).padStart(2, '0')}.json`), JSON.stringify({ id: `g${String(d.n).padStart(2, '0')}`, threadId: threadOf(d), labelIds: d.labelIds ?? [], internalDate: String(Date.parse(d.date)), historyId: String(900 + d.n), sizeEstimate: raw.length, raw }) + '\n');
}
const listed = defs.filter(d => !d.late).map(d => ({ id: `g${String(d.n).padStart(2, '0')}`, threadId: threadOf(d) })).reverse();
writeFileSync(path.join(OUT, 'gmail/messages.list.page1.json'), JSON.stringify({ messages: listed.slice(0, 7), nextPageToken: 'page2', resultSizeEstimate: 12 }, null, 1) + '\n');
writeFileSync(path.join(OUT, 'gmail/messages.list.page2.json'), JSON.stringify({ messages: listed.slice(7), resultSizeEstimate: 12 }, null, 1) + '\n');
const late = defs.find(d => d.late)!;
writeFileSync(path.join(OUT, 'gmail/history.after-1000.json'), JSON.stringify({ history: [{ id: '1005', messages: [{ id: 'g13' }], messagesAdded: [{ message: { id: 'g13', threadId: threadOf(late), labelIds: ['INBOX'] } }] }], historyId: '1010' }, null, 1) + '\n');
console.log(`wrote ${defs.length} messages to ${OUT}`);
