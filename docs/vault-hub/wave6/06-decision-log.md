# Wave 6 — Decision Log

Tooler phase 6. Gate 1 and Gate 2 are recorded verbatim; the build is logged PR by PR.

## Gate 1 (Choice Sheet, `02-choice-sheet.md`)

D60 "OAuth at first sign-in (Recommended)" · D61 "Everything, with Protected and Blocked lists (Recommended)" · D62 "180 days, newest first, capped (Recommended)" · D63 "Send from the person's mailbox, confirm first (Recommended)". Answered 4 October 2026.

## Gate 2 (Markup, `05-markup.md`)

"Approved, build it as written (Recommended)", 4 October 2026.

## What shipped

- **PR 1 (#52): consent at first sign-in, one sealed token per person, Protected and Blocked rules, a privacy level, a way out.** W6-AC1, W6-AC3 (rules, privacy, disconnect, export). `vault/db/007_mailboxes.sql`, `vault/src/secrets.ts`, `vault/src/ingest/mail/zoho-oauth.ts`, `vault/src/ingest/mail/privacy.ts`, `vault/src/api/mailbox.routes.ts`, the Connect card on Today, Your mailbox on Settings, SETUP.md §7.
- **PR 2: the Zoho Mail source, the poll from connections, history in slices, the capture rules, the filing memory, who last spoke.** W6-AC2, W6-AC3 (evaluation), W6-AC4, W6-AC5 (memory, status, decisions written by Assign and dismiss), W6-AC6, W6-AC8 (data). `vault/src/ingest/mail/zoho-api.ts`, `rules.ts`, `relationship.ts`, changes to `poll.ts`, `capture.ts`, `classify.ts`, `parse.ts`, `types.ts`, `counterparties.ts`, `jobs/mail-poll.ts`, `api/queue.routes.ts`.

## What the build taught

1. **Zoho's message list has no "since".** The source lists newest first and stops at the message the cursor names (or at a date); history walks a folder backwards by page offset from a stored position, so each slice is one list call plus the messages, never a re-read of the top.
2. **The raw message endpoint's shape is not promised.** The source accepts `originalmessage` as JSON (`data.messageContent`, with fallbacks) or as bytes, and the recorded fake exercises both; the first live connection is the test of the tenant (SETUP.md §7 says where to look).
3. **A consented connection shows no IMAP flags.** Through the API nothing marks a message "personal" the way the `$Personal` IMAP keyword did, so the family lunch in the fixture mailbox is captured until the person blocks the sender from Settings; the Blocked list, not a client-side flag, is the privacy control.
4. **Protected by rule changed an old test's arithmetic.** Two hundred of the thousand generated backfill messages were colleagues-only; they are now skipped, and the test computes the kept and skipped counts from the rule rather than hard-coding them.
5. **A newsletter proposes no organisation.** The bulk rule runs before counterparty sync, so `news@oilgasjournal.com` no longer appears in the organisation proposals; public mail domains never do either.
6. **The duplicate path needed a second mailbox, not a second record.** A message five mailboxes received is one item whose `seen_by` lists them; the disconnect of one mailbox leaves a message another mailbox also saw.
