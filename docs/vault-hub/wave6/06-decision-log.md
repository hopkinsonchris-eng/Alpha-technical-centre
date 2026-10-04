# Wave 6 — Decision Log

Tooler phase 6. Gate 1 and Gate 2 are recorded verbatim; the build is logged PR by PR.

## Gate 1 (Choice Sheet, `02-choice-sheet.md`)

D60 "OAuth at first sign-in (Recommended)" · D61 "Everything, with Protected and Blocked lists (Recommended)" · D62 "180 days, newest first, capped (Recommended)" · D63 "Send from the person's mailbox, confirm first (Recommended)". Answered 4 October 2026.

## Gate 2 (Markup, `05-markup.md`)

"Approved, build it as written (Recommended)", 4 October 2026.

## What shipped

- **PR 1 (#52): consent at first sign-in, one sealed token per person, Protected and Blocked rules, a privacy level, a way out.** W6-AC1, W6-AC3 (rules, privacy, disconnect, export). `vault/db/007_mailboxes.sql`, `vault/src/secrets.ts`, `vault/src/ingest/mail/zoho-oauth.ts`, `vault/src/ingest/mail/privacy.ts`, `vault/src/api/mailbox.routes.ts`, the Connect card on Today, Your mailbox on Settings, SETUP.md §7.
- **PR 2: the Zoho Mail source, the poll from connections, history in slices, the capture rules, the filing memory, who last spoke.** W6-AC2, W6-AC3 (evaluation), W6-AC4, W6-AC5 (memory, status, decisions written by Assign and dismiss), W6-AC6, W6-AC8 (data). `vault/src/ingest/mail/zoho-api.ts`, `rules.ts`, `relationship.ts`, changes to `poll.ts`, `capture.ts`, `classify.ts`, `parse.ts`, `types.ts`, `counterparties.ts`, `jobs/mail-poll.ts`, `api/queue.routes.ts`.

- **PR 3: the queue's Ready group with Accept all, What came in on Today with a cited sentence per opportunity, who last spoke in the recipient picker, the WorkDrive changes cursor.** W6-AC5 (ready, Accept all), W6-AC7, W6-AC8 (the picker), W6-AC10. `vault/src/api/activity.routes.ts`, `vault/src/llm/activity-brief.ts`, changes to `queue.routes.ts`, `draft.review.routes.ts`, `ingest/workdrive.ts`, `hub/index.html`, `hub/hub.js`, `hub/queue.js`, `hub/draft.js`, `hub/project.js` (`?doc=`).

- **PR 4: Send from the person's own mailbox.** W6-AC9. `vault/src/ingest/mail/zoho-send.ts`, `vault/src/api/draft.send.routes.ts`, the sent-from-Hub link in `capture.ts`, the confirm sheet in `hub/draft.js`; `HANDOVER.md`; the evidence below.

## What the build taught

1. **Zoho's message list has no "since".** The source lists newest first and stops at the message the cursor names (or at a date); history walks a folder backwards by page offset from a stored position, so each slice is one list call plus the messages, never a re-read of the top.
2. **The raw message endpoint's shape is not promised.** The source accepts `originalmessage` as JSON (`data.messageContent`, with fallbacks) or as bytes, and the recorded fake exercises both; the first live connection is the test of the tenant (SETUP.md §7 says where to look).
3. **A consented connection shows no IMAP flags.** Through the API nothing marks a message "personal" the way the `$Personal` IMAP keyword did, so the family lunch in the fixture mailbox is captured until the person blocks the sender from Settings; the Blocked list, not a client-side flag, is the privacy control.
4. **Protected by rule changed an old test's arithmetic.** Two hundred of the thousand generated backfill messages were colleagues-only; they are now skipped, and the test computes the kept and skipped counts from the rule rather than hard-coding them.
5. **A newsletter proposes no organisation.** The bulk rule runs before counterparty sync, so `news@oilgasjournal.com` no longer appears in the organisation proposals; public mail domains never do either.
6. **The duplicate path needed a second mailbox, not a second record.** A message five mailboxes received is one item whose `seen_by` lists them; the disconnect of one mailbox leaves a message another mailbox also saw.
7. **The overnight sentence keeps only what it cites.** The provider answers one line per project; every sentence without a citation among that project's new records is dropped and counted, and a citation to another project's record is stripped from an otherwise cited sentence. Without a provider the card shows the counts and the records as chips.
8. **The Changes API decides whether to list.** A folder is listed again only when a change other than a delete arrived; a delete hides the item without a listing; a move keeps the item and its versions and only rewrites the path; an expired token (older than the 31 days the API keeps) falls back to a full listing and a fresh start token.
9. **Two regexes with one name.** The Today script already held a citation pattern for the country brief; the What came in card's pattern had to carry its own name, or no Hub page loaded. A syntax check of each edited module before the browser suite is cheaper than forty timeouts.
10. **The send route renders through the Vault's own render route.** Rather than lift the letter assembly out of `draft.routes.ts`, the send route calls `app.request('/api/render?format=docx')` with the caller's Access header, so the attachment is byte-for-byte what Render to letterhead gives, reference number included.
11. **The sent copy is matched by what the Hub knows it sent.** Zoho's numeric message id is not the RFC Message-Id, so the capture matches a Sent-folder message to a draft by mailbox, subject, first recipient and an hour's window around the send, files it to the draft's project with confidence 1, cites the draft and writes the captured item's id back on the draft.

## Evidence

- `evidence/w6-connect-card.png` (PR 1: the Connect card on Today), `evidence/w6-your-mailbox.png` (PR 1: Settings → Your mailbox), `evidence/w6-what-came-in.png` (PR 3: the card with a cited sentence and chips), `evidence/w6-ready-group.png` (PR 3: the queue's Ready group with Accept all), `evidence/w6-send-confirm.png` (PR 4: the Send confirm sheet). All captured by the end-to-end specs on realistic stubbed data.
- Suites on the last head of each PR: Vault 446 / 463 / 467 / 470, typecheck clean, Hub 142 / 142 / 145 / 146; CI green on #52, #53, #54 (PR 4's run is on its own pull request); the sitemap pages byte-identical to `main`.

## Deviations from the Markup, stated

1. **Protected and Blocked mail is never stored, not stored hidden.** The Markup's Settings card counted "internal (hidden)" as if the messages were kept; keeping colleagues-only mail hidden would have stored exactly what the rule says the firm should not hold. The count now comes from the audit log of what the capture declined.
2. **History runs inside the five-minute poll, not as a night job.** A slice of a hundred messages per poll stays within Zoho's thirty requests a minute beside the live read and brings 180 days in over the first day or two; a separate cron would have needed its own token key and storage settings for no gain.
3. **The Ready bar is 0.6 with a known counterparty, as the Markup said, but a filed message that the memory settled scores 1.0 without a candidate list**: a decided thread is an answer, not a suggestion.
4. **Send uses the Vault's render route, not a shared module** (lesson 10).
