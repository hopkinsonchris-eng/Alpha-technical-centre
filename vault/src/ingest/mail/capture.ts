/**
 * captureMessage (M10, flow F4): one RawMessage becomes one email Item with its attachments as child Items.
 *
 *  1. excluded senders, labels and personal labels are skipped and audited (`mail.capture.skipped`), never stored;
 *  2. dedupe on Message-Id (across mailboxes and sources) and on a content fingerprint; a duplicate creates nothing, but
 *     attachments a failed earlier attempt did not store are added;
 *  3. thread grouping: the conversation id is the one the earliest known message of the thread carries;
 *  4. classify (classify.ts): confidence ≥ 0.85 files to the project, anything else files to the unfiled `firm` inbox and
 *     opens a filing_queue row with suggestions;
 *  5. Items are created through the M09 path (POST /api/items in process, items-client.ts), the message as an EML original and
 *     each attachment as its own Item linked with parent_id (POST /api/items has no parent field, so the link is written after);
 *  6. dispatches and organisation proposals (counterparties.ts); 7. ingestItem chunks the message and each attachment.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.ts';
import type { Storage } from '../../storage.ts';
import { audit } from '../../audit.ts';
import type { LlmProvider } from '../../llm/provider.ts';
import { ingestItem, type IngestDeps } from '../index.ts';
import type { ItemSink } from '../items-client.ts';
import { inferType } from '../legal-finance.ts';
import { classify, excludedReason, FILE_THRESHOLD, firmDomains, isFirmAddress, loadExclusions, type Classification } from './classify.ts';
import { syncCounterparties, contactsByEmail, type ContactRef } from './counterparties.ts';
import { bulkReason, loadRules, ruleHit, type Rules } from './rules.ts';
import { READY_THRESHOLD } from './classify.ts';
import type { MailAddress, MailboxContext, RawAttachment, RawMessage } from './types.ts';

export interface CaptureDeps {
  sink: ItemSink;
  /** null skips chunking; ingest-sync.ts indexes anything still without chunks. */
  ingest: IngestDeps | null;
  origin: 'zoho-mail' | 'gmail';
  /** Tie-break provider for the classifier. Defaults to ingest.provider. */
  provider?: LlmProvider | null;
  firmDomains?: string[];
  now?: () => Date;
  /** The mailbox's owner and privacy level (a connection by consent); absent for an environment-configured mailbox. */
  context?: MailboxContext;
  /** History (P55): tag the item, propose no organisations, queue only with a known counterparty. */
  history?: boolean;
  /** Rules loaded once per poll; loaded per message when absent. */
  rules?: Rules;
}

export interface CaptureResult {
  status: 'created' | 'duplicate' | 'skipped';
  reason?: string;
  /** created: filed, ready (one tap), review (needs a decision), bulk (kept apart), dismissed (the memory said not a project email). */
  outcome?: 'filed' | 'ready' | 'review' | 'bulk' | 'dismissed';
  duplicate_of?: 'message-id' | 'content';
  item_id?: string;
  project_id?: string;
  filed?: boolean;
  confidence?: number;
  queue_id?: string;
  attachment_ids: string[];
  dispatch_ids: string[];
  proposals: string[];
  errors: string[];
}

const PARENT_SOURCES = `('zoho-mail','gmail')`;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const skipAttachment = (a: RawAttachment) => a.bytes.length === 0 || /pkcs7-signature|x-pkcs7/i.test(a.mime) || /\.p7s$/i.test(a.filename);

/** Same message, whatever Message-Id a gateway gave it: sender, recipients, subject, minute, text and attachment bytes. */
export function fingerprint(msg: RawMessage): string {
  return sha(JSON.stringify([
    msg.from.address.toLowerCase(), [...msg.to, ...msg.cc].map(a => a.address.toLowerCase()).sort(), norm(msg.subject),
    msg.date.slice(0, 16), norm(msg.text).slice(0, 20000), msg.attachments.filter(a => !skipAttachment(a)).map(a => sha(a.bytes)).sort(),
  ]));
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const fmtAddr = (a: MailAddress) => (a.name ? `${oneLine(a.name).replace(/[<>"]/g, '')} <${a.address}>` : a.address);

/** The message as an RFC 822 original (LF line endings, UTF-8, attachments left to their own Items). */
export function buildEml(msg: RawMessage): Uint8Array {
  const h: string[] = [
    `Message-ID: <${msg.external_id}>`, `Date: ${new Date(msg.date).toUTCString()}`, `From: ${fmtAddr(msg.from)}`,
    `To: ${msg.to.map(fmtAddr).join(', ')}`,
  ];
  if (msg.cc.length) h.push(`Cc: ${msg.cc.map(fmtAddr).join(', ')}`);
  h.push(`Subject: ${oneLine(msg.subject)}`);
  if (msg.in_reply_to) h.push(`In-Reply-To: <${msg.in_reply_to}>`);
  if (msg.references.length) h.push(`References: ${msg.references.map(r => `<${r}>`).join(' ')}`);
  h.push(`X-Mailbox: ${msg.mailbox}`, 'MIME-Version: 1.0');
  const text = msg.text.replace(/\r\n?/g, '\n');
  let body: string;
  if (msg.html) {
    const b = `atc-${sha(msg.external_id).slice(0, 16)}`;
    h.push(`Content-Type: multipart/alternative; boundary="${b}"`);
    body = `--${b}\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n${text}\n--${b}\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n${msg.html.replace(/\r\n?/g, '\n')}\n--${b}--\n`;
  } else {
    h.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
    body = text + '\n';
  }
  return new TextEncoder().encode(h.join('\n') + '\n\n' + body);
}

/** Message-Ids of the conversation → the thread id its earliest known message carries. */
async function resolveThread(db: Db, msg: RawMessage): Promise<string> {
  const ids = [...new Set([msg.in_reply_to, ...msg.references, msg.thread_id].filter((x): x is string => !!x && x !== msg.external_id))];
  if (!ids.length) return msg.thread_id;
  const r = (await db.query<{ tid: string | null; ext: string | null }>(
    `SELECT extracted->>'thread_id' AS tid, external_id AS ext FROM items
      WHERE type = 'email' AND parent_id IS NULL AND NOT hidden AND origin->>'source' IN ${PARENT_SOURCES} AND (external_id = ANY($1::text[]) OR extracted->>'thread_id' = ANY($1::text[]))
      ORDER BY authored_at NULLS LAST, created_at LIMIT 1`, [ids])).rows[0];
  return r?.tid ?? r?.ext ?? msg.thread_id;
}

/** The draft this sent message came from, if the Hub sent it: same mailbox, same subject, same first recipient, within an hour of the send. */
async function sentFromHub(db: Db, msg: RawMessage): Promise<{ id: string; project_id: string; reference_no: string | null } | null> {
  const to = msg.to.map(a => a.address.toLowerCase());
  if (!to.length) return null;
  const r = (await db.query<{ id: string; project_id: string; reference_no: string | null }>(
    `SELECT id, project_id, reference_no FROM items
      WHERE NOT hidden AND extracted->>'kind' = 'draft' AND extracted->'sent'->>'via' = 'zoho-mail' AND (extracted->'sent'->>'captured_item_id') IS NULL
        AND lower(extracted->'sent'->>'from') = lower($1) AND lower(extracted->'sent'->>'subject') = lower($2)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(extracted->'sent'->'addresses', '[]'::jsonb)) a WHERE lower(a) = ANY($3::text[]))
        AND abs(extract(epoch from (($4::timestamptz) - (extracted->'sent'->>'at')::timestamptz))) < 3600
      ORDER BY (extracted->'sent'->>'at')::timestamptz DESC LIMIT 1`, [msg.mailbox, msg.subject, to, msg.date])).rows[0];
  return r ?? null;
}

async function attachmentsOf(db: Db, parentId: string): Promise<number> {
  return Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM items WHERE parent_id = $1', [parentId])).rows[0].n);
}

interface ParentInfo { id: string; project_id: string; filing: any; organisation_ids: string[]; authored_at: string; from: string }

/** Store each attachment as an Item of its own, linked to the message. Safe to repeat: the same attachment is the same origin id. */
async function storeAttachments(db: Db, deps: CaptureDeps, msg: RawMessage, parent: ParentInfo, unfiled: boolean): Promise<{ ids: string[]; errors: string[] }> {
  const ids: string[] = [], errors: string[] = [];
  const list = msg.attachments.filter(a => !skipAttachment(a));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    try {
      const res = await deps.sink({
        bytes: a.bytes, mime: a.mime, filename: a.filename,
        meta: {
          type: inferType(a.filename, a.mime), title: a.filename, project_id: parent.project_id, authored_at: parent.authored_at, authors: [parent.from],
          organisation_ids: parent.organisation_ids, origin: { source: deps.origin, external_id: `${msg.external_id}#${i + 1}`, fetched_at: (deps.now?.() ?? new Date()).toISOString() },
          filing: parent.filing, tags: unfiled ? ['unfiled'] : [],
          extracted: { filename: a.filename, attachment_of: parent.id, parent_message_id: msg.external_id, size: a.bytes.length },
        },
      });
      await db.query('UPDATE items SET parent_id = $2 WHERE id = $1 AND parent_id IS NULL', [res.id, parent.id]);
      ids.push(res.id);
    } catch (e) { errors.push(`attachment ${a.filename}: ${(e as Error).message}`); }
  }
  return { ids, errors };
}

async function indexItems(db: Db, storage: Storage, deps: CaptureDeps, ids: string[], errors: string[]): Promise<void> {
  if (!deps.ingest) return;
  for (const id of ids) {
    try { await ingestItem(db, storage, id, deps.ingest); }
    catch (e) { errors.push(`index ${id}: ${(e as Error).message}`); }   // ingest-sync.ts retries anything without chunks
  }
}

export async function captureMessage(db: Db, storage: Storage, incoming: RawMessage, deps: CaptureDeps): Promise<CaptureResult> {
  let msg = incoming;
  const now = deps.now ?? (() => new Date());
  const firm = deps.firmDomains ?? firmDomains();
  const out: CaptureResult = { status: 'created', attachment_ids: [], dispatch_ids: [], proposals: [], errors: [] };

  // 1. exclusions and rules: nothing about the message is stored, only that it was skipped and why.
  const skip = async (reason: string, detail: Record<string, unknown> = {}) => {
    await audit(db, 'mail-capture', 'mail.capture.skipped', 'firm', [], { status: 'skipped', reason, mailbox: msg.mailbox, folder: msg.folder, message_id: msg.external_id, ...detail });
    return { ...out, status: 'skipped' as const, reason };
  };
  if (deps.context?.privacy === 'none') return skip('privacy');
  const why = excludedReason(msg, await loadExclusions(db), firm);
  if (why) return skip(why.kind);
  const rules = deps.rules ?? await loadRules(db);
  const hit = ruleHit(msg, rules, deps.context?.person_id ?? null);
  if (hit) return skip(hit.kind, hit.kind === 'blocked' ? { pattern: hit.detail } : {});
  const bulk = bulkReason(msg, firm);
  const subjectsOnly = deps.context?.privacy === 'subjects';
  if (subjectsOnly) msg = { ...msg, text: '', html: undefined, attachments: [] };

  // 2. dedupe
  const fp = fingerprint(msg);
  const dup = (await db.query<{ id: string; project_id: string; by: string }>(
    `SELECT id, project_id, CASE WHEN external_id = $1 THEN 'message-id' ELSE 'content' END AS by FROM items
      WHERE type = 'email' AND parent_id IS NULL AND origin->>'source' IN ${PARENT_SOURCES} AND (external_id = $1 OR extracted->>'fingerprint' = $2)
      ORDER BY (external_id = $1) DESC, created_at LIMIT 1`, [msg.external_id, fp])).rows[0];
  if (dup) {
    // One record however many mailboxes received it (P53): this mailbox is added to the record's seen_by.
    await db.query(`UPDATE items SET extracted = jsonb_set(extracted, '{seen_by}', to_jsonb(ARRAY(SELECT DISTINCT v FROM jsonb_array_elements_text(coalesce(CASE WHEN jsonb_typeof(extracted->'seen_by') = 'array' THEN extracted->'seen_by' END, jsonb_build_array(extracted->>'mailbox')) || to_jsonb(ARRAY[$2::text])) AS t(v)))) WHERE id = $1`, [dup.id, msg.mailbox.toLowerCase()]);
    const wanted = msg.attachments.filter(a => !skipAttachment(a)).length;
    if (wanted && dup.by === 'message-id' && (await attachmentsOf(db, dup.id)) < wanted) {
      const row = (await db.query<any>(`SELECT id, project_id, filing, organisation_ids, authored_at, tags FROM items WHERE id = $1`, [dup.id])).rows[0];
      const r = await storeAttachments(db, deps, msg, { id: row.id, project_id: row.project_id, filing: row.filing, organisation_ids: row.organisation_ids, authored_at: new Date(row.authored_at).toISOString(), from: msg.from.address }, (row.tags ?? []).includes('unfiled'));
      out.attachment_ids.push(...r.ids); out.errors.push(...r.errors);
      await indexItems(db, storage, deps, r.ids, out.errors);
    }
    return { ...out, status: 'duplicate', duplicate_of: dup.by as 'message-id' | 'content', item_id: dup.id, project_id: dup.project_id };
  }

  // 3-4. thread and project. A message the Hub itself sent (wave 6, D63) files to its draft's project and cites the draft.
  const threadId = await resolveThread(db, msg);
  const fromHub = msg.folder === 'sent' ? await sentFromHub(db, msg) : null;
  const cls: Classification = fromHub
    ? { project_id: fromHub.project_id, confidence: 1, evidence: [{ signal: 'memory', detail: `sent from the Hub as ${fromHub.reference_no ?? 'a draft'}`, weight: 1 }], candidates: [{ project_id: fromHub.project_id, score: 1, confidence: 1, evidence: [] }] }
    : await classify(db, { ...msg, thread_id: threadId }, { provider: deps.provider === undefined ? deps.ingest?.provider ?? null : deps.provider, firmDomains: firm });
  const filed = !!cls.project_id && cls.confidence >= FILE_THRESHOLD && !bulk;
  const projectId = filed ? cls.project_id! : 'firm';

  // counterparties known so far
  const everyone: Array<{ a: MailAddress; role: ContactRef['role'] }> = [{ a: msg.from, role: 'from' as const }, ...msg.to.map(a => ({ a, role: 'to' as const })), ...msg.cc.map(a => ({ a, role: 'cc' as const }))].filter(x => x.a.address);
  const known = await contactsByEmail(db, everyone.map(x => x.a.address));
  const contacts: ContactRef[] = everyone.map(({ a, role }) => {
    const c = known.get(a.address.toLowerCase());
    return { email: a.address.toLowerCase(), ...(a.name ? { name: a.name } : {}), role, firm: isFirmAddress(a.address, firm), contact_id: c?.id ?? null, organisation_id: c?.organisation_id ?? null };
  });
  const direction: 'in' | 'out' = msg.folder === 'sent' || isFirmAddress(msg.from.address, firm) ? 'out' : 'in';
  const organisation_ids = [...new Set(contacts.filter(c => !c.firm && c.organisation_id).map(c => c.organisation_id!))];
  const knownCounterparty = contacts.some(c => !c.firm && c.contact_id);
  // ready: one tap files it; review: a decision; bulk and dismissed never reach the queue; history waits only with a known counterparty.
  const outcome: NonNullable<CaptureResult['outcome']> = bulk ? 'bulk' : filed ? 'filed' : cls.dismissed ? 'dismissed'
    : (cls.project_id && cls.confidence >= READY_THRESHOLD && knownCounterparty && cls.candidates.filter(c => c.confidence >= READY_THRESHOLD).length === 1) ? 'ready' : 'review';
  const queue = !filed && !bulk && !cls.dismissed && (!deps.history || knownCounterparty);
  const hiddenAtCapture = !!bulk;
  const tags = [...(filed ? [] : ['unfiled']), ...(deps.history ? ['history'] : []), ...(bulk ? ['bulk'] : [])];

  const stamp = now().toISOString();
  const authoredAt = Number.isNaN(Date.parse(msg.date)) ? stamp : msg.date;
  const filing = { method: 'classifier' as const, confidence: cls.confidence };
  const filename = `${(msg.subject.replace(/[^\p{L}\p{N}._ -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'message')}.eml`;
  const res = await deps.sink({
    bytes: buildEml(msg), mime: 'message/rfc822', filename,
    meta: {
      type: 'email', title: msg.subject || '(no subject)', project_id: projectId, authored_at: authoredAt, authors: msg.from.address ? [msg.from.address.toLowerCase()] : [], organisation_ids,
      origin: { source: deps.origin, external_id: msg.external_id, fetched_at: stamp }, filing, tags,
      extracted: {
        filename, contacts, direction, folder: msg.folder, mailbox: msg.mailbox, seen_by: [msg.mailbox.toLowerCase()], thread_id: threadId, in_reply_to: msg.in_reply_to, references: msg.references,
        fingerprint: fp, labels: msg.labels, attachments: msg.attachments.filter(a => !skipAttachment(a)).map(a => ({ filename: a.filename, mime: a.mime, size: a.bytes.length })),
        status: outcome === 'filed' ? 'filed' : outcome, category: bulk ? 'bulk' : 'human', ...(bulk ? { bulk_reason: bulk } : {}), ...(deps.history ? { history: true } : {}), ...(fromHub ? { sent_draft_id: fromHub.id } : {}),
        ...(subjectsOnly ? { privacy: 'subjects' } : {}), ...(deps.context?.connection_id ? { connection_id: deps.context.connection_id } : {}),
        classification: { project_id: cls.project_id, confidence: cls.confidence, evidence: cls.evidence, ...(cls.tie_break ? { tie_break: cls.tie_break } : {}), candidates: cls.candidates.slice(0, 3).map(c => ({ project_id: c.project_id, confidence: c.confidence })) },
      },
    },
  });
  out.item_id = res.id; out.project_id = projectId; out.filed = filed; out.confidence = cls.confidence; out.outcome = outcome;
  if (fromHub) {
    await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1,$2) ON CONFLICT DO NOTHING', [res.id, `doc:${fromHub.id}`]);
    await db.query(`UPDATE items SET extracted = jsonb_set(extracted, '{sent,captured_item_id}', to_jsonb($2::text)) WHERE id = $1`, [fromHub.id, res.id]);
  }
  if (hiddenAtCapture) await db.query(`UPDATE items SET hidden = true, extracted = extracted || '{"hidden_reason":"bulk"}'::jsonb WHERE id = $1`, [res.id]);

  const att = await storeAttachments(db, deps, msg, { id: res.id, project_id: projectId, filing, organisation_ids, authored_at: authoredAt, from: msg.from.address.toLowerCase() }, !filed);
  out.attachment_ids = att.ids; out.errors.push(...att.errors);

  if (queue) {
    out.queue_id = randomUUID();
    const suggestions = cls.candidates.slice(0, 3).map(c => ({ project_id: c.project_id, confidence: c.confidence, evidence: c.evidence.map(e => ({ signal: e.signal, detail: e.detail })) }));
    await db.query('INSERT INTO filing_queue (id, item_id, suggestions) VALUES ($1,$2,$3::jsonb)', [out.queue_id, res.id, JSON.stringify(suggestions)]);
  }

  // 6. dispatches and organisation proposals (history and bulk propose nothing: P55, P56)
  try {
    const s = bulk ? { dispatch_ids: [], proposals: [] } : await syncCounterparties(db, res.id, { firm, propose: !deps.history });
    out.dispatch_ids = s.dispatch_ids; out.proposals = s.proposals;
  } catch (e) { out.errors.push(`dispatch: ${(e as Error).message}`); }

  await audit(db, 'mail-capture', 'mail.capture', filed ? `project:${projectId}` : 'firm', [`doc:${res.id}`, ...out.attachment_ids.map(i => `doc:${i}`)],
    { status: filed ? 'filed' : queue ? 'queued' : outcome, outcome, confidence: cls.confidence, mailbox: msg.mailbox, folder: msg.folder, direction, attachments: att.ids.length, ...(deps.history ? { history: true } : {}) });

  // 7. chunks (bulk mail and subject-only mail are not indexed: nothing to find in them)
  if (!bulk && !subjectsOnly) await indexItems(db, storage, deps, [res.id, ...att.ids], out.errors);
  return out;
}
