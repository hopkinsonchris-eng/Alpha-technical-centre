# M10 — Correspondence capture

**Wave 3 · Tier B · Depends on: M09 · Size M**

## Purpose
Email becomes part of the project record automatically, once, with
attachments, and with a review queue for uncertain filing.

## Read first
`../02-practice-scan.md` P9, `../06-architecture.md` §4 F4, `vault-item.schema.json` (`filing`), Zoho Mail IMAP settings, Gmail API `history.list` pattern.

## Deliverables
- `vault/src/ingest/mail/imap.ts` (Zoho mailboxes: `info@` and each partner's, credentials in env) and `mail/gmail.ts` (OAuth refresh token in env; `historyId` cursor); both produce the same `RawMessage` shape.
- Cursor table `mail_cursors(mailbox, cursor, updated_at)`; poll every 5 minutes; backfill command `node dist/jobs/mail-backfill.js --since=2024-01-01`.
- Dedup on `Message-Id` and on content hash; thread grouping by `References`/`In-Reply-To`.
- `vault/src/ingest/mail/classify.ts`: score each project by sender/recipient domain and address match against the project contact list (0.5), thread already filed (0.3), subject and body tokens against project name, client name, asset names (0.2); LLM tie-break only when the top two are within 0.1. Result `{project_id, confidence}`; ≥ 0.85 files directly, else into `filing_queue`.
- Items of type `email` with `authored_at`, `authors`, `extracted.contacts`; attachments as child Items through M09 with `parent_id`.
- Hub queue page `hub/queue.html` (Tier C component): list, assign, "not a project email" (files to `firm/inbox`), remembers sender → project choices as new contacts.
- Sent folders: every outbound message from a firm mailbox creates a Dispatch (`direction: out`, channel email, contacts matched or proposed, `in_reply_to` from the thread); inbound messages from a known contact create `direction: in` dispatches. Unknown senders' organisations are proposed into the review queue with name and domain (AC16).
- Sensitive-mail rule: messages labelled personal or matching a configured exclusion list are never ingested.

## Acceptance criteria
1. A message to a project contact appears once as an Item under that project after two polls (AC8), with its attachment as a child Item.
2. A message with no matching contact lands in the queue; assigning it files it and adds the sender to the project's contacts, so the next message from them files directly.
3. Backfill of 1,000 fixture messages completes with zero duplicates.
4. An excluded sender is never ingested (assert absence and an audit event `skipped`).
5. Both adapters pass the same conformance test on the same fixture mailbox.

## Smoke tests
`vault/test/mail.imap.test.mjs`, `mail.gmail.test.mjs` (recorded), `mail.classify.test.mjs` (labelled fixture of 200 messages, precision ≥ 0.95 at the 0.85 threshold), Playwright for the queue page.

## Out of scope
Sending mail; calendar.
