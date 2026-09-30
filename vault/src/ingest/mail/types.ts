/**
 * Mail capture types (M10). Every source (IMAP, Gmail) produces the same RawMessage, so capture, classification
 * and the conformance tests never care which mailbox a message came from.
 */
export type MailFolder = 'inbox' | 'sent' | 'other';

export interface MailAddress { address: string; name?: string }

export interface RawAttachment { filename: string; mime: string; bytes: Uint8Array }

export interface RawMessage {
  /** The mailbox that holds the message (its address), e.g. info@alpha-technical-centre.com. */
  mailbox: string;
  /** Message-Id header without the angle brackets. The dedupe key. */
  external_id: string;
  /** Root of the conversation: the first References entry, else In-Reply-To, else this message's own id. */
  thread_id: string;
  in_reply_to: string | null;
  references: string[];
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  /** ISO 8601. */
  date: string;
  text: string;
  html?: string;
  attachments: RawAttachment[];
  /** Provider labels or IMAP flags/keywords, as the provider spells them (Gmail: label names; IMAP: flags such as \Seen, $Personal). */
  labels: string[];
  folder: MailFolder;
}

export interface FetchOptions {
  /** Backfill: only messages on or after this date (ignored when a cursor is given). */
  since?: Date;
}

export interface MailSource {
  /** Stable id of the mailbox, `<zoho-mail|gmail>:<address>`; the key of its row in mail_cursors. */
  id: string;
  /** Which `origin.source` its items carry. Derived from `id` when absent. */
  origin?: 'zoho-mail' | 'gmail';
  /**
   * Messages after `cursor` (everything when null), in the order the source holds them (oldest first within a folder or mailbox).
   * Each message comes with the cursor that
   * means "everything up to and including this message is done"; the poller stores it after capturing it.
   */
  fetch(cursor: string | null, opts?: FetchOptions): AsyncIterable<{ message: RawMessage; cursor: string }>;
}

export const originOf = (s: Pick<MailSource, 'id' | 'origin'>): 'zoho-mail' | 'gmail' => s.origin ?? (s.id.startsWith('gmail') ? 'gmail' : 'zoho-mail');
