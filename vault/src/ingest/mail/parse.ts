/**
 * RFC 822 → RawMessage, shared by the IMAP and Gmail sources so both produce byte-identical results for the
 * same message (mailparser does the MIME work).
 */
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { MailAddress, MailFolder, RawMessage } from './types.ts';

const stripBrackets = (s: string) => s.trim().replace(/^<+|>+$/g, '').trim();

/** All Message-Ids named in a References or In-Reply-To header value. */
export function messageIds(v: string | string[] | undefined | null): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const out: string[] = [];
  for (const s of list) {
    const found = s.match(/<[^<>\s]+>/g);
    if (found) out.push(...found.map(stripBrackets));
    else if (s.trim()) out.push(...s.split(/\s+/).map(stripBrackets).filter(Boolean));
  }
  return [...new Set(out)];
}

function addresses(a: AddressObject | AddressObject[] | undefined): MailAddress[] {
  const objs = Array.isArray(a) ? a : a ? [a] : [];
  const out: MailAddress[] = [];
  const seen = new Set<string>();
  for (const o of objs) for (const v of o.value) {
    const address = (v.address ?? '').trim().toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push(v.name ? { address, name: v.name.trim() } : { address });
  }
  return out;
}

export interface ParseMeta { mailbox: string; folder: MailFolder; labels?: string[]; fallbackDate?: Date; fallbackId?: string }

export async function parseRfc822(source: Uint8Array | Buffer, meta: ParseMeta): Promise<RawMessage> {
  const p: ParsedMail = await simpleParser(Buffer.from(source));
  const external_id = stripBrackets(p.messageId ?? '') || meta.fallbackId || '';
  if (!external_id) throw new Error('message has no Message-Id');
  const references = messageIds(p.references);
  const in_reply_to = messageIds(p.inReplyTo)[0] ?? null;
  const from = addresses(p.from)[0] ?? { address: '' };
  const date = p.date && !Number.isNaN(p.date.getTime()) ? p.date : (meta.fallbackDate ?? new Date(0));
  const msg: RawMessage = {
    mailbox: meta.mailbox,
    external_id,
    thread_id: references[0] ?? in_reply_to ?? external_id,
    in_reply_to,
    references,
    from,
    to: addresses(p.to),
    cc: addresses(p.cc),
    subject: (p.subject ?? '').trim(),
    date: date.toISOString(),
    text: (p.text ?? '').replace(/\r\n/g, '\n'),
    attachments: (p.attachments ?? [])
      .filter(a => a.content && a.content.length > 0)
      .map((a, i) => ({ filename: a.filename || `attachment-${i + 1}`, mime: a.contentType || 'application/octet-stream', bytes: new Uint8Array(a.content) })),
    labels: [...(meta.labels ?? [])],
    folder: meta.folder,
  };
  if (typeof p.html === 'string' && p.html) msg.html = p.html;
  return msg;
}
